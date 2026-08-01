import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT_DATA_TEX_HEIGHT,
  lightDataTextureFloatCount,
  packLightDataTexel,
  readLightDataTexel,
} from '../../src/core/utils.js';

test('light data texture pack/read matches 2-row RGBA32F layout', () => {
  const maxLights = 4;
  assert.equal(LIGHT_DATA_TEX_HEIGHT, 2);
  assert.equal(lightDataTextureFloatCount(maxLights), maxLights * 2 * 4);

  const data = new Float32Array(lightDataTextureFloatCount(maxLights));
  packLightDataTexel(data, maxLights, 0, 10, 20, 5000, 1, 0.5, 0.25);
  packLightDataTexel(data, maxLights, 2, -3, 7.5, 10000, 0, 1, 0);

  // Row 0 is contiguous floats [0 .. maxLights*4)
  assert.deepEqual(Array.from(data.subarray(0, 4)), [10, 20, 5000, 0]);
  assert.deepEqual(Array.from(data.subarray(8, 12)), [-3, 7.5, 10000, 0]);

  // Row 1 starts at maxLights * 4
  assert.deepEqual(Array.from(data.subarray(maxLights * 4, maxLights * 4 + 4)), [
    1, 0.5, 0.25, 0,
  ]);
  assert.deepEqual(
    Array.from(data.subarray(maxLights * 4 + 8, maxLights * 4 + 12)),
    [0, 1, 0, 0]
  );

  const a = readLightDataTexel(data, maxLights, 0);
  assert.equal(a.x, 10);
  assert.equal(a.y, 20);
  assert.equal(a.intensity, 5000);
  assert.equal(a.r, 1);
  assert.equal(a.g, 0.5);
  assert.equal(a.b, 0.25);

  const b = readLightDataTexel(data, maxLights, 2);
  assert.equal(b.x, -3);
  assert.equal(b.y, 7.5);
  assert.equal(b.intensity, 10000);
  assert.equal(b.r, 0);
  assert.equal(b.g, 1);
  assert.equal(b.b, 0);
});
