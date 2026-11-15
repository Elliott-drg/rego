// Mode démonstration (stand, jury) : une tournée automatique qui montre l'essentiel de l'application.
//
// Déroulé, en boucle : pour chaque région de la tournée — sélection du point de meilleur compromis
// Soleil / Terre de la région (engine.regionBest, cartes moyennes NASA PGDA : le centre géométrique
// d'une région est souvent mauvais et trompeur), carte 2D centrée, calque d'éclairement instantané,
// lecture du temps à 100 000×, puis visibilité de la Terre ; ensuite la vue de comparaison avec les
// trois points. Toute action de l'utilisateur (clic, touche, molette) arrête la démo et rend
// l'application dans l'état où elle l'a trouvée (calques, vitesse, date, comparaison).
//
// `state.demo` fait foi : startDemo() / stopDemo() le modifient, le module réagit à `change:demo`
// (la démo peut donc aussi être lancée par un simple set({demo: true})).

import { state, set, on, emit, select, addToCompare, toast } from '../core/store.js';
import { t } from '../core/i18n.js';
import '../i18n/tools.js';
import { sitesOfKind, siteSelection } from '../data/sites.js';
import { tryData } from '../data/registry.js';
import { regionBest } from '../science/engine.js';
import { layers } from '../layers/manager.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { closeModal } from './modal.js';

const TOUR_REGIONS = ['malapert_massif', 'mons_mouton_plateau', 'haworth'];   // contrastes Terre / Soleil / ombre
const DEMO_SPEED = 100000;        // secondes simulées par seconde réelle
const SITE_MS = 3000;             // arrivée sur une région, avant la lecture du temps
const PLAY_MS = 12000;            // lecture du temps par région (éclairement, puis Terre à mi-parcours)
const COMPARE_MS = 10000;         // vue de comparaison
const USER_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

let run = null;   // démo en cours : {cancelled, saved, banner, caption, timers}

/** Sites de la tournée : les régions Artemis prévues, complétées par d'autres si elles manquent. */
function tourSites() {
  const artemis = sitesOfKind('artemis');
  const picked = TOUR_REGIONS.map((id) => artemis.find((s) => s.id === id)).filter(Boolean);
  const pool = [...artemis, ...sitesOfKind('mission').filter((s) => s.lat <= -75)];
  for (const s of pool) { if (picked.length >= 3) break; if (!picked.includes(s)) picked.push(s); }
  return picked;
}

/**
 * Lieu montré pour un site : le point « meilleur compromis » de la région (même sélection que le
 * panneau droit), ou le site lui-même si la région n'a pas de contour ou si les cartes moyennes manquent.
 */
function tourStop(site) {
  const best = site.corners ? regionBest(site.corners)?.both : null;
  if (!best) return { selection: siteSelection(site), best: false };
  return {
    best: true,
    selection: { key: `${site.id}:both`, name: `${site.name} — ${t('tools.demo.best')}`, lat: best.lat, lon: best.lon, kind: 'artemis', siteId: site.id, regionId: site.id, variant: 'both' },
  };
}

const wait = (r, ms) => new Promise((resolve) => { r.timers.add(setTimeout(resolve, ms)); });

async function tour(r, sites) {
  const say = (key, vars) => { r.caption.textContent = t(key, vars); };
  say('tools.demo.loading');
  await Promise.all([tryData('sp_sun_avg'), tryData('sp_earth_avg')]);   // cartes moyennes dont dépend regionBest
  while (!r.cancelled) {
    const stops = sites.map(tourStop);
    for (let i = 0; i < sites.length && !r.cancelled; i++) {
      const { selection, best } = stops[i], vars = { name: sites[i].name, i: i + 1, n: sites.length };
      layers.toggle('sun_now', false); layers.toggle('earth_now', false);
      set({ view: 'map2d', playing: false });
      select(selection);
      if (window.innerWidth < 980) set({ rightOpen: false });   // petit écran : la fiche en tiroir masquerait la carte
      emit('view:flyTo', { lat: selection.lat, lon: selection.lon });
      say(best ? 'tools.demo.step.site' : 'tools.demo.step.siteCentre', vars);
      await wait(r, SITE_MS); if (r.cancelled) return;
      layers.toggle('sun_now', true);
      set({ speed: DEMO_SPEED, playing: true });
      say('tools.demo.step.sun', vars);
      await wait(r, PLAY_MS / 2); if (r.cancelled) return;
      layers.toggle('earth_now', true);
      say('tools.demo.step.earth', vars);
      await wait(r, PLAY_MS / 2); if (r.cancelled) return;
      set({ playing: false });
    }
    layers.toggle('sun_now', false); layers.toggle('earth_now', false);
    set({ compare: [] });
    for (const stop of stops) addToCompare(stop.selection);
    set({ view: 'compare' });
    say('tools.demo.step.compare', { n: sites.length });
    await wait(r, COMPARE_MS);
  }
}

function begin() {
  if (run) return;
  const sites = tourSites();
  if (!sites.length) { toast(t('tools.demo.noSites'), 'warn'); set({ demo: false }); return; }
  closeModal();
  const caption = h('span', { class: 'demo-caption' });
  const banner = h('div', { class: 'demo-banner glass', role: 'status' },
    h('div', { class: 'demo-head' }, h('span', { class: 'demo-title' }, icon('play', 13), t('tools.demo.banner')), h('span', { class: 'demo-hint' }, t('tools.demo.hint'))),
    caption);
  (document.getElementById('main') || document.body).append(banner);
  const r = run = {
    cancelled: false, banner, caption, timers: new Set(),
    saved: { view: state.view, timeMs: state.timeMs, speed: state.speed, compare: state.compare, layers: layers.all().map((l) => [l.id, l.on]) },
  };
  // Les écouteurs sont posés après le geste qui a lancé la démo, pour qu'il ne l'arrête pas aussitôt.
  r.timers.add(setTimeout(() => { if (!r.cancelled) for (const ev of USER_EVENTS) window.addEventListener(ev, stopDemo, { capture: true, passive: true }); }, 300));
  tour(r, sites).catch((e) => { console.error('[démo]', e); stopDemo(); });
}

function end() {
  const r = run;
  if (!r) return;
  run = null; r.cancelled = true;
  for (const id of r.timers) clearTimeout(id);
  for (const ev of USER_EVENTS) window.removeEventListener(ev, stopDemo, { capture: true });
  r.banner.remove();
  // État propre : calques comme avant, lecture arrêtée, date, vitesse et comparaison d'origine.
  for (const [id, wasOn] of r.saved.layers) if (layers.isOn(id) !== wasOn) layers.toggle(id, wasOn);
  set({ playing: false, speed: r.saved.speed, timeMs: r.saved.timeMs, compare: r.saved.compare, ...(state.view === 'compare' ? { view: r.saved.view } : {}) });
}

on('change:demo', (v) => (v ? begin() : end()));

/** Lance la tournée de démonstration. */
export function startDemo() { set({ demo: true }); }
/** Arrête la démonstration et rend la main à l'utilisateur. */
export function stopDemo() { set({ demo: false }); }
