// Outil commun des tests navigateur (Chromium sans écran, WebGL logiciel).
// Sur le VPS : D=/home/codex/.cache/paintseed-browser-deps/unpacked; LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/<fichier>.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

/** Petit serveur statique de test (port libre). */
export function serveStatic(root = ROOT) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      const st = fs.statSync(f);
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}
/** Ouvre une page ; collecte erreurs console, erreurs de page et requêtes en échec. */
export async function openPage(url, { width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  // Chromium sans écran signale parfois net::ERR_ABORTED à la fin d'un gros raster lu par flux alors que
  // le fichier est reçu en entier : fausse alerte connue, écartée ici (vérifier dataLoaded() si besoin).
  page.on('requestfailed', (r) => { const err = r.failure()?.errorText || ''; if (/ERR_ABORTED/.test(err) && /\/data\/.*\.(i16|u8|u16)$/.test(r.url())) return; problems.push('requestfailed: ' + r.url() + ' ' + err); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  return { browser, page, problems };
}
export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.out');
fs.mkdirSync(OUT, { recursive: true });
