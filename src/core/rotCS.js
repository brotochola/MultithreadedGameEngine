/**
 * 2D rotation helpers (cos/sin as unit complex). Zero alloc when writing into outC/outS arrays.
 */

/** Compose R0 * R1 → (c,s). */
export function composeRot(c0, s0, c1, s1) {
  return {
    c: c0 * c1 - s0 * s1,
    s: s0 * c1 + c0 * s1,
  };
}

/** Compose into out floats (no object). */
export function composeRotInto(c0, s0, c1, s1, out, outCKey, outSKey) {
  out[outCKey] = c0 * c1 - s0 * s1;
  out[outSKey] = s0 * c1 + c0 * s1;
}

/** Write cos/sin of radians into typed arrays at index. */
export function setRotCSFromAngle(cArr, sArr, index, angle) {
  cArr[index] = Math.cos(angle);
  sArr[index] = Math.sin(angle);
}
