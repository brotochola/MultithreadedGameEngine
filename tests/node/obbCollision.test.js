import test from 'node:test';
import assert from 'node:assert/strict';

import {
  testOBBOBBCollision,
  testPolygonPolygonCollision,
  testCirclePolygonCollision,
  collidePolygonsManifold,
  fillBoxPolygonInto,
} from '../../src/core/utils.js';

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

function manifoldScratch() {
  return {
    pointCount: 0,
    nx: 0,
    ny: 0,
    c0x: 0,
    c0y: 0,
    d0: 0,
    c1x: 0,
    c1y: 0,
    d1: 0,
  };
}

const boxA = {
  vx: new Float32Array(8),
  vy: new Float32Array(8),
  nx: new Float32Array(8),
  ny: new Float32Array(8),
};
const boxB = {
  vx: new Float32Array(8),
  vy: new Float32Array(8),
  nx: new Float32Array(8),
  ny: new Float32Array(8),
};

function makeLocalBox(target, halfW, halfH) {
  fillBoxPolygonInto(target.vx, target.vy, target.nx, target.ny, halfW, halfH);
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

test('face-face boxes yield 2-point clip manifold', () => {
  makeLocalBox(boxA, 20, 10);
  makeLocalBox(boxB, 20, 10);
  const man = manifoldScratch();
  const hit = collidePolygonsManifold(
    0, 0, 1, 0, boxA.vx, boxA.vy, boxA.nx, boxA.ny, 4, 0,
    0, 15, 1, 0, boxB.vx, boxB.vy, boxB.nx, boxB.ny, 4, 0,
    man
  );
  assert.ok(hit);
  assert.equal(man.pointCount, 2);
  assert.ok(man.d0 > 0 && man.d1 > 0);
  assert.ok(Number.isFinite(man.nx) && Number.isFinite(man.ny));
  // Shared normal; contacts separated along tangent (face span)
  const dx = man.c1x - man.c0x;
  const dy = man.c1y - man.c0y;
  assert.ok(dx * dx + dy * dy > 1, 'contacts should span the face');
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

test('separated polys miss via manifold', () => {
  makeLocalBox(boxA, 5, 5);
  makeLocalBox(boxB, 5, 5);
  const man = manifoldScratch();
  const hit = collidePolygonsManifold(
    0, 0, 1, 0, boxA.vx, boxA.vy, boxA.nx, boxA.ny, 4, 0,
    100, 100, 1, 0, boxB.vx, boxB.vy, boxB.nx, boxB.ny, 4, 0,
    man
  );
  assert.equal(hit, null);
  assert.equal(man.pointCount, 0);
});

test('makeBox-style polys overlap via polygon SAT', () => {
  makeLocalBox(boxA, 20, 10);
  makeLocalBox(boxB, 20, 10);
  const r = resultScratch();
  const hit = testPolygonPolygonCollision(
    0, 0, 1, 0, boxA.vx, boxA.vy, boxA.nx, boxA.ny, 4, 0, 800,
    0, 15, 1, 0, boxB.vx, boxB.vy, boxB.nx, boxB.ny, 4, 0, 800,
    r
  );
  assert.ok(hit);
  assert.ok(r.depth > 0);
  assert.ok(Number.isFinite(r.nx) && Number.isFinite(r.ny));
});

test('triangle vs box separates when apart', () => {
  // Equilateral-ish triangle in local space
  const tvx = new Float32Array([-10, 10, 0, 0, 0, 0, 0, 0]);
  const tvy = new Float32Array([-10, -10, 10, 0, 0, 0, 0, 0]);
  const tnx = new Float32Array(8);
  const tny = new Float32Array(8);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const ex = tvx[j] - tvx[i];
    const ey = tvy[j] - tvy[i];
    const len = Math.hypot(ey, -ex);
    tnx[i] = ey / len;
    tny[i] = -ex / len;
  }
  makeLocalBox(boxB, 5, 5);
  const r = resultScratch();
  const hit = testPolygonPolygonCollision(
    0, 0, 1, 0, tvx, tvy, tnx, tny, 3, 0, 150,
    100, 100, 1, 0, boxB.vx, boxB.vy, boxB.nx, boxB.ny, 4, 0, 100,
    r
  );
  assert.equal(hit, null);
});

test('circle vs box polygon overlaps', () => {
  makeLocalBox(boxA, 20, 20);
  const r = resultScratch();
  const hit = testCirclePolygonCollision(
    25, 0, 10,
    0, 0, 1, 0,
    boxA.vx, boxA.vy, boxA.nx, boxA.ny, 4, 0,
    r
  );
  assert.ok(hit);
  assert.ok(r.depth > 0);
});

test('circle vs box polygon misses when far', () => {
  makeLocalBox(boxA, 10, 10);
  const r = resultScratch();
  const hit = testCirclePolygonCollision(
    100, 100, 5,
    0, 0, 1, 0,
    boxA.vx, boxA.vy, boxA.nx, boxA.ny, 4, 0,
    r
  );
  assert.equal(hit, null);
});

test('axis-aligned box on floor contact is face center (not a corner)', () => {
  makeLocalBox(boxA, 20, 20); // 40x40 box
  makeLocalBox(boxB, 400, 20); // wide floor
  const r = resultScratch();
  const hit = testPolygonPolygonCollision(
    100, 70, 1, 0, boxA.vx, boxA.vy, boxA.nx, boxA.ny, 4, 0, 1600,
    100, 100, 1, 0, boxB.vx, boxB.vy, boxB.nx, boxB.ny, 4, 0, 32000,
    r
  );
  assert.ok(hit);
  assert.ok(r.depth > 0);
  // Smaller body only → contact on box bottom face center ≈ (100, 90)
  assert.ok(Math.abs(r.cx - 100) < 1, `cx=${r.cx} should be face center x`);
  assert.ok(Math.abs(r.nx) < 0.1 && r.ny < -0.9, `n=(${r.nx},${r.ny}) should push box up`);
});
