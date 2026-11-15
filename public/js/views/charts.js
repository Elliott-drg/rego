// Graphiques SVG légers (sans dépendance) : radar, courbes, barres. Renvoient un élément SVG.
// Les couleurs passent par palettes.cat() pour suivre le mode daltonien ; chaque série a aussi un
// motif de trait (plein, tirets, pointillés) et un libellé : la couleur n'est jamais le seul repère.

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const DASHES = ['', '6 4', '2 3'];

/**
 * Radar. axes : [{label, max}] ; series : [{name, color, values:[…]}].
 */
export function radarChart({ axes, series, size = 300, levels = 5 }) {
  const pad = 46, cx = size / 2, cy = size / 2, r = size / 2 - pad, n = axes.length;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', role: 'img', class: 'chart chart-radar' });
  const pt = (i, f) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f]; };
  for (let l = 1; l <= levels; l++) svg.append(s('polygon', { points: axes.map((_, i) => pt(i, l / levels).join(',')).join(' '), fill: 'none', stroke: '#2b3b57', 'stroke-width': l === levels ? 1.2 : 0.6 }));
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.17);
    svg.append(s('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: '#2b3b57', 'stroke-width': 0.6 }));
    svg.append(s('text', { x: lx, y: ly, fill: '#a9b6ca', 'font-size': 11, 'text-anchor': Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end', 'dominant-baseline': 'middle' }, a.label));
  });
  series.forEach((se, k) => {
    const pts = axes.map((a, i) => pt(i, Math.max(0, Math.min(1, (se.values[i] || 0) / (a.max || 10)))).join(',')).join(' ');
    svg.append(s('polygon', { points: pts, fill: se.color, 'fill-opacity': 0.12, stroke: se.color, 'stroke-width': 2, 'stroke-dasharray': DASHES[k % 3], 'stroke-linejoin': 'round' }, s('title', {}, se.name)));
  });
  return svg;
}

/**
 * Courbes. series : [{name, color, points:[[x,y],…], dash?, fill?}] ; x/y numériques.
 * Le graphique garde ses proportions : passer une largeur proche de la largeur réelle d'affichage pour que le texte reste lisible.
 * opts : {width, height, xLabel, yLabel, yMin, yMax, xFormat, yFormat, bands:[{y0,y1,color}], vline:{x,color,label}, hlines:[{y,color,label}]}
 */
export function lineChart(series, opts = {}) {
  const W = opts.width || 520, H = opts.height || 180, m = { l: 44, r: 10, t: opts.yLabel ? 20 : 10, b: opts.xLabel ? 34 : 22 };
  const xs = series.flatMap((se) => se.points.map((p) => p[0])), ys = series.flatMap((se) => se.points.map((p) => p[1])).filter(Number.isFinite);
  const x0 = opts.xMin ?? Math.min(...xs), x1 = opts.xMax ?? Math.max(...xs);
  let y0 = opts.yMin ?? Math.min(...ys), y1 = opts.yMax ?? Math.max(...ys);
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) { y0 = 0; y1 = 1; } if (y1 === y0) y1 = y0 + 1;
  const X = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r), Y = (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'chart chart-line' });
  const yf = opts.yFormat || ((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))), xf = opts.xFormat || ((v) => v.toFixed(0));
  for (const b of opts.bands || []) svg.append(s('rect', { x: m.l, y: Y(Math.min(y1, b.y1)), width: W - m.l - m.r, height: Math.max(0, Y(Math.max(y0, b.y0)) - Y(Math.min(y1, b.y1))), fill: b.color, 'fill-opacity': b.opacity ?? 0.12 }));
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4, y = Y(yv);
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: '#1f2b40', 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 6, y: y + 3.5, fill: '#74839b', 'font-size': 10, 'text-anchor': 'end', 'font-family': 'var(--mono)' }, yf(yv)));
  }
  for (let i = 0; i <= 4; i++) {
    const xv = x0 + ((x1 - x0) * i) / 4;
    svg.append(s('text', { x: X(xv), y: H - m.b + 13, fill: '#74839b', 'font-size': 10, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', 'font-family': 'var(--mono)' }, xf(xv)));
  }
  for (const hl of opts.hlines || []) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(hl.y), y2: Y(hl.y), stroke: hl.color || '#74839b', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    if (hl.label) svg.append(s('text', { x: W - m.r - 2, y: Y(hl.y) - 3, fill: hl.color || '#a9b6ca', 'font-size': 10, 'text-anchor': 'end' }, hl.label));
  }
  series.forEach((se, k) => {
    let d = '', pen = false;
    for (const [x, y] of se.points) { if (!Number.isFinite(y)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.max(y0, Math.min(y1, y))).toFixed(1)}`; pen = true; }
    if (se.fill && se.points.length) svg.append(s('path', { d: `${d}L${X(se.points[se.points.length - 1][0]).toFixed(1)},${Y(y0)}L${X(se.points[0][0]).toFixed(1)},${Y(y0)}Z`, fill: se.color, 'fill-opacity': 0.14 }));
    svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': se.width || 1.8, 'stroke-dasharray': se.dash ?? DASHES[k % 3], 'vector-effect': 'non-scaling-stroke' }, s('title', {}, se.name)));
  });
  if (opts.vline) {
    svg.append(s('line', { x1: X(opts.vline.x), x2: X(opts.vline.x), y1: m.t, y2: H - m.b, stroke: opts.vline.color || '#fff', 'stroke-width': 1 }));
  }
  if (opts.xLabel) svg.append(s('text', { x: (W + m.l) / 2, y: H - 3, fill: '#74839b', 'font-size': 10.5, 'text-anchor': 'middle' }, opts.xLabel));
  if (opts.yLabel) svg.append(s('text', { x: 4, y: 10, fill: '#74839b', 'font-size': 10.5 }, opts.yLabel));
  return svg;
}

/** Barres horizontales notées (ex. notes /10). items : [{label, value, max, color, note}] */
export function scoreBars(items, opts = {}) {
  const wrap = document.createElement('div'); wrap.className = 'scorebars';
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'scorebar';
    const pctW = Math.max(0, Math.min(100, (100 * it.value) / (it.max || 10)));
    row.innerHTML = `<span class="scorebar-l"></span><span class="bar"><i style="width:${pctW}%;background:${it.color || 'var(--accent)'}"></i></span><span class="scorebar-v mono"></span>`;
    row.querySelector('.scorebar-l').textContent = it.label;
    row.querySelector('.scorebar-v').textContent = Number.isFinite(it.value) ? (opts.format ? opts.format(it.value) : it.value.toFixed(1)) : '—';
    if (it.tag) row.append(it.tag);
    wrap.append(row);
  }
  return wrap;
}

/**
 * Bandes de temps (disponibilité) : rows = [{label, color, intervals:[[t0,t1],…]}] sur [tMin, tMax] ; curseur facultatif.
 */
export function stripChart(rows, { tMin, tMax, cursor = null, width = 520, rowH = 14, gap = 6, labelW = 0, ticks = [] } = {}) {
  const H = rows.length * (rowH + gap) + (ticks.length ? 14 : 0);
  const svg = s('svg', { viewBox: `0 0 ${width} ${H}`, width: '100%', height: H, class: 'chart chart-strip', preserveAspectRatio: 'none' });
  const X = (t) => labelW + ((t - tMin) / (tMax - tMin)) * (width - labelW);
  rows.forEach((r, i) => {
    const y = i * (rowH + gap);
    svg.append(s('rect', { x: labelW, y, width: width - labelW, height: rowH, fill: '#172236', rx: 2 }));
    for (const [a, b] of r.intervals) { const xa = X(Math.max(tMin, a)), xb = X(Math.min(tMax, b)); if (xb > xa) svg.append(s('rect', { x: xa, y, width: Math.max(0.6, xb - xa), height: rowH, fill: r.color }, s('title', {}, r.label))); }
  });
  for (const tk of ticks) svg.append(s('text', { x: X(tk.t), y: H - 2, fill: '#74839b', 'font-size': 9.5, 'font-family': 'var(--mono)', 'text-anchor': 'middle' }, tk.label));
  if (cursor !== null && cursor >= tMin && cursor <= tMax) svg.append(s('line', { x1: X(cursor), x2: X(cursor), y1: 0, y2: rows.length * (rowH + gap) - gap, stroke: '#fff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}
export const svgEl = s;
