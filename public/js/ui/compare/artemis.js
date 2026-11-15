// Vue « Comparer » : tableau repliable des 9 régions candidates Artemis III.
//
// Pour chaque région : les notes de référence du cahier des charges (hypothèses), le score recalculé
// avec les poids courants, puis les indicateurs calculés par l'application en UN point de la région.
// Ce point est choisi par l'utilisateur : par défaut le « meilleur compromis » des cartes moyennes
// NASA PGDA (engine.regionBest), car le centre géométrique d'une région est souvent un mauvais
// représentant (fond de cratère, versant caché de la Terre…).
// Le calcul part à l'ouverture du repliable, une région à la fois (setTimeout) pour ne pas figer la page.

import { state, addToCompare, toast } from '../../core/store.js';
import { t, num, pct, deg, duration, km, dateUTC } from '../../core/i18n.js';
import { h, collapsible, provTag } from '../dom.js';
import { icon } from '../icons.js';
import { fmtLatLon } from '../../core/coords.js';
import { siteWindow, terrainAround, regionBest, DAY_MS } from '../../science/engine.js';
import { weightedScore, referenceNotes, getWeights, CRITERIA } from '../../science/scoring.js';
import { REFERENCE_HYPOTHESES } from '../../data/reference.js';
import { sitesOfKind, siteSelection } from '../../data/sites.js';
import { tryData, dataLoaded } from '../../data/registry.js';
import { regionPointSelection, tidy } from './analyze.js';
import { put, nb } from './util.js';

const VARIANTS = ['both', 'centre', 'sun', 'earth'];
// Choix de l'utilisateur, conservés quand la vue est reconstruite (changement de langue).
const ui = { variant: 'both', sort: { key: 'recalc', dir: -1 } };

/** Borne d'un intervalle annoncé, en jours : « 10 », « 9,5 ». */
const days = (v) => num(v, Number.isInteger(v) ? 0 : 1);
/** Colonnes calculées : valeur, texte, et clé de l'intervalle annoncé par le cahier des charges. */
const COMPUTED = [
  { key: 'sun', hyp: 'sunPct', value: (r) => r.m.sunPct, text: (r, v) => pct(v, 1), range: (v) => num(v, 0) },
  { key: 'night', hyp: 'nightDays', value: (r) => r.m.longestNightH / 24, text: (r, v) => (r.m.nightCensored ? t('compare.over400') : v === 0 ? t('compare.noNight') : duration(v * 24)), range: days },
  { key: 'earth', hyp: 'earthPct', value: (r) => r.m.earthPct, text: (r, v) => pct(v, 1), range: (v) => num(v, 0) },
  { key: 'blackout', hyp: 'blackoutDays', value: (r) => r.m.longestBlackoutH / 24, text: (r, v) => (r.m.blackoutCensored ? t('compare.over400') : v === 0 ? t('compare.noBlackout') : duration(v * 24)), range: days },
  { key: 'slope', hyp: 'slopeOkPct', value: (r) => (r.ter.stats ? 100 * r.ter.stats.fracBelow : NaN), text: (r, v) => pct(v, 0), range: (v) => num(v, 0) },
];

/**
 * @param {{getPeriod:()=>('lunarDay'|'year')}} opts
 * @returns {{el:HTMLElement, refresh:()=>void, suspend:()=>void}} refresh() : à appeler quand la période, la date, les paramètres ou les poids changent
 */
export function createArtemisPanel({ getPeriod }) {
  const banner = h('div', { class: 'note note-warn' });
  const toolbar = h('div', { class: 'cmp-art-bar' });
  const progress = h('div', { class: 'cmp-art-progress', 'aria-live': 'polite' });
  const tableWrap = h('div', { class: 'cmp-scroll' });
  const legend = h('p', { class: 'cmp-fine' });
  const details = collapsible('compare.artemis', t('compare.art.title'), [banner, toolbar, progress, tableWrap, legend], false);
  details.classList.add('cmp-art');

  let results = new Map();          // id de région -> {pt, m, ter, pgda} | {noPixel:true} | {error:true}
  let ctxKey = null, shown = null, run = 0, pgdaOk = true;
  const status = { running: false, i: 0, n: 0, ms: null };

  const variant = () => (pgdaOk ? ui.variant : 'centre');
  const slopeLimit = () => deg(state.params.slopeLimitDeg, 0);

  function computeOne(site, period) {
    try {
      let pt = { lat: site.lat, lon: site.lon }, pgda = null;
      if (variant() !== 'centre' && site.corners) {
        pgda = regionBest(site.corners)?.[variant()] || null;
        if (!pgda) return { noPixel: true };
        pt = { lat: pgda.lat, lon: pgda.lon };
      }
      return { pt, pgda, m: siteWindow(pt, period, state.timeMs).metrics, ter: terrainAround(pt) };
    } catch (e) {
      console.error('[compare] région', site.id, e);
      return { error: true };
    }
  }

  async function compute(key) {
    const token = ++run;
    ctxKey = key;
    const sites = sitesOfKind('artemis'), period = getPeriod(), started = performance.now();
    results = new Map();
    Object.assign(status, { running: true, i: 0, n: sites.length, ms: null });
    render();
    if (ui.variant !== 'centre') {
      // Les points favorables se lisent sur les deux cartes moyennes PGDA : il faut qu'elles soient chargées.
      await Promise.all([tryData('sp_sun_avg'), tryData('sp_earth_avg')]);
      if (token !== run) return;
      pgdaOk = dataLoaded('sp_sun_avg') && dataLoaded('sp_earth_avg');
    }
    for (const site of sites) {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      if (token !== run) return;                      // un calcul plus récent a pris le relais
      results.set(site.id, computeOne(site, period));
      status.i++;
      render();
    }
    Object.assign(status, { running: false, ms: performance.now() - started });
    render();
  }

  function refresh() {
    if (!details.open) return;
    const period = getPeriod(), p = state.params;
    // Le moteur ancre la fenêtre « jour lunaire » sur 00:00 UTC du jour de la date ; l'année civile ne change qu'au 1er janvier.
    const when = period === 'year' ? new Date(state.timeMs).getUTCFullYear() : Math.floor(state.timeMs / DAY_MS);
    const key = [period, when, ui.variant, p.mastM, p.earthMarginDeg, p.slopeLimitDeg, p.landingRadiusM, sitesOfKind('artemis').length].join('|');
    // Les scores recalculés dépendent des poids ; le reste du tableau ne change qu'avec le contexte.
    const stamp = `${state.lang}|${JSON.stringify(getWeights())}`;
    if (key !== ctxKey) { shown = stamp; compute(key); } else if (stamp !== shown) { shown = stamp; render(); }
  }
  /** Vue masquée : on arrête le calcul en cours ; il repartira au prochain refresh(). */
  function suspend() {
    if (!status.running) return;
    run++; ctxKey = null; status.running = false;
  }
  details.addEventListener('toggle', refresh);

  // ---- Affichage ----
  function rowsData() {
    return sitesOfKind('artemis').map((site) => {
      const ref = referenceNotes(site.id), recalc = ref ? weightedScore(ref) : NaN, res = results.get(site.id) || null;
      const sortValues = { name: site.name, recalc, stated: ref ? ref.stated : NaN, delta: ref ? recalc - ref.stated : NaN };
      for (const c of CRITERIA) sortValues[c] = ref ? ref[c] : NaN;
      for (const c of COMPUTED) sortValues[c.key] = res && res.m ? c.value(res) : NaN;
      return { site, ref, recalc, res, sortValues };
    });
  }
  function sorted(rows) {
    const { key, dir } = ui.sort;
    return rows.sort((a, b) => {
      const x = a.sortValues[key], y = b.sortValues[key];
      if (key === 'name') return dir * x.localeCompare(y);
      // Les valeurs absentes restent en bas, quel que soit le sens du tri.
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.isFinite(y) - Number.isFinite(x);
      return dir * (x - y);
    });
  }

  function sortHeader(key, label, title, cls = '') {
    const on = ui.sort.key === key;
    const btn = h('button', {
      type: 'button', class: 'cmp-sort' + (on ? ' is-on' : ''), title: title || null, 'aria-label': t('compare.art.sort', { c: title || label }),
      onclick: () => { ui.sort = { key, dir: on ? -ui.sort.dir : (key === 'name' ? 1 : -1) }; render(); },
    }, label, h('span', { class: 'cmp-sort-arrow', 'aria-hidden': 'true' }, on ? (ui.sort.dir > 0 ? '▲' : '▼') : ''));
    return h('th', { class: cls, scope: 'col', 'aria-sort': on ? (ui.sort.dir > 0 ? 'ascending' : 'descending') : 'none', dataset: { sort: key } }, btn);
  }

  /** Cellule d'un indicateur calculé, avec le repère « dans / hors » de l'intervalle annoncé quand il existe. */
  function computedCell(col, row) {
    const { res } = row;
    if (!res) return h('td', { class: 'num dim' }, '…');
    if (!res.m) return h('td', { class: 'num' }, '—');
    const v = col.value(res);
    if (!Number.isFinite(v)) return h('td', { class: 'num' }, '—');
    const range = REFERENCE_HYPOTHESES[row.site.id]?.[col.hyp];
    let mark = null;
    if (range) {
      const inside = v >= range[0] && v <= range[1];
      const span = range[0] === range[1] ? col.range(range[0]) : `${col.range(range[0])}–${col.range(range[1])}`;
      mark = h('span', { class: 'cmp-ref ' + (inside ? 'is-in' : 'is-out'), title: t(inside ? 'compare.art.in.help' : 'compare.art.out.help') },
        `${inside ? '✓' : '✗'} ${t(inside ? 'compare.art.in' : 'compare.art.out')} ${span}`);
    }
    return h('td', { class: 'num', dataset: { col: col.key } }, h('span', { class: 'cmp-val' }, col.text(res, v)), mark);
  }

  function pointLine(row) {
    const { res } = row;
    if (!res) return null;
    if (res.error) return h('div', { class: 'cmp-sub' }, t('compare.error'));
    if (res.noPixel) return h('div', { class: 'cmp-sub' }, t('compare.art.noPixel', { s: slopeLimit() }));
    return h('div', { class: 'cmp-sub mono' }, fmtLatLon(res.pt.lat, res.pt.lon, 2, state.lang),
      res.pgda ? h('span', { class: 'cmp-pgda' }, t('compare.art.pgda', { sun: nb(pct(res.pgda.sunAvgPct, 0)), earth: nb(pct(res.pgda.earthAvgPct, 0)) })) : null);
  }

  function addRow(row) {
    const { site, res } = row;
    const sel = variant() === 'centre' || !res.pgda ? siteSelection(site) : regionPointSelection(site, variant(), res.pt);
    if (addToCompare(sel)) toast(t('compare.art.added', { name: sel.name }), 'ok');
  }

  function renderTable() {
    const rows = sorted(rowsData());
    if (!rows.length) { put(tableWrap, h('div', { class: 'empty' }, t('compare.art.noSites'))); return; }
    const head = h('thead', {},
      h('tr', {},
        sortHeader('name', t('compare.art.col.region'), null, 'cmp-sticky'),
        h('th', { colspan: CRITERIA.length + 3, class: 'cmp-art-grp', scope: 'colgroup' }, t('compare.art.group.ref'), provTag('hypothesis')),
        h('th', { colspan: COMPUTED.length, class: 'cmp-art-grp', scope: 'colgroup' }, t(variant() === 'centre' ? 'compare.art.group.comp.centre' : 'compare.art.group.comp'), provTag('computed')),
        h('th', { rowspan: 2 })),
      h('tr', {},
        h('th', { class: 'cmp-sticky cmp-art-point' }, t('compare.art.point')),
        CRITERIA.map((c) => sortHeader(c, t('compare.art.crit.' + c), t('crit.' + c), 'num')),
        sortHeader('recalc', t('compare.art.col.recalc'), t('compare.art.col.recalc.help'), 'num'),
        sortHeader('stated', t('compare.art.col.stated'), t('compare.art.col.stated.help'), 'num'),
        sortHeader('delta', t('compare.art.col.delta'), t('compare.art.col.delta.help'), 'num'),
        COMPUTED.map((c) => sortHeader(c.key, t(`compare.art.col.${c.key}`, { s: slopeLimit() }), t(`compare.art.col.${c.key}.help`), 'num'))));
    const body = h('tbody', {}, rows.map((row) => {
      const { site, ref, recalc, res } = row;
      const delta = ref ? tidy(recalc - ref.stated, 2) : NaN;
      return h('tr', { dataset: { region: site.id } },
        h('th', { class: 'cmp-sticky', scope: 'row' }, h('span', { class: 'cmp-art-name' }, site.name), pointLine(row)),
        CRITERIA.map((c) => h('td', { class: 'num' }, ref ? num(ref[c], 1) : '—')),
        h('td', { class: 'num cmp-strong', dataset: { col: 'recalc' } }, num(recalc, 2)),
        h('td', { class: 'num' }, ref ? num(ref.stated, 1) : '—'),
        h('td', { class: 'num' }, Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${num(delta, 2)}` : '—'),
        COMPUTED.map((c) => computedCell(c, row)),
        h('td', {}, h('button', {
          type: 'button', class: 'iconbtn boxed', title: t('compare.art.add', { name: site.name }), 'aria-label': t('compare.art.add', { name: site.name }),
          disabled: !res || !res.pt, onclick: () => addRow(row),
        }, icon('plus'))));
    }));
    put(tableWrap, h('table', { class: 'table cmp-art-table' }, head, body));
  }

  function render() {
    const period = getPeriod(), p = state.params;
    banner.textContent = variant() === 'centre' ? t('compare.art.banner') : t('compare.art.banner.point', { s: slopeLimit() });
    put(toolbar, 
      h('span', { class: 'cmp-label' }, t('compare.art.point')),
      h('div', { class: 'seg cmp-variant', role: 'group', 'aria-label': t('compare.art.point') }, VARIANTS.map((v) => h('button', {
        type: 'button', class: variant() === v ? 'is-on' : '', 'aria-pressed': String(variant() === v), disabled: !pgdaOk && v !== 'centre', dataset: { variant: v },
        onclick: () => { ui.variant = v; refresh(); },
      }, v === 'both' ? t('compare.art.point.pgda', { v: t('compare.variant.both') }) : t('compare.variant.' + v)))),
      pgdaOk ? null : h('span', { class: 'cmp-fine' }, t('compare.art.noPgda')));
    put(progress, 
      h('span', { class: 'cmp-fine' }, t('compare.art.context', { p: t('compare.period.' + period), d: dateUTC(state.timeMs), s: slopeLimit(), r: nb(km(p.landingRadiusM, 1)) })),
      status.running
        ? h('span', { class: 'cmp-art-run' }, h('span', { class: 'bar' }, h('i', { style: { width: `${(100 * status.i) / Math.max(1, status.n)}%` } })), t('compare.art.progress', { i: status.i, n: status.n }))
        : status.ms !== null ? h('span', { class: 'cmp-fine', dataset: { ms: status.ms.toFixed(0) } }, t('compare.art.done', { n: status.n, s: num(status.ms / 1000, 1) })) : null);
    renderTable();
    legend.textContent = t('compare.art.legend');
  }

  render();
  return { el: details, refresh, suspend };
}
