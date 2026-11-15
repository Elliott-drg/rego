// Vue « Comparer » : analyse d'un scénario (site + date) et modèle du tableau des critères.
// Tout vient de science/engine.js ; ce module ne fait que ranger les résultats et les mettre en forme.
// Le même modèle sert au tableau, à l'export CSV et aux phrases d'analyse : un chiffre affiché à un
// endroit est donc le même partout.

import { state } from '../../core/store.js';
import { t, num, pct, deg, temp, duration, meters, km } from '../../core/i18n.js';
import { siteNow, siteTransitions, siteWindow, siteTemperatureNow, pointInfo, terrainAround, DAY_MS, HOUR_MS } from '../../science/engine.js';
import { referenceNotes, computedNotes, weightedScore, CRITERIA } from '../../science/scoring.js';
import { getSite } from '../../data/sites.js';
import { nb } from './util.js';

export const LETTERS = ['A', 'B', 'C'];
export const SERIES = ['a', 'b', 'c'];          // noms des couleurs de série dans palettes.cat()
export const REGION_VARIANTS = ['both', 'sun', 'earth'];

/** Date effective d'un scénario : la sienne, sinon la date courante de l'application. */
export const scenarioDate = (sc) => sc.dateMs ?? state.timeMs;

/** Scénario au format de store.addToCompare (les champs absents ne sont pas créés). */
export function toScenario(sel, dateMs = null) {
  const sc = { key: sel.key, name: sel.name, lat: sel.lat, lon: sel.lon, kind: sel.kind || 'point', dateMs };
  if (sel.siteId) sc.siteId = sel.siteId;
  return sc;
}

/** Point choisi dans une région Artemis (clé `<région>:both|sun|earth`) : renvoie la variante, sinon null. */
export function regionVariant(sc) {
  const m = /^(.+):(both|sun|earth)$/.exec(sc.key || '');
  return m && sc.siteId === m[1] ? m[2] : null;
}
/** Sélection d'un point de région, selon la convention reconnue par le panneau du site. */
export function regionPointSelection(site, variant, pt) {
  return { key: `${site.id}:${variant}`, name: `${site.name} — ${t('compare.variant.' + variant)}`, lat: pt.lat, lon: pt.lon, kind: 'artemis', siteId: site.id, regionId: site.id, variant };
}
/** Nom affiché : pour un point de région, le suffixe suit la langue courante. */
export function displayName(sc) {
  const v = regionVariant(sc), site = v ? getSite(sc.siteId) : null;
  return site ? `${site.name} — ${t('compare.variant.' + v)}` : (sc.name || sc.key);
}

// ---- Prochains lever/coucher ----
// engine.siteTransitions balaie jusqu'à 400 jours : coûteux pendant la lecture, où la date change à
// chaque seconde. Or le prochain basculement reste le même tant qu'on ne l'a pas dépassé : on garde
// donc le dernier résultat par site et on ne recalcule qu'une fois le basculement franchi.
const trCache = [];
const TR_KEEP_NONE_MS = 20 * DAY_MS;            // durée de validité d'un « aucun basculement sous 400 j »
function transitions(site, timeMs, sunUp, earthUp) {
  const key = `${site.lat.toFixed(5)},${site.lon.toFixed(5)}|${state.params.mastM}|${state.params.earthMarginDeg}`;
  const still = (c, b, up) => b.now === up && (b.nextMs !== null ? timeMs < b.nextMs : timeMs - c.atMs < TR_KEEP_NONE_MS);
  const hit = trCache.find((c) => c.key === key && timeMs >= c.atMs && still(c, c.tr.sun, sunUp) && still(c, c.tr.earth, earthUp));
  if (hit) return hit.tr;
  const tr = siteTransitions(site, timeMs);
  trCache.push({ key, atMs: timeMs, tr });
  if (trCache.length > 12) trCache.shift();
  return tr;
}

/**
 * Analyse complète d'un scénario pour la période d'étude ('lunarDay' | 'year').
 * Les scores ne sont pas stockés ici : ils dépendent des poids courants (voir buildRows).
 */
export function analyze(sc, period) {
  const site = { lat: sc.lat, lon: sc.lon }, dateMs = scenarioDate(sc);
  const now = siteNow(site, dateMs);
  const sunUp = now.sun.fraction > 0, earthUp = !!now.earth.visible;
  const tr = transitions(site, dateMs, sunUp, earthUp);
  const win = siteWindow(site, period, dateMs);
  const ter = terrainAround(site);
  const ref = sc.kind === 'artemis' && sc.siteId ? referenceNotes(sc.siteId) : null;
  return {
    sc, site, dateMs, now, sunUp, earthUp, tr, win, m: win.metrics, ter,
    tempK: siteTemperatureNow(site, dateMs),
    info: pointInfo(sc.lat, sc.lon),
    ref,
    comp: computedNotes({ metrics: win.metrics, terrain: ter.stats, psrFrac: ter.psrFrac }, ref),
  };
}

// ---- Tableau des critères ----
const MISSING = { main: '—', missing: true };
/** Arrondi à `digits` décimales, sans zéro négatif (pour ne jamais afficher « -0,0 »). */
export function tidy(v, digits = 1) { const k = 10 ** digits; return Math.round(v * k) / k + 0; }
const deg1 = (v) => deg(tidy(v), 1);
const signedDeg = (v) => `${tidy(v) > 0 ? '+' : ''}${deg1(v)}`;
const dayUnit = () => t('compare.unit.days');
/** Nombre pour le CSV : décimale selon la langue, sans séparateur de milliers (lisible par un tableur). */
export function csvNum(v, digits = 1) {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(digits);
  return state.lang === 'fr' ? s.replace('.', ',') : s;
}
function nextText(body, up, hours) {
  if (!Number.isFinite(hours)) return t('compare.next.none');
  const key = body === 'sun' ? (up ? 'sunset' : 'sunrise') : (up ? 'earthLoss' : 'earthBack');
  return t('compare.next.' + key, { d: nb(duration(hours)) });
}
export const sunNextText = (a) => nextText('sun', a.sunUp, hoursTo(a, a.tr.sun));
export const earthNextText = (a) => nextText('earth', a.earthUp, hoursTo(a, a.tr.earth));
function hoursTo(a, b) { return b.nextMs === null ? NaN : Math.max(0, (b.nextMs - a.dateMs) / HOUR_MS); }

export function groupTitle(group, period) {
  return t(group === 'period' ? `compare.group.period.${period}` : `compare.group.${group}`);
}

/**
 * Lignes du tableau. Chaque ligne : {id, group, label, help?, prov, provTitle?, better:'high'|'low'|null, unit, wrap (cellule de texte),
 * value(a) → nombre (NaN si absent), cell(a, v) → {main, sub?, missing?, title?}, csv(a, v) → texte, basis?(a)}.
 * `better` null = ligne descriptive (pas de « meilleur »).
 */
export function buildRows() {
  const p = state.params, rows = [];
  const add = (group, id, o) => {
    const fmt = o.fmt || ((v) => num(v, 1));
    rows.push({
      group, id, prov: o.prov, provTitle: o.provTitle ? t(`compare.row.${id}.prov`) : null, better: o.better ?? null, unit: o.unit ?? '', basis: o.basis, wrap: !!o.wrap,
      label: t('compare.row.' + id, o.vars), help: o.help ? t(`compare.row.${id}.help`) : null,
      value: o.value,
      cell: o.cell || ((a, v) => (Number.isFinite(v) ? { main: fmt(v) } : MISSING)),
      csv: o.csv || ((a, v) => csvNum(v, o.digits ?? 1)),
    });
  };
  const pct1 = (v) => pct(v, 1), pct0 = (v) => pct(v, 0);
  // Nuit ou coupure la plus longue qui touche la période : le moteur en donne la durée RÉELLE (prolongée
  // avant et après la période). « Plus de 400 j » quand il n'en trouve pas la fin dans les 400 jours explorés.
  const longest = (field, censoredField, beyondField, noneKey) => ({
    value: (a) => a.m[field],
    cell: (a, v) => {
      if (!Number.isFinite(v)) return MISSING;
      if (a.m[censoredField]) return { main: t('compare.over400') };
      return { main: v === 0 ? t(noneKey) : duration(v), sub: a.m[beyondField] ? t('compare.beyond') : null };
    },
    csv: (a, v) => (a.m[censoredField] ? t('compare.over400') : csvNum(v / 24, 2)),
    unit: dayUnit(), better: 'low', prov: 'computed', help: true,
  });

  // À la date du scénario
  add('date', 'sunEl', { prov: 'computed', unit: '°', value: (a) => a.now.sun.el, fmt: deg1, digits: 2 });
  add('date', 'sunDisc', {
    prov: 'computed', unit: '%', better: 'high', value: (a) => 100 * a.now.sun.fraction, digits: 0,
    cell: (a, v) => (Number.isFinite(v) ? { main: pct0(v), sub: t(a.sunUp ? 'compare.visible' : 'compare.hidden') } : MISSING),
  });
  add('date', 'earthEl', { prov: 'computed', unit: '°', value: (a) => a.now.earth.el, fmt: deg1, digits: 2 });
  add('date', 'earthMargin', { prov: 'computed', unit: '°', better: 'high', value: (a) => a.now.earth.aboveDeg, fmt: signedDeg, digits: 2 });
  add('date', 'earthVisible', {
    prov: 'computed', better: 'high', vars: { m: deg(p.earthMarginDeg, 1) }, value: (a) => (a.earthUp ? 1 : 0),
    cell: (a) => ({ main: t(a.earthUp ? 'ui.yes' : 'ui.no') }), csv: (a) => t(a.earthUp ? 'ui.yes' : 'ui.no'),
  });
  add('date', 'sunNext', { prov: 'computed', wrap: true, value: (a) => hoursTo(a, a.tr.sun), cell: (a) => ({ main: sunNextText(a) }), csv: (a) => sunNextText(a) });
  add('date', 'earthNext', { prov: 'computed', wrap: true, value: (a) => hoursTo(a, a.tr.earth), cell: (a) => ({ main: earthNextText(a) }), csv: (a) => earthNextText(a) });
  add('date', 'tempNow', { prov: 'model', unit: 'K', value: (a) => a.tempK, fmt: (v) => temp(v), digits: 0 });

  // Sur la période d'étude
  add('period', 'sunPct', { prov: 'computed', unit: '%', better: 'high', value: (a) => a.m.sunPct, fmt: pct1 });
  add('period', 'sunDiscAvg', { prov: 'computed', unit: '%', better: 'high', help: true, value: (a) => a.m.sunDiscPct, fmt: pct1 });
  add('period', 'night', longest('longestNightH', 'nightCensored', 'nightBeyondWindow', 'compare.noNight'));
  add('period', 'power', { prov: 'computed', unit: '%', better: 'high', help: true, value: (a) => a.m.powerVerticalPct, fmt: pct1 });
  add('period', 'earthPct', { prov: 'computed', unit: '%', better: 'high', value: (a) => a.m.earthPct, fmt: pct1 });
  add('period', 'blackout', longest('longestBlackoutH', 'blackoutCensored', 'blackoutBeyondWindow', 'compare.noBlackout'));
  add('period', 'both', { prov: 'computed', unit: '%', better: 'high', value: (a) => a.m.bothPct, fmt: pct1 });
  add('period', 'sunElMax', { prov: 'computed', unit: '°', value: (a) => a.m.sunElMax, fmt: deg1, digits: 2 });
  add('period', 'earthElMax', { prov: 'computed', unit: '°', value: (a) => a.m.earthElMax, fmt: deg1, digits: 2 });

  // Terrain
  add('terrain', 'height', { prov: 'measured', unit: 'm', help: true, value: (a) => a.info.heightM, fmt: meters, digits: 0 });
  add('terrain', 'slope', { prov: 'computed', unit: '°', better: 'low', value: (a) => a.info.slopeDeg, fmt: deg1, digits: 2 });
  add('terrain', 'slopeOk', {
    prov: 'computed', unit: '%', better: 'high', vars: { s: deg(p.slopeLimitDeg, 0), r: km(p.landingRadiusM, 1) },
    value: (a) => (a.ter.stats ? 100 * a.ter.stats.fracBelow : NaN), fmt: pct0, digits: 1,
  });
  add('terrain', 'slopeKm2', { prov: 'computed', unit: 'km²', better: 'high', value: (a) => (a.ter.stats ? a.ter.stats.areaBelowKm2 : NaN), fmt: (v) => nb(`${num(v, 1)} km²`), digits: 2 });
  add('terrain', 'psr', { prov: 'derived', unit: '%', value: (a) => 100 * a.ter.psrFrac, fmt: pct0, digits: 1 });

  // Produits NASA au point
  add('nasa', 'sunAvg', { prov: 'derived', unit: '%', better: 'high', value: (a) => a.info.sunAvgPct, fmt: pct0, digits: 1 });
  add('nasa', 'earthAvg', { prov: 'derived', unit: '%', better: 'high', value: (a) => a.info.earthAvgPct, fmt: pct0, digits: 1 });
  add('nasa', 'tmax', { prov: 'measured', unit: 'K', value: (a) => a.info.tmaxK, fmt: (v) => temp(v), digits: 1 });
  add('nasa', 'tmin', { prov: 'measured', unit: 'K', value: (a) => a.info.tminK, fmt: (v) => temp(v), digits: 1 });

  // Notes (dépendent des poids courants)
  const score = (v) => `${num(v, 2)} / 10`;
  add('score', 'refScore', {
    prov: 'hypothesis', unit: '/10', better: 'high', digits: 2, value: (a) => (a.ref ? weightedScore(a.ref) : NaN),
    cell: (a, v) => (Number.isFinite(v) ? { main: score(v) } : { ...MISSING, title: a.ref ? null : t('compare.score.noRef') }),
  });
  const rated = (a) => CRITERIA.filter((c) => Number.isFinite(a.comp.notes[c]));
  add('score', 'compScore', {
    // Mélange de notes calculées, d'un indice (eau) et de notes reprises du cahier des charges : une estimation.
    prov: 'estimate', provTitle: true, unit: '/10', better: 'high', digits: 2, value: (a) => weightedScore(a.comp.notes),
    // Un score établi sur moins de critères n'est pas comparable aux autres : on le dit et on ne désigne pas de meilleur.
    basis: (a) => rated(a).join(','),
    cell: (a, v) => (Number.isFinite(v) ? { main: score(v), sub: rated(a).length < CRITERIA.length ? t('compare.score.partial', { n: rated(a).length }) : null } : MISSING),
  });
  return rows;
}

/**
 * Meilleur scénario d'une ligne. Égalité = même valeur affichée (l'écart est sous la précision d'affichage).
 * @returns {null | {winners:number[], tie:boolean, reason?:'single'|'mixed'}}
 */
function bestOf(row, analyses, values, cells) {
  if (!row.better) return null;
  const valid = analyses.map((a, i) => (a && Number.isFinite(values[i]) ? i : -1)).filter((i) => i >= 0);
  if (valid.length < 2) return { winners: [], tie: false, reason: 'single' };
  if (row.basis && new Set(valid.map((i) => row.basis(analyses[i]))).size > 1) return { winners: [], tie: false, reason: 'mixed' };
  const top = valid.reduce((b, i) => ((row.better === 'high' ? values[i] > values[b] : values[i] < values[b]) ? i : b), valid[0]);
  const winners = valid.filter((i) => cells[i].main === cells[top].main);
  return { winners, tie: winners.length === valid.length };
}

/** Modèle complet du tableau : pour chaque ligne, valeurs brutes, cellules affichées et meilleur. */
export function tableModel(analyses) {
  return buildRows().map((row) => {
    const values = analyses.map((a) => (a ? row.value(a) : NaN));
    const cells = analyses.map((a, i) => (a ? row.cell(a, values[i]) : MISSING));
    return { row, values, cells, best: bestOf(row, analyses, values, cells) };
  });
}

/** Texte de la colonne « Meilleur » (lettres, ou « égalité »), vide s'il n'y en a pas. */
export function bestText(best) {
  if (!best || !best.winners.length) return '';
  return best.tie ? t('compare.tie') : best.winners.map((i) => LETTERS[i]).join(' = ');
}

// ---- Export CSV ----
const isoUTC = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const csvField = (s) => { const v = String(s ?? ''); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

/**
 * Toutes les lignes du tableau, séparateur « ; », en-têtes dans la langue courante.
 * Les lignes numériques sont exportées en nombres (unité dans sa colonne), les autres en texte.
 */
export function buildCsv(scenarios, analyses, model, period) {
  const cols = scenarios.map((_, i) => LETTERS[i]);
  const lines = [[t('compare.csv.section'), t('compare.csv.indicator'), t('compare.csv.unit'), t('compare.csv.prov'), ...cols, t('compare.table.best'), t('compare.csv.rule')]];
  const meta = (label, unit, fn) => lines.push([t('compare.csv.meta'), label, unit, '', ...scenarios.map((sc, i) => fn(sc, analyses[i])), '', '']);
  meta(t('compare.csv.site'), '', (sc) => displayName(sc));
  meta(t('compare.csv.kind'), '', (sc) => t('kind.' + sc.kind));
  meta(t('compare.csv.lat'), '°', (sc) => csvNum(sc.lat, 4));
  meta(t('compare.csv.lon'), '°', (sc) => csvNum(sc.lon, 4));
  meta(t('compare.csv.date'), '', (sc) => isoUTC(scenarioDate(sc)));
  meta(t('compare.csv.periodStart'), '', (sc, a) => (a ? isoUTC(a.win.t0Ms) : ''));
  meta(t('compare.csv.periodDays'), dayUnit(), (sc, a) => (a ? csvNum(a.win.spanMs / DAY_MS, 2) : ''));
  for (const { row, values, best } of model) {
    lines.push([
      groupTitle(row.group, period), row.label, row.unit, t('prov.' + row.prov),
      ...analyses.map((a, i) => (a ? row.csv(a, values[i]) : '')),
      bestText(best), row.better ? t('compare.rule.' + row.better) : '',
    ]);
  }
  // BOM : sans lui, un tableur lit les accents de travers.
  return '\ufeff' + lines.map((l) => l.map(csvField).join(';')).join('\r\n') + '\r\n';
}
