import test from 'node:test';
import assert from 'node:assert/strict';

import { Camera } from '../../src/core/Camera.js';
import { Mouse } from '../../src/core/Mouse.js';

function setupCamera({ zoom = 1, cx = 400, cy = 300, canvasW = 800, canvasH = 600 } = {}) {
  const data = new Float32Array(6);
  data[0] = zoom;
  data[1] = cx - canvasW / (2 * zoom);
  data[2] = cy - canvasH / (2 * zoom);
  data[3] = cx;
  data[4] = cy;
  data[5] = zoom;
  Camera.initialize(data, canvasW, canvasH);
  Camera.worldWidth = Infinity;
  Camera.worldHeight = Infinity;
  return data;
}

test('follow lerps zoom toward targetZoom (does not snap)', () => {
  setupCamera({ zoom: 1, cx: 400, cy: 300 });
  Camera.targetZoom = 2;

  Camera.follow(400, 300, 0.15, 1);

  assert.notEqual(Camera.zoom, 1);
  assert.notEqual(Camera.zoom, Camera.targetZoom);
  assert.ok(Camera.zoom > 1 && Camera.zoom < 2);
});

test('follow keeps screen-center world point stable across a zoom lerp step', () => {
  setupCamera({ zoom: 1, cx: 400, cy: 300 });
  const beforeX = Camera.centerX;
  const beforeY = Camera.centerY;

  Camera.targetZoom = 2;
  Camera.follow(400, 300, 0.15, 1);

  assert.ok(Math.abs(Camera.centerX - beforeX) < 1e-4);
  assert.ok(Math.abs(Camera.centerY - beforeY) < 1e-4);
});

test('updateFree wheel writes targetZoom and lets follow lerp (no setZoom snap)', () => {
  setupCamera({ zoom: 1, cx: 400, cy: 300 });
  Mouse.initialize(new Float32Array(13));
  Mouse.wheel = 100; // one typical notch worth of deltaY

  Camera.setFree(true, { zoomSensitivity: 0.001, smoothing: 0.15 });
  Camera.setFreeTarget(400, 300);

  const zoomBefore = Camera.zoom;
  Camera.updateFree(1);

  assert.notEqual(Camera.targetZoom, zoomBefore);
  assert.notEqual(Camera.zoom, Camera.targetZoom);
  assert.ok(Math.abs(Camera.zoom - zoomBefore) > 1e-6);
  assert.ok(Math.abs(Camera.zoom - Camera.targetZoom) > 1e-6);

  Camera.setFree(false);
  Mouse.wheel = 0;
});
