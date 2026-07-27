import test from 'node:test';
import assert from 'node:assert/strict';

import { Collider } from '../../src/components/Collider.js';
import { RigidBody } from '../../src/components/RigidBody.js';
import { ShapeType, MAX_POLYGON_VERTICES } from '../../src/core/ConfigDefaults.js';

function initComponents(count = 4) {
  const cSize = Collider.getBufferSize(count);
  const rSize = RigidBody.getBufferSize(count);
  Collider.initializeArrays(new SharedArrayBuffer(cSize), count);
  RigidBody.initializeArrays(new SharedArrayBuffer(rSize), count);
  for (let i = 0; i < count; i++) {
    Collider.active[i] = 1;
    RigidBody.active[i] = 1;
    RigidBody.static[i] = 0;
  }
}

test('Collider.makeBox writes 4 verts and Polygon shapeType', () => {
  initComponents();
  assert.equal(MAX_POLYGON_VERTICES, 8);
  assert.ok(Collider.makeBox(0, 10, 20));
  assert.equal(Collider.shapeType[0], ShapeType.Polygon);
  assert.equal(Collider.polyCount[0], 4);
  assert.equal(Collider.width[0], 20);
  assert.equal(Collider.height[0], 40);
  assert.ok(RigidBody.mass[0] > 0);
  // Area = 20*40 = 800
  assert.ok(Math.abs(RigidBody.mass[0] - 800) < 1e-3);
});

test('Collider.makePolygon rejects bad count and accepts triangle', () => {
  initComponents();
  assert.equal(Collider.makePolygon(1, [{ x: 0, y: 0 }, { x: 1, y: 0 }]), false);
  assert.ok(Collider.makePolygon(1, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ]));
  assert.equal(Collider.polyCount[1], 3);
  assert.equal(Collider.shapeType[1], ShapeType.Polygon);
  assert.ok(RigidBody.mass[1] > 0);
});
