import fs from 'fs';

const wasmBuffer = fs.readFileSync('src/box2d/box2d_wasm.wasm');

// Minimal Emscripten / WebAssembly instantiation without workers
const wasmModule = new WebAssembly.Module(wasmBuffer);

// Memory
const memory = new WebAssembly.Memory({ initial: 4096, maximum: 4096, shared: true });
const table = new WebAssembly.Table({ initial: 1024, element: 'anyfunc' });

const imports = {};
for (const imp of WebAssembly.Module.imports(wasmModule)) {
  if (!imports[imp.module]) imports[imp.module] = {};
  if (imp.kind === 'function') {
    imports[imp.module][imp.name] = () => 0;
  } else if (imp.kind === 'memory') {
    imports[imp.module][imp.name] = memory;
  } else if (imp.kind === 'table') {
    imports[imp.module][imp.name] = table;
  } else if (imp.kind === 'global') {
    imports[imp.module][imp.name] = 0;
  }
}

// Override specific functions
if (imports.a) {
  imports.a.g = memory;
  imports.a.c = table;
}

const instance = new WebAssembly.Instance(wasmModule, imports);

const exports = instance.exports;
console.log('Exports available:', Object.keys(exports).length);

// Call create_world
// params: [f32, f32, f32, f32, f32, f32, f32, i32]
const worldRes = exports["$"](0.0, 980.0, 1.0, 30.0, 10.0, 3.0, 400.0, 1);
console.log('create_world result:', worldRes);

// create_particle_system: params [i32, f32, f32, i32] -> (maxCount, radius, gravityScale, subSteps)
const sysRes = exports["jb"](5000, 10.0, 1.0, 2);
console.log('create_particle_system result:', sysRes);

// get_particle_count: params []
console.log('get_particle_count before group:', exports["qb"]());

// create_particle_group_circle: params [f32, f32, f32, f32, i32, f32] -> (posX, posY, radius, linearVel, flags, color)
const grpRes = exports["nb"](1600.0, 400.0, 90.0, 0.0, 0, 0.0);
console.log('create_particle_group_circle result:', grpRes);

console.log('get_particle_count after circle group:', exports["qb"]());

// create_particle_group_box: params [f32, f32, f32, f32, f32, i32, f32] -> (posX, posY, halfWidth, halfHeight, linearVel, flags, color)
const boxRes = exports["mb"](2000.0, 100.0, 100.0, 50.0, 0.0, 0, 0.0);
console.log('create_particle_group_box result:', boxRes);

console.log('get_particle_count after box group:', exports["qb"]());

const posOffset = exports["ub"]();
console.log('get_particle_pos_byte_offset:', posOffset);

// Read first 5 particle positions from memory
const heapF32 = new Float32Array(memory.buffer);
const floatOffset = posOffset >> 2;
console.log('First 3 particle positions:');
for (let i = 0; i < 3; i++) {
  console.log(`Particle ${i}: x=${heapF32[floatOffset + i*2]}, y=${heapF32[floatOffset + i*2 + 1]}`);
}
