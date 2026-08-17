import test from 'node:test';
import assert from 'node:assert/strict';
import { TileMap } from '../../src/core/TileMap.js';

function makeMap(w, h) {
  const map = new TileMap(0, 'test', w, h, 16, 16, [{ firstgid: 1, columns: 8 }]);
  const data = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = 1; // every cell filled
    }
  }
  map._layers.push({
    name: 'ground',
    data,
    mapWidth: w,
    mapHeight: h,
    tileWidth: 16,
    tileHeight: 16,
    visible: true,
    opacity: 1,
  });
  return map;
}

test('buildCompositeTilemap without tileRect emits full map', () => {
  const map = makeMap(10, 8);
  const tiles = [];
  map.buildCompositeTilemap(
    { tile(_tex, x, y) { tiles.push([x / 16, y / 16]); } },
    {}
  );
  assert.equal(tiles.length, 80);
});

test('buildCompositeTilemap tileRect only emits that range (max exclusive)', () => {
  const map = makeMap(20, 15);
  const tiles = [];
  map.buildCompositeTilemap(
    { tile(_tex, x, y) { tiles.push([x / 16, y / 16]); } },
    { tileRect: { minX: 3, minY: 2, maxX: 7, maxY: 5 } }
  );
  assert.equal(tiles.length, 4 * 3);
  for (const [tx, ty] of tiles) {
    assert.ok(tx >= 3 && tx < 7);
    assert.ok(ty >= 2 && ty < 5);
  }
});

test('buildCompositeTilemap clamps tileRect to map bounds', () => {
  const map = makeMap(5, 5);
  const tiles = [];
  map.buildCompositeTilemap(
    { tile(_tex, x, y) { tiles.push([x / 16, y / 16]); } },
    { tileRect: { minX: -10, minY: -10, maxX: 100, maxY: 100 } }
  );
  assert.equal(tiles.length, 25);
});
