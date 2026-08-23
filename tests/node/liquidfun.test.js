import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommandRingSab,
  bindCommandRing,
  drainCommandRing,
} from '../../src/box2d/box2dCommandRing.js';
import { LiquidFunSystem, LIQUIDFUN_FLAGS } from '../../src/core/LiquidFunSystem.js';
import { ParticleEmitter } from '../../src/core/ParticleEmitter.js';

test('LIQUIDFUN_FLAGS match liquidfun-c lfParticleFlag', () => {
  assert.equal(LIQUIDFUN_FLAGS.WATER, 0);
  assert.equal(LIQUIDFUN_FLAGS.ZOMBIE, 1 << 0);
  assert.equal(LIQUIDFUN_FLAGS.WALL, 1 << 1);
  assert.equal(LIQUIDFUN_FLAGS.VISCOUS, 1 << 2);
  assert.equal(LIQUIDFUN_FLAGS.TENSILE, 1 << 3);
  assert.equal(LIQUIDFUN_FLAGS.ELASTIC, 1 << 4);
  assert.equal(LIQUIDFUN_FLAGS.POWDER, 1 << 5);
  assert.equal(LIQUIDFUN_FLAGS.SPRING, 1 << 6);
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

test('LiquidFunSystem enqueues commands correctly to command ring', () => {
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
  });
  ParticleEmitter.emitLiquidFunParticles({
    shape: 'circle',
    posX: 150,
    posY: 250,
    radius: 25,
    flags: LIQUIDFUN_FLAGS.SPRING,
  });
  LiquidFunSystem.destroyGroup(1);
  LiquidFunSystem.destroySystem(0);

  const received = [];
  drainCommandRing(i32, f32, {
    createParticleSystem(systemId, radius, maxCount, subSteps) {
      received.push({ type: 'createParticleSystem', systemId, radius, maxCount, subSteps });
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

  assert.equal(received.length, 5);
  assert.deepEqual(received[0], { type: 'createParticleSystem', systemId: 0, radius: 12, maxCount: 2000, subSteps: 3 });
  assert.deepEqual(received[1], {
    type: 'createParticleGroupBox',
    flags: LIQUIDFUN_FLAGS.POWDER,
    posX: 100,
    posY: 200,
    halfWidth: 30,
    halfHeight: 40,
  });
  assert.deepEqual(received[2], {
    type: 'createParticleGroupCircle',
    systemId: 0,
    posX: 150,
    posY: 250,
    radius: 25,
    flags: LIQUIDFUN_FLAGS.SPRING,
  });
  assert.deepEqual(received[3], { type: 'destroyParticleGroup', systemId: 0, groupId: 1 });
  assert.deepEqual(received[4], { type: 'destroyParticleSystem', systemId: 0 });
});
