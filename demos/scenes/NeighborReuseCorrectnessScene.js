import WEED from '/src/index.js';
import { NeighborReuseProbe } from '../gameObjects/neighborReuseProbe.js';

const { Scene, Camera } = WEED;

const PROBE_COUNT = 1000;
const VISUAL_RANGE = 120;
/**
 * Max speed px/s. At 60 Hz with neighborReuseMaxFrames=30:
 * max B drift ≈ 12 * 30/60 = 6px ≪ skin (0.25*120=30) → Verlet invariant holds.
 */
const MAX_SPEED = 12;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSpatialConfig(neighborReuseSkin, verifyNeighborSets) {
  return {
    numberOfSpatialWorkers: 1,
    cellSize: 100,
    maxNeighbors: 512,
    maxEntitiesPerCell: 128,
    noLimitFPS: false,
    fixedFps: 60,
    neighborReuseSkin,
    verifyNeighborSets,
    neighborReuseMaxFrames: 30,
  };
}

function makeSceneConfig(neighborReuseSkin, verifyNeighborSets) {
  return {
    worldWidth: 2000,
    worldHeight: 1200,
    seed: 424242,
    spatial: makeSpatialConfig(neighborReuseSkin, verifyNeighborSets),
    logic: {
      noLimitFPS: false,
      fixedFps: 60,
      numberOfLogicWorkers: 1,
      staggeredUpdates: false,
    },
    physics: {
      subStepCount: 0,
      noLimitFPS: false,
      fixedFps: 60,
      gravity: { x: 0, y: 0 },
    },
    particle: {
      maxParticles: 0,
      decals: false,
      noLimitFPS: false,
      fixedFps: 60,
    },
    renderer: {
      noLimitFPS: false,
      fixedFps: 60,
      maxVisibleRenderables: 4000,
    },
    preRender: {
      noLimitFPS: false,
      fixedFps: 60,
    },
    lighting: {
      enabled: false,
    },
  };
}

function spawnProbes(scene) {
  const rng = mulberry32(scene.config.seed | 0);
  const margin = 100;
  const minX = margin;
  const maxX = scene.config.worldWidth - margin;
  const minY = margin;
  const maxY = scene.config.worldHeight - margin;

  for (let i = 0; i < PROBE_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = MAX_SPEED * (0.35 + rng() * 0.65);
    scene.spawnEntity(NeighborReuseProbe, {
      x: minX + rng() * (maxX - minX),
      y: minY + rng() * (maxY - minY),
      radius: 8 + rng() * 4,
      visualRange: VISUAL_RANGE,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      minX,
      maxX,
      minY,
      maxY,
    });
  }

  Camera.centerOn(scene.config.worldWidth * 0.5, scene.config.worldHeight * 0.5);
  Camera.setZoom(0.55);
}

function defineScene(neighborReuseSkin, verifyNeighborSets) {
  return class extends Scene {
    static config = makeSceneConfig(neighborReuseSkin, verifyNeighborSets);
    static assets = {
      textures: {
        ball: '/demos/img/bola.png',
      },
    };
    static entities = [[NeighborReuseProbe, PROBE_COUNT + 16]];
    create() {
      spawnProbes(this);
    }
  };
}

/** Correctness: Verlet skin 0.25 + oracle */
export class NeighborReuseCorrectnessScene extends defineScene(0.25, true) {}

/** Correctness: skin 0 (full rebuild each frame) + oracle */
export class NeighborReuseBaselineScene extends defineScene(0, true) {}

/** Perf only: Verlet skin 0.25, no oracle */
export class NeighborReusePerfScene extends defineScene(0.25, false) {}

/** Perf only: skin 0 baseline, no oracle */
export class NeighborReusePerfBaselineScene extends defineScene(0, false) {}
