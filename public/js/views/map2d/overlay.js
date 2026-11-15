// Calque vectoriel de la carte 2D (canvas 2D posé sur le rendu WebGL) : graticule, noms, sites, sélection,
// scénarios comparés, mesure, données importées, barre d'échelle, directions du Soleil et de la Terre.
// Redessiné en entier à chaque changement de vue ou d'état ; ne garde aucun état entre deux dessins.

import { state } from '../../core/store.js';
import { t, num, km } from '../../core/i18n.js';
import { DEG, MOON_RADIUS_KM, spXYFromLatLon, spLatLonFromXY, spScaleFactor, enuBasis, fmtLat, fmtLon, fmtLatLon, surfaceDistance, greatCirclePoint } from '../../core/coords.js';
import { subPoints } from '../../science/ephemeris.js';
import { SP_GRID } from '../../science/terrain.js';
import { cat } from '../../layers/palettes.js';
import { siteSelection } from '../../data/sites.js';
import { RHO_MAX } from './renderer.js';

const FONT = "'Barlow', 'Segoe UI', system-ui, sans-serif";
const MONO = "'Plex Mono', ui-monospace, Consolas, monospace";
/** Polices utilisées par les étiquettes (déclarées dans base.css), à charger avant le premier dessin soigné. */
export const OVERLAY_FONTS = [`500 12px ${FONT}`, `600 12px ${FONT}`, `400 11px ${MONO}`];
const INK = '#f2f6fc', HALO = 'rgba(4, 7, 13, .88)';
const SITE_LAYER = { artemis: 'sites_artemis', historic: 'sites_historic', mission: 'sites_missions' };
const rhoOfLat = (lat) => 2 * MOON_RADIUS_KM * 1000 * Math.tan((90 + lat) * DEG / 2);
/** Vrai si le lieu est dans le disque cartographié (au sud de 75°S). */
export const inDisc = (lat) => lat <= SP_GRID.minLat;

/** Texte avec liseré sombre : lisible sur le sol éclairé comme dans l'ombre. */
function label(ctx, text, x, y, { font = `500 12px ${FONT}`, color = INK, align = 'center', baseline = 'middle', halo = 3 } = {}) {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.lineJoin = 'round'; ctx.lineWidth = halo; ctx.strokeStyle = HALO;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function boxesOverlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
/** Marqueur d'un site : la forme dit le type (carré = Artemis, triangle = historique, losange = mission). */
function marker(ctx, kind, x, y, r, color) {
  ctx.beginPath();
  if (kind === 'artemis') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else if (kind === 'historic') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.15, y + r * 0.85); ctx.lineTo(x - r * 1.15, y + r * 0.85); ctx.closePath(); }
  else { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); }
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = HALO; ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx contexte déjà mis à l'échelle des pixels CSS
 * @param {{w:number, h:number, view:{cx:number, cy:number, scale:number}, active:Set<string>, opacity:(id:string)=>number,
 *          features:Array|null, sites:Array, avoid:Array<{x0,y0,x1,y1}>}} env
 * @returns {{targets:Array<{x:number, y:number, sel:object}>, regions:Array<{pts:number[][], site:object}>}}
 *   cibles cliquables (sites puis formations nommées affichées) et contours des régions Artemis, en pixels CSS
 */
export function drawOverlay(ctx, env) {
  const { w, h, view, active } = env;
  const cvd = state.cvd, lang = state.lang;
  const X = (x) => w / 2 + (x - view.cx) / view.scale, Y = (y) => h / 2 - (y - view.cy) / view.scale;
  const P = (lat, lon) => { const p = spXYFromLatLon(lat, lon); return [X(p.x), Y(p.y)]; };
  const onScreen = (x, y, m = 0) => x >= -m && y >= -m && x <= w + m && y <= h + m;
  const px0 = X(0), py0 = Y(0);                                    // le pôle à l'écran
  const targets = [], regions = [], taken = [];                   // taken = boîtes des étiquettes déjà posées
  ctx.clearRect(0, 0, w, h);

  /** Chemin d'une ligne géodésique (grand cercle) entre des points lat/lon, échantillonnée à l'écran. */
  const geodesic = (pts, close = false) => {
    const list = close ? [...pts, pts[0]] : pts;
    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const [lat, lon] = list[i];
      if (i === 0) { ctx.moveTo(...P(lat, lon)); continue; }
      const [la0, lo0] = list[i - 1], a = P(la0, lo0), b = P(lat, lon);
      const n = Math.max(1, Math.min(64, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 24)));
      for (let k = 1; k <= n; k++) { const g = greatCirclePoint(la0, lo0, lat, lon, k / n); ctx.lineTo(...P(g.lat, g.lon)); }
    }
  };
  const clipDisc = () => { ctx.beginPath(); ctx.arc(px0, py0, RHO_MAX / view.scale, 0, 2 * Math.PI); ctx.clip(); };

  // ------------------------------------------------------------ Graticule
  if (active.has('graticule')) {
    const op = env.opacity('graticule');
    const fine = view.scale <= 400;
    const dLat = fine ? 1 : 5, dLon = fine ? 10 : 30;
    ctx.save();
    ctx.lineWidth = 1;
    for (let lat = -75; lat > -89.5; lat -= dLat) {
      ctx.strokeStyle = `rgba(190, 210, 240, ${(lat === -75 ? 0.75 : lat % 5 === 0 ? 0.5 : 0.28) * op})`;
      ctx.beginPath(); ctx.arc(px0, py0, rhoOfLat(lat) / view.scale, 0, 2 * Math.PI); ctx.stroke();
    }
    for (let lon = -180; lon < 180; lon += dLon) {
      // Les méridiens convergent au pôle : seuls les quatre principaux y arrivent
      const from = lon % 90 === 0 ? 0 : lon % 30 === 0 ? rhoOfLat(-89) : rhoOfLat(-88);
      const s = Math.sin(lon * DEG), c = Math.cos(lon * DEG);
      ctx.strokeStyle = `rgba(190, 210, 240, ${(lon % 90 === 0 ? 0.5 : lon % 30 === 0 ? 0.36 : 0.24) * op})`;
      ctx.beginPath(); ctx.moveTo(X(from * s), Y(from * c)); ctx.lineTo(X(RHO_MAX * s), Y(RHO_MAX * c)); ctx.stroke();
    }
    // Étiquettes : les parallèles le long d'un rayon passant près du centre de la vue (entre deux méridiens),
    // les méridiens sur un cercle passant près du centre (entre deux parallèles).
    const rc = Math.hypot(view.cx, view.cy), reach = 0.36 * Math.min(w, h) * view.scale;
    const azC = rc > 0.2 * reach ? Math.atan2(view.cx, view.cy) / DEG : 45 - dLon / 2;
    const az = (Math.floor(azC / dLon) + 0.5) * dLon * DEG;
    const gFont = `400 10.5px ${MONO}`, gColor = `rgba(215, 228, 248, ${Math.min(1, 0.55 + op)})`;
    for (let lat = -75 - dLat; lat > -89.5; lat -= dLat) {
      const r = rhoOfLat(lat), x = X(r * Math.sin(az)), y = Y(r * Math.cos(az));
      if (onScreen(x, y, -24)) label(ctx, fmtLat(lat, 0), x, y, { font: gFont, color: gColor });
    }
    const dRho = rhoOfLat(-90 + dLat);
    const ring = Math.min(rhoOfLat(-75 - dLat / 2), (Math.floor(Math.max(rc, reach) / dRho) + 0.5) * dRho);
    for (let lon = -180; lon < 180; lon += dLon) {
      // 0°, 90°, 180° : repères des bords ; les méridiens intermédiaires seulement s'ils sont assez écartés à l'écran
      if (lon % 90 === 0 || (lon % 30 !== 0 && ring * dLon * DEG / view.scale < 72)) continue;
      const x = X(ring * Math.sin(lon * DEG)), y = Y(ring * Math.cos(lon * DEG));
      if (onScreen(x, y, -24)) label(ctx, fmtLon(lon, 0, lang), x, y, { font: gFont, color: gColor });
    }
    if (onScreen(px0, py0)) { ctx.fillStyle = gColor; ctx.beginPath(); ctx.arc(px0, py0, 2.2, 0, 2 * Math.PI); ctx.fill(); }
    ctx.restore();
  }

  // ------------------------------------------------------------ Données importées
  if (active.has('imports')) {
    ctx.save(); clipDisc();
    for (const set of state.imports) {
      const color = set.color || cat('import', cvd);
      const few = set.features.length <= 40;
      for (const f of set.features) {
        if (f.type === 'point') {
          const [lat, lon] = f.coords[0];
          if (!inDisc(lat)) continue;
          const [x, y] = P(lat, lon);
          if (!onScreen(x, y, 12)) continue;
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = HALO; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.moveTo(x, y - 2.5); ctx.lineTo(x, y + 2.5); ctx.lineWidth = 1; ctx.stroke();
          if (f.name && few) label(ctx, f.name, x + 8, y, { align: 'left', font: `500 11.5px ${FONT}` });
        } else {
          geodesic(f.coords, f.type === 'polygon');
          if (f.type === 'polygon') { ctx.globalAlpha = 0.14; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1; }
          ctx.lineWidth = 4; ctx.strokeStyle = HALO; ctx.stroke();
          ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.setLineDash(f.type === 'line' ? [] : [7, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ Sites (contours des régions, puis marqueurs)
  const sites = env.sites.filter((s) => inDisc(s.lat) && active.has(SITE_LAYER[s.kind]));
  for (const s of sites) {
    if (!s.corners) continue;
    const color = cat(s.kind, cvd);
    geodesic(s.corners.map((c) => [c.lat, c.lon]), true);
    ctx.lineWidth = 3.5; ctx.strokeStyle = HALO; ctx.stroke();
    ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);   // tirets : contour approximatif
    regions.push({ pts: s.corners.map((c) => P(c.lat, c.lon)), site: s });
  }
  for (const s of sites) {
    const [x, y] = P(s.lat, s.lon);
    if (!onScreen(x, y, 20)) continue;
    marker(ctx, s.kind, x, y, 4.2, cat(s.kind, cvd));
    targets.push({ x, y, sel: siteSelection(s) });
    // Étiquette au-dessus du rectangle de la région (ou du marqueur), sans recouvrir une autre étiquette de site
    const text = s.kind === 'artemis' ? s.name : s.name.split(' — ')[0];
    const top = s.corners ? Math.min(...s.corners.map((c) => P(c.lat, c.lon)[1])) : y - 6;
    ctx.font = `600 12px ${FONT}`;
    const tw = ctx.measureText(text).width, ly = Math.max(12, top - 9);
    const box = { x0: x - tw / 2 - 3, x1: x + tw / 2 + 3, y0: ly - 8, y1: ly + 8 };
    if (taken.some((b) => boxesOverlap(b, box))) continue;
    taken.push(box);
    label(ctx, text, x, ly, { font: `600 12px ${FONT}`, color: cat(s.kind, cvd), halo: 3.5 });
  }

  // ------------------------------------------------------------ D'où viennent la lumière et la liaison radio
  // Positions calculées ici (les noms leur laissent la place), symboles dessinés à la fin, par-dessus tout.
  const bodies = [];
  {
    const c = spLatLonFromXY(view.cx, view.cy), lat = Math.min(c.lat, SP_GRID.minLat);
    const { east, north, up } = enuBasis(lat, c.lon);
    const sp = subPoints(new Date(state.timeMs));
    const sinL = Math.sin(c.lon * DEG), cosL = Math.cos(c.lon * DEG);
    const m = 30, rDisc = RHO_MAX / view.scale;
    // Repères des bords et barre d'échelle : zones à laisser libres, comme les panneaux flottants
    const keepOut = [...env.avoid, { x0: w / 2 - 22, x1: w / 2 + 22, y0: 0, y1: 20 }, { x0: w / 2 - 80, x1: w / 2 + 80, y0: h - 50, y1: h },
      { x0: 0, x1: 40, y0: h / 2 - 8, y1: h / 2 + 8 }, { x0: w - 40, x1: w, y0: h / 2 - 8, y1: h / 2 + 8 }];
    for (const [name, vec, text] of [['sun', sp.sunVec, t('map2d.sun')], ['earth', sp.earthVec, t('map2d.earth')]]) {
      // Direction horizontale du corps vue du centre de la carte, ramenée dans le plan de la carte
      const d = vec.map((v, i) => v - up[i] * MOON_RADIUS_KM);
      const dE = d[0] * east[0] + d[1] * east[1] + d[2] * east[2], dN = d[0] * north[0] + d[1] * north[1] + d[2] * north[2];
      const mx = dE * cosL + dN * sinL, my = -dE * sinL + dN * cosL, mn = Math.hypot(mx, my) || 1;
      const ux = mx / mn, uy = -my / mn;                            // à l'écran, y vers le bas
      // Sur le bord de l'écran, ou juste au-delà du bord de la carte s'il est visible
      const ox = w / 2 - px0, oy = h / 2 - py0, b = ox * ux + oy * uy;
      const kDisc = -b + Math.sqrt(Math.max(0, b * b - (ox * ox + oy * oy - rDisc * rDisc))) + 26;
      let k = Math.min(kDisc, ux ? (w / 2 - m) / Math.abs(ux) : Infinity, uy ? (h / 2 - m) / Math.abs(uy) : Infinity);
      const inside = (r, x, y) => x > r.x0 - 16 && x < r.x1 + 16 && y > r.y0 - 16 && y < r.y1 + 16;
      while (k > 40 && keepOut.some((r) => inside(r, w / 2 + ux * k, h / 2 + uy * k))) k -= 8;
      const x = w / 2 + ux * k, y = h / 2 + uy * k;
      bodies.push({ name, text, x, y, ux, uy });
      taken.push({ x0: x - 46, x1: x + 46, y0: y - 34, y1: y + 34 });
    }
  }

  // ------------------------------------------------------------ Formations nommées (IAU)
  if (active.has('names') && env.features) {
    const op = env.opacity('names');
    let shown = 0;
    for (const f of env.features) {                                 // triées par diamètre décroissant
      if (shown >= 70) break;
      const dPx = f.diamKm * 1000 * spScaleFactor(f.lat) / view.scale;
      if (dPx < 36) break;
      const [x, y] = P(f.lat, f.lon);
      if (!onScreen(x, y, -6)) continue;
      const size = dPx > 220 ? 14 : dPx > 90 ? 12.5 : 11.5;
      const font = `${dPx > 90 ? 600 : 500} ${size}px ${FONT}`;
      ctx.font = font;
      const tw = ctx.measureText(f.name).width;
      const box = { x0: x - tw / 2 - 4, x1: x + tw / 2 + 4, y0: y - size * 0.7 - 2, y1: y + size * 0.7 + 2 };
      if (taken.some((b) => boxesOverlap(b, box))) continue;
      taken.push(box); shown++;
      label(ctx, f.name, x, y, { font, color: `rgba(232, 238, 248, ${op})` });
      targets.push({ x, y, half: tw / 2, sel: { key: `feature:${f.name}`, name: f.name, lat: f.lat, lon: f.lon, kind: 'feature' } });
    }
  }

  // ------------------------------------------------------------ Mesure
  if (state.measure.length) {
    const pts = state.measure.filter((p) => inDisc(p.lat)).map((p) => [p.lat, p.lon]);
    const color = cat('warn', cvd);
    ctx.save(); clipDisc();
    if (pts.length > 1) {
      geodesic(pts);
      ctx.lineWidth = 4.5; ctx.strokeStyle = HALO; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.setLineDash([8, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    pts.forEach(([lat, lon], i) => {
      const [x, y] = P(lat, lon);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fillStyle = HALO; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      label(ctx, String(i + 1), x, y - 13, { font: `600 11px ${MONO}`, color });
    });
    ctx.restore();
    if (pts.length > 1) {
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += surfaceDistance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      const [x, y] = P(...pts[pts.length - 1]);
      if (onScreen(x, y)) label(ctx, t('map2d.measure.total', { d: km(total, total < 20000 ? 2 : 1) }), x + 10, y + 12, { align: 'left', font: `500 12px ${MONO}`, color });
    }
  }

  // ------------------------------------------------------------ Scénarios comparés : pastilles A, B, C
  state.compare.forEach((c, i) => {
    if (!inDisc(c.lat)) return;
    const [x, y] = P(c.lat, c.lon);
    if (!onScreen(x, y, 20)) return;
    const color = cat('abc'[i], cvd), bx = x + 13, by = y - 13;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.lineWidth = 3.5; ctx.strokeStyle = HALO; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = HALO; ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, 9, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = HALO; ctx.stroke();
    ctx.font = `600 11.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#06101f';
    ctx.fillText('ABC'[i], bx, by + 0.5);
  });

  // ------------------------------------------------------------ Sélection : réticule + cartouche
  const sel = state.selection;
  if (sel && inDisc(sel.lat)) {
    const [x, y] = P(sel.lat, sel.lon);
    if (onScreen(x, y, 30)) {
      for (const [lw, col] of [[4.5, HALO], [1.8, '#ffffff']]) {
        ctx.lineWidth = lw; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 6, y + dy * 6); ctx.lineTo(x + dx * 17, y + dy * 17); }
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 2 * Math.PI); ctx.fillStyle = '#ffffff'; ctx.fill();
      const coords = fmtLatLon(sel.lat, sel.lon, 2, lang);
      const title = sel.kind === 'point' ? null : sel.name;
      ctx.font = `600 12.5px ${FONT}`; const tw1 = title ? ctx.measureText(title).width : 0;
      ctx.font = `400 11px ${MONO}`; const tw2 = ctx.measureText(coords).width;
      const bw = Math.max(tw1, tw2) + 18, bh = title ? 39 : 23;
      const bx = Math.max(6, Math.min(w - bw - 6, x - bw / 2));
      const by = y - 26 - bh > 6 ? y - 26 - bh : y + 26;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5);
      ctx.fillStyle = 'rgba(8, 13, 23, .9)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(160, 185, 225, .55)'; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (title) { ctx.font = `600 12.5px ${FONT}`; ctx.fillStyle = INK; ctx.fillText(title, bx + 9, by + 13); }
      ctx.font = `400 11px ${MONO}`; ctx.fillStyle = '#b9c7dc'; ctx.fillText(coords, bx + 9, by + bh - 11.5);
    }
  }

  // ------------------------------------------------------------ Repères des bords : la carte ne tourne jamais
  const edgeFont = `400 10.5px ${MONO}`, edgeColor = 'rgba(205, 220, 245, .85)';
  label(ctx, '0°', w / 2, 9, { font: edgeFont, color: edgeColor, baseline: 'top' });
  label(ctx, '180°', w / 2, h - 7, { font: edgeFont, color: edgeColor, baseline: 'bottom' });
  label(ctx, fmtLon(90, 0, lang), w - 8, h / 2, { font: edgeFont, color: edgeColor, align: 'right' });
  label(ctx, fmtLon(-90, 0, lang), 8, h / 2, { font: edgeFont, color: edgeColor, align: 'left' });

  // ------------------------------------------------------------ Barre d'échelle (distance au sol au centre de la vue)
  {
    const c = spLatLonFromXY(view.cx, view.cy);
    const groundPerPx = view.scale / spScaleFactor(Math.min(c.lat, SP_GRID.minLat));
    const raw = groundPerPx * Math.min(130, w * 0.3), mag = 10 ** Math.floor(Math.log10(raw));
    const len = [5, 2, 1].map((m) => m * mag).find((v) => v <= raw);
    const lp = len / groundPerPx, x0 = w / 2 - lp / 2, y = h - 30;
    const text = len >= 1000 ? t('map2d.scale.km', { n: num(len / 1000, 0) }) : t('map2d.scale.m', { n: num(len, 0) });
    for (const [lw, col] of [[4.5, HALO], [1.6, INK]]) {
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.beginPath();
      ctx.moveTo(x0, y - 5); ctx.lineTo(x0, y); ctx.lineTo(x0 + lp, y); ctx.lineTo(x0 + lp, y - 5); ctx.stroke();
    }
    label(ctx, text, w / 2, y - 9, { font: `400 11px ${MONO}` });
  }

  for (const { name, text, x, y, ux, uy } of bodies) {
    const color = cat(name, cvd);
    ctx.save(); ctx.translate(x, y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [lw, col] of [[4.5, HALO], [1.7, color]]) {
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.beginPath();
      // Flèche vers le corps, au-delà du symbole
      ctx.moveTo(ux * 13, uy * 13); ctx.lineTo(ux * 21, uy * 21);
      ctx.moveTo(ux * 21 - uy * 4 - ux * 4, uy * 21 + ux * 4 - uy * 4); ctx.lineTo(ux * 21, uy * 21); ctx.lineTo(ux * 21 + uy * 4 - ux * 4, uy * 21 - ux * 4 - uy * 4);
      if (name === 'sun') for (let a = 0; a < 8; a++) { const ca = Math.cos(a * Math.PI / 4), sa = Math.sin(a * Math.PI / 4); ctx.moveTo(ca * 8, sa * 8); ctx.lineTo(ca * 11, sa * 11); }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, name === 'sun' ? 5.5 : 7, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = HALO; ctx.stroke();
    if (name === 'earth') {                                        // méridien et équateur : un globe, pas un disque plein
      ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.ellipse(0, 0, 3, 7, 0, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
    // Libellé du côté intérieur de la carte
    label(ctx, text, x - ux * 20, y - uy * 20, { font: `600 11.5px ${FONT}`, color, align: ux > 0.35 ? 'right' : ux < -0.35 ? 'left' : 'center', baseline: uy > 0.35 ? 'bottom' : uy < -0.35 ? 'top' : 'middle' });
  }
  return { targets, regions };
}
