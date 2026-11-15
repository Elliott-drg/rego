// Gestionnaire central des calques. Les vues (carte 2D, globe) lisent cette liste et dessinent ;
// elles ne décident ni des couleurs ni des métadonnées.
//
//   layers.all()            -> définitions + état
//   layers.active('map2d')  -> calques visibles pour une vue, dans l'ordre d'affichage (du fond vers le dessus)
//   layers.toggle(id, on) · layers.setOpacity(id, 0..1) · layers.move(id, ±1) · layers.get(id)
//   on('layers:change', (id) => …)
//
// status (fiabilité) : 'measured' produit instrumental · 'derived' produit scientifique dérivé ·
//   'computed' calculé par l'application · 'model' modèle simplifié · 'illustrative' ·
//   'imported' fourni par l'utilisateur (aucune garantie de l'application).
// kind : 'polar' raster de la grille polaire Sud · 'global' raster/texture du globe ·
//   'live' calculé à la date courante · 'vector' (points, lignes, étiquettes).

import { emit, state, on } from '../core/store.js';
import { dataAvailable } from '../data/registry.js';

const defs = [];
const st = new Map();   // id -> {on, opacity, order}

export function defineLayer(def) {
  if (st.has(def.id)) return;
  defs.push(def);
  st.set(def.id, { on: !!def.defaultOn, opacity: def.opacity ?? 0.8, order: defs.length });
}
function view(def) {
  const s = st.get(def.id);
  const missing = (def.needs || []).filter((d) => !dataAvailable(d));
  return { ...def, ...s, available: missing.length === 0, missing };
}
export const layers = {
  all() { return defs.map(view); },
  get(id) { const d = defs.find((x) => x.id === id); return d ? view(d) : null; },
  isOn(id) { return !!st.get(id)?.on; },
  active(viewName) {
    return defs.map(view).filter((l) => l.on && l.available && (!viewName || l.views.includes(viewName))).sort((a, b) => a.order - b.order);
  },
  toggle(id, on_) {
    const s = st.get(id); if (!s) return;
    const def = defs.find((x) => x.id === id);
    s.on = on_ === undefined ? !s.on : !!on_;
    // Un seul calque coloré « exclusif » par groupe d'exclusion (évite un empilement illisible)
    if (s.on && def.exclusive) for (const d of defs) if (d.id !== id && d.exclusive === def.exclusive && st.get(d.id).on) { st.get(d.id).on = false; emit('layers:change', d.id); }
    emit('layers:change', id);
  },
  setOpacity(id, v) { const s = st.get(id); if (!s) return; s.opacity = Math.max(0, Math.min(1, v)); emit('layers:change', id); },
  move(id, delta) {
    const list = defs.map((d) => ({ id: d.id, order: st.get(d.id).order })).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = st.get(list[i].id), b = st.get(list[j].id); [a.order, b.order] = [b.order, a.order];
    emit('layers:change', id);
  },
  refresh() { emit('layers:change', null); },
};
on('data:ready', () => layers.refresh());

// ------------------------------------------------------------------ Catalogue des calques
const G = { geo: 'geo', sun: 'sun', comms: 'comms', thermal: 'thermal', res: 'resources', sites: 'sites' };

[
  // --- Carte polaire (pôle Sud) ---
  { id: 'shade', group: G.geo, kind: 'live', views: ['map2d'], status: 'computed', defaultOn: true, opacity: 1, needs: ['sp_dem'], source: 'lola_gdr_polar', base: true },
  { id: 'elevation', group: G.geo, kind: 'polar', views: ['map2d'], status: 'measured', needs: ['sp_dem'], source: 'lola_gdr_polar', palette: 'elev', range: [-6000, 7000], unit: 'm', exclusive: 'color', opacity: 0.6 },
  { id: 'slope', group: G.geo, kind: 'polar', views: ['map2d'], status: 'computed', needs: ['sp_dem'], source: 'lola_gdr_polar', palette: 'slope', range: [0, 30], unit: '°', exclusive: 'color', opacity: 0.65 },
  { id: 'landable', group: G.geo, kind: 'polar', views: ['map2d'], status: 'computed', needs: ['sp_dem'], source: 'lola_gdr_polar', mask: 'ok', unit: '', opacity: 0.45 },
  { id: 'graticule', group: G.geo, kind: 'vector', views: ['map2d', 'globe'], status: 'computed', defaultOn: true, opacity: 0.5 },
  { id: 'names', group: G.geo, kind: 'vector', views: ['map2d'], status: 'derived', needs: ['features'], source: 'iau_gazetteer', defaultOn: true, opacity: 0.9 },
  { id: 'sun_now', group: G.sun, kind: 'live', views: ['map2d'], status: 'computed', needs: ['sp_dem'], source: 'lola_gdr_polar', palette: 'sun', range: [0, 100], unit: '%', exclusive: 'color', opacity: 0.6 },
  { id: 'sun_avg', group: G.sun, kind: 'polar', views: ['map2d'], status: 'derived', needs: ['sp_sun_avg'], source: 'pgda_illumination', palette: 'sun', range: [0, 100], unit: '%', exclusive: 'color', opacity: 0.7 },
  { id: 'earth_now', group: G.comms, kind: 'live', views: ['map2d'], status: 'computed', needs: ['sp_dem'], source: 'lola_gdr_polar', mask: 'earth', unit: '', opacity: 0.45 },
  { id: 'earth_avg', group: G.comms, kind: 'polar', views: ['map2d'], status: 'derived', needs: ['sp_earth_avg'], source: 'pgda_illumination', palette: 'earth', range: [0, 100], unit: '%', exclusive: 'color', opacity: 0.7 },
  { id: 'tmax', group: G.thermal, kind: 'polar', views: ['map2d'], status: 'measured', needs: ['sp_tmax'], source: 'diviner_polar', palette: 'temp', range: [20, 330], unit: 'K', exclusive: 'color', opacity: 0.7 },
  { id: 'tavg', group: G.thermal, kind: 'polar', views: ['map2d'], status: 'derived', needs: ['sp_tavg'], source: 'diviner_polar', palette: 'temp', range: [20, 250], unit: 'K', exclusive: 'color', opacity: 0.7 },
  { id: 'tmin', group: G.thermal, kind: 'polar', views: ['map2d'], status: 'measured', needs: ['sp_tmin'], source: 'diviner_polar', palette: 'temp', range: [20, 120], unit: 'K', exclusive: 'color', opacity: 0.7 },
  { id: 'psr', group: G.res, kind: 'polar', views: ['map2d'], status: 'derived', needs: ['sp_psr'], source: 'pgda_illumination', mask: 'psr', unit: '', opacity: 0.55 },
  // --- Globe ---
  { id: 'g_topo', group: G.geo, kind: 'global', views: ['globe'], status: 'measured', needs: ['global_ldem'], source: 'lola_svs_kit', palette: 'elev', range: [-9000, 10700], unit: 'm', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'g_daylight', group: G.sun, kind: 'live', views: ['globe'], status: 'computed', defaultOn: true, opacity: 1 },
  { id: 'g_temp', group: G.thermal, kind: 'live', views: ['globe'], status: 'model', palette: 'temp', range: [40, 390], unit: 'K', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'g_feo', group: G.res, kind: 'global', views: ['globe'], status: 'derived', needs: ['lpgrs'], source: 'lp_grs', palette: 'resource', range: [0, 25], unit: '% FeO', element: 'FeO', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'g_tio2', group: G.res, kind: 'global', views: ['globe'], status: 'derived', needs: ['lpgrs'], source: 'lp_grs', palette: 'resource', range: [0, 10], unit: '% TiO₂', element: 'TiO2', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'g_alca', group: G.res, kind: 'global', views: ['globe'], status: 'derived', needs: ['lpgrs'], source: 'lp_grs', palette: 'resource', range: [15, 50], unit: '% Al₂O₃+CaO', element: 'Al2O3+CaO', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'g_sio2', group: G.res, kind: 'global', views: ['globe'], status: 'derived', needs: ['lpgrs'], source: 'lp_grs', palette: 'resource', range: [38, 48], unit: '% SiO₂', element: 'SiO2', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'g_h', group: G.res, kind: 'global', views: ['globe'], status: 'derived', needs: ['lp_hydrogen'], source: 'lp_ns', palette: 'resource', range: [0, 150], unit: 'ppm H', element: 'H', exclusive: 'gcolor', opacity: 0.6 },
  { id: 'orbits', group: G.sun, kind: 'vector', views: ['globe'], status: 'illustrative', defaultOn: true, opacity: 1 },
  // --- Sites (les deux vues) ---
  { id: 'sites_artemis', group: G.sites, kind: 'vector', views: ['map2d', 'globe'], status: 'estimate', needs: [], defaultOn: true, opacity: 1 },
  { id: 'sites_historic', group: G.sites, kind: 'vector', views: ['map2d', 'globe'], status: 'measured', defaultOn: true, opacity: 1 },
  { id: 'sites_missions', group: G.sites, kind: 'vector', views: ['map2d', 'globe'], status: 'measured', defaultOn: true, opacity: 1 },
  { id: 'imports', group: G.sites, kind: 'vector', views: ['map2d', 'globe'], status: 'imported', defaultOn: true, opacity: 1 },
].forEach(defineLayer);

export const LAYER_GROUPS = ['geo', 'sun', 'comms', 'thermal', 'resources', 'sites'];
void state;
