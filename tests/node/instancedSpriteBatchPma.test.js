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
