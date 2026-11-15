// Notation des sites : formule explicite, poids modifiables.
//     score global = Σ (poids_i × note_i) / Σ poids_i        (notes sur 10)
// Deux jeux de notes :
//   - « référence » : les notes du cahier des charges (hypothèses de l'équipe),
//   - « calculé » : notes déduites des indicateurs calculés par l'application, quand ils existent
//     (communications, énergie, atterrissage, eau = indice PSR). Radiation et « autres ISRU » ne sont
//     pas calculables avec les données embarquées : la note de référence est reprise et signalée.

import { CRITERIA, REFERENCE_SCORES, DEFAULT_WEIGHTS } from '../data/reference.js';

let weights = { ...DEFAULT_WEIGHTS };
try { const s = JSON.parse(localStorage.getItem('rf.weights') || 'null'); if (s) weights = { ...weights, ...s }; } catch { /* ignore */ }
export function getWeights() { return { ...weights }; }
export function setWeights(w) { weights = { ...weights, ...w }; try { localStorage.setItem('rf.weights', JSON.stringify(weights)); } catch { /* ignore */ } }
export function resetWeights() { weights = { ...DEFAULT_WEIGHTS }; try { localStorage.removeItem('rf.weights'); } catch { /* ignore */ } }

export function weightedScore(notes, w = weights) {
  let s = 0, tot = 0;
  for (const c of CRITERIA) { if (!Number.isFinite(notes[c])) continue; s += (w[c] || 0) * notes[c]; tot += w[c] || 0; }
  return tot > 0 ? s / tot : NaN;
}
export function referenceNotes(siteId) { return REFERENCE_SCORES[siteId] || null; }

const clamp10 = (v) => Math.max(0, Math.min(10, v));
/**
 * Notes déduites des indicateurs calculés (méthode volontairement simple et lisible) :
 *   comms    = 10 × part du temps où la Terre est au-dessus de l'horizon (sur la période)
 *   energy   = 10 × part du temps où le Soleil est visible, moins 1 point par tranche de 4 jours de nuit continue au-delà de 4 jours
 *   landing  = 10 × part de la surface de pente < seuil dans le rayon d'étude
 *   water    = 10 × part de la surface en ombre permanente (PSR) dans un rayon de 5 km — INDICE INDIRECT de piège froid, pas une mesure de glace
 * @param {{metrics?:object, terrain?:object, psrFrac?:number}} a
 */
export function computedNotes(a, ref) {
  const out = {}, src = {};
  if (a.metrics) {
    out.comms = clamp10(a.metrics.earthPct / 10); src.comms = 'computed';
    out.energy = clamp10(a.metrics.sunPct / 10 - Math.max(0, (a.metrics.longestNightH / 24 - 4) / 4)); src.energy = 'computed';
  }
  if (a.terrain) { out.landing = clamp10(a.terrain.fracBelow * 10); src.landing = 'computed'; }
  if (Number.isFinite(a.psrFrac)) { out.water = clamp10(a.psrFrac * 10); src.water = 'estimate'; }
  for (const c of CRITERIA) if (!Number.isFinite(out[c]) && ref && Number.isFinite(ref[c])) { out[c] = ref[c]; src[c] = 'hypothesis'; }
  return { notes: out, sources: src };
}
export { CRITERIA };
