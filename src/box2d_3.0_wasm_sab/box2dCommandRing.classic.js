// Classic (importScripts) twin of box2dCommandRing.js for weedjs_post.
var BOX2D_CMD = Object.freeze({
  SET_TRANSFORM: 1,
  SET_VELOCITY: 2,
  SET_ANGLE: 3,
  SET_ANGULAR_VELOCITY: 4,
});
var BOX2D_CMD_HEADER_I32 = 4;
var BOX2D_CMD_STRIDE_I32 = 8;

function drainBox2dCommandRing(i32, f32, handlers) {
  if (!i32 || !f32 || !handlers) return 0;
  var cap = i32[2] | 0;
  if (!(cap > 0)) return 0;
  var read = Atomics.load(i32, 1);
  var write = Atomics.load(i32, 0);
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
    }
    read = (read + 1) % cap;
    n++;
  }
  Atomics.store(i32, 1, read);
  return n;
}
