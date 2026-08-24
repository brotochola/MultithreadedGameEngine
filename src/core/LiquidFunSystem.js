// LiquidFunSystem.js - High level API for Box2D LiquidFun particle physics systems in WeedJS

import { Box2dCommandRing } from '../box2d/box2dCommandRing.js';
import { SpriteSheetRegistry } from './SpriteSheetRegistry.js';
import { bindLiquidFunGroups, LIQUIDFUN_GROUPS_MAX } from './liquidFunGroups.js';
import { bindLiquidFunRender } from './liquidFunRender.js';

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

/** Google b2ParticleGroupFlag subset (group construction, not particle bits). */
export const LIQUIDFUN_GROUP_FLAGS = Object.freeze({
  SOLID: 1 << 0,
  RIGID: 1 << 1,
  CAN_BE_EMPTY: 1 << 2,
});

function resolveLifespanSec(lifespan) {
  // Google SetParticleDestructionByAge-style age-based destruction, in ms
  // (matches ParticleComponent.lifespan's convention) - converted to
  // seconds crossing into the command ring. Omitted => no lifespan (0,0).
  // Accepts a bare number (fixed life) or { min, max } (per-particle random).
  if (lifespan == null) return { minSec: 0, maxSec: 0 };
  if (typeof lifespan === 'number') {
    const sec = lifespan * 0.001;
    return { minSec: sec, maxSec: sec };
  }
  return {
    minSec: lifespan.min != null ? lifespan.min * 0.001 : 0,
    maxSec: lifespan.max != null ? lifespan.max * 0.001 : 0,
  };
}

function resolveRange(value, defaultVal = 1) {
  // Same shape as ParticleEmitter.emit scale/alpha: number or { min, max }.
  if (value == null) return null;
  if (typeof value === 'number') return { min: value, max: value };
  const min = value.min != null ? value.min : defaultVal;
  const max = value.max != null ? value.max : min;
  return { min, max };
}

function resolveEmit(options) {
  const o = options || {};
  let textureId = o.textureId | 0;
  if (!textureId && o.texture) {
    textureId = SpriteSheetRegistry.getTextureId(o.texture) | 0;
  }
  const life = resolveLifespanSec(o.lifespan);
  const viscousScale = o.viscousScale != null ? o.viscousScale : 1;
  return {
    posX: o.posX,
    posY: o.posY,
    halfWidth: o.halfWidth,
    halfHeight: o.halfHeight,
    radius: o.radius,
    systemId: o.systemId || 0,
    flags: o.flags != null ? o.flags : LIQUIDFUN_FLAGS.WATER,
    spacing: o.spacing != null ? o.spacing : 0,
    strength: o.strength != null ? o.strength : 0,
    viscousScale: viscousScale > 0 ? viscousScale : 1,
    trackGroup: !!o.trackGroup,
    groupFlags: o.groupFlags != null ? o.groupFlags >>> 0 : 0,
    tint: o.tint != null ? o.tint : 0,
    textureId,
    lifetimeMinSec: life.minSec,
    lifetimeMaxSec: life.maxSec,
    fadeToAlpha0: !!o.fadeToAlpha0,
    scale: resolveRange(o.scale, 1),
    alpha: resolveRange(o.alpha, 1),
    layerId: o.layerId != null ? o.layerId | 0 : 0,
    hasSprite: o.scale != null || o.alpha != null || (o.layerId != null && (o.layerId | 0) !== 0),
  };
}

function enqueueEmitParams(resolved) {
  Box2dCommandRing.enqueueSetLiquidFunEmit(
    resolved.spacing,
    resolved.strength,
    resolved.tint,
    resolved.textureId,
    resolved.viscousScale,
    resolved.trackGroup,
    resolved.groupFlags,
  );
  if (resolved.lifetimeMaxSec > 0) {
    Box2dCommandRing.enqueueSetLiquidFunLifespan(
      resolved.lifetimeMinSec,
      resolved.lifetimeMaxSec,
      resolved.fadeToAlpha0,
    );
  }
  if (resolved.hasSprite) {
    const s = resolved.scale || { min: 1, max: 1 };
    const a = resolved.alpha || { min: 1, max: 1 };
    Box2dCommandRing.enqueueSetLiquidFunScale(
      resolved.layerId,
      s.min,
      s.max,
      a.min,
      a.max,
    );
  }
}

let _groupsViews = null;
let _renderViews = null;
/** Cached mix of HEAP pose + thin emit SAB — same object every getParticleViews(). */
let _particleViews = null;
const _groupsScratch = [];

export class LiquidFunSystem {
  /** Called when scene allocates the groups SAB. Prefer bindSabs. */
  static bindGroupsSab(sab) {
    _groupsViews = sab ? bindLiquidFunGroups(sab, LIQUIDFUN_GROUPS_MAX) : null;
  }

  /**
   * Bind LiquidFun groups + thin emit SAB on this realm (main or any AbstractWorker).
   * HEAP pose (x/y/alpha/count) is bound later via bindHeapPose on box2dReady.
   * @param {{ groups?: SharedArrayBuffer|null, render?: SharedArrayBuffer|null, maxCount?: number }} opts
   */
  static bindSabs({ groups = null, render = null, maxCount = 0 } = {}) {
    _groupsViews = groups ? bindLiquidFunGroups(groups, LIQUIDFUN_GROUPS_MAX) : null;
    const n = maxCount | 0;
    _renderViews = render && n > 0 ? bindLiquidFunRender(render, n) : null;
    _particleViews = null;
  }

  /** Unbind all LiquidFun views (scene teardown / ParticleEmitter.reset). */
  static unbindSabs() {
    _groupsViews = null;
    _renderViews = null;
    _particleViews = null;
  }

  /**
   * Bind live particle pose onto the WASM HEAP SAB (same pattern as Transform).
   * @param {{ sab: SharedArrayBuffer, countByteOffset: number, xByteOffset: number, yByteOffset: number, alphaByteOffset: number, weightByteOffset?: number, maxCount: number }} payload
   */
  static bindHeapPose(payload) {
    if (!payload?.sab || !(payload.maxCount > 0)) {
      if (_particleViews) {
        _particleViews.count = _renderViews?.count ?? null;
        _particleViews.x = _renderViews?.x ?? null;
        _particleViews.y = _renderViews?.y ?? null;
        _particleViews.alpha = _renderViews?.alpha ?? null;
        _particleViews.weight = null;
      }
      return;
    }
    const sab = payload.sab;
    const n = payload.maxCount | 0;
    const count = new Int32Array(sab, payload.countByteOffset | 0, 1);
    const x = new Float32Array(sab, payload.xByteOffset | 0, n);
    const y = new Float32Array(sab, payload.yByteOffset | 0, n);
    const alpha =
      payload.alphaByteOffset > 0 ? new Float32Array(sab, payload.alphaByteOffset | 0, n) : null;
    const weight =
      payload.weightByteOffset > 0 ? new Float32Array(sab, payload.weightByteOffset | 0, n) : null;
    _particleViews = LiquidFunSystem._mergeParticleViews({ count, x, y, alpha, weight, maxCount: n });
  }

  static _mergeParticleViews(heap) {
    const thin = _renderViews;
    return {
      count: heap.count,
      x: heap.x,
      y: heap.y,
      alpha: heap.alpha || thin?.alpha || null,
      weight: heap.weight || null,
      scaleX: thin?.scaleX || null,
      scaleY: thin?.scaleY || null,
      rotC: thin?.rotC || null,
      rotS: thin?.rotS || null,
      tint: thin?.tint || null,
      textureId: thin?.textureId || null,
      baseAlpha: thin?.baseAlpha || null,
      layerId: thin?.layerId || null,
      // px/py kept only until pre_render latches HEAP prev; thin SAB may still have them
      px: thin?.px || null,
      py: thin?.py || null,
      firstIndex: null,
      lastIndex: null,
      maxCount: heap.maxCount | 0,
    };
  }

  /**
   * Zero-alloc particle views (HEAP pose + thin emit fields). Same object every call.
   * Live count = views.count[0]. Null until bindSabs (and ideally bindHeapPose) ran.
   */
  static getParticleViews() {
    if (_particleViews) return _particleViews;
    if (_renderViews) {
      // Fallback before box2dReady: thin SAB still has x/y until HEAP bind lands.
      _particleViews = {
        count: _renderViews.count,
        x: _renderViews.x,
        y: _renderViews.y,
        alpha: _renderViews.alpha,
        weight: null,
        scaleX: _renderViews.scaleX,
        scaleY: _renderViews.scaleY,
        rotC: _renderViews.rotC,
        rotS: _renderViews.rotS,
        tint: _renderViews.tint,
        textureId: _renderViews.textureId,
        baseAlpha: _renderViews.baseAlpha,
        layerId: _renderViews.layerId,
        px: _renderViews.px,
        py: _renderViews.py,
        maxCount: _renderViews.maxCount,
      };
      return _particleViews;
    }
    return null;
  }

  /**
   * Initializes or configures a LiquidFun particle system in the Box2D physics engine.
   * Prefer `physics.liquidFun.enabled` at scene boot; this is the manual / late-create path.
   * @param {Object} options
   * @param {number} [options.radius=10] - Particle radius in world units / pixels.
   * @param {number} [options.maxCount=10000] - Maximum capacity of particles.
   * @param {number} [options.subSteps=1] - Particle solver sub-steps (not Box2D subStepCount).
   * @param {number} [options.systemId=0] - Particle system handle ID.
   * @param {boolean} [options.strictContactCheck=false] - Drop spurious floor+wall corner body
   *   contacts (qsort + reproject per substep). liquidfun-c/Google default is false.
   */
  static createSystem({ radius = 10, maxCount = 10000, subSteps = 1, systemId = 0, strictContactCheck = false } = {}) {
    Box2dCommandRing.enqueueCreateParticleSystem(systemId, radius, maxCount, subSteps, strictContactCheck);
  }

  /**
   * Live-update system def coeffs (viscousStrength, tensileStrength, …).
   * Applied on the physics worker after the next drain.
   */
  static setTuning(tuning) {
    Box2dCommandRing.enqueueSetParticleTuning(tuning || {});
  }

  /**
   * Stamp viscousScale onto every particle in a live group (melt / thicken).
   */
  static setGroupViscousScale(groupId, scale) {
    Box2dCommandRing.enqueueSetGroupViscousScale(groupId, scale);
  }

  static joinParticleGroups(groupA, groupB) {
    Box2dCommandRing.enqueueJoinParticleGroups(groupA, groupB);
  }

  static splitParticleGroup(groupId) {
    Box2dCommandRing.enqueueSplitParticleGroup(groupId);
  }

  static applyForce(index, fx, fy) {
    Box2dCommandRing.enqueueParticleApplyForce(index, fx, fy);
  }

  static applyLinearImpulse(index, ix, iy) {
    Box2dCommandRing.enqueueParticleApplyImpulse(index, ix, iy);
  }

  static groupApplyForce(groupId, fx, fy) {
    Box2dCommandRing.enqueueGroupApplyForce(groupId, fx, fy);
  }

  static groupApplyLinearImpulse(groupId, ix, iy) {
    Box2dCommandRing.enqueueGroupApplyImpulse(groupId, ix, iy);
  }

  /**
   * Alive LiquidFun groups mirrored from the physics worker (≤1 step stale).
   * Reuses a scratch array — do not hold references across frames without copying.
   */
  static getParticleGroups() {
    const v = _groupsViews;
    if (!v || !v.count) {
      _groupsScratch.length = 0;
      return _groupsScratch;
    }
    const n = v.count[0] | 0;
    const out = _groupsScratch;
    out.length = n;
    for (let i = 0; i < n; i++) {
      let g = out[i];
      if (!g) {
        g = {
          id: 0,
          particleCount: 0,
          viscousScale: 1,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          angularVelocity: 0,
          angle: 0,
          firstIndex: 0,
          lastIndex: 0,
        };
        out[i] = g;
      }
      g.id = v.id[i] | 0;
      g.particleCount = v.particleCount[i] | 0;
      g.viscousScale = v.viscousScale[i];
      g.x = v.x[i];
      g.y = v.y[i];
      g.vx = v.vx[i];
      g.vy = v.vy[i];
      g.angularVelocity = v.angularVelocity[i];
      g.angle = v.angle[i];
      g.firstIndex = v.firstIndex ? v.firstIndex[i] | 0 : 0;
      g.lastIndex = v.lastIndex ? v.lastIndex[i] | 0 : 0;
    }
    return out;
  }

  /**
   * Spawns a rectangular group of LiquidFun particles.
   * Elastic/spring allocate a shape group; viscousScale!=1 or trackGroup keeps a
   * bookkeeping group (no UpdateGroupStatistics). Else ungrouped (-1).
   * @param {Object} options
   * @param {number} [options.flags] - `LIQUIDFUN_FLAGS` bits. Default WATER (0).
   * @param {number} [options.spacing=0] - 0 → C rest stride (0.75 × diameter).
   * @param {number} [options.strength] - Elastic/spring group cohesion (~0..1).
   * @param {number} [options.viscousScale] - Per-particle viscous multiplier (default 1).
   * @param {boolean} [options.trackGroup] - Keep a bookkeeping group even at scale 1.
   * @param {number} [options.tint]
   * @param {number} [options.textureId]
   * @param {string} [options.texture] - Resolved via SpriteSheetRegistry if textureId omitted.
   * @param {number|{min: number, max: number}} [options.lifespan] - Age-based destruction
   *   in milliseconds (Google SetParticleDestructionByAge-style). Bare number = fixed
   *   life for every particle; `{ min, max }` = independent random in range. Omitted =>
   *   particles live forever (default).
   * @param {boolean} [options.fadeToAlpha0=false] - When true (and lifespan is set),
   *   lerp render alpha from 1 to 0 over remaining life. Default false: stay opaque
   *   until zombie destroy.
   * @param {number|{min: number, max: number}} [options.scale] - Sprite scale (same
   *   shape as ParticleEmitter.emit). Omitted => 1.
   * @param {number|{min: number, max: number}} [options.alpha] - Emit opacity (same
   *   shape as ParticleEmitter.emit). Multiplied by WASM life-fade. Omitted => 1.
   * @param {number} [options.layerId=0] - Custom layer id (Layer.getId('water')), 0 = ENTITIES.
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
