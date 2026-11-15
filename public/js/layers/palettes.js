// Palettes de couleurs des calques, avec variantes pour les modes daltoniens.
// Chaque palette est une liste de points d'arrêt [position 0..1, r, g, b]. lut() renvoie 256 couleurs RGBA.
//
// Règle du cahier des charges pour les ressources : rouge = faible, orange, jaune, vert = élevé,
// gris = sans donnée. En mode daltonien, cette rampe est remplacée par une rampe lisible
// (du violet sombre au jaune), et la légende donne toujours les valeurs en clair.

const VIRIDIS = [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]];
const CIVIDIS = [[0, 0, 32, 77], [0.25, 59, 77, 108], [0.5, 124, 123, 120], [0.75, 190, 173, 106], [1, 255, 234, 70]];
const MAGMA = [[0, 0, 0, 4], [0.25, 81, 18, 124], [0.5, 183, 55, 121], [0.75, 252, 137, 97], [1, 252, 253, 191]];

const BASE = {
  // Altitude : bleu profond (bas) -> sable -> blanc (haut)
  elev: [[0, 22, 30, 82], [0.2, 36, 86, 150], [0.4, 70, 150, 150], [0.55, 150, 170, 120], [0.7, 205, 180, 120], [0.85, 200, 140, 110], [1, 250, 245, 240]],
  // Pente : vert (plat) -> jaune -> rouge (raide)
  slope: [[0, 30, 140, 80], [0.25, 150, 200, 80], [0.4, 245, 220, 80], [0.6, 240, 140, 50], [1, 190, 30, 40]],
  // Ensoleillement : nuit bleu sombre -> or
  sun: [[0, 12, 16, 48], [0.3, 60, 50, 110], [0.6, 190, 100, 70], [0.85, 250, 190, 70], [1, 255, 245, 190]],
  // Visibilité de la Terre : sombre -> cyan
  earth: [[0, 14, 18, 40], [0.4, 30, 70, 130], [0.75, 50, 150, 200], [1, 170, 235, 250]],
  // Température : froid bleu -> chaud rouge
  temp: [[0, 20, 20, 90], [0.2, 40, 90, 200], [0.45, 90, 200, 220], [0.6, 240, 230, 130], [0.8, 240, 130, 50], [1, 170, 20, 30]],
  // Ressources : rouge (faible) -> orange -> jaune -> vert (élevé)
  resource: [[0, 190, 40, 40], [0.33, 240, 140, 40], [0.66, 245, 220, 70], [1, 50, 170, 80]],
  // Masques binaires (la couleur finale est donnée par maskColor)
  gray: [[0, 0, 0, 0], [1, 255, 255, 255]],
};
const CVD = {
  deuteranopia: { elev: CIVIDIS, slope: VIRIDIS, sun: CIVIDIS, earth: VIRIDIS, temp: MAGMA, resource: VIRIDIS },
  protanopia: { elev: CIVIDIS, slope: VIRIDIS, sun: CIVIDIS, earth: VIRIDIS, temp: MAGMA, resource: VIRIDIS },
  tritanopia: { elev: MAGMA, slope: MAGMA, sun: MAGMA, earth: [[0, 20, 10, 20], [0.5, 150, 40, 80], [1, 255, 200, 210]], temp: MAGMA, resource: MAGMA },
};

export function stops(name, cvd = 'none') { return (cvd !== 'none' && CVD[cvd]?.[name]) || BASE[name] || BASE.gray; }

export function colorAt(name, v, cvd = 'none') {
  const s = stops(name, cvd); const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i][0]) {
      const a = s[i - 1], b = s[i], f = (x - a[0]) / (b[0] - a[0] || 1);
      return [Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f)];
    }
  }
  const l = s[s.length - 1]; return [l[1], l[2], l[3]];
}
export function lut(name, cvd = 'none') {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) { const c = colorAt(name, i / 255, cvd); out.set([c[0], c[1], c[2], 255], i * 4); }
  return out;
}
export function cssGradient(name, cvd = 'none') {
  return `linear-gradient(90deg, ${stops(name, cvd).map((s) => `rgb(${s[1]},${s[2]},${s[3]}) ${(s[0] * 100).toFixed(0)}%`).join(', ')})`;
}
export const NODATA_RGB = [110, 114, 124];

// Couleurs catégorielles (marqueurs, séries de graphiques). Jeu sûr pour les trois daltonismes (Okabe-Ito).
const CAT = {
  none: { artemis: '#f5c542', historic: '#ff5a4d', mission: '#4da3ff', point: '#ffffff', feature: '#9fb3c8', import: '#c084fc', sun: '#ffd166', earth: '#5cc8ff', a: '#4da3ff', b: '#42c77a', c: '#f5a524', ok: '#42c77a', warn: '#f5a524', bad: '#ff5a4d', psr: '#7c5cff' },
  cvd: { artemis: '#F0E442', historic: '#D55E00', mission: '#56B4E9', point: '#ffffff', feature: '#9fb3c8', import: '#CC79A7', sun: '#E69F00', earth: '#56B4E9', a: '#0072B2', b: '#E69F00', c: '#CC79A7', ok: '#56B4E9', warn: '#E69F00', bad: '#D55E00', psr: '#CC79A7' },
};
export function cat(name, cvd = 'none') { return (cvd === 'none' ? CAT.none : CAT.cvd)[name] || '#ffffff'; }
export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
