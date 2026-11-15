// Panorama d'horizon : le Soleil et la Terre par rapport à l'horizon du relief (LOLA, 240 m) du site sélectionné.
//
//   const sky = createSkyView(container);            // suit state.selection et state.timeMs
//   const sky = createSkyView(container, { compact: true, site: {lat, lon, name}, timeMs: () => ms });
//   sky.update();  sky.destroy();
//
// Deux vues :
//   - « Tour d'horizon » : x = azimut sur 360°, y = élévation. L'échelle verticale est exagérée (indiquée
//     dans le dessin) : au pôle, tout se joue dans quelques degrés autour de l'horizon.
//   - « Zoom Terre » : ±15° d'azimut autour de la Terre, mêmes échelles en x et en y.
// Tout vient du moteur : siteNow() (horizon du relief LOLA, positions), siteWindow(…, 'lunarDay')
// (trajectoires), siteTransitions() (prochain lever/coucher). Rien n'est dessiné « pour faire joli » :
// les disques ont leur taille angulaire réelle (dans le repère azimut/élévation, donc des ellipses dès
// que les deux échelles diffèrent) et un repère de taille fixe les rend trouvables quand ils sont petits.

import { state, on } from '../core/store.js';
import { t, deg, pct, num, duration, dateUTC } from '../core/i18n.js';
import '../i18n/sky.js';
import { siteNow, siteWindow, siteTransitions, DAY_MS, HOUR_MS } from '../science/engine.js';
import { horizonAt } from '../science/horizon.js';
import { wrapLon, DEG } from '../core/coords.js';
import { cat } from '../layers/palettes.js';
import { h, clear, provTag } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const FRAME_MS = 50;                  // au plus ~20 dessins par seconde
const ZOOM_HALF_DEG = 15;             // demi-largeur de la vue « Zoom Terre »
const SUN_R = 0.27, EARTH_R = 0.95;   // rayons apparents approchés (°), seulement pour les marges du cadre
const SEARCH_DAYS = 400;              // profondeur de recherche de siteTransitions (sitecalc.nextTransition)
const NULL_VALID_MS = DAY_MS;         // durée simulée pendant laquelle un « aucun changement » est réutilisé
const TRACK_PERIOD_MS = 29 * DAY_MS;  // pas de la grille des fenêtres de trajectoire (jours entiers, < 29,53 j : elles se recouvrent)
const EDGE_LAT = -80;                 // au nord de 80° S, le bord du relief embarqué (75° S) peut tronquer l'horizon
const EL_STEPS = [0.5, 1, 2, 5, 10, 15, 30];

const mod360 = (a) => ((a % 360) + 360) % 360;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Angle avec son signe : « +1,3° », « −2,0° », « 0° » (jamais « −0 »). */
function signedDeg(v, digits = 1) {
  const r = Math.round(v * 10 ** digits) / 10 ** digits || 0;
  return (r > 0 ? '+' : '') + deg(r, digits);
}
const siteId = (s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}|${state.params.mastM}|${state.params.earthMarginDeg}`;

let preferredMode = 'pano';           // dernière vue choisie : la fiche du site recrée le panorama à chaque sélection

/** Couleurs et polices lues dans le thème CSS (les valeurs de repli ne servent que hors de l'application). */
function readTheme(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#070b14'), grid: v('--line', '#1f2b40'), gridStrong: v('--line-2', '#2b3b57'),
    text: v('--text', '#e6edf7'), text2: v('--text-2', '#a9b6ca'), text3: v('--text-3', '#74839b'),
    terrainTop: v('--bg-4', '#1f2d46'), terrainBottom: v('--bg-2', '#101827'),
    font: v('--font', 'sans-serif'), mono: v('--mono', 'monospace'),
    sun: cat('sun', state.cvd), earth: cat('earth', state.cvd),
  };
}

/** Étendues des trajectoires et du relief : servent à cadrer le dessin de façon stable pendant la lecture. */
function windowStats(win, hz) {
  const S = win.series;
  let sunMin = Infinity, sunMax = -Infinity, earthMin = Infinity, earthMax = -Infinity, azLo = 0, azHi = 0;
  for (let i = 0; i < S.n; i++) {
    if (S.sunEl[i] < sunMin) sunMin = S.sunEl[i]; if (S.sunEl[i] > sunMax) sunMax = S.sunEl[i];
    if (S.earthEl[i] < earthMin) earthMin = S.earthEl[i]; if (S.earthEl[i] > earthMax) earthMax = S.earthEl[i];
    const rel = wrapLon(S.earthAz[i] - S.earthAz[0]);       // écart d'azimut au premier point (gère le passage par le Nord)
    if (rel < azLo) azLo = rel; if (rel > azHi) azHi = rel;
  }
  let hzMin = Infinity, hzMax = -Infinity;
  for (let i = 0; i < hz.n; i++) { if (hz.elev[i] < hzMin) hzMin = hz.elev[i]; if (hz.elev[i] > hzMax) hzMax = hz.elev[i]; }
  return { sunMin, sunMax, earthMin, earthMax, hzMin, hzMax, earthAzMid: mod360(S.earthAz[0] + (azLo + azHi) / 2), earthAzHalf: (azHi - azLo) / 2 };
}

/** Repère du dessin : conversions azimut/élévation <-> pixels pour un cadre donné. */
function makeGeometry(kind, box, azMin, azSpan, elMin, elMax) {
  const { L, T, PW, PH } = box;
  const pxX = PW / azSpan, pxY = PH / (elMax - elMin);
  return {
    kind, L, T, PW, PH, azMin, azSpan, elMin, elMax, pxX, pxY,
    xOf(az) { let rel = mod360(az - azMin); if (rel > azSpan + (360 - azSpan) / 2) rel -= 360; return L + rel * pxX; },
    yOf(el) { return T + (elMax - el) * pxY; },
    azOf(x) { return mod360(azMin + (x - L) / pxX); },
    elOf(y) { return elMax - (y - T) / pxY; },
  };
}

/** Tour d'horizon : cadre vertical serré autour du relief et des deux trajectoires. */
function panoGeometry(box, st, centerAz) {
  const floor = Math.min(st.hzMin, 0);
  let lo = Math.max(Math.min(floor, st.sunMin - SUN_R, st.earthMin - EARTH_R), floor - 6);   // pas plus de 6° sous le relief
  let hi = Math.max(st.hzMax, 0, st.sunMax + SUN_R, st.earthMax + EARTH_R);
  const pad = Math.max(0.5, 0.06 * (hi - lo)); lo -= pad; hi += pad;
  if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  const unit = hi - lo > 40 ? 5 : 1;
  lo = Math.max(-90, Math.floor(lo / unit) * unit); hi = Math.min(90, Math.ceil(hi / unit) * unit);
  return makeGeometry('pano', box, mod360(centerAz - 180), 360, lo, hi);
}

/** Zoom Terre : 30° d'azimut, échelles égales ; le cadre vertical découle de la hauteur disponible. */
function zoomGeometry(box, centerAz, centerEl) {
  const spanEl = (2 * ZOOM_HALF_DEG) * box.PH / box.PW;
  return makeGeometry('zoom', box, mod360(centerAz - ZOOM_HALF_DEG), 2 * ZOOM_HALF_DEG, centerEl - spanEl / 2, centerEl + spanEl / 2);
}

/**
 * Phase de la Terre vue du site, à partir des vecteurs du moteur (repère lunaire, km).
 * cosI = cosinus de l'angle Soleil–Terre–Lune (1 = pleine Terre) ; angle = direction du Soleil autour de la
 * Terre sur le ciel (radians, 0 = vers les azimuts croissants, π/2 = vers le haut).
 */
function earthPhase(now) {
  const s = now.sunVec, e = now.earthVec;
  const es = [s[0] - e[0], s[1] - e[1], s[2] - e[2]];
  const cosI = -(es[0] * e[0] + es[1] * e[1] + es[2] * e[2]) / (Math.hypot(...es) * Math.hypot(...e));
  const azE = now.earth.az * DEG, elE = now.earth.el * DEG, azS = now.sun.az * DEG, elS = now.sun.el * DEG;
  const sv = [Math.cos(elS) * Math.sin(azS), Math.cos(elS) * Math.cos(azS), Math.sin(elS)];           // Soleil, repère Est/Nord/Haut
  const right = sv[0] * Math.cos(azE) - sv[1] * Math.sin(azE);
  const up = -sv[0] * Math.sin(elE) * Math.sin(azE) - sv[1] * Math.sin(elE) * Math.cos(azE) + sv[2] * Math.cos(elE);
  return { cosI, angle: Math.atan2(up, right) };
}

/** Deux tracés pour une trajectoire : la partie visible (trait plein) et la partie derrière le relief (pointillés). */
function trackPaths(g, az, el, n, isVisible) {
  const shown = new Path2D(), hidden = new Path2D();
  let px = 0, py = 0, pOk = false, pVis = false, cur = null;
  for (let i = 0; i < n; i++) {
    const x = g.xOf(az[i]), y = g.yOf(el[i]);
    const ok = x > g.L - 60 && x < g.L + g.PW + 60;
    const vis = isVisible(i);
    if (ok && pOk && Math.abs(x - px) < g.PW / 2) {              // sinon : saut d'un bord à l'autre, on lève le crayon
      const p = vis && pVis ? shown : hidden;
      if (p !== cur) p.moveTo(px, py);
      p.lineTo(x, y); cur = p;
    } else cur = null;
    px = x; py = y; pOk = ok; pVis = vis;
  }
  return { shown, hidden };
}

/** Position et taille d'un astre en pixels. En azimut, le disque s'étale de rayon / cos(élévation). */
function bodyShape(g, b) {
  return {
    x: g.xOf(b.az), y: g.yOf(b.el),
    rx: (b.radiusDeg / Math.max(0.2, Math.cos(b.el * DEG))) * g.pxX, ry: b.radiusDeg * g.pxY,
  };
}

function ellipse(ctx, s, grow = 0) {
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, Math.max(0.75, s.rx) + grow, Math.max(0.75, s.ry) + grow, 0, 0, 2 * Math.PI);
}

/** Repère du Soleil : huit rayons autour du disque. */
function sunMarker(ctx, s, color) {
  const a = Math.max(s.rx, 3) + 4, b = Math.max(s.ry, 3) + 4;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const c = Math.cos(k * Math.PI / 4), sn = Math.sin(k * Math.PI / 4);
    ctx.moveTo(s.x + a * c, s.y + b * sn); ctx.lineTo(s.x + (a + 5) * c, s.y + (b + 5) * sn);
  }
  ctx.stroke();
  return b + 5;
}
/** Repère de la Terre : quatre équerres autour du disque. */
function earthMarker(ctx, s, color) {
  const a = Math.max(s.rx, 3) + 4, b = Math.max(s.ry, 3) + 4, c = 4;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(s.x + sx * a, s.y + sy * (b - c)); ctx.lineTo(s.x + sx * a, s.y + sy * b); ctx.lineTo(s.x + sx * (a - c), s.y + sy * b);
  }
  ctx.stroke();
  return b;
}

/** Texte avec un liseré de la couleur du fond, lisible par-dessus le relief et les tracés. */
function haloText(ctx, text, x, y, color, bg) {
  ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
}

/**
 * @param {HTMLElement} container
 * @param {{compact?:boolean, site?:object|(()=>object), timeMs?:number|(()=>number), height?:number}} [opts]
 *   compact : sans les chiffres (vue comparaison) ; site / timeMs : site et date imposés au lieu de l'état
 *   global (un scénario de comparaison) ; height : hauteur du dessin en px.
 * @returns {{update:()=>void, destroy:()=>void, layout:()=>object|null}}
 */
export function createSkyView(container, opts = {}) {
  const compact = !!opts.compact;
  let mode = compact ? 'pano' : preferredMode;
  let centerChoice = 'auto';          // 'auto' | 'north' | 'south'
  let centerAuto = 'south', centerSite = '';
  let zoomAz = null, zoomEl = null, zoomSite = '';
  let hover = null;                   // {x, y} en pixels CSS dans le dessin
  let theme = null, geometry = null, shapes = null, lastDrawMs = 0, lastDrawCost = 0, drawTimer = 0, drawRaf = 0, destroyed = false;
  let drawnTime = NaN, drawnSite = '';   // ce que montre le dernier dessin : un panorama à date ou site imposés ne se redessine pas pour rien
  let winCache = null;                // {key, win, stats}
  let tr = null;                      // {key, tEval, res, checkedUntil} : dernier résultat de siteTransitions

  const getSite = () => (typeof opts.site === 'function' ? opts.site() : opts.site) ?? state.selection;
  const getTime = () => (typeof opts.timeMs === 'function' ? opts.timeMs() : opts.timeMs) ?? state.timeMs;
  const siteMark = (s) => (s ? `${siteId(s)}|${s.name ?? ''}` : '');

  // ---------- Structure ----------
  const root = h('div', { class: 'sky' + (compact ? ' sky-compact' : '') });
  const canvas = h('canvas', { class: 'sky-canvas', role: 'img' });
  const ctx = canvas.getContext('2d');
  let ui = null;
  container.append(root);

  function segButton(label, title, isOn, onclick) {
    return h('button', { type: 'button', class: isOn ? 'is-on' : '', title, 'aria-pressed': String(isOn), onclick }, label);
  }
  function statCard(iconName) {
    const name = h('span', { class: 'sky-stat-name' }), main = h('span', {}), small = h('small', {}), sub = h('div', { class: 'stat-sub' });
    const value = h('div', { class: 'stat-value' }, main, ' ', small);
    return { el: h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, icon(iconName, 14), name, provTag('computed')), value, sub), name, main, small, sub, value };
  }
  function legendItem(color, dashed, label) {
    return h('span', {}, h('i', { style: { borderTopColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' } }), label);
  }

  /** (Re)construit tout le DOM : appelé au montage et à chaque changement de langue. */
  function build() {
    clear(root);
    theme = readTheme(root);
    ui = {
      head: h('div', { class: 'sky-head' }),
      modeSeg: h('div', { class: 'seg', role: 'group', 'aria-label': t('sky.mode.label') }),
      centerSeg: h('div', { class: 'seg', role: 'group', 'aria-label': t('sky.center.label') }),
      stage: h('div', { class: 'sky-stage' }, canvas),
      readout: h('div', { class: 'sky-readout' }),
      stretch: h('div', { class: 'sky-readout hidden' }),
      summary: compact ? h('div', { class: 'sky-summary' }) : null,
      noTerrain: h('div', { class: 'note note-warn sky-noterrain hidden' }, t('sky.noTerrain')),
      edge: h('div', { class: 'note note-warn sky-noterrain sky-edge hidden' }, t('sky.edge')),
      legend: compact ? null : h('div', { class: 'chart-legend sky-legend' }),
      stats: compact ? null : { sun: statCard('sun'), earth: statCard('earth'), sunNext: statCard('clock'), earthNext: statCard('antenna') },
      empty: h('div', { class: 'empty sky-empty hidden' }, t('sky.empty')),
    };
    ui.head.append(ui.modeSeg, h('span', { class: 'sky-center' }, h('span', { class: 'dim' }, t('sky.center.label')), ui.centerSeg));
    ui.body = h('div', { class: 'sky-body' }, ui.head, ui.stage, ui.readout, ui.stretch, ui.summary, ui.noTerrain, ui.edge, ui.legend,
      ui.stats ? h('div', { class: 'stat-grid sky-stats' }, ui.stats.sun.el, ui.stats.earth.el, ui.stats.sunNext.el, ui.stats.earthNext.el) : null,
      ui.stats ? h('div', { class: 'sky-foot' }, t('sky.brief')) : null);
    root.append(ui.body, ui.empty);
    buildControls();
  }
  function buildControls() {
    clear(ui.modeSeg).append(
      segButton(t('sky.mode.pano'), t('sky.mode.pano.help'), mode === 'pano', () => setMode('pano')),
      segButton(t('sky.mode.zoom'), t('sky.mode.zoom.help'), mode === 'zoom', () => setMode('zoom')));
    const eff = centerChoice === 'auto' ? centerAuto : centerChoice;
    clear(ui.centerSeg).append(
      segButton(t('sky.center.north'), t('sky.center.north.help'), eff === 'north', () => setCenter('north')),
      segButton(t('sky.center.south'), t('sky.center.south.help'), eff === 'south', () => setCenter('south')));
    ui.centerSeg.parentElement.classList.toggle('hidden', mode !== 'pano');
  }
  function setMode(m) { mode = m; if (!compact) preferredMode = m; hover = null; buildControls(); draw(); }
  function setCenter(c) { centerChoice = c; hover = null; buildControls(); draw(); }

  // ---------- Données ----------
  /**
   * Trajectoires : un jour lunaire (29,53 j) qui contient toujours la date. Le moteur fait partir la fenêtre de
   * 00:00 UTC du jour demandé ; on demande les jours d'une grille de 29 jours, donc deux fenêtres voisines se
   * recouvrent, aucune date ne tombe entre deux, et les fenêtres resservent quand on parcourt le temps.
   */
  function windowFor(site, timeMs) {
    const anchor = Math.floor(timeMs / TRACK_PERIOD_MS) * TRACK_PERIOD_MS;
    const key = `${siteId(site)}|${anchor}`;
    if (!winCache || winCache.key !== key) {
      const win = siteWindow(site, 'lunarDay', anchor);
      winCache = { key, win, stats: windowStats(win, win.series.horizon) };
    }
    return winCache;
  }

  /**
   * Prochains lever/coucher (siteTransitions : quelques ms, mémoïsé à la minute par le moteur). Un résultat est
   * gardé tant que la date reste avant le basculement annoncé ET que l'état qu'il décrit est celui de siteNow().
   * Le moteur cherche au pas d'une heure à partir du début de la minute : un passage très bref, ou un basculement
   * dans la minute en cours, peut donner l'état contraire. Dans ce cas l'astre est rendu à null : la carte affiche
   * l'état de siteNow() sans durée, et le calcul est refait au dessin suivant.
   * @returns {{sun:object|null, earth:object|null, checkedUntil:number}}
   */
  function transitionsFor(site, timeMs, sunUp, earthUp) {
    const key = siteId(site);
    const holds = (b, up) => b.now === up && (b.nextMs === null ? timeMs - tr.tEval < NULL_VALID_MS : timeMs < b.nextMs);
    if (!tr || tr.key !== key || timeMs < tr.tEval || !holds(tr.res.sun, sunUp) || !holds(tr.res.earth, earthUp)) {
      let tq = Math.floor(timeMs / 60000) * 60000;
      tr = { key, tEval: timeMs, res: siteTransitions(site, tq) };
      if (!holds(tr.res.sun, sunUp) || !holds(tr.res.earth, earthUp)) { tq += 60000; tr.res = siteTransitions(site, tq); }   // basculement dans la minute en cours
      tr.checkedUntil = tq + SEARCH_DAYS * DAY_MS;
    }
    return { sun: holds(tr.res.sun, sunUp) ? tr.res.sun : null, earth: holds(tr.res.earth, earthUp) ? tr.res.earth : null, checkedUntil: tr.checkedUntil };
  }

  // ---------- Dessin ----------
  function requestDraw() {
    if (destroyed || drawTimer || drawRaf) return;
    const wait = FRAME_MS - (performance.now() - lastDrawMs);
    const go = () => { drawTimer = 0; drawRaf = requestAnimationFrame(() => { drawRaf = 0; draw(); }); };
    if (wait > 0) drawTimer = setTimeout(go, wait); else go();
  }

  function draw() {
    if (destroyed) return;
    const site = getSite();
    drawnSite = siteMark(site); drawnTime = getTime();
    ui.body.classList.toggle('hidden', !site); ui.empty.classList.toggle('hidden', !!site);
    if (!site) { canvas.setAttribute('aria-label', t('sky.aria.empty')); geometry = shapes = null; return; }
    const cssW = Math.floor(ui.stage.clientWidth);
    if (cssW < 80) return;                                // conteneur masqué ou pas encore mis en page
    const started = performance.now();
    lastDrawMs = started;
    const cssH = opts.height ?? Math.round(clamp(cssW * (compact ? 0.5 : 0.52), compact ? 130 : 170, compact ? 220 : 300));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      canvas.style.height = `${cssH}px`;
    }
    const timeMs = drawnTime;
    const now = siteNow(site, timeMs);
    const { win, stats } = windowFor(site, timeMs);
    const id = siteId(site);
    if (centerSite !== id) {                              // nouveau site : la Terre ne doit pas tomber sur un bord du tour d'horizon
      centerSite = id; centerChoice = 'auto';
      centerAuto = Math.abs(wrapLon(now.earth.az)) < 90 ? 'north' : 'south';
      buildControls();
    }
    const box = { L: 36, T: 8, PW: cssW - 36 - 8, PH: cssH - 8 - 20 };
    if (mode === 'pano') geometry = panoGeometry(box, stats, (centerChoice === 'auto' ? centerAuto : centerChoice) === 'north' ? 0 : 180);
    else geometry = zoomGeometry(box, ...zoomCenter(id, now, stats, box));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(geometry, now, win, cssW, cssH);
    refreshTexts(site, now, timeMs);
    lastDrawCost = performance.now() - started;
  }

  /**
   * Centre de la vue « Zoom Terre ». Le cadre reste fixe tant que la Terre y tient (le relief ne défile pas
   * pendant la lecture) ; il n'est recentré que si la Terre s'approche d'un bord.
   */
  function zoomCenter(id, now, stats, box) {
    const e = now.earth, spanEl = 2 * ZOOM_HALF_DEG * box.PH / box.PW;
    if (zoomSite !== id) { zoomSite = id; zoomAz = zoomEl = null; }
    if (zoomAz === null || Math.abs(wrapLon(e.az - zoomAz)) > ZOOM_HALF_DEG - 3) {
      // De préférence le milieu de la zone de libration, si elle tient dans la fenêtre avec la Terre du moment
      zoomAz = stats.earthAzHalf < ZOOM_HALF_DEG - 3 && Math.abs(wrapLon(e.az - stats.earthAzMid)) < ZOOM_HALF_DEG - 3 ? stats.earthAzMid : e.az;
    }
    const top = e.el + e.radiusDeg, bottom = e.el - e.radiusDeg;
    if (zoomEl === null || top > zoomEl + spanEl / 2 - 0.4 || bottom < zoomEl - spanEl / 2 + 0.4) {
      // Montrer à la fois la Terre et le relief sous elle quand c'est possible, sinon suivre la Terre
      const both = Math.abs(e.aboveDeg) + e.radiusDeg + 1.5 < spanEl;
      zoomEl = both ? (e.el + e.horizonDeg) / 2 : e.el;
    }
    return [zoomAz, zoomEl];
  }

  function paint(g, now, win, W, H) {
    const hz = now.horizon, S = win.series, th = theme;
    const right = g.L + g.PW, bottom = g.T + g.PH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = th.bg; ctx.fillRect(g.L, g.T, g.PW, g.PH);

    // Graduations : élévation à gauche, azimut en bas
    ctx.font = `10px ${th.mono}`; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    const elStep = EL_STEPS.find((s) => s * g.pxY >= 26) ?? 30;
    for (let v = Math.ceil(g.elMin / elStep) * elStep; v <= g.elMax + 1e-9; v += elStep) {
      const y = Math.round(g.yOf(v)) + 0.5;
      ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(g.L, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = th.text3; ctx.textAlign = 'right';
      ctx.fillText(signedDeg(v, elStep < 1 ? 1 : 0), g.L - 5, clamp(y, g.T + 5, bottom - 4));
    }
    const azStep = g.kind === 'pano' ? 45 : 5;
    const cardinals = { 0: 'sky.card.n', 90: 'sky.card.e', 180: 'sky.card.s', 270: 'sky.card.w' };
    ctx.textBaseline = 'alphabetic';
    for (let a = Math.ceil(g.azMin / azStep) * azStep; a <= g.azMin + g.azSpan + 1e-9; a += azStep) {
      const x = Math.round(g.L + (a - g.azMin) * g.pxX) + 0.5, az = mod360(a), card = cardinals[az];
      ctx.strokeStyle = card ? th.gridStrong : th.grid; ctx.beginPath(); ctx.moveTo(x, g.T); ctx.lineTo(x, bottom); ctx.stroke();
      if (g.kind === 'pano' && !card && g.PW < 520) continue;      // dessin étroit : seulement les points cardinaux
      ctx.textAlign = x < g.L + 12 ? 'left' : x > right - 12 ? 'right' : 'center';
      ctx.font = card ? `600 11px ${th.font}` : `10px ${th.mono}`; ctx.fillStyle = card ? th.text : th.text3;
      ctx.fillText(card ? `${t(card)}${g.kind === 'zoom' ? ` ${deg(az, 0)}` : ''}` : deg(az, 0), x, bottom + 14);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(g.L, g.T, g.PW, g.PH); ctx.clip();

    // Trajectoires sur le jour lunaire : partie visible d'abord (le relief passera par-dessus le reste)
    const sunTrack = trackPaths(g, S.sunAz, S.sunEl, S.n, (i) => S.sunFrac[i] > 0);
    const earthTrack = trackPaths(g, S.earthAz, S.earthEl, S.n, (i) => S.earthVis[i] === 1);
    ctx.lineWidth = 1.25; ctx.lineJoin = 'round';
    ctx.strokeStyle = th.sun; ctx.globalAlpha = 0.85; ctx.stroke(sunTrack.shown);
    ctx.strokeStyle = th.earth; ctx.stroke(earthTrack.shown);
    ctx.globalAlpha = 1;
    sunArrows(g, S);

    // Disques à leur taille angulaire réelle
    const sun = bodyShape(g, now.sun), earth = bodyShape(g, now.earth);
    shapes = { sun, earth };
    ctx.fillStyle = th.sun; ellipse(ctx, sun); ctx.fill();
    drawEarth(earth, earthPhase(now));

    // Relief : silhouette pleine, opaque (ce qui est derrière est réellement caché)
    const stepAz = 360 / hz.n, a0 = Math.floor(g.azMin / stepAz) * stepAz, ridge = new Path2D();
    let firstX = 0, lastX = 0;
    for (let a = a0, k = 0; a <= g.azMin + g.azSpan + stepAz; a += stepAz, k++) {
      const x = g.L + (a - g.azMin) * g.pxX, y = g.yOf(horizonAt(hz, a));
      if (k === 0) { ridge.moveTo(x, y); firstX = x; } else ridge.lineTo(x, y);
      lastX = x;
    }
    const fill = new Path2D(ridge); fill.lineTo(lastX, bottom + 2); fill.lineTo(firstX, bottom + 2); fill.closePath();
    const grad = ctx.createLinearGradient(0, Math.max(g.T, g.yOf(winCache.stats.hzMax)), 0, bottom);
    grad.addColorStop(0, th.terrainTop); grad.addColorStop(1, th.terrainBottom);
    ctx.fillStyle = grad; ctx.fill(fill);
    ctx.strokeStyle = th.text2; ctx.lineWidth = 1.25; ctx.stroke(ridge);

    // Élévation 0° : plan horizontal de la sphère, repère pour lire la hauteur du relief
    if (g.elMin < 0 && g.elMax > 0) {
      const y0 = Math.round(g.yOf(0)) + 0.5;
      ctx.strokeStyle = th.text3; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(g.L, y0); ctx.lineTo(right, y0); ctx.stroke(); ctx.setLineDash([]);
    }

    // Par-dessus le relief : ce qui est caché reste repérable, en pointillés
    ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.7;
    ctx.strokeStyle = th.sun; ctx.stroke(sunTrack.hidden);
    ctx.strokeStyle = th.earth; ctx.stroke(earthTrack.hidden);
    ctx.globalAlpha = 1; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.25;
    if (now.sun.fraction < 1) { ctx.strokeStyle = th.sun; ellipse(ctx, sun, 0.5); ctx.stroke(); }
    if (now.earth.fraction < 1) { ctx.strokeStyle = th.earth; ellipse(ctx, earth, 0.5); ctx.stroke(); }
    ctx.setLineDash([]);

    // Repères et étiquettes : la forme distingue les deux astres, pas seulement la couleur
    const labels = [];
    for (const [shape, b, name, color, marker] of [[sun, now.sun, t('body.sun'), th.sun, sunMarker], [earth, now.earth, t('body.earth'), th.earth, earthMarker]]) {
      const inX = shape.x >= g.L - 2 && shape.x <= right + 2, inY = shape.y >= g.T - 2 && shape.y <= bottom + 2;
      if (inX && inY) labels.push({ shape, name, color, reach: marker(ctx, shape, color) });
      else offFrame(g, shape, b, name, color, inX);
    }
    placeLabels(g, labels);

    // Lecture sous le curseur
    if (hover && hover.x >= g.L && hover.x <= right && hover.y >= g.T && hover.y <= bottom) {
      const x = Math.round(hover.x) + 0.5, yH = g.yOf(horizonAt(hz, g.azOf(hover.x)));
      ctx.strokeStyle = th.text2; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(x, g.T); ctx.lineTo(x, bottom); ctx.moveTo(x - 6, Math.round(hover.y) + 0.5); ctx.lineTo(x + 6, Math.round(hover.y) + 0.5); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = th.text; ctx.beginPath(); ctx.arc(hover.x, yH, 2.5, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();

    // Rappel d'échelle
    ctx.font = `10px ${th.mono}`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    const ratio = g.pxY / g.pxX;
    haloText(ctx, g.kind === 'zoom' ? t('sky.equal') : t('sky.exag', { n: num(ratio, ratio < 10 ? 1 : 0) }), right - 6, g.T + 13, th.text3, th.bg);
    ctx.strokeStyle = th.gridStrong; ctx.lineWidth = 1; ctx.strokeRect(g.L + 0.5, g.T + 0.5, g.PW - 1, g.PH - 1);
  }

  /** Petites flèches le long de la trajectoire du Soleil : sens de parcours. */
  function sunArrows(g, S) {
    ctx.fillStyle = theme.sun;
    for (let k = 1; k < 8; k += 2) {
      const i = Math.floor(S.n * k / 8), j = Math.min(S.n - 1, i + 6);
      if (!(S.sunFrac[i] > 0)) continue;
      const x1 = g.xOf(S.sunAz[i]), y1 = g.yOf(S.sunEl[i]), x2 = g.xOf(S.sunAz[j]), y2 = g.yOf(S.sunEl[j]);
      if (Math.abs(x2 - x1) > g.PW / 2 || Math.hypot(x2 - x1, y2 - y1) < 0.5) continue;
      const a = Math.atan2(y2 - y1, x2 - x1);
      ctx.save(); ctx.translate(x1, y1); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-3, 3.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /** Terre avec sa phase : côté nuit assombri, côté éclairé tourné vers le Soleil. */
  function drawEarth(s, phase) {
    const rx = Math.max(0.75, s.rx), ry = Math.max(0.75, s.ry);
    ctx.fillStyle = theme.bg; ellipse(ctx, s); ctx.fill();
    ctx.globalAlpha = 0.32; ctx.fillStyle = theme.earth; ellipse(ctx, s); ctx.fill(); ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(s.x, s.y); ctx.scale(rx, -ry); ctx.rotate(phase.angle);      // repère unité, y vers le haut, +x vers le Soleil
    ctx.beginPath();
    ctx.arc(0, 0, 1, -Math.PI / 2, Math.PI / 2);                                // limbe éclairé
    ctx.ellipse(0, 0, Math.max(1e-3, Math.abs(phase.cosI)), 1, 0, Math.PI / 2, -Math.PI / 2, phase.cosI < 0);   // terminateur
    ctx.closePath(); ctx.fillStyle = theme.earth; ctx.fill();
    ctx.restore();
  }

  /** Astre hors du cadre : une pointe sur le bord, avec son élévation (ou son azimut dans le zoom). */
  function offFrame(g, s, b, name, color, inX) {
    const right = g.L + g.PW, bottom = g.T + g.PH;
    ctx.font = `10px ${theme.mono}`; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    if (!inX) {
      const left = s.x < g.L, x = left ? g.L + 4 : right - 4, y = clamp(s.y, g.T + 26, bottom - 12), d = left ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 7 * d, y - 4.5); ctx.lineTo(x + 7 * d, y + 4.5); ctx.closePath(); ctx.fill();
      ctx.textAlign = left ? 'left' : 'right';
      haloText(ctx, t('sky.offAz', { name, az: deg(b.az, 0) }), x + 11 * d, y, color, theme.bg);
      return;
    }
    const above = s.y < g.T, y = above ? g.T + 4 : bottom - 4, d = above ? 1 : -1, x = clamp(s.x, g.L + 8, right - 8);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4.5, y + 7 * d); ctx.lineTo(x + 4.5, y + 7 * d); ctx.closePath(); ctx.fill();
    ctx.textAlign = x > right - 90 ? 'right' : 'left';
    haloText(ctx, t('sky.off', { name, el: signedDeg(b.el) }), x + (x > right - 90 ? -9 : 9), y + 4 * d, color, theme.bg);
  }

  /**
   * Étiquettes au-dessus des repères ; en dessous si la place manque en haut. Quand les deux astres sont
   * proches, celui du haut garde son étiquette au-dessus et celui du bas la reçoit en dessous.
   */
  function placeLabels(g, labels) {
    ctx.font = `600 11px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const close = labels.length === 2 && Math.abs(labels[0].shape.x - labels[1].shape.x) < 60 && Math.abs(labels[0].shape.y - labels[1].shape.y) < 60;
    const lower = close ? (labels[0].shape.y > labels[1].shape.y ? labels[0] : labels[1]) : null;
    for (const l of labels) {
      const w = ctx.measureText(l.name).width;
      const x = clamp(l.shape.x, g.L + w / 2 + 3, g.L + g.PW - w / 2 - 3);
      const above = l.shape.y - l.reach - 5, below = l.shape.y + l.reach + 13;
      const y = (l === lower && below < g.T + g.PH - 2) || above < g.T + 12 ? below : above;
      haloText(ctx, l.name, x, y, l.color, theme.bg);
    }
  }

  // ---------- Textes ----------
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  function refreshTexts(site, now, timeMs) {
    const sunAbove = now.sun.aboveDeg, earthAbove = now.earth.aboveDeg;
    const sentence = t('sky.aria', {
      site: site.name || `${num(site.lat, 2)}°, ${num(site.lon, 2)}°`,
      sun: sunAbove >= 0 ? t('sky.aria.above', { v: deg(sunAbove) }) : t('sky.aria.below', { v: deg(-sunAbove) }),
      earth: now.earth.visible ? t('sky.aria.earthVisible') : t('sky.aria.earthHidden'),
    });
    if (canvas.getAttribute('aria-label') !== sentence) canvas.setAttribute('aria-label', sentence);
    if (ui.summary) setText(ui.summary, sentence);
    ui.noTerrain.classList.toggle('hidden', now.horizon.terrain !== false);
    ui.edge.classList.toggle('hidden', !(now.horizon.terrain && site.lat > EDGE_LAT));
    // Loin de l'horizon, un degré d'azimut couvre moins d'un degré de ciel : le zoom « à échelles égales » étire les disques.
    const cosEl = Math.max(0.2, Math.cos(now.earth.el * DEG)), stretched = geometry.kind === 'zoom' && cosEl < 0.87;
    ui.stretch.classList.toggle('hidden', !stretched);
    if (stretched) setText(ui.stretch, t('sky.stretch', { k: deg(cosEl, 2), n: num(1 / cosEl, 1) }));

    if (hover && geometry && hover.x >= geometry.L && hover.x <= geometry.L + geometry.PW && hover.y >= geometry.T && hover.y <= geometry.T + geometry.PH) {
      const az = geometry.azOf(hover.x);
      setText(ui.readout, t('sky.hover', { az: deg(az), el: signedDeg(geometry.elOf(hover.y)), hz: signedDeg(horizonAt(now.horizon, az)) }));
      ui.readout.classList.add('mono');
    } else { setText(ui.readout, compact ? '' : t('sky.hoverHint')); ui.readout.classList.remove('mono'); }

    if (ui.legend && ui.legend.dataset.key !== `${state.cvd}|${now.horizon.terrain}`) {
      ui.legend.dataset.key = `${state.cvd}|${now.horizon.terrain}`;
      clear(ui.legend).append(
        legendItem(theme.text2, false, t(now.horizon.terrain ? 'sky.leg.terrain' : 'sky.leg.smooth')),
        legendItem(theme.sun, false, t('sky.leg.sunTrack')), legendItem(theme.earth, false, t('sky.leg.earthTrack')),
        legendItem(theme.text3, true, t('sky.leg.hidden')));
    }
    if (!ui.stats) return;

    const s = ui.stats;
    setText(s.sun.name, t('body.sun'));
    setText(s.sun.main, deg(Math.abs(sunAbove))); setText(s.sun.small, sunAbove >= 0 ? t('sky.above') : t('sky.below'));
    setText(s.sun.sub, t('sky.sun.sub', { el: signedDeg(now.sun.el), frac: pct(100 * now.sun.fraction) }));
    setText(s.earth.name, t('body.earth'));
    setText(s.earth.main, now.earth.visible ? t('sky.earth.visible') : t('sky.earth.hidden')); setText(s.earth.small, '');
    const need = state.params.earthMarginDeg;
    setText(s.earth.sub, t(need > 0 ? 'sky.earth.subMargin' : 'sky.earth.sub', {
      el: signedDeg(now.earth.el), margin: deg(Math.abs(earthAbove)), side: earthAbove >= 0 ? t('sky.above') : t('sky.below'), need: deg(need),
    }));

    const sunUp = now.sun.fraction > 0, earthUp = now.earth.visible, trans = transitionsFor(site, timeMs, sunUp, earthUp);
    nextCard(s.sunNext, trans.sun, sunUp ? 'sunset' : 'sunrise', trans.checkedUntil, timeMs);
    nextCard(s.earthNext, trans.earth, earthUp ? 'earthLoss' : 'earthBack', trans.checkedUntil, timeMs);
  }

  /**
   * Carte « temps restant ». `key` suit l'état de siteNow() ; `info` est le résultat du moteur pour l'astre, ou
   * null quand il contredit cet état (passage bref) : la carte dit alors l'état, sans durée.
   */
  function nextCard(card, info, key, checkedUntil, timeMs) {
    const none = !!info && info.nextMs === null;
    setText(card.name, t(`${none ? 'sky.none' : 'sky.next'}.${key}`));
    setText(card.small, '');
    card.value.classList.toggle('sky-value-long', none);
    if (!info) { setText(card.main, '—'); setText(card.sub, t('sky.briefNow')); return; }
    if (none) { setText(card.main, t('sky.none400')); setText(card.sub, t('sky.checkedUntil', { date: dateUTC(checkedUntil, false) })); return; }
    setText(card.main, duration(Math.max(0, info.nextMs - timeMs) / HOUR_MS));
    setText(card.sub, dateUTC(info.nextMs));
  }

  // ---------- Interactions et cycle de vie ----------
  function onPointer(e) {
    const r = canvas.getBoundingClientRect();
    hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    requestDraw();
  }
  function onLeave() { hover = null; requestDraw(); }
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointerleave', onLeave);

  build();
  const resize = new ResizeObserver(() => requestDraw());
  resize.observe(ui.stage);
  const offs = [
    on('change:timeMs', () => { if (getTime() !== drawnTime) requestDraw(); }),
    on('change:selection', () => { if (siteMark(getSite()) !== drawnSite) requestDraw(); }),
    on('change:params', requestDraw),
    on('change:cvd', () => { theme = readTheme(root); requestDraw(); }),
    on('change:lang', () => { resize.disconnect(); build(); resize.observe(ui.stage); draw(); }),
    on('data:ready', requestDraw),
  ];
  document.fonts?.ready.then(requestDraw);      // les étiquettes du dessin utilisent les polices de l'application
  draw();

  return {
    update() { draw(); },
    destroy() {
      destroyed = true;
      for (const off of offs) off();
      resize.disconnect();
      clearTimeout(drawTimer); cancelAnimationFrame(drawRaf);
      root.remove();
    },
    /** Géométrie du dernier dessin (px CSS dans le canvas) : pour les tests et pour aligner un habillage. */
    layout() {
      if (!geometry || !shapes) return null;
      const g = geometry;
      return { mode: g.kind, azMin: g.azMin, azSpan: g.azSpan, elMin: g.elMin, elMax: g.elMax, plot: { x: g.L, y: g.T, w: g.PW, h: g.PH },
        verticalExaggeration: g.pxY / g.pxX, sun: { ...shapes.sun }, earth: { ...shapes.earth }, drawMs: lastDrawCost,
        track: { t0Ms: winCache.win.series.t0Ms, t1Ms: winCache.win.series.t0Ms + (winCache.win.series.n - 1) * winCache.win.series.stepMs },
        xOf: (az) => g.xOf(az), yOf: (el) => g.yOf(el) };
    },
  };
}
