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

  // Static floor at y=400, half-height 30 → top at 370
  const floorSlot = createBodyBox(
    worldId,
    0, // static
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
  assert.ok(floorSlot >= 0, `create_body_box failed: ${floorSlot}`);

  const sysOk = createParticleSystem(worldId, 10, 1.0, 500);
  assert.ok(sysOk, 'create_particle_system failed');

  const circle0 = createParticleGroupCircle(0, 80, 40, 0, 0, 0.5);
  assert.ok(circle0 >= 0, `first circle group failed: ${circle0}`);
  const circle1 = createParticleGroupCircle(80, 80, 30, 0, 16, 0.5);
  assert.ok(circle1 >= 0, `second circle group failed: ${circle1}`);
  const boxGrp = createParticleGroupBox(-40, 40, 40, 100, 0, 32, 0.5);
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
  for (let i = 0; i < count; i++) {
    const y = heap[base + (i << 1) + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const floorTop = 370;
  assert.ok(
    maxY < floorTop + 40,
    `particles fell through floor: maxY=${maxY} floorTop=${floorTop}`,
  );
  assert.ok(
    maxY > floorTop - 80,
    `particles never reached the floor (gravity/step dead?): maxY=${maxY} floorTop=${floorTop}`,
  );
  assert.ok(minY > -200, `particles escaped upward unexpectedly: minY=${minY}`);
  assert.ok(
    maxY - minY > 25,
    `particles compressed too much: spanY=${maxY - minY} minY=${minY} maxY=${maxY}`,
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

  // Floor top at y=370. Wall right face at x=20.
  const floorSlot = createBodyBox(
    worldId,
    0, // static
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
  const wallSlot = createBodyBox(
    worldId,
    0,
    0, 250, 0,
    20, 200,
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

  const gid = createParticleGroupCircle(90, 200, 50, 0, 0, 0);
  assert.ok(gid >= 0, `circle group failed: ${gid}`);
  const count = getParticleCount();
  assert.ok(count > 8, `expected a blob, got ${count}`);

  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    stepWorld(worldId, dt, 4);
  }

  const heap = new Float32Array(memory.buffer);
  const base = getParticlePosByteOffset() >> 2;
  const wallFace = 20;
  const nearWall = wallFace + 25;
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
  assert.ok(puddleSpan > 15, `wall puddle crushed: spanY=${puddleSpan}`);
  assert.ok(
    puddleMaxY < 370 + 40,
    `particles fell through floor: maxY=${puddleMaxY}`,
  );

  const wallX0 = -20;
  const wallX1 = 20;
  const wallY0 = 50;
  const wallY1 = 450;
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
  const gid = createParticleGroupCircle(400, 220, 40, 0, 0, 0);
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

  const gid = createParticleGroupBox(-340, -340, 340, 340, 0, 0, 0);
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
    400, 30,
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
  const floorTop = 370;
  assert.ok(Number.isFinite(y) && Number.isFinite(vy), `non-finite: y=${y} vy=${vy}`);
  assert.ok(
    Math.abs(vy) < 80,
    `particle still bouncing: |vy|=${vy} (overlap launch is ~600)`,
  );
  assert.ok(
    y > floorTop - 12 && y < floorTop + 12,
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

  const gid = createParticleGroupCircle(40, 300, 35, 0, 0, 0);
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
  const gid = createParticleGroupCircle(0, 80, 40, 0, STATIC_PRESSURE, 0);
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
