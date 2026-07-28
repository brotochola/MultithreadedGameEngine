// Box2D command ring — interim SharedArrayBuffer (STOP 4).
// Writers: GameObject / logic / main. Reader: weedjs_post drain pre-step.
// Units: px, px/s, rad, rad/s.

export const BOX2D_CMD = Object.freeze({
  SET_TRANSFORM: 1, // entity, x, y, angle
  SET_VELOCITY: 2, // entity, vx, vy
  SET_ANGLE: 3, // entity, angle
  SET_ANGULAR_VELOCITY: 4, // entity, w
});

/** Header i32 slots before command payload. */
export const BOX2D_CMD_HEADER_I32 = 4;
/** Per-command i32 slots (opcode, entity, 4×f32 bitcast, pad×2). */
export const BOX2D_CMD_STRIDE_I32 = 8;
export const BOX2D_CMD_DEFAULT_CAPACITY = 4096;

const HDR_WRITE = 0;
const HDR_READ = 1;
const HDR_CAP = 2;
const HDR_OVERFLOW = 3;

let ringI32 = null;
let ringF32 = null;
let capacity = 0;

/**
 * @param {number} [cmdCapacity]
 * @returns {SharedArrayBuffer}
 */
export function createCommandRingSab(cmdCapacity = BOX2D_CMD_DEFAULT_CAPACITY) {
  const cap = Math.max(64, cmdCapacity | 0);
  const bytes = (BOX2D_CMD_HEADER_I32 + cap * BOX2D_CMD_STRIDE_I32) * 4;
  const sab = new SharedArrayBuffer(bytes);
  const i32 = new Int32Array(sab);
  Atomics.store(i32, HDR_WRITE, 0);
  Atomics.store(i32, HDR_READ, 0);
  Atomics.store(i32, HDR_CAP, cap);
  Atomics.store(i32, HDR_OVERFLOW, 0);
  return sab;
}

/**
 * Bind this worker/thread to an existing ring SAB.
 * @param {SharedArrayBuffer|null} sab
 */
export function bindCommandRing(sab) {
  if (!sab) {
    ringI32 = null;
    ringF32 = null;
    capacity = 0;
    return;
  }
  ringI32 = new Int32Array(sab);
  ringF32 = new Float32Array(sab);
  capacity = Atomics.load(ringI32, HDR_CAP) | 0;
}

export function isCommandRingBound() {
  return ringI32 != null && capacity > 0;
}

function enqueue(opcode, entity, a, b, c, d) {
  if (!ringI32) return false;
  const cap = capacity;
  const write = Atomics.load(ringI32, HDR_WRITE);
  const read = Atomics.load(ringI32, HDR_READ);
  const next = (write + 1) % cap;
  if (next === (read % cap)) {
    Atomics.add(ringI32, HDR_OVERFLOW, 1);
    return false;
  }
  const base = BOX2D_CMD_HEADER_I32 + write * BOX2D_CMD_STRIDE_I32;
  ringI32[base] = opcode | 0;
  ringI32[base + 1] = entity | 0;
  ringF32[base + 2] = a;
  ringF32[base + 3] = b;
  ringF32[base + 4] = c;
  ringF32[base + 5] = d;
  Atomics.store(ringI32, HDR_WRITE, next);
  return true;
}

export function enqueueSetTransform(entity, x, y, angle = 0) {
  return enqueue(BOX2D_CMD.SET_TRANSFORM, entity, x, y, angle, 0);
}

export function enqueueSetVelocity(entity, vx, vy) {
  return enqueue(BOX2D_CMD.SET_VELOCITY, entity, vx, vy, 0, 0);
}

export function enqueueSetAngle(entity, angle) {
  return enqueue(BOX2D_CMD.SET_ANGLE, entity, angle, 0, 0, 0);
}

export function enqueueSetAngularVelocity(entity, w) {
  return enqueue(BOX2D_CMD.SET_ANGULAR_VELOCITY, entity, w, 0, 0, 0);
}

/**
 * Drain for classic weedjs_post (pass TypedArrays + handlers).
 * @returns {number} commands applied
 */
export function drainCommandRing(i32, f32, handlers) {
  if (!i32 || !f32 || !handlers) return 0;
  const cap = i32[HDR_CAP] | 0;
  if (!(cap > 0)) return 0;
  let read = Atomics.load(i32, HDR_READ);
  const write = Atomics.load(i32, HDR_WRITE);
  let n = 0;
  while (read !== write) {
    const base = BOX2D_CMD_HEADER_I32 + read * BOX2D_CMD_STRIDE_I32;
    const op = i32[base] | 0;
    const entity = i32[base + 1] | 0;
    const a = f32[base + 2];
    const b = f32[base + 3];
    const c = f32[base + 4];
    const d = f32[base + 5];
    switch (op) {
      case BOX2D_CMD.SET_TRANSFORM:
        handlers.setTransform?.(entity, a, b, c);
        break;
      case BOX2D_CMD.SET_VELOCITY:
        handlers.setVelocity?.(entity, a, b);
        break;
      case BOX2D_CMD.SET_ANGLE:
        handlers.setAngle?.(entity, a);
        break;
      case BOX2D_CMD.SET_ANGULAR_VELOCITY:
        handlers.setAngularVelocity?.(entity, a);
        break;
      default:
        break;
    }
    read = (read + 1) % cap;
    n++;
  }
  Atomics.store(i32, HDR_READ, read);
  return n;
}
