import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommandRingSab,
  bindCommandRing,
  drainCommandRing,
  BOX2D_CMD,
} from '../../src/box2d/box2dCommandRing.js';
import { LiquidFunSystem, LIQUIDFUN_FLAGS, LIQUIDFUN_MATERIALS } from '../../src/core/LiquidFunSystem.js';
import { ParticleEmitter } from '../../src/core/ParticleEmitter.js';
import { PHYSICS_DEFAULTS } from '../../src/core/ConfigDefaults.js';
import { validatePhysicsConfig } from '../../src/core/utils.js';
import { bindLiquidFunRender, liquidFunRenderByteSize } from '../../src/core/liquidFunRender.js';

test('LIQUIDFUN_FLAGS match liquidfun-c lfParticleFlag', () => {
  assert.equal(LIQUIDFUN_FLAGS.WATER, 0);
  assert.equal(LIQUIDFUN_FLAGS.ZOMBIE, 1 << 0);
  assert.equal(LIQUIDFUN_FLAGS.WALL, 1 << 1);
  assert.equal(LIQUIDFUN_FLAGS.VISCOUS, 1 << 2);
  assert.equal(LIQUIDFUN_FLAGS.TENSILE, 1 << 3);
  assert.equal(LIQUIDFUN_FLAGS.ELASTIC, 1 << 4);
  assert.equal(LIQUIDFUN_FLAGS.POWDER, 1 << 5);
  assert.equal(LIQUIDFUN_FLAGS.SPRING, 1 << 6);
  assert.equal(LIQUIDFUN_FLAGS.BARRIER, 1 << 7);
  assert.equal(LIQUIDFUN_FLAGS.STATIC_PRESSURE, 1 << 8);
});

test('LIQUIDFUN_MATERIALS use flags we actually have', () => {
  assert.equal(LIQUIDFUN_MATERIALS.water.flags, LIQUIDFUN_FLAGS.WATER | LIQUIDFUN_FLAGS.TENSILE);
  assert.equal(LIQUIDFUN_MATERIALS.oil.flags, LIQUIDFUN_FLAGS.VISCOUS);
  assert.equal(LIQUIDFUN_MATERIALS.cream.flags, LIQUIDFUN_FLAGS.VISCOUS | LIQUIDFUN_FLAGS.TENSILE);
  assert.equal(LIQUIDFUN_MATERIALS.dulceDeLeche.strength, 0.4);
  assert.equal(LIQUIDFUN_MATERIALS.jelly.flags, LIQUIDFUN_FLAGS.ELASTIC);
  assert.equal(LIQUIDFUN_MATERIALS.sand.flags, LIQUIDFUN_FLAGS.POWDER);
});

test('center+half box converts to a non-inverted AABB for WASM', () => {
  const posX = 2000;
  const posY = 100;
  const halfWidth = 60;
  const halfHeight = 60;
  const x0 = posX - halfWidth;
  const y0 = posY - halfHeight;
  const x1 = posX + halfWidth;
  const y1 = posY + halfHeight;
  assert.ok(x0 < x1);
  assert.ok(y0 < y1);
  assert.equal(x0, 1940);
  assert.equal(y0, 40);
  assert.equal(x1, 2060);
  assert.equal(y1, 160);
});

test('validatePhysicsConfig shallow-merges liquidFun defaults', () => {
  const merged = validatePhysicsConfig(null, {
    liquidFun: { enabled: true, radius: 8, maxCount: 0, subSteps: 0 },
  });
  assert.equal(merged.liquidFun.enabled, true);
  assert.equal(merged.liquidFun.radius, 8);
  assert.equal(merged.liquidFun.maxCount, 1);
  assert.equal(merged.liquidFun.subSteps, 1);
  assert.equal(merged.liquidFun.density, PHYSICS_DEFAULTS.liquidFun.density);
});

test('validatePhysicsConfig clamps liquidFun.maxCount to 65535', () => {
  const merged = validatePhysicsConfig(null, {
    liquidFun: { maxCount: 999999 },
  });
  assert.equal(merged.liquidFun.maxCount, 65535);
});

test('validatePhysicsConfig liquidFun is sim-only (no layer/renderScale)', () => {
  const merged = validatePhysicsConfig(null, {
    liquidFun: { enabled: true, layer: 'water', renderScale: 0.2 },
  });
  assert.equal(merged.liquidFun.layer, undefined);
  assert.equal(merged.liquidFun.renderScale, undefined);
  assert.equal(merged.liquidFun.enabled, true);
});

test('validatePhysicsConfig defaults strictContactCheck to false and respects override', () => {
  const defaulted = validatePhysicsConfig(null, { liquidFun: { enabled: true } });
  assert.equal(defaulted.liquidFun.strictContactCheck, false);
  assert.equal(defaulted.liquidFun.strictContactCheck, PHYSICS_DEFAULTS.liquidFun.strictContactCheck);

  const overridden = validatePhysicsConfig(null, {
    liquidFun: { enabled: true, strictContactCheck: true },
  });
  assert.equal(overridden.liquidFun.strictContactCheck, true);
});

test('LiquidFunSystem enqueues SET_LIQUIDFUN_EMIT then create', () => {
  const sab = createCommandRingSab(64);
  bindCommandRing(sab);
  const i32 = new Int32Array(sab);
  const f32 = new Float32Array(sab);

  LiquidFunSystem.createSystem({ radius: 12, maxCount: 2000, subSteps: 3 });
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'box',
    posX: 100,
    posY: 200,
    halfWidth: 30,
    halfHeight: 40,
    flags: LIQUIDFUN_FLAGS.POWDER,
    spacing: 7,
    strength: 0.25,
    tint: 0xffcc00,
    textureId: 4,
  });
  ParticleEmitter.emitLiquidFunParticles({
    material: 'jelly',
    shape: 'circle',
    posX: 150,
    posY: 250,
    radius: 25,
  });
  LiquidFunSystem.destroyGroup(1);
  LiquidFunSystem.destroySystem(0);

  const received = [];
  drainCommandRing(i32, f32, {
    createParticleSystem(systemId, radius, maxCount, subSteps) {
      received.push({ type: 'createParticleSystem', systemId, radius, maxCount, subSteps });
    },
    setLiquidFunEmit(spacing, strength, tintBits, textureId) {
      received.push({
        type: 'setLiquidFunEmit',
        spacing,
        strength,
        tintBits: tintBits >>> 0,
        textureId: textureId | 0,
      });
    },
    createParticleGroupBox(flags, posX, posY, halfWidth, halfHeight) {
      received.push({ type: 'createParticleGroupBox', flags, posX, posY, halfWidth, halfHeight });
    },
    createParticleGroupCircle(systemId, posX, posY, radius, flags) {
      received.push({ type: 'createParticleGroupCircle', systemId, posX, posY, radius, flags });
    },
    destroyParticleGroup(systemId, groupId) {
      received.push({ type: 'destroyParticleGroup', systemId, groupId });
    },
    destroyParticleSystem(systemId) {
      received.push({ type: 'destroyParticleSystem', systemId });
    },
  });

  assert.equal(BOX2D_CMD.SET_LIQUIDFUN_EMIT, 13);
  assert.equal(received.length, 7);
  assert.deepEqual(received[0], { type: 'createParticleSystem', systemId: 0, radius: 12, maxCount: 2000, subSteps: 3 });
  assert.deepEqual(received[1], {
    type: 'setLiquidFunEmit',
    spacing: 7,
    strength: 0.25,
    tintBits: 0xffcc00,
    textureId: 4,
  });
  assert.deepEqual(received[2], {
    type: 'createParticleGroupBox',
    flags: LIQUIDFUN_FLAGS.POWDER,
    posX: 100,
    posY: 200,
    halfWidth: 30,
    halfHeight: 40,
  });
  assert.equal(received[3].type, 'setLiquidFunEmit');
  assert.equal(received[3].spacing, 0);
  assert.ok(Math.abs(received[3].strength - LIQUIDFUN_MATERIALS.jelly.strength) < 1e-6);
  assert.equal(received[3].tintBits, LIQUIDFUN_MATERIALS.jelly.tint);
  assert.equal(received[3].textureId, 0);
  assert.deepEqual(received[4], {
    type: 'createParticleGroupCircle',
    systemId: 0,
    posX: 150,
    posY: 250,
    radius: 25,
    flags: LIQUIDFUN_FLAGS.ELASTIC,
  });
  assert.deepEqual(received[5], { type: 'destroyParticleGroup', systemId: 0, groupId: 1 });
  assert.deepEqual(received[6], { type: 'destroyParticleSystem', systemId: 0 });
});

test('LiquidFunSystem enqueues SET_LIQUIDFUN_LIFESPAN (ms -> sec) only when options.lifespan is set', () => {
  const sab = createCommandRingSab(64);
  bindCommandRing(sab);
  const i32 = new Int32Array(sab);
  const f32 = new Float32Array(sab);

  LiquidFunSystem.createSystem();
  // No lifespan option - must not enqueue SET_LIQUIDFUN_LIFESPAN at all.
  ParticleEmitter.emitLiquidFunParticles({ shape: 'circle', posX: 0, posY: 0, radius: 20 });
  // lifespan in ms, per ParticleComponent.lifespan's convention.
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'circle',
    posX: 10,
    posY: 20,
    radius: 20,
    lifespan: { min: 100, max: 1000 },
  });
  // Bare number = fixed life (min === max); fadeToAlpha0 defaults off.
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'circle',
    posX: 0,
    posY: 0,
    radius: 20,
    lifespan: 500,
  });
  // Explicit fade opt-in.
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'circle',
    posX: 0,
    posY: 0,
    radius: 20,
    lifespan: 200,
    fadeToAlpha0: true,
  });

  const received = [];
  drainCommandRing(i32, f32, {
    createParticleSystem() {},
    setLiquidFunEmit() {
      received.push({ type: 'setLiquidFunEmit' });
    },
    setLiquidFunLifespan(lifetimeMinSec, lifetimeMaxSec, fadeToAlpha0) {
      received.push({
        type: 'setLiquidFunLifespan',
        lifetimeMinSec,
        lifetimeMaxSec,
        fadeToAlpha0,
      });
    },
    createParticleGroupCircle() {
      received.push({ type: 'createParticleGroupCircle' });
    },
  });

  assert.equal(BOX2D_CMD.SET_LIQUIDFUN_LIFESPAN, 14);
  assert.deepEqual(
    received.map((r) => r.type),
    [
      'setLiquidFunEmit',
      'createParticleGroupCircle',
      'setLiquidFunEmit',
      'setLiquidFunLifespan',
      'createParticleGroupCircle',
      'setLiquidFunEmit',
      'setLiquidFunLifespan',
      'createParticleGroupCircle',
      'setLiquidFunEmit',
      'setLiquidFunLifespan',
      'createParticleGroupCircle',
    ],
  );
  const rangeCmd = received[3];
  assert.ok(Math.abs(rangeCmd.lifetimeMinSec - 0.1) < 1e-6, 'min: 100ms -> 0.1s');
  assert.ok(Math.abs(rangeCmd.lifetimeMaxSec - 1.0) < 1e-6, 'max: 1000ms -> 1.0s');
  assert.equal(rangeCmd.fadeToAlpha0, 0, 'fade defaults off');

  const numberCmd = received[6];
  assert.ok(Math.abs(numberCmd.lifetimeMinSec - 0.5) < 1e-6, 'number 500ms -> 0.5s min');
  assert.ok(Math.abs(numberCmd.lifetimeMaxSec - 0.5) < 1e-6, 'number 500ms -> 0.5s max');
  assert.equal(numberCmd.fadeToAlpha0, 0);

  const fadeCmd = received[9];
  assert.ok(Math.abs(fadeCmd.lifetimeMinSec - 0.2) < 1e-6);
  assert.ok(Math.abs(fadeCmd.lifetimeMaxSec - 0.2) < 1e-6);
  assert.equal(fadeCmd.fadeToAlpha0, 1, 'fadeToAlpha0: true -> 1');
});

test('LiquidFunSystem enqueues SET_LIQUIDFUN_SCALE for scale/alpha/layerId', () => {
  const sab = createCommandRingSab(64);
  bindCommandRing(sab);
  const i32 = new Int32Array(sab);
  const f32 = new Float32Array(sab);

  LiquidFunSystem.createSystem();
  ParticleEmitter.emitLiquidFunParticles({ shape: 'circle', posX: 0, posY: 0, radius: 20 });
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'circle',
    posX: 0,
    posY: 0,
    radius: 20,
    scale: 0.2,
  });
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'circle',
    posX: 0,
    posY: 0,
    radius: 20,
    scale: { min: 0.12, max: 0.3 },
    alpha: 0.5,
    layerId: 4,
  });

  const received = [];
  drainCommandRing(i32, f32, {
    createParticleSystem() {},
    setLiquidFunEmit() {
      received.push({ type: 'setLiquidFunEmit' });
    },
    setLiquidFunScale(layerId, scaleMin, scaleMax, alphaMin, alphaMax) {
      received.push({ type: 'setLiquidFunScale', layerId, scaleMin, scaleMax, alphaMin, alphaMax });
    },
    createParticleGroupCircle() {
      received.push({ type: 'createParticleGroupCircle' });
    },
  });

  assert.equal(BOX2D_CMD.SET_LIQUIDFUN_SCALE, 15);
  assert.deepEqual(
    received.map((r) => r.type),
    [
      'setLiquidFunEmit',
      'createParticleGroupCircle',
      'setLiquidFunEmit',
      'setLiquidFunScale',
      'createParticleGroupCircle',
      'setLiquidFunEmit',
      'setLiquidFunScale',
      'createParticleGroupCircle',
    ],
  );
  assert.equal(received[3].layerId, 0);
  assert.ok(Math.abs(received[3].scaleMin - 0.2) < 1e-6);
  assert.ok(Math.abs(received[3].scaleMax - 0.2) < 1e-6);
  assert.ok(Math.abs(received[3].alphaMin - 1) < 1e-6);
  assert.ok(Math.abs(received[3].alphaMax - 1) < 1e-6);
  assert.equal(received[6].layerId, 4);
  assert.ok(Math.abs(received[6].scaleMin - 0.12) < 1e-6);
  assert.ok(Math.abs(received[6].scaleMax - 0.3) < 1e-6);
  assert.ok(Math.abs(received[6].alphaMin - 0.5) < 1e-6);
  assert.ok(Math.abs(received[6].alphaMax - 0.5) < 1e-6);
});

test('liquidFun render SAB is not ParticleComponent', () => {
  const n = 16;
  const sab = new SharedArrayBuffer(liquidFunRenderByteSize(n));
  const views = bindLiquidFunRender(sab, n);
  assert.equal(views.count.length, 1);
  assert.equal(views.x.length, n);
  assert.equal(views.textureId.length, n);
  assert.equal(views.baseAlpha.length, n);
  assert.equal(views.layerId.length, n);
  views.count[0] = 3;
  views.x[2] = 42;
  views.tint[2] = 0x3399ff;
  views.baseAlpha[2] = 0.5;
  views.layerId[2] = 4;
  assert.equal(views.y[2], 0);
  assert.equal(views.baseAlpha[2], 0.5);
  assert.equal(views.layerId[2], 4);
  // px/py: previous-frame position snapshot feeding preRender.interpolation
  // 'interpolate' - not the same thing as ParticleComponent's simulation
  // state, which is why lifespan/flat (CPU-particle-only fields) still must
  // not exist here (LiquidFun's own age-based destruction is JS-invisible -
  // it only ever shows up as the particle disappearing, plus optional alpha
  // fade when fadeToAlpha0 was set at create).
  assert.equal(views.px.length, n);
  assert.equal(views.py.length, n);
  assert.ok(!('vx' in views));
  assert.ok(!('vy' in views));
  assert.ok(!('lifespan' in views));
  assert.ok(!('flat' in views));
});
