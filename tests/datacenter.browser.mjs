// Test navigateur du Data Center, avec le VRAI serveur local (server.mjs lancé comme par l'utilisateur).
//
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/datacenter.browser.mjs
//
// Scénarios : (1) en ligne avec serveur : les 4 onglets, FR et EN, 1440×900 et 390×844, comparaison réelle
// à JPL Horizons, test réel de toutes les adresses du catalogue, téléchargement et empreinte ;
// (2) réseau coupé côté serveur : états « hors ligne », relecture depuis le cache du navigateur ;
// (3) sans serveur local (simple serveur statique) ; (4) IndexedDB indisponible (repli mémoire).
// Sans Internet, les étapes qui en dépendent sont ignorées et le reste est vérifié.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveStatic, OUT } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'tests/pages/datacenter.html');
const SITE = 'malapert_massif', WHEN = '2026-11-15T00:00Z';
const TAB_IDS = ['embedded', 'sources', 'verify', 'cache'];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/manifest.json'), 'utf8'));

// Même préchargement « réseau coupé » que tests/server.test.mjs (résolution de noms et connexions sortantes en échec)
const OFFLINE_PRELOAD = `
import dns from 'node:dns'; import net from 'node:net';
const local = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '::1';
const lookup = dns.lookup;
dns.lookup = (host, options, cb) => {
  if (typeof options === 'function') { cb = options; options = {}; }
  if (local(host)) return lookup(host, options, cb);
  process.nextTick(cb, Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: host }));
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === 'object' && args[0] !== null ? args[0] : { port: args[0], host: args[1] };
  if (o.path || local(o.host) || net.isIP(o.host || '') === 0) return connect.apply(this, args);
  process.nextTick(() => this.destroy(Object.assign(new Error('connect ENETUNREACH ' + o.host), { code: 'ENETUNREACH', syscall: 'connect' })));
  return this;
};`;
function startServer({ cacheDir, offline = false, port = 0 }) {
  return new Promise((resolve, reject) => {
    const args = [...(offline ? ['--import', 'data:text/javascript,' + encodeURIComponent(OFFLINE_PRELOAD)] : []), path.join(ROOT, 'server.mjs'), '--port', String(port), '--no-open', '--cache-dir', cacheDir];
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { log: '' };
    const timer = setTimeout(() => { child.kill(); reject(new Error('le serveur ne démarre pas :\n' + s.log)); }, 10000);
    const onData = (d) => {
      s.log += d;
      const m = /Adresse : (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(s.log);
      if (m && !s.url) {
        clearTimeout(timer); s.url = m[1]; s.port = Number(m[2]);
        s.stop = () => new Promise((done) => { if (child.exitCode !== null) return done(); child.once('exit', done); child.kill('SIGINT'); });
        resolve(s);
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
  });
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
/** Ouvre la page de test ; `expected` = motifs d'erreurs attendues dans ce scénario (ex. 502 quand le réseau est coupé). */
async function open(context, url, label, expected = []) {
  const page = await context.newPage();
  const note = (msg) => { if (!expected.some((re) => re.test(msg))) problems.push(`[${label}] ${msg}`); };
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[i18n]'))) note('console: ' + m.text()); });
  page.on('pageerror', (e) => note('pageerror: ' + e.message));
  page.on('requestfailed', (r) => note('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) note(`http ${r.status()}: ${r.url()}`); });
  // Avec le vrai server.mjs (qui ne sert que public/), la page de test répond à /datacenter-test.html
  await page.route('**/datacenter-test.html*', (route) => route.fulfill({ path: PAGE, contentType: 'text/html; charset=utf-8' }));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="1"]');
  await page.waitForSelector('.dc-status:not([data-env="checking"])');
  return page;
}
const tab = async (page, id) => { await page.click(`.dc-tab[data-tab="${id}"]`); await page.waitForSelector(`.dc-pane[data-tab="${id}"]`); };
const shot = async (page, name) => { await page.evaluate(() => document.querySelector('.modal-body')?.scrollTo(0, 0)); await page.waitForTimeout(150); await page.screenshot({ path: path.join(OUT, name) }); };
const env = (page) => page.getAttribute('.dc-status', 'data-env');
async function noOverflow(page, label) {
  const o = await page.evaluate(() => { const b = document.querySelector('.modal-body'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
  assert.ok(o.sw <= o.cw + 1, `${label} : débordement horizontal (${o.sw} > ${o.cw})`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-dc-test-'));
const results = [];
const step = async (name, fn) => {
  try { const r = await fn(); results.push(`  ${r === 'skip' ? '- ' : 'ok'} ${name}${r === 'skip' ? ' : IGNORÉ (hors ligne)' : typeof r === 'string' ? ` — ${r}` : ''}`); }
  catch (e) { results.push(`  ÉCHEC ${name}\n      ${String(e.stack || e).split('\n').slice(0, 5).join('\n      ')}`); process.exitCode = 1; }
  console.log(results.at(-1));
};

// =====================================================================================================
// 1. Vrai serveur local, en ligne
// =====================================================================================================
let srv = await startServer({ cacheDir: path.join(tmp, 'cache-1') });
const online = (await (await fetch(`${srv.url}api/status`)).json()).online;
console.log(`Serveur local : ${srv.url} — Internet : ${online ? 'oui' : 'non'}`);
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Chromium sans écran signale « ERR_ABORTED » à la fin de certaines réponses « no-store » lues par flux, alors
// qu'elles sont arrivées entières (vérifié : le relief est bien chargé, le produit est bien enregistré). Ces deux
// cas sont donc attendus ; un vrai échec se verrait de toute façon dans les assertions (état, empreinte).
const STREAM_QUIRK = [/api\/fetch\?id=\S+ net::ERR_ABORTED/, /sp_dem_240m\.i16 net::ERR_ABORTED/];
let page = await open(desktop, `${srv.url}datacenter-test.html?lang=fr&site=${SITE}&t=${WHEN}`, 'serveur, 1440 fr', STREAM_QUIRK);

await step('bandeau : en ligne avec serveur local', async () => {
  assert.equal(await env(page), online ? 'online' : 'offline');
  assert.match(await page.textContent('.dc-status'), online ? /En ligne, serveur local actif/ : /Hors ligne/);
});
await step('(a) données embarquées : manifeste, chargement à la demande, provenance', async () => {
  await page.waitForSelector('.dc-table-emb tbody tr.dc-row');
  assert.equal(await page.locator('.dc-table-emb tbody tr.dc-row').count(), manifest.files.length);
  const row = page.locator('tr.dc-row[data-file="lpgrs_5deg.json"]');
  assert.match(await row.textContent(), /Disponible hors ligne/); assert.match(await row.textContent(), /non chargé/);
  await row.getByRole('button', { name: 'Charger' }).click();
  await page.waitForFunction(() => document.querySelector('tr.dc-row[data-file="lpgrs_5deg.json"]').textContent.includes('chargé en mémoire'));
  await page.locator('tr.dc-row[data-file="sp_dem_240m.i16"] .dc-link').click();
  const detail = await page.textContent('tr.dc-detail');
  for (const word of ['Transformations', 'Limites', 'Citation', 'Licence', 'ldem_75s_240m.img']) assert.ok(detail.includes(word), word);
  assert.ok((await page.textContent('tr.dc-row[data-file="sp_dem_240m.i16"]')).includes(manifest.files[0].sha256.slice(0, 12)), 'sha256 abrégé');
  await shot(page, 'dc-1440-fr-embedded.png');
  return `${manifest.files.length} fichiers`;
});
const probeReport = [];
await step('(b) sources : catalogue, recherche, filtres, test réel de chaque adresse', async () => {
  await tab(page, 'sources');
  assert.equal(await page.locator('.dc-src').count(), 20);
  await page.fill('.dc-search', 'horizons'); await page.waitForFunction(() => document.querySelectorAll('.dc-src').length < 20);
  assert.ok(await page.locator('.dc-src[data-source="horizons"]').count() === 1 && (await page.locator('.dc-src').count()) <= 3);
  assert.match(await page.textContent('.dc-src[data-source="horizons"]'), /CORS/, 'la fiche s\'ouvre pendant une recherche');
  await page.fill('.dc-search', 'zzzz'); await page.waitForSelector('.dc-srclist .empty');
  await page.fill('.dc-search', ''); await page.waitForFunction(() => document.querySelectorAll('.dc-src').length === 20);
  await page.click('.dc-filters [data-filter="embedded"]'); assert.equal(await page.locator('.dc-src').count(), 8);
  await page.click('.dc-filters [data-filter="reference"]'); assert.equal(await page.locator('.dc-src').count(), 10);
  await page.click('.dc-filters [data-filter="all"]');
  if (!online) { assert.ok(await page.locator('.dc-src [data-source] button:disabled, .dc-src-side button:disabled').count() > 0); return 'skip'; }
  await page.getByRole('button', { name: 'Tout tester' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dc-src .dc-badge-reachable, .dc-src .dc-badge-unreachable').length === 20, null, { timeout: 120000 });
  for (const card of await page.locator('.dc-src').all()) probeReport.push(`${(await card.getAttribute('data-source')).padEnd(18)} ${(await card.locator('.dc-probe .dc-badge').textContent()).replace(/\s+/g, ' ')}`);
  assert.match(await page.textContent('.dc-src[data-source="horizons"] .dc-probe'), /Joignable · HTTP 200/);
  assert.match(await page.textContent('.dc-src[data-source="horizons"] .dc-probe'), /testé à \d{2}:\d{2}:\d{2} UTC/, 'heure du test donnée en UTC');
  await page.click('.dc-src[data-source="lola"] .dc-src-toggle');
  await shot(page, 'dc-1440-fr-sources.png');
  return `${probeReport.filter((l) => l.includes('Joignable')).length}/20 joignables`;
});
let verifyText = '';
await step('(c) vérification en direct : comparaison réelle à JPL Horizons', async () => {
  await tab(page, 'verify');
  assert.match(await page.textContent('.dc-ver-setup'), /Malapert Massif/);
  if (!online) return 'skip';
  await page.click('[data-action="verify"]');
  await page.waitForSelector('.dc-ver-result', { timeout: 90000 });
  const r = page.locator('.dc-ver-result');
  assert.equal(await r.getAttribute('data-cached'), 'false', 'première réponse : en direct');
  const dAz = Number(await r.getAttribute('data-max-daz')), dEl = Number(await r.getAttribute('data-max-del'));
  assert.ok(dAz < 0.01 && dEl < 0.01, `écart ${dAz} / ${dEl}`);
  assert.equal(await page.locator('.dc-table-ver tbody tr').count(), 10);
  verifyText = (await page.textContent('.dc-verdict')).replace(/\s+/g, ' ').trim();
  assert.match(verifyText, /concorde avec JPL Horizons/);
  assert.match(await page.textContent('.dc-ver-meta'), /Réponse obtenue en direct/);
  await page.click('.dc-more:last-of-type summary');
  await shot(page, 'dc-1440-fr-verify.png');
  await page.click('[data-action="verify"]');
  await page.waitForSelector('.dc-ver-result[data-cached="server"]');
  assert.match(await page.textContent('.dc-ver-meta'), /cache disque du serveur local/);
  await page.evaluate(() => window.RF.set({ timeMs: Date.parse('2026-12-01T00:00Z') }));
  await page.waitForFunction(() => !document.querySelector('[data-stale]').hidden);
  await page.evaluate((t) => window.RF.set({ timeMs: Date.parse(t) }), WHEN);
  await page.waitForFunction(() => document.querySelector('[data-stale]').hidden);
  return `écart max ${dAz.toFixed(4)}° az, ${dEl.toFixed(4)}° él`;
});
await step('(d) cache : téléchargement à la demande, empreinte, lecture, suppression, deux caches distincts', async () => {
  await tab(page, 'cache');
  await page.waitForSelector('tr[data-product]');
  assert.equal(await page.locator('tr[data-product]').count(), 7);
  if (!online) return 'skip';
  const row = page.locator('tr[data-product="lola_ldem_75s_240m_lbl"]');
  assert.match(await row.textContent(), /Nécessite Internet/);
  await row.getByRole('button', { name: 'Télécharger' }).click();
  await page.waitForSelector('tr[data-product="lola_ldem_75s_240m_lbl"] [data-integrity="match"]', { timeout: 60000 });
  assert.match(await row.textContent(), /Déjà téléchargé/);
  await row.getByRole('button', { name: 'Lire' }).click();
  await page.waitForSelector('.dc-pre-file'); assert.match(await page.textContent('.dc-pre-file'), /PDS_VERSION_ID/);
  await page.waitForFunction(() => document.querySelectorAll('[data-sec="horizons"] tbody tr').length === 2);
  await page.waitForFunction(() => document.querySelectorAll('[data-sec="browser"] tbody tr').length === 2);
  assert.equal(await page.getAttribute('[data-sec="browser"] [data-backend]', 'data-backend'), 'indexeddb');
  await shot(page, 'dc-1440-fr-cache.png');
  await page.locator('[data-sec="horizons"] tbody tr').first().getByRole('button', { name: 'Supprimer' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-sec="horizons"] tbody tr').length === 1);
  await page.waitForSelector('.toast-ok');
  await row.getByRole('button', { name: 'Supprimer' }).click();
  await page.waitForFunction(() => document.querySelector('tr[data-product="lola_ldem_75s_240m_lbl"]').textContent.includes('Nécessite Internet'));
  // On le remet en cache pour les captures suivantes
  await row.getByRole('button', { name: 'Télécharger' }).click();
  await page.waitForSelector('tr[data-product="lola_ldem_75s_240m_lbl"] [data-integrity="match"]', { timeout: 60000 });
});
await step('anglais : les 4 onglets (1440×900)', async () => {
  await page.evaluate(() => window.RF.set({ lang: 'en' }));
  await page.waitForFunction(() => document.querySelector('.modal-title').textContent === 'Data Center — data and sources');
  for (const id of TAB_IDS) {
    await tab(page, id);
    if (id === 'cache') await page.waitForSelector(online ? '[data-sec="browser"] tbody tr' : 'tr[data-product]');
    await shot(page, `dc-1440-en-${id}.png`);
    const text = await page.textContent('.dc');
    for (const fr of ['Disponible hors ligne', 'Nécessite Internet', 'Organisme', 'Télécharger', 'Écart', 'Fichier']) assert.ok(!text.includes(fr), `texte français restant dans l'onglet ${id} : ${fr}`);
  }
  assert.match(await page.textContent('.dc-status'), online ? /Online, local server running/ : /Offline/);
  await page.evaluate(() => window.RF.set({ lang: 'fr' }));
});
await step('Apollo 11 (Terre haute dans le ciel) : azimut brut et écart sur le ciel, pas de fausse alerte', async () => {
  if (!online) return 'skip';
  await tab(page, 'verify');
  await page.evaluate(() => window.RF.select(window.RF.siteSelection(window.RF.getSite('apollo11'))));
  await page.click('[data-action="verify"]');
  await page.waitForFunction(() => document.querySelector('.dc-ver-meta')?.textContent.includes('Apollo 11'), null, { timeout: 90000 });
  const r = page.locator('.dc-ver-result');
  const dAz = Number(await r.getAttribute('data-max-daz')), dSky = Number(await r.getAttribute('data-max-dsky')), dEl = Number(await r.getAttribute('data-max-del'));
  assert.ok(dSky < dAz && dSky < 0.01 && dEl < 0.01, `brut ${dAz}, ciel ${dSky}, élévation ${dEl}`);
  assert.equal(await page.locator('.dc-verdict-ok').count(), 1, 'verdict favorable');
  const head = await page.textContent('.dc-table-ver thead');
  assert.ok(head.includes('Écart d’azimut brut') && head.includes('Écart d’azimut sur le ciel'), 'les deux colonnes');
  assert.match(await page.textContent('.dc-verdict'), /Près du zénith/);
  const earthEl = await page.locator('.dc-table-ver tr[data-body="earth"] td').nth(5).textContent();
  await shot(page, 'dc-1440-fr-verify-apollo11.png');
  await page.evaluate((id) => window.RF.select(window.RF.siteSelection(window.RF.getSite(id))), SITE);
  return `Terre ${earthEl.trim()} : azimut brut ${dAz.toFixed(4)}°, sur le ciel ${dSky.toFixed(4)}°, élévation ${dEl.toFixed(4)}°`;
});
await page.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
for (const lang of ['fr', 'en']) {
  await step(`mobile 390×844 (${lang}) : les 4 onglets, sans débordement`, async () => {
    const p = await open(mobile, `${srv.url}datacenter-test.html?lang=${lang}&site=${SITE}&t=${WHEN}`, `serveur, 390 ${lang}`, STREAM_QUIRK);
    for (const id of TAB_IDS) {
      await tab(p, id);
      if (id === 'embedded') await p.waitForSelector('.dc-table-emb tbody tr.dc-row');
      if (id === 'sources') await p.click('.dc-src[data-source="horizons"] .dc-src-toggle');
      if (id === 'verify' && online) { await p.click('[data-action="verify"]'); await p.waitForSelector('.dc-ver-result', { timeout: 90000 }); }
      if (id === 'cache') await p.waitForSelector('tr[data-product]');
      await noOverflow(p, `${lang} ${id}`);
      await shot(p, `dc-390-${lang}-${id}.png`);
    }
    await p.close();
  });
}

// =====================================================================================================
// 2. Réseau coupé : même adresse (donc même cache du navigateur), serveur relancé sans accès sortant
// =====================================================================================================
const port = srv.port;
await srv.stop();
srv = await startServer({ cacheDir: path.join(tmp, 'cache-2'), offline: true, port });
page = await open(desktop, `${srv.url}datacenter-test.html?lang=fr&site=${SITE}&t=${WHEN}&tab=sources`, 'réseau coupé', [/502/, /api\/horizons/, ...STREAM_QUIRK]);
await step('réseau coupé : bandeau « Hors ligne », tests et téléchargements désactivés avec explication', async () => {
  assert.equal(await env(page), 'offline');
  assert.match(await page.textContent('.dc-status'), /Les archives de la NASA ne sont pas disponibles hors ligne/);
  assert.match(await page.textContent('[data-blocked="offline"]'), /pas d’accès à Internet/);
  assert.equal(await page.locator('.dc-src-side button:not(:disabled)').count(), 0);
  assert.ok(await page.getByRole('button', { name: 'Tout tester' }).isDisabled());
  assert.equal(await page.locator('.dc-src .dc-badge-offline').count(), 8, 'les sources embarquées restent « disponibles hors ligne »');
  await shot(page, 'dc-1440-fr-offline-sources.png');
  await tab(page, 'cache'); await page.waitForSelector('tr[data-product]');
  assert.equal(await page.locator('tr[data-product] button:not(:disabled)').count(), 0);
  assert.match(await page.textContent('.dc-pane'), /Téléchargements désactivés : pas d’accès à Internet/);
  await shot(page, 'dc-1440-fr-offline-cache.png');
  await tab(page, 'embedded'); await page.waitForSelector('.dc-table-emb tbody tr.dc-row');
  assert.equal(await page.locator('.dc-table-emb .dc-badge-offline').count(), manifest.files.length);
});
await step('réseau coupé : comparaison déjà faite relue dans le cache du navigateur, nouvelle demande refusée clairement', async () => {
  await tab(page, 'verify');
  assert.match(await page.textContent('[data-blocked="offline"]'), /déjà gardée en cache/);
  if (online) {
    await page.click('[data-action="verify"]');
    await page.waitForSelector('.dc-ver-result[data-cached="browser"]', { timeout: 60000 });
    assert.match(await page.textContent('.dc-ver-meta'), /cache de ce navigateur/);
    await shot(page, 'dc-1440-fr-offline-verify-browsercache.png');
  }
  await page.evaluate(() => window.RF.set({ timeMs: Date.parse('2027-03-01T00:00Z') }));
  await page.click('[data-action="verify"]');
  await page.waitForSelector('.dc-error');
  assert.match(await page.textContent('.dc-error'), /La source est injoignable \(ENOTFOUND\)/);
  await shot(page, 'dc-1440-fr-offline-verify-error.png');
  return online ? 'relecture navigateur + refus clair' : 'refus clair (relecture ignorée : rien n\'avait pu être mis en cache)';
});
await page.close();
await srv.stop();

// =====================================================================================================
// 3. Sans serveur local : simple serveur statique (comme « python -m http.server »)
// =====================================================================================================
const stat = await serveStatic(ROOT);
page = await open(desktop, `${stat.url}tests/pages/datacenter.html?lang=fr&site=${SITE}&t=${WHEN}`, 'sans serveur', [/404/, /api\/status/, ...STREAM_QUIRK]);
await step('sans serveur local : explication, fonctions en ligne coupées, données embarquées intactes', async () => {
  assert.equal(await env(page), 'noServer');
  const banner = await page.textContent('.dc-status');
  assert.match(banner, /sans serveur local/); assert.match(banner, /LANCER\.bat/); assert.match(banner, /CORS/);
  await page.waitForSelector('.dc-table-emb tbody tr.dc-row');
  assert.equal(await page.locator('.dc-table-emb tbody tr.dc-row').count(), manifest.files.length);
  await shot(page, 'dc-1440-fr-noserver-embedded.png');
  await tab(page, 'sources');
  assert.match(await page.textContent('[data-blocked="noServer"]'), /serveur local, qui n’est pas lancé/);
  assert.equal(await page.locator('.dc-src-side button:not(:disabled)').count(), 0);
  await tab(page, 'verify');
  await page.click('[data-action="verify"]'); await page.waitForSelector('.dc-error');
  assert.match(await page.textContent('.dc-error'), /Serveur local absent/);
  await shot(page, 'dc-1440-fr-noserver-verify.png');
  await tab(page, 'cache'); await page.waitForSelector('tr[data-product]');
  assert.match(await page.textContent('[data-sec="horizons"]'), /n’existe qu’avec le serveur local/);
  assert.equal(await page.locator('tr[data-product] button:not(:disabled)').count(), 0);
  await shot(page, 'dc-1440-fr-noserver-cache.png');
});
await page.close();
stat.close();

// =====================================================================================================
// 4. IndexedDB indisponible : repli en mémoire
// =====================================================================================================
srv = await startServer({ cacheDir: path.join(tmp, 'cache-4') });
const noIdb = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await noIdb.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); });
page = await open(noIdb, `${srv.url}datacenter-test.html?lang=fr&site=${SITE}&t=${WHEN}&tab=verify`, 'sans IndexedDB', STREAM_QUIRK);
await step('IndexedDB indisponible : tout fonctionne, cache du navigateur en mémoire', async () => {
  if (online) { await page.click('[data-action="verify"]'); await page.waitForSelector('.dc-ver-result', { timeout: 90000 }); }
  await tab(page, 'cache');
  await page.waitForSelector('[data-sec="browser"] [data-backend="memory"]');
  assert.match(await page.textContent('[data-sec="browser"]'), /mémoire seulement/);
  if (online) assert.equal(await page.locator('[data-sec="browser"] tbody tr').count(), 2);
  await shot(page, 'dc-1440-fr-noidb-cache.png');
});
await page.close();

// =====================================================================================================
// 5. Dans l'application complète (public/index.html), si elle démarre : les autres modules sont écrits en parallèle
// =====================================================================================================
await step('dans l\'application complète : la fenêtre s\'ouvre avec les styles de index.html', async () => {
  const p = await desktop.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(srv.url, { waitUntil: 'load' });
  const ready = await p.waitForSelector('body[data-ready="1"]', { timeout: 90000 }).then(() => true, () => false);
  if (!ready) { await p.close(); return `application complète pas encore démarrable (${errors[0] || 'délai dépassé'}) : étape non concluante`; }
  await p.evaluate(() => import(new URL('js/ui/datacenter.js', location.href).href).then((m) => m.openDataCenter('sources')));
  await p.waitForSelector('.modal[data-modal="datacenter"] .dc-status:not([data-env="checking"])');
  assert.equal(await p.locator('.dc-src').count(), 20);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.dc-tabs')).display), 'flex', 'datacenter.css chargé par index.html');
  await p.screenshot({ path: path.join(OUT, 'dc-1440-fr-in-app.png') });
  await p.close();
  return 'ouverte par import depuis index.html';
});
await srv.stop();
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

if (probeReport.length) console.log('\nTest réel des adresses du catalogue (depuis cette machine) :\n  ' + probeReport.join('\n  '));
if (verifyText) console.log('\nConclusion affichée (site Malapert Massif, 15/11/2026 00:00 UTC) :\n  ' + verifyText);
console.log(`\nErreurs console / réseau inattendues : ${problems.length}`);
for (const p of problems) console.log('  ' + p);
if (problems.length) process.exitCode = 1;
console.log(process.exitCode ? '\nÉCHEC' : '\nOK — captures dans tests/.out/dc-*.png');
