import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOX2D_DIR = path.resolve(__dirname, '../../src/box2d');
const WASM_PATH = path.join(BOX2D_DIR, 'box2d_wasm.wasm');
const JS_PATH = path.join(BOX2D_DIR, 'box2d_wasm.js');

function parseWasmExportMap(jsSource) {
  const map = Object.create(null);
  const re = /Module\["_(\w+)"\]\s*=\s*wasmExports\["([^"]+)"\]/g;
  let m;
  while ((m = re.exec(jsSource))) {
    map[m[1]] = m[2];
  }
  return map;
}

function instantiateBox2dWasm() {
  const wasmBuffer = fs.readFileSync(WASM_PATH);
  const jsSource = fs.readFileSync(JS_PATH, 'utf8');
  const names = parseWasmExportMap(jsSource);
  assert.ok(names.create_world, 'create_world export map missing — rebuild box2d_wasm.js');
  assert.ok(names.create_particle_system, 'create_particle_system export map missing');

  const wasmModule = new WebAssembly.Module(wasmBuffer);
  let memory = null;
  const imports = {};
  for (const imp of WebAssembly.Module.imports(wasmModule)) {
    if (!imports[imp.module]) imports[imp.module] = {};
    if (imp.kind === 'memory') {
      memory = new WebAssembly.Memory({ initial: 4096, maximum: 4096, shared: true });
      imports[imp.module][imp.name] = memory;
    } else if (imp.kind === 'table') {
      imports[imp.module][imp.name] = new WebAssembly.Table({ initial: 1024, element: 'anyfunc' });
    } else if (imp.kind === 'function') {
      imports[imp.module][imp.name] = () => 0;
    } else if (imp.kind === 'global') {
      imports[imp.module][imp.name] = 0;
    }
  }
  assert.ok(memory, 'wasm memory import missing');

  const instance = new WebAssembly.Instance(wasmModule, imports);
  const fn = (name) => {
    const exp = names[name];
    assert.ok(exp && typeof instance.exports[exp] === 'function', `missing wasm export ${name} (${exp})`);
    return instance.exports[exp];
  };

  // Demo uses subSteps=1. Wrapper default is 2; that 4× critical pressure sprays puddles off the floor.
  fn('set_particle_sub_steps')(1);

  return { instance, memory, fn };
}

test('WASM LiquidFun groups create and rest on a static box (Y-down pixels)', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const createParticleGroupBox = fn('create_particle_group_box');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const stepWorld = fn('step_world');

  // Weed pixel world: Y+ down, 100 px/m, g = 9.8 * 100
  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  // Static floor at y=400, half-height 130 → top at 270. Wide so the puddle cannot walk off the ends.
  const floorSlot = createBodyBox(
    worldId,
    0, // static
    0, 400, 0,
    2000, 130,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 0,
  );
  assert.ok(floorSlot >= 0, `create_body_box failed: ${floorSlot}`);

  const sysOk = createParticleSystem(worldId, 10, 1.0, 500);
  assert.ok(sysOk, 'create_particle_system failed');

  const circle0 = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, 0, 0, 0, 1, 1);
  assert.ok(circle0 >= 0, `first circle group failed: ${circle0}`);
  const circle1 = createParticleGroupCircle(80, 80, 30, 0, 0, 0.5, 0, 0, 0, 1, 1);
  assert.ok(circle1 >= 0, `second circle group failed: ${circle1}`);
  const boxGrp = createParticleGroupBox(-40, 40, 40, 100, 0, 0, 0.5, 0, 0, 0, 1, 1);
  assert.ok(boxGrp >= 0, `box group failed: ${boxGrp}`);

  const count = getParticleCount();
  assert.ok(count > 8, `expected a blob of particles, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    stepWorld(worldId, dt, 4);
  }

  const posByte = getParticlePosByteOffset();
  assert.ok(posByte > 0, 'particle pos buffer missing');
  const heap = new Float32Array(memory.buffer);
  const base = posByte >> 2;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = heap[base + (i << 1)];
    const y = heap[base + (i << 1) + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const floorTop = 270;
  assert.ok(
    maxY < floorTop + 40,
    `particles fell through floor: maxY=${maxY} floorTop=${floorTop}`,
  );
  assert.ok(
    maxY > floorTop - 80,
    `particles never reached the floor (gravity/step dead?): maxY=${maxY} floorTop=${floorTop}`,
  );
  assert.ok(minY > -200, `particles escaped upward unexpectedly: minY=${minY}`);
  // Point particles pancake on the plane; Google 1.1.0 has no disk stack. Check spread in X.
  assert.ok(
    maxX - minX > 80,
    `puddle did not spread: spanX=${maxX - minX} minX=${minX} maxX=${maxX}`,
  );
  assert.equal(getParticleCount(), count);
});

test('WASM water blob does not climb a vertical static wall', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  // Floor top at y=270. Wall right face at x=130. Wide floor so the puddle stays on it.
  const floorSlot = createBodyBox(
    worldId,
    0, // static
    0, 400, 0,
    2000, 130,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 0,
  );
  const wallSlot = createBodyBox(
    worldId,
    0,
    0, 200, 0,
    130, 200,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 1,
  );
  assert.ok(floorSlot >= 0, `floor failed: ${floorSlot}`);
  assert.ok(wallSlot >= 0, `wall failed: ${wallSlot}`);

  const sysOk = createParticleSystem(worldId, 10, 1.0, 800);
  assert.ok(sysOk, 'create_particle_system failed');

  const gid = createParticleGroupCircle(155, 200, 50, 0, 0, 0, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `circle group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 8, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    stepWorld(worldId, dt, 4);
  }

  const heap = new Float32Array(memory.buffer);
  const base = getParticlePosByteOffset() >> 2;
  const wallFace = 130;
  const nearWall = wallFace + 60;
  let puddleMinY = Infinity;
  let puddleMaxY = -Infinity;
  let wallMinY = Infinity;
  let wallMaxY = -Infinity;
  let wallN = 0;
  for (let i = 0; i < count; i++) {
    const x = heap[base + (i << 1)];
    const y = heap[base + (i << 1) + 1];
    if (y < puddleMinY) puddleMinY = y;
    if (y > puddleMaxY) puddleMaxY = y;
    if (x < nearWall) {
      wallN++;
      if (y < wallMinY) wallMinY = y;
      if (y > wallMaxY) wallMaxY = y;
    }
  }

  assert.ok(wallN > 0, 'no particles settled against the wall');
  assert.ok(
    wallMinY > puddleMinY - 50,
    `wall column climbed: wallMinY=${wallMinY} puddleMinY=${puddleMinY}`,
  );
  const wallSpan = wallMaxY - wallMinY;
  const puddleSpan = puddleMaxY - puddleMinY;
  assert.ok(
    wallSpan < puddleSpan + 40,
    `tall 1-wide wall column: wallSpan=${wallSpan} puddleSpan=${puddleSpan} wallN=${wallN}`,
  );
  assert.ok(
    puddleMaxY < 270 + 40,
    `particles fell through floor: maxY=${puddleMaxY}`,
  );

  const wallX0 = -128;
  const wallX1 = 128;
  const wallY0 = 2;
  const wallY1 = 398;
  let insideWall = 0;
  for (let i = 0; i < count; i++) {
    const x = heap[base + (i << 1)];
    const y = heap[base + (i << 1) + 1];
    if (x > wallX0 && x < wallX1 && y > wallY0 && y < wallY1) insideWall++;
  }
  assert.equal(insideWall, 0, `particle centers inside wall box: ${insideWall}`);
});

test('WASM water beside a thick static box stays outside (max pen < radius)', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  const radius = 10;
  const floorSlot = createBodyBox(
    worldId,
    0,
    0, 400, 0,
    400, 30,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 0,
  );
  const boxSlot = createBodyBox(
    worldId,
    0,
    200, 280, 0,
    80, 80,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 1,
  );
  assert.ok(floorSlot >= 0, `floor failed: ${floorSlot}`);
  assert.ok(boxSlot >= 0, `box failed: ${boxSlot}`);

  assert.ok(createParticleSystem(worldId, radius, 1.0, 800), 'create_particle_system failed');
  const gid = createParticleGroupCircle(400, 220, 40, 0, 0, 0, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `circle group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 8, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    stepWorld(worldId, dt, 4);
  }

  const heap = new Float32Array(memory.buffer);
  const base = getParticlePosByteOffset() >> 2;
  const x0 = 120;
  const x1 = 280;
  const y0 = 200;
  const y1 = 360;
  let maxPen = 0;
  for (let i = 0; i < count; i++) {
    const x = heap[base + (i << 1)];
    const y = heap[base + (i << 1) + 1];
    if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
    const pen = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    if (pen > maxPen) maxPen = pen;
  }
  assert.ok(
    maxPen < radius,
    `centers tunneled into thick box: maxPen=${maxPen} radius=${radius}`,
  );
});

test('WASM particle spawned inside a thick static box exits the nearest face', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleBox = fn('create_particle_box');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  // Box x=[-130,130], y=[0,800]. Center spawn is 130px from left/right, 400px from top/bottom.
  const boxSlot = createBodyBox(
    worldId,
    0,
    0, 400, 0,
    130, 400,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 1,
  );
  assert.ok(boxSlot >= 0, `box failed: ${boxSlot}`);
  assert.ok(createParticleSystem(worldId, 10, 1.0, 64), 'create_particle_system failed');

  const n = createParticleBox(0, 400, 0, 400, 20, 0);
  assert.equal(n, 1, `expected 1 particle, got ${n}`);
  assert.equal(getParticleCount(), 1);

  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) {
    stepWorld(worldId, dt, 4);
  }

  const heap = new Float32Array(memory.buffer);
  const base = getParticlePosByteOffset() >> 2;
  const x = heap[base];
  const y = heap[base + 1];
  const inside = x > -128 && x < 128 && y > 2 && y < 798;
  assert.ok(!inside, `still trapped inside box: x=${x} y=${y}`);
  assert.ok(y > 80, `exited through the top instead of nearest face: x=${x} y=${y}`);
  assert.ok(
    x < -100 || x > 100,
    `did not leave through a vertical face: x=${x} y=${y}`,
  );
});

test('WASM 10k water smoke: create and step without losing particles', () => {
  const { fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupBox = fn('create_particle_group_box');
  const getParticleCount = fn('get_particle_count');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');
  assert.ok(createParticleSystem(worldId, 4, 1.0, 10000), 'create_particle_system failed');

  const gid = createParticleGroupBox(-340, -340, 340, 340, 0, 0, 0, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `box group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count >= 9000, `expected ~10k water, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 10; i++) {
    stepWorld(worldId, dt, 1);
  }
  assert.equal(getParticleCount(), count);
});

test('WASM one water particle settles on a static floor (no 600 px/s bounce)', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleBox = fn('create_particle_box');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const getParticleVelByteOffset = fn('get_particle_vel_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  const radius = 10;
  const floorSlot = createBodyBox(
    worldId,
    0,
    0, 400, 0,
    400, 130,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 0,
  );
  assert.ok(floorSlot >= 0, `create_body_box failed: ${floorSlot}`);
  assert.ok(createParticleSystem(worldId, radius, 1.0, 64), 'create_particle_system failed');

  const n = createParticleBox(0, 200, 0, 200, 20, 0);
  assert.equal(n, 1, `expected 1 particle, got ${n}`);
  assert.equal(getParticleCount(), 1);

  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    stepWorld(worldId, dt, 4);
  }

  const heap = new Float32Array(memory.buffer);
  const posBase = getParticlePosByteOffset() >> 2;
  const velBase = getParticleVelByteOffset() >> 2;
  const y = heap[posBase + 1];
  const vy = heap[velBase + 1];
  const floorTop = 270;
  assert.ok(Number.isFinite(y) && Number.isFinite(vy), `non-finite: y=${y} vy=${vy}`);
  assert.ok(
    Math.abs(vy) < 80,
    `particle still bouncing: |vy|=${vy} (overlap launch is ~600)`,
  );
  assert.ok(
    y > floorTop - 25 && y < floorTop + 12,
    `particle not resting near floor top: y=${y} floorTop=${floorTop} radius=${radius}`,
  );
});

test('WASM WALL|BARRIER segment keeps water on one side', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleBox = fn('create_particle_box');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  const floorSlot = createBodyBox(
    worldId,
    0,
    0, 400, 0,
    400, 30,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 0,
  );
  assert.ok(floorSlot >= 0, `floor failed: ${floorSlot}`);
  assert.ok(createParticleSystem(worldId, 10, 1.0, 400), 'create_particle_system failed');

  const WALL = 1 << 1;
  const BARRIER = 1 << 7;
  const dam = createParticleBox(100, 340, 100, 357, 17, WALL | BARRIER);
  assert.equal(dam, 2, `expected 2 barrier particles, got ${dam}`);

  const gid = createParticleGroupCircle(40, 300, 35, 0, 0, 0, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `water circle failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 4, `expected water + dam, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    stepWorld(worldId, dt, 4);
  }

  const heap = new Float32Array(memory.buffer);
  const base = getParticlePosByteOffset() >> 2;
  let far = 0;
  for (let i = 0; i < count; i++) {
    const x = heap[base + (i << 1)];
    if (x > 115) far++;
  }
  assert.ok(far <= 2, `water crossed barrier: far=${far} count=${count}`);
  assert.equal(getParticleCount(), count);
});

test('WASM STATIC_PRESSURE create and step stays finite', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');
  assert.ok(createParticleSystem(worldId, 10, 1.0, 200), 'create_particle_system failed');

  const STATIC_PRESSURE = 1 << 8;
  const gid = createParticleGroupCircle(0, 80, 40, 0, STATIC_PRESSURE, 0, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `circle failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 4, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 10; i++) {
    stepWorld(worldId, dt, 1);
  }
  assert.equal(getParticleCount(), count);

  const heap = new Float32Array(memory.buffer);
  const base = getParticlePosByteOffset() >> 2;
  for (let i = 0; i < count; i++) {
    const x = heap[base + (i << 1)];
    const y = heap[base + (i << 1) + 1];
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `NaN at ${i}: ${x},${y}`);
  }
});

test('WASM particle x/y deinterleave matches the interleaved position buffer', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createBodyBox = fn('create_body_box');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const getParticlePosByteOffset = fn('get_particle_pos_byte_offset');
  const getParticleXByteOffset = fn('get_particle_x_byte_offset');
  const getParticleYByteOffset = fn('get_particle_y_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  const floorSlot = createBodyBox(
    worldId,
    0,
    0, 400, 0,
    2000, 130,
    0, 0,
    1, 0.6, 0,
    0, 0, 1,
    0, 0, 0,
    0, 0,
    1, 0xffffffff,
    0, 0, 0,
  );
  assert.ok(floorSlot >= 0, `create_body_box failed: ${floorSlot}`);

  assert.ok(createParticleSystem(worldId, 10, 1.0, 300), 'create_particle_system failed');
  const gid = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `circle group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 4, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), count);

  const heap = new Float32Array(memory.buffer);
  const posBase = getParticlePosByteOffset() >> 2;
  const xBase = getParticleXByteOffset() >> 2;
  const yBase = getParticleYByteOffset() >> 2;
  assert.ok(posBase > 0 && xBase > 0 && yBase > 0, 'byte offsets missing');
  assert.notEqual(xBase, posBase, 'x buffer should be separate from the interleaved pos buffer');

  for (let i = 0; i < count; i++) {
    assert.equal(heap[xBase + i], heap[posBase + (i << 1)], `x[${i}] mismatch`);
    assert.equal(heap[yBase + i], heap[posBase + (i << 1) + 1], `y[${i}] mismatch`);
  }
});

test('WASM create_particle_system strictContactCheck param reaches C (5th arg)', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  // Explicit strictContactCheck=1 (5th arg). Omitting it (as every other test in
  // this file does) coerces to 0/false via the wasm JS API (ToInt32(undefined)),
  // matching the new liquidFun.strictContactCheck default of false.
  assert.ok(createParticleSystem(worldId, 10, 1.0, 200, 1), 'create_particle_system failed');

  const gid = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, 0, 0, 0, 1, 1);
  assert.ok(gid >= 0, `circle group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 4, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), count, 'strictContactCheck must not drop live particles');

  const heap = new Float32Array(memory.buffer);
  const base = fn('get_particle_pos_byte_offset')() >> 2;
  for (let i = 0; i < count; i++) {
    assert.ok(Number.isFinite(heap[base + (i << 1)]) && Number.isFinite(heap[base + (i << 1) + 1]), `NaN at ${i}`);
  }
});

test('WASM particle lifespan: age-based destruction (SetParticleDestructionByAge-style) sweeps expired particles', () => {
  const { fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');
  assert.ok(createParticleSystem(worldId, 10, 1.0, 300), 'create_particle_system failed');

  // min === max: every particle in the group gets exactly the same lifetime
  // (no per-particle RNG spread), so the expiry step is deterministic.
  const lifetimeSec = 0.1;
  const gid = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, lifetimeSec, lifetimeSec, 0, 1, 1);
  assert.ok(gid >= 0, `circle group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 4, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  // Well past lifetimeSec (0.1s) - SolveLifetime uses the full dt once per
  // step_world call, so ~6 steps cross zero; run extra for a safety margin.
  for (let i = 0; i < 20; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), 0, 'every particle should have aged out and been swept by SolveZombie');
});

test('WASM particle lifespan alpha fades toward 0 only when fadeToAlpha0=1; untracked and fade=0 stay at alpha=1', () => {
  const { memory, fn } = instantiateBox2dWasm();

  const createWorld = fn('create_world');
  const bindGameBuffers = fn('bind_game_buffers');
  const createParticleSystem = fn('create_particle_system');
  const createParticleGroupCircle = fn('create_particle_group_circle');
  const getParticleCount = fn('get_particle_count');
  const getParticleAlphaByteOffset = fn('get_particle_alpha_byte_offset');
  const stepWorld = fn('step_world');

  const worldId = createWorld(0, 980, 100, 30, 0.7, 3, 4000, 1);
  assert.ok(worldId, 'create_world failed');
  assert.ok(bindGameBuffers(16), 'bind_game_buffers failed');

  const dt = 1 / 60;
  const heap = new Float32Array(memory.buffer);

  // --- Block 1: no lifespan requested (0,0) - alpha must stay 1 forever. ---
  assert.ok(createParticleSystem(worldId, 10, 1.0, 300), 'create_particle_system failed');
  const untrackedGid = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, 0, 0, 0, 1, 1);
  assert.ok(untrackedGid >= 0, `circle group failed: ${untrackedGid}`);
  const untrackedCount = getParticleCount();
  assert.ok(untrackedCount > 4, `expected a blob, got ${untrackedCount}`);
  for (let i = 0; i < 30; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), untrackedCount, 'untracked particles must not expire');
  {
    const alphaBase = getParticleAlphaByteOffset() >> 2;
    assert.ok(alphaBase > 0, 'alpha byte offset missing');
    for (let i = 0; i < untrackedCount; i++) {
      assert.equal(heap[alphaBase + i], 1, `untracked particle ${i} alpha should stay 1`);
    }
  }

  // --- Block 2: lifespan + fadeToAlpha0=1, sampled at midpoint → alpha ~0.5. ---
  assert.ok(createParticleSystem(worldId, 10, 1.0, 300), 'create_particle_system failed');
  const lifetimeSec = 1.0;
  const trackedGid = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, lifetimeSec, lifetimeSec, 1, 1, 1);
  assert.ok(trackedGid >= 0, `circle group failed: ${trackedGid}`);
  const trackedCount = getParticleCount();
  assert.ok(trackedCount > 4, `expected a blob, got ${trackedCount}`);

  const halfSteps = Math.round((lifetimeSec * 0.5) / dt);
  for (let i = 0; i < halfSteps; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), trackedCount, 'must not have expired yet at the midpoint');
  {
    const alphaBase = getParticleAlphaByteOffset() >> 2;
    for (let i = 0; i < trackedCount; i++) {
      const a = heap[alphaBase + i];
      assert.ok(a > 0.4 && a < 0.6, `particle ${i} alpha ${a} should be near the 0.5 midpoint`);
    }
  }

  // Run well past full expiry - every tracked particle should now be gone.
  for (let i = 0; i < halfSteps + 20; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), 0, 'every tracked particle should have aged out by now');

  // --- Block 3: lifespan + fadeToAlpha0=0 → alpha stays 1 until destroy. ---
  assert.ok(createParticleSystem(worldId, 10, 1.0, 300), 'create_particle_system failed');
  const opaqueGid = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5, lifetimeSec, lifetimeSec, 0, 1, 1);
  assert.ok(opaqueGid >= 0, `circle group failed: ${opaqueGid}`);
  const opaqueCount = getParticleCount();
  assert.ok(opaqueCount > 4, `expected a blob, got ${opaqueCount}`);
  for (let i = 0; i < halfSteps; i++) {
    stepWorld(worldId, dt, 4);
  }
  assert.equal(getParticleCount(), opaqueCount, 'must not have expired yet at the midpoint');
  {
    const alphaBase = getParticleAlphaByteOffset() >> 2;
    for (let i = 0; i < opaqueCount; i++) {
      assert.equal(heap[alphaBase + i], 1, `fade=0 particle ${i} alpha should stay 1`);
    }
  }
});
