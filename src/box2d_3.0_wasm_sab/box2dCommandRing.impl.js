// Box2D command ring — single logic source (no export/import).
// ESM: imported as side-effect by box2dCommandRing.js
// Classic: importScripts from weedjs_post.js
// Writers: GameObject / logic / main. Reader: weedjs_post drain pre-step.
// Units: px, px/s, rad, rad/s.

(function (global) {
  var BOX2D_CMD = Object.freeze({
    SET_TRANSFORM: 1, // entity, x, y, angle
    SET_VELOCITY: 2, // entity, vx, vy
    SET_ANGLE: 3, // entity, angle
    SET_ANGULAR_VELOCITY: 4, // entity, w
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
    var write = Atomics.load(ringI32, HDR_WRITE);
    var read = Atomics.load(ringI32, HDR_READ);
    var next = (write + 1) % cap;
    if (next === (read % cap)) {
      Atomics.add(ringI32, HDR_OVERFLOW, 1);
      return false;
    }
    var base = BOX2D_CMD_HEADER_I32 + write * BOX2D_CMD_STRIDE_I32;
    ringI32[base] = opcode | 0;
    ringI32[base + 1] = entity | 0;
    ringF32[base + 2] = a;
    ringF32[base + 3] = b;
    ringF32[base + 4] = c;
    ringF32[base + 5] = d;
    Atomics.store(ringI32, HDR_WRITE, next);
    return true;
  }

  function enqueueSetTransform(entity, x, y, angle) {
    return enqueue(BOX2D_CMD.SET_TRANSFORM, entity, x, y, angle == null ? 0 : angle, 0);
  }

  function enqueueSetVelocity(entity, vx, vy) {
    return enqueue(BOX2D_CMD.SET_VELOCITY, entity, vx, vy, 0, 0);
  }

  function enqueueSetAngle(entity, angle) {
    return enqueue(BOX2D_CMD.SET_ANGLE, entity, angle, 0, 0, 0);
  }

  function enqueueSetAngularVelocity(entity, w) {
    return enqueue(BOX2D_CMD.SET_ANGULAR_VELOCITY, entity, w, 0, 0, 0);
  }

  function drainCommandRing(i32, f32, handlers) {
    if (!i32 || !f32 || !handlers) return 0;
    var cap = i32[HDR_CAP] | 0;
    if (!(cap > 0)) return 0;
    var read = Atomics.load(i32, HDR_READ);
    var write = Atomics.load(i32, HDR_WRITE);
    var n = 0;
    while (read !== write) {
      var base = BOX2D_CMD_HEADER_I32 + read * BOX2D_CMD_STRIDE_I32;
      var op = i32[base] | 0;
      var entity = i32[base + 1] | 0;
      var a = f32[base + 2];
      var b = f32[base + 3];
      var c = f32[base + 4];
      switch (op) {
        case BOX2D_CMD.SET_TRANSFORM:
          if (handlers.setTransform) handlers.setTransform(entity, a, b, c);
          break;
        case BOX2D_CMD.SET_VELOCITY:
          if (handlers.setVelocity) handlers.setVelocity(entity, a, b);
          break;
        case BOX2D_CMD.SET_ANGLE:
          if (handlers.setAngle) handlers.setAngle(entity, a);
          break;
        case BOX2D_CMD.SET_ANGULAR_VELOCITY:
          if (handlers.setAngularVelocity) handlers.setAngularVelocity(entity, a);
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
    drainCommandRing: drainCommandRing,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
