import fs from 'fs';

const buf = fs.readFileSync('src/box2d/box2d_wasm.wasm');
const jsCode = fs.readFileSync('src/box2d/box2d_wasm.js', 'utf8');

// Extract all Module["_..."] = wasmExports["..."] from jsCode
const exportMap = {};
const regex = /Module\["(_[a-zA-Z0-9_]+)"\]\s*=\s*wasmExports\["([^"]+)"\]/g;
let m;
while ((m = regex.exec(jsCode)) !== null) {
  exportMap[m[2]] = m[1];
}

// Also check direct exports
const directRegex = /(_[a-zA-Z0-9_]+)\s*=\s*wasmExports\["([^"]+)"\]/g;
while ((m = directRegex.exec(jsCode)) !== null) {
  exportMap[m[2]] = m[1];
}

let offset = 8;
let types = [];
let funcTypes = [];
let exportFuncs = {};

const valTypes = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64' };

while (offset < buf.length) {
  const sectionId = buf[offset++];
  let sectionLen = 0, shift = 0;
  while (true) {
    const b = buf[offset++];
    sectionLen |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const nextSection = offset + sectionLen;

  if (sectionId === 1) {
    let numTypes = buf[offset++];
    for (let i = 0; i < numTypes; i++) {
      buf[offset++]; // 0x60
      let numParams = buf[offset++];
      let params = [];
      for (let p = 0; p < numParams; p++) params.push(valTypes[buf[offset++]] || '?');
      let numReturns = buf[offset++];
      let returns = [];
      for (let r = 0; r < numReturns; r++) returns.push(valTypes[buf[offset++]] || '?');
      types.push({ params, returns });
    }
  } else if (sectionId === 3) {
    let numFuncs = 0, shift = 0;
    while (true) {
      const b = buf[offset++];
      numFuncs |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    for (let i = 0; i < numFuncs; i++) {
      let typeIdx = 0, shift = 0;
      while (true) {
        const b = buf[offset++];
        typeIdx |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      funcTypes.push(typeIdx);
    }
  } else if (sectionId === 7) {
    let numExports = 0, shift = 0;
    while (true) {
      const b = buf[offset++];
      numExports |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    for (let i = 0; i < numExports; i++) {
      let nameLen = 0, shift = 0;
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
      if (kind === 0) exportFuncs[name] = funcIdx;
    }
  }
  offset = nextSection;
}

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
        impOffset++;
      } else if (kind === 1) impOffset += 3;
      else if (kind === 2) impOffset += 2;
      else if (kind === 3) impOffset += 2;
    }
    break;
  }
  impOffset = next;
}

for (const [wasmName, funcIdx] of Object.entries(exportFuncs)) {
  const localIdx = funcIdx - numImportedFuncs;
  if (localIdx >= 0 && localIdx < funcTypes.length) {
    const typeIdx = funcTypes[localIdx];
    const type = types[typeIdx];
    const cName = exportMap[wasmName] || wasmName;
    console.log(`${cName} (${wasmName}): [${type.params.join(', ')}] -> [${type.returns.join(', ')}]`);
  }
}
