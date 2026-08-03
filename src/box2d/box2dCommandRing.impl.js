// Box2D command ring — single logic source (no export/import).
// ESM: imported as side-effect by box2dCommandRing.js
// Classic: importScripts from weedjs_post.js
// Writers: GameObject / logic / main (MPSC). Reader: weedjs_post drain pre-step (SPSC consumer).
// Units: px, px/s, rad, rad/s.
//
// Sequence-slot MPSC: HDR_WRITE/HDR_READ are monotonic claim counters.
// Per-slot seq at base+0; payload at base+1..6. Init seq[i]=i.
// Publish stores claim+1; consumer frees with read+cap.

(function (global) {
  var BOX2D_CMD = Object.freeze({
    SET_TRANSFORM: 1, // entity, x, y, rotC, rotS
    SET_VELOCITY: 2, // entity, vx, vy
    SET_ANGLE: 3, // entity, rotC, rotS
    SET_ANGULAR_VELOCITY: 4, // entity, w
    SET_FIXED_ROTATION: 5, // entity, flag (0|1)
    EXPLODE: 6, // maskBits as entity, x, y, radius, impulsePerLength (falloff=0.5*radius)
    SET_SLEEP_THRESHOLD: 7, // entity, threshold
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
    return enqueue(
      BOX2D_CMD.SET_TRANSFORM,
      entity,
      x,
      y,
      rotC == null ? 1 : rotC,
      rotS == null ? 0 : rotS,
    );
  }

  function enqueueSetVelocity(entity, vx, vy) {
    return enqueue(BOX2D_CMD.SET_VELOCITY, entity, vx, vy, 0, 0);
  }

  /** @param {number} rotC cosθ @param {number} rotS sinθ */
  function enqueueSetAngle(entity, rotC, rotS) {
    return enqueue(
      BOX2D_CMD.SET_ANGLE,
      entity,
      rotC == null ? 1 : rotC,
      rotS == null ? 0 : rotS,
      0,
      0,
    );
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
        case BOX2D_CMD.SET_ANGLE:
          if (handlers.setAngle) handlers.setAngle(entity, a, b);
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
    enqueueSetTransform: enqueueSetTransform,
    enqueueSetVelocity: enqueueSetVelocity,
    enqueueSetAngle: enqueueSetAngle,
    enqueueSetAngularVelocity: enqueueSetAngularVelocity,
    enqueueSetFixedRotation: enqueueSetFixedRotation,
    enqueueExplode: enqueueExplode,
    enqueueSetSleepThreshold: enqueueSetSleepThreshold,
    drainCommandRing: drainCommandRing,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
