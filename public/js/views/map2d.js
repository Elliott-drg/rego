// Carte 2D du pôle Sud lunaire (stéréographique polaire, jusqu'à 75°S) : relief LOLA, ombres portées et
// visibilité de la Terre calculées dans le shader à la date courante, calques colorés, sites, mesure.
//
//   const map = createMap2D(container);   map.setActive(true);   map.flyTo(-89.67, 129.2, 120);
//
// Répartition : map2d/renderer.js (WebGL2), map2d/overlay.js (canvas 2D), map2d/legend.js (légende) ;
// ce fichier tient la vue (centre, échelle), les interactions et les abonnements à l'état.

import { state, set, on, select } from '../core/store.js';
import { t, deg, meters } from '../core/i18n.js';
import '../i18n/map2d.js';
import { spXYFromLatLon, spLatLonFromXY, fmtLatLon } from '../core/coords.js';
import { heightAt, slopeAt } from '../science/terrain.js';
import { ensureData, dataFailed } from '../data/registry.js';
import { LANDING_SITES, siteSelection } from '../data/sites.js';
import { layers } from '../layers/manager.js';
import { h, clear, throttle } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { createRenderer, RHO_MAX } from './map2d/renderer.js';
import { drawOverlay, inDisc, OVERLAY_FONTS } from './map2d/overlay.js';
import { renderLegend } from './map2d/legend.js';

const MIN_SCALE = 30;            // m par pixel CSS au zoom maximal (le MNT est à 240 m : au-delà, rien de plus à voir)
const SITE_SCALE = 200;          // échelle visée quand on vole vers un lieu depuis la vue d'ensemble
const CLICK_TOLERANCE = 10;      // px
const SETTLE_MS = 160;           // délai après le dernier geste avant l'image de qualité complète

/** Couleur CSS « #rrggbb » -> [r, g, b] entre 0 et 1 (fond hors carte = variable --bg du thème). */
function cssColor(name, fallback) {
  const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const n = parseInt(m ? m[1] : fallback, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * @param {HTMLElement} container élément de la vue (#view-map2d)
 * @returns {{setActive(on:boolean):void, resize():void, flyTo(lat:number, lon:number, metersPerPx?:number):void, snapshot():string|null,
 *            probe(lat:number, lon:number, timeMs?:number):object|null, perf:object}}
 *   probe et perf servent au contrôle (comparaison du shader avec le moteur CPU, durée d'une image).
 */
export function createMap2D(container) {
  container.classList.add('map2d');
  const glCanvas = h('canvas', { class: 'map2d-gl' });
  const ovCanvas = h('canvas', { class: 'map2d-overlay' });
  const notice = h('div', { class: 'map2d-notice glass hidden', role: 'status' });
  container.append(glCanvas, ovCanvas, notice);

  let renderer = null;
  try {
    renderer = createRenderer(glCanvas, {
      bg: cssColor('--bg', '070b14'),
      onInvalidate: () => invalidate(),
      onLost: () => showNotice('map2d.contextLost'),
      onRestored: () => { showNotice(null); updateNotice(); invalidate(); },
    });
  } catch (e) { console.warn('[map2d] WebGL2 inutilisable :', e.message); }
  if (!renderer) {
    // Pas de WebGL2 : un message, et une interface vide mais conforme pour main.js
    glCanvas.remove(); ovCanvas.remove();
    const relabel = () => { notice.textContent = t('map2d.noWebgl'); };
    notice.classList.remove('hidden'); relabel(); on('change:lang', relabel);
    return { setActive() {}, resize() {}, flyTo() {}, snapshot() { return null; }, probe() { return null; }, perf: null };
  }

  const ctx = ovCanvas.getContext('2d');
  const btn = (name, key, onclick) => h('button', { type: 'button', class: 'iconbtn boxed', dataset: { key }, onclick }, icon(name, 18));
  const btnIn = btn('plus', 'map2d.zoomIn', () => zoomBy(1 / 1.6));
  const btnOut = btn('minus', 'map2d.zoomOut', () => zoomBy(1.6));
  const btnReset = btn('moon', 'map2d.resetView', () => animateTo(0, 0, maxScale()));
  const btnSel = btn('target', 'map2d.centerSel', () => { const s = state.selection; if (s) flyTo(s.lat, s.lon); });
  const zoomctl = h('div', { class: 'float zoomctl' }, btnIn, btnOut, btnReset, btnSel);
  const readout = h('div', { class: 'float readout glass hidden' });
  const legend = h('div', { class: 'float legend glass hidden' });
  container.append(zoomctl, readout, legend);
  container.tabIndex = 0;
  container.setAttribute('role', 'application');

  // ------------------------------------------------------------------ Vue
  const view = { cx: 0, cy: 0, scale: 1000 };     // centre (m carte) et échelle (m par pixel CSS)
  let cssW = 0, cssH = 0, dpr = 1, active = true, fitted = false;
  let features = null;                              // formations nommées situées sur la carte, par diamètre décroissant
  let hit = { targets: [], regions: [] };           // cibles cliquables du dernier dessin
  let raf = 0, needGl = false, fastUntil = 0, settleTimer = 0, anim = 0, lastHover = null;

  const maxScale = () => 2.08 * RHO_MAX / Math.max(120, Math.min(cssW, cssH));   // toute la carte, avec une petite marge
  function clampView() {
    view.scale = Math.max(MIN_SCALE, Math.min(maxScale(), view.scale));
    const r = Math.hypot(view.cx, view.cy);
    if (r > RHO_MAX) { view.cx *= RHO_MAX / r; view.cy *= RHO_MAX / r; }
  }
  const toScreen = (lat, lon) => { const p = spXYFromLatLon(lat, lon); return [cssW / 2 + (p.x - view.cx) / view.scale, cssH / 2 - (p.y - view.cy) / view.scale]; };
  /** Pixel CSS -> {lat, lon}, ou null hors du disque cartographié. */
  function toLatLon(x, y) {
    const mx = view.cx + (x - cssW / 2) * view.scale, my = view.cy - (y - cssH / 2) * view.scale;
    return Math.hypot(mx, my) > RHO_MAX ? null : spLatLonFromXY(mx, my);
  }

  // ------------------------------------------------------------------ Dessin à la demande
  /** Demande une image. gl:false = seul le calque vectoriel a changé ; fast = geste en cours (image intermédiaire). */
  function invalidate({ gl = true, fast = false } = {}) {
    if (gl) needGl = true;
    if (fast) fastUntil = performance.now() + SETTLE_MS;
    if (!raf && active) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    if (!active || !cssW || !cssH) return;
    if (needGl) {
      needGl = false;
      const gesture = performance.now() < fastUntil;
      const complete = renderer.draw(view, { fast: gesture || state.playing, lightMarch: state.playing });
      // Après un geste ou une lecture animée, une image de qualité complète dès que tout est immobile
      clearTimeout(settleTimer); settleTimer = 0;
      if (!complete && !state.playing) settleTimer = setTimeout(() => { settleTimer = 0; fastUntil = 0; invalidate(); }, SETTLE_MS);
    }
    drawVectors();
  }
  function drawVectors() {
    const activeIds = new Set(layers.active('map2d').map((l) => l.id));
    const box = container.getBoundingClientRect();
    // Panneaux flottants de la zone centrale (les nôtres et ceux des autres modules) : les symboles Soleil/Terre les évitent
    const avoid = [...(container.parentElement || container).querySelectorAll('.float')].filter((el) => el.offsetParent !== null).map((el) => {
      const r = el.getBoundingClientRect();
      return { x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top };
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hit = drawOverlay(ctx, { w: cssW, h: cssH, view, active: activeIds, opacity: (id) => layers.get(id)?.opacity ?? 1, features, sites: LANDING_SITES, avoid });
  }

  function resize() {
    const w = container.clientWidth, hgt = container.clientHeight;
    if (!w || !hgt) return;                         // vue masquée
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (w === cssW && hgt === cssH && ratio === dpr) return;
    const overview = !fitted || view.scale >= maxScale() * 0.999;
    cssW = w; cssH = hgt; dpr = ratio;
    renderer.resize(w, hgt, dpr);
    ovCanvas.width = Math.round(w * dpr); ovCanvas.height = Math.round(hgt * dpr);
    if (overview) { view.scale = maxScale(); fitted = true; }   // la vue d'ensemble reste une vue d'ensemble
    clampView();
    invalidate();
  }

  // ------------------------------------------------------------------ Déplacements
  function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
  function zoomAt(x, y, factor) {
    stopAnim();
    const mx = view.cx + (x - cssW / 2) * view.scale, my = view.cy - (y - cssH / 2) * view.scale;
    view.scale = Math.max(MIN_SCALE, Math.min(maxScale(), view.scale * factor));
    view.cx = mx - (x - cssW / 2) * view.scale; view.cy = my + (y - cssH / 2) * view.scale;
    clampView(); invalidate({ fast: true });
  }
  function zoomBy(factor) { animateTo(view.cx, view.cy, view.scale * factor, 180); }
  /** Glisse vers un centre et une échelle. Sur une machine lente (rendu logiciel), saut direct. */
  function animateTo(cx, cy, scale, ms = 420) {
    stopAnim();
    const from = { ...view }, to = { cx, cy, scale: Math.max(MIN_SCALE, Math.min(maxScale(), scale)) };
    if (renderer.perf.fullMs > 120 || !cssW) { Object.assign(view, to); clampView(); invalidate(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - t0) / ms), e = u * u * (3 - 2 * u);
      view.cx = from.cx + (to.cx - from.cx) * e; view.cy = from.cy + (to.cy - from.cy) * e;
      view.scale = from.scale * (to.scale / from.scale) ** e;
      clampView(); invalidate({ fast: u < 1 });
      anim = u < 1 ? requestAnimationFrame(step) : 0;
    };
    anim = requestAnimationFrame(step);
  }
  /** Centre la carte sur un lieu. Sans échelle demandée : on garde le zoom, sauf depuis la vue d'ensemble. */
  function flyTo(lat, lon, metersPerPx) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inDisc(lat)) return;
    const p = spXYFromLatLon(lat, lon);
    animateTo(p.x, p.y, Number.isFinite(metersPerPx) ? metersPerPx : Math.min(view.scale, SITE_SCALE));
  }

  // ------------------------------------------------------------------ Survol et clic
  const publishHover = throttle((ll) => set({ hover: ll }), 50);
  function hover(x, y) {
    const ll = toLatLon(x, y);
    lastHover = ll ? { x, y } : null;
    publishHover(ll ? { lat: ll.lat, lon: ll.lon } : null);
    showReadout(ll);
  }
  function showReadout(ll) {
    clear(readout);
    readout.classList.toggle('hidden', ll === undefined);
    if (ll === undefined) return;
    if (!ll) { readout.append(t('map2d.readout.outside')); return; }
    const hM = heightAt(ll.lat, ll.lon), sl = slopeAt(ll.lat, ll.lon);
    readout.append(
      h('span', { class: 'map2d-ro-pos' }, fmtLatLon(ll.lat, ll.lon, view.scale < 100 ? 3 : 2, state.lang)),
      h('span', {}, h('i', {}, t('map2d.readout.height')), ' ', meters(hM)),
      h('span', {}, h('i', {}, t('map2d.readout.slope')), ' ', deg(sl ? sl.slopeDeg : NaN, 1)));
  }
  function click(x, y, ev) {
    const ll = toLatLon(x, y);
    if (!ll) return;                                 // hors du disque 75°S : rien
    if (state.tool === 'measure') { set({ measure: [...state.measure, { lat: ll.lat, lon: ll.lon }] }); return; }
    const near = (tg) => Math.hypot(Math.max(0, Math.abs(x - tg.x) - (tg.half || 0)), y - tg.y);
    const closest = (list) => list.reduce((best, tg) => (near(tg) <= CLICK_TOLERANCE && (!best || near(tg) < near(best)) ? tg : best), null);
    // 1. marqueur d'un site ; 2. intérieur d'une région Artemis ; 3. nom d'une formation ; 4. point libre.
    // Dans une région déjà sélectionnée (ou avec Maj), le clic désigne le point lui-même : on peut ainsi
    // examiner un endroit précis d'une région de 20 km de côté.
    const site = closest(hit.targets.filter((tg) => tg.sel.siteId));
    if (site) { select(site.sel); return; }
    const region = hit.regions.find((r) => pointInPolygon(x, y, r.pts));
    if (region && !ev.shiftKey && state.selection?.siteId !== region.site.id) { select(siteSelection(region.site)); return; }
    const feature = closest(hit.targets.filter((tg) => !tg.sel.siteId));
    if (feature) { select(feature.sel); return; }
    select({ name: fmtLatLon(ll.lat, ll.lon, 2, state.lang), lat: ll.lat, lon: ll.lon, kind: 'point' });
  }

  // ------------------------------------------------------------------ Souris, tactile, clavier
  const pointers = new Map();     // pointeurs posés : id -> {x, y}
  let drag = null;                // {x, y, moved} pour un pointeur ; {dist, mx, my} pour un pincement
  const local = (e) => { const r = ovCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) drag = { x: pts[0].x, y: pts[0].y, moved: drag?.moved || false };
    else if (pts.length >= 2) drag = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2, moved: true };
    else drag = null;
  }
  ovCanvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopAnim();
    try { ovCanvas.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché : le geste continue sans capture */ }
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) drag = null;
    startGesture();
    container.classList.add('is-dragging');
  });
  ovCanvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) { if (e.pointerType === 'mouse') hover(p.x, p.y); return; }
    pointers.set(e.pointerId, p);
    const pts = [...pointers.values()];
    if (pts.length === 1 && drag) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;          // en dessous : c'est encore un clic
      drag.moved = true; drag.x = p.x; drag.y = p.y;
      view.cx -= dx * view.scale; view.cy += dy * view.scale;
      clampView(); invalidate({ fast: true });
    } else if (pts.length >= 2 && drag) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      view.cx -= (mx - drag.mx) * view.scale; view.cy += (my - drag.my) * view.scale;
      if (dist > 8 && drag.dist > 8) zoomAt(mx, my, drag.dist / dist); else { clampView(); invalidate({ fast: true }); }
      drag.dist = dist; drag.mx = mx; drag.my = my;
    }
  });
  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const wasClick = e.type === 'pointerup' && pointers.size === 1 && drag && !drag.moved;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    startGesture();
    if (!pointers.size) container.classList.remove('is-dragging');
    if (wasClick) click(p.x, p.y, e);
  };
  ovCanvas.addEventListener('pointerup', release);
  ovCanvas.addEventListener('pointercancel', release);
  ovCanvas.addEventListener('pointerleave', () => { if (!pointers.size) { lastHover = null; publishHover(null); showReadout(undefined); } });
  ovCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e), unit = e.deltaMode === 1 ? 32 : 1;         // molette en lignes ou en pixels
    zoomAt(p.x, p.y, Math.exp(Math.max(-1.2, Math.min(1.2, e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0016)))));
    hover(p.x, p.y);
  }, { passive: false });
  ovCanvas.addEventListener('dblclick', (e) => { const p = local(e); zoomAt(p.x, p.y, 0.5); });
  container.addEventListener('keydown', (e) => {
    if (e.target !== container || e.ctrlKey || e.metaKey || e.altKey) return;
    const pan = 0.18 * Math.min(cssW, cssH) * view.scale;
    const moves = { ArrowLeft: [-pan, 0], ArrowRight: [pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
    if (e.key === '+' || e.key === '=') zoomBy(1 / 1.6);
    else if (e.key === '-' || e.key === '_') zoomBy(1.6);
    else if (e.key === '0' || e.key === 'Home') animateTo(0, 0, maxScale());
    else if (moves[e.key]) animateTo(view.cx + moves[e.key][0], view.cy + moves[e.key][1], view.scale, 160);
    else return;
    e.preventDefault();
  });

  // ------------------------------------------------------------------ Textes, légende, messages
  function relabel() {
    container.setAttribute('aria-label', t('map2d.aria'));
    for (const b of [btnIn, btnOut, btnReset, btnSel]) { b.title = t(b.dataset.key); b.setAttribute('aria-label', t(b.dataset.key)); }
  }
  function updateControls() { const s = state.selection; btnSel.disabled = !(s && inDisc(s.lat)); container.classList.toggle('is-measuring', state.tool === 'measure'); }
  function updateLegend() { renderLegend(legend); }
  let noticeKey = null;
  function showNotice(key) {
    noticeKey = key;
    notice.classList.toggle('hidden', !key);
    notice.classList.toggle('is-banner', key === 'map2d.noDem');   // la carte reste utilisable dessous : bandeau en haut
    notice.textContent = key ? t(key) : '';
  }
  function updateNotice() { if (!renderer.lost) showNotice(!renderer.hasDem && dataFailed('sp_dem') ? 'map2d.noDem' : null); }
  function loadFeatures() {
    ensureData('features').then((list) => {
      features = list.filter((f) => inDisc(f.lat)).sort((a, b) => b.diamKm - a.diamKm);
      invalidate({ gl: false });
    }, () => { /* gazetteer absent : le calque « noms » est marqué indisponible par le gestionnaire */ });
  }

  // ------------------------------------------------------------------ Abonnements
  on('change:timeMs', () => invalidate({ fast: true }));
  on('change:playing', (playing) => { if (!playing) invalidate(); });
  on('change:selection', (sel) => {
    updateControls();
    if (sel && inDisc(sel.lat) && cssW) {
      const [x, y] = toScreen(sel.lat, sel.lon);
      if (x < 0 || y < 0 || x > cssW || y > cssH) { const p = spXYFromLatLon(sel.lat, sel.lon); animateTo(p.x, p.y, view.scale); return; }
    }
    invalidate({ gl: false });
  });
  on('view:flyTo', (d) => { if (d) flyTo(d.lat, d.lon, d.zoom); });
  // Le gestionnaire émet aussi « layers:change » à chaque fichier de données chargé : on ne redessine que si
  // la liste des calques visibles (ordre, opacité) a réellement changé.
  let layerKey = '';
  on('layers:change', () => {
    const key = layers.active('map2d').map((l) => `${l.id}:${l.opacity}`).join('|');
    if (key === layerKey) return;
    layerKey = key;
    renderer.syncLayers(); updateLegend(); invalidate();
  });
  on('change:cvd', () => { renderer.setPalettes(); updateLegend(); invalidate(); });
  on('change:lang', () => { relabel(); updateLegend(); if (noticeKey) showNotice(noticeKey); if (lastHover) hover(lastHover.x, lastHover.y); invalidate({ gl: false }); });
  on('change:params', () => { updateLegend(); invalidate(); });
  on('change:tool', updateControls);
  for (const evt of ['change:compare', 'change:measure', 'change:imports', 'sites:ready']) on(evt, () => invalidate({ gl: false }));
  on('data:ready', (id) => {
    if (id === 'sp_dem') { renderer.uploadDem(); updateNotice(); invalidate(); }
    if (id === 'features') loadFeatures();
  });
  new ResizeObserver(resize).observe(container);    // les panneaux latéraux changent la taille de la zone centrale
  // Un canvas ne déclenche pas le chargement des polices embarquées : on les demande, puis on redessine les étiquettes
  if (document.fonts?.load) {
    Promise.all(OVERLAY_FONTS.map((f) => document.fonts.load(f))).then(() => invalidate({ gl: false }), () => { /* police absente : police système */ });
  }

  relabel(); updateControls(); updateLegend(); updateNotice(); loadFeatures(); resize();

  return {
    setActive(on_) { active = !!on_; if (active) { resize(); invalidate(); } else { stopAnim(); clearTimeout(settleTimer); settleTimer = 0; } },
    resize,
    flyTo,
    /** Image PNG (dataURL) de la carte : rendu complet + calque vectoriel, à la résolution de l'écran. */
    snapshot() {
      if (renderer.lost || !cssW) return null;
      renderer.draw(view, {}); drawVectors();
      const out = document.createElement('canvas');
      out.width = glCanvas.width; out.height = glCanvas.height;
      const g = out.getContext('2d');
      g.drawImage(glCanvas, 0, 0); g.drawImage(ovCanvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
    probe: (lat, lon, timeMs) => renderer.probe(lat, lon, timeMs),
    /** idle = plus rien à dessiner (ni image demandée, ni image complète en attente, ni chronométrage en cours). */
    get perf() { const p = renderer.perf; return { ...p, idle: !raf && !needGl && !settleTimer && !anim && !p.busy, view: { ...view }, cssW, cssH, dpr }; },
  };
}
