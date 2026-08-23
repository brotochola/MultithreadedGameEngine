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
| `weedjs_post.js` | this repo | Drain ring, `world.step`, copy HEAP → `ParticleComponent` |
| `LiquidFunSystem` | this repo | Scene-facing API |

One world. Particles and fixtures share **the same world floats**. `b2SetLengthUnitsPerMeter` only tunes Box2D thresholds; it does **not** rescale particles vs bodies.

Weed default: pixels as units (`lengthUnitsPerMeter: 100`, gravity `{x:0,y:980}`). Native sibling demos use meters (`radius ≈ 0.05`, gravity `-10`). Both work if radius, positions, and gravity use one unit system.

---

## Runtime flow

```
Scene.create
  LiquidFunSystem.createSystem          → ring CMD 8
  Floor / RigidBody spawn               → body dirty → syncBodies
  ParticleEmitter.emitLiquidFunParticles → ring CMD 9 / 10

physics worker (box2d_wasm.js + weedjs_post + physics_host)
  syncBodies
  drainCommands          // create system / groups (rare)
  world.step(dt)
    b2World_Step
    lfParticleSystem_Step   // if g_particles
  afterStep
    syncLiquidFunParticlesToSharedBuffers   // HEAPF32 → ParticleComponent SoA

particle_worker   // scans active[]
pre_render_worker // textureId 0 → _whiteCircle
pixi_worker
```

`step_world` always steps particles when the system exists. No extra JS flag enables fixture contact.

---

## WASM ABI (do not invent extra args)

| Export | Signature | Notes |
|--------|-----------|--------|
| `create_particle_system` | `(worldPacked, radius, density, maxParticles) → 0\|1` | `growable=false`; destroys any previous system |
| `create_particle_group_box` | `(x0,y0,x1,y1, spacing, flags, strength) → groupId` | **AABB corners**. `-1` = fail |
| `create_particle_group_circle` | `(cx,cy,radius, spacing, flags, strength) → groupId` | `spacing<=0` → 0.85 × diameter |
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

Body collision is **not** a flag. Water particles hit fixtures by default.

---

## Body collision (C)

Each particle sub-step:

1. One `b2World_OverlapAABB` on the particle-cloud AABB (`b2Pos_zero` + world AABB).
2. Spatial hash (cell = diameter) to test nearby particles against those shapes.
3. `b2Shape_GetClosestPoint` + `b2Shape_TestPoint`.
4. Pressure (scaled by `|g|/10`) + powder/tensile; `b2Body_ApplyLinearImpulse` on dynamics.
5. After integrate: **depenetration** — if the center is inside or closer than `radius`, place `closest + radius * outwardNormal` and clip approaching velocity.

Outward normal matters. GJK closest-point points **inward** once the center is inside; a `{0,1}` fallback assumes Y-up. Weed is **Y-down**. Interior contacts invert the normal; collapsed distance falls back to **against gravity**.

Volume: after integrate, pairs closer than **rest spacing** (0.85×diameter) are projected apart (PBD, 5 iters, per-contact clamp 0.15×diameter) so water keeps spawn volume instead of crushing. Weak SPH pressure still runs (now ×`|g|/10` and 4 iters) but cannot hold Weed gravity alone. Depenetration stops centers entering fixtures. Discrete only: a particle that tunnels a thin shape in one sub-step is gone (sibling ROADMAP Fase 4).

---

## JS / SAB integration (hot path rules)

**Create (cold):** `LiquidFunSystem` / `ParticleEmitter.emitLiquidFunParticles` enqueue 8-byte-stride ring slots. No WASM from the main thread. Physics worker drains once per step before `world.step`.

**Step (hot, physics worker):**

- `syncBodies` + `drainCommands` + `world.step` — no `new`, no `postMessage` of positions.
- Particle SoA lives in WASM HEAP (`growable=false` so TypedArray views stay valid).
- `syncLiquidFunParticlesToSharedBuffers` copies `count` positions into existing `ParticleComponent` views (`x/y/active/flat`). Loop over typed arrays only.

**Render (hot, other workers):** same particle pool as CPU emitters. `flat=1` so integrate does not apply CPU gravity / lifespan despawn on LiquidFun slots (`lifespan` stays 0).

Do **not**:

- Allocate objects / arrays inside `syncLiquidFunParticlesToSharedBuffers` or the particle_worker scan.
- `JSON` or structured-clone particle buffers across workers.
- Recreate the particle system every emit (`create_particle_system` destroys the previous one).
- Treat group id `0` as failure.
- Pass center+half as WASM `x0,y0,x1,y1` (inverted AABB → `-1`).
- Mix meter-scale radii (`0.05`) with pixel bodies (`y=2200`).

Command ring is singleton today (`g_particles`). `systemId` is reserved; box groups stash **flags** in the ring entity slot.

---

## Scene API

```javascript
LiquidFunSystem.createSystem({ radius: 10, maxCount: 6000, subSteps: 2 });

ParticleEmitter.emitLiquidFunParticles({
  shape: 'circle',
  posX: 1600,
  posY: 400,
  radius: 90,
  flags: LIQUIDFUN_FLAGS.WATER,
});

ParticleEmitter.emitLiquidFunParticles({
  shape: 'box',
  posX: 2000,
  posY: 100,
  halfWidth: 60,
  halfHeight: 60,
  flags: LIQUIDFUN_FLAGS.POWDER,
});
```

Demo: [`demos/liquidFunDemoScene/liquidFunDemoScene.js`](../demos/liquidFunDemoScene/liquidFunDemoScene.js).

`radius` is the **particle** radius (world units), not the group radius. Group `radius` / `halfWidth` is the fill shape. Spacing `0` → pack at **0.85 × diameter**. That is the incompressible rest distance — same N particles occupy that area on the floor, not a crushed line.

Pressure / powder / tensile scale with `|gravity| / 10` inside `lfParticleSystem_Step`, so meter demos (`g≈10`) and Weed pixels (`g=980`) keep the same pile stiffness.

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
| [`tests/node/liquidfun.test.js`](../tests/node/liquidfun.test.js) | Flags, AABB orientation, command-ring enqueue |
| [`tests/node/liquidfun.wasm.test.js`](../tests/node/liquidfun.wasm.test.js) | WASM create + step: particles must not fall through a static box in a Y-down pixel world |
