// LiquidFunSystem.js - High level API for Box2D LiquidFun particle physics systems in WeedJS

import { Box2dCommandRing } from '../box2d/box2dCommandRing.js';

// Bits match liquidfun-c lfParticleFlag (not Google LiquidFun's extra listener bits).
export const LIQUIDFUN_FLAGS = Object.freeze({
  WATER: 0,
  ZOMBIE: 1 << 0,
  WALL: 1 << 1,
  VISCOUS: 1 << 2,
  TENSILE: 1 << 3,
  ELASTIC: 1 << 4,
  POWDER: 1 << 5,
  SPRING: 1 << 6,
});

export class LiquidFunSystem {
  /**
   * Initializes or configures a LiquidFun particle system in the Box2D physics engine.
   * @param {Object} options
   * @param {number} [options.radius=10] - Particle radius in world units / pixels.
   * @param {number} [options.maxCount=5000] - Maximum capacity of particles.
   * @param {number} [options.subSteps=2] - Sub-steps for fluid simulation integration.
   * @param {number} [options.systemId=0] - Particle system handle ID.
   */
  static createSystem({ radius = 10, maxCount = 5000, subSteps = 2, systemId = 0 } = {}) {
    Box2dCommandRing.enqueueCreateParticleSystem(systemId, radius, maxCount, subSteps);
  }

  /**
   * Spawns a rectangular group of LiquidFun particles.
   * @param {Object} options
   * @param {number} options.posX - Center X position.
   * @param {number} options.posY - Center Y position.
   * @param {number} options.halfWidth - Half-width of the box.
   * @param {number} options.halfHeight - Half-height of the box.
   * @param {number} [options.flags=0] - Bitfield of LIQUIDFUN_FLAGS.
   * @param {number} [options.systemId=0]
   */
  static createParticleBox({ posX, posY, halfWidth, halfHeight, flags = LIQUIDFUN_FLAGS.WATER, systemId = 0 }) {
    Box2dCommandRing.enqueueCreateParticleGroupBox(systemId, posX, posY, halfWidth, halfHeight, flags);
  }

  /**
   * Spawns a circular group of LiquidFun particles.
   * @param {Object} options
   * @param {number} options.posX - Center X position.
   * @param {number} options.posY - Center Y position.
   * @param {number} options.radius - Radius of the particle group.
   * @param {number} [options.flags=0] - Bitfield of LIQUIDFUN_FLAGS.
   * @param {number} [options.systemId=0]
   */
  static createParticleCircle({ posX, posY, radius, flags = LIQUIDFUN_FLAGS.WATER, systemId = 0 }) {
    Box2dCommandRing.enqueueCreateParticleGroupCircle(systemId, posX, posY, radius, flags);
  }

  /**
   * Destroys a liquidfun particle group.
   * @param {number} groupId
   * @param {number} [systemId=0]
   */
  static destroyGroup(groupId, systemId = 0) {
    Box2dCommandRing.enqueueDestroyParticleGroup(systemId, groupId);
  }

  /**
   * Destroys the LiquidFun particle system.
   * @param {number} [systemId=0]
   */
  static destroySystem(systemId = 0) {
    Box2dCommandRing.enqueueDestroyParticleSystem(systemId);
  }
}
