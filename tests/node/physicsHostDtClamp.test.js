import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// physics_host.impl.js is a classic IIFE worker script (no import/export,
// guarded by `typeof weedjsEnableHostMode !== 'function'` early-return at the
// top) - not directly instantiable in a Node test the way ES-module workers
// like AbstractWorker.js are. Source-text assertion matches the existing
// convention for this exact situation (see gpuSortKeyNoCpuSort.test.js).
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const physicsHost = readFileSync(join(root, 'src/box2d/physics_host.impl.js'), 'utf8');

test('physics_host gameLoop dt ceiling tracks fixedFps instead of a hardcoded 20fps cap', () => {
  // Regression: gameLoop() used to do `if (dt > 1 / 20) dt = 1 / 20;`
  // unconditionally, silently re-capping a deliberately configured
  // physics.fixedFps below 20 - e.g. fixedFps:10 computed dt=0.1 (real
  // elapsed) but simulated only 0.05, running the sim at half real-time
  // speed instead of "same speed, bigger/rarer steps".
  assert.doesNotMatch(
    physicsHost,
    /var dt = deltaTime \/ 1000;\s*\n\s*if \(dt > 1 \/ 20\) dt = 1 \/ 20;/,
    'dt must not be unconditionally re-capped to a fixed 20fps-equivalent ceiling',
  );
  assert.match(
    physicsHost,
    /var maxDt = state\.fixedFps > 0 \? 1 \/ state\.fixedFps : 1 \/ 20;/,
    'dt ceiling must derive from state.fixedFps when a fixedFps is configured',
  );
  assert.match(physicsHost, /if \(dt > maxDt\) dt = maxDt;/);
});
