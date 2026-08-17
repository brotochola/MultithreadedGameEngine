import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/workers/InstancedSpriteBatch.js'),
  'utf8'
);

test('normal fragment scales PMA rgb by instance alpha without re-multiplying tex.a', () => {
  assert.match(src, /float a = t\.a \* vColor\.a;/);
  assert.match(
    src,
    /gl_FragColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, a\);/
  );
  // Old bugs: passthrough (no instA on rgb) or double-premultiply (× combined a)
  assert.doesNotMatch(src, /gl_FragColor = c;/);
  assert.doesNotMatch(src, /gl_FragColor\s*=\s*vec4\(\s*c\.rgb\s*\*\s*c\.a/);
});

test('depth-write fragment discards clear texels; blend fragment does not', () => {
  assert.match(src, /FRAGMENT_SRC_BLEND/);
  assert.match(src, /if \(a < 0\.01\) discard;/);
  // Blend path: same PMA out without a discard line in that shader body
  assert.match(
    src,
    /FRAGMENT_SRC_BLEND = `[\s\S]*?float a = t\.a \* vColor\.a;\s*gl_FragColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, a\);/
  );
  assert.match(src, /alphaDiscard = true/);
  assert.match(src, /alphaDiscard !== false \? FRAGMENT_SRC : FRAGMENT_SRC_BLEND/);
});

test('additive fragment scales PMA rgb by instance alpha, alpha forced 0', () => {
  assert.match(src, /gl_FragColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, 0\.0\);/);
});

test('vertex shader uses aInstRotCS without cos/sin of angle', () => {
  assert.match(src, /in vec2 aInstRotCS/);
  assert.match(src, /float c = aInstRotCS\.x/);
  assert.doesNotMatch(src, /cos\(aInstRot\)/);
  assert.match(src, /INSTANCED_SPRITE_FLOATS = 23/);
  assert.match(src, /this\.buffer\.update\(out \* INSTANCED_SPRITE_STRIDE\)/);
});

test('ctor sets State.depthMask; upload excludeType accepts a list', () => {
  assert.match(src, /depthMask = true/);
  assert.match(src, /state\.depthMask = depthMask !== false/);
  assert.match(src, /typeof excludeRaw === 'number' \? \[excludeRaw\] : excludeRaw/);
});

const pixiSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/workers/pixi_worker.js'),
  'utf8'
);

test('particle batch: no Z write, no alpha discard; ENTITIES excludes type 1', () => {
  assert.match(pixiSrc, /excludeType: \[1, 3\]/);
  assert.match(pixiSrc, /includeType: 1/);
  assert.match(pixiSrc, /depthMask: false/);
  assert.match(pixiSrc, /alphaDiscard: false/);
  assert.match(pixiSrc, /entitiesParticleBatch/);
});
