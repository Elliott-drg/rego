// Data Center : données embarquées, catalogue des sources, vérification en direct, caches.
// L'interface ne connaît ni les adresses ni les routes : elle passe par data/registry.js (fichiers embarqués),
// data/catalog.js (sources), data/cache.js (cache du navigateur) et data/connectors/* (serveur local, JPL Horizons).
//
// Partout, quatre situations sont distinguées (cahier des charges, section 4.3) : disponible hors ligne,
// déjà téléchargé, nécessite Internet, source injoignable. Chaque état a un texte et une icône, pas seulement une couleur.

import { state, on, select, toast } from '../core/store.js';
import { t, has, num, int, deg, pct, dateUTC } from '../core/i18n.js';
import '../i18n/datacenter.js';
import { h, clear, provTag, button, debounce, throttle } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { fmtLatLon } from '../core/coords.js';
import { DATASETS, dataLoaded, dataFailed, ensureData, tryData, getData } from '../data/registry.js';
import { SOURCES, PRODUCTS, CATALOG_VERIFIED, ACCESS_MODES, productsOfSource, sourceOfFile, sourceById } from '../data/catalog.js';
import { LANDING_SITES, siteSelection, loadArtemisRegions } from '../data/sites.js';
import { cacheList, cacheDelete, cacheClear, cacheBackend } from '../data/cache.js';
import { serverStatus, probeSource, diskCache, deleteDiskCache, fetchProduct, readProductText, integrityAgainstManifest } from '../data/connectors/server.js';
import { verifyWithHorizons, VERIFY_TOLERANCE_DEG } from '../data/connectors/horizons.js';

const TABS = [['embedded', 'layers'], ['sources', 'database'], ['verify', 'target'], ['cache', 'download']];
const DATASET_BY_FILE = Object.fromEntries(Object.entries(DATASETS).map(([id, d]) => [d.file, id]));
const NBSP = '\u00a0';                // espace insécable entre un nombre et son unité
const SUN_DIAMETER_DEG = 0.53;       // diamètre apparent du Soleil vu de la Lune, pour donner une échelle aux écarts

// État de la fenêtre, gardé entre deux ouvertures et entre deux changements de langue
const ui = {
  tab: 'embedded',
  env: null,                 // {server, online, info} ; null = vérification en cours
  openFiles: new Set(),      // lignes « provenance » dépliées (onglet Données embarquées)
  loading: new Map(),        // id de jeu -> fraction chargée
  query: '', filter: 'all', openSources: new Set(),
  probes: new Map(),         // id de source -> {pending:true} | résultat de /api/probe
  verify: { running: false, result: null, error: null },
  disk: null, diskError: null, browser: [],
  downloads: new Map(),      // id de produit -> {received, total, resumedFrom, hashing, controller}
  errors: new Map(),         // id de produit -> dernière erreur
  preview: null,             // {id, text} : fichier texte affiché
};
let view = null;             // éléments de la fenêtre ouverte : {banner, tabs, pane}

// ------------------------------------------------------------------------------------------- outils
function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return `${int(n)}${NBSP}${t('dc.unit.b')}`;
  if (n < 1e6) return `${num(n / 1e3, 1)}${NBSP}${t('dc.unit.kb')}`;
  if (n < 1e9) return `${num(n / 1e6, 1)}${NBSP}${t('dc.unit.mb')}`;
  return `${num(n / 1e9, 2)}${NBSP}${t('dc.unit.gb')}`;
}
const fmtDate = (iso, withTime = true) => (iso ? dateUTC(Date.parse(iso), withTime) : '—');
const fmtClock = (iso) => `${new Date(iso).toLocaleTimeString(state.lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'UTC' })} UTC`;
const signedDeg = (v, d = 4) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${num(Math.abs(v), d)}°` : '—');
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function shaShort(sha) {
  return sha ? h('code', { class: 'mono dc-sha', title: t('dc.emb.copySha', { sha }) }, `${sha.slice(0, 12)}…`) : '—';
}
function errText(e) {
  const code = e?.code, key = `dc.err.${code}`;
  return code && has(key) ? t(key, { detail: e.detail || e.message || '?' }) : t('dc.err.unknown', { detail: e?.message || String(e) });
}
/** Étiquette d'état : icône + texte (la couleur n'est qu'un renfort). */
const BADGE_ICON = { offline: 'check', downloaded: 'download', needsNet: 'globe', unreachable: 'warn', reachable: 'check', local: 'bolt', reference: 'book', missing: 'close', partial: 'download' };
function badge(kind, extra) {
  return h('span', { class: `dc-badge dc-badge-${kind}` }, icon(BADGE_ICON[kind], 13), h('span', {}, t(`dc.avail.${kind}`), extra ? ` · ${extra}` : null));
}
const envKind = () => (!ui.env ? 'checking' : ui.env.server ? (ui.env.online ? 'online' : 'offline') : (ui.env.online ? 'noServer' : 'offlineNoServer'));
/** Raison pour laquelle une action en ligne est impossible, ou null si elle est possible. */
const onlineBlock = () => (!ui.env || ui.env.server === false ? 'noServer' : !ui.env.online ? 'offline' : null);
const extLink = (url) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'dc-url' }, url);
/** Cellule de tableau : `data-label` sert d'intitulé quand le tableau devient une pile de fiches (petits écrans). */
const cell = (label, attrs, ...kids) => h('td', { 'data-label': label, ...attrs }, h('div', { class: 'dc-cellv' }, kids));
/** Ajoute des enfants comme le fait h() : tableaux aplatis, null et false ignorés (Element.append écrirait « null »). */
function put(parent, ...kids) {
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) parent.append(k);
  return parent;
}

// ------------------------------------------------------------------------------------------- ouverture
/** Ouvre le Data Center. @param {'embedded'|'sources'|'verify'|'cache'} [tab] onglet à afficher */
export function openDataCenter(tab) {
  if (TABS.some(([id]) => id === tab)) ui.tab = tab;
  const offs = [
    on('data:ready', () => drawPaneIf('embedded')),
    on('data:progress', ({ id, loaded, total }) => { ui.loading.set(id, total ? loaded / total : 0); updateLoadCell(id); }),
    on('change:selection', () => drawPaneIf('verify')),
    on('change:timeMs', throttle(() => updateVerifyContext(), 250)),
    on('sites:ready', () => drawPaneIf('verify')),
    on('change:online', () => refreshEnv(true)),
  ];
  openModal({
    id: 'datacenter', wide: true, title: () => t('dc.title'),
    render(body) {
      view = { banner: h('div', {}), tabs: h('div', { class: 'dc-tabs', role: 'tablist' }), pane: h('div', { class: 'dc-pane', role: 'tabpanel' }) };
      body.append(h('div', { class: 'dc' }, view.banner, view.tabs, view.pane));
      drawBanner(); drawTabs(); drawPane();
    },
    onClose() { offs.forEach((off) => off()); view = null; },
  });
  tryData('manifest').then(() => { drawTabs(); drawPaneIf('embedded'); });
  loadArtemisRegions();
  refreshEnv(true);
}

async function refreshEnv(force = false) {
  ui.env = await serverStatus({ force });
  if (!view) return;
  drawBanner(); drawPane();
  if (ui.tab === 'cache') refreshCaches();
}
function setTab(id) {
  ui.tab = id; drawTabs(); drawPane();
  if (id === 'cache') refreshCaches();
}
function drawPaneIf(tab) { if (view && ui.tab === tab) drawPane(); }

function drawBanner() {
  if (!view) return;
  const kind = envKind(), info = ui.env?.info;
  const ico = { checking: 'refresh', online: 'check', noServer: 'info', offline: 'warn', offlineNoServer: 'warn' }[kind];
  clear(view.banner).append(h('div', { class: `dc-status dc-status-${kind}`, role: 'status', dataset: { env: kind } },
    h('span', { class: 'dc-status-ico' }, icon(ico, 20)),
    kind === 'checking'
      ? h('div', { class: 'dc-status-text' }, h('strong', {}, t('dc.state.checking')))
      : h('div', { class: 'dc-status-text' },
        h('strong', {}, t(`dc.state.${kind}.title`)),
        h('p', {}, t(`dc.state.${kind}.text`, { version: info?.version || '', node: info?.node || '' })),
        info ? h('p', { class: 'dim mono' }, t('dc.state.diskCache', { n: int(info.cache.files), size: fmtBytes(info.cache.bytes) })) : null),
    kind === 'checking' ? null : button(t('dc.state.recheck'), () => { ui.env = null; drawBanner(); refreshEnv(true); }, { small: true, icon: 'refresh' })));
}
function drawTabs() {
  if (!view) return;
  const count = { embedded: (getData('manifest')?.files || []).length || null, sources: SOURCES.length };
  put(clear(view.tabs), TABS.map(([id, ico]) => h('button', {
    type: 'button', role: 'tab', class: 'dc-tab' + (ui.tab === id ? ' is-on' : ''), 'aria-selected': ui.tab === id ? 'true' : 'false', dataset: { tab: id }, onclick: () => setTab(id),
  }, icon(ico, 15), h('span', {}, t(`dc.tab.${id}`)), count[id] ? h('span', { class: 'dc-count mono' }, int(count[id])) : null)));
}
function drawPane() {
  if (!view) return;
  clear(view.pane);
  view.pane.dataset.tab = ui.tab;
  ({ embedded: paneEmbedded, sources: paneSources, verify: paneVerify, cache: paneCache })[ui.tab](view.pane);
}

// ------------------------------------------------------------------------------------------- (a) données embarquées
function paneEmbedded(pane) {
  const manifest = getData('manifest');
  pane.append(h('p', { class: 'dc-intro' }, t('dc.emb.intro')));
  if (!manifest?.files?.length) {
    // Manifeste absent : état « indisponible » propre, avec la liste des jeux que l'application sait charger
    pane.append(h('div', { class: 'note note-warn' }, t('dc.emb.manifestMissing')));
    pane.append(embeddedTable(Object.values(DATASETS).filter((d) => d.file !== 'manifest.json').map((d) => ({ file: d.file })), false));
    return;
  }
  if (t('dc.manifestLang')) pane.append(h('div', { class: 'note' }, t('dc.manifestLang')));
  const total = manifest.files.reduce((a, f) => a + (f.bytes || 0), 0);
  pane.append(h('p', { class: 'dc-summary mono' }, t('dc.emb.summary', { n: int(manifest.files.length), size: fmtBytes(total), date: fmtDate(manifest.generated_utc, false) })));
  pane.append(embeddedTable(manifest.files, true));
}
function embeddedTable(files, full) {
  const head = ['file', 'origin', 'resolution', 'units', 'size', 'sha', 'state'].map((c) => h('th', { class: c === 'size' ? 'num' : null }, t(`dc.emb.col.${c}`)));
  const body = h('tbody', {});
  for (const rec of files) {
    const open = ui.openFiles.has(rec.file), name = rec.file.replace(/^\.\.\//, '');
    const toggle = () => { if (open) ui.openFiles.delete(rec.file); else ui.openFiles.add(rec.file); drawPane(); };
    body.append(h('tr', { class: 'dc-row' + (open ? ' is-open' : ''), dataset: { file: rec.file } },
      cell(t('dc.emb.col.file'), { class: 'dc-cell-main' },
        h('strong', {}, rec.title || name), h('code', { class: 'mono dim' }, name),
        full ? h('button', { type: 'button', class: 'dc-link', 'aria-expanded': open ? 'true' : 'false', onclick: toggle }, icon('chevron', 13), t('dc.emb.details')) : null),
      cell(t('dc.emb.col.origin'), {}, rec.organism || '—', rec.product_id ? h('div', { class: 'dim' }, rec.product_id) : null),
      cell(t('dc.emb.col.resolution'), {}, rec.resolution || '—'),
      cell(t('dc.emb.col.units'), {}, rec.units || '—'),
      cell(t('dc.emb.col.size'), { class: 'num' }, fmtBytes(rec.bytes)),
      cell(t('dc.emb.col.sha'), {}, shaShort(rec.sha256)),
      cell(t('dc.emb.col.state'), { class: 'dc-cell-state', dataset: { load: DATASET_BY_FILE[rec.file] || '' } }, loadState(rec.file))));
    if (open && full) body.append(h('tr', { class: 'dc-detail' }, h('td', { colspan: 7 }, embeddedDetail(rec))));
  }
  return h('div', { class: 'dc-tablewrap' }, h('table', { class: 'table dc-table dc-table-emb' }, h('thead', {}, h('tr', {}, head)), body));
}
/** État d'un fichier embarqué : toujours « disponible hors ligne » ; en plus, chargé en mémoire ou non. */
function loadState(file) {
  const id = DATASET_BY_FILE[file];
  if (!id) return [badge('offline'), h('div', { class: 'dim' }, t('dc.emb.byView'))];
  if (dataLoaded(id)) return [badge('offline'), h('div', { class: 'dim' }, t('dc.emb.loaded'))];
  if (ui.loading.has(id) && !dataFailed(id)) {
    const f = ui.loading.get(id);
    return [badge('offline'), h('div', { class: 'dim' }, t('dc.emb.loading', { pct: pct(f * 100) })), h('div', { class: 'bar' }, h('i', { style: { width: `${(f * 100).toFixed(0)}%` } }))];
  }
  const load = () => { ui.loading.set(id, 0); updateLoadCell(id); ensureData(id).catch(() => {}).finally(() => { ui.loading.delete(id); drawPaneIf('embedded'); }); };
  if (dataFailed(id)) return [badge('missing'), h('div', { class: 'dim' }, t('dc.emb.failed'), ' ', provTag('missing'))];
  return [badge('offline'), h('div', { class: 'dc-inline' }, h('span', { class: 'dim' }, t('dc.emb.notLoaded')), button(t('dc.emb.load'), load, { small: true, icon: 'download' }))];
}
function updateLoadCell(id) {
  const el = view?.pane.querySelector(`[data-load="${id}"] .dc-cellv`);
  if (el && ui.tab === 'embedded') put(clear(el), loadState(DATASETS[id].file));
}
function embeddedDetail(rec) {
  const src = sourceOfFile(rec.file);
  const item = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : null);
  return h('dl', { class: 'dc-dl' },
    item(t('dc.emb.transformations'), rec.transformations), item(t('dc.emb.limitations'), rec.limitations), item(t('dc.emb.citation'), rec.citation),
    item(t('dc.emb.license'), rec.license), item(t('dc.emb.projection'), rec.projection), item(t('dc.emb.encoding'), rec.encoding),
    item(t('dc.emb.type'), [rec.dtype, Array.isArray(rec.shape) ? rec.shape.join(' × ') : null].filter(Boolean).join(' · ')),
    item(t('dc.emb.retrieved'), rec.retrieved ? fmtDate(rec.retrieved, false) : null),
    item(t('dc.emb.origins'), rec.source_urls?.length ? h('ul', { class: 'dc-list' }, rec.source_urls.map((u) => h('li', {}, extLink(u)))) : null),
    item(t('dc.emb.sourceFiles'), rec.source_files?.length ? h('ul', { class: 'dc-list' }, rec.source_files.map((s) => h('li', {}, h('code', { class: 'mono' }, s.path.split('/').pop()), ' · ', fmtBytes(s.bytes), ' · ', shaShort(s.sha256)))) : null),
    item(t('dc.emb.catalog'), src ? h('button', { type: 'button', class: 'dc-link', onclick: () => { ui.query = ''; ui.filter = 'all'; ui.openSources.add(src.id); setTab('sources'); } }, src.name) : null));
}

// ------------------------------------------------------------------------------------------- (b) sources
function sourceMatches(s, q) {
  if (ui.filter !== 'all' && s.access !== ui.filter) return false;
  if (!q) return true;
  const hay = norm([s.id, s.name, s.organism, s.formats.join(' '), s.files.join(' '), s.urls.map((u) => u.url).join(' '),
    t(`dc.src.access.${s.access}`), t(`dc.src.protocol.${s.protocol}`), ...['products', 'crs', 'units', 'limits'].map((k) => t(`dc.src.${s.id}.${k}`))].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
function paneSources(pane) {
  const block = onlineBlock();
  const list = h('div', { class: 'dc-srclist' });
  const counter = h('span', { class: 'dim mono' });
  const drawList = () => {
    const q = norm(ui.query.trim()), shown = SOURCES.filter((s) => sourceMatches(s, q));
    counter.textContent = t('dc.src.count', { n: int(shown.length) });
    put(clear(list), shown.length ? shown.map((s) => sourceCard(s, !!q)) : h('div', { class: 'empty' }, t('dc.src.none')));
    return shown;
  };
  const search = h('input', { type: 'search', class: 'input dc-search', placeholder: t('dc.src.search'), 'aria-label': t('dc.src.search'), value: ui.query, autocomplete: 'off', spellcheck: 'false' });
  search.addEventListener('input', debounce(() => { ui.query = search.value; drawList(); }, 120));
  const filters = h('div', { class: 'seg dc-filters' }, ['all', ...ACCESS_MODES].map((f) => h('button', {
    type: 'button', class: ui.filter === f ? 'is-on' : '', dataset: { filter: f }, onclick: () => { ui.filter = f; drawPane(); },
  }, t(`dc.src.filter.${f}`))));
  const testAll = button(t('dc.src.testAll'), async () => {
    const queue = SOURCES.filter((s) => sourceMatches(s, norm(ui.query.trim()))).map((s) => s.id);
    const worker = async () => { for (let id; (id = queue.shift());) await runProbe(id); };
    await Promise.all([worker(), worker(), worker()]);     // trois tests à la fois, pas plus
  }, { small: true, icon: 'refresh', disabled: !!block });
  put(pane,
    h('p', { class: 'dc-intro' }, t('dc.src.intro')),
    h('div', { class: 'dc-toolbar' }, h('label', { class: 'dc-searchbox' }, icon('search', 15), search), filters, h('span', { class: 'dc-toolbar-end' }, counter, testAll)),
    block ? h('div', { class: 'note note-warn', dataset: { blocked: block } }, t(`dc.src.testOff.${block}`)) : null,
    list);
  drawList();
}
const ACCESS_BADGE = { embedded: 'offline', online: 'needsNet', local: 'local', reference: 'reference' };
function sourceCard(s, forceOpen) {
  const open = forceOpen || ui.openSources.has(s.id), block = onlineBlock(), probe = ui.probes.get(s.id);
  const toggle = () => { if (ui.openSources.has(s.id)) ui.openSources.delete(s.id); else ui.openSources.add(s.id); drawPane(); };
  let result = null;
  if (probe?.pending) result = h('span', { class: 'dc-probe dim' }, icon('refresh', 13), t('dc.src.testing'));
  else if (probe) {
    const at = t('dc.src.result.at', { time: fmtClock(probe.checked_at) });
    result = probe.ok
      ? h('span', { class: 'dc-probe' }, badge('reachable', t('dc.src.result.ok', { status: probe.status, ms: int(probe.ms) })), h('span', { class: 'dim' }, at))
      : h('span', { class: 'dc-probe' }, badge('unreachable', probe.status ? t('dc.src.result.http', { status: probe.status }) : t('dc.src.result.error', { error: probe.error || '?' })), h('span', { class: 'dim' }, at));
  }
  const field = (key, value) => [h('dt', {}, t(`dc.src.f.${key}`)), h('dd', {}, value)];
  const products = productsOfSource(s.id);
  const body = !open ? null : h('dl', { class: 'dc-dl dc-src-body' },
    field('organism', s.organism),
    field('access', t(`dc.src.access.${s.access}`)),
    field('protocol', t(`dc.src.protocol.${s.protocol}`)),
    field('formats', s.formats.join(' · ')),
    field('products', t(`dc.src.${s.id}.products`)),
    field('crs', t(`dc.src.${s.id}.crs`)),
    field('units', t(`dc.src.${s.id}.units`)),
    field('limits', t(`dc.src.${s.id}.limits`)),
    s.files.length ? field('files', h('span', { class: 'mono' }, s.files.join(' · '))) : null,
    products.length ? field('onDemand', [h('ul', { class: 'dc-list' }, products.map((p) => h('li', {}, t(`dc.prod.${p.id}`), ' · ', fmtBytes(p.bytes)))),
      h('button', { type: 'button', class: 'dc-link', onclick: () => setTab('cache') }, t('dc.src.seeCache'))]) : null,
    field('urls', h('ul', { class: 'dc-list' }, s.urls.map((u) => h('li', {},
      h('span', { class: 'dc-role mono' }, t(`dc.src.role.${u.role}`)), extLink(u.url),
      h('span', { class: 'dim mono' }, u.note ? t(`dc.src.observed.${u.note}`) : t('dc.src.observed', { status: u.status })))))),
    field('verified', t('dc.src.verifiedOn', { date: fmtDate(CATALOG_VERIFIED, false) })));
  return h('article', { class: 'dc-src' + (open ? ' is-open' : ''), dataset: { source: s.id } },
    h('header', { class: 'dc-src-head' },
      h('button', { type: 'button', class: 'dc-src-toggle', 'aria-expanded': open ? 'true' : 'false', onclick: toggle }, icon('chevron', 14),
        h('span', { class: 'dc-src-name' }, h('strong', {}, s.name), h('span', { class: 'dim' }, s.organism))),
      h('div', { class: 'dc-src-side' }, badge(ACCESS_BADGE[s.access]), result,
        button(t('dc.src.test'), () => runProbe(s.id), { small: true, disabled: !!block || !!probe?.pending, title: block ? t(`dc.src.testOff.${block}`) : s.probe }))),
    body);
}
async function runProbe(id) {
  ui.probes.set(id, { pending: true }); drawPaneIf('sources');
  try { ui.probes.set(id, await probeSource(id)); } catch (e) {
    ui.probes.delete(id); toast(errText(e), 'warn');
    if (e.code === 'no_server') refreshEnv(true);
  }
  drawPaneIf('sources');
}

// ------------------------------------------------------------------------------------------- (c) vérification en direct
const verifyKey = (sel, timeMs) => (sel ? `${sel.lat.toFixed(6)}|${sel.lon.toFixed(6)}|${Math.round(timeMs / 60e3)}` : '');
function paneVerify(pane) {
  const sel = state.selection, v = ui.verify, block = onlineBlock();
  pane.append(h('p', { class: 'dc-intro' }, t('dc.ver.intro')));
  const sites = [...LANDING_SITES].sort((a, b) => (a.kind === 'artemis' ? 0 : 1) - (b.kind === 'artemis' ? 0 : 1));
  const picker = h('select', { class: 'input dc-sitepick', 'aria-label': t('dc.ver.pick'), onchange: (e) => { const s = LANDING_SITES.find((x) => x.id === e.target.value); if (s) select(siteSelection(s)); } },
    h('option', { value: '' }, t('dc.ver.pick')), sites.map((s) => h('option', { value: s.id, selected: sel?.siteId === s.id }, s.name)));
  const run = button(v.running ? t('dc.ver.running') : t('dc.ver.run'), runVerify, { kind: 'primary', icon: 'target', disabled: !sel || v.running });
  run.dataset.action = 'verify';
  pane.append(h('div', { class: 'card dc-ver-setup' },
    h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, icon('pin'), t('dc.ver.site')),
      h('span', { class: 'kv-v' }, sel ? `${sel.name} · ${fmtLatLon(sel.lat, sel.lon, 3, state.lang)}` : '—')),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, icon('clock'), t('dc.ver.date')), h('span', { class: 'kv-v', dataset: { verDate: '' } }, dateUTC(state.timeMs))),
    sel ? null : h('div', { class: 'note note-info' }, t('dc.ver.noSite')),
    h('div', { class: 'dc-inline dc-ver-actions' }, picker, run)));
  if (block) pane.append(h('div', { class: 'note note-warn', dataset: { blocked: block } }, t(`dc.ver.offNote.${block}`)));
  if (v.error) pane.append(h('div', { class: 'note note-warn dc-error', role: 'alert' }, errText(v.error)));
  if (v.result) pane.append(verifyResult(v.result));
  pane.append(h('details', { class: 'dc-more' }, h('summary', {}, t('dc.ver.method')), h('p', {}, t('dc.ver.methodText'))));
}
function updateVerifyContext() {
  if (!view || ui.tab !== 'verify') return;
  const el = view.pane.querySelector('[data-ver-date]');
  if (el) el.textContent = dateUTC(state.timeMs);
  const stale = view.pane.querySelector('[data-stale]');
  if (stale && ui.verify.result) stale.hidden = verifyKey(state.selection, state.timeMs) === verifyKey(ui.verify.result.site, ui.verify.result.timeMs);
}
async function runVerify() {
  const sel = state.selection, v = ui.verify;
  if (!sel || v.running) return;
  Object.assign(v, { running: true, error: null }); drawPaneIf('verify');
  try { v.result = { ...(await verifyWithHorizons(sel, state.timeMs)), name: sel.name }; } catch (e) { v.error = e; v.result = null; }
  v.running = false;
  drawPaneIf('verify'); refreshEnv(true);
}
function verifyResult(r) {
  // Le seuil s'applique à l'écart sur le ciel (azimut × cos élévation) et à l'élévation, pas à l'azimut brut,
  // qui diverge près du zénith sans que la direction soit fausse.
  const worst = Math.max(r.maxDSky, r.maxDEl), ok = r.withinTolerance;
  // Précision annoncée : le plus petit palier que l'écart respecte (au pire, le seuil d'alerte)
  const shown = [0.002, 0.005, 0.01, 0.02].find((x) => worst < x) ?? VERIFY_TOLERANCE_DEG;
  const maxSep = r.rows.reduce((m, x) => Math.max(m, Math.hypot(x.dSky, x.dEl)), 0);
  const vars = { n: int(r.rows.length), dAz: deg(r.maxDAz, 4), dSky: deg(r.maxDSky, 4), dEl: deg(r.maxDEl, 4), tol: ok ? deg(shown, shown < 0.01 ? 3 : 2) : deg(VERIFY_TOLERANCE_DEG, 2) };
  const origin = r.cached === 'browser' ? 'browser' : r.cached === 'server' ? 'server' : 'live';
  const head = h('tr', {},
    h('th', {}, t('dc.ver.col.time')), h('th', {}, t('dc.ver.col.body')),
    h('th', { class: 'num', colspan: 2 }, t('dc.ver.col.local'), ' ', provTag('computed')), h('th', { class: 'num', colspan: 2 }, t('dc.ver.col.horizons')),
    h('th', { class: 'num' }, t('dc.ver.col.dAz')), h('th', { class: 'num' }, t('dc.ver.col.dSky')), h('th', { class: 'num' }, t('dc.ver.col.dEl')));
  const pair = (label, o) => [cell(`${label} · ${t('dc.ver.az')}`, { class: 'num' }, `${t('dc.ver.az')} ${deg(o.az, 4)}`), cell(`${label} · ${t('dc.ver.el')}`, { class: 'num' }, `${t('dc.ver.el')} ${deg(o.el, 4)}`)];
  const rows = r.rows.map((x) => h('tr', { dataset: { body: x.body } },
    cell(t('dc.ver.col.time'), { class: 'mono' }, dateUTC(x.t)),
    cell(t('dc.ver.col.body'), {}, icon(x.body, 14), ' ', t(`body.${x.body}`)),
    pair(t('dc.ver.col.local'), x.local), pair(t('dc.ver.col.horizons'), x.horizons),
    cell(t('dc.ver.col.dAz'), { class: 'num dim' }, signedDeg(x.dAz)), cell(t('dc.ver.col.dSky'), { class: 'num' }, signedDeg(x.dSky)),
    cell(t('dc.ver.col.dEl'), { class: 'num' }, signedDeg(x.dEl))));
  return h('section', { class: 'dc-ver-result', dataset: { cached: String(r.cached), maxDaz: r.maxDAz.toFixed(6), maxDsky: r.maxDSky.toFixed(6), maxDel: r.maxDEl.toFixed(6) } },
    h('div', { class: 'note note-warn', dataset: { stale: '' }, hidden: verifyKey(state.selection, state.timeMs) === verifyKey(r.site, r.timeMs) }, t('dc.ver.stale')),
    h('div', { class: `dc-verdict ${ok ? 'dc-verdict-ok' : 'dc-verdict-warn'}` }, icon(ok ? 'check' : 'warn', 20),
      h('div', {}, h('strong', {}, t(ok ? 'dc.ver.conclusion.ok' : 'dc.ver.conclusion.warn', vars)),
        h('p', {}, t('dc.ver.skyNote')),
        h('p', {}, t('dc.ver.context', { ratio: pct((maxSep / SUN_DIAMETER_DEG) * 100, 1) })))),
    h('div', { class: 'dc-ver-meta' },
      h('span', {}, icon('pin', 14), ` ${r.name} · ${fmtLatLon(r.site.lat, r.site.lon, 4, state.lang)}`),
      h('span', {}, icon('mountain', 14), ` ${t('dc.ver.height')} : `, r.site.heightKnown ? [`${num(r.site.heightM, 1)}${NBSP}m `, provTag('measured')] : t('dc.ver.heightUnknown')),
      h('span', { dataset: { origin } }, icon(origin === 'live' ? 'globe' : 'database', 14), ` ${t(`dc.ver.origin.${origin}`, { time: fmtDate(r.queriedAt) })}`)),
    h('div', { class: 'dc-tablewrap' }, h('table', { class: 'table dc-table dc-table-ver' }, h('thead', {}, head), h('tbody', {}, rows))),
    r.signature?.length ? h('details', { class: 'dc-more' }, h('summary', {}, t('dc.ver.signature')), h('pre', { class: 'dc-pre' }, r.signature.join('\n'))) : null);
}

// ------------------------------------------------------------------------------------------- (d) cache et téléchargements
async function refreshCaches() {
  ui.diskError = null;
  if (ui.env?.server) { try { ui.disk = await diskCache(); } catch (e) { ui.disk = null; ui.diskError = e; } } else ui.disk = null;
  ui.browser = await cacheList();
  drawPaneIf('cache');
}
function paneCache(pane) {
  const block = onlineBlock(), disk = ui.disk;
  pane.append(h('p', { class: 'dc-intro' }, t('dc.cache.intro')));

  // 1. Produits téléchargeables à la demande
  const manifest = getData('manifest');
  const prodRows = PRODUCTS.map((p) => productRow(p, disk, manifest, block));
  pane.append(h('section', { class: 'dc-sec' },
    h('h3', { class: 'dc-h' }, icon('download', 15), t('dc.cache.products')),
    h('p', { class: 'dim' }, t('dc.cache.productsIntro')),
    block ? h('div', { class: 'note note-warn', dataset: { blocked: block } }, t(`dc.cache.downloadOff.${block}`)) : null,
    ui.diskError ? h('div', { class: 'note note-warn' }, errText(ui.diskError)) : null,
    h('div', { class: 'dc-tablewrap' }, h('table', { class: 'table dc-table dc-table-prod' },
      h('thead', {}, h('tr', {}, ['item', 'size', 'state', 'sha'].map((c) => h('th', { class: c === 'size' ? 'num' : null }, t(`dc.cache.col.${c}`))), h('th', {}))),
      h('tbody', {}, prodRows)))));

  // 2. Réponses Horizons sur disque
  const hz = (disk?.files || []).filter((f) => f.kind === 'horizons');
  pane.append(h('section', { class: 'dc-sec', dataset: { sec: 'horizons' } },
    h('h3', { class: 'dc-h' }, icon('database', 15), t('dc.cache.horizons'),
      hz.length ? button(t('dc.cache.deleteAll'), () => removeDisk('horizons'), { small: true, icon: 'trash' }) : null),
    !ui.env?.server ? h('div', { class: 'note' }, t('dc.cache.diskOff.noServer'))
      : !hz.length ? h('div', { class: 'empty' }, t('dc.cache.empty'))
        : [h('p', { class: 'dim mono' }, t('dc.cache.total', { n: int(hz.length), size: fmtBytes(hz.reduce((a, f) => a + f.bytes, 0)) }), disk?.dir ? ` · ${t('dc.cache.dir', { dir: disk.dir })}` : ''),
          h('div', { class: 'dc-tablewrap' }, h('table', { class: 'table dc-table' },
            h('thead', {}, h('tr', {}, ['item', 'size', 'date', 'expires', 'sha'].map((c) => h('th', { class: c === 'size' ? 'num' : null }, t(`dc.cache.col.${c}`))), h('th', {}))),
            h('tbody', {}, hz.map((f) => h('tr', { dataset: { cache: f.id } },
              cell(t('dc.cache.col.item'), {}, badge('downloaded'), h('div', {}, horizonsLabel(f.request))),
              cell(t('dc.cache.col.size'), { class: 'num' }, fmtBytes(f.bytes)),
              cell(t('dc.cache.col.date'), { class: 'mono' }, fmtDate(f.date)),
              cell(t('dc.cache.col.expires'), { class: 'mono' }, fmtDate(f.expires, false)),
              cell(t('dc.cache.col.sha'), {}, shaShort(f.sha256)),
              h('td', { class: 'dc-actions' }, button(t('dc.cache.delete'), () => removeDisk(f.id), { small: true, icon: 'trash' })))))))]));

  // 3. Cache du navigateur
  const backend = cacheBackend();
  pane.append(h('section', { class: 'dc-sec', dataset: { sec: 'browser' } },
    h('h3', { class: 'dc-h' }, icon('layers', 15), t('dc.cache.browser'),
      ui.browser.length ? button(t('dc.cache.deleteAll'), async () => { await cacheClear(); refreshCaches(); }, { small: true, icon: 'trash' }) : null),
    backend ? h('p', { class: 'dim mono', dataset: { backend } }, t(`dc.cache.backend.${backend}`),
      ui.browser.length ? ` · ${t('dc.cache.total', { n: int(ui.browser.length), size: fmtBytes(ui.browser.reduce((a, r) => a + r.size, 0)) })}` : '') : null,
    !ui.browser.length ? h('div', { class: 'empty' }, t('dc.cache.empty'))
      : h('div', { class: 'dc-tablewrap' }, h('table', { class: 'table dc-table' },
        h('thead', {}, h('tr', {}, ['item', 'size', 'date'].map((c) => h('th', { class: c === 'size' ? 'num' : null }, t(`dc.cache.col.${c}`))), h('th', {}))),
        h('tbody', {}, ui.browser.map((r) => h('tr', {},
          cell(t('dc.cache.col.item'), {}, badge('downloaded'), h('div', {}, browserLabel(r))),
          cell(t('dc.cache.col.size'), { class: 'num' }, fmtBytes(r.size)),
          cell(t('dc.cache.col.date'), { class: 'mono' }, fmtDate(r.date)),
          h('td', { class: 'dc-actions' }, button(t('dc.cache.delete'), async () => { await cacheDelete(r.key); refreshCaches(); }, { small: true, icon: 'trash' })))))))));
}
function horizonsLabel(req) {
  if (!req) return '—';
  const day = (iso) => iso.replace('T', ' ').replace('Z', '');
  return t('dc.cache.horizonsItem', { body: t(`body.${req.body}`), lat: `${num(req.lat, 4)}°`, lon: `${num(req.lonEast, 4)}°`, alt: num(req.alt_km, 3), start: day(req.start), stop: day(req.stop), step: req.step });
}
function browserLabel(rec) {
  const p = rec.key.split('|');
  if (p[0] !== 'horizons' || p.length < 8) return rec.key;
  return horizonsLabel({ body: p[1], lat: Number(p[2]), lonEast: Number(p[3]), alt_km: Number(p[4]), start: p[5], stop: p[6], step: p[7] });
}
function productRow(p, disk, manifest, block) {
  const file = disk?.files.find((f) => f.id === p.id && f.kind === 'product');
  const part = disk?.files.find((f) => f.id === p.id && f.kind === 'partial');
  const dl = ui.downloads.get(p.id), err = ui.errors.get(p.id), src = sourceById(p.source);
  let stateCell, shaCell = '—', actions = [];
  if (dl) {
    stateCell = h('div', { class: 'dc-dl-progress', dataset: { dl: p.id } }, progressContent(dl));
    actions = [button(t('dc.cache.cancel'), () => dl.controller.abort(), { small: true, icon: 'close' })];
  } else if (file) {
    const integ = integrityAgainstManifest(file, manifest);
    stateCell = [badge('downloaded'), h('div', { class: 'dim mono' }, fmtDate(file.date))];
    shaCell = [shaShort(file.sha256), h('div', { class: `dc-integrity dc-integrity-${integ.status}`, dataset: { integrity: integ.status }, title: integ.file ? t(`dc.cache.integrity.${integ.status}.help`, { file: integ.file }) : null },
      icon(integ.status === 'match' ? 'check' : integ.status === 'differs' ? 'warn' : 'info', 13), t(`dc.cache.integrity.${integ.status}`))];
    const shown = ui.preview?.id === p.id;
    actions = [p.text ? button(shown ? t('dc.cache.hide') : t('dc.cache.view'), () => togglePreview(p.id), { small: true, icon: 'eye' }) : null,
      button(t('dc.cache.delete'), () => removeDisk(p.id), { small: true, icon: 'trash' })];
  } else if (part) {
    stateCell = [badge('partial'), h('div', { class: 'dim' }, t('dc.cache.partialOf', { received: fmtBytes(part.bytes), total: fmtBytes(part.expected_bytes ?? p.bytes) }))];
    actions = [button(t('dc.cache.resume'), () => startDownload(p.id), { small: true, icon: 'download', disabled: !!block }), button(t('dc.cache.delete'), () => removeDisk(p.id), { small: true, icon: 'trash' })];
  } else {
    stateCell = badge('needsNet');
    actions = [button(t('dc.cache.download'), () => startDownload(p.id), { small: true, icon: 'download', disabled: !!block, title: block ? t(`dc.cache.downloadOff.${block}`) : null })];
  }
  const row = h('tr', { dataset: { product: p.id } },
    cell(t('dc.cache.col.item'), { class: 'dc-cell-main' }, h('strong', {}, t(`dc.prod.${p.id}`)), h('span', { class: 'dim' }, src?.name || p.source), h('code', { class: 'mono dim' }, p.file)),
    cell(t('dc.cache.col.size'), { class: 'num' }, fmtBytes(file ? file.bytes : p.bytes)),
    cell(t('dc.cache.col.state'), { class: 'dc-cell-state' }, stateCell, err ? h('div', { class: 'dc-rowerr', role: 'alert' }, icon('warn', 13), errText(err)) : null),
    cell(t('dc.cache.col.sha'), {}, shaCell),
    h('td', { class: 'dc-actions' }, actions));
  if (ui.preview?.id !== p.id) return row;
  return [row, h('tr', { class: 'dc-detail' }, h('td', { colspan: 5 },
    h('div', { class: 'dim' }, t('dc.cache.preview', { size: fmtBytes(new Blob([ui.preview.text]).size) })), h('pre', { class: 'dc-pre dc-pre-file' }, ui.preview.text)))];
}
function progressContent(dl) {
  const known = Number.isFinite(dl.total) && dl.total > 0;
  return [
    h('div', { class: 'bar' }, h('i', { style: { width: known ? `${Math.min(100, (dl.received / dl.total) * 100).toFixed(1)}%` : '100%' } })),
    h('div', { class: 'dim mono' }, dl.hashing ? t('dc.cache.hashing')
      : known ? t('dc.cache.progress', { received: fmtBytes(dl.received), total: fmtBytes(dl.total) }) : t('dc.cache.progressUnknown', { received: fmtBytes(dl.received) }),
    dl.resumedFrom ? ` · ${t('dc.cache.resumedFrom', { size: fmtBytes(dl.resumedFrom) })}` : ''),
  ];
}
async function startDownload(id) {
  if (ui.downloads.has(id)) return;
  const dl = { received: 0, total: null, resumedFrom: 0, hashing: false, controller: new AbortController() };
  ui.downloads.set(id, dl); ui.errors.delete(id); drawPaneIf('cache');
  const onProgress = (p) => {
    Object.assign(dl, p);
    const el = view?.pane.querySelector(`[data-dl="${id}"]`);
    if (el) put(clear(el), progressContent(dl));
  };
  try { await fetchProduct(id, { signal: dl.controller.signal, onProgress }); } catch (e) { ui.errors.set(id, e); }
  ui.downloads.delete(id);
  await refreshEnv(true);
  if (ui.tab !== 'cache') refreshCaches();
}
async function removeDisk(id) {
  try {
    const r = await deleteDiskCache(id);
    if (ui.preview?.id === id) ui.preview = null;
    toast(t('dc.cache.deleted', { n: int(r.deleted), size: fmtBytes(r.bytes) }), 'ok');
  } catch (e) { toast(errText(e), 'warn'); }
  refreshEnv(true);
}
async function togglePreview(id) {
  if (ui.preview?.id === id) ui.preview = null;
  else { try { ui.preview = { id, text: await readProductText(id) }; } catch (e) { ui.preview = null; toast(errText(e), 'warn'); } }
  drawPaneIf('cache');
}
