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
    /finalColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, a\);/
  );
  // Old bugs: passthrough (no instA on rgb) or double-premultiply (× combined a)
  assert.doesNotMatch(src, /finalColor = c;/);
  assert.doesNotMatch(src, /finalColor\s*=\s*vec4\(\s*c\.rgb\s*\*\s*c\.a/);
});

test('depth-write fragment discards clear texels; blend fragment does not', () => {
  assert.match(src, /FRAGMENT_SRC_BLEND/);
  assert.match(src, /if \(a < 0\.01\) discard;/);
  // Blend path: same PMA out without a discard line in that shader body
  assert.match(
    src,
    /FRAGMENT_SRC_BLEND = `[\s\S]*?float a = t\.a \* vColor\.a;\s*finalColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, a\);/
  );
  assert.match(src, /alphaDiscard = true/);
  assert.match(src, /alphaDiscard !== false \? FRAGMENT_SRC : FRAGMENT_SRC_BLEND/);
});

test('additive fragment scales PMA rgb by instance alpha, alpha forced 0', () => {
  assert.match(src, /finalColor = vec4\(t\.rgb \* vColor\.rgb \* vColor\.a, 0\.0\);/);
});

test('vertex shader uses aInstRotCS without cos/sin of angle', () => {
  assert.match(src, /in vec2 aInstRotCS/);
  assert.match(src, /float c = aInstRotCS\.x/);
  assert.doesNotMatch(src, /cos\(aInstRot\)/);
  assert.match(src, /INSTANCED_SPRITE_FLOATS = 13/);
  assert.match(src, /this\.buffer\.update\(out \* INSTANCED_SPRITE_STRIDE\)/);
  assert.match(src, /aInstTileInv/);
  assert.match(src, /fract\(vWorld\.x \* vTileInv\.x\)/);
  assert.match(src, /texelFetch\(uTexLut/);
  assert.match(src, /floatBitsToUint\(aInstTintBits\)/);
  assert.match(src, /#version 300 es/);
  assert.match(src, /out vec4 finalColor/);
  assert.match(src, /uint tintBits/);
  assert.doesNotMatch(src, /uint packed /);
});

test('ctor sets State.depthMask; upload excludeType accepts a list; indices skip filter', () => {
  assert.match(src, /depthMask = true/);
  assert.match(src, /state\.depthMask = depthMask !== false/);
  assert.match(src, /typeof excludeRaw === 'number' \? \[excludeRaw\] : excludeRaw/);
  assert.match(src, /opts\.indices/);
  assert.match(src, /useIndices/);
});

const pixiSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/workers/pixi_worker.js'),
  'utf8'
);

test('particle batch: no Z write, no alpha discard; main queue partitions type 1/3', () => {
  assert.match(pixiSrc, /t === 1\) idxP\[np\+\+\]/);
  assert.match(pixiSrc, /t === 3\) idxG\[ng\+\+\]/);
  assert.match(pixiSrc, /indices: idxP/);
  assert.match(pixiSrc, /indices: idxG/);
  assert.match(pixiSrc, /depthMask: false/);
  assert.match(pixiSrc, /alphaDiscard: false/);
  assert.match(pixiSrc, /entitiesParticleBatch/);
});

test('entity and custom-layer uploads pass queue repeatX/Y', () => {
  assert.match(pixiSrc, /this\.renderQueueRepeatX = buffer\.repeatX/);
  assert.match(pixiSrc, /repeatX: this\.renderQueueRepeatX/);
  assert.match(pixiSrc, /repeatY: this\.renderQueueRepeatY/);
  assert.match(pixiSrc, /repeatX: ref\.repeatX/);
  assert.match(pixiSrc, /repeatY: ref\.repeatY/);
});

test('pixi binds packed LUT as rgba32float TextureSource', () => {
  assert.match(pixiSrc, /packTextureLutRgba/);
  assert.match(pixiSrc, /TEX_LUT_RGBA_WIDTH/);
  assert.match(pixiSrc, /setLutSource/);
  assert.match(pixiSrc, /format: 'rgba32float'/);
  assert.match(pixiSrc, /_uploadTexLutTexture/);
  assert.match(pixiSrc, /uploadMethodId = 'unknown'/);
});

test('packTextureLutRgba writes 10 floats into 3 RGBA32F texels', async () => {
  const { packTextureLutRgba, TEX_LUT_FLOATS } = await import(
    '../../src/workers/InstancedSpriteBatch.js'
  );
  const lut = new Float32Array(TEX_LUT_FLOATS);
  for (let i = 0; i < TEX_LUT_FLOATS; i++) lut[i] = i + 1;
  const rgba = packTextureLutRgba(lut, 1);
  assert.equal(rgba.length, 12);
  for (let i = 0; i < 10; i++) assert.equal(rgba[i], i + 1);
  assert.equal(rgba[10], 0);
  assert.equal(rgba[11], 0);
});
