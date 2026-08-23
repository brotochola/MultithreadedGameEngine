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
