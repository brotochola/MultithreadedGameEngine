// LiquidFun save helpers: pack/unpack HEAP+render snapshots for SaveGame payloads.

function bytesToBase64(bytes) {
  if (!bytes || !bytes.length) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  if (!b64) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function packTyped(arr) {
  if (!arr || !arr.length) return { t: 'empty', b64: '' };
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let t = 'u8';
  if (arr instanceof Float32Array) t = 'f32';
  else if (arr instanceof Uint32Array) t = 'u32';
  else if (arr instanceof Uint16Array) t = 'u16';
  else if (arr instanceof Int32Array) t = 'i32';
  return { t, b64: bytesToBase64(u8), n: arr.length };
}

function unpackTyped(pack) {
  if (!pack || pack.t === 'empty' || !pack.b64) {
    if (pack?.t === 'f32') return new Float32Array(0);
    if (pack?.t === 'u32') return new Uint32Array(0);
    if (pack?.t === 'u16') return new Uint16Array(0);
    if (pack?.t === 'i32') return new Int32Array(0);
    return new Uint8Array(0);
  }
  const u8 = base64ToBytes(pack.b64);
  if (pack.t === 'f32') return new Float32Array(u8.buffer, u8.byteOffset, pack.n | (u8.byteLength >> 2));
  if (pack.t === 'u32') return new Uint32Array(u8.buffer, u8.byteOffset, pack.n | (u8.byteLength >> 2));
  if (pack.t === 'u16') return new Uint16Array(u8.buffer, u8.byteOffset, pack.n | (u8.byteLength >> 1));
  if (pack.t === 'i32') return new Int32Array(u8.buffer, u8.byteOffset, pack.n | (u8.byteLength >> 2));
  return u8;
}

/**
 * Convert a live physics snapshot into a JSON-serializable liquidFun payload blob.
 * @param {object|null} snap from weedjsSnapshotLiquidFun
 */
function packGroups(groups) {
  if (!groups || !(groups.slotCount > 0)) return null;
  return {
    slotCount: groups.slotCount | 0,
    alive: packTyped(groups.alive),
    flags: packTyped(groups.flags),
    groupFlags: packTyped(groups.groupFlags),
    strength: packTyped(groups.strength),
    viscousScale: packTyped(groups.viscousScale),
    firstIndex: packTyped(groups.firstIndex),
    lastIndex: packTyped(groups.lastIndex),
  };
}

function unpackGroups(pack) {
  if (!pack || !(pack.slotCount > 0)) return null;
  return {
    slotCount: pack.slotCount | 0,
    alive: unpackTyped(pack.alive),
    flags: unpackTyped(pack.flags),
    groupFlags: unpackTyped(pack.groupFlags),
    strength: unpackTyped(pack.strength),
    viscousScale: unpackTyped(pack.viscousScale),
    firstIndex: unpackTyped(pack.firstIndex),
    lastIndex: unpackTyped(pack.lastIndex),
  };
}

function packPairs(pairs) {
  if (!pairs || !(pairs.count > 0)) return null;
  return {
    count: pairs.count | 0,
    a: packTyped(pairs.a),
    b: packTyped(pairs.b),
    flags: packTyped(pairs.flags),
    distance: packTyped(pairs.distance),
    strength: packTyped(pairs.strength),
  };
}

function unpackPairs(pack) {
  if (!pack || !(pack.count > 0)) return null;
  return {
    count: pack.count | 0,
    a: unpackTyped(pack.a),
    b: unpackTyped(pack.b),
    flags: unpackTyped(pack.flags),
    distance: unpackTyped(pack.distance),
    strength: unpackTyped(pack.strength),
  };
}

export function packLiquidFunSnapshot(snap) {
  if (!snap || !(snap.count > 0)) {
    return null;
  }
  const render = snap.render
    ? {
        tint: packTyped(snap.render.tint),
        textureId: packTyped(snap.render.textureId),
        scaleX: packTyped(snap.render.scaleX),
        scaleY: packTyped(snap.render.scaleY),
        alpha: packTyped(snap.render.alpha),
        rotC: snap.render.rotC ? packTyped(snap.render.rotC) : null,
        rotS: snap.render.rotS ? packTyped(snap.render.rotS) : null,
        layerId: snap.render.layerId ? packTyped(snap.render.layerId) : null,
      }
    : null;
  return {
    count: snap.count | 0,
    radius: snap.radius,
    maxCount: snap.maxCount | 0,
    pos: packTyped(snap.pos),
    vel: packTyped(snap.vel),
    flags: packTyped(snap.flags),
    groupIndex: snap.groupIndex ? packTyped(snap.groupIndex) : null,
    restOffset: snap.restOffset ? packTyped(snap.restOffset) : null,
    groups: packGroups(snap.groups),
    pairs: packPairs(snap.pairs),
    render,
  };
}

/**
 * Unpack JSON liquidFun blob into typed arrays for weedjsRestoreLiquidFun.
 * @param {object|null} blob
 */
export function unpackLiquidFunSnapshot(blob) {
  if (!blob || !(blob.count > 0)) {
    return {
      count: 0,
      pos: new Float32Array(0),
      vel: new Float32Array(0),
      flags: new Uint32Array(0),
      groupIndex: null,
      restOffset: null,
      groups: null,
      pairs: null,
      render: null,
    };
  }
  const render = blob.render
    ? {
        tint: unpackTyped(blob.render.tint),
        textureId: unpackTyped(blob.render.textureId),
        scaleX: unpackTyped(blob.render.scaleX),
        scaleY: unpackTyped(blob.render.scaleY),
        alpha: unpackTyped(blob.render.alpha),
        rotC: blob.render.rotC ? unpackTyped(blob.render.rotC) : null,
        rotS: blob.render.rotS ? unpackTyped(blob.render.rotS) : null,
        layerId: blob.render.layerId ? unpackTyped(blob.render.layerId) : null,
      }
    : null;
  return {
    count: blob.count | 0,
    radius: blob.radius,
    maxCount: blob.maxCount | 0,
    pos: unpackTyped(blob.pos),
    vel: unpackTyped(blob.vel),
    flags: unpackTyped(blob.flags),
    groupIndex: blob.groupIndex ? unpackTyped(blob.groupIndex) : null,
    restOffset: blob.restOffset ? unpackTyped(blob.restOffset) : null,
    groups: unpackGroups(blob.groups),
    pairs: unpackPairs(blob.pairs),
    render,
  };
}

let _lfRequestSeq = 1;

/**
 * Ask the physics worker for a LiquidFun HEAP+render snapshot.
 * @param {Worker} physicsWorker
 * @param {number} [timeoutMs]
 */
export function requestLiquidFunSnapshot(physicsWorker, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!physicsWorker) {
      resolve(null);
      return;
    }
    const requestId = _lfRequestSeq++;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('LiquidFun snapshot timeout'));
    }, timeoutMs);

    function onMessage(e) {
      if (!e?.data || e.data.msg !== 'liquidFunSnapshot') return;
      if ((e.data.requestId | 0) !== requestId) return;
      cleanup();
      resolve(e.data.snapshot || null);
    }
    function cleanup() {
      clearTimeout(timer);
      physicsWorker.removeEventListener('message', onMessage);
    }
    physicsWorker.addEventListener('message', onMessage);
    physicsWorker.postMessage({ msg: 'snapshotLiquidFun', requestId });
  });
}

/**
 * Push a packed/unpacked liquidFun blob to the physics worker for restore.
 * @param {Worker} physicsWorker
 * @param {object} payload unpacked snapshot (typed arrays)
 * @param {number} [timeoutMs]
 */
export function requestLiquidFunRestore(physicsWorker, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!physicsWorker) {
      resolve({ ok: false, reason: 'no-worker' });
      return;
    }
    const requestId = _lfRequestSeq++;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('LiquidFun restore timeout'));
    }, timeoutMs);

    function onMessage(e) {
      if (!e?.data || e.data.msg !== 'liquidFunRestoreComplete') return;
      if ((e.data.requestId | 0) !== requestId) return;
      cleanup();
      resolve(e.data.result || { ok: false });
    }
    function cleanup() {
      clearTimeout(timer);
      physicsWorker.removeEventListener('message', onMessage);
    }

    const transfer = [];
    const pushBuf = (a) => {
      if (a && a.buffer) transfer.push(a.buffer);
    };
    pushBuf(payload?.pos);
    pushBuf(payload?.vel);
    pushBuf(payload?.flags);
    pushBuf(payload?.groupIndex);
    pushBuf(payload?.restOffset);
    if (payload?.groups) {
      for (const k of Object.keys(payload.groups)) pushBuf(payload.groups[k]);
    }
    if (payload?.pairs) {
      for (const k of Object.keys(payload.pairs)) pushBuf(payload.pairs[k]);
    }
    if (payload?.render) {
      for (const k of Object.keys(payload.render)) pushBuf(payload.render[k]);
    }
    physicsWorker.addEventListener('message', onMessage);
    physicsWorker.postMessage({ msg: 'restoreLiquidFun', requestId, payload }, transfer);
  });
}
