import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/workers/InstancedSpriteBatch.js'),
  'utf8'
);

test('normal fragment does not re-premultiply already-PMA atlas texels', () => {
  assert.match(src, /gl_FragColor = c;/);
  assert.doesNotMatch(src, /gl_FragColor\s*=\s*vec4\(\s*c\.rgb\s*\*\s*c\.a/);
});

test('additive fragment outputs PMA rgb with alpha 0 (no extra * a)', () => {
  assert.match(src, /gl_FragColor = vec4\(c\.rgb, 0\.0\);/);
});
