# Box2D 3.0 WASM + SharedArrayBuffer Workers

Browser demo and integration layer for **Box2D 3.0** compiled to WebAssembly with **pthread + SIMD**, running physics in a dedicated worker and rendering from a **zero-copy SharedArrayBuffer** view of body state.

Game logic is intended to run in the **physics worker** alongside the simulation. The main thread only boots workers and shows FPS.

## Quick start

### 1. Build WASM (Windows)

```bat
build_wasm.bat
```

Shortcut: `build.bat` (same thing).

First-time or after CMake changes:

```bat
build_wasm.bat clean
build_wasm.bat
```

Linux/macOS (with global `emcc`):

```bash
./build_wasm.sh
```

Outputs in project root:

- `box2d_wasm.js`
- `box2d_wasm.wasm`
- `box2d_wasm.worker.js` (pthread pool)

The repo includes a local **`emsdk/`** tree; `build_wasm.bat` activates it automatically. Optional portable **`tools/cmake`** and **`tools/ninja`** are picked up if present.

### 2. Run the demo

**SharedArrayBuffer requires cross-origin isolation.** Do not open `index.html` as a `file://` URL.

```bash
node node_server.js
```

Open `http://localhost:8000/` (server adds `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`).

Alternative: `npx mini-coi .` or any static server that sets the same COOP/COEP headers.

### 3. After C/WASM changes

Always rebuild and hard-refresh (or rely on `node_server.js` no-cache for `.js`). Stale `box2d_wasm.js` will break `bindBuffers` or query APIs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Main thread (index.html)                                       │
│  • Creates physics + render workers                             │
│  • Transfers OffscreenCanvas to render worker                   │
│  • Shows FPS from worker messages                               │
└───────────────┬─────────────────────────────┬───────────────────┘
                │ READY + SAB layout          │ OffscreenCanvas
                ▼                             ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│  physics.worker.js          │   │  render.worker.js             │
│  • Loads box2d_wasm.js      │   │  • Reads same SAB             │
│  • PhysicsWorld API         │   │  • Float32Array views on      │
│  • step(), queries, events  │   │    px, py, rot, meta, joints │
│  • Writes state in WASM     │   │  • requestAnimationFrame draw │
└───────────────┬───────────┘   └───────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  WASM heap (SharedArrayBuffer) — one buffer, many regions         │
│  state channels │ meta │ joints │ query │ events │ …              │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Box2D 3.0 (C) + wasm_wrapper.c                                │
│  • Simulation, broad-phase queries, contact/sensor events       │
│  • Slot-indexed export via state_export.c (solver hook)         │
└─────────────────────────────────────────────────────────────────┘
```

### Why three threads?

| Piece | Role |
|--------|------|
| **Main** | UI, worker orchestration, no physics |
| **Physics worker** | Owns `Module`, runs `b2World_Step`, spatial queries, reads contact/sensor buffers |
| **Render worker** | Reads body transforms from SAB only; never calls WASM |

Physics and render both attach **TypedArray views** to the same `SharedArrayBuffer` returned by `Module.HEAPF32.buffer`. No `postMessage` per body per frame.

### Slot index vs Box2D body id

The API uses integer **slots** (0 … N−1). Each created body stores its slot in `b2Body_SetUserData`. The solver exports transforms into state channels by **slot**, not Box2D internal body index—so destroy + recreate stays consistent.

---

## WASM memory layout

Allocated in `bind_game_buffers(maxBodies)` ([`box2d/src/wasm_wrapper.c`](box2d/src/wasm_wrapper.c)):

| Region | Type | Purpose |
|--------|------|---------|
| State channels (7) | `float` × `maxBodies` per channel | `px`, `py`, `rotC`, `rotS`, `vx`, `vy`, `angVel` |
| Meta | `float` × 4 per slot | shape type, half extents, flags |
| Joints | `float` × 8 per joint | type, flags, anchor frames |
| Query slots | `int32` × 512 | overlap query results (slot indices) |
| Query hits | `float` × 8 × 64 | ray/shape hit rows |
| Event header | `int32` × 8 | counts (overlap, ray, contact, sensor, mover) |
| Contact begin/end | `int32` × 2 × 256 | slot pairs |
| Contact hit | `float` × 8 × 128 | hit events |
| Sensor begin/end | `int32` × 2 × 256 | sensor pairs |
| Mover planes | `float` × 8 × 32 | character mover planes |

Caps are fixed at compile time (`MAX_BODIES` = 10000, etc.). `getReadyPayload()` and getters expose byte offsets for each region.

**Dynamic body state** is written during simulation from [`box2d/src/solver.c`](box2d/src/solver.c) via [`state_export.c`](box2d/src/state_export.c). Static bodies are not in the state channels; render uses hard-coded arena walls plus meta flags.

---

## JavaScript API

### Loading

Workers use:

```js
importScripts("box2d_wasm.js", "game-constants.js", "physics-api.js");
```

Then:

```js
Module.onRuntimeInitialized = () => {
  const { PhysicsWorld } = createPhysicsApi(Module);
  const world = new PhysicsWorld(0, -9.8);
  world.bindBuffers(BODY_COUNT); // must be ≤ getMaxBodySlots()
  // ...
};
```

### Creating bodies

```js
const box = world.createBox({
  x: 0, y: 10, hx: 0.5, hy: 0.25,
  type: BODY_TYPE.DYNAMIC,
  density: 1.0,
  isSensor: false,
  categoryBits: 1,
  maskBits: 0, // 0 = full mask (all categories)
});

box.applyForceCenter(0, -100);
box.setLinearVelocity(2, 0);
box.destroy(); // via handle.destroy()
```

`BodyHandle` also exposes impulses, torque, `setAwake`, `setFilter`, damping, etc.

### Joints

`createRevoluteJoint`, `createDistanceJoint`, `createPrismaticJoint`, `createWeldJoint` — see [`physics.worker.js`](physics.worker.js) demo spawn.

### Simulation

```js
world.step(dt, subSteps); // default subSteps = 2 in API
```

Call queries **between** steps (world locked during `step`).

### Spatial queries (zero-copy)

Overlap AABB writes slot indices into a caller **`out` Int32Array** on the WASM heap. Other overlap/ray methods still use internal buffers (`world._querySlots`, `world._queryHits`).

**Slot = body identity** — same integer as `BodyHandle.slot`, not a separate EntityId.

```js
// Reuse world buffer (no extra allocation)
const n = world.overlapAABB(x0, y0, x1, y1, world._querySlots);
for (let i = 0; i < n; i++) {
  const slot = world._querySlots[i];
}

// Or pooled buffer (Module._malloc on heap)
const pool = world.createOverlapBuffer();
const count = world.overlapAABB(x0, y0, x1, y1, pool.view);
// pool.view[0..count-1]; pool.free() when done
```

`out` must be an `Int32Array` view on `Module.HEAP32.buffer` (same SAB as `HEAPF32`). Standalone `new Int32Array(n)` will throw — use `world._querySlots` or `createOverlapBuffer()`.

Return value: count written (≤ `out.length`). Hits beyond capacity are dropped.

```js
const hit = world.castRayClosest(ox, oy, dx, dy); // 0 or 1
if (hit) {
  const fraction = world._queryHits[1];
}

world.overlapCircle(cx, cy, radius);
world.overlapBox(cx, cy, hx, hy, angle);
world.castRayAll(ox, oy, dx, dy);
world.castMover(cx, cy, halfHeight, radius, dx, dy);
world.collideMover(cx, cy, halfHeight, radius);
```

Optional filter (last arg on overlap AABB): `{ categoryBits: 1, maskBits: 0 }`.

Do not use `.slice()` on views in hot paths—it allocates. Last query wins on shared internal buffers.

### Events (after `step`)

```js
world.step(dt);

const h = world._eventHeader;
const beginCount = h[EVENT_HEADER.CONTACT_BEGIN_COUNT];
for (let i = 0; i < beginCount; i++) {
  const slotA = world._contactBegin[i * 2];
  const slotB = world._contactBegin[i * 2 + 1];
}
```

Same pattern for `_contactEnd`, `_contactHit`, `_sensorBegin`, `_sensorEnd`.

---

## Project layout

| Path | Description |
|------|-------------|
| [`index.html`](index.html) | Main page, worker bootstrap |
| [`physics.worker.js`](physics.worker.js) | Physics loop, spawn demo, query self-check |
| [`render.worker.js`](render.worker.js) | Canvas2D render from SAB |
| [`physics-api.js`](physics-api.js) | Ergonomic `PhysicsWorld` / `BodyHandle` over `cwrap` |
| [`game-constants.js`](game-constants.js) | Shared enums and buffer layout indices |
| [`box2d/`](box2d/) | Box2D 3.0 source (submodule/tree) |
| [`box2d/src/wasm_wrapper.c`](box2d/src/wasm_wrapper.c) | Emscripten exports, buffers, queries |
| [`box2d/src/state_export.c`](box2d/src/state_export.c) | Slot-indexed state channel writer |
| [`wasm/CMakeLists.txt`](wasm/CMakeLists.txt) | Emscripten build (pthread, SIMD, 128MB heap) |
| [`build_wasm.bat`](build_wasm.bat) | Windows build script |
| [`node_server.js`](node_server.js) | Dev server with COOP/COEP |

---

## Build configuration

Key Emscripten flags ([`wasm/CMakeLists.txt`](wasm/CMakeLists.txt)):

- `-pthread` + `SHARED_MEMORY` — shared heap across workers
- `-msimd128` — SIMD
- `INITIAL_MEMORY=128MB` — fixed heap (no growth)
- `PTHREAD_POOL_SIZE=4` — matches Box2D `workerCount` in wrapper

Changing `MAX_BODIES` or buffer caps requires editing [`wasm_wrapper.c`](box2d/src/wasm_wrapper.c) and rebuilding.

---

## Demo tuning

In [`physics.worker.js`](physics.worker.js):

- `BODY_COUNT` — bind capacity (must be ≤ 10000)
- `SUBSTEPS`, `MAX_DT` — stability vs performance
- `UI_BOX_HX` / `UI_CIRCLE_R` — default sizes for debug UI creates

Render world bounds and arena walls are in [`render.worker.js`](render.worker.js) and [`world-bounds.js`](world-bounds.js).

---

## Debug UI

[`index.html`](index.html) includes a sidebar + overlay for interactive testing:

- **Add box / circle** — click canvas overlay; main posts `CREATE_BOX` / `CREATE_CIRCLE` to the physics worker.
- **Ray cast** — drag on overlay; main posts `CAST_RAY`; physics replies with `RAY_RESULT`; main forwards `RAY_OVERLAY` to the render worker (yellow ray, red hit + normal).
- **Clear scene** — destroys all bodies except arena walls (slots 0–2) and joints.

Boot loads **arena only** (no mass spawn). Pointer mapping uses `screenToWorld` from [`world-bounds.js`](world-bounds.js).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `crossOriginIsolated is false` | Serve with COOP/COEP (`node_server.js`) |
| `bindBuffers failed` | Rebuild WASM; ensure `BODY_COUNT ≤ getMaxBodySlots()` |
| Query / create APIs missing | Stale `box2d_wasm.js` — run `build_wasm.bat` |
| Physics worker throws on overlap self-check | Bodies not spawned or WASM not rebuilt |
| Render frozen, physics OK | Check meta `DISABLED` flag on slots; state export only for dynamic bodies in sim |

---

## Design notes

- **Queries** use Box2D’s dynamic tree broad-phase (`OverlapAABB`, `OverlapShape`, `CastRay`, `CastMover`, `CollideMover`).
- **OverlapAABB** is fast but conservative (AABB vs AABB). Use `overlapCircle` / `overlapBox` for accurate picks.
- **Contact/sensor events** are copied out of Box2D’s transient buffers inside `step_world` into owned WASM regions, then read from JS via SAB.
- **No main-thread physics API** by design; extend with worker messages if you need queries from the UI thread later.
