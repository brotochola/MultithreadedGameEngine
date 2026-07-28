// ESM facade over box2dCommandRing.impl.js (one logic source for importScripts + import).
import './box2dCommandRing.impl.js';

const R = globalThis.Box2dCommandRing;

export const BOX2D_CMD = R.BOX2D_CMD;
export const BOX2D_CMD_HEADER_I32 = R.BOX2D_CMD_HEADER_I32;
export const BOX2D_CMD_STRIDE_I32 = R.BOX2D_CMD_STRIDE_I32;
export const BOX2D_CMD_DEFAULT_CAPACITY = R.BOX2D_CMD_DEFAULT_CAPACITY;
export const createCommandRingSab = R.createCommandRingSab;
export const bindCommandRing = R.bindCommandRing;
export const isCommandRingBound = R.isCommandRingBound;
export const enqueueSetTransform = R.enqueueSetTransform;
export const enqueueSetVelocity = R.enqueueSetVelocity;
export const enqueueSetAngle = R.enqueueSetAngle;
export const enqueueSetAngularVelocity = R.enqueueSetAngularVelocity;
export const drainCommandRing = R.drainCommandRing;
