// Box2D command ring — single logic source (no export/import).
// ESM: imported as side-effect by box2dCommandRing.js
// Classic: importScripts from weedjs_post.js
// Writers: GameObject / logic / main (MPSC). Reader: weedjs_post drain pre-step (SPSC consumer).
// Units: px, px/s; facing as unit complex (rotC, rotS); angular vel rad/s.
//
// Sequence-slot MPSC: HDR_WRITE/HDR_READ are monotonic claim counters.
// Per-slot seq at base+0; payload at base+1..6. Init seq[i]=i.
// Publish stores claim+1; consumer frees with read+cap.

(function (global) {
  var BOX2D_CMD = Object.freeze({
    SET_TRANSFORM: 1, // entity, x, y, rotC, rotS
    SET_VELOCITY: 2, // entity, vx, vy
    SET_ROT_CS: 3, // entity, rotC, rotS (opcode 3; was SET_ANGLE)
    SET_ANGULAR_VELOCITY: 4, // entity, w
    SET_FIXED_ROTATION: 5, // entity, flag (0|1)
    EXPLODE: 6, // maskBits as entity, x, y, radius, impulsePerLength (falloff=0.5*radius)
    SET_SLEEP_THRESHOLD: 7, // entity, threshold
    CREATE_PARTICLE_SYSTEM: 8, // systemId, radius, maxCount, subSteps, strictContactCheck (0|1)
    CREATE_PARTICLE_GROUP_BOX: 9, // flags (entity slot), posX, posY, halfWidth, halfHeight
    CREATE_PARTICLE_GROUP_CIRCLE: 10, // systemId, posX, posY, radius, flags
    DESTROY_PARTICLE_GROUP: 11, // systemId, groupId
    DESTROY_PARTICLE_SYSTEM: 12, // systemId
    SET_LIQUIDFUN_EMIT: 13, // spacing, strength, tintBits, textureId (next create consumes)
    SET_LIQUIDFUN_LIFESPAN: 14, // lifetimeMinSec, lifetimeMaxSec (next create consumes; 0,0 = no lifespan)
  });

  var BOX2D_CMD_HEADER_I32 = 4;
  var BOX2D_CMD_STRIDE_I32 = 8;
  var BOX2D_CMD_DEFAULT_CAPACITY = 4096;

  var HDR_WRITE = 0;
  var HDR_READ = 1;
  var HDR_CAP = 2;
  var HDR_OVERFLOW = 3;

  var ringI32 = null;
  var ringF32 = null;
  var capacity = 0;
  /** When true, warn if enqueued (rotC,rotS) is not near unit length. */
  var assertRotCSUnit = false;

  function setAssertRotCSUnit(on) {
    assertRotCSUnit = !!on;
  }

  function checkRotCS(rotC, rotS) {
    if (!assertRotCSUnit) return;
    if (!isFinite(rotC) || !isFinite(rotS)) {
      console.warn('Box2dCommandRing: non-finite rotCS', rotC, rotS);
      return;
    }
    var n = rotC * rotC + rotS * rotS;
    if (n < 0.998 || n > 1.002) {
      console.warn('Box2dCommandRing: non-unit rotCS', rotC, rotS, 'normSq=', n);
    }
  }

  function createCommandRingSab(cmdCapacity) {
    var cap = Math.max(64, (cmdCapacity == null ? BOX2D_CMD_DEFAULT_CAPACITY : cmdCapacity) | 0);
    var bytes = (BOX2D_CMD_HEADER_I32 + cap * BOX2D_CMD_STRIDE_I32) * 4;
    var sab = new SharedArrayBuffer(bytes);
    var i32 = new Int32Array(sab);
    Atomics.store(i32, HDR_WRITE, 0);
    Atomics.store(i32, HDR_READ, 0);
    Atomics.store(i32, HDR_CAP, cap);
    Atomics.store(i32, HDR_OVERFLOW, 0);
    for (var i = 0; i < cap; i++) {
      i32[BOX2D_CMD_HEADER_I32 + i * BOX2D_CMD_STRIDE_I32] = i;
    }
    return sab;
  }

  function bindCommandRing(sab) {
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

  function isCommandRingBound() {
    return ringI32 != null && capacity > 0;
  }

  function enqueue(opcode, entity, a, b, c, d) {
    if (!ringI32) return false;
    var cap = capacity;
    for (;;) {
      var write = Atomics.load(ringI32, HDR_WRITE);
      var read = Atomics.load(ringI32, HDR_READ);
      if (write - read >= cap) {
        Atomics.add(ringI32, HDR_OVERFLOW, 1);
        return false;
      }
      if (Atomics.compareExchange(ringI32, HDR_WRITE, write, write + 1) !== write) {
        continue;
      }
      var base = BOX2D_CMD_HEADER_I32 + (write % cap) * BOX2D_CMD_STRIDE_I32;
      // Slot free when seq == claim (producer owns after CAS).
      while (Atomics.load(ringI32, base) !== write) {
        /* wait prior lap consumer / slower peer publish */
      }
      ringI32[base + 1] = opcode | 0;
      ringI32[base + 2] = entity | 0;
      ringF32[base + 3] = a;
      ringF32[base + 4] = b;
      ringF32[base + 5] = c;
      ringF32[base + 6] = d;
      Atomics.store(ringI32, base, write + 1);
      return true;
    }
  }

  function enqueueSetTransform(entity, x, y, rotC, rotS) {
    var c = rotC == null ? 1 : rotC;
    var s = rotS == null ? 0 : rotS;
    checkRotCS(c, s);
    return enqueue(BOX2D_CMD.SET_TRANSFORM, entity, x, y, c, s);
  }

  function enqueueSetVelocity(entity, vx, vy) {
    return enqueue(BOX2D_CMD.SET_VELOCITY, entity, vx, vy, 0, 0);
  }

  /** @param {number} rotC cosθ @param {number} rotS sinθ */
  function enqueueSetRotCS(entity, rotC, rotS) {
    var c = rotC == null ? 1 : rotC;
    var s = rotS == null ? 0 : rotS;
    checkRotCS(c, s);
    return enqueue(BOX2D_CMD.SET_ROT_CS, entity, c, s, 0, 0);
  }

  function enqueueSetAngularVelocity(entity, w) {
    return enqueue(BOX2D_CMD.SET_ANGULAR_VELOCITY, entity, w, 0, 0, 0);
  }

  function enqueueSetFixedRotation(entity, flag) {
    return enqueue(BOX2D_CMD.SET_FIXED_ROTATION, entity, flag ? 1 : 0, 0, 0, 0);
  }

  function enqueueExplode(maskBits, x, y, radius, impulsePerLength) {
    return enqueue(
      BOX2D_CMD.EXPLODE,
      maskBits | 0,
      x,
      y,
      radius,
      impulsePerLength == null ? 0 : impulsePerLength,
    );
  }

  function enqueueSetSleepThreshold(entity, threshold) {
    return enqueue(BOX2D_CMD.SET_SLEEP_THRESHOLD, entity, threshold, 0, 0, 0);
  }

  function enqueueCreateParticleSystem(systemId, radius, maxCount, subSteps, strictContactCheck) {
    return enqueue(
      BOX2D_CMD.CREATE_PARTICLE_SYSTEM,
      systemId,
      radius,
      maxCount,
      subSteps > 0 ? subSteps : 1,
      strictContactCheck ? 1 : 0,
    );
  }

  function enqueueSetLiquidFunEmit(spacing, strength, tintBits, textureId) {
    return enqueue(
      BOX2D_CMD.SET_LIQUIDFUN_EMIT,
      0,
      spacing || 0,
      strength || 0,
      tintBits || 0,
      textureId || 0,
    );
  }

  function enqueueSetLiquidFunLifespan(lifetimeMinSec, lifetimeMaxSec) {
    return enqueue(BOX2D_CMD.SET_LIQUIDFUN_LIFESPAN, 0, lifetimeMinSec || 0, lifetimeMaxSec || 0, 0, 0);
  }

  function enqueueCreateParticleGroupBox(systemId, posX, posY, halfWidth, halfHeight, flags) {
    // Singleton particle system: entity slot carries flags (systemId unused).
    return enqueue(BOX2D_CMD.CREATE_PARTICLE_GROUP_BOX, flags || 0, posX, posY, halfWidth, halfHeight);
  }

  function enqueueCreateParticleGroupCircle(systemId, posX, posY, radius, flags) {
    return enqueue(BOX2D_CMD.CREATE_PARTICLE_GROUP_CIRCLE, systemId, posX, posY, radius, flags || 0);
  }

  function enqueueDestroyParticleGroup(systemId, groupId) {
    return enqueue(BOX2D_CMD.DESTROY_PARTICLE_GROUP, systemId, groupId, 0, 0, 0);
  }

  function enqueueDestroyParticleSystem(systemId) {
    return enqueue(BOX2D_CMD.DESTROY_PARTICLE_SYSTEM, systemId, 0, 0, 0, 0);
  }

  function drainCommandRing(i32, f32, handlers) {
    if (!i32 || !f32 || !handlers) return 0;
    var cap = i32[HDR_CAP] | 0;
    if (!(cap > 0)) return 0;
    var n = 0;
    for (;;) {
      var read = Atomics.load(i32, HDR_READ);
      var base = BOX2D_CMD_HEADER_I32 + (read % cap) * BOX2D_CMD_STRIDE_I32;
      if (Atomics.load(i32, base) !== read + 1) break;
      var op = i32[base + 1] | 0;
      var entity = i32[base + 2] | 0;
      var a = f32[base + 3];
      var b = f32[base + 4];
      var c = f32[base + 5];
      var d = f32[base + 6];
      switch (op) {
        case BOX2D_CMD.SET_TRANSFORM:
          if (handlers.setTransform) handlers.setTransform(entity, a, b, c, d);
          break;
        case BOX2D_CMD.SET_VELOCITY:
          if (handlers.setVelocity) handlers.setVelocity(entity, a, b);
          break;
        case BOX2D_CMD.SET_ROT_CS:
          if (handlers.setRotCS) handlers.setRotCS(entity, a, b);
          break;
        case BOX2D_CMD.SET_ANGULAR_VELOCITY:
          if (handlers.setAngularVelocity) handlers.setAngularVelocity(entity, a);
          break;
        case BOX2D_CMD.SET_FIXED_ROTATION:
          if (handlers.setFixedRotation) handlers.setFixedRotation(entity, a);
          break;
        case BOX2D_CMD.EXPLODE:
          if (handlers.explode) handlers.explode(entity, a, b, c, d);
          break;
        case BOX2D_CMD.SET_SLEEP_THRESHOLD:
          if (handlers.setSleepThreshold) handlers.setSleepThreshold(entity, a);
          break;
        case BOX2D_CMD.CREATE_PARTICLE_SYSTEM:
          if (handlers.createParticleSystem) handlers.createParticleSystem(entity, a, b, c, d);
          break;
        case BOX2D_CMD.CREATE_PARTICLE_GROUP_BOX:
          if (handlers.createParticleGroupBox) handlers.createParticleGroupBox(entity, a, b, c, d);
          break;
        case BOX2D_CMD.CREATE_PARTICLE_GROUP_CIRCLE:
          if (handlers.createParticleGroupCircle) handlers.createParticleGroupCircle(entity, a, b, c, d);
          break;
        case BOX2D_CMD.DESTROY_PARTICLE_GROUP:
          if (handlers.destroyParticleGroup) handlers.destroyParticleGroup(entity, a);
          break;
        case BOX2D_CMD.DESTROY_PARTICLE_SYSTEM:
          if (handlers.destroyParticleSystem) handlers.destroyParticleSystem(entity);
          break;
        case BOX2D_CMD.SET_LIQUIDFUN_EMIT:
          if (handlers.setLiquidFunEmit) handlers.setLiquidFunEmit(a, b, c, d);
          break;
        case BOX2D_CMD.SET_LIQUIDFUN_LIFESPAN:
          if (handlers.setLiquidFunLifespan) handlers.setLiquidFunLifespan(a, b);
          break;
        default:
          break;
      }
      Atomics.store(i32, base, read + cap);
      Atomics.store(i32, HDR_READ, read + 1);
      n++;
    }
    return n;
  }

  global.Box2dCommandRing = {
    BOX2D_CMD: BOX2D_CMD,
    BOX2D_CMD_HEADER_I32: BOX2D_CMD_HEADER_I32,
    BOX2D_CMD_STRIDE_I32: BOX2D_CMD_STRIDE_I32,
    BOX2D_CMD_DEFAULT_CAPACITY: BOX2D_CMD_DEFAULT_CAPACITY,
    createCommandRingSab: createCommandRingSab,
    bindCommandRing: bindCommandRing,
    isCommandRingBound: isCommandRingBound,
    setAssertRotCSUnit: setAssertRotCSUnit,
    enqueueSetTransform: enqueueSetTransform,
    enqueueSetVelocity: enqueueSetVelocity,
    enqueueSetRotCS: enqueueSetRotCS,
    enqueueSetAngularVelocity: enqueueSetAngularVelocity,
    enqueueSetFixedRotation: enqueueSetFixedRotation,
    enqueueExplode: enqueueExplode,
    enqueueSetSleepThreshold: enqueueSetSleepThreshold,
    enqueueCreateParticleSystem: enqueueCreateParticleSystem,
    enqueueSetLiquidFunEmit: enqueueSetLiquidFunEmit,
    enqueueSetLiquidFunLifespan: enqueueSetLiquidFunLifespan,
    enqueueCreateParticleGroupBox: enqueueCreateParticleGroupBox,
    enqueueCreateParticleGroupCircle: enqueueCreateParticleGroupCircle,
    enqueueDestroyParticleGroup: enqueueDestroyParticleGroup,
    enqueueDestroyParticleSystem: enqueueDestroyParticleSystem,
    drainCommandRing: drainCommandRing,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
