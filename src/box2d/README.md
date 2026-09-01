# Weed Box2D runtime (`src/box2d`)

Classic physics worker for **Box2D 3.0 WASM** (pthread + SharedArrayBuffer). Scene’s `workers.physics` **is** [`box2d_wasm.js`](box2d_wasm.js), which loads [`weedjs_post.js`](weedjs_post.js) then [`physics_host.impl.js`](physics_host.impl.js). Host speaks Weed `init`/`start` and calls `weedjsDoStep` in-process.

## Layout

| File | Role |
|------|------|
| `box2d_wasm.js` / `.wasm` | Emscripten glue + binary |
| `physics_host.impl.js` | Weed protocol + frame loop + `weedjsDoStep` |
| `weedjs_post.js` | World create/destroy, sync, command ring drain, step |
| `physics-api.js` | `PhysicsWorld` / `BodyHandle` over `cwrap` |
| `box2dConstants.impl.js` + `box2dConstants.js` | Dual-load enums / state channels |
| `box2dCommandRing.impl.js` + `box2dCommandRing.js` | Pose / vel / fixedRotation / LiquidFun create commands |
| `box2dQueryAabb.impl.js` + `box2dQueryAabb.js` | Single-flight gameplay QueryAABB SAB |
| `liquidFunQuery.impl.js` + `liquidFunQuery.js` | Single-flight LiquidFun QueryAABB / RayCast SAB |
| `box2dContactRing.impl.js` + `box2dContactRing.js` | Contact/sensor event ring |
| `box2dHotFields.js` | Bind Transform/RigidBody hot views onto WASM HEAP |

## Dist / npm bundle

`npm run make_bundle` emits **both** debug and prod single-file artifacts into `dist/`:

| Artifact | Notes |
|----------|--------|
| `weed.bundle.min.js` / `.esm.min.js` | Debug UI kept |
| `weed.prod.bundle.min.js` / `.esm.min.js` | Debug stubs |

At runtime `getBox2dWorkerUrl()` creates one blob URL; that blob **is** the physics worker. Pthreads re-fetch the same worker URL via `_scriptName`.

## Rebuild from sibling Box2D tree

From `Box2d_3.2_C_-_liquidfun`:

```bat
weedjs\build_for_weed.bat
```

Default: **4 pthreads + `-flto=full`** (`weedjs\build_for_weed.bat` / `weedjs\build_for_weed.bat 4 full`). Use `4 1` for plain `-flto`. Builds with `weedjs/weed_post.js` (`importScripts('weedjs_post.js')` then `physics_host.impl.js`), runs a post-link `wasm-opt` size pass (threads + SIMD features enabled), and copies `box2d_wasm.js` + `.wasm` into this folder.

Fluids: `liquidfun-c` is compiled into this WASM. Integration and SAB rules: [`docs/LIQUIDFUN.md`](../../docs/LIQUIDFUN.md).
