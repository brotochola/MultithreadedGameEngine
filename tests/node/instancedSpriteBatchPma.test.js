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
  assert.match(
    src,
    /gl_FragColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, t\.a \* vColor\.a\);/
  );
  // Old bugs: passthrough (no instA on rgb) or double-premultiply (× combined a)
  assert.doesNotMatch(src, /gl_FragColor = c;/);
  assert.doesNotMatch(src, /gl_FragColor\s*=\s*vec4\(\s*c\.rgb\s*\*\s*c\.a/);
});

test('additive fragment scales PMA rgb by instance alpha, alpha forced 0', () => {
  assert.match(src, /gl_FragColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, 0\.0\);/);
});
