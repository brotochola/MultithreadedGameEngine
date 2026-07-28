import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { chromium } from 'playwright';

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

const errors = [];
const { server, port } = await startServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

const result = await page.waitForFunction(() => {
  const info = document.getElementById('info');
  const text = info ? info.textContent || '' : '';
  if (/error|fail/i.test(text) && !/Loading/i.test(text)) return { ok: false, text };
  if (/ready|running|balls|spawn|fps/i.test(text)) return { ok: true, text };
  if (window.WEED && window.WEED.BUNDLE_MODE) {
    // Wait a bit more for scene init via info text updates
  }
  return null;
}, { timeout: 90000 }).then((h) => h.jsonValue()).catch(async () => {
  const text = await page.locator('#info').textContent().catch(() => '');
  return { ok: false, text: text || 'timeout' };
});

await browser.close();
server.close();

console.log('bundle browser smoke:', result);
if (errors.length) {
  console.log('page errors:');
  for (const e of errors.slice(0, 20)) console.log(' ', e);
}

if (!result?.ok) {
  process.exitCode = 1;
} else if (errors.some((e) => /importScripts|worker_common|Failed to fetch|DecompressionStream|WebAssembly/i.test(e))) {
  console.error('fatal worker/wasm errors detected');
  process.exitCode = 1;
} else {
  console.log('OK');
}
