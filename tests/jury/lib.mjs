// Outils communs des tests « jury » (vrais clics, clavier, molette, glisser).
// Lancer :  D=/home/codex/.cache/paintseed-browser-deps/unpacked
//           flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/jury/<script>.mjs
// Le serveur doit tourner :  node server.mjs --port 8231 --no-open   (ou JURY_URL=http://127.0.0.1:<port>/)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const URL0 = process.env.JURY_URL || 'http://127.0.0.1:8231/';
export const OUT = path.resolve(HERE, '..', '.out');       // captures : tests/.out/jury-*.png
export const LOG = path.resolve(HERE, 'out');              // journaux : tests/jury/out/
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(LOG, { recursive: true });

export async function launch({ width = 1440, height = 900, storageState, touch = false, locale = 'fr-FR' } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width, height }, storageState, hasTouch: touch, acceptDownloads: true, locale });
  const page = await context.newPage();
  const J = { browser, context, page, problems: [], step: 'start', notes: [], t0: Date.now() };
  const push = (s) => J.problems.push(`[${J.step}] ${s}`);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') push(`console.${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => push('pageerror: ' + (e.stack || e.message).slice(0, 600)));
  page.on('requestfailed', (r) => push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) push(`http ${r.status()}: ${r.url()}`); });
  J.shot = async (name, opts = {}) => { const p = `${OUT}/jury-${name}.png`; try { await page.screenshot({ path: p, timeout: 120000, ...opts }); } catch (e) { J.note(`CAPTURE ÉCHOUÉE ${name}: ${e.message.slice(0, 120)}`); } return p; };
  J.note = (s) => { const line = `[${((Date.now() - J.t0) / 1000).toFixed(0)}s][${J.step}] ${s}`; J.notes.push(line); console.log(line); };
  J.setStep = (s) => { J.step = s; };
  J.ready = async () => { await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000 }); };
  J.open = async (url = URL0) => { await page.goto(url, { waitUntil: 'load', timeout: 120000 }); await J.ready(); await page.waitForTimeout(3000); };
  J.state = (keys) => page.evaluate((k) => { const s = window.RF.state; const o = {}; for (const x of k) o[x] = s[x]; return JSON.parse(JSON.stringify(o)); }, keys);
  J.text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
  J.real = () => J.problems.filter((p) => !(/net::ERR_ABORTED/.test(p) && /\/data\/[^ ]*\.(i16|u8|u16)/.test(p)));
  J.finish = async (name) => {
    const real = J.real();
    fs.writeFileSync(`${LOG}/${name}.log`, J.notes.join('\n') + '\n\n== PROBLÈMES CONSOLE/RÉSEAU (' + real.length + ') ==\n' + [...new Set(real)].join('\n') + '\n');
    console.log(`\n== ${real.length} problème(s) console/réseau (hors fausse alerte /data) ==`); for (const p of [...new Set(real)].slice(0, 60)) console.log('  ' + p);
    await browser.close();
  };
  return J;
}

/** Liste les éléments interactifs visibles (pour savoir sur quoi cliquer). */
export function listInteractive(page, rootSel = 'body') {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel); if (!root) return [];
    const css = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3); if (c.length) s += '.' + c.join('.'); return s; };
    const out = [];
    for (const e of root.querySelectorAll('button, a[href], input, select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex="-1"]), label')) {
      const r = e.getBoundingClientRect(); const st = getComputedStyle(e);
      if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
      out.push({ sel: css(e), parent: css(e.parentElement), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 60), title: e.title || '', aria: e.getAttribute('aria-label') || '', type: e.type || '', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), dis: !!e.disabled, pressed: e.getAttribute('aria-pressed') });
    }
    return out;
  }, rootSel);
}

/** Recherche de textes suspects dans tout le document visible. */
export function scanText(page) {
  return page.evaluate(() => {
    const bad = []; const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vis = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.hidden) return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    let n;
    while ((n = walker.nextNode())) {
      const tx = n.textContent.trim(); if (!tx) continue; const el = n.parentElement; if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      let why = null;
      if (/\bNaN\b/.test(tx)) why = 'NaN'; else if (/\bundefined\b/.test(tx)) why = 'undefined'; else if (/\[object /.test(tx)) why = '[object'; else if (/Infinity|∞/.test(tx)) why = 'Infinity'; else if (/\bnull\b/.test(tx)) why = 'null';
      else if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(tx) && !/\.(js|json|i16|u8|u16|jpg|png|md|mjs|bat|sh|csv|geojson|tsv|txt|webp|html|gov|org|com|xyz|edu)$/.test(tx)) why = 'clé i18n ?';
      if (why && vis(el)) { const k = why + '|' + tx.slice(0, 80); if (!seen.has(k)) { seen.add(k); const r = el.getBoundingClientRect(); bad.push({ why, text: tx.slice(0, 120), where: (el.closest('[id]')?.id || '?') + ' ' + el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y) }); } }
    }
    // attributs title / aria-label / placeholder
    for (const e of document.querySelectorAll('[title],[aria-label],[placeholder]')) for (const a of ['title', 'aria-label', 'placeholder']) { const v = e.getAttribute(a); if (v && (/NaN|undefined|\[object /.test(v) || /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(v))) { const k = a + '|' + v; if (!seen.has(k)) { seen.add(k); bad.push({ why: 'attribut ' + a, text: v.slice(0, 120), where: e.tagName.toLowerCase() + '.' + (e.className || '').toString().slice(0, 40) }); } } }
    return bad;
  });
}

/** Éléments dont le texte est tronqué (ellipsis) ou déborde, et paires d'éléments texte qui se chevauchent. */
export function scanOverflow(page, rootSel = 'body') {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel); if (!root) return { clipped: [], offscreen: [] };
    const clipped = []; const offscreen = [];
    for (const e of root.querySelectorAll('*')) {
      if (!e.childNodes.length) continue; const hasText = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()); if (!hasText) continue;
      const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue; const st = getComputedStyle(e); if (st.visibility === 'hidden' || st.display === 'none') continue;
      let hidden = false; for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || p.hidden) { hidden = true; break; } } if (hidden) continue;
      if (e.scrollWidth > e.clientWidth + 2 && (st.overflowX === 'hidden' || st.textOverflow === 'ellipsis') && st.whiteSpace === 'nowrap') clipped.push({ text: e.textContent.trim().slice(0, 70), w: e.clientWidth, sw: e.scrollWidth, where: (e.closest('[id]')?.id || '?') + ' ' + e.tagName.toLowerCase() + '.' + (e.className || '').toString().slice(0, 40) });
      if (r.right > window.innerWidth + 2 || r.left < -2) { let scrollable = false; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) ) { scrollable = true; break; } if (s.overflowX === 'hidden') { scrollable = true; break; } } if (!scrollable) offscreen.push({ text: e.textContent.trim().slice(0, 70), left: Math.round(r.left), right: Math.round(r.right), where: (e.closest('[id]')?.id || '?') + ' ' + e.tagName.toLowerCase() + '.' + (e.className || '').toString().slice(0, 40) }); }
    }
    return { clipped: clipped.slice(0, 60), offscreen: offscreen.slice(0, 40), docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  }, rootSel);
}

/** Exécute une étape ; une exception est notée (avec capture) sans arrêter le parcours. */
export async function step(J, name, fn) {
  J.setStep(name);
  try { await fn(); } catch (e) { J.note('EXCEPTION ' + String(e.message).split('\n')[0].slice(0, 300)); await J.shot('ERR-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)); }
}
/** Attend que la carte 2D n'ait plus rien à dessiner (WebGL logiciel : jusqu'à 90 s). */
export async function mapIdle(page, timeout = 90000) {
  try { await page.waitForFunction(() => { const p = window.RF?.views?.map2d?.perf; return !p || p.idle; }, null, { timeout, polling: 400 }); return true; } catch { return false; }
}
/** Position écran (client) d'un point lat/lon sur la carte 2D. */
export function mapPx(page, lat, lon) {
  return page.evaluate(async ({ lat, lon }) => {
    const c = await import('./js/core/coords.js'); const p = c.spXYFromLatLon(lat, lon); const pf = window.RF.views.map2d.perf, v = pf.view;
    const r = document.querySelector('#view-map2d .map2d-overlay').getBoundingClientRect();
    return { x: r.left + pf.cssW / 2 + (p.x - v.cx) / v.scale, y: r.top + pf.cssH / 2 - (p.y - v.cy) / v.scale, scale: v.scale, rect: { l: r.left, t: r.top, w: r.width, h: r.height } };
  }, { lat, lon });
}
/** Clic réel compté (sélecteur CSS ou locator). */
export async function click(J, target, opts = {}) {
  const loc = typeof target === 'string' ? J.page.locator(target).first() : target;
  await loc.click({ timeout: 15000, ...opts }); J.clicks = (J.clicks || 0) + 1;
}
export const sleep = (page, ms) => page.waitForTimeout(ms);
