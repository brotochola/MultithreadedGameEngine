/**
 * 2D rotation helpers (cos/sin as unit complex). Zero alloc.
 */

/** Compose R0 * R1 into out = { c, s } (caller reuses out). */
export function composeRotTo(out, c0, s0, c1, s1) {
  out.c = c0 * c1 - s0 * s1;
  out.s = s0 * c1 + c0 * s1;
  return out;
}

/** Compose R0 * R1 into typed arrays at index. */
export function composeRotInto(c0, s0, c1, s1, cArr, sArr, index) {
  cArr[index] = c0 * c1 - s0 * s1;
  sArr[index] = s0 * c1 + c0 * s1;
}

/** Write cos/sin of radians into typed arrays at index. */
export function setRotCSFromAngle(cArr, sArr, index, angle) {
  cArr[index] = Math.cos(angle);
  sArr[index] = Math.sin(angle);
}

/**
 * Random unit complex into out = { c, s } (one cos/sin of uniform angle).
 * @param {{ c: number, s: number }} out
 */
export function randomUnitCS(out) {
  const a = Math.random() * Math.PI * 2;
  out.c = Math.cos(a);
  out.s = Math.sin(a);
  return out;
}
