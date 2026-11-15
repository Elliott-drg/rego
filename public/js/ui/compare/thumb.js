// Vue « Comparer » : vignette du relief autour d'un site (30 km de côté), calculée sur le processeur.
//
// Orientation : celle de la carte 2D du pôle Sud (longitude 0° vers le haut, 90°E à droite), pour
// qu'on reconnaisse le terrain d'une vue à l'autre. Le relief vient du MNT LOLA (terrain.heightAt).
// L'ombrage est ILLUSTRATIF : la lumière vient de l'azimut réel du Soleil à la date du scénario, mais
// à une hauteur fixe (au pôle, le Soleil rase l'horizon : un ombrage exact serait presque tout noir),
// sur un relief accentué et sans ombres portées. Les marqueurs du bord donnent la direction réelle du Soleil et de la Terre.

import { state } from '../../core/store.js';
import { t, deg } from '../../core/i18n.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { cat, hexToRgb } from '../../layers/palettes.js';
import { heightAt } from '../../science/terrain.js';
import { samplePolar, dataLoaded } from '../../data/registry.js';
import { spXYFromLatLon, spLatLonFromXY, spScaleFactor, DEG } from '../../core/coords.js';
import { displayName } from './analyze.js';
import { put } from './util.js';

const SIDE_M = 30000;          // côté de la vignette, au sol
const N = 220;                 // pixels de relief calculés par côté
const PX = 440;                // taille interne du canevas (2× pour des tracés nets)
const LIGHT_EL_DEG = 20;       // hauteur d'éclairage fixe
const EXAGGERATION = 2.5;      // relief accentué : à 240 m de maille, les pentes vraies donnent une image plate
const SCALE_BAR_M = 5000;

/** Hauteurs (m) sur une grille (N+2)² centrée sur le site, et masque d'ombre permanente N². */
function sampleGrid(lat, lon) {
  const c = spXYFromLatLon(lat, lon), step = (SIDE_M / N) * spScaleFactor(lat);   // pas en mètres carte
  const W = N + 2, heights = new Float32Array(W * W), psr = new Uint8Array(N * N);
  const withPsr = dataLoaded('sp_psr');
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const ll = spLatLonFromXY(c.x + (i - W / 2 + 0.5) * step, c.y - (j - W / 2 + 0.5) * step);
      heights[j * W + i] = heightAt(ll.lat, ll.lon);
      if (withPsr && i > 0 && j > 0 && i <= N && j <= N) psr[(j - 1) * N + (i - 1)] = samplePolar('sp_psr', ll.lat, ll.lon) > 0 ? 1 : 0;
    }
  }
  return { heights, psr, withPsr };
}

/** Direction (dans le plan de la carte, x à droite, y vers le haut) d'un azimut vu du site. */
function mapDirection(azDeg, lonDeg) {
  // À la longitude L, le Nord local (on s'éloigne du pôle) est (sin L, cos L) et l'Est local (cos L, −sin L).
  const sl = Math.sin(lonDeg * DEG), cl = Math.cos(lonDeg * DEG), ca = Math.cos(azDeg * DEG), sa = Math.sin(azDeg * DEG);
  return { x: ca * sl + sa * cl, y: ca * cl - sa * sl };
}

function shade(grid, sunDir, psrRgb) {
  const W = N + 2, g2 = (2 * (SIDE_M / N)) / EXAGGERATION, img = new ImageData(N, N);
  const ce = Math.cos(LIGHT_EL_DEG * DEG), lz = Math.sin(LIGHT_EL_DEG * DEG), lx = sunDir.x * ce, ly = sunDir.y * ce;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const q = (j + 1) * W + (i + 1), o = (j * N + i) * 4;
      const hx = (grid.heights[q + 1] - grid.heights[q - 1]) / g2;      // pente vers la droite
      const hy = (grid.heights[q - W] - grid.heights[q + W]) / g2;      // pente vers le haut de l'image
      let r, g, b;
      if (!Number.isFinite(hx) || !Number.isFinite(hy)) { r = g = b = 20; }   // hors du MNT
      else {
        const lum = Math.max(0, (-hx * lx - hy * ly + lz) / Math.sqrt(1 + hx * hx + hy * hy));
        const v = 22 + 230 * Math.min(1, lum / 0.76);
        r = v * 0.93; g = v * 0.96; b = v;
        if (grid.psr[j * N + i]) { r = r * 0.5 + psrRgb[0] * 0.5; g = g * 0.5 + psrRgb[1] * 0.5; b = b * 0.5 + psrRgb[2] * 0.5; }
      }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  return img;
}

/** Trait lisible sur fond clair comme sur fond sombre : liseré noir sous le trait de couleur. */
function strokeBoth(ctx, color, width, draw) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4, 8, 16, .85)'; ctx.lineWidth = width + 3; ctx.beginPath(); draw(); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); draw(); ctx.stroke();
}
function textBoth(ctx, text, x, y, align = 'left') {
  ctx.font = '500 22px "Plex Mono", ui-monospace, monospace'; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(4, 8, 16, .85)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
}

function drawOverlays(ctx, sc, a) {
  const c = PX / 2;
  // Réticule sur le site
  strokeBoth(ctx, '#fff', 2.5, () => {
    ctx.moveTo(c + 14, c); ctx.arc(c, c, 14, 0, 2 * Math.PI);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(c + dx * 6, c + dy * 6); ctx.lineTo(c + dx * 30, c + dy * 30); }
  });
  // Échelle
  const bar = (SCALE_BAR_M / SIDE_M) * PX, x1 = PX - 18, y = PX - 20;
  strokeBoth(ctx, '#fff', 3, () => { ctx.moveTo(x1 - bar, y - 7); ctx.lineTo(x1 - bar, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 7); });
  textBoth(ctx, '5 km', x1 - bar / 2, y - 12, 'center');
  // Nord local
  const n = mapDirection(0, sc.lon), nx = 60, ny = 64;
  strokeBoth(ctx, '#fff', 3, () => {
    ctx.moveTo(nx - n.x * 20, ny + n.y * 20); ctx.lineTo(nx + n.x * 20, ny - n.y * 20);
    const ang = Math.atan2(-n.y, n.x);
    for (const d of [2.6, -2.6]) { ctx.moveTo(nx + n.x * 20, ny - n.y * 20); ctx.lineTo(nx + n.x * 20 + Math.cos(ang + d) * 11, ny - n.y * 20 + Math.sin(ang + d) * 11); }
  });
  textBoth(ctx, 'N', nx + n.x * 36, ny - n.y * 36 + 8, 'center');
  // Directions réelles du Soleil (disque à rayons) et de la Terre (anneau barré), sur le bord
  const R = PX / 2 - 26;
  const edge = (az) => { const d = mapDirection(az, sc.lon); return [c + d.x * R, c - d.y * R]; };
  const [sx, sy] = edge(a.now.sun.az), [ex, ey] = edge(a.now.earth.az);
  const sun = cat('sun', state.cvd), earth = cat('earth', state.cvd);
  strokeBoth(ctx, sun, 3, () => { for (let k = 0; k < 8; k++) { const q = (k * Math.PI) / 4; ctx.moveTo(sx + Math.cos(q) * 13, sy + Math.sin(q) * 13); ctx.lineTo(sx + Math.cos(q) * 19, sy + Math.sin(q) * 19); } });
  ctx.fillStyle = 'rgba(4, 8, 16, .85)'; ctx.beginPath(); ctx.arc(sx, sy, 11, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 2 * Math.PI); ctx.fill();
  strokeBoth(ctx, earth, 3, () => { ctx.moveTo(ex + 11, ey); ctx.arc(ex, ey, 11, 0, 2 * Math.PI); ctx.moveTo(ex - 11, ey); ctx.lineTo(ex + 11, ey); });
}

/** @returns {{el:HTMLElement, update:(sc:object, a:object|null)=>void}} */
export function createThumb() {
  const canvas = h('canvas', { class: 'cmp-thumb-canvas', width: PX, height: PX, role: 'img' });
  const none = h('div', { class: 'cmp-thumb-none' });
  const legend = h('div', { class: 'cmp-thumb-legend' });
  const el = h('figure', { class: 'cmp-thumb' }, canvas, none, legend);
  const relief = document.createElement('canvas'); relief.width = relief.height = N;
  let grid = null, gridKey = '', drawnKey = '';

  function update(sc, a) {
    const usable = !!a && a.info.polar && Number.isFinite(a.info.heightM);
    canvas.hidden = !usable; legend.hidden = !usable; none.hidden = usable;
    if (!usable) {
      // Dans la grille polaire mais sans hauteur : c'est le MNT qui manque.
      none.textContent = t(sc.lat <= -75 ? 'compare.thumb.noDem' : 'compare.thumb.none');
      drawnKey = '';
      return;
    }
    const gKey = `${sc.lat.toFixed(5)},${sc.lon.toFixed(5)}|${dataLoaded('sp_psr')}`;
    if (gKey !== gridKey) { grid = sampleGrid(sc.lat, sc.lon); gridKey = gKey; }
    // Le relief n'est redessiné que si la lumière a tourné d'au moins un degré.
    const key = `${gKey}|${Math.round(a.now.sun.az)}|${Math.round(a.now.earth.az)}|${state.cvd}`;
    if (key !== drawnKey) {
      relief.getContext('2d').putImageData(shade(grid, mapDirection(a.now.sun.az, sc.lon), hexToRgb(cat('psr', state.cvd))), 0, 0);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.drawImage(relief, 0, 0, PX, PX);
      drawOverlays(ctx, sc, a);
      drawnKey = key;
    }
    canvas.setAttribute('aria-label', t('compare.thumb.alt', { name: displayName(sc) }));
    put(legend,
      h('span', { class: 'cmp-thumb-az' }, icon('sun', 13), t('compare.az', { v: deg(a.now.sun.az, 0) })),
      h('span', { class: 'cmp-thumb-az' }, icon('earth', 13), t('compare.az', { v: deg(a.now.earth.az, 0) })),
      grid.withPsr ? h('span', {}, h('i', { class: 'swatch', style: { background: cat('psr', state.cvd) } }), t('compare.thumb.psr')) : null);
  }
  return { el, update };
}
