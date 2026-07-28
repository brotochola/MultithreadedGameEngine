// Rebind Weed Transform / RigidBody hot SoA views onto Box2D WASM HEAP channels.
// Units: px, px/s, rad, rad/s (Box2D native).

import { Transform } from '../components/Transform.js';
import { RigidBody } from '../components/RigidBody.js';
import { STATE_CHANNELS } from './box2dConstants.js';

export { STATE_CHANNELS };

/**
 * @param {{
 *   sab: SharedArrayBuffer,
 *   channelOffsets: number[],
 *   sleepingByteOffset: number,
 *   bodyCapacity: number,
 * }} payload
 */
export function rebindBox2dHotFields(payload) {
  const sab = payload.sab;
  const off = payload.channelOffsets;
  const n = payload.bodyCapacity | 0;
  if (!sab || !off || !(n > 0)) {
    throw new Error('rebindBox2dHotFields: invalid payload');
  }

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
}
