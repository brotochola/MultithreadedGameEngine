// LiquidFunStressScene.js - L2 stress scene for the liquidfun-c particle step.
// 5k water (plain fluid) + 1k SPRING|STATIC_PRESSURE (group creation + Poisson
// pressure loop that plain water skips). No interactivity: spawn once, let it
// settle. strictContactCheck is forced on so RemoveSpuriousBodyContacts is
// actually exercised (it's off by default).
import { Floor } from '/demos/ballsScene/gameObjects/floor.js';
import { Camera } from '/src/core/Camera.js';
import WEED from '/src/index.js';

const { ParticleEmitter, LIQUIDFUN_FLAGS } = WEED;

export class LiquidFunStressScene extends WEED.Scene {
  static config = {
    worldWidth: 6000,
    worldHeight: 6000,

    spatial: {
      numberOfSpatialWorkers: 1,
      cellSize: 128,
      maxNeighbors: 64,
      maxEntitiesPerCell: 96,
      noLimitFPS: false,
    },

    logic: {
      noLimitFPS: false,
      numberOfLogicWorkers: 1,
    },

    particle: {
      noLimitFPS: false,
      maxParticles: 0,
      decals: false,
    },

    physics: {
      subStepCount: 1,
      noLimitFPS: false,
      gravity: { x: 0, y: 980 },
      sleeping: false,
      liquidFun: { enabled: true, radius: 8, maxCount: 8000, subSteps: 1, strictContactCheck: false },
    },

    renderer: {
      noLimitFPS: false,
      maxVisibleRenderables: 20000,
    },

    lighting: {
      enabled: false,
    },
  };

  static assets = {
    textures: {},
  };

  static entities = [[Floor, 10]];

  create() {
    const floorY = 2600;
    const wallTop = 200;
    const wallH = floorY - wallTop;
    const wallY = (wallTop + floorY) / 2;

    this.spawnEntity(Floor, { x: 2500, y: floorY, width: 4800, height: 260, tint: 0x444455 });
    this.spawnEntity(Floor, { x: 200, y: wallY, width: 260, height: wallH, tint: 0x444455 });
    this.spawnEntity(Floor, { x: 4800, y: wallY, width: 260, height: wallH, tint: 0x444455 });

    // ~5k water: radius 8 -> diameter 16 -> default spacing 12 (0.75x). 101x51 grid.
    ParticleEmitter.emitLiquidFunParticles({
      material: 'water',
      shape: 'box',
      posX: 1300,
      posY: 800,
      halfWidth: 600,
      halfHeight: 300,
      texture: '_whiteCircle',
    });

    // ~1k SPRING|STATIC_PRESSURE: exercises CapturePairs (create-time) and
    // SolveStaticPressure's 8-iteration Poisson loop (steady-state), neither
    // of which plain water touches. No named material preset uses these flags.
    ParticleEmitter.emitLiquidFunParticles({
      shape: 'box',
      posX: 4000,
      posY: 800,
      halfWidth: 235,
      halfHeight: 145,
      flags: LIQUIDFUN_FLAGS.SPRING | LIQUIDFUN_FLAGS.STATIC_PRESSURE,
      tint: 0xff33aa,
      texture: '_whiteCircle',
    });

    // Lift the world-fit zoom-out floor first so setZoom below isn't clamped
    // back up to a "cover" fit that crops the world (see LiquidFunDemoScene).
    Camera.setWorldBounds(Infinity, Infinity);

    Camera.setZoom(0.25);
    Camera.centerOn(2000, 1750);
    // Camera.zoom = 0.25
  }
}
