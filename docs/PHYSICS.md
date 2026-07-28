# Physics pipeline

This document describes how the **physics worker** drives Box2D (motion, contacts, joints), with emphasis on **performance choices** (HEAP rebind, shared memory, minimal allocations) and **data invariants** the engine assumes.

Implementation: `src/workers/physics_worker.js`, `src/components/RigidBody.js`, `src/core/gameObject.js`, `src/core/Joint.js`.

Related: [Spatial hashing & neighbors](./SPATIAL_HASHING.md), [Workers architecture](./WORKERS_ARCHITECTURE.md).

---

## Responsibilities (per frame)

1. **Box2D step** — nested WASM worker advances bodies; Weed hot fields (`Transform` / `RigidBody` pose & vel) live on HEAP. Post-step clamp uses `RigidBody.maxLinearSpeed`. Body damping: `linearDamping` / `angularDamping`.
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

Bodies that stay still can sleep so Box2D / Weed can skip work on idle bodies. Cell sleeping (particle worker) builds on the same `RigidBody.sleeping` bits — see [Spatial hashing](./SPATIAL_HASHING.md).

Scene knobs live under `config.physics` (merged from `PHYSICS_DEFAULTS`). Sleep enter/exit thresholds are read by the **particle worker at scene init**; prefer setting them on the scene’s `static config` rather than mid-run `updatePhysicsConfig`.

| Knob | Default | Role |
|------|---------|------|
| `sleeping` | `true` | Master switch. When `false`, bodies never enter sleep (thresholds ignored). |
| `sleepThreshold` | `0.1` | Max linear `speed` **and** `\|angularVelocity\|` to count as still. |
| `sleepDuration` | `30` | Consecutive particle ticks still before `sleeping = 1` (**frames**, not seconds). |
| `wakeUpThreshold` | `0.05` | Accel magnitude (post-`dtRatio`) that resets `stillnessTime` on **awake** bodies. |

**Enter sleep** (particle `updateDerivedProperties`): when `sleeping` is enabled, a dynamic body with both `speed` and `|ω|` below `sleepThreshold` increments `stillnessTime`; at `sleepDuration` it sets `RigidBody.sleeping = 1`. Tumbling sticks stay awake until spin dies.

**While asleep:** Box2D body sleeps; Weed keeps `RigidBody.sleeping` in sync. Spatial may still keep visual-only neighbors.

**Wake:** speed/spin above `sleepThreshold`; meaningful collision penetration (above penetration slop); manual `RigidBody.sleeping[i] = 0` (and usually `stillnessTime[i] = 0`); awake-body accel above `wakeUpThreshold` resets the stillness counter.

Disable for a scene:

```javascript
physics: {
  sleeping: false,
}
```

### Collision filtering (hot path)

Pair filter runs in the dense collision loop with **no allocations**:

1. **`collisionGroupIndex`** (Int32, Box2D-style): same nonzero group — negative skips, positive always collides (overrides mask).
2. Else **`collisionLayer` / `collisionMask`**: mutual bit checks.

See [Collision Filtering](./bible_of_weed_js.md#collision-filtering) in the bible.

### Scene `physics` config: substeps

- **`subStepCount`** — Box2D solver sub-step count per physics tick (`world.step(dt, subStepCount)`). Raise for stiffer stacking / joints at higher CPU cost. Minimum `1`.

Contacts for gameplay callbacks come from **Box2D begin/end events** on the WASM HEAP (logic workers with `CollisionListener`), not from a Weed pair buffer.

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

`weedjs_post.syncJoints` after `syncBodies`: create/destroy/recreate Box2D joints via `create*_joint_local`.

---

## GC and allocations (physics worker)

- Hot pose/vel/sleeping rebound to WASM HEAP (`box2dHotFields`) — zero-copy after seed.
- Command ring handlers hoisted once in `weedjs_post` (no per-step `{}`).
- Joint sync uses typed arrays only; no per-joint heap objects in the hot path.
- Contact callbacks: logic reads HEAP event views; begin/end apply helpers are instance methods (no per-frame closures).

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

Other workers expose `MSG_MS` similarly for comparable overhead profiling.

---

## Config assumptions

- **`settings.gravity.x` / `y`** are expected to be real numbers. Avoid leaving them `undefined` if your scene merges partial config; missing values can propagate **NaN** into integration.

---

## AbstractWorker message queue (shared concern)

All workers extend `AbstractWorker`. Incoming `onmessage` uses an **array queue** drained synchronously (with `await` inside handlers preserved), instead of chaining a new `Promise` per message. That reduces **microtask / Promise churn** under bursty messaging.

Inter-worker `handleWorkerMessage` attaches `_fromWorker` **in place** on object payloads when possible, avoiding `{ ...data }` copies.

See `src/workers/AbstractWorker.js`.
