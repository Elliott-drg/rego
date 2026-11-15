// Dimensionnement énergétique d'une base lunaire : fenêtre « hypothèses à gauche, résultats à droite ».
// Le calcul est dans science/energy.js (pur) ; ici : saisie, mémorisation, affichage, export.
//
//   import { openEnergy } from './ui/energy.js';   openEnergy();            // site = state.selection
//                                                   openEnergy(selection);   // ou un lieu donné

import { state, set, on, toast } from '../core/store.js';
import { t, num as formatNum, pct, duration, dateUTC, deg } from '../core/i18n.js';
import '../i18n/energy.js';
import { h, clear, provTag, row, button, collapsible, download } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { lineChart } from '../views/charts.js';
import { cat } from '../layers/palettes.js';
import { siteWindow } from '../science/engine.js';
import { LANDING_SITES, SITE_KINDS, siteSelection } from '../data/sites.js';
import { FIELDS, DEFAULTS, STORAGE_PRESETS, ARRAY_CAP_FACTOR, sanitize, computeEnergy, findInvalid, solarProfile, siteInputs, toCsv } from '../science/energy.js';

const STORE_KEY = 'rf.energy';
const NB = '\u00a0';

let raw = null;          // hypothèses en cours de saisie (peuvent sortir des bornes pendant la frappe)
let site = null;         // lieu étudié {key, name, lat, lon, kind}
let opened = null;       // lieu reçu à l'ouverture (reste proposé dans la liste des sites)
let ui = null;           // références DOM de la fenêtre ouverte
let modal = null;        // API de la fenêtre (rerender, close)
let last = null;         // dernier calcul affiché, pour l'export
let engineCache = null;  // éclairement du dernier couple site/période

// ---------------------------------------------------------------------------------------------
// Mémorisation, formats
// ---------------------------------------------------------------------------------------------

function loadValues() {
  try { return sanitize(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')).values; } catch { return { ...DEFAULTS }; }
}
function saveValues(values) { try { localStorage.setItem(STORE_KEY, JSON.stringify(values)); } catch { /* stockage indisponible */ } }

// num() sépare les milliers par une espace fine insécable (U+202F), absente de la police à chasse fixe :
// elle y disparaît (« 10499 »). On la remplace par l'espace insécable ordinaire.
const num = (v, digits) => formatNum(v, digits).replace(/\u202f/g, NB);
/** Nombre écrit avec ses seules décimales utiles (5 -> « 5 », 1.5 -> « 1,5 ») : valeurs par défaut et bornes des champs. */
const plain = (v) => num(v, (String(v).split('.')[1] || '').length);
const join = (pair) => pair.join(NB);
const P = (kW) => (kW >= 1000 ? [num(kW / 1000, 2), 'MW'] : [num(kW, kW < 100 ? 1 : 0), 'kW']);
const Wp = (kW) => (kW >= 1000 ? [num(kW / 1000, 2), t('energy.u.MWp')] : [num(kW, kW > 0 && kW < 100 ? 1 : 0), t('energy.u.kWp')]);
const E = (kWh) => (kWh >= 1e5 ? [num(kWh / 1000, kWh < 1e6 ? 1 : 0), 'MWh'] : [num(kWh, kWh > 0 && kWh < 100 ? 1 : 0), 'kWh']);
const M = (kg) => (kg >= 1000 ? [num(kg / 1000, kg < 1e5 ? 1 : 0), 't'] : [num(kg, 0), 'kg']);
const A = (m2) => [num(m2, m2 < 100 ? 1 : 0), 'm²'];
/** Durée lisible, avec les heures exactes dès que duration() passe en jours. */
const H = (hours) => (hours >= 48 ? `${duration(hours)} (${num(hours, 0)}${NB}h)` : duration(hours));
const hoursOnly = (hours) => `${num(hours, hours < 10 ? 1 : 0)}${NB}h`;

function coords(lat, lon) {
  return `${deg(Math.abs(lat), 2)}${NB}${t(lat < 0 ? 'energy.c.s' : 'energy.c.n')}, ${deg(Math.abs(lon), 2)}${NB}${t(lon < 0 ? 'energy.c.w' : 'energy.c.e')}`;
}
const siteName = (s) => s.name || coords(s.lat, s.lon);
/** Pluriel : à partir de 2 en français (« 0 jour », « 1 jour », « 2 jours »), tout sauf 1 en anglais. */
const many = (n) => (state.lang === 'fr' ? n >= 2 : n !== 1);
const units = (n) => t(many(n) ? 'energy.units.many' : 'energy.units.one');
const days = (n) => `${num(n, 0)}${NB}${t(many(n) ? 'energy.days.many' : 'energy.days.one')}`;
/** Deux-points selon la langue (espace insécable avant, en français). */
const colon = () => (state.lang === 'fr' ? `${NB}: ` : ': ');
/** Borne haute « ronde » d'un axe gradué en quatre intervalles (ex. 10 499 -> 12 000, graduations tous les 3 000). */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v / 4));
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (4 * m * p >= v) return 4 * m * p;
  return 40 * p;
}

// ---------------------------------------------------------------------------------------------
// Éclairement du site (moteur)
// ---------------------------------------------------------------------------------------------

function engineKey() {
  const bucket = raw.period === 'year' ? new Date(state.timeMs).getUTCFullYear() : Math.floor(state.timeMs / 86400e3);   // comme siteWindow
  return `${site.lat.toFixed(5)},${site.lon.toFixed(5)}|${raw.period}|${bucket}|${state.params.mastM}|${state.params.earthMarginDeg}`;
}
/** Indicateurs et profil du site pour la période choisie ; `ok: false` si le moteur ne peut pas répondre. */
function engineData() {
  if (!site) return null;
  const key = engineKey();
  if (engineCache?.key === key) return engineCache;
  let data = { key, ok: false };
  try {
    const win = siteWindow(site, raw.period);
    const inputs = siteInputs(win.metrics, solarProfile(win.series));
    data = { key, ok: true, inputs, t0Ms: win.t0Ms, spanMs: win.spanMs, terrain: !!win.series.horizon?.terrain };
  } catch (e) { console.warn('[energy] éclairement indisponible :', e); }
  engineCache = data;
  return data;
}

// ---------------------------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------------------------

/**
 * Ouvre le module pour un lieu (par défaut la sélection courante).
 * @param {{key?:string, name?:string, lat:number, lon:number, kind?:string}|null} [selection]
 */
export function openEnergy(selection = state.selection) {
  const valid = selection && Number.isFinite(selection.lat) && Number.isFinite(selection.lon);
  site = opened = valid ? { key: selection.key || `pt:${selection.lat.toFixed(4)},${selection.lon.toFixed(4)}`, name: selection.name, lat: selection.lat, lon: selection.lon, kind: selection.kind || 'point' } : null;
  raw = loadValues();
  const offs = [
    on('change:mode', () => modal?.rerender()),
    on('change:cvd', () => refresh()),
    on('change:params', () => { engineCache = null; refresh(); }),
  ];
  modal = openModal({ id: 'energy', wide: true, title: () => t('energy.title'), render, onClose: () => { offs.forEach((off) => off()); modal = ui = last = null; } });
}

function render(body) {
  const expert = state.mode === 'expert';
  ui = { expert, fields: {}, openFormula: ui?.openFormula || null };
  const modeBtn = (m) => h('button', { type: 'button', class: state.mode === m ? 'is-on' : '', 'aria-pressed': String(state.mode === m), dataset: { mode: m }, onclick: () => set({ mode: m }) }, t('mode.' + m));
  ui.siteData = h('div', { class: 'en-sitedata' });
  ui.results = h('div', { class: 'en-results', 'aria-live': 'polite', dataset: { ready: '0' } });
  body.append(h('div', { class: 'en' },
    h('p', { class: 'note note-warn en-banner' }, icon('warn'), h('span', {}, t('energy.banner'))),
    h('div', { class: 'en-bar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': t('energy.modeLabel') }, modeBtn('simple'), modeBtn('expert')),
      h('div', { class: 'en-actions' },
        button(t('energy.reset'), reset, { icon: 'refresh', small: true }),
        button(t('energy.exportCsv'), () => exportReport('csv'), { icon: 'download', small: true, title: t('energy.exportCsv.title') }),
        button(t('energy.exportJson'), () => exportReport('json'), { icon: 'download', small: true, title: t('energy.exportJson.title') }))),
    h('div', { class: 'en-grid' }, h('div', { class: 'en-form' }, expert ? expertForm() : simpleForm()), ui.results)));
  refresh();
}

/** Recalcule et réaffiche. Le premier calcul d'un site (≈ 0,3 s) est différé pour laisser la fenêtre s'afficher. */
function refresh() {
  if (!ui) return;
  if (site && engineCache?.key !== engineKey()) {
    ui.results.dataset.ready = '0';
    clear(ui.results).append(h('p', { class: 'empty' }, t('energy.loading')));
    clear(ui.siteData);
    const target = ui;
    setTimeout(() => { if (ui === target) { engineData(); draw(); } }, 30);
    return;
  }
  draw();
}

function draw() {
  const eng = engineData();
  let result = computeEnergy(raw, eng?.ok ? eng.inputs : null);
  // Contrôle de cohérence : un indicateur illisible du moteur ne doit jamais donner un résultat négatif ou NaN
  const invalid = findInvalid(result);
  if (invalid.length) { console.warn('[energy] résultat incohérent, éclairement écarté :', invalid.slice(0, 5)); result = computeEnergy(raw, null); }
  saveValues(result.inputs);
  last = { result, eng: invalid.length ? { ...eng, ok: false } : eng, site };
  for (const [id, f] of Object.entries(ui.fields)) {
    const out = result.clamped.includes(id);
    f.input.setAttribute('aria-invalid', String(out));
    if (!f.warn) continue;
    // Champ vidé : la valeur par défaut est utilisée ; valeur hors bornes : la borne la plus proche
    f.warn.textContent = out ? ' ' + (Number.isFinite(raw[id]) ? f.bounded : f.emptied) : '';
    f.warn.classList.toggle('hidden', !out);
  }
  drawSiteData(last);
  drawResults(last);
  ui.results.dataset.ready = '1';
}

// ---------------------------------------------------------------------------------------------
// Hypothèses (colonne de gauche)
// ---------------------------------------------------------------------------------------------

const hypTag = () => provTag('hypothesis', t('energy.hyp.help'));

/** Champ numérique borné : libellé + étiquette « hypothèse », valeur, unité, justification et valeur par défaut. */
function numberField(id, opts = {}) {
  const f = FIELDS[id];
  const input = h('input', { class: 'input en-num', type: 'number', id: 'en-f-' + id, min: f.min, max: f.max, step: f.step, value: sanitize(raw).values[id], inputmode: 'decimal', 'aria-describedby': 'en-n-' + id, disabled: opts.disabled });
  const warn = h('span', { class: 'en-bound hidden' });
  input.addEventListener('input', () => { raw[id] = input.value === '' ? NaN : Number(input.value); opts.onEdit?.(); refresh(); });
  // En quittant le champ, la valeur réellement utilisée (bornée) est réécrite
  input.addEventListener('change', () => { raw[id] = sanitize(raw).values[id]; input.value = String(raw[id]); refresh(); });
  ui.fields[id] = { input, warn, bounded: t('energy.bounded', { min: plain(f.min), max: plain(f.max) }), emptied: t('energy.emptied', { v: plain(f.def) }) };
  return h('div', { class: 'en-field' },
    h('label', { class: 'en-field-l', for: 'en-f-' + id }, t('energy.f.' + id), ' ', hypTag()),
    h('span', { class: 'en-field-c' }, input, h('span', { class: 'en-unit mono' }, t('energy.u.' + id))),
    h('p', { class: 'en-field-n', id: 'en-n-' + id }, t('energy.why.' + id), ' ', h('span', { class: 'dim' }, t('energy.default', { v: plain(f.def) })), warn));
}

/** Curseur (équipage, mode survie) avec sa valeur en clair. */
function rangeField(id, format) {
  const f = FIELDS[id], value = sanitize(raw).values[id];
  const out = h('output', { class: 'en-range-v', for: 'en-f-' + id }, format(value));
  const input = h('input', { type: 'range', id: 'en-f-' + id, min: f.min, max: f.max, step: f.step, value, 'aria-valuetext': format(value), 'aria-describedby': 'en-n-' + id });
  input.addEventListener('input', () => { raw[id] = Number(input.value); out.textContent = format(raw[id]); input.setAttribute('aria-valuetext', format(raw[id])); refresh(); });
  ui.fields[id] = { input };
  return h('div', { class: 'en-field en-field-range' },
    h('label', { class: 'en-field-l', for: 'en-f-' + id }, t('energy.f.' + id), ' ', hypTag()),
    out,
    h('span', { class: 'en-range' }, h('span', { class: 'mono dim' }, num(f.min, 0)), input, h('span', { class: 'mono dim' }, num(f.max, 0))),
    h('p', { class: 'en-field-n', id: 'en-n-' + id }, t('energy.why.' + id), ' ', h('span', { class: 'dim' }, t('energy.default', { v: format(f.def) }))));
}
const crewField = () => rangeField('crew', (v) => `${num(v, 0)}${NB}${t('energy.u.crew')}`);
const survivalField = () => rangeField('survivalPct', (v) => pct(v, 0));

/** Choix exclusif (type de panneau, période, préréglage) ; `onPick` applique le choix. `tagged` : étiqueté « hypothèse ». */
function choice(label, options, current, onPick, tagged = true) {
  const seg = h('div', { class: 'seg en-seg', role: 'group', 'aria-label': label });
  const paint = (value) => { for (const b of seg.children) { const on_ = b.dataset.v === value; b.classList.toggle('is-on', on_); b.setAttribute('aria-pressed', String(on_)); } };
  for (const [value, text] of options) seg.append(h('button', { type: 'button', dataset: { v: value }, onclick: () => { paint(value); onPick(value); } }, text));
  paint(current);
  return { el: h('div', { class: 'en-choice' }, h('span', { class: 'en-field-l' }, label, tagged ? [' ', hypTag()] : null), seg), paint };
}

function siteField() {
  const known = LANDING_SITES.map(siteSelection), byKey = new Map(known.map((s) => [s.key, s]));
  const select = h('select', { class: 'input en-site', id: 'en-site' });
  if (!site) select.append(h('option', { value: '', selected: true }, t('energy.site.choose')));
  if (opened && !byKey.has(opened.key)) { byKey.set(opened.key, opened); select.append(h('option', { value: opened.key }, `${siteName(opened)} — ${t('energy.site.current')}`)); }
  for (const kind of SITE_KINDS) {
    const list = known.filter((s) => s.kind === kind);
    if (list.length) select.append(h('optgroup', { label: t('kind.' + kind) }, list.map((s) => h('option', { value: s.key }, s.name))));
  }
  if (site) select.value = site.key;
  select.addEventListener('change', () => { site = byKey.get(select.value) || null; ui.openFormula = null; refresh(); });
  return h('div', { class: 'en-field en-field-site' }, h('label', { class: 'en-field-l', for: 'en-site' }, t('energy.site')), select);
}

const group = (id, ...children) => h('section', { class: 'en-group', dataset: { group: id } }, h('h3', { class: 'en-group-t' }, t('energy.g.' + id)), children);
const fold = (id, ...children) => { const d = collapsible('energy.' + id, t('energy.g.' + id), children, true); d.classList.add('en-fold'); d.dataset.group = id; return d; };

function simpleForm() {
  return [
    group('site', siteField(), ui.siteData),
    group('crew', crewField()),
    h('section', { class: 'en-group', dataset: { group: 'survival' } }, h('h3', { class: 'en-group-t' }, t('energy.survival.title')), survivalField()),
    h('p', { class: 'en-hint' }, icon('info'), h('span', {}, t('energy.simpleHint'))),
  ];
}

function expertForm() {
  // La période est un choix d'analyse, pas une hypothèse physique : pas d'étiquette
  const period = choice(t('energy.period'), [['year', t('energy.period.year')], ['lunarDay', t('energy.period.lunarDay')]], raw.period, (v) => { raw.period = v; refresh(); }, false);
  const nightField = numberField('nightOverrideH', { disabled: !raw.nightOverride });
  const override = h('input', { type: 'checkbox', id: 'en-override', checked: raw.nightOverride });
  override.addEventListener('change', () => { raw.nightOverride = override.checked; ui.fields.nightOverrideH.input.disabled = !override.checked; refresh(); });

  // Préréglages de stockage : ils remplissent trois champs ; une retouche manuelle fait passer en « personnalisé »
  const presetNote = h('span', { class: 'en-preset-custom dim' });
  const paintPreset = () => { preset.paint(raw.storagePreset); presetNote.textContent = raw.storagePreset === 'custom' ? t('energy.preset.custom') : ''; };
  const preset = choice(t('energy.preset'), [['liion', t('energy.preset.liion')], ['rfc', t('energy.preset.rfc')]], raw.storagePreset, (v) => {
    Object.assign(raw, STORAGE_PRESETS[v], { storagePreset: v });
    for (const id of Object.keys(STORAGE_PRESETS[v])) ui.fields[id].input.value = String(raw[id]);
    paintPreset(); refresh();
  });
  const custom = { onEdit: () => { raw.storagePreset = 'custom'; paintPreset(); } };
  preset.el.append(presetNote); presetNote.textContent = raw.storagePreset === 'custom' ? t('energy.preset.custom') : '';

  const panel = choice(t('energy.panelType'), [['vertical', t('energy.panel.vertical')], ['horizontal', t('energy.panel.horizontal')]], raw.panelType, (v) => { raw.panelType = v; refresh(); });

  return [
    fold('site', siteField(), period.el, ui.siteData,
      h('label', { class: 'check en-check', for: 'en-override' }, override, h('span', {}, t('energy.night.override'))),
      nightField, h('p', { class: 'en-field-n' }, t('energy.night.overrideNote'))),
    fold('crew', crewField(), numberField('missionDays')),
    fold('loads', h('p', { class: 'en-group-n' }, t('energy.g.loadsNote')),
      ['lifeSupportKWpp', 'habitatKW', 'scienceKW', 'mobilityKW', 'commsKW', 'isruKW', 'peakFactor'].map((id) => numberField(id)), survivalField()),
    fold('storage', preset.el, h('p', { class: 'en-group-n' }, t('energy.g.storageNote')),
      ['roundTripPct', 'dodPct', 'specificEnergyWhKg'].map((id) => numberField(id, custom)), numberField('marginPct'), numberField('hybridBufferH')),
    fold('solar', panel.el, h('p', { class: 'en-field-n' }, t('energy.panelType.why')),
      ['cellEffPct', 'degradationPct', 'pmadEffPct', 'arealMassKgM2', 'solarConstantWM2'].map((id) => numberField(id))),
    fold('fission', h('p', { class: 'en-group-n' }, icon('warn'), ' ', t('energy.g.fissionNote')),
      ['fissionUnitKWe', 'fissionUnitMassKg', 'fissionSpare'].map((id) => numberField(id))),
  ];
}

/** Impose une durée de nuit (ou revient à la nuit calculée) et reconstruit le formulaire. */
function setNightOverride(hours) {
  raw.nightOverride = hours !== null;
  if (hours !== null) raw.nightOverrideH = hours;
  modal.rerender();
}

/** Valeurs du moteur pour le site (étiquetées « calculé »), sous le choix du site. */
function drawSiteData({ result, eng }) {
  const box = clear(ui.siteData);
  if (!site) return;
  box.append(h('p', { class: 'en-coords mono' }, coords(site.lat, site.lon)));
  if (!eng?.ok) { box.append(h('p', { class: 'note note-warn' }, t('energy.e.unavailable'))); return; }
  const s = eng.inputs, c = { prov: 'computed' };
  // La nuit du moteur est sa durée réelle : on dit quand elle déborde de la période, et quand aucune fin n'a été trouvée
  const nightNote = s.nightCensored ? t('energy.e.nightCensored')
    : s.nightBeyondWindow ? t('energy.e.nightBeyond', { h: H(s.longestNightInWindowH) }) : null;
  box.append(
    h('p', { class: 'en-period' }, t('energy.period'), colon(), t('energy.period.range', { a: dateUTC(eng.t0Ms, false), b: dateUTC(eng.t0Ms + eng.spanMs, false) })),
    row(t('energy.e.sunPct'), pct(s.sunPct, 1), { ...c, provTitle: t('energy.e.sunPct.help') }),
    row(t('energy.e.night'), (s.nightCensored ? t('energy.atLeast') : '') + H(s.longestNightH), { ...c, provTitle: t('energy.e.night.help'), note: nightNote }));
  if (ui.expert) {
    box.append(
      row(t('energy.e.day'), H(s.longestDayH), c),
      row(t('energy.e.vertical'), pct(s.powerVerticalPct, 1), { ...c, provTitle: t('energy.e.rel.help') }),
      row(t('energy.e.horizontal'), pct(s.powerHorizontalPct, 1), { ...c, provTitle: t('energy.e.rel.help') }));
  }
  // En mode simplifié, la case « imposer » et son champ ne sont pas affichés : la nuit imposée est rappelée ici, avec le retour en arrière
  if (result.night.source === 'override' && !ui.expert) {
    box.append(row(t('energy.f.nightOverrideH'), H(result.night.hours), { prov: 'hypothesis', provTitle: t('energy.hyp.help') }),
      h('p', { class: 'en-inline-action' }, button(t('energy.night.back'), () => setNightOverride(null), { small: true })));
  }
  if (!eng.terrain) box.append(h('p', { class: 'note en-note' }, t('energy.e.noRelief')));
  if (result.warnings.includes('noSun')) box.append(h('p', { class: 'note note-warn en-note', dataset: { warn: 'noSun' } }, icon('warn'), ' ', t('energy.warn.censored')));
}

// ---------------------------------------------------------------------------------------------
// Résultats (colonne de droite)
// ---------------------------------------------------------------------------------------------

/** Texte de la formule chiffrée de chaque résultat (affiché au survol et au clic). */
function formulas(r) {
  const a = r.inputs, L = r.loads, S = r.storage, so = r.solar, fx = {};
  const frac = (p) => num(p / 100, 2), kWe = (v) => `${num(v, 0)}${NB}kWe`;
  fx.daily = t('energy.fx.daily', { avg: join(P(L.avgKW)), v: join(E(L.dailyKWh)) });
  fx.avg = t('energy.fx.avg', { crew: num(a.crew, 0), ls: num(a.lifeSupportKWpp, 1), hab: num(a.habitatKW, 1), sci: num(a.scienceKW, 1), mob: num(a.mobilityKW, 1), com: num(a.commsKW, 1), isru: num(a.isruKW, 1), v: join(P(L.avgKW)), kp: num(a.peakFactor, 2), peak: join(P(L.peakKW)) });
  if (S) {
    fx.night = t('energy.fx.night', { s: frac(a.survivalPct), avg: join(P(L.avgKW)), pn: join(P(L.nightKW)), tn: hoursOnly(r.night.hours), v: join(E(S.nightEnergyKWh)) });
    fx.storage = t(S.governs === 'buffer' ? 'energy.fx.storageBuffer' : 'energy.fx.storage', {
      rt: frac(a.roundTripPct), etad: num(S.etaD, 3), en: join(E(S.nightEnergyKWh)), buf: join(E(S.bufferKWh)), tb: hoursOnly(a.hybridBufferH), avg: join(P(L.avgKW)),
      dod: frac(a.dodPct), m: frac(a.marginPct), v: join(E(S.capacityKWh)), se: `${num(a.specificEnergyWhKg, 0)}${NB}Wh/kg`, mass: join(M(S.massKg)),
    });
  }
  if (so.feasible) {
    fx.recharge = t('energy.fx.recharge', { kwp: join(Wp(so.installedKWp)), dg: frac(a.degradationPct), pm: frac(a.pmadEffPct), avg: join(P(L.avgKW)), v: join(P(so.rechargeKW)) })
      + (so.rechargeHours === null ? '' : '\n' + t('energy.fx.rechargeHours', { en: join(E(S.nightEnergyKWh)), rt: frac(a.roundTripPct), v: join(P(so.rechargeKW)), hours: H(so.rechargeHours) }));
    fx.solar = t('energy.fx.solar', { cap: join(Wp(so.capKWp)), factor: num(ARRAY_CAP_FACTOR, 0), v: join(Wp(so.installedKWp)), S: `${num(a.solarConstantWM2, 0)}${NB}W/m²`, cell: frac(a.cellEffPct), area: join(A(so.areaM2)), mu: `${num(a.arealMassKgM2, 1)}${NB}kg/m²`, mass: join(M(so.massKg)) });
  }
  for (const x of r.architectures) {
    if (!x.feasible) continue;
    if (x.id === 'solar') fx.archSolar = t('energy.fx.archSolar', { a: join(M(x.parts.solarKg)), b: join(M(x.parts.storageKg)), v: join(M(x.massKg)) });
    if (x.id === 'fission') fx.archFission = t('energy.fx.archFission', { peak: join(P(L.peakKW)), pu: kWe(a.fissionUnitKWe), spare: num(a.fissionSpare, 0), n: num(x.units, 0), p: kWe(x.fissionKW), mu: join(M(a.fissionUnitMassKg)), v: join(M(x.massKg)) });
    if (x.id === 'hybrid') fx.archHybrid = t('energy.fx.archHybrid', { pn: join(P(L.nightKW)), pu: kWe(a.fissionUnitKWe), n: num(x.units, 0), sol: join(Wp(x.solarKWp)), tb: hoursOnly(a.hybridBufferH), buf: join(E(x.storageKWh)), mf: join(M(x.parts.fissionKg)), ms: join(M(x.parts.solarKg)), mb: join(M(x.parts.storageKg)), v: join(M(x.massKg)) });
  }
  return fx;
}

/**
 * Zone qui affiche la formule du résultat cliqué ; un second clic sur le même résultat la referme.
 * `lookup(id)` donne {name, text}. La formule ouverte avant un recalcul est rouverte avec les nouveaux chiffres.
 */
function formulaBox(scope, lookup) {
  const box = h('div', { class: 'en-formula hidden', role: 'region', dataset: { scope } });
  const open = (id) => {
    const { name, text } = lookup(id);
    if (!text) { box.classList.add('hidden'); ui.openFormula = null; return; }
    ui.openFormula = { scope, id };
    clear(box).append(h('div', { class: 'en-formula-t' }, t('energy.r.formulaOf', { name })), h('pre', { class: 'en-formula-x mono' }, text));
    box.classList.remove('hidden');
  };
  const toggle = (id) => {
    if (ui.openFormula?.scope === scope && ui.openFormula.id === id) { box.classList.add('hidden'); ui.openFormula = null; } else open(id);
  };
  if (ui.openFormula?.scope === scope) open(ui.openFormula.id);
  return { box, toggle };
}

/** Phrase du verdict d'un rejeu en déficit ou non tenable (formulation neutre : ni le stockage ni les panneaux seuls). */
function shortfallText(check) {
  return check.deficitDays > 0 || check.hasDeficit
    ? t('energy.bal.bad', { days: days(check.deficitDays), n: num(check.days, 0) })
    : t('energy.bal.drain');
}

function drawResults({ result: r }) {
  const el = clear(ui.results), fx = formulas(r), expert = ui.expert, a = r.inputs, L = r.loads, S = r.storage, so = r.solar;
  if (!site) el.append(h('p', { class: 'note note-info', dataset: { state: 'nosite' } }, t('energy.site.none')));
  if (r.clamped.length) el.append(h('p', { class: 'note note-warn' }, t('energy.warn.clamped')));
  if (r.warnings.includes('panelPoor')) el.append(h('p', { class: 'note note-warn' }, t('energy.warn.panelPoor', { x: num(r.site.powerVerticalPct / Math.max(r.site.powerHorizontalPct, 0.01), 0) })));

  // --- Tuiles ---
  const tilesFx = formulaBox('tiles', (id) => ({ name: t('energy.r.' + id), text: fx[id] }));
  const na = [t('energy.r.na'), ''];
  const tile = (id, iconName, value, sub) => h('button', { type: 'button', class: 'stat en-tile', title: fx[id] || null, dataset: { res: id }, onclick: () => tilesFx.toggle(id) },
    h('span', { class: 'stat-label' }, icon(iconName), h('span', {}, t('energy.r.' + id)), provTag('model')),
    h('span', { class: 'stat-value' + (value === na ? ' en-na' : '') }, value[0], value[1] ? h('small', {}, NB + value[1]) : null),
    sub ? h('span', { class: 'stat-sub' }, sub) : null);
  // Ombre sans fin trouvée : la durée de nuit est un minorant, tout ce qui en découle aussi
  const least = r.night.censored ? t('energy.atLeast') : '';
  const lead = (pair) => [least + pair[0], pair[1]];
  const nightSub = () => t(r.night.source === 'override' ? 'energy.r.night.subOverride' : r.night.censored ? 'energy.r.night.subCensored' : r.night.beyondWindow ? 'energy.r.night.subBeyond' : 'energy.r.night.sub', { night: H(r.night.hours), pn: join(P(L.nightKW)) });
  const storageSub = () => (S.governs === 'buffer'
    ? t('energy.r.storage.subBuffer', { mass: join(M(S.massKg)), h: hoursOnly(a.hybridBufferH) })
    : t('energy.r.storage.sub', { mass: (least || '≈ ') + join(M(S.massKg)), m: pct(a.marginPct, 0) }));
  const tiles = [
    tile('daily', 'bolt', [num(L.dailyKWh, L.dailyKWh < 100 ? 1 : 0), t('energy.u.perDay')], t('energy.r.daily.sub', { days: days(a.missionDays), total: join(E(L.missionKWh)) })),
    tile('avg', 'users', P(L.avgKW), t('energy.r.avg.sub', { peak: join(P(L.peakKW)), k: num(a.peakFactor, 2) })),
    tile('night', 'moon', S ? lead(E(S.nightEnergyKWh)) : na, S ? nightSub() : null),
    tile('storage', 'battery', S ? lead(E(S.capacityKWh)) : na, S ? storageSub() : null),
  ];
  if (expert) {
    tiles.push(
      tile('recharge', 'refresh', so.feasible ? P(so.rechargeKW) : na,
        so.feasible ? (so.rechargeHours === null ? t('energy.r.recharge.subNone') : t('energy.r.recharge.sub', { h: H(so.rechargeHours) })) : null),
      tile('solar', 'sun', so.feasible ? Wp(so.installedKWp) : na, so.feasible ? t('energy.r.solar.sub', { area: join(A(so.areaM2)), mass: join(M(so.massKg)) }) : t('energy.arch.block.' + so.block)));
  }
  el.append(h('div', { class: 'en-tiles', dataset: { n: String(tiles.length) } }, tiles), h('p', { class: 'en-clickhint dim' }, t('energy.r.clickHint')), tilesFx.box);

  // --- Niveau du stockage ---
  el.append(chartCard(r));

  // --- Verdict du rejeu heure par heure (architecture solaire + stockage) ---
  const B = r.balance, D = so.diagnosis;
  if (B) {
    el.append(h('p', { class: 'note en-verdict note-info', dataset: { verdict: 'ok' } }, icon('check'), h('span', {},
      t('energy.bal.ok'), ' ', t('energy.bal.reserve', { r: pct(B.reserveMinPct ?? 0, 0), m: pct(S.marginPlannedPct, 0) }))));
  } else if (D) {
    el.append(h('div', { class: 'note en-verdict note-warn', dataset: { verdict: 'notViable' } }, icon('warn'), h('div', {},
      h('p', {}, t('energy.bal.notViable', { night: H(r.night.hours), cap: join(Wp(D.capKWp)), factor: num(ARRAY_CAP_FACTOR, 0) }), ' ', shortfallText(D)),
      D.equivalentNightH === null ? null : h('p', {}, t('energy.bal.needs', { req: join(E(D.requiredCapacityKWh)), eq: H(D.equivalentNightH) })),
      D.suggestedNightH === null ? null : h('p', { class: 'en-inline-action' },
        button(t('energy.bal.apply', { h: hoursOnly(D.suggestedNightH) }), () => setNightOverride(D.suggestedNightH), { small: true, kind: 'primary' })))));
  }
  if (expert) {
    const m = { prov: 'model' }, period = B ? num(Math.round(B.hours / 24), 0) : null;
    el.append(h('section', { class: 'card en-card', dataset: { block: 'balance' } },
      h('h3', { class: 'card-title' }, t('energy.bal.title')),
      B ? [
        h('p', { class: 'en-field-n' }, t('energy.bal.intro')),
        row(t('energy.bal.possible'), join(E(B.possibleKWh)), m), row(t('energy.bal.need'), join(E(B.needKWh)), m),
        row(t('energy.bal.unserved'), join(E(B.unservedKWh)), m), row(t('energy.bal.deficitDays'), t('energy.bal.deficitValue', { d: num(B.deficitDays, 0), n: period }), m),
        row(t('energy.bal.curtailed'), join(E(B.curtailedKWh)), m), row(t('energy.bal.losses'), join(E(B.lossesKWh)), m),
        row(t('energy.bal.delta'), `${B.deltaStoreKWh < 0 ? '−' : '+'}${join(E(Math.abs(B.deltaStoreKWh)))}`, m),
        row(t('energy.bal.reserveRow'), pct(B.reserveMinPct ?? 0, 1), { ...m, note: t('energy.bal.reserveNote', { m: pct(S.marginPlannedPct, 1) }) }),
        row(t('energy.bal.required'), join(E(B.requiredCapacityKWh)), { ...m, note: t('energy.bal.requiredNote', { c: join(E(S.capacityKWh)), h: B.equivalentNightH === null ? '—' : H(B.equivalentNightH) }) }),
      ] : D ? [
        h('p', { class: 'en-field-n' }, t('energy.bal.introCap', { cap: join(Wp(D.capKWp)) })),
        row(t('energy.bal.need'), join(E(D.needKWh)), m), row(t('energy.bal.unserved'), join(E(D.unservedKWh)), m),
        row(t('energy.bal.deficitDays'), t('energy.bal.deficitValue', { d: num(D.deficitDays, 0), n: num(D.days, 0) }), m),
        row(t('energy.bal.required'), join(E(D.requiredCapacityKWh)), { ...m, strong: true, note: t('energy.bal.requiredNote', { c: join(E(S.capacityKWh)), h: D.equivalentNightH === null ? '—' : H(D.equivalentNightH) }) }),
      ] : h('p', { class: 'en-field-n' }, t('energy.bal.none'))));
  }

  // --- Architectures ---
  el.append(archBlock(r, fx));

  // --- Lecture ---
  el.append(h('section', { class: 'en-read', dataset: { block: 'read' } }, h('h3', { class: 'en-block-t' }, t('energy.read.title')), reading(r).map((p) => h('p', {}, p))));

  // --- Méthode ---
  const part = (title, formula, note) => [h('h4', { class: 'en-method-t' }, title), formula ? h('pre', { class: 'en-formula-x mono' }, formula) : null, note ? h('p', {}, note) : null];
  const method = collapsible('energy.method', t('energy.method.title'), h('div', { class: 'en-method' },
    h('p', {}, t('energy.method.intro')),
    part(t('energy.method.loads'), t('energy.method.loads.f')),
    part(t('energy.method.storage'), t('energy.method.storage.f'), t('energy.method.storage.note')),
    part(t('energy.method.solar'), t('energy.method.solar.f'), t('energy.method.solar.note', { factor: num(ARRAY_CAP_FACTOR, 0) })),
    h('p', { class: 'note note-info' }, t('energy.method.once')),
    part(t('energy.method.balance'), null, t('energy.method.balance.note')),
    part(t('energy.method.arch'), t('energy.method.arch.f'), t('energy.arch.criteria')),
    h('p', {}, t('energy.method.limits'))), false);
  method.classList.add('en-fold'); method.dataset.block = 'method';
  el.append(method);
}

function chartCard(r) {
  const tl = r.timeline, card = h('section', { class: 'card en-card', dataset: { block: 'chart' } }, h('h3', { class: 'card-title' }, icon('battery'), h('span', {}, t('energy.chart.title')), provTag('model')));
  if (!tl) { card.append(h('p', { class: 'en-field-n' }, t(r.storage ? 'energy.chart.noNight' : 'energy.chart.none'))); return card; }
  const big = tl.capacityKWh >= 1e5, k = big ? 1e-3 : 1, unit = big ? 'MWh' : 'kWh', top = niceMax(tl.capacityKWh * k);
  const scale = (pts) => pts.map(([x, y]) => [x, y * k]);
  const narrow = window.innerWidth < 700, ideal = tl.kind === 'ideal';
  const series = [
    { name: t('energy.chart.night'), color: cat('a', state.cvd), points: scale(tl.night), dash: '', width: 2.2 },
    { name: t('energy.chart.day'), color: cat('sun', state.cvd), points: scale(tl.day), dash: '6 4', width: 2.2 },
  ].filter((se) => se.points.length > 1);
  const xEnd = Math.max(...series.map((se) => se.points[se.points.length - 1][0]));
  // Deux repères : la limite de décharge, et le seuil sous lequel la marge de sécurité est entamée (s'il y a une marge)
  const hlines = [{ y: tl.floorKWh * k, color: cat('bad', state.cvd), label: t('energy.chart.floor') }];
  if (tl.marginLineKWh - tl.floorKWh > 0.02 * tl.capacityKWh) hlines.push({ y: tl.marginLineKWh * k, color: cat('warn', state.cvd), label: t('energy.chart.margin') });
  const svg = lineChart(series, {
    width: narrow ? 360 : 640, height: narrow ? 220 : 230, xMin: 0, xMax: niceMax(xEnd), yMin: 0, yMax: top,
    xLabel: t('energy.chart.x'), xFormat: (v) => num(v, 0), yFormat: (v) => num(v, top < 10 ? 1 : 0), hlines,
  });
  svg.setAttribute('aria-label', t('energy.chart.title'));
  card.append(h('p', { class: 'en-chart-y' }, t('energy.chart.y', { unit })), svg,
    h('div', { class: 'chart-legend' }, series.map((se) => h('span', {}, h('i', { style: { borderTopColor: se.color, borderTopStyle: se.dash ? 'dashed' : 'solid' } }), se.name))),
    h('p', { class: 'en-field-n' }, t(ideal ? 'energy.chart.ideal' : 'energy.chart.simulated'), r.night.beyondWindow && !ideal ? ' ' + t('energy.chart.beyond') : ''));
  return card;
}

function archBlock(r, fx) {
  const a = r.inputs, fxKey = (id) => 'arch' + id[0].toUpperCase() + id.slice(1);
  const archFx = formulaBox('arch', (id) => ({ name: t('energy.arch.' + id), text: fx[fxKey(id)] }));
  const valueBtn = (x, ...content) => h('button', { type: 'button', class: 'en-val', title: fx[fxKey(x.id)] || null, onclick: () => archFx.toggle(x.id) }, content);
  const kWe = (v) => `${num(v, v < 100 && v % 1 ? 1 : 0)}${NB}kWe`;
  // Puissance installée, toujours avec son unité : kWc pour les panneaux, kWe pour les réacteurs
  const power = {
    solar: (x) => [join(Wp(x.solarKWp))],
    fission: (x) => [kWe(x.fissionKW)],
    hybrid: (x) => [kWe(x.fissionKW), h('span', { class: 'en-plus' }, ` + ${join(Wp(x.solarKWp))}`)],
  };
  const desc = {
    solar: (x) => t('energy.arch.solar.desc', { area: join(A((x.solarKWp * 1000) / (a.solarConstantWM2 * (a.cellEffPct / 100)))) }),
    fission: (x) => t('energy.arch.fission.desc', { n: num(x.units, 0), units: units(x.units), pu: num(a.fissionUnitKWe, 0), spare: num(x.spare, 0) }),
    hybrid: (x) => t('energy.arch.hybrid.desc', { n: num(x.units, 0), units: units(x.units), pu: num(a.fissionUnitKWe, 0), kwp: join(Wp(x.solarKWp)) }),
  };
  const feasible = r.architectures.filter((x) => x.feasible);
  const rows = r.architectures.map((x) => {
    const name = h('th', { scope: 'row', class: 'en-arch-n' }, h('span', { class: 'en-arch-name' }, t('energy.arch.' + x.id)),
      x.feasible ? h('span', { class: 'en-arch-d' }, desc[x.id](x)) : null,
      x.id !== 'solar' ? h('span', { class: 'en-arch-d en-arch-c' }, t('energy.arch.concept')) : null);
    if (!x.feasible) return h('tr', { dataset: { arch: x.id, feasible: '0' } }, name, h('td', { colspan: 3, class: 'en-arch-no' }, t('energy.arch.impossible'), colon(), t('energy.arch.block.' + x.block), '.'));
    // Même verdict pour toutes : la période rejouée heure par heure avec les tailles affichées
    const check = x.check, best = r.bestMassId === x.id;
    const verdict = !check ? h('span', { class: 'en-arch-d', dataset: { check: 'none' } }, t('energy.arch.unchecked'))
      : check.ok ? h('span', { class: 'en-arch-d', dataset: { check: 'ok' } }, t('energy.arch.checkOk'))
        : h('span', { class: 'en-deficit', dataset: { check: 'bad' } }, check.deficitDays > 0 || check.hasDeficit ? t('energy.arch.deficit', { days: days(check.deficitDays) }) : t('energy.arch.drain'));
    return h('tr', { dataset: { arch: x.id, feasible: '1', best: best ? '1' : '0' }, class: best ? 'en-row-best' : null }, name,
      h('td', { class: 'num' }, valueBtn(x, power[x.id](x))),
      h('td', { class: 'num' }, valueBtn(x, join(E(x.storageKWh)))),
      h('td', { class: 'num' }, valueBtn(x, join(M(x.massKg))),
        best ? h('span', { class: 'best en-best' }, t(feasible.length === 1 ? 'energy.arch.only' : 'energy.arch.best')) : null, verdict));
  });

  const li = (sign, text) => h('li', { class: sign === '+' ? 'en-pro' : 'en-con' }, h('span', { class: 'en-sign mono', 'aria-hidden': 'true' }, sign), h('span', {}, text));
  const points = feasible.map((x) => {
    const items = [];
    if (x.id === 'solar') {
      items.push(li('+', t('energy.pro.solar.1')), li('+', t('energy.pro.solar.2')));
      if (r.night.hours > 0) items.push(li('−', t('energy.con.solar.1', { night: H(r.night.hours) })));
      if (x.massKg > 0 && x.parts.storageKg > 0) items.push(li('−', t('energy.con.solar.2', { share: pct((100 * x.parts.storageKg) / x.massKg, 0) })));
    } else if (x.id === 'fission') {
      items.push(li('+', t('energy.pro.fission.1')), li('+', t('energy.pro.fission.2')), li('−', t('energy.con.fission.1')),
        li('−', t('energy.con.fission.2', { pu: num(a.fissionUnitKWe, 0), n: num(x.units, 0), units: units(x.units), peak: join(P(r.loads.peakKW)) })), li('−', t('energy.con.fission.3')));
    } else {
      const buf = hoursOnly(a.hybridBufferH);
      items.push(li('+', t('energy.pro.hybrid.1', { h: buf })));
      if (x.dayComplementKW > 0 && x.solarKWp > 0) items.push(li('+', t('energy.pro.hybrid.2', { kw: join(P(x.dayComplementKW)) })));
      else items.push(li('−', t(x.dayComplementKW > 0 ? 'energy.con.hybrid.5' : 'energy.con.hybrid.4', { s: pct(a.survivalPct, 0) })));
      if (x.solarKWp > 0) items.push(li('−', t('energy.con.hybrid.1')));
      items.push(li('−', t('energy.con.hybrid.2', { h: buf })), li('−', t('energy.con.hybrid.3')));
    }
    return h('div', { class: 'en-points', dataset: { arch: x.id } }, h('h4', { class: 'en-method-t' }, t('energy.arch.' + x.id)), h('ul', { 'aria-label': `${t('energy.arch.pros')} / ${t('energy.arch.cons')}` }, items));
  });

  return h('section', { class: 'en-arch', dataset: { block: 'arch' } },
    h('h3', { class: 'en-block-t' }, t('energy.arch.title'), ' ', provTag('model')),
    h('div', { class: 'en-table-wrap' }, h('table', { class: 'table en-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('energy.arch.col')), h('th', { scope: 'col', class: 'num' }, t('energy.arch.power')), h('th', { scope: 'col', class: 'num' }, t('energy.arch.storage')), h('th', { scope: 'col', class: 'num' }, t('energy.arch.mass')))),
      h('tbody', {}, rows))),
    archFx.box,
    h('p', { class: 'en-field-n', dataset: { note: 'criteria' } }, t('energy.arch.criteria')),
    h('p', { class: 'en-field-n' }, t('energy.arch.massNote')),
    h('div', { class: 'en-points-grid' }, points));
}

/** Paragraphe « Lecture du résultat », construit à partir des chiffres du calcul. */
function reading(r) {
  const a = r.inputs, L = r.loads, S = r.storage, B = r.balance, so = r.solar, out = [];
  const first = [];
  if (!site || !r.site) first.push(t('energy.read.noSite'));
  else if (r.site.sunPct <= 0) first.push(t('energy.read.siteNoSun', { site: siteName(site) }));
  else first.push(t(r.site.nightBeyondWindow ? 'energy.read.siteBeyond' : 'energy.read.site', { site: siteName(site), sun: pct(r.site.sunPct, 0), night: H(r.site.longestNightH) }));
  if (r.night.source === 'override') first.push(t('energy.read.siteOverride', { night: H(r.night.hours) }));
  first.push(t('energy.read.load', { crew: num(a.crew, 0), avg: join(P(L.avgKW)), daily: join(E(L.dailyKWh)), ls: join(P(L.items[0].kW)) }));
  out.push(first.join(' '));

  if (S && S.nightEnergyKWh > 0) {
    const vars = { s: pct(a.survivalPct, 0), night: H(r.night.hours), en: join(E(S.nightEnergyKWh)), cap: join(E(S.capacityKWh)), mass: join(M(S.massKg)) };
    // Ombre sans fin trouvée : un minorant ne s'écrit pas comme un besoin
    const second = [t(r.night.censored ? 'energy.read.nightCensored' : 'energy.read.night', vars)];
    const solar = r.architectures[0];
    if (solar.feasible) {
      second.push(t('energy.read.solarOk', { kwp: join(Wp(so.installedKWp)), area: join(A(so.areaM2)), r: pct(B.reserveMinPct ?? 0, 0) }));
      if (solar.massKg > 0) second.push(t('energy.read.share', { share: pct((100 * solar.parts.storageKg) / solar.massKg, 0) }));
    } else if (so.diagnosis) {
      const D = so.diagnosis;
      second.push(t('energy.read.notViable', { factor: num(ARRAY_CAP_FACTOR, 0) }));
      if (D.equivalentNightH !== null) second.push(t('energy.read.needs', { req: join(E(D.requiredCapacityKWh)), eq: H(D.equivalentNightH) }));
    }
    if (a.survivalPct === 100 && !r.night.censored) second.push(t('energy.read.survival'));
    out.push(second.join(' '));
  }
  const best = r.architectures.find((x) => x.id === r.bestMassId);
  if (best) {
    const third = [t('energy.read.best', { arch: t('energy.arch.' + best.id), mass: join(M(best.massKg)) })];
    if (best.id !== 'solar') third.push(t('energy.read.fissionCaveat'));
    third.push(t('energy.read.criteria'));
    out.push(third.join(' '));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

function reset() {
  // La période et le site sont des choix d'analyse : ils restent ; toutes les hypothèses reviennent à leur défaut
  raw = { ...DEFAULTS, period: raw.period };
  ui.openFormula = null;
  modal.rerender();
  toast(t('energy.resetDone'), 'ok');
}

/** Lignes du bilan : section, grandeur, valeur, unité, nature. Sert au CSV ; le JSON reprend les mêmes données. */
function reportRows({ result: r, eng }) {
  const a = r.inputs, L = r.loads, S = r.storage, so = r.solar, B = r.balance;
  const hyp = t('energy.x.nHyp'), comp = t('energy.x.nComputed'), res = t('energy.x.nResult'), info = t('energy.x.nInfo');
  // Ombre sans fin trouvée : tout ce qui découle de la durée de nuit est un minorant, et le fichier le dit ligne par ligne
  const low = r.night.censored ? t('energy.x.nLower') : null;
  const yes = t('ui.yes'), no = t('ui.no'), kWp = t('energy.u.kWp');
  const rows = [[t('energy.x.section'), t('energy.x.item'), t('energy.x.value'), t('energy.x.unit'), t('energy.x.nature')], ['', t('energy.x.notice'), '', '', info]];
  const add = (section, item, value, unit, nature) => rows.push([section, item, value, unit, nature]);
  const sSite = t('energy.x.sSite'), sEng = t('energy.x.sEngine'), sHyp = t('energy.x.sHyp'), sRes = t('energy.x.sRes'), sBal = t('energy.x.sBal'), sArch = t('energy.x.sArch');
  if (site) { add(sSite, t('energy.x.name'), siteName(site), '', info); add(sSite, t('energy.x.lat'), site.lat, '°', info); add(sSite, t('energy.x.lon'), site.lon, '°', info); }
  if (eng?.ok) {
    const s = eng.inputs;
    add(sSite, t('energy.x.periodStart'), new Date(eng.t0Ms).toISOString(), '', info); add(sSite, t('energy.x.periodEnd'), new Date(eng.t0Ms + eng.spanMs).toISOString(), '', info);
    add(sEng, t('energy.e.sunPct'), s.sunPct, '%', comp); add(sEng, t('energy.e.night'), s.longestNightH, 'h', s.nightCensored ? t('energy.x.nLower') : comp);
    add(sEng, t('energy.x.nightInWindow'), s.longestNightInWindowH, 'h', comp); add(sEng, t('energy.x.nightBeyond'), s.nightBeyondWindow ? yes : no, '', comp);
    add(sEng, t('energy.x.nightCensored'), s.nightCensored ? yes : no, '', comp);
    add(sEng, t('energy.e.day'), s.longestDayH, 'h', comp);
    add(sEng, t('energy.e.vertical'), s.powerVerticalPct, '%', comp); add(sEng, t('energy.e.horizontal'), s.powerHorizontalPct, '%', comp);
  }
  for (const id of Object.keys(FIELDS)) if (id !== 'nightOverrideH' || a.nightOverride) add(sHyp, t('energy.f.' + id), a[id], t('energy.u.' + id), hyp);
  add(sHyp, t('energy.panelType'), t('energy.panel.' + a.panelType), '', hyp);
  add(sHyp, t('energy.preset'), t('energy.preset.' + a.storagePreset), '', hyp);
  add(sRes, t('energy.r.daily'), L.dailyKWh, 'kWh', res); add(sRes, t('energy.r.avg'), L.avgKW, 'kW', res); add(sRes, t('energy.x.peak'), L.peakKW, 'kW', res);
  add(sRes, t('energy.x.nightPower'), L.nightKW, 'kW', res); add(sRes, t('energy.x.missionEnergy'), L.missionKWh, 'kWh', res);
  add(sRes, t('energy.x.nightHours'), r.night.hours, 'h', r.night.source === 'override' ? hyp : low || comp);
  if (S) { add(sRes, t('energy.r.night'), S.nightEnergyKWh, 'kWh', low || res); add(sRes, t('energy.r.storage'), S.capacityKWh, 'kWh', low || res); add(sRes, t('energy.x.storageMass'), S.massKg, 'kg', low || res); }
  add(sRes, t('energy.x.solarViable'), so.feasible ? yes : `${no} (${t('energy.arch.block.' + so.block)})`, '', res);
  if (so.feasible) { add(sRes, t('energy.r.solar'), so.installedKWp, kWp, res); add(sRes, t('energy.x.area'), so.areaM2, 'm2', res); add(sRes, t('energy.x.solarMass'), so.massKg, 'kg', res); add(sRes, t('energy.r.recharge'), so.rechargeKW, 'kW', res); }
  if (so.diagnosis) { add(sRes, t('energy.x.capArray'), so.diagnosis.capKWp, kWp, info); add(sRes, t('energy.bal.deficitDays'), so.diagnosis.deficitDays, t('unit.days'), res); add(sRes, t('energy.bal.required'), so.diagnosis.requiredCapacityKWh, 'kWh', res); }
  if (B) {
    add(sBal, t('energy.bal.possible'), B.possibleKWh, 'kWh', res); add(sBal, t('energy.bal.need'), B.needKWh, 'kWh', res); add(sBal, t('energy.bal.unserved'), B.unservedKWh, 'kWh', res);
    add(sBal, t('energy.bal.deficitDays'), B.deficitDays, t('unit.days'), res); add(sBal, t('energy.bal.curtailed'), B.curtailedKWh, 'kWh', res); add(sBal, t('energy.bal.losses'), B.lossesKWh, 'kWh', res);
    add(sBal, t('energy.bal.delta'), B.deltaStoreKWh, 'kWh', res); add(sBal, t('energy.bal.reserveRow'), B.reserveMinPct, '%', res); add(sBal, t('energy.bal.required'), B.requiredCapacityKWh, 'kWh', res);
  }
  for (const x of r.architectures) {
    const name = t('energy.arch.' + x.id);
    add(sArch, `${name} — ${t('energy.x.feasible')}`, x.feasible ? yes : no, '', res);
    if (!x.feasible) continue;
    if (x.fissionKW > 0 || x.id === 'fission') add(sArch, `${name} — ${t('energy.x.fissionPower')}`, x.fissionKW, 'kWe', res);
    if (x.id !== 'fission') add(sArch, `${name} — ${t('energy.x.solarPower')}`, x.solarKWp, kWp, res);
    add(sArch, `${name} — ${t('energy.arch.storage')}`, x.storageKWh, 'kWh', x.id === 'solar' && low ? low : res);
    add(sArch, `${name} — ${t('energy.arch.mass')}`, x.massKg, 'kg', x.id === 'solar' && low ? low : res);
    add(sArch, `${name} — ${t('energy.x.deficitDays')}`, x.check ? x.check.deficitDays : '', t('unit.days'), res);
    add(sArch, `${name} — ${t('energy.x.best')}`, r.bestMassId === x.id ? yes : no, '', res);
  }
  return rows;
}

function exportReport(format) {
  if (!last) return;
  const { result: r, eng } = last;
  const slug = (site ? siteName(site) : 'base').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
  const file = `regolith-finder-${state.lang === 'fr' ? 'energie' : 'energy'}-${slug}.${format}`;
  if (format === 'csv') download(file, '\ufeff' + toCsv(reportRows(last)), 'text/csv;charset=utf-8');
  else {
    download(file, JSON.stringify({
      app: 'Regolith Finder', module: 'energy', notice: t('energy.x.notice'), exportedAt: new Date().toISOString(), language: state.lang,
      site: site && { name: siteName(site), lat: site.lat, lon: site.lon, kind: site.kind },
      period: eng?.ok ? { type: r.inputs.period, startUTC: new Date(eng.t0Ms).toISOString(), endUTC: new Date(eng.t0Ms + eng.spanMs).toISOString() } : null,
      illumination: r.site, assumptions: r.inputs,
      results: { night: r.night, nightIsLowerBound: r.night.censored, loads: r.loads, storage: r.storage, solar: r.solar, balance: r.balance },
      architectures: r.architectures, bestMassId: r.bestMassId, warnings: r.warnings,
    }, null, 2), 'application/json');
  }
  toast(t('energy.exported', { file }), 'ok');
}
