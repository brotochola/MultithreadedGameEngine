# Particles

Particles are a dedicated pool (`ParticleComponent` + `ParticleEmitter`), not GameObjects. Any worker (or the main thread) can spawn; `particle_worker` owns simulation, visibility lists, and decal stamping; `pre_render_worker` maps pose for the render queue.

## Spawn API

Mode is chosen at the call site via `emit` / `emitZenithal` / `emitFlat`.

| Method | Physics | Screen mapping |
| --- | --- | --- |
| `ParticleEmitter.emit(config)` | Heighted: `z`, gravity, floor flags | `screenY = y + z` (topdown / iso) |
| `ParticleEmitter.emitZenithal(config)` | Same heighted physics | XY on floor plane; scale (+ optional alpha) from `-z` |
| `ParticleEmitter.emitFlat(config)` | No ground; always integrate XY | `screenY = y` (ignore `z`) |
| `ParticleEmitter.stampDecal(config)` | Instant floor stamp via heighted `emit` | Decal on tilemap |

Per-particle flags written at spawn:

- `ParticleComponent.flat` — `1` for `emitFlat`, else `0`
- `ParticleComponent.viewMode` — `CAMERA_TYPES.TOPDOWN` for `emit` / `emitFlat`, `CAMERA_TYPES.ZENITHAL` for `emitZenithal`

Mix modes freely in one scene (e.g. zenithal blood + flat sparks).

### Examples

```javascript
// Heighted blood (topdown / iso): height folds into screen Y
WEED.ParticleEmitter.emit({
  x: this.x,
  y: this.y,
  z: -20,
  texture: 'blood',
  count: 8,
  angleXY: { min: 0, max: 360 },
  speed: { min: 1, max: 4 },
  gravity: 0.4,
  stayOnTheFloor: true,
});

// Zenithal: same physics, height → scale (scene zenithal* knobs)
WEED.ParticleEmitter.emitZenithal({
  x: Mouse.x,
  y: Mouse.y,
  z: { min: -120, max: -40 },
  texture: 'blood',
  count: 12,
  angleXY: { min: 0, max: 360 },
  speed: { min: 1, max: 14 },
  gravity: 1,
  stayOnTheFloor: true,
});

// Flat platformer dust — no z:-1 hack, no ground despawn
WEED.ParticleEmitter.emitFlat({
  x: this.x,
  y: this.y,
  texture: '_whiteCircle',
  count: 3,
  angleXY: { min: -180, max: 180 },
  speed: { min: 1, max: 4 },
  lifespan: 300,
  tweenToAlpha0: true,
});
```

`emitFlat` forces `z: 0`, `vz: 0`, and defaults `gravity` to `0`. Floor flags (`despawnOnGroundContact`, `stayOnTheFloor`, `fadeOnTheFloor`) are cleared at spawn and ignored by the worker.

## Physics (`particle_worker`)

Convention: `z < 0` = airborne, `z >= 0` = on ground.

- **Flat:** integrate `x`/`y` every step; skip gravity, ground clamp, and floor flags. Death by lifespan (and optional `tweenToAlpha0`).
- **Heighted:** `vz += gravity`; while airborne integrate `x`/`y`/`z`; on ground zero velocity then:
  - `despawnOnGroundContact` → return to pool
  - `stayOnTheFloor` → queue decal stamp → return to pool
  - `fadeOnTheFloor` → fade alpha over time → return when alpha ≤ 0

Zenithal vs topdown does **not** change physics. Only `flat` vs heighted does. One active list is enough; do not split pools by `viewMode` for simulation.

## Rendering (`pre_render_worker`)

Reads per-particle `viewMode` / `flat`:

| Mode | `rqY` | Scale / alpha |
| --- | --- | --- |
| Zenithal (`viewMode === ZENITHAL`, not flat) | `y` | `scale *= 1 + (-z / zenithalMaxHeight) * zenithalScaleFactor`; optional alpha fade |
| Flat | `y` | unchanged |
| Topdown / side (`emit`) | `y + z` | unchanged |

## Scene config (`particle`)

| Key | Role |
| --- | --- |
| `maxParticles` | Pool size |
| `decals` / `decalsTileSize` / `decalsResolution` | Floor stamp tilemap |
| `zenithalMaxHeight` | Reference height for full zenithal scale boost |
| `zenithalScaleFactor` | How hard scale grows with height |
| `zenithalAlphaFade` | How hard alpha dies with height (0 = off) |

Zenithal curve knobs are scene-level only (like FOV). Per-burst look uses emit fields (`z`, `vz`, `scale`, `alpha`), not per-particle curve overrides.

## Textures

Same as before: `texture` name, or `spritesheet` + `animation` + `frame`. Resolved via `SpriteSheetRegistry` into `textureId`.

## Pipeline

```
emit / emitFlat / emitZenithal / stampDecal
  → ParticleComponent SAB (incl. flat, viewMode)
particle_worker
  → physics + ground / decals + visibleParticlesData
pre_render_worker
  → render queue pose from viewMode / flat
pixi_worker
  → draw
```

## Related

- [`ParticleEmitter.js`](../src/core/ParticleEmitter.js)
- [`ParticleComponent.js`](../src/components/ParticleComponent.js)
- [`particle_worker.js`](../src/workers/particle_worker.js)
- Demo: [`zenithalParticleTestScene.js`](../demos/scenes/zenithalParticleTestScene.js), [`bluePlatformerPlayer.js`](../demos/gameObjects/bluePlatformerPlayer.js)
