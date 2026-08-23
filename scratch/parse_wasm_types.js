import fs from 'fs';

const buf = fs.readFileSync('src/box2d/box2d_wasm.wasm');

// Parse WASM sections
let offset = 8; // skip header + version

let types = [];
let funcTypes = [];
let exportFuncs = {};

const valTypes = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
};

while (offset < buf.length) {
  const sectionId = buf[offset++];
  let sectionLen = 0;
  let shift = 0;
  while (true) {
    const b = buf[offset++];
    sectionLen |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const nextSection = offset + sectionLen;

  if (sectionId === 1) { // Type section
    let numTypes = buf[offset++];
    for (let i = 0; i < numTypes; i++) {
      const form = buf[offset++]; // 0x60 = func
      let numParams = buf[offset++];
      let params = [];
      for (let p = 0; p < numParams; p++) {
        params.push(valTypes[buf[offset++]] || 'unknown');
      }
      let numReturns = buf[offset++];
      let returns = [];
      for (let r = 0; r < numReturns; r++) {
        returns.push(valTypes[buf[offset++]] || 'unknown');
      }
      types.push({ params, returns });
    }
  } else if (sectionId === 3) { // Function section
    let numFuncs = 0;
    let shift = 0;
    while (true) {
      const b = buf[offset++];
      numFuncs |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    for (let i = 0; i < numFuncs; i++) {
      let typeIdx = 0;
      let shift = 0;
      while (true) {
        const b = buf[offset++];
        typeIdx |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      funcTypes.push(typeIdx);
    }
  } else if (sectionId === 7) { // Export section
    let numExports = 0;
    let shift = 0;
    while (true) {
      const b = buf[offset++];
      numExports |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    for (let i = 0; i < numExports; i++) {
      let nameLen = 0;
      let shift = 0;
      while (true) {
        const b = buf[offset++];
        nameLen |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      const name = buf.toString('utf8', offset, offset + nameLen);
      offset += nameLen;
      const kind = buf[offset++];
      let funcIdx = 0;
      shift = 0;
      while (true) {
        const b = buf[offset++];
        funcIdx |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      if (kind === 0) { // function
        exportFuncs[name] = funcIdx;
      }
    }
  }

  offset = nextSection;
}

console.log('Total exported functions:', Object.keys(exportFuncs).length);

// Count of imported functions (they occupy function indices before local functions)
// Let's count imported functions from import section (section 2)
let impOffset = 8;
let numImportedFuncs = 0;
while (impOffset < buf.length) {
  const sId = buf[impOffset++];
  let sLen = 0, shift = 0;
  while (true) {
    const b = buf[impOffset++];
    sLen |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const next = impOffset + sLen;
  if (sId === 2) {
    let numImports = buf[impOffset++];
    for (let i = 0; i < numImports; i++) {
      let modLen = buf[impOffset++];
      impOffset += modLen;
      let fieldLen = buf[impOffset++];
      impOffset += fieldLen;
      let kind = buf[impOffset++];
      if (kind === 0) {
        numImportedFuncs++;
        impOffset++; // typeIdx
      } else if (kind === 1) { // table
        impOffset += 3;
      } else if (kind === 2) { // mem
        impOffset += 2;
      } else if (kind === 3) { // global
        impOffset += 2;
      }
    }
    break;
  }
  impOffset = next;
}

console.log('Imported function count:', numImportedFuncs);

const exportsToInspect = {
  jb: '_create_particle_system',
  kb: '_destroy_particle_system',
  lb: '_create_particle_box',
  mb: '_create_particle_group_box',
  nb: '_create_particle_group_circle',
  ob: '_destroy_particle_group',
  pb: '_set_particle_sub_steps',
  qb: '_get_particle_count',
  rb: '_get_particle_capacity',
  sb: '_get_particle_radius',
  tb: '_get_particle_count_byte_offset',
  ub: '_get_particle_pos_byte_offset',
  vb: '_get_particle_vel_byte_offset',
  wb: '_get_particle_flags_byte_offset',
};

for (const [wasmName, cName] of Object.entries(exportsToInspect)) {
  const fIdx = exportFuncs[wasmName];
  if (fIdx !== undefined) {
    const localIdx = fIdx - numImportedFuncs;
    const typeIdx = funcTypes[localIdx];
    const type = types[typeIdx];
    console.log(`${cName} (${wasmName}): params [${type ? type.params.join(', ') : '?'}] -> returns [${type ? type.returns.join(', ') : '?'}]`);
  } else {
    console.log(`${cName} (${wasmName}): not found in exports!`);
  }
}
