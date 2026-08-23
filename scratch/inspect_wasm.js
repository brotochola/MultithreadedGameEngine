import fs from 'fs';

const wasmBuffer = fs.readFileSync('src/box2d/box2d_wasm.wasm');
const wasmModule = new WebAssembly.Module(wasmBuffer);
const exports = WebAssembly.Module.exports(wasmModule);

const particleExports = exports.filter(e => 
  ['create_particle_system', 'create_particle_box', 'create_particle_group_box', 'create_particle_group_circle', 'destroy_particle_group', 'destroy_particle_system', 'set_particle_sub_steps', 'get_particle_count', 'get_particle_pos_byte_offset'].includes(e.name)
  || ['jb', 'kb', 'lb', 'mb', 'nb', 'ob', 'pb', 'qb', 'rb', 'sb', 'tb', 'ub', 'vb', 'wb'].includes(e.name)
);

console.log('Particle exports in WASM:', JSON.stringify(particleExports, null, 2));

const allExports = exports.map(e => `${e.name} (${e.kind})`);
console.log('All exports count:', allExports.length);
console.log('All export names:', allExports.filter(e => e.includes('particle')));
