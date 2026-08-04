import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const preRender = readFileSync(join(root, 'src/workers/pre_render_worker.js'), 'utf8');
const pixi = readFileSync(join(root, 'src/workers/pixi_worker.js'), 'utf8');
const defaults = readFileSync(join(root, 'src/core/ConfigDefaults.js'), 'utf8');

test('main ENTITIES queue does not CPU-heapsort; GPU sortKey path', () => {
  assert.doesNotMatch(preRender, /_heapsortRenderables|_heapsortCollector/);
  assert.doesNotMatch(preRender, /instancedSprites\s*!==\s*false/);
  assert.match(preRender, /sortTimeThisFrame = 0/);
  assert.match(preRender, /rqSortKey\[out\] = sk/);
});

test('custom layers write sortKey and skip CPU heapsort', () => {
  assert.match(preRender, /layerRef\.sortKey = rqSortKey/);
  assert.doesNotMatch(preRender, /Y-sort \(per-layer policy\)/);
});

test('pixi custom layers use sortKey depth when layer.ySorting', () => {
  assert.match(pixi, /depthTest: layerYSort/);
  assert.match(pixi, /depthMode: useSortKey \? 'sortKey' : 'index'/);
  assert.doesNotMatch(pixi, /this\.instancedSprites\s*=/);
});

test('instancedSprites config flag removed (always instanced)', () => {
  assert.doesNotMatch(defaults, /instancedSprites/);
  assert.doesNotMatch(defaults, /\binterpolation\s*:/);
});
