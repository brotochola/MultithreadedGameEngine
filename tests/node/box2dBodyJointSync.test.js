import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_DIRTY,
  bindBodySyncBuffers,
  markBodyDirty,
  bumpBodyGeneration,
} from '../../src/box2d/box2dBodySync.js';
import { Joint } from '../../src/core/Joint.js';
import { resetFreeList } from '../../src/core/atomicFreeList.js';

test('body dirty: coalesces flags and publishes dirty words', () => {
  const entityCount = 64;
  const buffers = {
    bodyDirtyFlags: new SharedArrayBuffer(entityCount * 4),
    bodyDirtyWords: new SharedArrayBuffer(Math.ceil(entityCount / 32) * 4),
    bodyGeneration: new SharedArrayBuffer(entityCount * 4),
  };
  bindBodySyncBuffers(buffers);
  const flags = new Int32Array(buffers.bodyDirtyFlags);
  const words = new Int32Array(buffers.bodyDirtyWords);

  assert.equal(markBodyDirty(5, BODY_DIRTY.MASS), true);
  assert.equal(markBodyDirty(5, BODY_DIRTY.FILTER), true);
  assert.equal(flags[5] & BODY_DIRTY.MASS, BODY_DIRTY.MASS);
  assert.equal(flags[5] & BODY_DIRTY.FILTER, BODY_DIRTY.FILTER);
  assert.ok(words[0] & (1 << 5));
});

test('body generation: bump increments and marks lifecycle dirty', () => {
  const entityCount = 16;
  const buffers = {
    bodyDirtyFlags: new SharedArrayBuffer(entityCount * 4),
    bodyDirtyWords: new SharedArrayBuffer(4),
    bodyGeneration: new SharedArrayBuffer(entityCount * 4),
  };
  bindBodySyncBuffers(buffers);
  const gen = new Int32Array(buffers.bodyGeneration);
  const flags = new Int32Array(buffers.bodyDirtyFlags);

  assert.equal(gen[3], 0);
  assert.equal(bumpBodyGeneration(3), 1);
  assert.equal(gen[3], 1);
  assert.equal(bumpBodyGeneration(3), 2);
  assert.equal(gen[3], 2);
  assert.equal(flags[3] & BODY_DIRTY.LIFECYCLE, BODY_DIRTY.LIFECYCLE);
});

test('joint revision: bumps on add, update, remove; slot reuse gets new rev', () => {
  const maxJoints = 8;
  Joint.reset();
  const sab = new SharedArrayBuffer(Joint.getBufferSize(maxJoints));
  Joint.initializeArrays(sab, maxJoints);

  const freeListSab = new SharedArrayBuffer(maxJoints * 2);
  const freeListTopSab = new SharedArrayBuffer(8);
  const freeList = new Uint16Array(freeListSab);
  const freeListTop = new Int32Array(freeListTopSab);
  resetFreeList(freeListTop, freeList, maxJoints, 1);
  Joint.initialize(maxJoints);
  Joint.initializeFreeList(freeListSab, freeListTopSab);

  const idx = Joint.addDistance({
    entityA: 1,
    entityB: 2,
    length: 10,
  });
  assert.ok(idx >= 0);
  const rev1 = Atomics.load(Joint.revision, idx);
  assert.ok(rev1 > 0);

  Joint.update(idx, { length: 12 });
  const rev2 = Atomics.load(Joint.revision, idx);
  assert.ok(rev2 > rev1);

  Joint.remove(idx);
  const revAfterRemove = Atomics.load(Joint.revision, idx);
  assert.ok(revAfterRemove > rev2);

  const idx2 = Joint.addDistance({
    entityA: 3,
    entityB: 4,
    length: 5,
  });
  assert.equal(idx2, idx);
  const revReuse = Atomics.load(Joint.revision, idx2);
  assert.ok(revReuse > revAfterRemove);

  Joint.reset();
});
