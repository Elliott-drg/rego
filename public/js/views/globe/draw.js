// Dessins 2D (canvas) utilisés comme textures par le globe : formes des marqueurs, pastilles, anneau,
// halo du Soleil, Terre schématique. Aucune image externe.
import * as THREE from 'three';

/** Générateur pseudo-aléatoire à graine (mulberry32) : mêmes étoiles et mêmes nuages à chaque chargement. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Texture couleur (sRGB) à partir d'un canvas. */
export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Une forme par type de site : la couleur n'est jamais le seul repère.
export const KIND_SHAPE = { artemis: 'diamond', historic: 'circle', mission: 'triangle', import: 'square', point: 'cross' };

/** Trace le contour d'une forme centrée (rayon r). */
function shapePath(ctx, shape, cx, cy, r) {
  ctx.beginPath();
  if (shape === 'diamond') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.82, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.82, cy); ctx.closePath(); }
  else if (shape === 'triangle') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.95, cy + r * 0.78); ctx.lineTo(cx - r * 0.95, cy + r * 0.78); ctx.closePath(); }
  else if (shape === 'square') { ctx.rect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56); }
  else ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
}

/** Dessine un marqueur (forme pleine, liseré sombre) dans un canvas carré. */
export function drawMarker(canvas, shape, color) {
  const s = canvas.width, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  if (shape === 'cross') {            // point libre : petite croix
    ctx.lineCap = 'round';
    for (const [w, col] of [[s * 0.2, '#0b111d'], [s * 0.09, color]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.2); ctx.lineTo(s * 0.5, s * 0.8); ctx.moveTo(s * 0.2, s * 0.5); ctx.lineTo(s * 0.8, s * 0.5); ctx.stroke();
    }
    return canvas;
  }
  shapePath(ctx, shape, s / 2, s / 2, s * 0.36);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b111d'; ctx.lineWidth = s * 0.16; ctx.stroke();
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = s * 0.035; ctx.stroke();
  return canvas;
}

/** Anneau de sélection (blanc, liseré sombre). */
export function drawRing(canvas) {
  const s = canvas.width, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  for (const [w, col] of [[s * 0.12, 'rgba(7,11,20,.9)'], [s * 0.055, '#ffffff']]) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2); ctx.stroke();
  }
  return canvas;
}

/** Pastille A/B/C des scénarios comparés (petite pointe vers le lieu). */
export function drawBadge(canvas, letter, color) {
  const s = canvas.width, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  const r = s * 0.2, x0 = s * 0.14, y0 = s * 0.06, w = s * 0.72, h = s * 0.62;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  ctx.lineTo(s * 0.6, y0 + h); ctx.lineTo(s * 0.5, s * 0.94); ctx.lineTo(s * 0.4, y0 + h);
  ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#0b111d'; ctx.lineWidth = s * 0.05; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = '#0b111d'; ctx.font = `700 ${Math.round(s * 0.46)}px Barlow, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, s / 2, y0 + h / 2 + s * 0.02);
  return canvas;
}

/** Repère du point subsolaire (disque à rayons) ou sub-terrestre (cercle barré d'une croix). */
export function drawSubPoint(canvas, body, color) {
  const s = canvas.width, ctx = canvas.getContext('2d'), c = s / 2;
  ctx.clearRect(0, 0, s, s);
  ctx.lineCap = 'round';
  const stroke = (w, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
    if (body === 'sun') {
      ctx.arc(c, c, s * 0.16, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(c + Math.cos(a) * s * 0.27, c + Math.sin(a) * s * 0.27); ctx.lineTo(c + Math.cos(a) * s * 0.4, c + Math.sin(a) * s * 0.4); }
    } else {
      ctx.arc(c, c, s * 0.3, 0, Math.PI * 2);
      ctx.moveTo(c - s * 0.3, c); ctx.lineTo(c + s * 0.3, c); ctx.moveTo(c, c - s * 0.3); ctx.lineTo(c, c + s * 0.3);
    }
    ctx.stroke();
  };
  stroke(s * 0.15, 'rgba(7,11,20,.9)'); stroke(s * 0.07, color);
  return canvas;
}

/** Halo du Soleil : disque blanc-jaune et dégradé radial. */
export function drawSunGlow(canvas) {
  const s = canvas.width, ctx = canvas.getContext('2d'), c = s / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(0.16, 'rgba(255,246,200,1)'); g.addColorStop(0.2, 'rgba(255,214,110,.75)');
  g.addColorStop(0.45, 'rgba(255,170,60,.18)'); g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.clearRect(0, 0, s, s); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return canvas;
}

/**
 * Terre schématique (équirectangulaire) : dégradé d'océan, calottes claires et bandes de nuages générées.
 * Ce n'est pas une carte : aucun continent n'est dessiné.
 */
export function drawEarth(canvas) {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#dfeaf2'); g.addColorStop(0.1, '#7fb2d6'); g.addColorStop(0.3, '#2c6fb3'); g.addColorStop(0.5, '#1c57a0');
  g.addColorStop(0.7, '#2c6fb3'); g.addColorStop(0.9, '#7fb2d6'); g.addColorStop(1, '#e8eff5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const rnd = seededRandom(1969);
  for (let i = 0; i < 260; i++) {
    const y = h * (0.08 + 0.84 * rnd()), x = w * rnd(), rx = w * (0.02 + 0.07 * rnd()), ry = h * (0.008 + 0.022 * rnd());
    ctx.fillStyle = `rgba(255,255,255,${(0.1 + 0.3 * rnd()).toFixed(2)})`;
    for (const dx of [-w, 0, w]) { ctx.beginPath(); ctx.ellipse(x + dx, y, rx, ry, (rnd() - 0.5) * 0.5, 0, Math.PI * 2); ctx.fill(); }   // raccord à ±180°
  }
  return canvas;
}

/** Petit canvas de légende montrant la forme d'un type de marqueur. */
export function legendSwatch(shape, color) {
  const c = makeCanvas(32, 32);
  drawMarker(c, shape, color);
  c.className = 'globe-swatch';
  c.setAttribute('aria-hidden', 'true');
  return c;
}
