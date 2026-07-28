# Physics pipeline

This document describes how the **physics worker** integrates motion, collisions, and distance constraints, with emphasis on **performance choices** (dense iteration, shared memory, minimal allocations) and **data invariants** the engine assumes.

Implementation: `src/workers/physics_worker.js`, `src/components/RigidBody.js`, `src/core/gameObject.js`, `src/core/Constraint.js`.

Related: [Spatial hashing & neighbors](./SPATIAL_HASHING.md), [Workers architecture](./WORKERS_ARCHITECTURE.md).

---

## Responsibilities (per frame)

1. **Verlet integration** — advance positions from acceleration, velocity caps, friction, and gravity (config-driven). Also integrates `angularVelocity` into `Transform.rotation` and applies `angularDrag`.
2. **Collision resolution** — positional PBD with coupled `λ = correction / invMassAng`. The correction moves `x`, and `contactSyncFraction()` decides how much of it also moves the invent `px` — **restitution 0**: sync only the part that cancels the approach, so contacts never invent separation velocity (jumps) but a correction too small to stop the approach still propagates shock up a stack. **Δθ** only when `|r × n| > crossEps` (a flat floor hit must not spin); spin decay is `angularDrag`'s job, once per tick. Circles force `invI = 0`. Friction: Coulomb on `px`, clamped by `μ · max(correction, g·n · dtRatio²)` — both terms in step-displacement units. No soft-contact bias.
3. **Distance constraints** (optional) — position-based corrections for active constraints when constraints are enabled in scene config.
4. **Stats** — write counters and timing into `physicsStats` (see [Worker stats](#worker-stats)).

The worker does **not** build the spatial grid or neighbor lists; it **reads** `Grid.neighborData` produced by spatial workers.

### Soft contact knobs

Soft spring bias (`contactHertz` / damping / maxBias) is **not used** by the current resolve path. Prefer tuning `collisionResponseStrength`, `subStepCount`, and `angularDrag` instead.

### Collider shape types

| Value | Name     | Notes                                                                 |
| ----: | -------- | --------------------------------------------------------------------- |
|   `0` | Circle   | Uses `radius`                                                         |
|   `1` | Box      | Box2D box (`width`/`height` local AABB); rotates with `Transform.rotation` unless `fixedRotation` / static |
|   `2` | Polygon  | Convex polygon: local verts/normals via `Collider.makePolygon`, max 8 verts; oriented by `Transform.rotation`. |

Inertia (synced from collider geometry in `RigidBody.syncMassFromCollider`):

- Circle: `I = 0.5 * m * r²`
- Box: `I = m * (w² + h²) / 12`
- Polygon: shoelace area mass; inertia about centroid (Box2D-style)
- Static: `invInertia = 0`

`angularDrag` damps spin each move step: `ω *= max(0, 1 - angularDrag * dtRatio)`. Sprite facing follows `Transform.rotation` via the render queue. Spin settle uses contact friction + optional `angularDrag`.

### Sleeping

Bodies that stay still can sleep so physics skips Verlet integrate and sleep–sleep pairs skip collision resolve. Cell sleeping (particle worker) builds on the same `RigidBody.sleeping` bits — see [Spatial hashing](./SPATIAL_HASHING.md).

Scene knobs live under `config.physics` (merged from `PHYSICS_DEFAULTS`). Sleep enter/exit thresholds are read by the **particle worker at scene init**; prefer setting them on the scene’s `static config` rather than mid-run `updatePhysicsConfig`.

| Knob | Default | Role |
|------|---------|------|
| `sleeping` | `true` | Master switch. When `false`, bodies never enter sleep (thresholds ignored). |
| `sleepThreshold` | `0.1` | Max linear `speed` **and** `\|angularVelocity\|` to count as still. |
| `sleepDuration` | `30` | Consecutive particle ticks still before `sleeping = 1` (**frames**, not seconds). |
| `wakeUpThreshold` | `0.05` | Accel magnitude (post-`dtRatio`) that resets `stillnessTime` on **awake** bodies. |

**Enter sleep** (particle `updateDerivedProperties`): when `sleeping` is enabled, a dynamic body with both `speed` and `|ω|` below `sleepThreshold` increments `stillnessTime`; at `sleepDuration` it sets `RigidBody.sleeping = 1`. Tumbling sticks stay awake until spin dies.

**While asleep:** physics skips Verlet (snaps `px`/`py`, clears accel); mutual sleep pairs skip resolve. Spatial may still keep visual-only neighbors.

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

### Scene `physics` config: substeps vs distance iterations

- **`subStepCount`** — How many times per frame the worker runs **collision resolution** (and, when constraints are enabled, the distance-constraint block that follows it). In variable-FPS mode this is an outer loop after a single Verlet move. With **`noLimitFPS`** and a fixed accumulator, the same count defines how many fixed micro-steps run per nominal frame; each micro-step runs one collision resolve.
- **`distanceConstraintIterations`** — How many **full sweeps** over active distance constraints run **after each** collision pass in that loop (default `1`). Raise this for stiffer chains or rope-style setups without increasing collision work as much as raising `subStepCount`. Minimum `1`.

---

## Dense collider list (`buildDenseColliders`)

**Problem:** With fixed substeps, collision resolution can run many times per frame. Iterating _every_ entity that has a `Collider` but **zero** collision candidates wastes work in the inner loop.

**Approach:** Once per physics frame, the worker builds a **dense list** of entity indices:

- Source: active entities with `Collider` (query cache).
- Filter: collider active **and** `neighborData[i * stride + 1] > 0` (collision candidate count > 0).
- Storage: reusable `Uint16Array` (`_denseColliders`), grown only when the collider count exceeds the current buffer (minimum capacity 1024).

Substep collision loops iterate **`denseCount`** entries only, not the full collider query length.

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

## Distance constraints

Constraints live in a **SharedArrayBuffer** pool (`Constraint`), shared with the main thread and workers. Packed pair: `(entityA << 16) | entityB`.

### Dense active list

**Problem:** Solving constraints by scanning `0 .. maxConstraints` every substep scales with pool size, not live constraint count.

**Approach:** A **dense index list** mirrors active constraints:

- `activeIndices[slot]` — constraint pool index at dense slot `slot`.
- `activeIndexPositions[idx]` — reverse map for O(1) removal.
- `activeCount` — number of active entries (Atomics + spin lock on add/remove).

The physics solver iterates `denseIdx = 0 .. activeCount-1` and skips entries if `active[idx]` was cleared.

**Thread safety:** Pool allocation uses the existing atomic free list; maintaining the dense list uses a **short spin lock** (`SharedAtomicPool.acquireSpinLock` / `releaseSpinLock`) on add/remove. Add/remove is expected to be **rare** compared to solving.

**Memory:** Extra SAB bytes scale with `maxConstraints` (two `Uint16` tables plus small meta). See `Constraint.getBufferSize`.

### Solver notes

- Squared distance is compared to a small epsilon before `sqrt` to avoid useless work and division by zero.
- Normal uses `1 / currentDist` once instead of dividing each component.
- Static / missing rigidbody handling skips pairs with zero total inverse mass.

---

## GC and allocations (physics worker)

- **Reused** `collisionResult` object for collision tests (no per-contact object allocation in the hot path).
- **Reused** `_denseColliders` buffer; allocation only on growth.
- Constraint solving uses typed arrays only; no per-constraint heap objects in the solve loop.

---

## Worker stats

Written to `physicsStats` via indices in `src/workers/workers-utils.js` (`PHYSICS_STATS`):

| Key                   | Meaning                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| FPS                   | Instantaneous FPS slot (via frame timing)                                   |
| `COLLISION_CHECKS`    | Collision tests performed                                                   |
| `COLLISIONS_RESOLVED` | Resolutions applied                                                         |
| `COLLISION_PAIRS`     | Pairs considered                                                            |
| `CONSTRAINT_MS`       | Time spent in distance constraint solving this frame (ms)                   |
| `MSG_MS`              | Time spent handling incoming messages this frame (ms); see `AbstractWorker` |

Other workers expose `MSG_MS` similarly for comparable overhead profiling.

---

## Config assumptions

- **`settings.gravity.x` / `y`** are expected to be real numbers. Avoid leaving them `undefined` if your scene merges partial config; missing values can propagate **NaN** into integration.

---

## AbstractWorker message queue (shared concern)

All workers extend `AbstractWorker`. Incoming `onmessage` uses an **array queue** drained synchronously (with `await` inside handlers preserved), instead of chaining a new `Promise` per message. That reduces **microtask / Promise churn** under bursty messaging.

Inter-worker `handleWorkerMessage` attaches `_fromWorker` **in place** on object payloads when possible, avoiding `{ ...data }` copies.

See `src/workers/AbstractWorker.js`.
