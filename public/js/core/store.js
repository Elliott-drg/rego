// État central + bus d'événements. Aucun module ne modifie `state` directement : passer par set().
//
//   import { state, set, on, emit, select } from '../core/store.js';
//   on('change:timeMs', (v) => ...);  on('change', (keys) => ...);  set({ timeMs: Date.now() });
//
// Événements : 'change:<clé>' (valeur, ancienne valeur), 'change' (liste des clés modifiées),
// plus des événements libres émis par les modules ('layers:change', 'data:progress', 'toast'…).

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
export function emit(evt, ...args) {
  const set_ = listeners.get(evt);
  if (!set_) return;
  for (const fn of [...set_]) { try { fn(...args); } catch (e) { console.error(`[bus] ${evt}`, e); } }
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('rf.prefs') || '{}'); } catch { return {}; } })();

export const state = {
  // Préférences (persistées)
  lang: saved.lang || ((navigator.language || 'fr').startsWith('fr') ? 'fr' : 'en'),   // 'fr' | 'en'
  cvd: saved.cvd || 'none',             // 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia'
  mode: saved.mode || 'simple',         // 'simple' | 'expert'
  tempUnit: saved.tempUnit || 'K',      // 'K' | 'C' (affichage principal ; l'autre unité est toujours donnée)
  // Navigation
  view: 'map2d',                        // 'map2d' | 'globe' | 'compare'
  leftOpen: true, rightOpen: true,
  demo: false,
  // Temps (UTC)
  timeMs: Date.now(),
  playing: false,
  speed: 10000,                         // secondes simulées par seconde réelle
  timeScale: 'year',                    // 'lunarDay' | 'year' | 'decade' : étendue de la barre de temps
  // Sélection géographique partagée par la carte 2D, le globe et les panneaux
  selection: null,                      // {key, name, lat, lon, kind:'artemis'|'historic'|'mission'|'feature'|'point'|'import', siteId?}
  hover: null,                          // {lat, lon, heightM?} sous le curseur
  compare: [],                          // jusqu'à 3 scénarios {key, name, lat, lon, kind, siteId?, dateMs:null|number}
  // Paramètres de calcul (mode expert)
  params: { mastM: 2, earthMarginDeg: 0, slopeLimitDeg: 10, landingRadiusM: 2000, ...(saved.params || {}) },
  // Outils
  tool: null,                           // null | 'measure'
  measure: [],                          // points {lat, lon} de l'outil de mesure
  imports: [],                          // jeux importés [{id, name, color, features:[{type:'point'|'line'|'polygon', coords:[[lat,lon],…], name?, props?}]}]
  // Environnement
  server: null,                         // null (inconnu) | true (serveur local Node présent) | false (serveur statique)
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
};

const PERSIST = ['lang', 'cvd', 'mode', 'tempUnit', 'params'];
export function set(patch) {
  const keys = [];
  for (const k of Object.keys(patch)) {
    const old = state[k];
    if (old === patch[k]) continue;
    state[k] = patch[k];
    keys.push(k);
    emit('change:' + k, patch[k], old);
  }
  if (keys.length) {
    emit('change', keys);
    if (keys.some((k) => PERSIST.includes(k))) {
      try { localStorage.setItem('rf.prefs', JSON.stringify(Object.fromEntries(PERSIST.map((k) => [k, state[k]])))); } catch { /* stockage indisponible */ }
    }
  }
}
export function setParam(name, value) { set({ params: { ...state.params, [name]: value } }); }

/** Sélectionne un lieu (ou null). `key` identifie le lieu de façon stable. */
export function select(sel) {
  if (!sel) return set({ selection: null });
  const key = sel.key || sel.siteId || `pt:${sel.lat.toFixed(4)},${sel.lon.toFixed(4)}`;
  set({ selection: { kind: 'point', ...sel, key }, rightOpen: true });
}
export function addToCompare(sel, dateMs = null) {
  if (!sel) return false;
  const item = { key: sel.key, name: sel.name, lat: sel.lat, lon: sel.lon, kind: sel.kind, siteId: sel.siteId, regionId: sel.regionId, variant: sel.variant, dateMs };
  const list = state.compare.filter((c) => !(c.key === item.key && c.dateMs === dateMs));
  if (list.length >= 3) emit('compare:replaced', list.shift());   // 3 scénarios au plus : le plus ancien est retiré, et on le dit
  set({ compare: [...list, item] });
  return true;
}
export function removeFromCompare(index) { set({ compare: state.compare.filter((_, i) => i !== index) }); }
export function toast(message, kind = 'info') { emit('toast', { message, kind }); }
