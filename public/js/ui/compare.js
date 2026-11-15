// Vue « Comparer » : jusqu'à trois scénarios (site + date) côte à côte.
// C'est l'écran du planificateur de mission : quand le calendrier glisse, évaluer vite d'autres sites
// de la région ou d'autres dates au même site.
//
//   const view = mountCompare(container);  view.setActive(true);
//
// Rien n'est calculé tant que la vue n'est pas active. Elle se recalcule quand changent
// state.compare, state.timeMs (une fois par seconde au plus pendant la lecture), state.params,
// state.lang, state.cvd, les poids des critères ou les données chargées.
// Répartition : compare/analyze.js (analyse d'un scénario, lignes du tableau, CSV), compare/thumb.js
// (vignette du relief), compare/narrative.js (phrases d'analyse), compare/artemis.js (les 9 régions).

import { state, set, on, emit, select, addToCompare, removeFromCompare } from '../core/store.js';
import { t, num, pct, deg, dateUTC } from '../core/i18n.js';
import '../i18n/compare.js';
import { h, button, provTag, collapsible, download } from './dom.js';
import { icon } from './icons.js';
import { fmtLatLon } from '../core/coords.js';
import { cat } from '../layers/palettes.js';
import { radarChart, stripChart } from '../views/charts.js';
import { runs, regionBest, clearEngineCache, LUNAR_DAY_MS, DAY_MS } from '../science/engine.js';
import { getWeights, setWeights, resetWeights, CRITERIA } from '../science/scoring.js';
import { getSite, siteSelection } from '../data/sites.js';
import { tryData, dataLoaded } from '../data/registry.js';
import {
  LETTERS, SERIES, analyze, tableModel, buildCsv, groupTitle, scenarioDate, toScenario,
  regionVariant, regionPointSelection, displayName, sunNextText, earthNextText,
} from './compare/analyze.js';
import { buildNarrative } from './compare/narrative.js';
import { createThumb } from './compare/thumb.js';
import { createArtemisPanel } from './compare/artemis.js';
import { put, joinList, nb } from './compare/util.js';

const QUICK_IDS = ['malapert_massif', 'mons_mouton_plateau', 'slater_plain'];
const PERIODS = ['lunarDay', 'year'];
const LINE_STYLES = ['solid', 'dashed', 'dotted'];      // même ordre que charts.DASHES
// Données dont l'arrivée change l'affichage ; celles de STALE sont en plus mémoïsées par le moteur.
const DATA_WATCHED = new Set(['sp_dem', 'sp_sun_avg', 'sp_earth_avg', 'sp_psr', 'sp_tmax', 'sp_tmin', 'global_ldem']);
const DATA_STALE = new Set(['sp_dem', 'sp_psr', 'sp_tmin']);
// Choix d'affichage, conservés quand la vue est reconstruite (changement de langue ou de palette).
const ui = { period: 'lunarDay', radar: 'comp' };

const isoMinute = (ms) => new Date(ms).toISOString().slice(0, 16);
const seriesColor = (i) => cat(SERIES[i], state.cvd);

/** Pastille « A », « B », « C » : la lettre est le repère, la couleur de série n'est qu'un renfort. */
function letterBadge(i) {
  const el = h('span', { class: 'cmp-letter' }, LETTERS[i]);
  el.style.setProperty('--sc', seriesColor(i));
  return el;
}
/**
 * @param {HTMLElement} container  (#view-compare)
 * @returns {{setActive:(on:boolean)=>void}}
 */
export function mountCompare(container) {
  const root = h('div', { class: 'cmp' });
  container.append(root);

  let active = false, dirty = true, needBuild = true;
  let timer = null, dueAt = 0, lastRun = 0;
  let els = null, cards = [], artemis = null;
  let analyses = [], model = [];

  // ---------- Planification des recalculs ----------
  function schedule(delay = 0) {
    dirty = true;
    if (!active) return;
    const at = performance.now() + delay;
    if (timer !== null && at >= dueAt) return;          // un recalcul plus proche est déjà prévu
    clearTimeout(timer);
    dueAt = at;
    timer = setTimeout(() => { timer = null; refresh(); }, delay);
  }
  function rebuild() { needBuild = true; schedule(0); }

  on('change:compare', () => schedule(0));
  on('change:params', () => schedule(0));
  on('change:tempUnit', () => schedule(0));
  on('change:lang', rebuild);
  on('change:cvd', rebuild);
  on('sites:ready', () => schedule(0));
  on('scoring:weights', () => schedule(0));
  on('change:selection', () => { if (active && els) updateTop(); });
  // Pendant la lecture, la date change à chaque image : un recalcul par seconde suffit.
  on('change:timeMs', () => schedule(state.playing ? Math.max(0, 1000 - (performance.now() - lastRun)) : 120));
  on('data:ready', (id) => {
    if (!DATA_WATCHED.has(id)) return;
    // Le moteur garde en mémoire la part d'ombre permanente et le plancher thermique calculés avant
    // l'arrivée de ces rasters : on vide son cache pour ne pas afficher « indisponible » à tort.
    if (DATA_STALE.has(id) && dataLoaded(id)) clearEngineCache();
    schedule(150);
  });

  // ---------- Actions ----------
  function setScenarioDate(i, dateMs) {
    set({ compare: state.compare.map((sc, k) => (k === i ? { ...sc, dateMs } : sc)) });
  }
  function openScenario(sc) {
    const v = regionVariant(sc);
    const { dateMs, ...sel } = toScenario(sc);
    select({ ...sel, ...(v ? { regionId: sc.siteId, variant: v } : {}) });
    // La carte 2D ne couvre que le pôle Sud, jusqu'à 75°S.
    set({ view: sc.lat <= -75 ? 'map2d' : 'globe' });
  }
  /** Même site à trois dates : celle du scénario, +1 mois synodique, +3 mois synodiques. */
  function sameSiteOtherDates() {
    const base = state.compare[0] || (state.selection ? toScenario(state.selection) : null);
    if (!base) return;
    const d0 = Math.round(scenarioDate(base) / 60000) * 60000;
    set({ compare: [0, 1, 3].map((months) => ({ ...base, dateMs: d0 + months * LUNAR_DAY_MS })) });
  }
  /** Raccourci de l'état vide : le point « meilleur compromis » de chaque région, à défaut son centre. */
  async function quickCompare() {
    await Promise.all([tryData('sp_sun_avg'), tryData('sp_earth_avg')]);
    set({
      compare: QUICK_IDS.map(getSite).filter(Boolean).map((site) => {
        const best = site.corners ? regionBest(site.corners) : null;
        return toScenario(best && best.both ? regionPointSelection(site, 'both', best.both) : siteSelection(site));
      }),
    });
  }
  function exportCsv() {
    if (!state.compare.length) return;
    const day = new Date(state.timeMs).toISOString().slice(0, 10);
    download(`${t('compare.csv.file')}-${day}.csv`, buildCsv(state.compare, analyses, model, ui.period), 'text/csv;charset=utf-8');
  }

  // ---------- Construction (une fois, puis à chaque changement de langue ou de palette) ----------
  function sectionCard(cls, title, ...children) {
    return h('section', { class: `card cmp-sec ${cls}` }, h('h3', { class: 'sec-title' }, title), children);
  }

  function build() {
    cards = [];
    artemis = createArtemisPanel({ getPeriod: () => ui.period });
    els = {};

    els.periodSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('compare.period') }, PERIODS.map((p) => h('button', {
      type: 'button', dataset: { period: p },
      onclick: () => { if (ui.period !== p) { ui.period = p; schedule(0); } },
    }, t('compare.period.' + p))));
    els.addBtn = button(t('compare.addSelected'), () => addToCompare(state.selection), { icon: 'plus', kind: 'primary' });
    els.sameBtn = button(t('compare.sameSite'), sameSiteOtherDates, { icon: 'clock', title: t('compare.sameSite.help') });
    els.clearBtn = button(t('compare.clear'), () => set({ compare: [] }), { icon: 'trash' });
    els.csvBtn = button(t('compare.csv'), exportCsv, { icon: 'download' });
    els.addBtn.dataset.action = 'add'; els.sameBtn.dataset.action = 'same'; els.clearBtn.dataset.action = 'clear'; els.csvBtn.dataset.action = 'csv';
    els.now = h('span', { class: 'mono' });

    const top = h('header', { class: 'cmp-top' },
      h('div', { class: 'cmp-top-head' }, h('h2', { class: 'cmp-title' }, t('compare.title')), h('p', { class: 'cmp-lead' }, t('compare.lead'))),
      h('div', { class: 'cmp-top-bar' },
        h('div', { class: 'cmp-top-group' }, h('span', { class: 'cmp-label' }, t('compare.period')), els.periodSeg),
        h('div', { class: 'cmp-top-group cmp-top-actions' }, els.addBtn, els.sameBtn, els.clearBtn, els.csvBtn),
        h('div', { class: 'cmp-top-group cmp-now' }, h('span', { class: 'cmp-label' }, t('compare.currentDate')), els.now)));

    els.empty = h('div', { class: 'card cmp-empty' });
    els.cards = h('div', { class: 'cmp-cards' });
    els.caption = h('p', { class: 'cmp-fine cmp-caption' }, t('compare.thumb.caption'), ' ', provTag('illustrative'));
    els.tableWrap = h('div', { class: 'cmp-scroll' });
    els.tableSec = sectionCard('cmp-table-sec', t('compare.table.title'), els.tableWrap);
    els.tlBody = h('div', { class: 'cmp-tl' });
    els.tlSec = sectionCard('cmp-tl-sec', h('span', {}, t('compare.tl.title'), ' ', provTag('computed')), h('p', { class: 'cmp-fine' }, t('compare.tl.help')), els.tlBody);

    els.radarSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('compare.radar.title') }, ['comp', 'ref'].map((m) => h('button', {
      type: 'button', dataset: { radar: m },
      onclick: () => { if (ui.radar !== m) { ui.radar = m; updateSegs(); renderRadar(); } },
    }, t('compare.radar.' + m))));
    els.radarBody = h('div', { class: 'cmp-radar' });
    els.radarSec = sectionCard('cmp-radar-sec', t('compare.radar.title'), els.radarSeg, els.radarBody);
    els.anBody = h('div', { class: 'cmp-an' });
    els.anSec = sectionCard('cmp-an-sec', h('span', {}, t('compare.an.title'), ' ', provTag('computed', t('compare.an.prov'))), els.anBody);
    els.methodBody = h('ul', { class: 'cmp-method' });

    put(root,
      top,
      h('div', { class: 'cmp-body' },
        h('div', { class: 'cmp-main' }, els.empty, els.cards, els.caption, els.tableSec, els.tlSec),
        h('aside', { class: 'cmp-side' }, els.radarSec, els.anSec, buildWeights())),
      h('div', { class: 'card cmp-fold' }, artemis.el),
      h('div', { class: 'card cmp-fold' }, collapsible('compare.method', t('compare.method.title'), els.methodBody, false)));
    updateSegs();
  }

  function updateSegs() {
    for (const b of els.periodSeg.children) { const on_ = b.dataset.period === ui.period; b.classList.toggle('is-on', on_); b.setAttribute('aria-pressed', String(on_)); }
    for (const b of els.radarSeg.children) { const on_ = b.dataset.radar === ui.radar; b.classList.toggle('is-on', on_); b.setAttribute('aria-pressed', String(on_)); }
  }

  // ---------- Pondération ----------
  function buildWeights() {
    const total = h('span', { class: 'cmp-w-total mono' }), zero = h('p', { class: 'note note-warn', hidden: true }, t('compare.w.zero'));
    const inputs = {}, outputs = {};
    const show = () => {
      const w = getWeights(); let sum = 0;
      for (const c of CRITERIA) { sum += w[c] || 0; outputs[c].textContent = String(w[c] ?? 0); if (document.activeElement !== inputs[c]) inputs[c].value = w[c] ?? 0; }
      total.textContent = t('compare.w.total', { v: num(sum, 0) });
      zero.hidden = sum > 0;
    };
    const rows = CRITERIA.map((c) => {
      outputs[c] = h('output', { class: 'mono' });
      inputs[c] = h('input', { type: 'range', min: 0, max: 50, step: 1, 'aria-label': t('compare.w.slider', { c: t('crit.' + c) }), dataset: { crit: c } });
      inputs[c].addEventListener('input', () => { setWeights({ [c]: Number(inputs[c].value) }); emit('scoring:weights'); });
      return h('label', { class: 'cmp-w-row' }, h('span', {}, t('crit.' + c)), inputs[c], outputs[c]);
    });
    els.syncWeights = show;
    show();
    return sectionCard('cmp-w-sec', t('compare.w.title'),
      h('p', { class: 'cmp-formula mono' }, t('compare.w.formula')),
      rows,
      h('div', { class: 'cmp-w-foot' }, total, button(t('compare.w.reset'), () => { resetWeights(); emit('scoring:weights'); }, { small: true, icon: 'refresh' })),
      zero,
      h('p', { class: 'cmp-fine' }, t('compare.w.note'), ' ', provTag('hypothesis')));
  }

  // ---------- Barre du haut, état vide ----------
  function updateTop() {
    const n = state.compare.length, sel = state.selection;
    els.addBtn.disabled = !sel; els.addBtn.title = sel ? '' : t('compare.addSelected.none');
    els.sameBtn.disabled = !n && !sel;
    els.clearBtn.disabled = !n; els.csvBtn.disabled = !n;
    els.now.textContent = dateUTC(state.timeMs);
  }

  function renderEmpty() {
    const sites = QUICK_IDS.map(getSite).filter(Boolean);
    put(els.empty, 
      h('h3', { class: 'cmp-empty-title' }, t('compare.empty.title')),
      h('p', {}, t('compare.empty.text')),
      sites.length === QUICK_IDS.length ? [
        button(t('compare.empty.shortcut', { names: joinList(sites.map((s) => s.name)) }), quickCompare, { icon: 'compare', kind: 'primary' }),
        h('p', { class: 'cmp-fine' }, t('compare.empty.shortcut.note')),
      ] : null);
    els.empty.querySelector('button')?.setAttribute('data-action', 'quick');
  }

  // ---------- Colonnes scénario ----------
  function createCard(i, key) {
    const thumb = createThumb();
    const name = h('h3', { class: 'cmp-card-name' }), meta = h('div', { class: 'cmp-card-meta' });
    const status = h('div', { class: 'cmp-status' });
    const input = h('input', { type: 'datetime-local', class: 'input', min: '1950-01-01T00:00', max: '2100-12-31T23:59' });
    const dateText = h('span', {});
    const follow = button(t('compare.date.followBtn'), () => setScenarioDate(i, null), { small: true, kind: 'ghost' });
    input.addEventListener('change', () => {
      const ms = input.value ? Date.parse(`${input.value}Z`) : NaN;
      setScenarioDate(i, Number.isFinite(ms) ? ms : null);          // champ vidé = date courante
    });
    const removeBtn = h('button', { type: 'button', class: 'iconbtn', title: t('compare.remove', { l: LETTERS[i] }), 'aria-label': t('compare.remove', { l: LETTERS[i] }), dataset: { action: 'remove' }, onclick: () => removeFromCompare(i) }, icon('close'));
    const openBtn = button(t('compare.open'), () => openScenario(state.compare[i]), { small: true, icon: 'map', title: t('compare.open.help') });
    openBtn.dataset.action = 'open';
    const el = h('article', { class: 'card cmp-card', dataset: { scenario: LETTERS[i] }, 'aria-label': t('compare.scenario', { l: LETTERS[i] }) },
      h('header', { class: 'cmp-card-head' }, letterBadge(i), h('div', { class: 'cmp-card-id' }, name, meta), removeBtn),
      h('div', { class: 'cmp-card-mid' }, thumb.el, status),
      h('label', { class: 'field cmp-date' }, h('span', {}, t('compare.date.label')), input),
      h('div', { class: 'cmp-card-foot' }, h('div', { class: 'cmp-date-state' }, dateText, follow), openBtn));
    el.style.setProperty('--sc', seriesColor(i));

    const statusLine = (ic, up, upKey, downKey, next) => h('div', { class: 'cmp-status-line' + (up ? ' is-up' : '') },
      icon(ic, 15), h('div', {}, h('strong', {}, t(up ? upKey : downKey)), h('span', {}, next)));
    function update(sc, a) {
      name.textContent = displayName(sc);
      put(meta, h('span', {}, t('kind.' + (sc.kind || 'point'))), h('span', { class: 'mono' }, fmtLatLon(sc.lat, sc.lon, 2, state.lang)));
      thumb.update(sc, a);
      put(status, a ? [
        statusLine('sun', a.sunUp, 'compare.sun.up', 'compare.sun.down', sunNextText(a)),
        statusLine('earth', a.earthUp, 'compare.earth.up', 'compare.earth.down', earthNextText(a)),
        a.now.horizon.terrain ? null : h('p', { class: 'cmp-fine' }, t('compare.smooth')),
      ] : h('p', { class: 'note note-warn' }, t('compare.error')));
      // On ne touche pas au champ pendant que l'utilisateur le remplit.
      if (document.activeElement !== input) input.value = sc.dateMs === null || sc.dateMs === undefined ? '' : isoMinute(sc.dateMs);
      const fixed = Number.isFinite(sc.dateMs);
      dateText.textContent = fixed ? t('compare.date.fixed') : `${t('compare.date.follow')} (${dateUTC(state.timeMs)})`;
      follow.hidden = !fixed;
    }
    return { el, key, update };
  }

  function syncCards() {
    const list = state.compare;
    // Les colonnes ne sont reconstruites que si la liste des sites change : modifier une date ne fait
    // pas perdre le champ en cours de saisie.
    if (cards.length !== list.length || cards.some((c, i) => c.key !== list[i].key)) {
      cards = list.map((sc, i) => createCard(i, sc.key));
      put(els.cards, cards.map((c) => c.el));
    }
    cards.forEach((c, i) => c.update(list[i], analyses[i]));
    els.cards.dataset.n = String(list.length);
  }

  // ---------- Tableau des critères ----------
  function bestCell({ row, best }) {
    if (!row.better) return h('td', { class: 'cmp-best', title: t('compare.rule.none.help') });
    let who;
    if (!best.winners.length) who = h('span', { class: 'dim', title: best.reason === 'mixed' ? t('compare.rule.mixed.help') : null }, '—');
    else if (best.tie) who = h('span', { class: 'cmp-tie' }, `= ${t('compare.tie')}`);
    else who = best.winners.map((i) => letterBadge(i));
    return h('td', { class: 'cmp-best' },
      h('span', { class: 'cmp-best-who' }, who),
      h('span', { class: 'cmp-rule', title: t(`compare.rule.${row.better}.help`) }, `${row.better === 'high' ? '▲' : '▼'} ${t('compare.rule.' + row.better)}`));
  }

  function renderTable() {
    const list = state.compare;
    const head = h('thead', {}, h('tr', {},
      h('th', { class: 'cmp-sticky', scope: 'col' }, t('compare.table.indicator')),
      list.map((sc, i) => h('th', { class: 'cmp-col-head', scope: 'col' }, letterBadge(i),
        h('span', { class: 'cmp-col-name' }, displayName(sc)), h('span', { class: 'cmp-col-date' }, dateUTC(scenarioDate(sc))))),
      h('th', { class: 'cmp-best-head', scope: 'col', title: t('compare.table.best.help') }, t('compare.table.best'))));
    const body = h('tbody');
    let group = null;
    for (const line of model) {
      const { row, cells, best } = line;
      if (row.group !== group) {
        group = row.group;
        body.append(h('tr', { class: 'cmp-group' }, h('th', { colspan: list.length + 2, scope: 'colgroup' }, h('span', {}, groupTitle(group, ui.period)))));
      }
      body.append(h('tr', { dataset: { row: row.id } },
        h('th', { class: 'cmp-sticky cmp-row-label', scope: 'row', title: row.help }, h('span', {}, row.label), provTag(row.prov, row.provTitle)),
        cells.map((c, i) => h('td', { class: 'num' + (row.wrap ? ' cmp-wrap' : '') + (best && best.winners.includes(i) && !best.tie ? ' best' : ''), title: c.title, dataset: { col: LETTERS[i] } },
          h('span', { class: 'cmp-val' }, c.main), c.missing ? provTag('missing', c.title) : null, c.sub ? h('span', { class: 'cmp-sub' }, c.sub) : null)),
        bestCell(line)));
    }
    put(els.tableWrap, h('table', { class: 'table cmp-table' }, head, body));
  }

  // ---------- Radar ----------
  function renderRadar() {
    const ref = ui.radar === 'ref', series = [], remarks = [];
    analyses.forEach((a, i) => {
      if (!a) return;
      const notes = ref ? a.ref : a.comp.notes;
      const missing = CRITERIA.filter((c) => !notes || !Number.isFinite(notes[c]));
      if (missing.length === CRITERIA.length) { if (ref) remarks.push(t('compare.radar.noRef', { l: LETTERS[i] })); return; }
      if (missing.length) remarks.push(t('compare.radar.missing', { l: LETTERS[i], list: missing.map((c) => t('crit.' + c)).join(', ') }));
      series.push({ i, a, notes, name: `${LETTERS[i]} — ${displayName(a.sc)}`, color: seriesColor(i), values: CRITERIA.map((c) => notes[c]) });
    });
    if (!series.length) { put(els.radarBody, h('div', { class: 'empty' }, t('compare.radar.empty')), remarks.map((r) => h('p', { class: 'cmp-fine' }, r))); return; }

    // Valeurs en clair sous le radar ; * = note de référence reprise, ~ = indice indirect.
    const marks = new Set();
    const noteCell = (se, c) => {
      const v = se.notes[c];
      if (!Number.isFinite(v)) return '—';
      const src = ref ? null : se.a.comp.sources[c];
      const mark = src === 'hypothesis' ? '*' : src === 'estimate' ? '~' : '';
      if (mark) marks.add(mark);
      return num(v, 1) + mark;
    };
    const grid = h('table', { class: 'table cmp-notes' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), series.map((se) => h('th', { class: 'num' }, letterBadge(se.i))))),
      h('tbody', {}, CRITERIA.map((c) => h('tr', {}, h('th', { scope: 'row' }, t('crit.' + c)), series.map((se) => h('td', { class: 'num' }, noteCell(se, c)))))));
    put(els.radarBody,
      radarChart({ axes: CRITERIA.map((c) => ({ label: t('crit.' + c), max: 10 })), series, size: 320 }),
      // Le style de trait suit l'ordre des séries tracées (charts.DASHES).
      h('div', { class: 'chart-legend' }, series.map((se, k) => h('span', {}, h('i', { style: { borderTopColor: se.color, borderTopStyle: LINE_STYLES[k % 3] } }), se.name))),
      grid,
      marks.size ? h('p', { class: 'cmp-fine' }, [marks.has('*') ? t('compare.radar.mark.hyp') : null, marks.has('~') ? t('compare.radar.mark.est') : null].filter(Boolean).join(' · ')) : null,
      remarks.map((r) => h('p', { class: 'cmp-fine' }, r)),
      // Les notes « calculées » mêlent calculs, indice et notes reprises : même étiquette que le score calculé.
      h('p', { class: 'cmp-fine' }, t(ref ? 'compare.radar.note.ref' : 'compare.radar.note.comp'), ' ', ref ? provTag('hypothesis') : provTag('estimate', t('compare.row.compScore.prov'))));
  }

  // ---------- Chronologie alignée ----------
  function renderTimeline() {
    put(els.tlBody);
    const done = analyses.map((a, i) => ({ a, i })).filter((x) => x.a);
    if (!done.length) return;
    // Axe commun : jours écoulés depuis le début de la période de chaque scénario.
    const axisMs = Math.max(...done.map((x) => x.a.win.spanMs)), axisDays = axisMs / DAY_MS;
    const sunC = cat('sun', state.cvd), earthC = cat('earth', state.cvd);
    // « Les deux » en vert ; si la palette daltonienne le confond avec la Terre, on prend une autre teinte.
    const bothC = cat('ok', state.cvd) === earthC ? cat('psr', state.cvd) : cat('ok', state.cvd);
    for (const { a, i } of done) {
      const S = a.win.series, t0 = a.win.t0Ms;
      const rows = [
        { label: t('compare.tl.sun'), color: sunC, intervals: runs(S, (k) => S.sunFrac[k] > 0), share: a.m.sunPct },
        { label: t('compare.tl.earth'), color: earthC, intervals: runs(S, (k) => S.earthVis[k] === 1), share: a.m.earthPct },
        { label: t('compare.tl.both'), color: bothC, intervals: runs(S, (k) => S.sunFrac[k] > 0 && S.earthVis[k] === 1), share: a.m.bothPct },
      ];
      els.tlBody.append(h('div', { class: 'cmp-tl-block', dataset: { scenario: LETTERS[i] } },
        h('div', { class: 'cmp-tl-head' }, letterBadge(i), h('strong', {}, displayName(a.sc)), h('span', { class: 'cmp-fine' }, t('compare.tl.from', { d: dateUTC(t0) }))),
        h('div', { class: 'cmp-tl-rows' },
          h('div', { class: 'cmp-tl-labels' }, rows.map((r) => h('span', {}, h('i', { class: 'swatch', style: { background: r.color } }), r.label))),
          stripChart(rows, { tMin: t0, tMax: t0 + axisMs, cursor: ui.period === 'year' ? a.dateMs : null, width: 600, rowH: 12, gap: 6 }),
          h('div', { class: 'cmp-tl-shares mono' }, rows.map((r) => h('span', {}, pct(r.share, 1)))))));
    }
    const step = ui.period === 'year' ? 30 : 5, ticks = [];
    for (let d = 0; d <= axisDays; d += step) ticks.push(d);
    els.tlBody.append(
      h('div', { class: 'cmp-tl-axis mono', 'aria-hidden': 'true' }, ticks.map((d) => h('span', { style: { left: `${(100 * d) / axisDays}%` } }, String(d)))),
      h('p', { class: 'cmp-fine cmp-tl-axis-label' }, t('compare.tl.axis.' + ui.period), ui.period === 'year' ? ` · ${t('compare.tl.cursor')}` : ''));
  }

  // ---------- Analyse, méthode ----------
  function renderAnalysis() {
    put(els.anBody, buildNarrative(state.compare, analyses, model).map((s) => h('p', {}, s)));
  }
  function renderMethod() {
    const p = state.params;
    put(els.methodBody, [
      t('compare.method.horizon', { mast: nb(`${num(p.mastM, 1)} m`) }),
      t('compare.method.sun', { mast: nb(`${num(p.mastM, 1)} m`) }),
      t('compare.method.earth', { m: deg(p.earthMarginDeg, 1) }),
      t('compare.method.period'),
      t('compare.method.night'),
      t('compare.method.temp'),
      t('compare.method.scores'),
    ].map((s) => h('li', {}, s)));
  }

  // ---------- Recalcul ----------
  function refresh() {
    lastRun = performance.now();
    dirty = false;
    if (needBuild) { build(); needBuild = false; }
    const list = state.compare;
    analyses = list.map((sc) => {
      try { return analyze(sc, ui.period); } catch (e) { console.error('[compare] scénario', sc.key, e); return null; }
    });
    model = tableModel(analyses);
    const empty = !list.length;
    for (const el of [els.cards, els.caption, els.tableSec, els.tlSec, els.radarSec, els.anSec]) el.hidden = empty;
    els.empty.hidden = !empty;
    root.classList.toggle('is-empty', empty);
    updateTop(); updateSegs(); els.syncWeights(); renderMethod();
    if (empty) renderEmpty();
    syncCards();
    if (!empty) { renderTable(); renderRadar(); renderTimeline(); renderAnalysis(); }
    artemis.refresh();
  }

  return {
    setActive(on_) {
      active = !!on_;
      if (active) { if (dirty) schedule(0); } else { clearTimeout(timer); timer = null; if (artemis) { artemis.suspend(); dirty = true; } }
    },
  };
}
