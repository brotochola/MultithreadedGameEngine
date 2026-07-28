/**
 * Offline smoke: worker_common rewrite + gzip wasm embed decode.
 * Does not launch a browser — just validates embedded payload contracts.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'dist', 'weed.bundle.min.js');
const s = fs.readFileSync(bundlePath, 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(s.includes('WorkerCommonSource'), 'missing WorkerCommonSource');
assert(s.includes('DecompressionStream'), 'missing DecompressionStream gunzip path');
assert(/H4sI/.test(s), 'expected gzip magic in base64 (H4sI...)');

// Simulate webpack chunk loader rewrite used by createWorker().
const sample =
  '__webpack_require__.u=chunkId=>"workers/worker_common.min.js";' +
  '__webpack_require__.p=scriptUrl+"../";' +
  'importScripts(__webpack_require__.p+__webpack_require__.u(chunkId));';
const commonUrl = 'blob:http://localhost/fake-common';
let code = sample.replace(
  /__webpack_require__\.u\s*=\s*chunkId\s*=>\s*"[^"]*worker_common[^"]*"/g,
  '__webpack_require__.u=chunkId=>' + JSON.stringify(commonUrl),
);
code = code.replace(
  /__webpack_require__\.p\s*=\s*scriptUrl\s*\+\s*"\.\.\/"/g,
  '__webpack_require__.p=""',
);
assert(code.includes(JSON.stringify(commonUrl)), 'u() not rewritten to blob URL');
assert(code.includes('__webpack_require__.p=""'), 'publicPath not cleared');
assert(!code.includes('workers/worker_common.min.js'), 'old common path still present');

// Extract first long base64-ish gzip payload after H4sI and inflate a prefix check.
const b64Match = s.match(/H4sI[A-Za-z0-9+/=]{100,}/);
assert(b64Match, 'no gzip base64 payload found');
const raw = Buffer.from(b64Match[0], 'base64');
const inflated = zlib.gunzipSync(raw);
assert(inflated.length > 10000, `gunzip too small: ${inflated.length}`);
assert(inflated[0] === 0x00 && inflated[1] === 0x61, 'gunzipped bytes do not look like wasm (\\0asm)');

console.log('smoke-bundle-embed OK');
console.log(`  gunzip wasm bytes: ${inflated.length}`);
console.log(`  rewrite sample: ${code.slice(0, 120)}...`);
