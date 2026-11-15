#!/usr/bin/env node
// Regolith Finder — serveur local (Node ≥ 18, aucune dépendance npm).
//
//   node server.mjs [--port 8080] [--no-open] [--cache-dir <dossier>]
//
// Rôle : servir public/ et ajouter ce qu'un navigateur seul ne peut pas faire :
//   - interroger en direct des services NASA qui n'envoient pas d'en-têtes CORS (JPL Horizons),
//   - tester l'adresse officielle des sources du catalogue,
//   - télécharger à la demande quelques produits d'archive et les garder sur disque (.cache/).
// Aucune clé, aucun compte, aucune adresse fournie par le client : la liste blanche est le
// catalogue public/js/data/catalog.js, partagé avec le navigateur.
//
// Routes internes (toutes en lecture seule vis-à-vis de l'extérieur, écoute sur 127.0.0.1 uniquement) :
//   GET    /api/status                  état du serveur, test rapide d'Internet, taille du cache
//   GET    /api/horizons?body=&lat=&lon=&alt_km=&start=&stop=&step=   éphéméride JPL Horizons (cache 30 j)
//   GET    /api/probe?id=<source>       teste l'adresse officielle d'une source du catalogue
//   GET    /api/fetch?id=<produit>      télécharge un produit de la liste blanche (flux NDJSON de progression)
//   GET    /api/cache                   contenu du cache disque
//   GET    /api/cache/file?id=<produit> relit un produit déjà téléchargé
//   DELETE /api/cache?id=<produit|horizons|horizons:<clé>|all>

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = 'regolith-finder';
const VERSION = '1.0.0';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const USER_AGENT = `RegolithFinder/${VERSION} (application locale ; Node ${process.version})`;

const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const HORIZONS_TTL_MS = 30 * 86400e3;
const HORIZONS_MAX_ROWS = 2000;
const UPSTREAM_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 12000;
const PROBE_MEMO_MS = 30000;
const DOWNLOAD_IDLE_MS = 30000;
const DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Options de ligne de commande
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 3000, open: true, cacheDir: path.join(ROOT, '.cache'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') o.open = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) o.port = Number(a.slice(7));
    else if (a === '--cache-dir') o.cacheDir = path.resolve(argv[++i] || '');
    else if (a.startsWith('--cache-dir=')) o.cacheDir = path.resolve(a.slice(12));
    else { console.error(`Option inconnue : ${a}`); o.help = true; }
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) { console.error('Port invalide.'); o.help = true; }
  return o;
}
const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log('Usage : node server.mjs [--port 8080] [--no-open] [--cache-dir <dossier>]\n  PORT=8080 est aussi accepté. --port 0 choisit un port libre.');
  process.exit(0);
}
const CACHE = opts.cacheDir;
const DIR_HORIZONS = path.join(CACHE, 'horizons');
const DIR_PRODUCTS = path.join(CACHE, 'products');

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(stamp(), ...a);

// ---------------------------------------------------------------------------------------------
// Catalogue partagé avec le navigateur (liste blanche des sources et des produits)
// ---------------------------------------------------------------------------------------------
// public/js/data/catalog.js est un module ES sans import. On le charge par une URL « data: » :
// cela fonctionne dès Node 18, où un fichier .js sans package.json serait pris pour du CommonJS.
async function loadCatalog() {
  try {
    const src = await fsp.readFile(path.join(PUBLIC, 'js', 'data', 'catalog.js'), 'utf8');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
    const sources = new Map(), products = new Map();
    for (const s of mod.SOURCES) {
      const ok = typeof s.id === 'string' && typeof s.probe === 'string' && s.probe.startsWith('https://') && s.urls.some((u) => u.url === s.probe);
      if (ok) sources.set(s.id, s); else log(`[catalogue] source ignorée (adresse de test invalide) : ${s.id}`);
    }
    for (const p of mod.PRODUCTS) {
      const ok = typeof p.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(p.file) && typeof p.url === 'string' && p.url.startsWith('https://') && sources.has(p.source);
      if (ok) products.set(p.id, p); else log(`[catalogue] produit ignoré (définition invalide) : ${p.id}`);
    }
    return { sources, products, verified: mod.CATALOG_VERIFIED };
  } catch (e) {
    log(`[catalogue] illisible (${e.message}) : /api/probe et /api/fetch sont désactivés.`);
    return null;
  }
}
const catalog = await loadCatalog();

// ---------------------------------------------------------------------------------------------
// Outils HTTP
// ---------------------------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (param, message) => new HttpError(400, 'bad_request', message, { param });

function sendJson(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
}

/** Code court d'une erreur réseau de fetch (ENOTFOUND, ECONNREFUSED, timeout…). */
function netErrorCode(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
  const c = e?.cause;
  return c?.code || c?.errors?.[0]?.code || e?.code || c?.name || 'network_error';
}

/** fetch sortant, borné dans le temps. Seules des adresses du code ou du catalogue arrivent ici. */
function outbound(url, { timeoutMs = UPSTREAM_TIMEOUT_MS, signal, headers, method = 'GET' } = {}) {
  return fetch(url, { method, redirect: 'follow', headers: { 'user-agent': USER_AGENT, ...headers }, signal: linkSignals(AbortSignal.timeout(timeoutMs), signal) });
}
/** Signal qui s'interrompt dès que l'un des signaux donnés s'interrompt (AbortSignal.any n'existe pas dans Node 18). */
function linkSignals(...signals) {
  const ac = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ac.abort(s.reason); break; }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

// Requêtes locales uniquement : l'en-tête Host doit désigner la boucle locale (protection contre le
// « DNS rebinding ») et, pour /api, une page d'un autre site ne doit pas pouvoir piloter le serveur.
function isLocalRequest(req) {
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.host || '');
}
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return false;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none';
}

// ---------------------------------------------------------------------------------------------
// Fichiers statiques
// ---------------------------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.i16': 'application/octet-stream', '.u8': 'application/octet-stream', '.u16': 'application/octet-stream', '.bin': 'application/octet-stream',
};
const isCompressible = (type) => /^(text\/|application\/(json|geo\+json|xml|javascript)|image\/svg)/.test(type);

/** Chemin réel d'une URL dans public/, ou null si elle en sort (traversée, octet nul, fichier caché). */
function resolvePublic(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes('\0') || p.includes('\\') || p.includes(':')) return null;
  if (p.split('/').some((seg) => seg.startsWith('.'))) return null;   // « .. », « .git », fichiers cachés
  const file = path.join(PUBLIC, p);
  return file === PUBLIC || file.startsWith(PUBLIC + path.sep) ? file : null;
}

/** Interprète un en-tête Range simple. null = l'ignorer ; 'unsat' = 416 ; sinon {start, end}. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = Number(m[2]);
    return n === 0 || size === 0 ? 'unsat' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]), end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start >= size || start > end ? 'unsat' : { start, end };
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendPlain(res, 405, 'Méthode non autorisée', { allow: 'GET, HEAD' });
  let file = resolvePublic(pathname);
  if (!file) return sendPlain(res, 403, 'Chemin refusé');
  let st;
  try {
    st = await fsp.stat(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = await fsp.stat(file); }
  } catch { return sendPlain(res, 404, 'Fichier introuvable'); }
  if (!st.isFile()) return sendPlain(res, 404, 'Fichier introuvable');

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const lastModified = new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString();
  const wantsRange = typeof req.headers.range === 'string';
  const gzip = !wantsRange && isCompressible(type) && st.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${gzip ? '-gz' : ''}"`;
  const head = { 'content-type': type, 'last-modified': lastModified, etag, 'cache-control': 'no-cache', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
  if (isCompressible(type)) head.vary = 'Accept-Encoding';

  // Revalidation : If-None-Match l'emporte sur If-Modified-Since
  const inm = req.headers['if-none-match'];
  const notModified = inm
    ? inm.split(',').some((v) => v.trim() === etag || v.trim() === '*')
    : req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Date.parse(lastModified);
  if (notModified) { res.writeHead(304, head); return res.end(); }

  let range = null;
  if (wantsRange) {
    // If-Range : la plage ne vaut que si le fichier n'a pas changé depuis ce que connaît le client
    const ifRange = req.headers['if-range'];
    const fresh = !ifRange || ifRange === etag || ifRange === lastModified;
    range = fresh ? parseRange(req.headers.range, st.size) : null;
    if (range === 'unsat') { res.writeHead(416, { ...head, 'content-range': `bytes */${st.size}` }); return res.end(); }
  }
  if (range) {
    res.writeHead(206, { ...head, 'content-range': `bytes ${range.start}-${range.end}/${st.size}`, 'content-length': range.end - range.start + 1 });
    if (req.method === 'HEAD') return res.end();
    return pipeFile(fs.createReadStream(file, range), res);
  }
  if (gzip) {
    res.writeHead(200, { ...head, 'content-encoding': 'gzip' });
    if (req.method === 'HEAD') return res.end();
    return pipeFile(fs.createReadStream(file).pipe(zlib.createGzip({ level: 5 })), res);
  }
  res.writeHead(200, { ...head, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  return pipeFile(fs.createReadStream(file), res);
}
function pipeFile(stream, res) {
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy?.());
  stream.pipe(res);
}
function sendPlain(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(text + '\n');
}

// ---------------------------------------------------------------------------------------------
// Cache disque (.cache/) — tous les chemins sont construits ici, jamais à partir d'un texte du client
// ---------------------------------------------------------------------------------------------
async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}
async function readJson(file) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; } }
async function statOrNull(file) { try { return await fsp.stat(file); } catch { return null; } }
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
const productPaths = (p) => {
  const final = path.join(DIR_PRODUCTS, p.file);
  return { final, meta: `${final}.meta.json`, part: `${final}.part`, partMeta: `${final}.part.json` };
};

/** Nombre de fichiers et taille totale du cache (sans calcul d'empreinte). */
async function cacheTotals() {
  let files = 0, bytes = 0;
  for (const dir of [DIR_HORIZONS, DIR_PRODUCTS]) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch { /* dossier pas encore créé */ }
    for (const n of names) { const st = await statOrNull(path.join(dir, n)); if (st?.isFile()) { files++; bytes += st.size; } }
  }
  return { files, bytes };
}

async function listCache() {
  const files = [];
  for (const p of catalog ? catalog.products.values() : []) {
    const f = productPaths(p);
    const st = await statOrNull(f.final), meta = st && await readJson(f.meta);
    if (st && meta) files.push({ id: p.id, kind: 'product', file: `products/${p.file}`, bytes: st.size, date: meta.fetched_at, source: p.source, url: meta.url, sha256: meta.sha256 });
    const part = await statOrNull(f.part);
    if (part) files.push({ id: p.id, kind: 'partial', file: `products/${p.file}.part`, bytes: part.size, date: part.mtime.toISOString(), source: p.source, url: p.url, sha256: null, expected_bytes: p.bytes || null });
  }
  let names = [];
  try { names = (await fsp.readdir(DIR_HORIZONS)).filter((n) => /^[0-9a-f]{24}\.json$/.test(n)).sort(); } catch { /* vide */ }
  for (const n of names) {
    const file = path.join(DIR_HORIZONS, n);
    let raw; try { raw = await fsp.readFile(file); } catch { continue; }
    let entry = null; try { entry = JSON.parse(raw.toString('utf8')); } catch { /* fichier abîmé : listé quand même */ }
    files.push({
      id: `horizons:${n.slice(0, 24)}`, kind: 'horizons', file: `horizons/${n}`, bytes: raw.length,
      date: entry?.saved_at || null, expires: entry?.saved_at ? new Date(Date.parse(entry.saved_at) + HORIZONS_TTL_MS).toISOString() : null,
      source: 'horizons', url: HORIZONS_API, sha256: crypto.createHash('sha256').update(raw).digest('hex'), request: entry?.payload?.request || null,
    });
  }
  return { dir: CACHE, files, count: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0) };
}

async function removeFiles(list) {
  let deleted = 0, bytes = 0;
  for (const f of list) {
    const st = await statOrNull(f);
    if (!st?.isFile()) continue;
    await fsp.rm(f, { force: true }); deleted++; bytes += st.size;
  }
  return { deleted, bytes };
}
async function deleteCache(id) {
  const horizonsFiles = async () => { try { return (await fsp.readdir(DIR_HORIZONS)).map((n) => path.join(DIR_HORIZONS, n)); } catch { return []; } };
  const productFiles = async () => { try { return (await fsp.readdir(DIR_PRODUCTS)).map((n) => path.join(DIR_PRODUCTS, n)); } catch { return []; } };
  if (id === 'all') {
    if (downloads.size) throw new HttpError(409, 'busy', 'Un téléchargement est en cours.');
    return removeFiles([...(await horizonsFiles()), ...(await productFiles())]);
  }
  if (id === 'horizons') return removeFiles(await horizonsFiles());
  const m = /^horizons:([0-9a-f]{24})$/.exec(id || '');
  if (m) return removeFiles([path.join(DIR_HORIZONS, `${m[1]}.json`)]);
  const p = catalog?.products.get(id);
  if (!p) throw new HttpError(404, 'unknown_id', 'Entrée de cache inconnue.');
  if (downloads.has(p.id)) throw new HttpError(409, 'busy', 'Ce produit est en cours de téléchargement.');
  return removeFiles(Object.values(productPaths(p)));
}

// ---------------------------------------------------------------------------------------------
// /api/status
// ---------------------------------------------------------------------------------------------
// Test rapide d'Internet : ouverture d'une connexion TCP vers deux hôtes officiels (résultat gardé 10 s).
const ONLINE_HOSTS = ['ssd.jpl.nasa.gov', 'pds-geosciences.wustl.edu'];
const onlineMemo = { at: 0, value: false, pending: null };
function tcpReachable(host) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port: 443, timeout: 2500 });
    const fail = (e) => { s.destroy(); reject(e || new Error('timeout')); };
    s.once('connect', () => { s.destroy(); resolve(); }).once('timeout', () => fail()).once('error', fail);
  });
}
function checkOnline() {
  if (Date.now() - onlineMemo.at < 10000) return Promise.resolve(onlineMemo.value);
  onlineMemo.pending ??= Promise.any(ONLINE_HOSTS.map(tcpReachable)).then(() => true, () => false).then((v) => {
    Object.assign(onlineMemo, { at: Date.now(), value: v, pending: null });
    return v;
  });
  return onlineMemo.pending;
}
const STARTED = new Date().toISOString();
async function apiStatus() {
  const [online, cache] = await Promise.all([checkOnline(), cacheTotals()]);
  return { app: APP, version: VERSION, node: process.version, online, cache, started_at: STARTED, catalog: catalog ? { sources: catalog.sources.size, products: catalog.products.size, verified: catalog.verified } : null };
}

// ---------------------------------------------------------------------------------------------
// /api/horizons
// ---------------------------------------------------------------------------------------------
const BODIES = { sun: '10', earth: '399' };
const STEP_MS = { m: 60e3, h: 3600e3, d: 86400e3 };
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?Z?$/;

function numParam(q, name, min, max, def) {
  const raw = q.get(name);
  if (raw === null || raw === '') { if (def !== undefined) return def; throw bad(name, `Paramètre « ${name} » manquant.`); }
  const v = Number(raw);
  if (!/^-?\d+(\.\d+)?$/.test(raw.trim()) || !Number.isFinite(v)) throw bad(name, `Paramètre « ${name} » : nombre attendu.`);
  if (v < min || v > max) throw bad(name, `Paramètre « ${name} » hors limites (${min} à ${max}).`);
  return v;
}
function timeParam(q, name) {
  const raw = q.get(name);
  if (!raw) throw bad(name, `Paramètre « ${name} » manquant (date ISO 8601 en UTC, ex. 2026-11-15T00:00Z).`);
  if (!ISO_RE.test(raw)) throw bad(name, `Paramètre « ${name} » : date ISO 8601 en UTC attendue (ex. 2026-11-15T00:00Z).`);
  const ms = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw.endsWith('Z') ? raw : `${raw}Z`);
  if (!Number.isFinite(ms)) throw bad(name, `Paramètre « ${name} » : date invalide.`);
  const year = new Date(ms).getUTCFullYear();
  if (year < 1900 || year > 2200) throw bad(name, `Paramètre « ${name} » : année hors limites (1900 à 2200).`);
  return Math.floor(ms / 60e3) * 60e3;       // Horizons est interrogé à la minute
}
/** Valide et normalise la requête ; lève HttpError 400 avec le nom du paramètre fautif. */
function horizonsRequest(q) {
  const body = (q.get('body') || '').toLowerCase();
  if (!BODIES[body]) throw bad('body', 'Paramètre « body » : sun ou earth.');
  const lat = numParam(q, 'lat', -90, 90);
  const lon = numParam(q, 'lon', -360, 360);
  const altKm = numParam(q, 'alt_km', -10, 20, 0);
  const startMs = timeParam(q, 'start'), stopMs = timeParam(q, 'stop');
  if (stopMs <= startMs) throw bad('stop', 'Paramètre « stop » : doit être postérieur à « start ».');
  const step = (q.get('step') || '').toLowerCase();
  const m = /^([1-9]\d{0,4})(m|h|d)$/.exec(step);
  if (!m) throw bad('step', 'Paramètre « step » : entier suivi de m, h ou d (ex. 30m, 6h, 1d).');
  const rows = Math.floor((stopMs - startMs) / (Number(m[1]) * STEP_MS[m[2]])) + 1;
  if (rows > HORIZONS_MAX_ROWS) throw bad('step', `Trop de lignes demandées (${rows}) : ${HORIZONS_MAX_ROWS} au plus. Allongez le pas ou raccourcissez la période.`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
  return {
    body, lat: Number(lat.toFixed(6)), lonEast: Number((((lon % 360) + 360) % 360).toFixed(6)), alt_km: Number(altKm.toFixed(4)),
    start: iso(startMs), stop: iso(stopMs), step,
  };
}
function horizonsUrl(r) {
  const t = (isoZ) => isoZ.slice(0, 16).replace('T', ' ');
  const p = {
    format: 'text', COMMAND: `'${BODIES[r.body]}'`, OBJ_DATA: `'NO'`, MAKE_EPHEM: `'YES'`, EPHEM_TYPE: `'OBSERVER'`,
    CENTER: `'coord@301'`, COORD_TYPE: `'GEODETIC'`, SITE_COORD: `'${r.lonEast},${r.lat},${r.alt_km}'`,
    START_TIME: `'${t(r.start)}'`, STOP_TIME: `'${t(r.stop)}'`, STEP_SIZE: `'${r.step}'`,
    QUANTITIES: `'4,20'`, CSV_FORMAT: `'YES'`, ANG_FORMAT: `'DEG'`, APPARENT: `'AIRLESS'`, TIME_DIGITS: `'MINUTES'`,
  };
  return `${HORIZONS_API}?${new URLSearchParams(p)}`;
}
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const SIGNATURE_RE = /^(API VERSION|Target body name|Center body name|Center geodetic|Center pole\/equ|Center radii|Atmos refraction|Step-size)/;

/** Extrait les lignes d'éphéméride (entre $$SOE et $$EOE) et les en-têtes utiles de la réponse texte. */
function parseHorizons(text) {
  const lines = text.split(/\r?\n/);
  const soe = lines.findIndex((l) => l.trim() === '$$SOE'), eoe = lines.findIndex((l) => l.trim() === '$$EOE');
  if (soe < 0 || eoe < soe) {
    // Horizons répond 200 même en cas d'erreur : le motif est dans les dernières lignes non vides
    const tail = lines.map((l) => l.trim()).filter((l) => l && !/^\*+$/.test(l)).slice(-2).join(' ');
    throw new HttpError(502, 'upstream', `JPL Horizons n'a pas renvoyé d'éphéméride : ${tail.slice(0, 300) || 'réponse vide'}`, { detail: tail.slice(0, 200) || 'empty' });
  }
  const header = (lines.slice(0, soe).reverse().find((l) => l.includes('Azi_')) || '').split(',').map((c) => c.trim());
  const iAz = header.findIndex((c) => c.startsWith('Azi_')), iEl = header.findIndex((c) => c.startsWith('Elev_')), iRange = header.indexOf('delta');
  if (iAz < 0 || iEl < 0) throw new HttpError(502, 'upstream', 'Réponse de JPL Horizons inattendue (colonnes azimut / élévation absentes).', { detail: 'columns' });
  const rows = [];
  for (const line of lines.slice(soe + 1, eoe)) {
    const c = line.split(',').map((x) => x.trim());
    const d = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})/.exec(c[0] || '');
    const az = Number(c[iAz]), el = Number(c[iEl]);
    if (!d || !MONTHS[d[2]] || !Number.isFinite(az) || !Number.isFinite(el)) continue;
    const t = new Date(Date.UTC(Number(d[1]), MONTHS[d[2]] - 1, Number(d[3]), Number(d[4]), Number(d[5]))).toISOString();
    rows.push({ t, az, el, rangeAU: iRange >= 0 && Number.isFinite(Number(c[iRange])) ? Number(c[iRange]) : null });
  }
  if (!rows.length) throw new HttpError(502, 'upstream', 'JPL Horizons a renvoyé une éphéméride vide.', { detail: 'no rows' });
  const signature = lines.slice(0, soe).filter((l) => SIGNATURE_RE.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());
  return { rows, signature };
}

const horizonsPending = new Map();    // clé -> Promise (deux demandes identiques simultanées = un seul appel)
async function apiHorizons(q) {
  const request = horizonsRequest(q);
  const key = JSON.stringify(request);
  const file = path.join(DIR_HORIZONS, `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}.json`);
  const hit = await readJson(file);
  if (hit?.key === key && Date.now() - Date.parse(hit.saved_at) < HORIZONS_TTL_MS) return { payload: { ...hit.payload, cached: true }, note: 'cache disque' };
  if (!horizonsPending.has(key)) {
    horizonsPending.set(key, (async () => {
      let res;
      try { res = await outbound(horizonsUrl(request)); } catch (e) {
        const code = netErrorCode(e);
        throw new HttpError(502, code === 'timeout' ? 'upstream_timeout' : 'upstream_unreachable',
          code === 'timeout' ? `JPL Horizons n'a pas répondu en ${UPSTREAM_TIMEOUT_MS / 1000} s.` : `JPL Horizons est injoignable (${code}). Vérifiez la connexion Internet.`, { detail: code });
      }
      if (!res.ok) throw new HttpError(502, 'upstream', `JPL Horizons a répondu HTTP ${res.status}.`, { detail: `HTTP ${res.status}` });
      const parsed = parseHorizons(await res.text());
      const payload = { source: 'JPL Horizons (ssd.jpl.nasa.gov/api/horizons.api)', queried_at: new Date().toISOString(), cached: false, request, ...parsed };
      await writeAtomic(file, JSON.stringify({ key, saved_at: payload.queried_at, payload }));
      return payload;
    })().finally(() => horizonsPending.delete(key)));
  }
  const payload = await horizonsPending.get(key);
  return { payload, note: `JPL, ${payload.rows.length} lignes` };
}

// ---------------------------------------------------------------------------------------------
// /api/probe
// ---------------------------------------------------------------------------------------------
const probeMemo = new Map();    // id -> {at, result} ; évite de marteler une source si l'on clique plusieurs fois
async function probeUrl(url) {
  const t0 = Date.now();
  const done = (method, res) => ({ ok: res.status >= 200 && res.status < 400, status: res.status, ms: Date.now() - t0, method, final_url: res.url !== url ? res.url : undefined });
  try {
    const res = await outbound(url, { method: 'HEAD', timeoutMs: PROBE_TIMEOUT_MS });
    // Certains services refusent HEAD (JPL Horizons : 405) : on retente par un GET partiel
    if (![400, 403, 405, 501].includes(res.status)) return done('HEAD', res);
  } catch { /* échec réseau sur HEAD : le GET partiel ci-dessous donnera le motif */ }
  try {
    const ac = new AbortController();
    const res = await outbound(url, { timeoutMs: PROBE_TIMEOUT_MS, signal: ac.signal, headers: { range: 'bytes=0-1023' } });
    const out = done('GET', res);
    ac.abort();                    // le corps ne nous intéresse pas
    return out;
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, method: 'GET', error: netErrorCode(e) };
  }
}
async function apiProbe(q) {
  if (!catalog) throw new HttpError(503, 'catalog_unavailable', 'Catalogue des sources illisible.');
  const s = catalog.sources.get(q.get('id') || '');
  if (!s) throw new HttpError(404, 'unknown_source', 'Source inconnue du catalogue.');
  const memo = probeMemo.get(s.id);
  if (memo && Date.now() - memo.at < PROBE_MEMO_MS) return memo.result;
  const result = { id: s.id, url: s.probe, ...(await probeUrl(s.probe)), checked_at: new Date().toISOString() };
  probeMemo.set(s.id, { at: Date.now(), result });
  return result;
}

// ---------------------------------------------------------------------------------------------
// /api/fetch — téléchargement à la demande, avec progression (NDJSON), reprise et empreinte SHA-256
// ---------------------------------------------------------------------------------------------
const downloads = new Map();    // id du produit -> AbortController
async function apiFetch(req, res, q) {
  if (!catalog) throw new HttpError(503, 'catalog_unavailable', 'Catalogue des sources illisible.');
  const p = catalog.products.get(q.get('id') || '');
  if (!p) throw new HttpError(404, 'unknown_product', 'Produit absent de la liste blanche.');
  if (downloads.has(p.id)) throw new HttpError(409, 'busy', 'Ce produit est déjà en cours de téléchargement.');
  const f = productPaths(p), refresh = q.get('refresh') === '1';

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const send = (o) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(o) + '\n'); };

  const known = !refresh && await statOrNull(f.final) && await readJson(f.meta);
  if (known) { send({ type: 'done', cached: true, ...known }); res.end(); return 'déjà en cache'; }

  const ac = new AbortController();
  downloads.set(p.id, ac);
  let finished = false, idle = null, note = '';
  res.on('close', () => { if (!finished) ac.abort(new Error('client')); });   // l'utilisateur a annulé : on garde la partie reçue
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error('idle')), DOWNLOAD_IDLE_MS); };
  try {
    await fsp.mkdir(DIR_PRODUCTS, { recursive: true });
    if (refresh) await removeFiles([f.part, f.partMeta]);
    // Reprise : une partie déjà reçue + de quoi vérifier que le fichier distant n'a pas changé
    const pm = await readJson(f.partMeta);
    let offset = pm?.url === p.url && (pm.etag || pm.last_modified) ? (await statOrNull(f.part))?.size || 0 : 0;
    const request = (from) => outbound(p.url, {
      signal: ac.signal, timeoutMs: 24 * 3600e3,
      headers: { 'accept-encoding': 'identity', ...(from ? { range: `bytes=${from}-`, 'if-range': pm.etag || pm.last_modified } : {}) },
    });
    armIdle();
    let up = await request(offset);
    if (offset && up.status === 416) { offset = 0; up = await request(0); }   // partie plus longue que le fichier distant
    if (offset && up.status === 200) offset = 0;                               // le serveur distant ne reprend pas : on repart de zéro
    if (up.status !== 200 && up.status !== 206) throw new HttpError(502, 'upstream', `Le serveur d'origine a répondu HTTP ${up.status}.`, { detail: `HTTP ${up.status}` });
    const length = Number(up.headers.get('content-length')) || 0;
    const total = length ? offset + length : null;
    const etag = up.headers.get('etag'), lastModified = up.headers.get('last-modified');
    const resumable = up.status === 206 || up.headers.get('accept-ranges') === 'bytes';
    await writeAtomic(f.partMeta, JSON.stringify({ url: p.url, etag, last_modified: lastModified, started_at: new Date().toISOString() }));
    send({ type: 'start', id: p.id, total, resumed_from: offset, resumable });

    const out = fs.createWriteStream(f.part, { flags: offset ? 'a' : 'w' });
    let received = offset, lastSent = 0;
    try {
      for await (const chunk of up.body) {
        armIdle();
        if (!out.write(chunk)) await once(out, 'drain');
        received += chunk.length;
        if (received > DOWNLOAD_MAX_BYTES) throw new HttpError(502, 'upstream', 'Fichier distant plus gros que la limite prévue.', { detail: 'too large' });
        if (Date.now() - lastSent > 150) { lastSent = Date.now(); send({ type: 'progress', received, total }); }
      }
    } finally { out.end(); await once(out, 'close'); }
    clearTimeout(idle);
    if (total !== null && received !== total) throw new HttpError(502, 'incomplete', `Téléchargement incomplet (${received} octets sur ${total}).`, { detail: `${received}/${total}` });

    send({ type: 'progress', received, total: total ?? received, hashing: true });
    const sha256 = await sha256File(f.part);
    await fsp.rename(f.part, f.final);
    const meta = { id: p.id, file: `products/${p.file}`, bytes: received, sha256, url: p.url, source: p.source, fetched_at: new Date().toISOString(), etag, last_modified: lastModified, content_type: up.headers.get('content-type') };
    await writeAtomic(f.meta, JSON.stringify(meta));
    await fsp.rm(f.partMeta, { force: true });
    send({ type: 'done', cached: false, resumed_from: offset, ...meta });
    note = `${received} octets${offset ? `, reprise à ${offset}` : ''}`;
  } catch (e) {
    clearTimeout(idle);
    const partial = (await statOrNull(f.part))?.size || 0;
    const reason = ac.signal.aborted ? ac.signal.reason?.message : null;
    const code = e instanceof HttpError ? e.code : reason === 'idle' ? 'upstream_timeout' : reason === 'client' ? 'cancelled' : 'upstream_unreachable';
    const message = e instanceof HttpError ? e.message
      : code === 'upstream_timeout' ? `Le serveur d'origine n'envoie plus rien depuis ${DOWNLOAD_IDLE_MS / 1000} s.`
        : code === 'cancelled' ? 'Téléchargement annulé.' : `Serveur d'origine injoignable (${netErrorCode(e)}). Vérifiez la connexion Internet.`;
    send({ type: 'error', code, message, detail: e instanceof HttpError ? e.extra?.detail : netErrorCode(e), partial_bytes: partial });
    note = `${code}${partial ? `, ${partial} octets gardés pour une reprise` : ''}`;
  } finally {
    finished = true;
    downloads.delete(p.id);
    res.end();
  }
  return note;
}

async function apiCacheFile(req, res, q) {
  const p = catalog?.products.get(q.get('id') || '');
  if (!p) throw new HttpError(404, 'unknown_product', 'Produit absent de la liste blanche.');
  const f = productPaths(p), st = await statOrNull(f.final);
  if (!st) throw new HttpError(404, 'not_cached', 'Ce produit n\'a pas encore été téléchargé.');
  res.writeHead(200, {
    'content-type': p.text ? 'text/plain; charset=utf-8' : 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-disposition': `${p.text ? 'inline' : 'attachment'}; filename="${p.file}"`,
  });
  pipeFile(fs.createReadStream(f.final), res);
}

// ---------------------------------------------------------------------------------------------
// Aiguillage
// ---------------------------------------------------------------------------------------------
async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`, q = url.searchParams;
  switch (route) {
    case 'GET /api/status': sendJson(res, 200, await apiStatus()); return '';
    case 'GET /api/horizons': { const r = await apiHorizons(q); sendJson(res, 200, r.payload); return r.note; }
    case 'GET /api/probe': { const r = await apiProbe(q); sendJson(res, 200, r); return r.ok ? `${r.status} en ${r.ms} ms` : `échec ${r.status || r.error}`; }
    case 'GET /api/fetch': return apiFetch(req, res, q);
    case 'GET /api/cache': sendJson(res, 200, await listCache()); return '';
    case 'GET /api/cache/file': await apiCacheFile(req, res, q); return '';
    case 'DELETE /api/cache': { const r = await deleteCache(q.get('id')); sendJson(res, 200, r); return `${r.deleted} fichier(s) supprimé(s)`; }
    default: throw new HttpError(404, 'unknown_route', 'Route inconnue.');
  }
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return sendPlain(res, 400, 'Requête invalide'); }
  if (!isLocalRequest(req)) return sendPlain(res, 403, 'Accès réservé à cette machine (127.0.0.1).');
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
    // new URL() a déjà réduit les « .. » : on revérifie sur le texte brut pour refuser nettement la tentative
    if (/(^|[/\\])\.\.([/\\]|$)/.test(decodeURIComponentSafe(req.url.split('?')[0]))) { log(`${req.method} ${req.url} 403 (traversée refusée)`); return sendPlain(res, 403, 'Chemin refusé'); }
    try { await serveStatic(req, res, url.pathname); } catch (e) { if (!res.headersSent) sendPlain(res, 500, 'Erreur interne'); log(`${req.method} ${url.pathname} 500 ${e.message}`); }
    if (res.statusCode >= 400) log(`${req.method} ${url.pathname} ${res.statusCode}`);
    return;
  }
  const label = `${req.method} ${url.pathname}${url.search.length > 90 ? url.search.slice(0, 90) + '…' : url.search}`;
  try {
    if (!isSameOrigin(req)) throw new HttpError(403, 'cross_origin', 'Appel refusé : il ne vient pas de la page servie par ce serveur.');
    const note = await handleApi(req, res, url);
    log(`${label} ${res.statusCode} ${Date.now() - t0} ms${note ? ` (${note})` : ''}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const body = { error: { code: e instanceof HttpError ? e.code : 'server_error', message: e instanceof HttpError ? e.message : 'Erreur interne du serveur local.', ...(e instanceof HttpError ? e.extra : {}) } };
    if (!res.headersSent) sendJson(res, status, body); else res.end();
    log(`${label} ${status} ${Date.now() - t0} ms (${body.error.code}${status === 500 ? ` : ${e.message}` : ''})`);
  }
});
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

// ---------------------------------------------------------------------------------------------
// Démarrage et arrêt
// ---------------------------------------------------------------------------------------------
/** Écoute sur 127.0.0.1 ; si le port est pris, essaie les 20 suivants. */
function listen(port) {
  return new Promise((resolve, reject) => {
    let p = port, left = 20;
    const onError = (e) => {
      if (e.code === 'EADDRINUSE' && port !== 0 && left-- > 0) { log(`Port ${p} occupé, essai du ${p + 1}.`); p += 1; server.listen(p, '127.0.0.1'); }
      else reject(e);
    };
    server.on('error', onError);
    server.once('listening', () => { server.off('error', onError); resolve(server.address().port); });
    server.listen(p, '127.0.0.1');
  });
}
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* pas de navigateur : l'adresse est affichée */ }
}
function shutdown() {
  log('Arrêt du serveur.');
  for (const ac of downloads.values()) ac.abort(new Error('client'));
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1500).unref();
}

if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) { console.error(`Dossier introuvable : ${PUBLIC}. Lancez server.mjs depuis le dossier de l'application.`); process.exit(1); }
net.setDefaultAutoSelectFamily?.(true);   // IPv4/IPv6 : prendre la première famille qui répond
let port;
try { port = await listen(opts.port); } catch (e) { console.error(`Impossible d'ouvrir le port ${opts.port} : ${e.message}`); process.exit(1); }
const address = `http://127.0.0.1:${port}/`;
console.log(`\n  Regolith Finder ${VERSION} — serveur local\n  Adresse : ${address}\n  Cache   : ${CACHE}\n  Arrêt   : Ctrl+C\n`);
process.on('SIGINT', shutdown).on('SIGTERM', shutdown);
if (opts.open) openBrowser(address);
