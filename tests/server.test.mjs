// Tests du serveur local (server.mjs) : fichiers statiques, routes /api, catalogue, cache, réseau coupé.
//
//   node tests/server.test.mjs            tout (les appels réels à Internet sont ignorés proprement hors ligne)
//   node tests/server.test.mjs --quick    sans le téléchargement de 29 Mo qui vérifie la reprise
//   node tests/server.test.mjs --offline  simule une machine sans Internet : les appels réels doivent être ignorés
//   RF_TEST_NODE=/chemin/vers/node18 node tests/server.test.mjs   lance le serveur avec un autre Node (compatibilité)
//
// Le serveur est lancé comme le ferait l'utilisateur (processus séparé, port libre), avec un dossier de
// cache temporaire. « Réseau coupé » : un second serveur est lancé avec un préchargement qui fait échouer
// toute résolution de nom et toute connexion sortante hors boucle locale, sans toucher au code du serveur.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sunEarthAt } from '../public/js/science/ephemeris.js';
import { SOURCES, PRODUCTS, ACCESS_MODES, CATALOG_VERIFIED } from '../public/js/data/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick'), OFFLINE = process.argv.includes('--offline');
const NODE = process.env.RF_TEST_NODE || process.execPath;      // binaire Node qui fait tourner le serveur testé
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Préchargement « réseau coupé » : passé à node par --import sous forme d'URL data:
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

/** Lance server.mjs sur un port libre ; renvoie {url, port, stop, log}. */
function startServer({ cacheDir, offline = false, port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [...(offline ? ['--import', 'data:text/javascript,' + encodeURIComponent(OFFLINE_PRELOAD)] : []), path.join(ROOT, 'server.mjs'), '--port', String(port), '--no-open', '--cache-dir', cacheDir];
    const child = spawn(NODE, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { log: '', child };
    const timer = setTimeout(() => { child.kill(); reject(new Error('le serveur ne démarre pas :\n' + s.log)); }, 10000);
    const onData = (d) => {
      s.log += d;
      const m = /Adresse : (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(s.log);
      if (m && !s.url) {
        clearTimeout(timer);
        s.url = m[1]; s.port = Number(m[2]);
        s.stop = () => new Promise((done) => { if (child.exitCode !== null) return done(child.exitCode); child.once('exit', done); child.kill('SIGINT'); });
        resolve(s);
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('exit', (code) => { if (!s.url) { clearTimeout(timer); reject(new Error(`le serveur s'est arrêté (code ${code}) :\n${s.log}`)); } });
  });
}

/** Requête HTTP brute (le chemin n'est pas normalisé, contrairement à fetch) -> {status, headers, body:Buffer}. */
function raw(port, reqPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}
const getJson = async (url, init) => { const r = await fetch(url, init); return { status: r.status, json: await r.json().catch(() => null) }; };
/** Lit un flux NDJSON de /api/fetch ; `abortAfter` coupe la connexion après ce nombre d'octets reçus. */
async function ndjson(url, { abortAfter = 0 } = {}) {
  const ac = new AbortController(), events = [];
  try {
    const r = await fetch(url, { signal: ac.signal });
    let buf = '';
    for await (const chunk of r.body.pipeThrough(new TextDecoderStream())) {
      buf += chunk;
      for (let nl; (nl = buf.indexOf('\n')) >= 0; buf = buf.slice(nl + 1)) {
        const ev = JSON.parse(buf.slice(0, nl)); events.push(ev);
        if (abortAfter && ev.type === 'progress' && ev.received >= abortAfter) ac.abort();
      }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  return events;
}

// ---- petit lanceur de tests ----
let passed = 0, failed = 0, skipped = 0, online = false;
async function test(name, fn) {
  try { const r = await fn(); if (r === 'skip') { skipped++; console.log(`  -  ${name} : IGNORÉ (${QUICK && online ? 'option --quick' : 'hors ligne'})`); } else { passed++; console.log(`  ok ${name}${typeof r === 'string' ? ` — ${r}` : ''}`); } }
  catch (e) { failed++; console.log(`  ÉCHEC ${name}\n      ${String(e.stack || e).split('\n').slice(0, 4).join('\n      ')}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-server-test-'));
const cacheDir = path.join(tmp, 'cache');
const srv = await startServer({ cacheDir, offline: OFFLINE });
const B = srv.url.replace(/\/$/, '');
console.log(`Serveur de test : ${srv.url} (cache ${cacheDir})`);

console.log('\nFichiers statiques');
await test('index.html : 200, type HTML, ETag, Last-Modified', async () => {
  const r = await raw(srv.port, '/');
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /^text\/html; charset=utf-8/);
  assert.ok(r.headers.etag && r.headers['last-modified']);
  assert.deepEqual(r.body, fs.readFileSync(path.join(ROOT, 'public/index.html')));
});
await test('types MIME (.js, .css, .json, .png, .ttf)', async () => {
  for (const [p, type] of [['/js/main.js', 'text/javascript'], ['/css/base.css', 'text/css'], ['/data/manifest.json', 'application/json'], ['/assets/favicon.png', 'image/png'], ['/assets/fonts/Barlow-Regular.ttf', 'font/ttf']]) {
    const r = await raw(srv.port, p, { method: 'HEAD' });
    assert.equal(r.status, 200, p); assert.ok(r.headers['content-type'].startsWith(type), `${p} -> ${r.headers['content-type']}`); assert.equal(r.body.length, 0);
  }
});
await test('gzip à la volée pour le texte, pas pour les binaires', async () => {
  const file = fs.readFileSync(path.join(ROOT, 'public/css/base.css'));
  const r = await raw(srv.port, '/css/base.css', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.headers['content-encoding'], 'gzip'); assert.match(r.headers.vary, /Accept-Encoding/i);
  assert.deepEqual(zlib.gunzipSync(r.body), file); assert.ok(r.body.length < file.length);
  const plain = await raw(srv.port, '/css/base.css');
  assert.equal(plain.headers['content-encoding'], undefined); assert.equal(Number(plain.headers['content-length']), file.length);
  assert.notEqual(plain.headers.etag, r.headers.etag);
  const bin = await raw(srv.port, '/assets/favicon.png', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(bin.headers['content-encoding'], undefined);
  return `${file.length} -> ${r.body.length} octets`;
});
await test('revalidation : 304 avec If-None-Match et If-Modified-Since', async () => {
  const r = await raw(srv.port, '/js/main.js');
  assert.equal((await raw(srv.port, '/js/main.js', { headers: { 'if-none-match': r.headers.etag } })).status, 304);
  assert.equal((await raw(srv.port, '/js/main.js', { headers: { 'if-modified-since': r.headers['last-modified'] } })).status, 304);
  assert.equal((await raw(srv.port, '/js/main.js', { headers: { 'if-none-match': '"autre"' } })).status, 200);
});
await test('Range : 206 (début, milieu, suffixe), 416 hors fichier, If-Range', async () => {
  const rel = fs.existsSync(path.join(ROOT, 'public/data/sp_dem_240m.i16')) ? 'data/sp_dem_240m.i16' : 'vendor/three.module.js';
  const file = fs.readFileSync(path.join(ROOT, 'public', rel)), n = file.length;
  const a = await raw(srv.port, `/${rel}`, { headers: { range: 'bytes=0-99' } });
  assert.equal(a.status, 206); assert.equal(a.headers['content-range'], `bytes 0-99/${n}`); assert.deepEqual(a.body, file.subarray(0, 100));
  const b = await raw(srv.port, `/${rel}`, { headers: { range: 'bytes=1000000-1000255' } });
  assert.equal(b.status, 206); assert.deepEqual(b.body, file.subarray(1000000, 1000256));
  const c = await raw(srv.port, `/${rel}`, { headers: { range: 'bytes=-16' } });
  assert.equal(c.status, 206); assert.deepEqual(c.body, file.subarray(n - 16));
  const d = await raw(srv.port, `/${rel}`, { headers: { range: `bytes=${n}-` } });
  assert.equal(d.status, 416); assert.equal(d.headers['content-range'], `bytes */${n}`);
  const e = await raw(srv.port, `/${rel}`, { headers: { range: 'bytes=0-9', 'if-range': '"périmé"' }, method: 'HEAD' });
  assert.equal(e.status, 200, 'If-Range périmé : fichier entier');
  assert.equal(a.headers['accept-ranges'], 'bytes');
  return `${rel}, ${n} octets`;
});
await test('traversée de chemins et fichiers cachés refusés', async () => {
  const secret = fs.readFileSync(path.join(ROOT, 'server.mjs'));
  for (const p of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs', '/js/../../server.mjs', '/js/..%5c..%5cserver.mjs', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/.gitignore', '/js/%00.js', '//etc/passwd']) {
    const r = await raw(srv.port, p);
    assert.ok([403, 404, 400].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.equals(secret) && !r.body.includes('root:x:'), `${p} a fui`);
  }
  assert.equal((await raw(srv.port, '/absent.js')).status, 404);
  assert.equal((await raw(srv.port, '/', { method: 'POST' })).status, 405);
});
await test('accès réservé à la machine : Host étranger et appels /api d\'un autre site refusés', async () => {
  assert.equal((await raw(srv.port, '/', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await raw(srv.port, '/api/status', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw(srv.port, '/api/cache?id=all', { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await raw(srv.port, '/api/status', { headers: { origin: `http://127.0.0.1:${srv.port}` } })).status, 200);
});

console.log('\nRoutes /api (sans réseau)');
let status;
await test('/api/status', async () => {
  const r = await getJson(`${B}/api/status`); status = r.json;
  assert.equal(r.status, 200); assert.equal(status.app, 'regolith-finder'); assert.match(status.version, /^\d+\.\d+\.\d+$/);
  assert.match(status.node, /^v\d+\.\d+\.\d+/); if (NODE === process.execPath) assert.equal(status.node, process.version);
  assert.equal(typeof status.online, 'boolean');
  assert.deepEqual(status.cache, { files: 0, bytes: 0 });
  assert.deepEqual(status.catalog, { sources: SOURCES.length, products: PRODUCTS.length, verified: CATALOG_VERIFIED });
  return `Node ${status.node}, online=${status.online}`;
});
await test('/api/horizons : paramètres validés et bornés (400 + nom du paramètre)', async () => {
  const ok = { body: 'sun', lat: '-85.99', lon: '-2.9', alt_km: '4', start: '2026-11-15T00:00Z', stop: '2026-11-15T04:00Z', step: '1h' };
  const cases = [
    [{ body: 'mars' }, 'body'], [{ body: undefined }, 'body'], [{ lat: '91' }, 'lat'], [{ lat: 'abc' }, 'lat'], [{ lat: undefined }, 'lat'], [{ lon: '400' }, 'lon'],
    [{ alt_km: '50' }, 'alt_km'], [{ start: 'hier' }, 'start'], [{ start: '2026-11-15T00:00+02:00' }, 'start'], [{ stop: '1492-01-01' }, 'stop'],
    [{ stop: '2026-11-14T00:00Z' }, 'stop'], [{ step: '0h' }, 'step'], [{ step: '1 fortnight' }, 'step'], [{ step: undefined }, 'step'],
    [{ step: '1m', stop: '2026-11-17T00:00Z' }, 'step'],            // 2 881 lignes : au-delà des 2 000 permises
  ];
  for (const [patch, param] of cases) {
    const q = new URLSearchParams(Object.entries({ ...ok, ...patch }).filter(([, v]) => v !== undefined));
    const r = await getJson(`${B}/api/horizons?${q}`);
    assert.equal(r.status, 400, JSON.stringify(patch)); assert.equal(r.json.error.code, 'bad_request'); assert.equal(r.json.error.param, param, JSON.stringify(patch));
  }
  assert.equal(fs.existsSync(path.join(cacheDir, 'horizons')), false, 'aucun appel sortant ni écriture pour une demande refusée');
});
await test('liste blanche : identifiants inconnus ou forgés refusés', async () => {
  for (const id of ['', 'inconnu', '../../etc/passwd', 'https://example.com/', 'lola/../horizons']) {
    assert.equal((await getJson(`${B}/api/probe?id=${encodeURIComponent(id)}`)).status, 404, `probe ${id}`);
    assert.equal((await getJson(`${B}/api/fetch?id=${encodeURIComponent(id)}`)).status, 404, `fetch ${id}`);
    assert.equal((await getJson(`${B}/api/cache/file?id=${encodeURIComponent(id)}`)).status, 404, `file ${id}`);
    assert.equal((await getJson(`${B}/api/cache?id=${encodeURIComponent(id)}`, { method: 'DELETE' })).status, 404, `delete ${id}`);
  }
  assert.equal((await getJson(`${B}/api/probe?url=https://example.com/`)).status, 404, 'aucune URL libre');
  assert.equal((await getJson(`${B}/api/inconnu`)).status, 404);
});
await test('/api/cache vide ; suppression sans effet hors du cache', async () => {
  const r = await getJson(`${B}/api/cache`);
  assert.equal(r.status, 200); assert.deepEqual(r.json.files, []); assert.equal(r.json.bytes, 0); assert.equal(r.json.dir, cacheDir);
  const d = await getJson(`${B}/api/cache?id=all`, { method: 'DELETE' });
  assert.deepEqual(d.json, { deleted: 0, bytes: 0 });
});

console.log('\nCatalogue partagé (serveur et navigateur lisent public/js/data/catalog.js)');
await test('cohérence du catalogue', async () => {
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(/^[a-z0-9_]+$/.test(s.id) && !ids.has(s.id), `id ${s.id}`); ids.add(s.id);
    assert.ok(ACCESS_MODES.includes(s.access), `${s.id} : accès`); assert.ok(['archive', 'rest', 'wmts', 'web', 'library'].includes(s.protocol), `${s.id} : protocole`);
    assert.ok(s.name && s.organism && s.formats.length && s.urls.length, `${s.id} : champs`);
    assert.ok(s.urls.some((u) => u.url === s.probe), `${s.id} : l'adresse testée doit figurer dans ses adresses`);
    for (const u of s.urls) { assert.equal(new URL(u.url).protocol, 'https:', `${s.id} ${u.url}`); assert.equal(typeof u.status, 'number'); assert.ok(u.role); }
    assert.equal(s.access === 'embedded', s.files.length > 0, `${s.id} : « embarqué » si et seulement si des fichiers sont livrés`);
  }
  const files = new Set();
  for (const p of PRODUCTS) {
    assert.ok(ids.has(p.source), `${p.id} : source`); assert.ok(!files.has(p.file.toLowerCase()), `${p.id} : nom de fichier en double`); files.add(p.file.toLowerCase());
    assert.equal(new URL(p.url).protocol, 'https:'); assert.ok(SOURCES.find((s) => s.id === p.source).urls.some((u) => u.url === p.url), `${p.id} : adresse absente de sa source`);
  }
  for (const need of ['lola', 'pgda_illum', 'diviner', 'lp_grs', 'svs_moonkit', 'iau_gazetteer', 'artemis_regions', 'horizons', 'astronomy_engine', 'moon_trek', 'quickmap', 'ode_rest', 'lend', 'minirf', 'm3', 'lamp', 'shadowcam', 'spice_naif']) assert.ok(ids.has(need), `source manquante : ${need}`);
  return `${SOURCES.length} sources, ${PRODUCTS.length} produits`;
});
await test('fichiers embarqués du manifeste rattachés à une source du catalogue', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/manifest.json'), 'utf8'));
  const known = new Set(SOURCES.flatMap((s) => s.files));
  const data = manifest.files.map((f) => f.file).filter((f) => !f.startsWith('../'));
  for (const f of data) assert.ok(known.has(f), `${f} sans source dans le catalogue`);
  for (const f of known) assert.ok(data.includes(f), `${f} annoncé « embarqué » mais absent du manifeste`);
  return `${data.length} fichiers`;
});
await test('traductions du catalogue complètes en français et en anglais', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const { DC_STRINGS } = await import('../public/js/i18n/datacenter.js');
  const fr = Object.keys(DC_STRINGS.fr), en = Object.keys(DC_STRINGS.en);
  assert.deepEqual(fr.filter((k) => !(k in DC_STRINGS.en)), [], 'clés sans anglais'); assert.deepEqual(en.filter((k) => !(k in DC_STRINGS.fr)), [], 'clés sans français');
  for (const s of SOURCES) for (const k of ['products', 'crs', 'units', 'limits']) assert.ok(DC_STRINGS.fr[`dc.src.${s.id}.${k}`] && DC_STRINGS.en[`dc.src.${s.id}.${k}`], `dc.src.${s.id}.${k}`);
  for (const s of SOURCES) { assert.ok(DC_STRINGS.fr[`dc.src.access.${s.access}`] && DC_STRINGS.fr[`dc.src.protocol.${s.protocol}`]); for (const u of s.urls) { assert.ok(DC_STRINGS.fr[`dc.src.role.${u.role}`], u.role); if (u.note) assert.ok(DC_STRINGS.fr[`dc.src.observed.${u.note}`], u.note); } }
  for (const p of PRODUCTS) assert.ok(DC_STRINGS.fr[`dc.prod.${p.id}`] && DC_STRINGS.en[`dc.prod.${p.id}`], `dc.prod.${p.id}`);
  return `${fr.length} clés`;
});

console.log('\nConnecteur Horizons (calcul, sans réseau)');
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const { skyDifference, VERIFY_TOLERANCE_DEG } = await import('../public/js/data/connectors/horizons.js');
await test('écart d\'azimut ramené sur le ciel : pas de fausse alerte près du zénith', async () => {
  const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ≠ ${y}`);
  const low = skyDifference({ az: 120.004, el: 2.001 }, { az: 120, el: 2 });
  near(low.dAz, 0.004); near(low.dEl, 0.001); assert.ok(Math.abs(low.dSky - 0.004) < 1e-5, 'à l\'horizon, azimut brut et écart sur le ciel se confondent');
  const mid = skyDifference({ az: 10.02, el: 60 }, { az: 10, el: 60 });
  near(mid.dSky, 0.01);                                            // à 60° d'élévation, 0,02° d'azimut = 0,01° d'arc
  const zen = skyDifference({ az: 215, el: 89.9 }, { az: 210, el: 89.9 });
  near(zen.dAz, 5); assert.ok(Math.abs(zen.dSky) < 0.01 && Math.abs(zen.dSky) < VERIFY_TOLERANCE_DEG, '5° d\'azimut brut à 0,1° du zénith : direction quasi identique');
  const wrap = skyDifference({ az: 0.01, el: 0 }, { az: 359.99, el: 0 });
  near(wrap.dAz, 0.02);
  assert.ok(Math.abs(skyDifference({ az: 100.5, el: 5 }, { az: 100, el: 5 }).dSky) > VERIFY_TOLERANCE_DEG, 'un vrai écart reste signalé');
});

console.log('\nAppels réels (Internet)');
online = !!status?.online;
const site = { lat: -85.99, lon: -2.9, altKm: 4.0 };
const hzUrl = (body) => `${B}/api/horizons?body=${body}&lat=${site.lat}&lon=${site.lon}&alt_km=${site.altKm}&start=2026-11-15T00:00Z&stop=2026-11-16T00:00Z&step=6h`;
await test('JPL Horizons comparé au calcul local (écart < 0,01°), puis cache disque au second appel', async () => {
  if (!online) return 'skip';
  let worstAz = 0, worstEl = 0;
  for (const body of ['sun', 'earth']) {
    const a = await getJson(hzUrl(body));
    assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(a.json.cached, false); assert.equal(a.json.rows.length, 5);
    assert.ok(a.json.signature.some((l) => /DE441/.test(l)), 'signature : source DE441'); assert.ok(a.json.signature.some((l) => /MEAN_ME/.test(l)), 'signature : repère');
    assert.deepEqual(a.json.request, { body, lat: -85.99, lonEast: 357.1, alt_km: 4, start: '2026-11-15T00:00Z', stop: '2026-11-16T00:00Z', step: '6h' });
    for (const row of a.json.rows) {
      const loc = sunEarthAt(new Date(row.t), site.lat, site.lon, site.altKm * 1000)[body];
      const dAz = Math.abs(((loc.az - row.az + 540) % 360) - 180), dEl = Math.abs(loc.el - row.el);
      worstAz = Math.max(worstAz, dAz); worstEl = Math.max(worstEl, dEl);
      assert.ok(row.rangeAU > 0);
    }
    const t0 = Date.now(), b = await getJson(hzUrl(body));
    assert.equal(b.json.cached, true, 'second appel servi par le cache'); assert.deepEqual(b.json.rows, a.json.rows); assert.equal(b.json.queried_at, a.json.queried_at);
    assert.ok(Date.now() - t0 < 200, 'réponse du cache immédiate');
  }
  assert.ok(worstAz < 0.01 && worstEl < 0.01, `écart trop grand : az ${worstAz}, él ${worstEl}`);
  return `écart max azimut ${worstAz.toFixed(4)}°, élévation ${worstEl.toFixed(4)}° sur 10 points`;
});
/** Écarts maximaux local / Horizons pour un site à l'altitude 0, sur les instants renvoyés par une demande. */
async function worstDifferences(lat, lon, spans, step) {
  const w = { az: 0, sky: 0, el: 0, n: 0, elMax: -90 };
  for (const body of ['sun', 'earth']) for (const [start, stop] of spans) {
    const r = await getJson(`${B}/api/horizons?body=${body}&lat=${lat}&lon=${lon}&alt_km=0&start=${start}&stop=${stop}&step=${step}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    for (const row of r.json.rows) {
      const d = skyDifference(sunEarthAt(new Date(row.t), lat, lon, 0)[body], row);
      w.az = Math.max(w.az, Math.abs(d.dAz)); w.sky = Math.max(w.sky, Math.abs(d.dSky)); w.el = Math.max(w.el, Math.abs(d.dEl)); w.elMax = Math.max(w.elMax, row.el); w.n++;
    }
  }
  return w;
}
const SPANS = [['2026-01-10T03:00Z', '2031-01-10T03:00Z'], ['2026-04-02T17:00Z', '2030-12-02T17:00Z']];
let apollo;
await test('Apollo 11, astres hauts dans le ciel : azimut brut gonflé, écart sur le ciel sous le seuil', async () => {
  if (!online) return 'skip';
  apollo = await worstDifferences(0.6741, 23.4731, SPANS, '97d');
  assert.ok(apollo.elMax > 60, `astre le plus haut : ${apollo.elMax}°`);
  assert.ok(apollo.az > 2 * apollo.sky, 'près du zénith, l\'azimut brut dépasse nettement l\'écart sur le ciel');
  assert.ok(apollo.sky < 0.005 && apollo.el < 0.005, `sur le ciel ${apollo.sky}, élévation ${apollo.el}`);
  return `${apollo.n} points, astre jusqu'à ${apollo.elMax.toFixed(0)}° : azimut brut ${apollo.az.toFixed(4)}°, sur le ciel ${apollo.sky.toFixed(4)}°, élévation ${apollo.el.toFixed(4)}°`;
});
await test('précision annoncée dans le catalogue : < 0,005° sur le ciel et en élévation (4 sites, 2026-2031)', async () => {
  if (!online) return 'skip';
  const all = { ...apollo };
  for (const [lat, lon] of [[-89.45, -137.3], [-45.457, 177.589], [-85.99, -2.9]]) {      // crête de Shackleton, Chang'e 4, Malapert
    const w = await worstDifferences(lat, lon, SPANS, '97d');
    for (const k of ['az', 'sky', 'el']) all[k] = Math.max(all[k], w[k]);
    all.n += w.n;
  }
  assert.ok(all.sky < 0.005 && all.el < 0.005, `sur le ciel ${all.sky}, élévation ${all.el}`);
  assert.ok(all.az < 0.04, `azimut brut ${all.az}`);
  return `${all.n} points : azimut brut ${all.az.toFixed(4)}°, sur le ciel ${all.sky.toFixed(4)}°, élévation ${all.el.toFixed(4)}°`;
});
await test('/api/probe : adresse officielle testée côté serveur', async () => {
  if (!online) return 'skip';
  const hz = (await getJson(`${B}/api/probe?id=horizons`)).json;
  assert.equal(hz.ok, true); assert.equal(hz.status, 200); assert.equal(hz.method, 'GET', 'HEAD refusé par JPL (405) : repli sur GET'); assert.ok(hz.ms >= 0 && hz.checked_at);
  const lola = (await getJson(`${B}/api/probe?id=lola`)).json;
  assert.equal(lola.ok, true); assert.equal(lola.method, 'HEAD');
  return `horizons ${hz.status} en ${hz.ms} ms ; lola ${lola.status} en ${lola.ms} ms`;
});
await test('/api/fetch : téléchargement, SHA-256, liste, relecture, suppression', async () => {
  if (!online) return 'skip';
  const ev = await ndjson(`${B}/api/fetch?id=lola_ldem_75s_240m_lbl`);
  const done = ev.at(-1);
  assert.equal(ev[0].type, 'start'); assert.equal(done.type, 'done', JSON.stringify(done)); assert.equal(done.cached, false);
  const file = fs.readFileSync(path.join(cacheDir, 'products', 'ldem_75s_240m.lbl'));
  assert.equal(done.bytes, file.length); assert.equal(done.sha256, sha256(file)); assert.match(file.toString('latin1'), /PDS_VERSION_ID/);
  const again = await ndjson(`${B}/api/fetch?id=lola_ldem_75s_240m_lbl`);
  assert.equal(again.length, 1); assert.equal(again[0].cached, true); assert.equal(again[0].sha256, done.sha256);
  const list = (await getJson(`${B}/api/cache`)).json;
  const entry = list.files.find((f) => f.id === 'lola_ldem_75s_240m_lbl');
  assert.deepEqual({ kind: entry.kind, bytes: entry.bytes, sha256: entry.sha256, source: entry.source }, { kind: 'product', bytes: file.length, sha256: done.sha256, source: 'lola' });
  assert.ok(list.files.filter((f) => f.kind === 'horizons').length >= 2, 'réponses Horizons listées');
  for (const f of list.files) assert.ok(/^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0 && f.date && f.source, JSON.stringify(f));
  const reread = await raw(srv.port, '/api/cache/file?id=lola_ldem_75s_240m_lbl');
  assert.equal(reread.status, 200); assert.deepEqual(reread.body, file);
  // Même empreinte que le fichier source utilisé pour préparer les données embarquées (manifest.json)
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/manifest.json'), 'utf8'));
  const ref = manifest.files.flatMap((f) => f.source_files || []).find((s) => s.path.endsWith('/ldem_75s_240m.lbl'));
  assert.equal(done.sha256, ref.sha256, 'empreinte identique à celle du manifeste');
  const del = (await getJson(`${B}/api/cache?id=lola_ldem_75s_240m_lbl`, { method: 'DELETE' })).json;
  assert.equal(del.deleted, 2, 'fichier + métadonnées'); assert.equal(fs.existsSync(path.join(cacheDir, 'products', 'ldem_75s_240m.lbl')), false);
  return `${file.length} octets, sha256 ${done.sha256.slice(0, 12)}… = manifeste`;
});
await test('/api/fetch : annulation, reprise (Range) et intégrité du fichier de 29 Mo', async () => {
  if (!online || QUICK) return 'skip';
  const first = await ndjson(`${B}/api/fetch?id=lola_ldem_75s_240m_img`, { abortAfter: 4e6 });
  assert.equal(first[0].type, 'start'); assert.equal(first[0].resumable, true); assert.equal(first[0].total, 29062688);
  await new Promise((r) => setTimeout(r, 400));           // le serveur constate la coupure et garde la partie reçue
  const part = (await getJson(`${B}/api/cache`)).json.files.find((f) => f.kind === 'partial');
  assert.ok(part && part.bytes >= 4e6 && part.bytes < 29062688, `partie gardée : ${part?.bytes}`);
  const second = await ndjson(`${B}/api/fetch?id=lola_ldem_75s_240m_img`);
  const done = second.at(-1);
  assert.equal(second[0].resumed_from, part.bytes, 'reprise là où le premier essai s\'est arrêté'); assert.equal(done.type, 'done', JSON.stringify(done));
  assert.equal(done.bytes, 29062688); assert.equal(done.resumed_from, part.bytes);
  const local = path.join(ROOT, 'public/data/sp_dem_240m.i16');
  if (fs.existsSync(local)) assert.equal(done.sha256, sha256(fs.readFileSync(local)), 'identique, octet pour octet, au relief embarqué');
  return `coupé à ${part.bytes} octets, repris, sha256 ${done.sha256.slice(0, 12)}… = relief embarqué`;
});

console.log('\nRéseau coupé (second serveur, même cache, sorties réseau bloquées)');
const off = await startServer({ cacheDir, offline: true });
const O = off.url.replace(/\/$/, '');
await test('/api/status signale « hors ligne » ; les fichiers embarqués restent servis', async () => {
  const s = (await getJson(`${O}/api/status`)).json;
  assert.equal(s.online, false); assert.equal(s.app, 'regolith-finder');
  assert.equal((await raw(off.port, '/data/manifest.json')).status, 200);
});
await test('Horizons hors ligne : 502 clair pour une nouvelle demande, cache disque pour une demande déjà faite', async () => {
  const fresh = await getJson(`${O}/api/horizons?body=sun&lat=-89.5&lon=10&start=2027-01-01T00:00Z&stop=2027-01-02T00:00Z&step=12h`);
  assert.equal(fresh.status, 502); assert.equal(fresh.json.error.code, 'upstream_unreachable'); assert.match(fresh.json.error.message, /injoignable/); assert.ok(fresh.json.error.detail);
  if (!online) return 'nouvelle demande : 502 (rien en cache à relire, test en ligne ignoré)';
  const known = await getJson(hzUrl('sun').replace(B, O));
  assert.equal(known.status, 200); assert.equal(known.json.cached, true); assert.equal(known.json.rows.length, 5);
  return `502 ${fresh.json.error.detail} ; demande déjà faite relue dans le cache`;
});
await test('/api/probe et /api/fetch hors ligne : source injoignable, pas de plantage', async () => {
  const p = (await getJson(`${O}/api/probe?id=lola`)).json;
  assert.equal(p.ok, false); assert.equal(p.status, 0); assert.ok(p.error);
  const ev = await ndjson(`${O}/api/fetch?id=pgda_psr_lbl`);
  assert.equal(ev.at(-1).type, 'error'); assert.equal(ev.at(-1).code, 'upstream_unreachable');
  assert.equal((await getJson(`${O}/api/status`)).json.app, 'regolith-finder', 'le serveur tourne toujours');
  return `probe : ${p.error} ; fetch : ${ev.at(-1).detail}`;
});
await test('arrêt propre sur Ctrl+C (SIGINT)', async () => {
  assert.equal(await off.stop(), 0); assert.equal(await srv.stop(), 0);
  assert.match(srv.log, /Arrêt du serveur/);
});
await test('port occupé : le serveur prend le suivant', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const busy = blocker.address().port;
  const s = await startServer({ cacheDir, port: busy });
  try { assert.ok(s.port > busy && s.port <= busy + 20, `port ${s.port}`); assert.match(s.log, new RegExp(`Port ${busy} occupé`)); } finally { await s.stop(); blocker.close(); }
  return `${busy} occupé -> ${s.port}`;
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} réussis, ${failed} en échec, ${skipped} ignorés`);
process.exit(failed ? 1 : 0);
