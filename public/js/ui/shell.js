// Coquille de l'interface : en-tête (recherche, modes, langue, réglages), bascule des vues, panneaux.
import { state, set, on, select, toast, setParam, emit } from '../core/store.js';
import { t, applyI18n } from '../core/i18n.js';
import '../i18n/shell.js';
import { h, clear, debounce, download } from './dom.js';
import { icon } from './icons.js';
import { parseLatLon, fmtLatLon } from '../core/coords.js';
import { LANDING_SITES, siteSelection } from '../data/sites.js';
import { getData, tryData } from '../data/registry.js';
import { mountLeft } from './leftpanel.js';
import { mountRight } from './rightpanel.js';

/** Charge un module facultatif et appelle une de ses fonctions ; message clair s'il manque. */
export async function callModule(path, fn, ...args) {
  try { const m = await import(path); if (typeof m[fn] !== 'function') throw new Error(`${fn} absent`); return m[fn](...args); }
  catch (e) { console.error('[module]', path, e); toast(t('shell.moduleMissing'), 'warn'); return null; }
}
export const actions = {
  history: () => callModule('./modals.js', 'openHistory'),
  founders: () => callModule('./modals.js', 'openFounders'),
  tutorial: () => callModule('./modals.js', 'openTutorial'),
  dataCenter: () => callModule('./datacenter.js', 'openDataCenter'),
  importer: () => callModule('./importer.js', 'openImporter'),
  energy: () => callModule('./energy.js', 'openEnergy', state.selection),
  plan: () => set({ view: 'compare' }),
  demo: async () => { if (state.demo) { await callModule('./demo.js', 'stopDemo'); } else { await callModule('./demo.js', 'startDemo'); } },
  measure: () => { const onNow = state.tool === 'measure'; set({ tool: onNow ? null : 'measure', measure: onNow ? state.measure : [] }); if (!onNow && state.view !== 'map2d') set({ view: 'map2d' }); },
};

// ------------------------------------------------------------------ Recherche
function searchItems(q) {
  const out = [], s = q.trim().toLowerCase();
  if (!s) return out;
  const ll = parseLatLon(q);
  if (ll) out.push({ label: fmtLatLon(ll.lat, ll.lon, 3, state.lang), sub: t('shell.search.coords'), sel: { name: fmtLatLon(ll.lat, ll.lon, 2, state.lang), lat: ll.lat, lon: ll.lon, kind: 'point' } });
  const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ns = norm(s);
  for (const site of LANDING_SITES) if (norm(site.name).includes(ns)) out.push({ label: site.name, sub: t('kind.' + site.kind), sel: siteSelection(site) });
  const feats = getData('features') || [];
  const hits = feats.filter((f) => norm(f.name).includes(ns)).sort((a, b) => (norm(a.name).startsWith(ns) ? 0 : 1) - (norm(b.name).startsWith(ns) ? 0 : 1) || (b.diamKm || 0) - (a.diamKm || 0)).slice(0, 12);
  for (const f of hits) out.push({ label: f.name, sub: `${fmtLatLon(f.lat, f.lon, 1, state.lang)}${f.diamKm ? ` · ${Math.round(f.diamKm)} km` : ''}`, sel: { key: 'feat:' + f.name, name: f.name, lat: f.lat, lon: f.lon, kind: 'feature' } });
  return out.slice(0, 16);
}
function searchBox() {
  const input = h('input', { type: 'search', 'data-i18n-placeholder': 'shell.search.placeholder', placeholder: t('shell.search.placeholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('shell.search.placeholder') });
  const results = h('div', { class: 'search-results hidden', role: 'listbox' });
  let items = [], active = 0;
  const pick = (it) => { select(it.sel); emit('view:flyTo', { lat: it.sel.lat, lon: it.sel.lon }); input.value = ''; results.classList.add('hidden'); input.blur(); };
  const render = () => {
    clear(results);
    if (!items.length) { if (input.value.trim()) results.append(h('div', { class: 'search-item dim' }, t('shell.search.none'))); else { results.classList.add('hidden'); return; } }
    items.forEach((it, i) => results.append(h('div', { class: 'search-item' + (i === active ? ' active' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); pick(it); } }, h('span', {}, it.label), h('small', {}, it.sub))));
    results.classList.remove('hidden');
  };
  input.addEventListener('input', debounce(() => { items = searchItems(input.value); active = 0; render(); }, 90));
  input.addEventListener('focus', () => { tryData('features'); if (input.value) { items = searchItems(input.value); render(); } });
  input.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[active]) pick(items[active]);
    else if (e.key === 'Escape') { input.value = ''; results.classList.add('hidden'); input.blur(); }
  });
  return h('div', { class: 'searchbox' }, icon('search'), input, results);
}

// ------------------------------------------------------------------ Réglages
function settingsPopover(anchor) {
  const existing = document.querySelector('.popover.settings'); if (existing) { existing.remove(); return; }
  const sel = (value, options, onchange) => { const s = h('select', { class: 'input', onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, ...(v === value ? { selected: true } : {}) }, l))); return s; };
  const numInput = (name, min, max, step) => h('input', { class: 'input', type: 'number', min, max, step, value: state.params[name], style: { width: '84px' }, onchange: (e) => { const v = Math.max(min, Math.min(max, parseFloat(e.target.value))); if (Number.isFinite(v)) { setParam(name, v); e.target.value = v; } else e.target.value = state.params[name]; } });
  const pop = h('div', { class: 'popover settings glass' },
    h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, icon('eye'), t('shell.settings.cvd')), sel(state.cvd, [['none', t('shell.cvd.none')], ['deuteranopia', t('shell.cvd.deuteranopia')], ['protanopia', t('shell.cvd.protanopia')], ['tritanopia', t('shell.cvd.tritanopia')]], (v) => set({ cvd: v }))),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, icon('thermo'), t('shell.settings.tempUnit')), sel(state.tempUnit, [['K', 'Kelvin (K)'], ['C', 'Celsius (°C)']], (v) => set({ tempUnit: v }))),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, icon('layers'), t('shell.settings.mode')), sel(state.mode, [['simple', t('mode.simple')], ['expert', t('mode.expert')]], (v) => set({ mode: v }))),
    h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, icon('globe'), t('shell.settings.lang')), sel(state.lang, [['fr', 'Français'], ['en', 'English']], (v) => set({ lang: v }))),
    h('hr', { class: 'sep' }),
    h('div', { class: 'kv', title: t('shell.param.mast.help') }, h('span', { class: 'kv-k' }, icon('antenna'), t('shell.param.mast')), numInput('mastM', 0, 200, 1)),
    h('div', { class: 'kv', title: t('shell.param.margin.help') }, h('span', { class: 'kv-k' }, icon('earth'), t('shell.param.margin')), numInput('earthMarginDeg', 0, 10, 0.5)),
    h('div', { class: 'kv', title: t('shell.param.slope.help') }, h('span', { class: 'kv-k' }, icon('slope'), t('shell.param.slope')), numInput('slopeLimitDeg', 1, 30, 1)),
    h('div', { class: 'kv', title: t('shell.param.radius.help') }, h('span', { class: 'kv-k' }, icon('target'), t('shell.param.radius')), numInput('landingRadiusM', 500, 10000, 500)),
    h('hr', { class: 'sep' }),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { exportView(); pop.remove(); } }, icon('camera'), t('shell.settings.png')),
    h('div', { class: 'pop-nav' }, [['plan', 'compare'], ['energy', 'bolt'], ['dataCenter', 'database', 'data'], ['history', 'history'], ['tutorial', 'help'], ['founders', 'users'], ['demo', 'play', null, 'shell.demo']].map(([a, ic, key, full]) =>
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { pop.remove(); actions[a](); } }, icon(ic), t(full || `shell.nav.${key || a}`)))),
  );
  document.body.append(pop);
  const close = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}
function exportView() {
  const v = window.RF?.views?.[state.view];
  const url = v?.snapshot?.();
  if (!url) { toast(t('shell.png.none'), 'warn'); return; }
  fetch(url).then((r) => r.blob()).then((b) => download(`regolith-finder-${state.view}-${new Date(state.timeMs).toISOString().slice(0, 16).replace(':', 'h')}.png`, b));
}

// ------------------------------------------------------------------ En-tête
function renderHeader(el) {
  clear(el);
  const seg = (items, current, onpick, cls = '') => h('div', { class: 'seg ' + cls, role: 'group' }, items.map(([v, label, title]) => h('button', { type: 'button', class: v === current ? 'is-on' : '', title: title || null, 'aria-pressed': String(v === current), onclick: () => onpick(v) }, label)));
  const gear = h('button', { class: 'iconbtn', type: 'button', title: t('shell.settings'), 'aria-label': t('shell.settings'), onclick: () => settingsPopover(gear) }, icon('settings', 19));
  el.append(
    h('button', { class: 'iconbtn', type: 'button', title: t('shell.toggleLeft'), 'aria-label': t('shell.toggleLeft'), onclick: () => set({ leftOpen: !state.leftOpen }) }, icon('menu', 20)),
    h('div', { class: 'brand', title: 'Regolith Finder', onclick: () => actions.founders() },
      h('img', { src: 'assets/logo-256.png', alt: '', onerror: (e) => e.target.remove() }),
      h('div', { class: 'brand-text' }, h('div', { class: 'brand-name' }, 'REGOLITH FINDER'), h('div', { class: 'brand-sub' }, t('app.tagline')))),
    searchBox(),
    h('nav', { class: 'navpills', 'aria-label': t('shell.nav') },
      h('button', { type: 'button', onclick: actions.plan }, t('shell.nav.plan')),
      h('button', { type: 'button', onclick: actions.energy }, t('shell.nav.energy')),
      h('button', { type: 'button', onclick: actions.dataCenter }, t('shell.nav.data')),
      h('button', { type: 'button', onclick: actions.history }, t('shell.nav.history')),
      h('button', { type: 'button', onclick: actions.tutorial }, t('shell.nav.tutorial')),
      h('button', { type: 'button', onclick: actions.founders }, t('shell.nav.founders'))),
    h('div', { class: 'header-right' },
      seg([['simple', t('mode.simple'), t('shell.mode.simple.help')], ['expert', t('mode.expert'), t('shell.mode.expert.help')]], state.mode, (v) => set({ mode: v }), 'mode-seg'),
      h('button', { class: 'btn btn-sm' + (state.demo ? ' is-on' : ''), type: 'button', title: t('shell.demo.help'), onclick: actions.demo }, icon(state.demo ? 'pause' : 'play', 14), t('shell.demo')),
      seg([['fr', 'FR'], ['en', 'EN']], state.lang, (v) => set({ lang: v }), 'lang-seg'),
      gear,
      h('button', { class: 'iconbtn', type: 'button', title: t('shell.toggleRight'), 'aria-label': t('shell.toggleRight'), onclick: () => set({ rightOpen: !state.rightOpen }) }, icon('info', 20))),
  );
}

// ------------------------------------------------------------------ Bascule des vues (flotte sur la vue centrale)
function renderViewSwitch(host) {
  let el = host.querySelector('.viewswitch');
  if (!el) { el = h('div', { class: 'float viewswitch glass' }); host.append(el); }
  clear(el);
  el.append(h('div', { class: 'seg' }, [['map2d', 'map'], ['globe', 'globe'], ['compare', 'compare']].map(([v, ic]) =>
    h('button', { type: 'button', class: state.view === v ? 'is-on' : '', 'aria-pressed': String(state.view === v), onclick: () => set({ view: v }) }, icon(ic, 15), ' ', h('span', { class: 'vs-label' }, t('view.' + v) + (v === 'compare' && state.compare.length ? ` (${state.compare.length})` : ''))))));
}

export function mountShell({ header, left, right }) {
  const overlays = document.getElementById('main-overlays');
  const redrawHeader = () => renderHeader(header);
  redrawHeader();
  renderViewSwitch(overlays);
  on('change', (keys) => {
    if (keys.some((k) => ['lang', 'mode', 'demo'].includes(k))) redrawHeader();
    if (keys.some((k) => ['lang', 'view', 'compare'].includes(k))) renderViewSwitch(overlays);
  });
  on('compare:replaced', (old) => toast(t('shell.compareReplaced', { name: old?.name || '' }), 'warn'));
  on('change:lang', () => document.querySelector('.popover.settings')?.remove());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.popover.settings')?.remove(); });
  mountLeft(left);
  mountRight(right);
  applyI18n();
  // Première visite : proposer le tutoriel sans l'imposer
  try { if (!localStorage.getItem('rf.welcomed')) { localStorage.setItem('rf.welcomed', '1'); setTimeout(() => toast(t('shell.welcome'), 'info'), 1200); } } catch { /* ignore */ }
}
