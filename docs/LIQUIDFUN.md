# LiquidFun on Box2D 3 (C) + Weed SAB

Weed fluids are **not** Google LiquidFun C++ pasted into Box2D. They are **`liquidfun-c`**: a from-scratch C17 sidecar on Box2D 3.x’s public C API, compiled into the same WASM as rigid bodies, then driven from JS with a command ring and SharedArrayBuffer views. No GC on the step path.

Sibling source of truth: `d:\xampp\htdocs\box2d_3.0_wasm_sab` (`box2d+liquidfun/`, `box2d/src/wasm_wrapper.c`). Rebuild copies artifacts into [`src/box2d/`](../src/box2d/).

Related: [Physics pipeline](./PHYSICS.md), [CPU particles](./PARTICLES.md), [Workers](./WORKERS_ARCHITECTURE.md), [Memory](./MEMORY_STRUCTURE.md), [`src/box2d/README.md`](../src/box2d/README.md).

---

## What this is

Google LiquidFun (Box2D 2.x) already treated particles as a **module after the rigid step**: `QueryAABB` + fixture distance, then `ApplyLinearImpulse` back onto bodies. It was never inside the contact graph.

Box2D 3 (Erin Catto C, this fork) has opaque ids, SoA buffers, and no hook to invent a new body type. So the port is an external system:

| Piece | Lives in | Role |
|--------|----------|------|
| `lf_particle_system.c` | sibling `box2d+liquidfun/` | Grid, contacts, pressure, groups, body coupling |
| `wasm_wrapper.c` | sibling `box2d/src/` | `EMSCRIPTEN_KEEPALIVE` exports + global `g_particles` |
| `physics-api.js` | this repo | `cwrap` + center+half → WASM AABB |
| `box2dCommandRing` | this repo | Main/logic → physics worker (no `postMessage` blobs) |
| `weedjs_post.js` | this repo | Drain ring, `world.step`, copy HEAP → thin LiquidFun render SAB |
| `LiquidFunSystem` | this repo | Scene-facing API |

One world. Particles and fixtures share **the same world floats**. `b2SetLengthUnitsPerMeter` only tunes Box2D thresholds; it does **not** rescale particles vs bodies.

Weed default: pixels as units (`lengthUnitsPerMeter: 100`, gravity `{x:0,y:980}`). Native sibling demos use meters (`radius ≈ 0.05`, gravity `-10`). Both work if radius, positions, and gravity use one unit system.

---

## Runtime flow

```
Scene.config.physics.liquidFun.enabled
  handleInit → createParticleSystem once

Scene.create
  emitLiquidFunParticles (few long-lived materials)
    ring CMD 13 SET_LIQUIDFUN_EMIT   // spacing, strength, tint, textureId
    ring CMD 9 / 10 CREATE           // next create consumes emit params
  Floor / RigidBody spawn            → body dirty → syncBodies

physics worker (box2d_wasm.js + weedjs_post + physics_host)
  syncBodies
  drainCommands          // create system / emit / groups (rare)
  world.step(dt)
    b2World_Step
    lfParticleSystem_Step   // if g_particles
  afterStep
    syncLiquidFunParticlesToSharedBuffers   // HEAPF32 pos → LiquidFun render SAB x/y

particle_worker   // CPU ParticleComponent only
pre_render_worker // CPU queue + LiquidFun SAB → same pixi batch
pixi_worker
```

`step_world` always steps particles when the system exists. No extra JS flag enables fixture contact.

`physics.liquidFun` (merged in both `validatePhysicsConfig` copies):

```javascript
liquidFun: { enabled: false, radius: 10, maxCount: 10000, subSteps: 1, density: 1 }
```

Scene sets `enabled: true` to auto-create the system at physics init. Do not also call `LiquidFunSystem.createSystem` from `create()` (destroys the previous system).

---

## WASM ABI (do not invent extra args)

| Export | Signature | Notes |
|--------|-----------|--------|
| `create_particle_system` | `(worldPacked, radius, density, maxParticles) → 0\|1` | `growable=false`; destroys any previous system |
| `create_particle_group_box` | `(x0,y0,x1,y1, spacing, flags, strength) → groupId` | **AABB corners**. `-1` = fail |
| `create_particle_group_circle` | `(cx,cy,radius, spacing, flags, strength) → groupId` | `spacing<=0` → 0.75 × diameter |
| `create_particle_box` | `(x0,y0,x1,y1, spacing, flags) → count` | Ungrouped fill |
| `destroy_particle_group` / `destroy_particle_system` | | |
| `set_particle_sub_steps` | `(n)` | Independent of Box2D `subStepCount` |
| `get_particle_count` / `capacity` / `radius` | | |
| `get_particle_*_byte_offset` | count / pos / vel / flags | Stable HEAP pointers (`growable=false`) |

Group id **0 is valid**. `-1` is `LF_NULL_PARTICLE_GROUP` (no system, inverted AABB, or capacity full).

JS scene API stays **center + half extents** (same as Weed boxes). Conversion to AABB happens once in [`physics-api.js`](../src/box2d/physics-api.js), not in the ring and not per particle.

---

## Flags

Match sibling `lfParticleFlag` only. Google listener / color-mixing bits do nothing here.

| `LIQUIDFUN_FLAGS` | Value | C |
|-------------------|------:|---|
| `WATER` | 0 | default fluid |
| `ZOMBIE` | 1<<0 | deferred delete |
| `WALL` | 1<<1 | infinite mass |
| `VISCOUS` | 1<<2 | extra tangential damping |
| `TENSILE` | 1<<3 | surface pull |
| `ELASTIC` | 1<<4 | group shape-match |
| `POWDER` | 1<<5 | granular extra repulsion |
| `SPRING` | 1<<6 | rest-length pairs at create |
| `BARRIER` | 1<<7 | with `WALL`: zero vel; neighbor pairs form a segment dam (`SolveBarrier`) |
| `STATIC_PRESSURE` | 1<<8 | extra Poisson pressure so fluid does not vanish in a crack |

Existing bits are **not** Google’s `b2ParticleFlag` layout (Google’s barrier is `1<<10`). New flags are appended only. Do not remap WATER…SPRING.

Body collision is **not** a flag. Water particles hit fixtures by default.

Engine cap: `physics.liquidFun.maxCount` is clamped to **65535** (uint16 indices, empty sentinel `0xFFFF`, live `0..65534`). WASM `create_particle_system` already rejects a larger cap.

Skipped on purpose: NEON/SIMD, color mixing, fixture/particle contact filters.

Material presets (`LIQUIDFUN_MATERIALS`) — flags we actually have:

| material | flags | strength | typical tint |
|----------|--------|----------|----------------|
| `water` | WATER \| TENSILE | 0 | `0x3399ff` |
| `oil` | VISCOUS | 0 | brown |
| `cream` | VISCOUS \| TENSILE | 0.2 | off-white |
| `dulceDeLeche` | VISCOUS \| TENSILE | 0.4 | caramel |
| `jelly` | ELASTIC | 0.55 | green |
| `sand` | POWDER | 0 | gold |

A **group** is only required for elastic/spring (shape-match). Water/oil/cream/powder append ungrouped. What is slow: a new group every mouse splash — `UpdateGroupStatistics` then walks every particle for every live group. Showcase: one emit per material at `create()`, click appends water only.

---

## Body collision (C)

LiquidFun `Solve` order (algorithm port, zlib notice — not pasted C++). Box2D 3 has no `ComputeDistance`; closest-point + `TestPoint` + `b2Shape_RayCast` stand in. Particles are **points** vs fixtures (1.1.0): sprites may sit with centers on the fixture.

Each particle **sub-step** (default `subSteps=1`):

1. `BuildGrid` (hash sized from **live count**, not `maxParticles`) + `FindParticleContacts`.
2. `FindBodyContacts` — one `OverlapAABB`, then `GetClosestPoint` + `TestPoint`. Signed distance: `weight = 1 - d/diameter` (**can be > 1** inside). `contact.normal = -n` (particle toward body). Reduced `mass = 1/invMassSum`. **No axis-snap.**
3. `RemoveSpuriousBodyContacts` only if `strictContactCheck` (default **false**). Sort by index then weight; keep ≤3; project along the inverse normal; drop if that probe is not on/in the fixture.
4. Flagged: `SolveViscous`, `SolvePowder`, `SolveTensile` (two-pass `accumulation2`).
5. `SolveGravity`. If `STATIC_PRESSURE`, `SolveStaticPressure` (Poisson; Google defaults: strength **0.2**, relaxation 0.2, 8 iters; `pressurePerWeight = strength * density * (diameter/dt)²`). `SolvePressure` **one** accumulate + apply using **critical pressure** `density * (diameter/dt)²` (no `|g|/10`, no pressure-iteration loop, no PBD). `SolveDamping` (linear + quadratic `1/criticalVelocity`) on body then particle contacts.
6. Elastic / spring **late** (after damping; they read current velocities). `LimitVelocity` at `|v| <= diameter/dt`. If `BARRIER`, `SolveBarrier` (`tmax = 2.5 * dt`).
7. **`SolveCollision`** — swept-cloud AABB, one `OverlapAABB`, `b2Shape_RayCast(shape, p, dt*v)`. Point particle. `target = lerp(p1,p2,fraction) + B2_LINEAR_SLOP * n` (Weed 100 px/m → 0.5 px). `v = inv_dt * (target - p)`. **No radius offset. Do not write position.** Do **not** `b2World_CastShape` per particle.
8. `SolveWall` zeros wall flags. Integrate `position += dt * velocity`. No PBD after.

A lone particle on a static floor can rest (body-contact damping). Neighbor pairs with `SPRING` and/or `BARRIER` are captured at box/circle create (distance < 1.5×diameter). `SolveSpring` ignores barrier-only pairs.

Create spacing `0` → **0.75 × diameter** (Google `b2_particleStride`). Discrete only: a particle that tunnels a thin shape in one sub-step is gone (sibling ROADMAP Fase 4).

Skipped on purpose: NEON, colorMixing, repulsive, solid/rigid groups, fixture contact filter.

`lfParticleSystem_Step` cannot run in parallel with `b2World_Step` (world locked; queries invalid). Overlay `Box2d` ms stays `step_world`. In-step parallel_for is a later lever (sibling ROADMAP Fase 6).

---

## Two particle types — mix only at render

| | Weed CPU | LiquidFun |
|--|----------|-----------|
| Create | `ParticleEmitter.emit` / pool | ring `SET_LIQUIDFUN_EMIT` + create → WASM HEAP |
| Simulate | `particle_worker` + `ParticleComponent` | `lfParticleSystem_Step` inside `step_world` only |
| Store | `ParticleComponent` SAB | WASM pos/vel/flags + **thin render SAB** |
| Render | pre_render collect | pre_render collect | same pixi particle batch |

Thin render SAB size is `physics.liquidFun.maxCount`, not `particle.maxParticles`. Fields: `x, y, scaleX, scaleY, rotC, rotS, alpha, tint, textureId`. No vx/vy/gravity/lifespan/z/flat/floor.

`particle.maxParticles` = CPU pool only (demo sets `0` so the CPU worker does not scan an empty 10k pool). `physics.liquidFun.maxCount` = fluids.

## JS / SAB integration (hot path rules)

**Create (cold):** `LiquidFunSystem` / `ParticleEmitter.emitLiquidFunParticles` enqueue 8-byte-stride ring slots. Never `_spawn` / never the CPU free list. No WASM from the main thread. Physics worker drains once per step before `world.step`.

**Step (hot, physics worker):**

- `syncBodies` + `drainCommands` + `world.step` — no `new`, no `postMessage` of positions.
- Particle SoA lives in WASM HEAP (`growable=false` so TypedArray views stay valid).
- `syncLiquidFunParticlesToSharedBuffers` copies HEAP pos → render SAB `x/y` only. Tint/texture/scale painted on new slots of **that** SAB. Cached pos byte offset.

**Render (hot, other workers):** `particle_worker` scans the CPU pool only. `pre_render_worker` collects CPU visibles then LiquidFun from the render SAB (same camera cull) into the same queue. Pixi unchanged (`rqType=1`).

Do **not**:

- Bind `ParticleComponent` as LiquidFun `particleViews`.
- Allocate objects / arrays inside `syncLiquidFunParticlesToSharedBuffers` or the particle_worker scan.
- `JSON` or structured-clone particle buffers across workers.
- Recreate the particle system every emit (`create_particle_system` destroys the previous one).
- Treat group id `0` as failure.
- Pass center+half as WASM `x0,y0,x1,y1` (inverted AABB → `-1`).
- Mix meter-scale radii (`0.05`) with pixel bodies (`y=2200`).
- Run JS body-collision for fluids.

Command ring is singleton today (`g_particles`). `systemId` is reserved; box groups stash **flags** in the ring entity slot.

Opcode `SET_LIQUIDFUN_EMIT` (13) is four floats: `spacing, strength, tintBits, textureId`. The **next** create consumes them (cold). After create, tint/textureId/scale are painted on LiquidFun render slots `[oldCount, newCount)`.

---

## Scene API

```javascript
// Scene.config.physics
liquidFun: { enabled: true, radius: 10, maxCount: 10000, subSteps: 1 }

ParticleEmitter.emitLiquidFunParticles({
  material: 'water', // or flags + strength yourself
  shape: 'circle',
  posX, posY, radius: 30,
  texture: '_whiteCircle',
  tint: 0x00e5ff, // overrides preset
  spacing: 0,     // 0 → C rest stride
});
```

Demo: [`demos/liquidFunDemoScene/liquidFunDemoScene.js`](../demos/liquidFunDemoScene/liquidFunDemoScene.js) — one emit per preset at `create()`, click appends ungrouped water.

`radius` is the **particle** radius (world units), not the group radius. Group `radius` / `halfWidth` is the fill shape. Spacing `0` → pack at **0.75 × diameter** (Google particle stride).

Pressure uses **critical pressure** `density * (diameter / dt)²`, not `|gravity|/10`. That is large in Weed pixels on purpose (replaces PBD). Sprites may look half-in the floor: 1.1.0 point rest.

10k @ 60 is the goal after the step cuts, not a guarantee on a weak CPU. Next lever if still over: slightly larger particle radius (fewer particles for the same puddle) — not extra substeps to hide tunneling.

---

## Rebuild

From `box2d_3.0_wasm_sab`:

```bat
build_for_weed.bat
```

Copies `box2d_wasm.js` + `.wasm` into `src/box2d/`. Do not copy a plain `build_wasm.bat` output (lab `game-constants.js` / missing `weedjs_post.js`).

After C changes, engine tests:

```bat
node --test tests/node/liquidfun.test.js tests/node/liquidfun.wasm.test.js
```

---

## Tests

| File | What |
|------|------|
| [`tests/node/liquidfun.test.js`](../tests/node/liquidfun.test.js) | Flags (including BARRIER / STATIC_PRESSURE), materials, AABB, `SET_LIQUIDFUN_EMIT` ring, `physics.liquidFun` merge + maxCount clamp 65535 |
| [`tests/node/liquidfun.wasm.test.js`](../tests/node/liquidfun.wasm.test.js) | Y-down floor settle + `spanY`; no wall-climb **and** no centers inside the wall; water beside a thick box (`maxPen < radius`); 10k create/step smoke; **1-particle point rest** on floor top (`|vy|` small); barrier smoke; staticPressure finite |
