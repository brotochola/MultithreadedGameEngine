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
| `box2dContactRing.impl.js` + `box2dContactRing.js` | Contact/sensor event ring |
| `box2dHotFields.js` | Rebind Transform/RigidBody SoA onto WASM HEAP |

## Dist / npm bundle

`npm run make_bundle` embeds glue + `.wasm` (base64) + the classic `importScripts` siblings into `WEED.Box2dWorkerSource` inside `weed.bundle*.min.js`. At runtime `WEED.getBox2dWorkerUrl()` creates one blob URL; physics receives it as `box2dWorkerUrl`. Do **not** ship a separate `dist/box2d/` folder or blob-inline only the glue — pthreads re-fetch the same worker URL via `_scriptName`.

Unbundled demos still load `/src/box2d/box2d_wasm.js` from the repo server.

## Rebuild (from sibling `box2d_3.0_wasm_sab`)

```bat
cd ..\box2d_3.0_wasm_sab
build_for_weed.bat
```

That builds with `weed_post.js` (`importScripts('weedjs_post.js')`, not the lab `physics_post.js` / `game-constants.js`) and copies `box2d_wasm.js` + `.wasm` into this folder.

- `build_for_weed.bat clean` — wipe `build_wasm_weed`
- `build_for_weed.bat copy` — copy root artifacts only
- Override dest: `set WEED_BOX2D_DIR=...\src\box2d`

Lab demo stays on `build_wasm.bat` (physics_post.js). Do not copy a plain lab build into Weed — it will try to load missing `game-constants.js`.

Units: px, px/s, px/s², rad, rad/s.
