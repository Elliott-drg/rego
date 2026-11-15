// Outil de mesure : carte flottante de la vue centrale, visible quand state.tool === 'measure'.
// La carte 2D ajoute les points cliqués à state.measure et trace la polyligne ; ce module calcule et affiche.
//
// Méthodes (rappelées dans l'interface) :
//  - distance de surface : arc de grand cercle sur la sphère de référence (R = 1 737,4 km), sans le relief ;
//  - distance 3D : droite entre les deux points placés à leur hauteur LOLA (corde), somme des cordes pour le total ;
//  - dénivelé : hauteur d'arrivée − hauteur de départ ;
//  - pentes : le long du trajet, entre échantillons consécutifs du profil (pas ≈ 240 m, la maille du MNT).
// Hors de la grille polaire (au nord de 75°S), la hauteur est indisponible : seule la distance de surface est donnée.

import { state, set, on } from '../core/store.js';
import { t, num, deg } from '../core/i18n.js';
import '../i18n/tools.js';
import { surfaceDistance, chordDistance, fmtLatLon, RAD } from '../core/coords.js';
import { heightAt, elevationProfile, hasDem } from '../science/terrain.js';
import { lineChart } from '../views/charts.js';
import { cat } from '../layers/palettes.js';
import { h, clear, button, provTag, download } from './dom.js';
import { icon } from './icons.js';
// Seul module d'outils chargé au démarrage par main.js : on en profite pour relire les jeux importés
// mémorisés (effet de bord de importer.js), sinon ils n'apparaîtraient qu'à l'ouverture de la fenêtre d'import.
import './importer.js';

/**
 * Mesures d'un trajet passant par `points` ({lat, lon}).
 * @returns {{heights:number[], segments:Array, total:object, profile:Array<{d,h,lat,lon,seg}>}}
 *   segment / total : {surfaceM, chordM, dhM, meanSlopeDeg, maxSlopeDeg, stepM, partial} (NaN = indisponible)
 */
export function measurePath(points) {
  const heights = points.map((p) => heightAt(p.lat, p.lon));
  const segments = [], profile = [];
  let offset = 0, slopeSum = 0, slopeLen = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], ha = heights[i - 1], hb = heights[i];
    const surfaceM = surfaceDistance(a.lat, a.lon, b.lat, b.lon);
    const prof = elevationProfile(a, b);
    const known = prof.points.filter((p) => Number.isFinite(p.h)).length;
    const hasSlope = Number.isFinite(prof.meanSlopeDeg);
    segments.push({
      surfaceM,
      chordM: Number.isFinite(ha) && Number.isFinite(hb) ? chordDistance(a.lat, a.lon, ha, b.lat, b.lon, hb) : NaN,
      dhM: hb - ha,
      meanSlopeDeg: prof.meanSlopeDeg,
      maxSlopeDeg: hasSlope ? prof.maxSlopeDeg : NaN,
      stepM: prof.points.length > 1 ? surfaceM / (prof.points.length - 1) : NaN,
      partial: known > 0 && known < prof.points.length,
    });
    // Profil du trajet complet ; la pente moyenne du total est pondérée par la distance parcourue.
    prof.points.forEach((p, k) => {
      if (k === 0 && i > 1) return;   // le premier échantillon d'un segment est le dernier du précédent
      profile.push({ d: offset + p.d, h: p.h, lat: p.lat, lon: p.lon, seg: i });
    });
    for (let k = 1; k < prof.points.length; k++) {
      const dh = prof.points[k].h - prof.points[k - 1].h, dd = prof.points[k].d - prof.points[k - 1].d;
      if (Number.isFinite(dh) && dd > 0) { slopeSum += Math.atan(Math.abs(dh) / dd) * RAD * dd; slopeLen += dd; }
    }
    offset += surfaceM;
  }
  const sum = (key) => segments.reduce((s, x) => s + x[key], 0);
  const slopes = segments.map((s) => s.maxSlopeDeg).filter(Number.isFinite);
  const total = {
    surfaceM: sum('surfaceM'),
    chordM: segments.length ? sum('chordM') : NaN,
    dhM: points.length > 1 ? heights[heights.length - 1] - heights[0] : NaN,
    meanSlopeDeg: slopeLen > 0 ? slopeSum / slopeLen : NaN,
    maxSlopeDeg: slopes.length ? Math.max(...slopes) : NaN,
    partial: segments.some((s) => s.partial) || (slopes.length > 0 && slopes.length < segments.length),
  };
  return { heights, segments, total, profile };
}

/** Profil au format CSV (point décimal, une ligne par échantillon ; hauteur vide si indisponible). */
export function profileToCSV(profile) {
  const lines = ['segment,distance_m,latitude_deg,longitude_deg,height_m'];
  for (const p of profile) lines.push([p.seg, p.d.toFixed(1), p.lat.toFixed(6), p.lon.toFixed(6), Number.isFinite(p.h) ? p.h.toFixed(1) : ''].join(','));
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ Affichage (\u00a0 = espace insécable avant l'unité)
const dist = (m) => (!Number.isFinite(m) ? '—' : m < 1000 ? `${num(m, 0)}\u00a0m` : `${num(m / 1000, m < 100000 ? 2 : 1)}\u00a0km`);
const signed = (m) => (!Number.isFinite(m) ? '—' : `${m > 0 ? '+' : m < 0 ? '−' : ''}${num(Math.abs(m), 0)}\u00a0m`);
const missing = () => h('span', { class: 'measure-missing' }, '—', provTag('missing', t('tools.measure.noHeight')));
const val = (v, text) => (Number.isFinite(v) ? text : missing());

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value mono' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

function totals(m) {
  const tt = m.total;
  // Toutes ces valeurs sont calculées par l'application ; l'infobulle de l'étiquette rappelle comment.
  const prov = (v, key) => (Number.isFinite(v) ? provTag('computed', t(key)) : null);
  return h('div', { class: 'stat-grid measure-totals' },
    stat(t('tools.measure.surface'), dist(tt.surfaceM), prov(tt.surfaceM, 'tools.measure.surface.help')),
    stat(t('tools.measure.chord'), val(tt.chordM, dist(tt.chordM)), prov(tt.chordM, 'tools.measure.chord.help')),
    stat(t('tools.measure.dh'), val(tt.dhM, signed(tt.dhM)), prov(tt.dhM, 'tools.measure.dh.help')),
    stat(t('tools.measure.slopes'), val(tt.meanSlopeDeg, `${deg(tt.meanSlopeDeg)} / ${deg(tt.maxSlopeDeg)}`),
      tt.partial ? t('tools.measure.partial') : prov(tt.meanSlopeDeg, 'tools.measure.slopes.help')));
}

function segmentTable(m) {
  const th = (key, span) => h('th', { class: 'num', title: t(key + '.help'), rowspan: span }, t(key + '.short'));
  return h('div', { class: 'measure-segs' }, h('table', { class: 'table' },
    h('thead', {},
      h('tr', {}, h('th', { rowspan: 2, title: t('tools.measure.seg') }, t('tools.measure.seg.short')), th('tools.measure.surface', 2), th('tools.measure.chord', 2), th('tools.measure.dh', 2),
        h('th', { class: 'measure-th-group', colspan: 2 }, t('tools.measure.slope'))),
      h('tr', {}, th('tools.measure.mean'), th('tools.measure.max'))),
    h('tbody', {}, m.segments.map((s, i) => h('tr', {},
      h('td', { class: 'mono' }, `${i + 1}→${i + 2}`),
      h('td', { class: 'num' }, dist(s.surfaceM)),
      h('td', { class: 'num' }, Number.isFinite(s.chordM) ? dist(s.chordM) : '—'),
      h('td', { class: 'num' }, signed(s.dhM)),
      h('td', { class: 'num' }, deg(s.meanSlopeDeg)),
      h('td', { class: 'num' }, deg(s.maxSlopeDeg)))))));
}

/** Bornes d'axe « rondes » : 4 intervalles d'un pas de 1, 2, 2,5, 4 ou 5 × 10ⁿ couvrant [min, max] (au moins 4 m). */
export function niceBounds(min, max) {
  for (let e = Math.floor(Math.log10(Math.max(max - min, 4) / 4)); ; e++) {
    for (const k of [1, 2, 2.5, 4, 5]) {
      const step = k * 10 ** e, lo = Math.floor(min / step) * step;
      if (lo + 4 * step >= max) return { min: lo, max: lo + 4 * step };
    }
  }
}

function profileChart(m) {
  const hs = m.profile.map((p) => p.h).filter(Number.isFinite);
  if (!hs.length) return h('div', { class: 'note measure-nochart' }, t('tools.measure.noProfile'));
  const y = niceBounds(Math.min(...hs), Math.max(...hs));
  const svg = lineChart([{ name: t('tools.measure.profile'), color: cat('a', state.cvd), points: m.profile.map((p) => [p.d / 1000, p.h]), fill: true, dash: '' }], {
    width: 360, height: 132, xLabel: t('tools.measure.axisX'), yMin: y.min, yMax: y.max,
    xFormat: (v) => num(v, m.total.surfaceM < 20000 ? 1 : 0), yFormat: (v) => num(v, 0),
  });
  svg.setAttribute('aria-label', t('tools.measure.profile'));
  return h('figure', { class: 'measure-chart' }, h('figcaption', { class: 'eyebrow' }, `${t('tools.measure.profile')} · ${t('tools.measure.axisY')}`), svg);
}

function method(m) {
  const steps = m.segments.map((s) => s.stepM).filter(Number.isFinite);
  const step = steps.length ? Math.max(...steps) : 240;
  return h('p', { class: 'measure-method' }, h('strong', {}, t('ui.method') + (state.lang === 'fr' ? ' : ' : ': ')), t('tools.measure.method', { step: num(step, 0) }));
}

function pointLine(p, i, height) {
  return h('li', {}, h('span', { class: 'measure-idx' }, i + 1), h('span', { class: 'mono' }, fmtLatLon(p.lat, p.lon, 3, state.lang)),
    h('span', { class: 'mono dim' }, Number.isFinite(height) ? `${num(height, 0)}\u00a0m` : '—'));
}

function content(body) {
  const pts = state.measure;
  if (!hasDem()) body.append(h('div', { class: 'note note-warn' }, t('tools.measure.noDem')));
  if (!pts.length) { body.append(h('p', { class: 'measure-hint' }, t('tools.measure.hint0'))); return; }
  const m = measurePath(pts);
  if (pts.length === 1) body.append(h('p', { class: 'measure-hint' }, t('tools.measure.hint1')));
  else {
    body.append(totals(m), profileChart(m));
    if (m.segments.length > 1) body.append(segmentTable(m));
    if (hasDem() && m.heights.some((x) => !Number.isFinite(x))) body.append(h('div', { class: 'note note-warn' }, t('tools.measure.outside')));
    body.append(method(m));
  }
  body.append(h('details', { class: 'measure-points', open: pts.length === 1 },
    h('summary', {}, t('tools.measure.points', { n: pts.length })), h('ol', {}, pts.map((p, i) => pointLine(p, i, m.heights[i])))));
  body.append(h('div', { class: 'measure-actions' },
    button(t('tools.measure.undo'), () => set({ measure: state.measure.slice(0, -1) }), { small: true }),
    button(t('tools.measure.clear'), () => set({ measure: [] }), { small: true, icon: 'trash' }),
    button(t('tools.measure.exportCsv'), () => download('profil-altimetrique.csv', profileToCSV(m.profile), 'text/csv'), { small: true, icon: 'download', disabled: m.profile.length < 2 })));
}

/** Monte la carte de mesure dans la vue centrale (conteneur des contrôles flottants). */
export function mountMeasure(container) {
  const body = h('div', { class: 'measure-body' });
  const toggle = h('button', { type: 'button', class: 'iconbtn', onclick: () => { card.classList.toggle('is-collapsed'); labels(); } }, icon('chevron', 16));
  const close = h('button', { type: 'button', class: 'iconbtn', onclick: () => set({ tool: null }) }, icon('close', 16));
  const title = h('span', { class: 'measure-title' });
  const head = h('header', { class: 'measure-head' }, icon('ruler', 16), title, toggle, close);
  const card = h('section', { class: 'float glass measure', hidden: true }, head, body);
  container.append(card);

  function labels() {
    const collapsed = card.classList.contains('is-collapsed');
    title.textContent = t('tools.measure.title');
    card.setAttribute('aria-label', t('tools.measure.title'));
    for (const [el, key] of [[toggle, collapsed ? 'tools.measure.expand' : 'tools.measure.collapse'], [close, 'ui.close']]) { el.title = t(key); el.setAttribute('aria-label', t(key)); }
    toggle.setAttribute('aria-expanded', String(!collapsed));
    head.title = t('tools.measure.dragHint');
  }
  function render() {
    const visible = state.tool === 'measure' && state.view !== 'compare';   // la vue de comparaison n'a pas de carte à mesurer
    card.hidden = !visible;
    if (!visible) return;
    labels();
    clear(body);
    content(body);
  }

  // Déplacement à la souris ou au doigt par l'en-tête (désactivé sur petit écran, où la carte est calée en bas).
  const docked = window.matchMedia('(max-width: 700px)');
  const resetPosition = () => { card.style.left = ''; card.style.top = ''; card.style.right = ''; };
  docked.addEventListener('change', resetPosition);
  head.addEventListener('pointerdown', (e) => {
    if (docked.matches || e.target.closest('button')) return;
    const host = container.offsetParent || document.body, hostBox = host.getBoundingClientRect(), box = card.getBoundingClientRect();
    const dx = e.clientX - box.left, dy = e.clientY - box.top;
    const move = (ev) => {
      const x = Math.max(4, Math.min(hostBox.width - box.width - 4, ev.clientX - hostBox.left - dx));
      const y = Math.max(4, Math.min(hostBox.height - 44, ev.clientY - hostBox.top - dy));
      card.style.left = `${x}px`; card.style.top = `${y}px`; card.style.right = 'auto';
    };
    const stop = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', stop); head.removeEventListener('pointercancel', stop); };
    head.setPointerCapture(e.pointerId);
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', stop); head.addEventListener('pointercancel', stop);
    e.preventDefault();
  });

  on('change', (keys) => { if (keys.some((k) => ['tool', 'measure', 'view', 'lang', 'cvd'].includes(k))) render(); });
  on('data:ready', (id) => { if (id === 'sp_dem') render(); });
  render();
}
