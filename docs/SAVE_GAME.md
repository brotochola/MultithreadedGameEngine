# Save Game (sparse serializable entities)

WeedJS saves **active, opt-in entities** plus tiny globals (camera / sun). It does **not** dump whole entity SharedArrayBuffer pools, decorations, CPU particles, bullets, or the Box2D WASM heap. Camera, sun, joints, LiquidFun, and sparse DECALS tiles are included.

## Opt-in

Mark entity classes that should persist:

```javascript
export class MySoldier extends Person {
  static serializable = true;
  // ...
}
```

Trees, rocks, and other static props omit the flag. Decorations are never saved as entities.

An entity is included in a save only if:

1. Its class (or an ancestor) has `static serializable === true`
2. It is active (`Transform.active[i] === 1` / type active list)

Per entity, the snapshot packs SoA component fields (plus Transform pose and RigidBody velocity/sleeping from Box2D HEAP views). JS-only FSM locals that are not in an `ARRAY_SCHEMA` are not saved.

## Scene lifecycle (new game vs load)

```text
preload()
create()                 // always â?? static world
â??â?? createNewGame()       // new game only
â??â?? restore (await restoreSaveComplete) + onLoadGame  // save load only
startMainLoop / workers  // only after restore ack â?? workers stay paused until then
```

| Hook | When | Put here |
|------|------|----------|
| `preload()` | Always | Tilemap, camera prep, nav |
| `create()` | Always | Static world (lights, trash, trees, grass, â?¦) |
| `createNewGame()` | No save restore | Serializable / dynamic spawns (soldiers, civilians, player) |
| `onLoadGame(payload)` | After save applied | Load-only logic (UI, quests). Payload already restored entities + camera/sun |

Base `Scene` defaults: empty `createNewGame()` / `onLoadGame()`.

Load awaits logic0 `restoreSaveComplete` (entities spawned + active lists flushed) before `onLoadGame` and before play starts.

**PredatorScene example:** static setup stays in `create()`; `spawnCivilians` / `spawnMySoldiers` live in `createNewGame()`.

Do not gate spawns with `if (!this._restorePayload)` inside `create()`.

## Module layout

Save code lives under `src/core/save/`:

- `SaveGame.js` ? orchestrate save/load
- `SaveStore.js` ? IndexedDB + catalog
- `entitySaveSnapshot.js` ? entity SoA pack/unpack
- `liquidFunSave.js` ? LiquidFun snapshot helpers
- `decalSave.js` ? sparse DECALS tile pack/unpack

## Storage

| Layer | Role |
|-------|------|
| IndexedDB (`weed-saves`) | Compressed save blobs |
| `localStorage` (`weed.save.catalog`) | Slot metadata only (`id`, `scene`, `savedAt`, `bytes`, `engineVersion`, `entityCount`) |

Encode: JSON payload after a `WEEDSAVE1` header, then `deflate` (`CompressionStream` in browser; `zlib` in Node tests).

Helpers: `SaveStore.put/get/list/listForScene/remove`, `downloadSave`, `parseUploadedFile`.

## API

```javascript
// From a running scene
await scene.saveGame();           // auto slot id
await scene.saveGame('slot1');
await scene.loadGame('slot1');    // remounts scene with restore

// Engine
await game.loadScene(MyScene);                           // new game
await game.loadScene(MyScene, { restoreSlot: 'slot1' });
await game.loadScene(MyScene, { restorePayload: payload });

// Module / WEED.SaveGame
import { saveGame, loadGame, SaveStore, encodeSave, decodeSave } from '/src/index.js';
```

Load remounts the scene: `create()` builds statics, then logic worker `restoreSave` despawns serializable types and re-spawns from records (Box2D bodies via normal spawn dirty path), flushes active lists, acks `restoreSaveComplete`, then `onLoadGame(payload)`, then play starts.

## Debug UI

Debug overlay â?? **Saves** tab:

- **Save** â?? new slot for the current scene
- **Load** â?? selected row (remount + restore)
- **Ã?** on each row â?? delete that slot (`SaveStore.remove`)
- **List** â?? slots filtered to `scene.constructor.name`

## Joints + LiquidFun + Decals

Payload keys (format version 2):

- `entities[]` — each record includes `entityIndex` (pre-restore free-list index) for joint remapping
- `joints[]` — full SoA dump via `Joint.serializeActive()`, recreated after entity spawn
- `liquidFun` — optional packed snapshot from the physics worker (`restore_particles` + `restore_particle_groups_and_pairs`)
- `decals` — optional sparse DECALS tilemap (`tiles[]` with `fmt: 'png'|'raw'` + base64)

LiquidFun WASM source: `D:\\xampp\\htdocs\\Box2d_3.2_C_-_liquidfun` (`wasm_wrapper.c` + `lf_particle_system.c`). Rebuild with `weedjs\\build_for_weed.bat`.

## Limits (v2)

- **Joints:** active Weed joint pool is saved/restored (distance / revolute / weld) with entity-index remapping. Box2D contact manifold dump is still not saved.
- **LiquidFun:** particle pos/vel/flags, render tint/texture/scale/alpha, **plus** group slots, per-particle `groupIndex` / elastic `restOffset`, and spring/barrier pair graphs (jelly/elastic round-trips).
- **Decals:** sparse non-empty DECALS tiles (PNG in browser, raw RGBA in Node) under `payload.decals`; layout mismatch skips restore
- No decoration / CPU particle / bullet dumps
- Schema fingerprint mismatch â?? warn / fail; no automatic migration
- Cross-scene load rejected (`payload.sceneName` must match)
- Save format version is `2` (`SAVE_FORMAT_VERSION`); older blobs are rejected
