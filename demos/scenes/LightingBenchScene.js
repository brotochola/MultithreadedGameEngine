// LightingBenchScene.js — Stable fixed-timestep lighting + LoS benchmark scene.
//
// Hyp → metric map (this chat / lighting work):
//   AngularSweep densify kill + uLightRadius  → Raycast mode: VISIBILITY_MS, preRender STEP_MS
//   CASTED_SHADOWS off under raycast          → Raycast mode: SHADOWS_MS ≈ 0 (expected)
//   Cookie / casted-shadow path               → Cookie mode: SHADOWS_MS, SHADOW_Q_MS
//   Ray.hasLineOfSight / linecastDir          → Both: logic STEP_MS (soldiers + civilians)
//   Particle / physics CS work                → Prefer BallsScene for isolation; light load here
//
// Cookie vs raycast cannot share one lighting path (vis-poly disables CASTED_SHADOWS cookies).

import WEED from '/src/index.js';
import { TallLight } from '../gameObjects/tallLight.js';
import { Tree } from '../gameObjects/tree.js';
import { Rock } from '../gameObjects/rock.js';
import { ZenithalCar } from '../gameObjects/zenithalCar.js';
import { MySoldier } from '../gameObjects/mySoldier.js';
import { Civilian } from '../gameObjects/civilian.js';
import { Destination } from '../gameObjects/destination.js';

const { Scene, Camera, NavGrid } = WEED;

/** Fixed spawn counts — log these beside bench JSON when comparing branches. */
export const LIGHTING_BENCH_COUNTS = Object.freeze({
  LIGHTS: 40,
  TREES: 280,
  ROCKS: 80,
  CARS: 100,
  SOLDIERS: 250,
  CIVILIANS: 500,
});

const excludedLPCAnimations = [
  'spellcast_up',
  'spellcast_left',
  'spellcast_down',
  'spellcast_right',
  'thrust_up',
  'thrust_left',
  'thrust_down',
  'thrust_right',
  'climb',
  'emote_up',
  'emote_left',
];

const FIXED60 = Object.freeze({ fixedFps: 60, noLimitFPS: false });

function makeLightingBenchConfig(lightingExtra) {
  return {
    worldWidth: 4000,
    worldHeight: 3000,
    seed: 424242,

    debug: {
      collectDetailedStats: true,
    },

    spatial: {
      ...FIXED60,
      cellSize: 128,
      maxNeighbors: 256,
      maxEntitiesPerCell: 64,
      numberOfSpatialWorkers: 1,
    },

    logic: {
      ...FIXED60,
      numberOfLogicWorkers: 2,
      staggeredUpdates: true,
    },

    physics: {
      ...FIXED60,
      gravity: { x: 0, y: 0 },
      subStepCount: 0,
      box2dWorkerCount: 2,
    },

    renderer: {
      ...FIXED60,
      ySorting: true,
      interpolation: false,
      maxVisibleRenderables: 20000,
      instancedSprites: true,
    },

    preRender: {
      ...FIXED60,
    },

    particle: {
      ...FIXED60,
      maxParticles: 2000,
      decals: false,
    },

    navigation: {
      ...FIXED60,
    },

    bullet: {
      maxBullets: 512,
      maxImpactsPerFrame: 128,
    },

    lighting: {
      enabled: true,
      baseAmbient: 0.15,
      maxLights: 64,
      maxFlashes: 0,
      resolution: 0.5,
      // No day-cycle / sun drift — keep SHADOW / VIS bands stable
      sun: {
        enabled: false,
        dayCycle: { enabled: false },
      },
      ...lightingExtra,
    },
  };
}

const SHARED_ASSETS = {
  textures: {
    tallLight: '/demos/img/tallLight.png',
    tree1: '/demos/img/tree1.png',
    tree2: '/demos/img/tree2.png',
    rock1: '/demos/img/rock1.png',
    rock2: '/demos/img/rock2.png',
    rock3: '/demos/img/rock3.png',
    rock4: '/demos/img/rock4.png',
    zenithal_car: '/demos/img/zenithal_car.png',
    target: '/demos/img/target.png',
    bullet: '/demos/img/bullet.png',
    blood: '/demos/img/blood.png',
  },
  spritesheets: {
    civil5: {
      json: '/demos/img/civil1.json',
      png: '/demos/img/civil5.png',
      excludeAnimations: excludedLPCAnimations,
    },
    civil6: {
      json: '/demos/img/civil1.json',
      png: '/demos/img/civil6.png',
      excludeAnimations: excludedLPCAnimations,
    },
    civil7: {
      json: '/demos/img/civil1.json',
      png: '/demos/img/civil7.png',
      excludeAnimations: excludedLPCAnimations,
    },
    poli: {
      json: '/demos/img/civil1.json',
      png: '/demos/img/poli.png',
      excludeAnimations: excludedLPCAnimations,
    },
  },
};

const SHARED_ENTITIES = [
  [TallLight, 64],
  [Tree, 400],
  [Rock, 120],
  [ZenithalCar, 150],
  [MySoldier, 400],
  [Civilian, 800],
  [Destination, 1],
];

/**
 * Shared spawn + fixed camera. Subclasses set `static benchMode` ('cookie' | 'raycast').
 */
class LightingBenchSceneBase extends Scene {
  static COUNTS = LIGHTING_BENCH_COUNTS;
  static assets = SHARED_ASSETS;
  static entities = SHARED_ENTITIES;
  static audios = {};

  create() {
    const { worldWidth, worldHeight } = this.config;
    const cx = worldWidth * 0.5;
    const cy = worldHeight * 0.5;
    const C = LIGHTING_BENCH_COUNTS;

    Camera.centerOn(cx, cy);
    Camera.setZoom(0.9);

    this.spawnEntity(Destination, { x: cx, y: cy });

    this._spawnGrid(TallLight, C.LIGHTS, cx, cy, 380, 5);
    // Trees: ShadowCaster (cookie) + LoS blockers (both modes)
    this._spawnGrid(Tree, C.TREES, cx, cy, 900, 18);
    this._spawnGrid(Rock, C.ROCKS, cx, cy, 700, 12);

    if (this.constructor.benchMode === 'raycast') {
      // LightOccluder footprints for visibility polygons
      this._spawnGrid(ZenithalCar, C.CARS, cx, cy, 750, 12);
    }

    this._spawnGrid(Civilian, C.CIVILIANS, cx, cy, 650, 24);
    this._spawnGrid(MySoldier, C.SOLDIERS, cx, cy, 500, 16);

    NavGrid.updateNavGrid([
      ...Tree.getAllActive(),
      ...Rock.getAllActive(),
      ...ZenithalCar.getAllActive(),
    ]);

    console.log(
      `[LightingBench] mode=${this.constructor.benchMode} counts=`,
      C,
      'seed=',
      this.config.seed
    );
  }

  /**
   * Deterministic lattice around (cx,cy). Uses scene seeded rng only for sub-cell jitter.
   */
  _spawnGrid(EntityClass, count, cx, cy, radius, colsHint) {
    const cols = Math.max(1, colsHint | 0);
    const rows = Math.ceil(count / cols);
    let n = 0;
    for (let row = 0; row < rows && n < count; row++) {
      for (let col = 0; col < cols && n < count; col++) {
        const u = cols === 1 ? 0.5 : col / (cols - 1);
        const v = rows === 1 ? 0.5 : row / (rows - 1);
        const jx = (this.rng() - 0.5) * 24;
        const jy = (this.rng() - 0.5) * 24;
        this.spawnEntity(EntityClass, {
          x: cx - radius + u * radius * 2 + jx,
          y: cy - radius + v * radius * 2 + jy,
        });
        n++;
      }
    }
  }

  update() {
    // Fixed camera — no pan/zoom drift (bench stability)
  }
}

/** Cookie / casted-shadow path — measure SHADOWS_MS + SHADOW_Q_MS */
export class LightingBenchCookieScene extends LightingBenchSceneBase {
  static benchMode = 'cookie';
  static config = makeLightingBenchConfig({
    raycasted: false,
    shadowsEnabled: true,
    maxShadowCastingLights: 48,
    maxShadowsPerLight: 48,
    maxShadowsPerEntity: 4,
    maxShadowSprites: 8000,
  });
}

/** Raycasted visibility polygons — measure VISIBILITY_MS (CASTED_SHADOWS off) */
export class LightingBenchRaycastScene extends LightingBenchSceneBase {
  static benchMode = 'raycast';
  static config = makeLightingBenchConfig({
    raycasted: true,
    shadowsEnabled: true, // cookies still disabled by pixi when vis-poly inits
    maxShadowCastingLights: 8,
    maxShadowsPerLight: 8,
    maxShadowSprites: 256,
    maxPolygonVertices: 2048,
  });
}
