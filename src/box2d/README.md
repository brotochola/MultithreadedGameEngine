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

`npm run make_bundle` emits **both** debug and prod single-file artifacts into `dist/`:

| File | Contents |
|------|----------|
| `weed.bundle.min.js` / `.esm.min.js` | Debug UI kept |
| `weed.prod.bundle.min.js` / `.esm.min.js` | Debug* stubbed out |

Embed pipeline:

1. Workers share one `worker_common` chunk (AbstractWorker graph) so that code is not copied six times.
2. Glue + siblings + **gzip-compressed** `.wasm` (base64) go into `WEED.Box2dWorkerSource`.
3. At runtime `getBox2dWorkerUrl()` creates one blob URL; `instantiateWasm` gunzips via `DecompressionStream` then instantiates. Pthreads re-fetch the same worker URL via `_scriptName`.

Do **not** ship a separate `dist/box2d/` folder or blob-inline only the glue.

Unbundled demos still load `/src/box2d/box2d_wasm.js` from the repo server.

## Rebuild (from sibling `box2d_3.0_wasm_sab`)

```bat
cd ..\box2d_3.0_wasm_sab
build_for_weed.bat
```

That builds with `weed_post.js` (`importScripts('weedjs_post.js')`, not the lab `physics_post.js` / `game-constants.js`), runs a post-link `wasm-opt` size pass (threads + SIMD features enabled), and copies `box2d_wasm.js` + `.wasm` into this folder.

- `build_for_weed.bat clean` — wipe `build_wasm_weed`
- `build_for_weed.bat copy` — copy root artifacts only
- Override dest: `set WEED_BOX2D_DIR=...\src\box2d`

Lab demo stays on `build_wasm.bat` (physics_post.js). Do not copy a plain lab build into Weed — it will try to load missing `game-constants.js`.

Units: px, px/s, px/s², rad, rad/s.
