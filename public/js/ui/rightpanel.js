// Panneau droit : fiche du lieu sélectionné. Tout vient du moteur (science/engine.js) et du registre de données.
import { state, set, on, select, addToCompare, emit, toast } from '../core/store.js';
import { t, num, pct, deg, temp, duration, dateUTC, meters } from '../core/i18n.js';
import { h, clear, row, provTag, button, throttle } from './dom.js';
import { icon } from './icons.js';
import { fmtLatLon } from '../core/coords.js';
import * as engine from '../science/engine.js';
import { getSite, sitesOfKind, siteSelection } from '../data/sites.js';
import { sampleHydrogen, dataLoaded } from '../data/registry.js';
import { lineChart, scoreBars } from '../views/charts.js';
import { cat } from '../layers/palettes.js';
import { referenceNotes, weightedScore, computedNotes, CRITERIA, getWeights } from '../science/scoring.js';
import { REFERENCE_HYPOTHESES, REFERENCE_GENERAL } from '../data/reference.js';
import { actions } from './shell.js';

let sky = null, skyHost = null, skyModule = null;
let periodKind = 'lunarDay';
const sec = (title, ...kids) => h('section', { class: 'sec' }, h('h3', { class: 'sec-title' }, title), kids);
const stat = (label, value, sub, ic) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, ic ? icon(ic, 14) : null, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);
const fin = Number.isFinite;

function emptyState(el) {
  const picks = sitesOfKind('artemis').slice(0, 9);
  el.append(h('div', { class: 'panel-pad' },
    h('div', { class: 'eyebrow' }, t('right.eyebrow.none')),
    h('div', { class: 'panel-title' }, t('right.none.title')),
    h('p', { class: 'muted' }, t('right.none.text')),
    h('div', { class: 'quickpicks' }, picks.map((s) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { select(siteSelection(s)); emit('view:flyTo', { lat: s.lat, lon: s.lon }); } }, s.name))),
    h('p', { class: 'note note-info', style: { marginTop: '14px' } }, t('right.none.hint'))));
}

// ---- Bloc « maintenant » de secours (si le module panorama n'est pas chargé)
function nowFallback(site) {
  const n = engine.siteNow(site), tr = engine.siteTransitions(site);
  const when = (x, lost, back) => (x.nextMs ? `${x.now ? lost : back} ${duration((x.nextMs - state.timeMs) / 3600e3)}` : t('right.noChange'));
  return h('div', { class: 'stat-grid' },
    stat(t('body.sun'), n.sun.fraction > 0 ? pct(n.sun.fraction * 100) : t('right.sun.hidden'), `${t('right.elev')} ${deg(n.sun.el, 2)} · ${when(tr.sun, t('right.sunsetIn'), t('right.sunriseIn'))}`, 'sun'),
    stat(t('body.earth'), n.earth.visible ? t('right.earth.visible') : t('right.earth.hidden'), `${t('right.elev')} ${deg(n.earth.el, 2)} · ${when(tr.earth, t('right.earthsetIn'), t('right.earthriseIn'))}`, 'earth'));
}

function periodBlock(site) {
  const w = engine.siteWindow(site, periodKind), m = w.metrics, S = w.series;
  const days = (hrs, censored) => (censored ? t('right.wholePeriod') : hrs === 0 ? t('right.zero') : duration(hrs));
  const beyond = m.nightBeyondWindow || m.blackoutBeyondWindow;
  const xs = (i) => (S.t0Ms + i * S.stepMs - w.t0Ms) / 86400e3;
  const stride = Math.max(1, Math.floor(S.n / 360));
  const pts = (arr) => { const o = []; for (let i = 0; i < S.n; i += stride) o.push([xs(i), arr[i]]); return o; };
  const hz = engine.siteNow(site).horizon;
  const chartEl = lineChart([
    { name: t('body.sun'), color: cat('sun', state.cvd), points: pts(S.sunEl), dash: '' },
    { name: t('body.earth'), color: cat('earth', state.cvd), points: pts(S.earthEl), dash: '6 4' },
  ], { width: 340, height: 170, xLabel: t('right.chart.days'), yLabel: t('right.chart.elev'), hlines: [{ y: 0, color: '#74839b', label: t('right.chart.zero') }], vline: { x: (state.timeMs - w.t0Ms) / 86400e3 }, xFormat: (v) => num(v, 0) });
  const tPts = []; for (let i = 0; i < S.n; i += stride) tPts.push([xs(i), w.temps[i]]);
  const info = engine.pointInfo(site.lat, site.lon);
  const tChart = lineChart([{ name: t('right.temp.model'), color: cat('warn', state.cvd), points: tPts, dash: '' }], {
    width: 340, height: 150, xLabel: t('right.chart.days'), yLabel: 'K', xFormat: (v) => num(v, 0), yFormat: (v) => num(v, 0), vline: { x: (state.timeMs - w.t0Ms) / 86400e3 },
    hlines: [fin(info.tmaxK) ? { y: info.tmaxK, color: cat('bad', state.cvd), label: t('right.temp.divMax') } : null, fin(info.tminK) ? { y: info.tminK, color: cat('earth', state.cvd), label: t('right.temp.divMin') } : null].filter(Boolean),
  });
  return [
    h('div', { class: 'seg seg-full' }, [['lunarDay', t('right.period.lunar')], ['year', t('right.period.year', { y: new Date(state.timeMs).getUTCFullYear() })]].map(([k, l]) =>
      h('button', { type: 'button', class: periodKind === k ? 'is-on' : '', onclick: () => { periodKind = k; rerender(true); } }, l))),
    h('div', { class: 'stat-grid', style: { marginTop: '8px' } },
      stat(t('right.m.sun'), pct(m.sunPct, 1), `${t('right.m.night')} ${days(m.longestNightH, m.nightCensored)}`, 'sun'),
      stat(t('right.m.earth'), pct(m.earthPct, 1), `${t('right.m.blackout')} ${days(m.longestBlackoutH, m.blackoutCensored)}`, 'antenna'),
      stat(t('right.m.both'), pct(m.bothPct, 1), `${t('right.m.bothLongest')} ${duration(m.longestBothH)}`, 'check'),
      stat(t('right.m.power'), pct(m.powerVerticalPct, 1), t('right.m.powerSub', { h: pct(m.powerHorizontalPct, 1) }), 'bolt')),
    h('div', { class: 'tagline' }, provTag('computed'), ' ', hz.terrain ? t('right.m.method', { m: num(state.params.mastM, 0) }) : t('right.m.methodSmooth'), beyond ? ' ' + t('right.beyond') : ''),
    h('div', { class: 'chartbox' }, chartEl, h('div', { class: 'chart-legend' },
      h('span', {}, h('i', { style: { borderColor: cat('sun', state.cvd) } }), t('body.sun')), h('span', {}, h('i', { style: { borderColor: cat('earth', state.cvd), borderTopStyle: 'dashed' } }), t('body.earth')))),
    h('div', { class: 'expert-only' }, row(t('right.m.sunElMax'), deg(m.sunElMax, 2), { prov: 'computed' }), row(t('right.m.earthElMax'), deg(m.earthElMax, 2), { prov: 'computed' }),
      row(t('right.m.disc'), pct(m.sunDiscPct, 1), { prov: 'computed', note: fin(info.sunAvgPct) ? t('right.m.discNote', { v: pct(info.sunAvgPct, 1), m: num(state.params.mastM, 0) }) : null }),
      row(t('right.m.step'), `${num(S.stepMs / 60000, 0)} min · ${S.n} ${t('right.m.samples')}`)),
    h('h4', { class: 'subhead' }, t('right.temp.title')),
    h('div', { class: 'chartbox' }, tChart),
    h('div', { class: 'tagline' }, provTag('model'), ' ', w.floorFromDiviner ? t('right.temp.noteDiviner') : t('right.temp.note')),
  ];
}

function terrainBlock(site) {
  const info = engine.pointInfo(site.lat, site.lon);
  const out = [];
  out.push(row(t('right.t.height'), meters(info.heightM), { prov: fin(info.heightM) ? 'measured' : 'missing', icon: 'mountain', note: info.heightSource === 'lola4ppd' ? t('right.t.height4') : null }));
  if (info.polar) {
    const ta = engine.terrainAround(site);
    out.push(row(t('right.t.slope'), deg(info.slopeDeg, 1), { prov: 'computed', icon: 'slope', note: t('right.t.slopeNote') }));
    if (ta.stats) {
      out.push(row(t('right.t.landable', { s: num(state.params.slopeLimitDeg, 0), r: num(state.params.landingRadiusM / 1000, 1) }), pct(ta.stats.fracBelow * 100, 0), { prov: 'computed', note: t('right.t.landableNote', { a: num(ta.stats.areaBelowKm2, 1), tot: num(ta.stats.areaKm2, 1) }) }));
      out.push(h('div', { class: 'expert-only' }, row(t('right.t.slopeMean'), `${deg(ta.stats.meanDeg, 1)} / ${deg(ta.stats.maxDeg, 1)}`, { prov: 'computed' }), row(t('right.t.relief'), `${meters(ta.stats.hMin)} → ${meters(ta.stats.hMax)}`, { prov: 'measured' }), row(t('right.t.aspect'), deg(info.aspectDeg, 0), { prov: 'computed' })));
    }
  } else out.push(h('div', { class: 'note' }, t('right.t.outside')));
  return out;
}

function productsBlock(site) {
  const info = engine.pointInfo(site.lat, site.lon);
  if (!info.polar) return [h('div', { class: 'note' }, t('right.p.outside'))];
  const v = (x, f) => (fin(x) ? f(x) : '—'), pv = (x) => (fin(x) ? 'derived' : 'missing');
  return [
    row(t('right.p.sunAvg'), v(info.sunAvgPct, (x) => pct(x, 1)), { prov: pv(info.sunAvgPct), icon: 'sun' }),
    row(t('right.p.earthAvg'), v(info.earthAvgPct, (x) => pct(x, 1)), { prov: pv(info.earthAvgPct), icon: 'antenna' }),
    row(t('right.p.tmax'), v(info.tmaxK, (x) => temp(x)), { prov: fin(info.tmaxK) ? 'measured' : 'missing', icon: 'thermo' }),
    row(t('right.p.tavg'), v(info.tavgK, (x) => temp(x)), { prov: fin(info.tavgK) ? 'derived' : 'missing' }),
    row(t('right.p.tmin'), v(info.tminK, (x) => temp(x)), { prov: fin(info.tminK) ? 'measured' : 'missing' }),
    fin(info.tmaxK) ? null : h('div', { class: 'note' }, t('right.p.divinerCover')),
  ];
}

function resourcesBlock(site) {
  const info = engine.pointInfo(site.lat, site.lon), out = [];
  if (info.polar && fin(info.psr)) {
    const ta = engine.terrainAround(site);
    out.push(row(t('right.r.psr'), info.psr > 0 ? t('ui.yes') : t('ui.no'), { prov: 'derived', icon: 'moon' }));
    if (fin(ta.psrFrac)) out.push(row(t('right.r.psrFrac'), pct(ta.psrFrac * 100, 0), { prov: 'computed', note: t('right.r.psrNote') }));
  }
  const hy = sampleHydrogen(site.lat, site.lon);
  if (dataLoaded('lp_hydrogen')) out.push(row(t('right.r.hydrogen'), fin(hy) ? `${num(Math.max(0, hy), 0)} ppm` : '—', { prov: fin(hy) ? 'derived' : 'missing', icon: 'droplet', note: t('right.r.hydrogenNote') }));
  const g = info.lpgrs;
  if (g) {
    const ox = [['FeO', 'FeO'], ['TiO2', 'TiO₂'], ['Al2O3', 'Al₂O₃'], ['CaO', 'CaO'], ['SiO2', 'SiO₂'], ['MgO', 'MgO']].filter(([k]) => fin(g[k]));
    out.push(h('div', { class: 'oxides' }, ox.map(([k, label]) => h('div', { class: 'oxide' }, h('b', {}, label), h('span', { class: 'mono' }, `${num(g[k], 1)} %`)))));
    out.push(h('div', { class: 'tagline' }, provTag('derived'), ' ', t('right.r.grsNote')));
    if (fin(g.Th)) out.push(h('div', { class: 'expert-only' }, row('Th', `${num(g.Th, 2)} ppm`, { prov: 'derived' }), row('K', `${num(g.K, 0)} ppm`, { prov: 'derived' })));
  }
  out.push(h('div', { class: 'note' }, t('right.r.noHe3')));
  return out;
}

// Radiation : seule la géométrie est calculable ici (part du ciel cachée par le relief).
function radiationBlock(site) {
  const hz = engine.siteNow(site).horizon, out = [];
  if (hz.terrain) {
    let sum = 0; for (let i = 0; i < hz.n; i++) sum += Math.sin(Math.max(0, hz.elev[i]) * Math.PI / 180);
    const frac = sum / hz.n;    // angle solide sous l'horizon du relief / demi-sphère du ciel
    out.push(row(t('right.rad.sky'), pct(frac * 100, 1), { prov: 'computed', icon: 'mountain', note: t('right.rad.skyNote') }));
  }
  out.push(row(t('right.rad.gcr'), `${num(REFERENCE_GENERAL.gcrMSvPerDay, 1)} mSv/${state.lang === 'fr' ? 'j' : 'd'}`, { prov: 'hypothesis', note: t('right.rad.gcrNote') }));
  return out;
}

function scoresBlock(site, sel) {
  const ref = sel.siteId ? referenceNotes(sel.siteId) : null;
  const w = engine.siteWindow(site, 'year'), ta = engine.pointInfo(site.lat, site.lon).polar ? engine.terrainAround(site) : { stats: null, psrFrac: NaN };
  const comp = computedNotes({ metrics: w.metrics, terrain: ta.stats, psrFrac: ta.psrFrac }, ref);
  const out = [];
  const globalC = weightedScore(comp.notes);
  if (ref) {
    const globalR = weightedScore(ref);
    out.push(h('div', { class: 'scorehead' },
      h('div', {}, h('div', { class: 'big' }, num(globalR, 1), h('small', {}, '/10')), h('div', { class: 'dim' }, t('right.s.ref')), provTag('hypothesis')),
      h('div', {}, h('div', { class: 'big' }, fin(globalC) ? num(globalC, 1) : '—', h('small', {}, '/10')), h('div', { class: 'dim' }, t('right.s.comp')), provTag('estimate', t('right.s.compHelp')))));
    out.push(scoreBars(CRITERIA.map((c) => ({ label: t('crit.' + c), value: ref[c], max: 10, color: 'var(--accent)' }))));
    out.push(h('div', { class: 'tagline' }, provTag('hypothesis'), ' ', t('right.s.refNote', { v: num(ref.stated, 1) })));
  } else {
    out.push(h('div', { class: 'scorehead' }, h('div', {}, h('div', { class: 'big' }, fin(globalC) ? num(globalC, 1) : '—', h('small', {}, '/10')), h('div', { class: 'dim' }, t('right.s.comp')), provTag('estimate', t('right.s.compHelp')))));
  }
  out.push(h('h4', { class: 'subhead' }, t('right.s.compTitle')));
  out.push(scoreBars(CRITERIA.map((c) => ({ label: t('crit.' + c), value: comp.notes[c], max: 10, color: comp.sources[c] === 'hypothesis' ? 'var(--text-3)' : cat('ok', state.cvd), tag: comp.sources[c] ? provTag(comp.sources[c]) : provTag('missing') }))));
  const wts = getWeights();
  out.push(h('div', { class: 'tagline' }, t('right.s.formula', { w: CRITERIA.map((c) => `${t('crit.' + c)} ${wts[c]}`).join(' · ') })));
  // Hypothèses du cahier des charges confrontées au calcul
  const hyp = sel.siteId ? REFERENCE_HYPOTHESES[sel.siteId] : null;
  if (hyp) {
    const m = w.metrics, rows = [];
    const cmp = (label, range, value, fmt) => {
      if (!range || !fin(value)) return;
      const inside = value >= range[0] - 1e-9 && value <= range[1] + 1e-9;
      rows.push(h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, range[0] === range[1] ? fmt(range[0]) : `${fmt(range[0])} – ${fmt(range[1])}`), h('td', { class: 'num' }, fmt(value)), h('td', {}, inside ? `✓ ${t('right.h.in')}` : `≠ ${t('right.h.out')}`)));
    };
    cmp(t('right.h.earth'), hyp.earthPct, m.earthPct, (x) => pct(x, 0));
    cmp(t('right.h.blackout'), hyp.blackoutDays, m.longestBlackoutH / 24, (x) => num(x, 1));
    cmp(t('right.h.sun'), hyp.sunPct, m.sunPct, (x) => pct(x, 0));
    cmp(t('right.h.night'), hyp.nightDays, m.longestNightH / 24, (x) => num(x, 1));
    if (ta.stats) cmp(t('right.h.slope'), hyp.slopeOkPct, ta.stats.fracBelow * 100, (x) => pct(x, 0));
    if (rows.length) out.push(h('h4', { class: 'subhead' }, t('right.h.title')), h('table', { class: 'table table-sm' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, t('right.h.stated')), h('th', { class: 'num' }, t('right.h.computed', { y: new Date(state.timeMs).getUTCFullYear() })), h('th', {}, ''))), h('tbody', {}, rows)),
      h('div', { class: 'note note-warn' }, t('right.h.note')));
  }
  return out;
}

// Pour une région Artemis : raccourcis vers ses points les plus favorables d'après les cartes moyennes PGDA.
function regionPicks(sel, known) {
  const reg = known?.corners ? known : sel.regionId ? getSite(sel.regionId) : null;
  if (!reg?.corners) return null;
  const best = engine.regionBest(reg.corners);
  if (!best) return null;
  const go = (b, suffix) => () => { select({ key: `${reg.id}:${suffix}`, name: `${reg.name} — ${t('right.best.' + suffix)}`, lat: b.lat, lon: b.lon, kind: 'artemis', siteId: reg.id, regionId: reg.id, variant: suffix }); emit('view:flyTo', { lat: b.lat, lon: b.lon }); };
  const item = (b, suffix, ic) => h('button', { type: 'button', class: 'pick' + (sel.variant === suffix ? ' is-on' : ''), onclick: go(b, suffix) }, icon(ic, 14), h('span', {}, t('right.best.' + suffix)), h('small', { class: 'mono' }, `${pct(b.sunAvgPct, 0)} · ${pct(b.earthAvgPct, 0)}`));
  return h('div', { class: 'picks' },
    h('div', { class: 'picks-title' }, t('right.best.title'), ' ', provTag('derived', t('right.best.help'))),
    sel.variant ? h('button', { type: 'button', class: 'pick', onclick: () => { select(siteSelection(reg)); emit('view:flyTo', { lat: reg.lat, lon: reg.lon }); } }, icon('target', 14), h('span', {}, t('right.best.centre')), h('small', {}, '')) : null,
    item(best.both, 'both', 'check'), item(best.sun, 'sun', 'sun'), item(best.earth, 'earth', 'antenna'),
    h('div', { class: 'picks-note' }, t('right.best.note', { s: num(state.params.slopeLimitDeg, 0) })));
}

let root = null, lastKey = '', nowHost = null, tempHost = null;
function buildSheet() {
  const sel = state.selection;
  clear(root); sky?.destroy?.(); sky = null;
  if (!sel) { emptyState(root); lastKey = ''; return; }
  const site = { lat: sel.lat, lon: sel.lon }, known = sel.siteId ? getSite(sel.siteId) : null;
  const inCompare = state.compare.some((c) => c.key === sel.key);
  root.append(h('div', { class: 'panel-pad sheet-head' },
    h('div', { class: 'sheet-top' }, h('div', { class: 'eyebrow' }, t('kind.' + sel.kind)), h('button', { class: 'iconbtn', type: 'button', title: t('ui.close'), onclick: () => select(null) }, icon('close', 18))),
    h('div', { class: 'panel-title' }, sel.name),
    h('div', { class: 'mono muted' }, fmtLatLon(sel.lat, sel.lon, 3, state.lang), known?.year ? ` · ${known.year}` : '', known?.agency ? ` · ${known.agency}` : ''),
    sel.kind === 'artemis' ? h('div', { class: 'note note-warn', style: { marginTop: '8px' } }, sel.variant ? t('right.artemisVariantNote') : known?.source === 'fallback' ? t('right.artemisFallback') : t('right.artemisNote')) : null,
    regionPicks(sel, known),
    h('div', { class: 'sheet-actions' },
      button(inCompare ? t('right.act.inCompare') : t('right.act.compare'), () => { if (inCompare) { toast(t('right.act.already'), 'info'); return; } addToCompare(sel); toast(t('right.act.compared'), 'ok'); }, { icon: 'compare', small: true, kind: inCompare ? '' : 'primary' }),
      button(t('right.act.energy'), actions.energy, { icon: 'bolt', small: true }),
      button(t('right.act.center'), () => emit('view:flyTo', { lat: sel.lat, lon: sel.lon }), { icon: 'target', small: true }))));
  // Maintenant : panorama d'horizon (module) ou repli
  nowHost = h('div', {}); skyHost = h('div', { class: 'skyhost' }); tempHost = h('div', {});
  root.append(sec(h('span', {}, t('right.now'), ' · ', h('span', { class: 'mono' }, dateUTC(state.timeMs))), skyHost, nowHost, tempHost));
  if (skyModule) { try { sky = skyModule.createSkyView(skyHost); } catch (e) { console.error(e); nowHost.append(nowFallback(site)); } } else nowHost.append(nowFallback(site));
  const tempNow = () => { clear(tempHost); const k = engine.siteTemperatureNow(site); tempHost.append(row(t('right.tempNow'), temp(k), { prov: 'model', icon: 'thermo', strong: true })); };
  tempNow();
  const guard = (title, fn) => { try { root.append(sec(title, fn())); } catch (e) { console.error(e); root.append(sec(title, h('div', { class: 'note note-warn' }, t('right.error')))); } };
  guard(t('right.period'), () => periodBlock(site));
  guard(t('right.terrain'), () => terrainBlock(site));
  guard(t('right.products'), () => productsBlock(site));
  guard(t('right.resources'), () => resourcesBlock(site));
  guard(t('right.radiation'), () => radiationBlock(site));
  guard(t('right.scores'), () => scoresBlock(site, sel));
  root.append(h('div', { class: 'panel-pad dim sheet-foot' }, t('right.foot')));
}
function sheetKey() {
  const s = state.selection; if (!s) return 'none';
  const d = new Date(state.timeMs);
  return [s.key, s.lat, s.lon, state.lang, state.cvd, state.tempUnit, periodKind, JSON.stringify(state.params), d.getUTCFullYear(), periodKind === 'lunarDay' ? Math.floor(state.timeMs / 86400e3) : '', state.compare.map((c) => c.key).join(',')].join('|');
}
function rerender(force = false) {
  const k = sheetKey();
  if (!force && k === lastKey) { refreshNow(); return; }
  lastKey = k; const top = root.scrollTop; buildSheet(); root.scrollTop = top;
}
function refreshNow() {
  const sel = state.selection; if (!sel || !tempHost) return;
  const site = { lat: sel.lat, lon: sel.lon };
  const head = root.querySelector('.sec .sec-title .mono'); if (head) head.textContent = dateUTC(state.timeMs);
  clear(tempHost); tempHost.append(row(t('right.tempNow'), temp(engine.siteTemperatureNow(site)), { prov: 'model', icon: 'thermo', strong: true }));
  if (!sky && nowHost) { clear(nowHost); nowHost.append(nowFallback(site)); }
}

export function mountRight(el) {
  root = el;
  import('../views/skyview.js').then((m) => { skyModule = m; rerender(true); }).catch((e) => { console.warn('[module] panorama indisponible', e.message); });
  rerender(true);
  const slow = throttle(() => rerender(false), 250);
  on('change', (keys) => {
    if (keys.some((k) => ['selection', 'lang', 'cvd', 'tempUnit', 'params', 'compare'].includes(k))) rerender(true);
    else if (keys.includes('timeMs')) slow();
  });
  on('data:ready', throttle(() => rerender(true), 400));
  on('sites:ready', () => rerender(true));
  on('scoring:weights', () => rerender(true));
}
void set;
