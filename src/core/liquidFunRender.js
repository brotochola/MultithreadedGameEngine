/** Thin LiquidFun render SAB. Not ParticleComponent. Size = physics.liquidFun.maxCount. */

export function liquidFunRenderByteSize(maxCount) {
  const n = maxCount | 0;
  const header = 8;
  const bytes = header + 7 * n * 4 + n * 4 + n * 2;
  return (bytes + 3) & ~3;
}

export function bindLiquidFunRender(sab, maxCount) {
  const n = maxCount | 0;
  let off = 8;
  const count = new Int32Array(sab, 0, 1);
  const x = new Float32Array(sab, off, n);
  off += n * 4;
  const y = new Float32Array(sab, off, n);
  off += n * 4;
  const scaleX = new Float32Array(sab, off, n);
  off += n * 4;
  const scaleY = new Float32Array(sab, off, n);
  off += n * 4;
  const rotC = new Float32Array(sab, off, n);
  off += n * 4;
  const rotS = new Float32Array(sab, off, n);
  off += n * 4;
  const alpha = new Float32Array(sab, off, n);
  off += n * 4;
  const tint = new Uint32Array(sab, off, n);
  off += n * 4;
  const textureId = new Uint16Array(sab, off, n);
  return { count, x, y, scaleX, scaleY, rotC, rotS, alpha, tint, textureId, maxCount: n };
}
