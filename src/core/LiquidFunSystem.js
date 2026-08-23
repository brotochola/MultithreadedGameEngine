// LiquidFunSystem.js - High level API for Box2D LiquidFun particle physics systems in WeedJS

import { Box2dCommandRing } from '../box2d/box2dCommandRing.js';
import { SpriteSheetRegistry } from './SpriteSheetRegistry.js';

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
  BARRIER: 1 << 7,
  STATIC_PRESSURE: 1 << 8,
});

/** Presets use flags we actually have. Tint is 0xRRGGBB. */
export const LIQUIDFUN_MATERIALS = Object.freeze({
  water: Object.freeze({ flags: LIQUIDFUN_FLAGS.WATER | LIQUIDFUN_FLAGS.TENSILE, strength: 0, tint: 0x3399ff }),
  oil: Object.freeze({ flags: LIQUIDFUN_FLAGS.VISCOUS, strength: 0, tint: 0x6b3a1f }),
  cream: Object.freeze({ flags: LIQUIDFUN_FLAGS.VISCOUS | LIQUIDFUN_FLAGS.TENSILE, strength: 0.2, tint: 0xf5f0e1 }),
  dulceDeLeche: Object.freeze({ flags: LIQUIDFUN_FLAGS.VISCOUS | LIQUIDFUN_FLAGS.TENSILE, strength: 0.4, tint: 0xc6862a }),
  jelly: Object.freeze({ flags: LIQUIDFUN_FLAGS.ELASTIC, strength: 0.55, tint: 0x33ff66 }),
  sand: Object.freeze({ flags: LIQUIDFUN_FLAGS.POWDER, strength: 0, tint: 0xffcc00 }),
});

function resolveEmit(options) {
  const o = options || {};
  const preset = o.material ? LIQUIDFUN_MATERIALS[o.material] : null;
  let textureId = o.textureId | 0;
  if (!textureId && o.texture) {
    textureId = SpriteSheetRegistry.getTextureId(o.texture) | 0;
  }
  return {
    posX: o.posX,
    posY: o.posY,
    halfWidth: o.halfWidth,
    halfHeight: o.halfHeight,
    radius: o.radius,
    systemId: o.systemId || 0,
    flags: o.flags != null ? o.flags : preset ? preset.flags : LIQUIDFUN_FLAGS.WATER,
    spacing: o.spacing != null ? o.spacing : 0,
    strength: o.strength != null ? o.strength : preset ? preset.strength : 0,
    tint: o.tint != null ? o.tint : preset ? preset.tint : 0,
    textureId,
  };
}

function enqueueEmitParams(resolved) {
  Box2dCommandRing.enqueueSetLiquidFunEmit(
    resolved.spacing,
    resolved.strength,
    resolved.tint,
    resolved.textureId,
  );
}

export class LiquidFunSystem {
  /**
   * Initializes or configures a LiquidFun particle system in the Box2D physics engine.
   * Prefer `physics.liquidFun.enabled` at scene boot; this is the manual / late-create path.
   * @param {Object} options
   * @param {number} [options.radius=10] - Particle radius in world units / pixels.
   * @param {number} [options.maxCount=10000] - Maximum capacity of particles.
   * @param {number} [options.subSteps=1] - Particle solver sub-steps (not Box2D subStepCount).
   * @param {number} [options.systemId=0] - Particle system handle ID.
   */
  static createSystem({ radius = 10, maxCount = 10000, subSteps = 1, systemId = 0 } = {}) {
    Box2dCommandRing.enqueueCreateParticleSystem(systemId, radius, maxCount, subSteps);
  }

  /**
   * Spawns a rectangular group of LiquidFun particles.
   * Elastic/spring allocate a group; water/oil/cream/powder append ungrouped.
   * @param {Object} options
   * @param {string} [options.material] - Preset key in LIQUIDFUN_MATERIALS.
   * @param {number} [options.spacing=0] - 0 → C rest stride (0.75 × diameter).
   * @param {number} [options.strength]
   * @param {number} [options.tint]
   * @param {number} [options.textureId]
   * @param {string} [options.texture] - Resolved via SpriteSheetRegistry if textureId omitted.
   */
  static createParticleBox(options) {
    const r = resolveEmit(options);
    enqueueEmitParams(r);
    Box2dCommandRing.enqueueCreateParticleGroupBox(
      r.systemId,
      r.posX,
      r.posY,
      r.halfWidth,
      r.halfHeight,
      r.flags,
    );
  }

  /**
   * Spawns a circular group of LiquidFun particles.
   * Same emit fields as createParticleBox.
   */
  static createParticleCircle(options) {
    const r = resolveEmit(options);
    enqueueEmitParams(r);
    Box2dCommandRing.enqueueCreateParticleGroupCircle(r.systemId, r.posX, r.posY, r.radius, r.flags);
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
