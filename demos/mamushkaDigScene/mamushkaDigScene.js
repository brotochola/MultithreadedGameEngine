// MamushkaDigScene — Noise2D-packed static mamushka; jetpack digger; LMB laser.

import { Digger } from './gameObjects/digger.js';
import { MamushkaBox, ORDER1_CELL } from './gameObjects/mamushkaBox.js';
import { buildOccupancy, packMamushkaRoots } from './mamushkaPack.js';
import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import { BLEND_MODES } from '/src/core/ConfigDefaults.js';
import WEED from '/src/index.js';

const { Transform } = WEED;

/** Prototype pack order cap; max square = 8 order-1 cells = 512px. */
const MAX_PACK_ORDER = 4;
const GRID_COLS = 40;
const GRID_ROWS = 20;

export class MamushkaDigScene extends WEED.Scene {
  static config = {
    worldWidth: 4000,
    worldHeight: 2400,

    spatial: {
      cellSize: 128,
      maxNeighbors: 512,
      noLimitFPS: false,
    },

    logic: {
      noLimitFPS: false,
    },

    particle: {
      noLimitFPS: false,
      maxParticles: 8000,
      decals: false,
    },

    physics: {
      subStepCount: 4,
      noLimitFPS: false,
      maxJoints: 8192,
      gravity: { x: 0, y: 1800 },
      sleeping: true,
    },

    renderer: {
      noLimitFPS: false,
      maxVisibleRenderables: 20000,
    },

    lighting: {
      enabled: false,
    },

    layers: {
      dust: {
        zIndex: 3.5,
        blendMode: BLEND_MODES.NORMAL,
        maxItems: 4000,
        ySorting: false,
      },
    },
  };

  static assets = {
    textures: {
      rocky: '/demos/img/rocky.jpg',
    },
    AdobeAnimateAnimations: {
      blue_character: {
        atlas: '/demos/img/adobe_blue_character/spritemap1.json',
        animation: '/demos/img/adobe_blue_character/Animation.json',
        png: '/demos/img/adobe_blue_character/spritemap1.png',
      },
    },
  };

  static entities = [
    [MamushkaBox, 4096],
    [Floor, 16],
    [Digger, 1],
  ];

  create() {
    this.spawnFloorAndWalls();
    this.playerIndex = -1;
    Camera.setZoom(0.7);
    this._createHud();
  }

  createNewGame() {
    MamushkaBox.despawnAll();
    Digger.despawnAll();
    this._spawnTerrain();
    this._spawnDigger();
  }

  update() {
    const i = this.playerIndex;
    if (i < 0 || !Transform.active[i]) return;
    Camera.follow(Transform.x[i], Transform.y[i], 0.15);
  }

  _spawnDigger() {
    const cols = GRID_COLS;
    const gridOriginX = (this.config.worldWidth - cols * ORDER1_CELL) * 0.5;
    const gridOriginY = this.config.worldHeight * 0.22;
    const x = Math.max(180, gridOriginX - 80);
    const y = Math.max(160, gridOriginY - 40);
    const spawned = Digger.spawn({ x, y });
    this.playerIndex = spawned ? spawned.index : -1;
    if (this.playerIndex >= 0) Camera.centerOn(x, y);
  }

  _createHud() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('mamushka-dig-hud')) return;
    const el = document.createElement('div');
    el.id = 'mamushka-dig-hud';
    el.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:900;color:#fff;font:13px/1.4 sans-serif;' +
      'background:rgba(0,0,0,0.65);padding:10px 12px;border-radius:6px;pointer-events:none;';
    el.textContent =
      'Mamushka Dig — A/D move  |  W/up jetpack  |  hold LMB laser';
    document.body.appendChild(el);
  }

  _spawnTerrain() {
    const { solid, materials, cols, rows } = buildOccupancy({
      cols: GRID_COLS,
      rows: GRID_ROWS,
      seed: 9193191,
      scale: 0.06,
      threshold: 0.15,
      yBias: 0.5,
      stoneDepthFrac: 0.45,
    });

    const roots = packMamushkaRoots(solid, materials, cols, rows, MAX_PACK_ORDER);
    const gridOriginX = (this.config.worldWidth - cols * ORDER1_CELL) * 0.5;
    const gridOriginY = this.config.worldHeight * 0.22;
    const cell = ORDER1_CELL;

    let spawned = 0;
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      const size = r.sideCells * cell;
      const x = gridOriginX + (r.gx + r.sideCells * 0.5) * cell;
      const y = gridOriginY + (r.gy + r.sideCells * 0.5) * cell;
      const box = MamushkaBox.spawn({
        x,
        y,
        level: r.level,
        size,
        material: r.material,
      });
      if (box) spawned++;
      else {
        console.warn('[MamushkaDigScene] MamushkaBox pool exhausted at', spawned);
        break;
      }
    }
    console.log(
      `[MamushkaDigScene] packed ${roots.length} roots, spawned ${spawned}`,
    );
  }

  spawnFloorAndWalls() {
    const t = 120;
    const w = this.config.worldWidth;
    const h = this.config.worldHeight;

    Floor.spawn({
      x: w / 2,
      y: h - t / 2,
      width: w + t * 2,
      height: t,
      tint: 0x445566,
    });
    Floor.spawn({
      x: t / 2,
      y: h / 2,
      width: t,
      height: h,
      tint: 0x445566,
    });
    Floor.spawn({
      x: w - t / 2,
      y: h / 2,
      width: t,
      height: h,
      tint: 0x445566,
    });
  }
}
