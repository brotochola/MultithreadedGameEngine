// Decal tilemap save helpers: sparse non-empty tiles as PNG (browser) or raw RGBA (Node).

function tileHasContent(rgba, byteOffset, bytesPerTile) {
  const end = byteOffset + bytesPerTile;
  for (let i = byteOffset + 3; i < end; i += 4) {
    if (rgba[i] !== 0) return true;
  }
  return false;
}

function canEncodePng() {
  return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

async function encodeTilePng(rgba, byteOffset, tilePixelSize, bytesPerTile) {
  const canvas = new OffscreenCanvas(tilePixelSize, tilePixelSize);
  const ctx = canvas.getContext('2d');
  const copy = new Uint8ClampedArray(bytesPerTile);
  copy.set(rgba.subarray(byteOffset, byteOffset + bytesPerTile));
  const imageData = new ImageData(copy, tilePixelSize, tilePixelSize);
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodeTilePng(bytes, tilePixelSize, bytesPerTile) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bitmap = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(tilePixelSize, tilePixelSize);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  const imageData = ctx.getImageData(0, 0, tilePixelSize, tilePixelSize);
  if (imageData.data.byteLength !== bytesPerTile) {
    throw new Error(
      `DecalSave: PNG decode size mismatch (got ${imageData.data.byteLength}, expected ${bytesPerTile})`
    );
  }
  return imageData.data;
}

/**
 * Pack non-empty decal tiles from scene SharedArrayBuffer.
 * Browser: PNG bytes per tile. Node / no OffscreenCanvas: raw RGBA bytes.
 * @param {object} scene
 * @returns {Promise<object|null>}
 */
export async function packDecalSnapshot(scene) {
  if (!scene?.config?.particle?.decals) return null;
  const sab = scene.buffers?.decalsTilesRGBA;
  if (!sab) return null;

  const tilesX = scene.decalsTilesX | 0;
  const tilesY = scene.decalsTilesY | 0;
  const totalTiles = scene.decalsTotalTiles | (tilesX * tilesY);
  const tilePixelSize = scene.config.particle.decalsTilePixelSize | 0;
  const tileSize = scene.config.particle.decalsTileSize | 0;
  if (!(totalTiles > 0) || !(tilePixelSize > 0)) return null;

  const bytesPerTile = tilePixelSize * tilePixelSize * 4;
  const rgba = new Uint8ClampedArray(sab);
  const usePng = canEncodePng();
  const tiles = [];

  for (let i = 0; i < totalTiles; i++) {
    const byteOffset = i * bytesPerTile;
    if (!tileHasContent(rgba, byteOffset, bytesPerTile)) continue;
    if (usePng) {
      const bytes = await encodeTilePng(rgba, byteOffset, tilePixelSize, bytesPerTile);
      tiles.push({ i, fmt: 'png', bytes });
    } else {
      tiles.push({
        i,
        fmt: 'raw',
        bytes: new Uint8Array(rgba.subarray(byteOffset, byteOffset + bytesPerTile)),
      });
    }
  }

  if (!tiles.length) return null;

  return {
    tilesX,
    tilesY,
    tilePixelSize,
    tileSize,
    tiles,
  };
}

/**
 * Restore packed decal tiles into scene SAB and mark dirty for pixi upload.
 * @param {object} scene
 * @param {object|null} blob
 * @returns {Promise<{ ok: boolean, restored: number, reason?: string }>}
 */
export async function applyDecalSnapshot(scene, blob) {
  if (!blob || !Array.isArray(blob.tiles) || !blob.tiles.length) {
    return { ok: true, restored: 0 };
  }
  if (!scene?.config?.particle?.decals) {
    console.warn('[DecalSave] decals disabled on scene; skip restore');
    return { ok: false, restored: 0, reason: 'decals-disabled' };
  }

  const tilesX = scene.decalsTilesX | 0;
  const tilesY = scene.decalsTilesY | 0;
  const tilePixelSize = scene.config.particle.decalsTilePixelSize | 0;
  if (
    (blob.tilesX | 0) !== tilesX ||
    (blob.tilesY | 0) !== tilesY ||
    (blob.tilePixelSize | 0) !== tilePixelSize
  ) {
    console.warn(
      `[DecalSave] layout mismatch (save=${blob.tilesX}x${blob.tilesY}@${blob.tilePixelSize}, live=${tilesX}x${tilesY}@${tilePixelSize}); skip`
    );
    return { ok: false, restored: 0, reason: 'layout-mismatch' };
  }

  const sab = scene.buffers?.decalsTilesRGBA;
  const dirtySab = scene.buffers?.decalsTilesDirty;
  if (!sab || !dirtySab) {
    return { ok: false, restored: 0, reason: 'no-buffers' };
  }

  const bytesPerTile = tilePixelSize * tilePixelSize * 4;
  const totalTiles = scene.decalsTotalTiles | (tilesX * tilesY);
  const rgba = new Uint8ClampedArray(sab);
  const dirty = new Uint8Array(dirtySab);
  let restored = 0;

  for (const tile of blob.tiles) {
    const i = tile.i | 0;
    if (i < 0 || i >= totalTiles || !tile.bytes) continue;
    const byteOffset = i * bytesPerTile;
    let pixels;
    if (tile.fmt === 'png') {
      if (!canEncodePng()) {
        console.warn('[DecalSave] PNG tile but OffscreenCanvas unavailable; skip tile', i);
        continue;
      }
      pixels = await decodeTilePng(tile.bytes, tilePixelSize, bytesPerTile);
    } else {
      pixels = tile.bytes instanceof Uint8Array ? tile.bytes : new Uint8Array(tile.bytes);
      if (pixels.byteLength !== bytesPerTile) {
        console.warn('[DecalSave] raw tile size mismatch; skip tile', i);
        continue;
      }
    }
    rgba.set(pixels, byteOffset);
    dirty[i] = 1;
    restored++;
  }

  return { ok: true, restored };
}
