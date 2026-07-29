/**
 * Build script for single-file bundle with inline workers
 *
 * Emits both debug and prod UMD/ESM artifacts in one run:
 *   weed.bundle.min.js / weed.bundle.esm.min.js
 *   weed.prod.bundle.min.js / weed.prod.bundle.esm.min.js
 *
 * Workers share one worker_common chunk (AbstractWorker graph). Box2D WASM is
 * gzip'd then base64-embedded and inflated at runtime via DecompressionStream.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const workersDir = path.join(distDir, 'workers');
const webpackCli = path.join(rootDir, 'node_modules', 'webpack-cli', 'bin', 'cli.js');

if (process.argv.includes('--obfuscate')) process.env.OBFUSCATE = 'true';
const shouldObfuscate = process.env.OBFUSCATE === 'true';

const WORKER_NAMES = [
    'spatial_worker',
    'logic_worker',
    'pixi_worker',
    'particle_worker',
    'pre_render_worker',
];

const BOX2D_SIBLING_NAMES = [
    'weedjs_post.js',
    'physics_host.impl.js',
    'physics-api.js',
    'box2dConstants.impl.js',
    'box2dCommandRing.impl.js',
    'box2dContactRing.impl.js',
    'box2dMovedBodies.impl.js',
];

const KEEP_DIST_FILES = new Set([
    'weed.bundle.min.js',
    'weed.bundle.esm.min.js',
    'weed.prod.bundle.min.js',
    'weed.prod.bundle.esm.min.js',
    'index.html',
]);

function kb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function makeBuildEnv(prod) {
    return {
        ...process.env,
        OBFUSCATE: shouldObfuscate ? 'true' : 'false',
        WEED_PROD: prod ? 'true' : 'false',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192']
            .filter(Boolean)
            .join(' '),
    };
}

function runWebpack(configFile, env) {
    execSync(`node "${webpackCli}" --config ${configFile}`, {
        cwd: rootDir,
        stdio: 'inherit',
        env,
    });
}

function buildBox2dWorkerSource() {
    const box2dDir = path.join(rootDir, 'src', 'box2d');
    const box2dSiblingScripts = {};
    for (const name of BOX2D_SIBLING_NAMES) {
        box2dSiblingScripts[name] = fs.readFileSync(path.join(box2dDir, name), 'utf8');
    }

    const box2dGlue = fs.readFileSync(path.join(box2dDir, 'box2d_wasm.js'), 'utf8');
    const wasmBytes = fs.readFileSync(path.join(box2dDir, 'box2d_wasm.wasm'));
    const gzipped = zlib.gzipSync(wasmBytes, { level: 9 });
    const box2dWasmGzipB64 = gzipped.toString('base64');

    console.log(
        `   Box2D wasm: ${kb(wasmBytes.length)} raw → ${kb(gzipped.length)} gzip → ` +
            `${kb(Buffer.byteLength(box2dWasmGzipB64, 'utf8'))} base64`,
    );

    const box2dGluePatched = box2dGlue.replace(
        /importScripts\(\s*["']weedjs_post\.js["']\s*\)\s*;?\s*importScripts\(\s*["']physics_host\.impl\.js["']\s*\)/,
        '/* weedjs_post + physics_host preloaded for bundle embed */',
    ).replace(
        /importScripts\(\s*["']weedjs_post\.js["']\s*\)/,
        '/* weedjs_post preloaded for bundle embed */',
    );

    // gzip-before-base64; inflate async via DecompressionStream, then instantiate.
    return (
        `(function(global){\n` +
        `  var Module = global.Module || {};\n` +
        `  var __weedWasmGzipB64 = ${JSON.stringify(box2dWasmGzipB64)};\n` +
        `  function __weedB64ToU8(b64) {\n` +
        `    var binary = atob(b64);\n` +
        `    var bytes = new Uint8Array(binary.length);\n` +
        `    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);\n` +
        `    return bytes;\n` +
        `  }\n` +
        `  function __weedGunzip(bytes) {\n` +
        `    if (typeof DecompressionStream === "undefined") {\n` +
        `      return Promise.reject(new Error("DecompressionStream required for Weed Box2D embed"));\n` +
        `    }\n` +
        `    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));\n` +
        `    return new Response(stream).arrayBuffer().then(function(buf) { return new Uint8Array(buf); });\n` +
        `  }\n` +
        `  // Emscripten may return a Promise from instantiateWasm.\n` +
        `  Module["instantiateWasm"] = function(info, receiveInstance) {\n` +
        `    return __weedGunzip(__weedB64ToU8(__weedWasmGzipB64)).then(function(wasmBinary) {\n` +
        `      return WebAssembly.instantiate(wasmBinary, info).then(function(result) {\n` +
        `        receiveInstance(result.instance, result.module);\n` +
        `        return result.instance.exports;\n` +
        `      });\n` +
        `    });\n` +
        `  };\n` +
        `  global.Module = Module;\n` +
        `  var __weedBox2dScripts = ${JSON.stringify(box2dSiblingScripts)};\n` +
        `  var __weedBox2dBlobs = Object.create(null);\n` +
        `  var __importScripts = global.importScripts.bind(global);\n` +
        `  global.importScripts = function() {\n` +
        `    var args = Array.prototype.slice.call(arguments).map(function(u) {\n` +
        `      var name = String(u).split("/").pop().split("?")[0];\n` +
        `      if (__weedBox2dScripts[name]) {\n` +
        `        if (!__weedBox2dBlobs[name]) {\n` +
        `          __weedBox2dBlobs[name] = URL.createObjectURL(\n` +
        `            new Blob([__weedBox2dScripts[name]], { type: "application/javascript" })\n` +
        `          );\n` +
        `        }\n` +
        `        return __weedBox2dBlobs[name];\n` +
        `      }\n` +
        `      return u;\n` +
        `    });\n` +
        `    return __importScripts.apply(global, args);\n` +
        `  };\n` +
        `  if (global.name !== "em-pthread") {\n` +
        `    global.importScripts("weedjs_post.js");\n` +
        `    global.importScripts("physics_host.impl.js");\n` +
        `    var __weedReady = Module["onRuntimeInitialized"];\n` +
        `    Module["onRuntimeInitialized"] = function () {\n` +
        `      if (typeof __weedReady === "function") __weedReady();\n` +
        `    };\n` +
        `  }\n` +
        `})(typeof self !== "undefined" ? self : this);\n` +
        box2dGluePatched
    );
}

function readWorkerArtifacts() {
    const workers = {};
    const sizes = {};
    for (const name of WORKER_NAMES) {
        const filePath = path.join(workersDir, `${name}.min.js`);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing worker build: ${filePath}`);
        }
        workers[name] = fs.readFileSync(filePath, 'utf8');
        sizes[name] = Buffer.byteLength(workers[name], 'utf8');
    }

    const commonPath = path.join(workersDir, 'worker_common.min.js');
    let workerCommon = '';
    if (fs.existsSync(commonPath)) {
        workerCommon = fs.readFileSync(commonPath, 'utf8');
        sizes.worker_common = Buffer.byteLength(workerCommon, 'utf8');
    } else {
        console.warn('   WARN: workers/worker_common.min.js missing — workers not deduped');
        sizes.worker_common = 0;
    }

    return { workers, workerCommon, sizes };
}

function writeBundleEntry({ workers, workerCommon, box2dWorkerSource, audioWorkletSource, debugUICSS }) {
    const workerSourceLines = WORKER_NAMES.map(
        (name) => `  ${name}: ${JSON.stringify(workers[name])},`,
    ).join('\n');

    return `/**
 * WeedJS Single-File Bundle Entry Point
 * Workers + Box2D classic physics host are embedded as strings in WEED.*
 * AUTO-GENERATED - DO NOT EDIT
 */

import WEED_BASE from './index.js';
export * from './index.js';

const WorkerSources = Object.freeze({
${workerSourceLines}
});

const WorkerCommonSource = ${JSON.stringify(workerCommon)};

let box2dWorkerBlobUrl = null;
let workerCommonBlobUrl = null;

function rewriteWorkerCommonImportScripts(source, commonUrl) {
  if (!commonUrl || !source) return source;
  // Webpack emits: importScripts(__webpack_require__.p + __webpack_require__.u(id))
  // with u() => "workers/worker_common.min.js" and p = scriptUrl + "../".
  // Blob workers have no useful script directory, so point u() at the common
  // blob URL and clear publicPath.
  var code = source.replace(
    /__webpack_require__\\.u\\s*=\\s*chunkId\\s*=>\\s*"[^"]*worker_common[^"]*"/g,
    '__webpack_require__.u=chunkId=>' + JSON.stringify(commonUrl)
  );
  code = code.replace(
    /__webpack_require__\\.p\\s*=\\s*scriptUrl\\s*\\+\\s*"\\.\\.\\/"/g,
    '__webpack_require__.p=""'
  );
  return code;
}

const WEED = Object.freeze({
  ...WEED_BASE,
  WorkerSources,
  WorkerCommonSource,
  Box2dWorkerSource: ${JSON.stringify(box2dWorkerSource)},
  AudioWorkletSource: ${JSON.stringify(audioWorkletSource)},
  DebugUICSS: ${JSON.stringify(debugUICSS)},
  BUNDLE_MODE: true,
  createWorker(workerName) {
    const source = WorkerSources[workerName];
    if (!source) {
      throw new Error('Unknown worker: ' + workerName + '. Available: ' + Object.keys(WorkerSources).join(', '));
    }
    if (WorkerCommonSource && !workerCommonBlobUrl) {
      workerCommonBlobUrl = URL.createObjectURL(
        new Blob([WorkerCommonSource], { type: 'application/javascript' })
      );
    }
    const code = rewriteWorkerCommonImportScripts(source, workerCommonBlobUrl);
    const blob = new Blob([code], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  },
  /** Absolute blob: URL for classic Box2D physics host (pthreads re-fetch same URL). */
  getBox2dWorkerUrl() {
    if (!box2dWorkerBlobUrl) {
      box2dWorkerBlobUrl = URL.createObjectURL(
        new Blob([this.Box2dWorkerSource], { type: 'application/javascript' })
      );
    }
    return box2dWorkerBlobUrl;
  },
});

if (typeof window !== 'undefined') {
  window.WEED = WEED;
}

export default WEED;
`;
}

function printSizeBreakdown(label, sizes, box2dSourceLen) {
    console.log(`\n📐 Embedded payload [${label}]:`);
    if (sizes.worker_common) {
        console.log(`   worker_common:     ${kb(sizes.worker_common)}`);
    }
    for (const name of WORKER_NAMES) {
        const pad = ' '.repeat(Math.max(1, 18 - name.length));
        console.log(`   ${name}:${pad}${kb(sizes[name])}`);
    }
    console.log(`   Box2dWorkerSource: ${kb(box2dSourceLen)}`);
}

function buildOnce({ prod, box2dWorkerSource, audioWorkletSource }) {
    const label = prod ? 'production (no debug)' : 'debug';
    const env = makeBuildEnv(prod);
    console.log(`\n🌿 Building WeedJS single-file bundle [${label}]...\n`);

    console.log('📦 Step 1: Building workers...');
    runWebpack('webpack.config.js', env);

    console.log('\n📝 Step 2: Reading compiled workers...');
    const { workers, workerCommon, sizes } = readWorkerArtifacts();

    const debugUICSS = prod
        ? ''
        : fs.readFileSync(path.join(rootDir, 'src', 'core', 'debug', 'DebugUI.css'), 'utf8');

    printSizeBreakdown(label, sizes, Buffer.byteLength(box2dWorkerSource, 'utf8'));

    console.log('\n🔧 Step 3: Generating bundle entry with embedded workers...');
    const bundleEntryPath = path.join(rootDir, 'src', 'index.bundle.js');
    fs.writeFileSync(
        bundleEntryPath,
        writeBundleEntry({
            workers,
            workerCommon,
            box2dWorkerSource,
            audioWorkletSource,
            debugUICSS,
        }),
    );
    console.log('   Created: src/index.bundle.js');

    console.log('\n🎁 Step 4: Building final bundle...');
    runWebpack('webpack.bundle.config.js', env);

    fs.unlinkSync(bundleEntryPath);

    const umdName = prod ? 'weed.prod.bundle.min.js' : 'weed.bundle.min.js';
    const esmName = prod ? 'weed.prod.bundle.esm.min.js' : 'weed.bundle.esm.min.js';
    return { umdName, esmName, sizes };
}

function cleanupDistTemps() {
    console.log('\n🧹 Cleaning up temporary build files...');

    if (fs.existsSync(workersDir)) {
        fs.rmSync(workersDir, { recursive: true });
        console.log('   Removed: dist/workers/');
    }

    const weedMinPath = path.join(distDir, 'weed.min.js');
    if (fs.existsSync(weedMinPath)) {
        fs.unlinkSync(weedMinPath);
        console.log('   Removed: dist/weed.min.js');
    }

    if (!fs.existsSync(distDir)) return;
    for (const file of fs.readdirSync(distDir)) {
        if (KEEP_DIST_FILES.has(file)) continue;
        if (file.endsWith('.css') || file.endsWith('.js')) {
            fs.unlinkSync(path.join(distDir, file));
            console.log('   Removed: dist/' + file);
        }
    }
}

function copySmokeTest() {
    console.log('\n🧪 Generating bundle smoke test...');
    const testSrcDir = path.join(rootDir, 'scripts', 'bundle-test');
    if (!fs.existsSync(testSrcDir)) return;
    for (const file of fs.readdirSync(testSrcDir)) {
        fs.copyFileSync(path.join(testSrcDir, file), path.join(distDir, file));
    }
    console.log('   Copied: index.html');
}

// --- main ---
console.log('🌿 Building WeedJS single-file bundles (debug + prod)...\n');

console.log('📦 Preparing shared Box2D embed (gzip → base64)...');
const box2dWorkerSource = buildBox2dWorkerSource();
const audioWorkletSource = fs.readFileSync(
    path.join(rootDir, 'src', 'workers', 'AudioMixerProcessor.js'),
    'utf8',
);

const debugResult = buildOnce({
    prod: false,
    box2dWorkerSource,
    audioWorkletSource,
});
const prodResult = buildOnce({
    prod: true,
    box2dWorkerSource,
    audioWorkletSource,
});

cleanupDistTemps();
copySmokeTest();

console.log('\n✅ Single-file bundles created!');
console.log('\n📊 Bundle sizes:');
for (const name of [
    debugResult.umdName,
    debugResult.esmName,
    prodResult.umdName,
    prodResult.esmName,
]) {
    const stats = fs.statSync(path.join(distDir, name));
    const pad = ' '.repeat(Math.max(1, 32 - name.length));
    console.log(`   ${name}:${pad}${kb(stats.size)}`);
}
console.log('   (workers share worker_common; Box2D WASM gzip-embedded)');
console.log('   index.html:             Bundle smoke test (open in browser)');
