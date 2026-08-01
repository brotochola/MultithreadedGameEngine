// Bind Weed Transform / RigidBody hot views onto Box2D WASM HEAP channels.
// Pre-box2dReady: local placeholders (allocateBox2dHotFieldPlaceholders / component init).
// Post-box2dReady: HEAP views; bind copies placeholder writes into HEAP.
// Units: px, px/s, rad, rad/s (Box2D native).

import { Transform } from '../components/Transform.js';
import { RigidBody } from '../components/RigidBody.js';
import { STATE_CHANNELS } from './box2dConstants.js';

export { STATE_CHANNELS };

/**
 * Local typed arrays so setup()/spawn can write pose/vel before box2dReady.
 * @param {number} count
 */
export function allocateBox2dHotFieldPlaceholders(count) {
  const n = count | 0;
  if (!(n > 0)) return;
  Transform.x = new Float32Array(n);
  Transform.y = new Float32Array(n);
  Transform.rotation = new Float32Array(n);
  RigidBody.vx = new Float32Array(n);
  RigidBody.vy = new Float32Array(n);
  RigidBody.angularVelocity = new Float32Array(n);
  RigidBody.sleeping = new Uint8Array(n);
}

function copyInto(dst, src, n) {
  if (!src || !dst) return;
  const len = Math.min(n, src.length, dst.length);
  if (len <= 0) return;
  dst.set(src.subarray(0, len));
}

/**
 * @param {{
 *   sab: SharedArrayBuffer,
 *   channelOffsets: number[],
 *   sleepingByteOffset: number,
 *   bodyCapacity: number,
 * }} payload
 * @param {{ seedFromPlaceholders?: boolean }} [opts]
 *   seedFromPlaceholders: copy local setup()/init writes into HEAP.
 *   Only logic should set true — other workers' zero placeholders would wipe HEAP.
 */
export function bindBox2dHotFields(payload, opts = {}) {
  const sab = payload.sab;
  const off = payload.channelOffsets;
  const n = payload.bodyCapacity | 0;
  if (!sab || !off || !(n > 0)) {
    throw new Error('bindBox2dHotFields: invalid payload');
  }

  const prevX = Transform.x;
  const prevY = Transform.y;
  const prevRot = Transform.rotation;
  const prevVx = RigidBody.vx;
  const prevVy = RigidBody.vy;
  const prevAng = RigidBody.angularVelocity;
  const prevSleep = RigidBody.sleeping;

  Transform.x = new Float32Array(sab, off[STATE_CHANNELS.X] << 2, n);
  Transform.y = new Float32Array(sab, off[STATE_CHANNELS.Y] << 2, n);
  Transform.rotation = new Float32Array(
    sab,
    off[STATE_CHANNELS.ROTATION] << 2,
    n,
  );
  RigidBody.vx = new Float32Array(sab, off[STATE_CHANNELS.VX] << 2, n);
  RigidBody.vy = new Float32Array(sab, off[STATE_CHANNELS.VY] << 2, n);
  RigidBody.angularVelocity = new Float32Array(
    sab,
    off[STATE_CHANNELS.ANG_VEL] << 2,
    n,
  );

  if (payload.sleepingByteOffset >= 0) {
    RigidBody.sleeping = new Uint8Array(sab, payload.sleepingByteOffset, n);
  }

  if (prevX?.buffer === sab) return;
  if (!opts.seedFromPlaceholders) return;

  copyInto(Transform.x, prevX, n);
  copyInto(Transform.y, prevY, n);
  copyInto(Transform.rotation, prevRot, n);
  copyInto(RigidBody.vx, prevVx, n);
  copyInto(RigidBody.vy, prevVy, n);
  copyInto(RigidBody.angularVelocity, prevAng, n);
  if (RigidBody.sleeping && prevSleep) {
    copyInto(RigidBody.sleeping, prevSleep, n);
  }
}

export function isBox2dHotFieldsBound(payload) {
  return !!(payload?.sab && Transform.x?.buffer === payload.sab);
}
