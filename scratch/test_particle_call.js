import fs from 'fs';
import { Worker } from 'node:worker_threads';

// Load and execute box2d_wasm.js in Node
const wasmBuffer = fs.readFileSync('src/box2d/box2d_wasm.wasm');

// Mock self/window/importScripts
globalThis.self = globalThis;
globalThis.Worker = Worker;
globalThis.importScripts = () => {};

// We can read box2d_wasm.js
const box2dCode = fs.readFileSync('src/box2d/box2d_wasm.js', 'utf8');

// Set Module options
globalThis.Module = {
  wasmBinary: wasmBuffer,
  onRuntimeInitialized() {
    console.log('✅ Box2D WASM initialized in Node!');
    testLiquidFun();
  }
};

// Run box2d_wasm.js via eval or Function
const runBox2D = new Function(box2dCode);
runBox2D();

function testLiquidFun() {
  const M = globalThis.Module;
  console.log('Exported functions:', {
    create_world: typeof M._create_world,
    create_particle_system: typeof M._create_particle_system,
    create_particle_group_circle: typeof M._create_particle_group_circle,
    get_particle_count: typeof M._get_particle_count,
  });

  // Test create_world
  // create_world(gravityX, gravityY, lengthUnitsPerMeter, contactHertz, contactDampingRatio, contactSpeed, maximumLinearSpeed, workerCount)
  const worldId = M._create_world(0, 980, 1, 30, 10, 3, 400, 1);
  console.log('Created worldId:', worldId);

  // Test create_particle_system with different signatures
  console.log('Testing create_particle_system(worldId, 10, 5000):', M._create_particle_system(worldId, 10, 5000));
  console.log('Testing create_particle_system(10, 5000):', M._create_particle_system(10, 5000));
  console.log('Testing create_particle_system(worldId, 10, 5000, 2):', M._create_particle_system(worldId, 10, 5000, 2));

  // Check particle system creation and circle group
  const sys1 = M._create_particle_system(worldId, 10, 5000);
  console.log('sys1 result:', sys1);
  
  if (sys1) {
    const grp = M._create_particle_group_circle(sys1, 1600, 400, 90, 0, 0, 0, 0);
    console.log('create_particle_group_circle result:', grp);
    const count = M._get_particle_count(sys1);
    console.log('get_particle_count:', count);
  }
}
