# Physics pipeline

Weed runs **Box2D 3.0** (the real C library, WASM + SIMD + pthreads) behind the physics worker. Emscripten pthreads need a classic worker script, so ESM `physics_worker.js` nests `src/box2d/box2d_wasm.js`, which loads `weedjs_post.js`. After `box2dReady`, Transform/RigidBody hot fields rebind onto WASM HEAP — no per-frame pose copies.

Bundle builds (`npm run make_bundle`) shove glue + `.wasm` + the `importScripts` siblings into `WEED.Box2dWorkerSource` so npm consumers don’t fetch a separate `dist/box2d/`. Rebuild notes: [src/box2d/README.md](../src/box2d/README.md).

This doc is about the **pipeline** (step, contacts, joints, invariants). Implementation: `src/workers/physics_worker.js`, `src/components/RigidBody.js`, `src/core/gameObject.js`, `src/core/Joint.js`.

Related: [Spatial hashing & neighbors](./SPATIAL_HASHING.md), [Workers architecture](./WORKERS_ARCHITECTURE.md).

---

## Responsibilities (per frame)

1. **Box2D step** — nested WASM worker advances bodies; Weed hot fields (`Transform` / `RigidBody` pose & vel) live on HEAP. World `maximumLinearSpeed` clamps in the solver. Body damping: `linearDamping` / `angularDamping`.
2. **Contacts** — Box2D owns narrowphase; fixture μ from `Collider.friction`.
3. **Joints** — Weed `Joint` SAB (`addDistance` / `addRevolute` / `addWeld` with body-local anchors) syncs to Box2D joints each step (`weedjs_post.syncJoints`). Cap: WASM `MAX_JOINTS` (4096).
4. **Stats** — write counters and timing into `physicsStats`.

The worker does **not** build the spatial grid or neighbor lists; it **reads** `Grid.neighborData` produced by spatial workers.

### Soft contact knobs

Soft spring bias (`contactHertz` / damping / maxBias) is **not used** by the current resolve path. Prefer tuning `subStepCount`, `linearDamping`, and `angularDamping` instead.

### Collider shape types

| Value | Name     | Notes                                                                 |
| ----: | -------- | --------------------------------------------------------------------- |
|   `0` | Box      | Box2D box (`width`/`height` local AABB); rotates with `Transform.rotation` unless `fixedRotation` / static |
|   `1` | Circle   | Uses `radius`                                                         |
|   `2` | Polygon  | Convex polygon: local verts/normals via `Collider.makePolygon`, max 8 verts; oriented by `Transform.rotation`. |

Numbers match WASM C `b2_game_shape_*` (Box2D language).

Inertia (synced from collider geometry in `RigidBody.syncMassFromCollider`):

- Circle: `I = 0.5 * m * r²`
- Box: `I = m * (w² + h²) / 12`
- Polygon: shoelace area mass; inertia about centroid (Box2D-style)
- Static: `invInertia = 0`

`angularDamping` is Box2D body angular damping. Sprite facing follows `Transform.rotation` via the render queue. Spin settle uses `Collider.friction` + `angularDamping`.

### Sleeping

Box2D owns sleep. Weed exposes one scene knob:

| Knob | Default | Role |
|------|---------|------|
| `sleeping` | `true` | Maps to `b2World_EnableSleeping`. When `false`, dynamics never sleep. |

```javascript
physics: {
  sleeping: false,
}
```

Passed on nested Box2D worker `WEEDJS_INIT` / `WEEDJS_CONFIG` via `PhysicsWorld.enableSleeping`. HEAP `RigidBody.sleeping` follows Box2D (debug Sleeping overlay / cell sleep). Statics can still mark spatial cells “asleep.”

Legacy Weed knobs (`sleepThreshold`, `sleepDuration`, `wakeUpThreshold`, `stillnessTime`) are removed — they did nothing after Box2D took sleep ownership.

Velocity commands trust Box2D: nonzero `SetLinearVelocity` / `SetAngularVelocity` wake; zero on a sleeper is a no-op.

World `maximumLinearSpeed` (scene `physics.maximumLinearSpeed`) clamps in the solver.

### Collision filtering

Box2D sees the same rules Weed stores on `Collider`:

1. **`collisionGroupIndex`** (Int32): same nonzero group — negative skips, positive always collides (overrides mask).
2. Else **`collisionLayer` / `collisionMask`**: mutual bit checks.

See [Collision Filtering](./bible_of_weed_js.md#collision-filtering) in the bible.

### Scene `physics` config: substeps

- **`subStepCount`** — Box2D solver sub-step count per physics tick (`world.step(dt, subStepCount)`). Raise for stiffer stacking / joints at higher CPU cost. Minimum `1`.

Contacts for gameplay callbacks come from a **sequenced contact ring** (`box2dContactRing`): nested `weedjs_post` publishes Box2D begin/end (+ sensor) records with body generations after each step; each logic worker keeps its own read cursor (no physics/logic lockstep). Stale generations and inactive entities are rejected; ring overrun clears local pair state.

Body create/destroy sync uses a **dirty bitset + generation** (`box2dBodySync`), not `queryActiveEntities`. Command writes use an **MPSC sequence-slot ring** (`box2dCommandRing`).

---

## Dense collider list (`buildDenseColliders`)

**Legacy (pre–Box2D):** Once per physics frame the Verlet path built a dense list of entities with `neighborData` collision candidates.

**Current:** Box2D owns contacts. Spatial `neighborData` is visual-range only; this dense-candidate filter is not part of the Box2D contact path.

---

## Mass and `invMass` invariants

Collision response uses **inverse mass** directly (`invMass[i]`, `invMass[j]`) **without** a per-pair `|| 1` fallback.

**Invariant:** For every **dynamic** body that participates in physics, `mass` and `invMass` must be valid after spawn / `setup()`:

- Mass derived from collider geometry when a collider can supply it.
- Otherwise an explicit custom `mass` is respected, or **unit mass** (`mass = 1`, `invMass = 1`) is set once by `RigidBody.syncMassFromCollider()`.

**Why:** Removes a branch and implicit default from the hottest collision code; keeps behavior explicit.

**Static bodies:** `invMass` is `0` (infinite mass). Collider size changes also go through `RigidBody.syncMassFromCollider()`, so a static body keeps `invMass = 0` even if its collider geometry changes later.

If custom setup changes collider geometry through direct typed-array writes instead of the `Collider` / `GameObject` setters, call:

```javascript
this.rigidBody.syncMassFromCollider();
// or
RigidBody.syncMassFromCollider(entityIndex);
```

---

## Joints (Box2D-mapped)

Joints live in a **SharedArrayBuffer** pool (`Joint`), shared with main + workers. Packed pair: `(entityA << 16) | entityB`. Types: distance / revolute / weld. Attachment: `localAnchorA/B` (body local; default COM). Authored via `Joint.addDistance` / `addRevolute` / `addWeld`.

### Dense active list

Physics sync iterates the dense active list (`activeIndices` / `activeCount`), not `0 .. maxJoints`.

**Thread safety:** atomic free list + short spin lock on add/remove.

**Capacity:** Weed `maxJoints` should stay ≤ WASM `MAX_JOINTS` (4096).

### Sync

`weedjs_post.syncJoints` after `syncBodies`: create/destroy/recreate Box2D joints via `create*_joint_local`. Change detection uses `Joint.revision` (bumped on add/update/remove), not float fingerprints. Live WASM handles tracked via a dense list (no full `maxJoints` sweep). Failed creates (`handle === -2`) retry only after the slot's revision changes.

---

## GC and allocations (physics worker)

- Hot pose/vel/sleeping rebound to WASM HEAP (`box2dHotFields`) — zero-copy after seed.
- Command ring handlers hoisted once in `weedjs_post` (no per-step `{}`).
- Joint sync uses typed arrays + revision ints only; no per-joint heap objects in the hot path.
- Contact callbacks: logic drains the contact ring; begin/end apply helpers are instance methods (no per-frame closures).

---

## Worker stats

Written to `physicsStats` via indices in `src/workers/workers-utils.js` (`PHYSICS_STATS`):

| Key | Meaning |
| --- | --- |
| `FPS` | Instantaneous FPS slot (via frame timing) |
| `STEP_MS` | Outer physics worker: wall time for Box2D Atomics step roundtrip (ms) |
| `MSG_MS` | Time spent handling incoming messages this frame (ms); see `AbstractWorker` |
| `BODY_COUNT` | Nested weedjs: dense Box2D bodies after `syncBodies` |
| `JOINT_COUNT` | Nested weedjs: `world.getJointCount()` (WASM joint table high-water) |
| `CONTACT_BEGIN` / `CONTACT_END` | Box2D contact begin/end event counts this step (`EVENT_HEADER`) |
| `SENSOR_BEGIN` / `SENSOR_END` | Box2D sensor begin/end event counts this step |
| `WEED_JOINTS` | Dense active count from Weed `Joint` SAB (when joints enabled) |
| `COMMAND_OVERFLOW_TOTAL` | Cumulative MPSC command ring overflows |
| `CONTACT_DROPPED` / `SENSOR_DROPPED` | WASM export drops + contact-ring overrun counter |
| `BODY_SYNC_*` / `JOINT_SYNC_*` / `COMMAND_*` | Nested subphase timings and change counts |

Other workers expose `MSG_MS` similarly for comparable overhead profiling.

---

## Config assumptions

- **`settings.gravity.x` / `y`** are expected to be real numbers. Avoid leaving them `undefined` if your scene merges partial config; missing values can propagate **NaN** into integration.

---

## AbstractWorker message queue (shared concern)

All workers extend `AbstractWorker`. Incoming `onmessage` uses an **array queue** drained synchronously (with `await` inside handlers preserved), instead of chaining a new `Promise` per message. That reduces **microtask / Promise churn** under bursty messaging.

Inter-worker `handleWorkerMessage` attaches `_fromWorker` **in place** on object payloads when possible, avoiding `{ ...data }` copies.

See `src/workers/AbstractWorker.js`.
