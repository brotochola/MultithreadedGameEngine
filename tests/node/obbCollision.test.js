import test from 'node:test';
import assert from 'node:assert/strict';

import { testOBBOBBCollision } from '../../src/core/utils.js';

function resultScratch() {
  return {
    collided: false,
    depth: 0,
    nx: 0,
    ny: 0,
    cx: 0,
    cy: 0,
  };
}

test('face-face OBB overlap returns single support contact', () => {
  const r = resultScratch();
  const hit = testOBBOBBCollision(
    0, 0, 40, 20, 1, 0,
    0, 18, 40, 20, 1, 0,
    r
  );
  assert.ok(hit);
  assert.ok(r.depth > 0);
  assert.ok(Number.isFinite(r.cx) && Number.isFinite(r.cy));
});

test('stick on floor contact stays on smaller body (no floor-centroid lever)', () => {
  const r = resultScratch();
  const ang = Math.PI / 2;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const stickX = 400;
  const stickW = 15;
  const stickH = 120;
  const floorY = 600;
  const floorH = 40;
  const top = floorY - floorH * 0.5;
  const stickY = top - stickW * 0.5 + 3;
  const hit = testOBBOBBCollision(
    stickX, stickY, stickW, stickH, c, s,
    stickX, floorY, 800, floorH, 1, 0,
    r
  );
  assert.ok(hit);
  assert.ok(r.depth > 0);
  // After PI/2, stick spans x in [stickX - h/2, stickX + h/2]
  const xMin = stickX - stickH * 0.5 - 1;
  const xMax = stickX + stickH * 0.5 + 1;
  assert.ok(r.cx >= xMin && r.cx <= xMax, `cx=${r.cx} outside stick`);
});

test('OBB on AABB floor returns contact with positive depth', () => {
  const r = resultScratch();
  const cos = Math.cos(0.2);
  const sin = Math.sin(0.2);
  const hit = testOBBOBBCollision(
    50, 70, 40, 40, cos, sin,
    50, 100, 200, 40, 1, 0,
    r
  );
  assert.ok(hit);
  assert.ok(r.depth > 0);
});

test('separated OBBs miss', () => {
  const r = resultScratch();
  const hit = testOBBOBBCollision(
    0, 0, 10, 10, 1, 0,
    100, 100, 10, 10, 1, 0,
    r
  );
  assert.equal(hit, null);
});
