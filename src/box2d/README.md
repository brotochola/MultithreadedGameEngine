# Weed Box2D runtime (`src/box2d`)

Nested classic worker for **Box2D 3.0 WASM** (pthread + SharedArrayBuffer). Weed’s ESM [`physics_worker.js`](../workers/physics_worker.js) cannot host Module/pthreads; it nests `box2d_wasm.js`, which loads [`weedjs_post.js`](weedjs_post.js).

## Layout

| File | Role |
|------|------|
| `box2d_wasm.js` / `.wasm` | Emscripten glue + binary |
| `weedjs_post.js` | Weed bridge (Atomics step, create/destroy, command ring drain) |
| `physics-api.js` | `PhysicsWorld` / `BodyHandle` over `cwrap` |
| `box2dConstants.impl.js` + `box2dConstants.js` | Dual-load enums / state channels |
| `box2dCommandRing.impl.js` + `box2dCommandRing.js` | Pose / vel / fixedRotation commands |
| `box2dHotFields.js` | Rebind Transform/RigidBody SoA onto WASM HEAP |

## Rebuild

Build in sibling `box2d_3.0_wasm_sab` repo, copy `box2d_wasm.js` + `.wasm` here, then ensure dispatcher always `importScripts('weedjs_post.js')` (strip any baked lab `--post-js`).

Units: px, px/s, px/s², rad, rad/s.
