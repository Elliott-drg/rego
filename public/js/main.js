// Point d'entrée : charge les données indispensables, monte l'interface, relie les vues.
import { state, set, on, toast } from './core/store.js';
import { t, applyI18n } from './core/i18n.js';
import './i18n/core.js';
import './i18n/layers.js';
import { ensureData, tryData } from './data/registry.js';
import { loadArtemisRegions } from './data/sites.js';
import { initToasts } from './ui/modal.js';
import { clearEngineCache } from './science/engine.js';
import { clearHorizonCache } from './science/sitecalc.js';

const $ = (id) => document.getElementById(id);
const views = {};

/** Charge un module d'interface ; s'il manque ou plante, l'application continue sans lui. */
async function optional(path, name) {
  try { return await import(path); } catch (e) { console.error(`[module] ${name} indisponible`, e); return null; }
}

function setLoading(text, frac) {
  $('loading-text').textContent = text;
  if (frac !== undefined) $('loading-bar').style.width = `${Math.max(2, Math.min(100, frac * 100)).toFixed(0)}%`;
}

async function boot() {
  initToasts();
  document.body.dataset.mode = state.mode;
  document.documentElement.dataset.cvd = state.cvd;
  applyI18n();

  // Serveur local présent ? (fonctions en ligne : JPL Horizons, cache disque)
  fetch('api/status', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => set({ server: !!(j && j.app === 'regolith-finder') })).catch(() => set({ server: false }));
  window.addEventListener('online', () => set({ online: true })); window.addEventListener('offline', () => set({ online: false }));

  // 1. Données indispensables : relief du pôle Sud (29 Mo, local)
  setLoading(t('boot.dem'), 0.05);
  on('data:progress', ({ id, loaded, total }) => { if (id === 'sp_dem') setLoading(t('boot.dem'), 0.05 + 0.8 * (loaded / total)); });
  await tryData('manifest');
  try { await ensureData('sp_dem'); } catch (e) { toast(t('boot.demMissing'), 'error'); }
  setLoading(t('boot.ui'), 0.9);
  await loadArtemisRegions();
  tryData('features');

  // 2. Interface
  const [shell, map2d, globe, timebar, compare, tools] = await Promise.all([
    optional('./ui/shell.js', 'shell'), optional('./views/map2d.js', 'map2d'), optional('./views/globe3d.js', 'globe3d'),
    optional('./ui/timebar.js', 'timebar'), optional('./ui/compare.js', 'compare'), optional('./ui/measure.js', 'measure'),
  ]);
  shell?.mountShell({ header: $('header'), left: $('left'), right: $('right') });
  if (map2d) views.map2d = map2d.createMap2D($('view-map2d'));
  timebar?.mountTimebar($('timebar'));
  tools?.mountMeasure?.($('main-overlays'));
  let globeView = null, compareView = null;
  const activate = () => {
    for (const v of ['map2d', 'globe', 'compare']) $('view-' + v).hidden = state.view !== v;
    if (state.view === 'globe' && !globeView && globe) { globeView = views.globe = globe.createGlobe($('view-globe')); }
    if (state.view === 'compare' && !compareView && compare) { compareView = views.compare = compare.mountCompare($('view-compare')); }
    for (const [name, v] of Object.entries(views)) v?.setActive?.(state.view === name);
  };
  on('change:view', activate); activate();

  // 3. Données secondaires, en arrière-plan
  for (const id of ['sp_sun_avg', 'sp_earth_avg', 'sp_psr', 'sp_tmax', 'sp_tmin', 'sp_tavg', 'global_ldem', 'lpgrs', 'lp_hydrogen']) tryData(id);

  // Règles transverses
  on('change:mode', (m) => { document.body.dataset.mode = m; });
  on('change:cvd', (c) => { document.documentElement.dataset.cvd = c; });
  on('change:params', () => { clearEngineCache(); clearHorizonCache(); });
  // Un raster qui arrive change les résultats mémorisés (plancher thermique Diviner, ombre permanente, cartes PGDA).
  on('data:ready', (id) => { if (typeof id === 'string' && id.startsWith('sp_')) { clearEngineCache(); if (id === 'sp_dem') clearHorizonCache(); } });
  on('change:leftOpen', (v) => $('app').classList.toggle('no-left', !v)); on('change:rightOpen', (v) => $('app').classList.toggle('no-right', !v));
  if (window.innerWidth < 980) set({ leftOpen: false, rightOpen: false });
  $('app').classList.toggle('no-left', !state.leftOpen); $('app').classList.toggle('no-right', !state.rightOpen);
  // La carte 2D ne couvre que le pôle Sud (jusqu'à 75°S) : un lieu plus au nord s'ouvre sur le globe.
  on('change:selection', (s) => { if (s && s.lat > -75 && state.view === 'map2d') set({ view: 'globe' }); });
  window.addEventListener('resize', () => { for (const v of Object.values(views)) v?.resize?.(); });

  $('loading').remove();
  window.RF = { state, set, views };     // pour le débogage et les tests
  document.body.dataset.ready = '1';
}
boot().catch((e) => { console.error(e); setLoading('Erreur de démarrage : ' + e.message); });
