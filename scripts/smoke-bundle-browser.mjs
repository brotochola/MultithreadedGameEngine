import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';
import { BUNDLE_ARTIFACTS } from './build-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const filePath = path.join(dist, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(dist) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

const missing = BUNDLE_ARTIFACTS.filter((name) => !fs.existsSync(path.join(dist, name)));
if (missing.length) {
  console.error(
    `Missing dist artifacts: ${missing.join(', ')}. Run pnpm make_bundle (or test:bundle:build).`,
  );
  process.exit(1);
}

const { server, port } = await startServer();
const browser = await chromium.launch({ headless: true });
let failed = false;

try {
  for (const bundle of BUNDLE_ARTIFACTS) {
    const errors = [];
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const url = `http://127.0.0.1:${port}/index.html?bundle=${encodeURIComponent(bundle)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const result = await page.waitForFunction(() => {
      const info = document.getElementById('info');
      const text = info ? info.textContent || '' : '';
      if (/error|fail/i.test(text) && !/Loading/i.test(text)) return { ok: false, text };
      if (/ready|running|balls|spawn|fps/i.test(text)) return { ok: true, text };
      return null;
    }, { timeout: 90000 }).then((h) => h.jsonValue()).catch(async () => {
      const text = await page.locator('#info').textContent().catch(() => '');
      return { ok: false, text: text || 'timeout' };
    });

    await page.close();

    const fatal = errors.filter((e) =>
      /importScripts|worker_common|Failed to fetch|DecompressionStream|WebAssembly|invalid URL/i.test(e),
    );

    console.log(`${bundle}:`, result);
    if (fatal.length) {
      console.log('  fatal errors:');
      for (const e of fatal.slice(0, 8)) console.log('   ', e);
    }

    if (!result?.ok || fatal.length) {
      failed = true;
      if (errors.length && !fatal.length) {
        console.log('  page errors:');
        for (const e of errors.slice(0, 8)) console.log('   ', e);
      }
    } else {
      console.log('  OK');
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  console.error('bundle browser smoke failed');
  process.exitCode = 1;
} else {
  console.log('smoke-bundle-browser OK (all 8)');
}
