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
export const setAssertRotCSUnit = R.setAssertRotCSUnit;
export const enqueueSetTransform = R.enqueueSetTransform;
export const enqueueSetVelocity = R.enqueueSetVelocity;
export const enqueueSetRotCS = R.enqueueSetRotCS;
export const enqueueSetAngularVelocity = R.enqueueSetAngularVelocity;
export const enqueueSetFixedRotation = R.enqueueSetFixedRotation;
export const enqueueExplode = R.enqueueExplode;
export const enqueueSetSleepThreshold = R.enqueueSetSleepThreshold;
export const enqueueCreateParticleSystem = R.enqueueCreateParticleSystem;
export const enqueueSetLiquidFunEmit = R.enqueueSetLiquidFunEmit;
export const enqueueSetLiquidFunLifespan = R.enqueueSetLiquidFunLifespan;
export const enqueueCreateParticleGroupBox = R.enqueueCreateParticleGroupBox;
export const enqueueCreateParticleGroupCircle = R.enqueueCreateParticleGroupCircle;
export const enqueueDestroyParticleGroup = R.enqueueDestroyParticleGroup;
export const enqueueDestroyParticleSystem = R.enqueueDestroyParticleSystem;
export const drainCommandRing = R.drainCommandRing;
export const Box2dCommandRing = R;
export default R;
