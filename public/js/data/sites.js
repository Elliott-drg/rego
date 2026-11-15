// Sites d'atterrissage : historiques, missions récentes (CLPS, internationales) et régions candidates Artemis III.
//
// Régions Artemis : la NASA a annoncé le 28/10/2024 NEUF RÉGIONS candidates pour Artemis III. Ce ne sont
// pas des sites d'atterrissage confirmés. Depuis le 27/02/2026, Artemis III est un vol d'essai en orbite
// terrestre et le premier alunissage habité est prévu avec Artemis IV, qui garde ces régions. Leurs coordonnées viennent de public/data/artemis_regions.json
// (carte NASA géoréférencée, précision de quelques km) ; à défaut, des valeurs de secours approximatives.
// Coordonnées des sites posés : équipe LROC (NASA/ASU) pour la plupart, NSSDCA pour Apollo ; données à 0,001°
// près, sauf Chang'e 6, IM-1 et IM-2 (0,01°).

import { tryData } from './registry.js';
import { emit } from '../core/store.js';

export const SITE_KINDS = ['artemis', 'historic', 'mission'];

/** @type {Array<{id:string,name:string,kind:string,lat:number,lon:number,year?:number,agency?:string,note?:{fr:string,en:string},approx?:boolean}>} */
export const LANDING_SITES = [
  // --- Sites historiques (projet d'origine) ---
  { id: 'apollo11', name: 'Apollo 11 — Tranquility Base', kind: 'historic', lat: 0.6741, lon: 23.4731, year: 1969, agency: 'NASA' },
  { id: 'apollo12', name: 'Apollo 12 — Ocean of Storms', kind: 'historic', lat: -3.0128, lon: -23.4219, year: 1969, agency: 'NASA' },
  { id: 'apollo15', name: 'Apollo 15 — Hadley Rille', kind: 'historic', lat: 26.1324, lon: 3.6333, year: 1971, agency: 'NASA' },
  { id: 'apollo17', name: 'Apollo 17 — Taurus-Littrow', kind: 'historic', lat: 20.1911, lon: 30.7723, year: 1972, agency: 'NASA' },
  { id: 'luna21', name: 'Luna 21 — Le Monnier', kind: 'historic', lat: 25.9994, lon: 30.4076, year: 1973, agency: 'URSS / USSR' },
  { id: 'change5', name: "Chang'e 5 — Oceanus Procellarum", kind: 'historic', lat: 43.0576, lon: -51.9161, year: 2020, agency: 'CNSA' },
  // --- Missions récentes : CLPS, commerciales et autres agences ---
  { id: 'chandrayaan3', name: 'Chandrayaan-3 — Shiv Shakti', kind: 'mission', lat: -69.373, lon: 32.319, year: 2023, agency: 'ISRO' },
  { id: 'slim', name: 'SLIM — Shioli', kind: 'mission', lat: -13.316, lon: 25.251, year: 2024, agency: 'JAXA' },
  { id: 'im1', name: 'IM-1 Odysseus — Malapert A', kind: 'mission', lat: -80.13, lon: 1.44, year: 2024, agency: 'Intuitive Machines / NASA CLPS' },
  { id: 'change6', name: "Chang'e 6 — Apollo basin", kind: 'mission', lat: -41.64, lon: -153.99, year: 2024, agency: 'CNSA' },
  { id: 'blueghost1', name: 'Blue Ghost M1 — Mare Crisium', kind: 'mission', lat: 18.562, lon: 61.81, year: 2025, agency: 'Firefly / NASA CLPS' },
  { id: 'im2', name: 'IM-2 Athena — Mons Mouton', kind: 'mission', lat: -84.79, lon: 29.2, year: 2025, agency: 'Intuitive Machines / NASA CLPS' },
];

// Valeurs de secours si artemis_regions.json est absent : centres du géoréférencement, arrondis à 0,01°
// (sans les contours ; l'interface signale alors une position de secours).
const ARTEMIS_FALLBACK = [
  ['mons_mouton_plateau', 'Mons Mouton Plateau', -84.35, 30.55], ['malapert_massif', 'Malapert Massif', -86.01, -0.18], ['mons_mouton', 'Mons Mouton', -85.44, 31.76],
  ['nobile_rim_2', 'Nobile Rim 2', -83.97, 58.8], ['nobile_rim_1', 'Nobile Rim 1', -85.46, 37.35], ['peak_near_cabeus_b', 'Peak near Cabeus B', -83.66, -68.71],
  ['slater_plain', 'Slater Plain', -87.18, 125.37], ['haworth', 'Haworth', -86.77, -22.79], ['de_gerlache_rim_2', 'de Gerlache Rim 2', -88.23, -64.61],
];
export const ARTEMIS_IDS = ARTEMIS_FALLBACK.map((a) => a[0]);
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

let artemisLoaded = false;
export async function loadArtemisRegions() {
  if (artemisLoaded) return;
  artemisLoaded = true;
  const data = await tryData('artemis_regions');
  const list = Array.isArray(data) ? data : data?.regions;
  if (list?.length) {
    for (const r of list) {
      const id = ARTEMIS_IDS.find((x) => x === slug(r.id || r.name)) || slug(r.name);
      LANDING_SITES.push({ id, name: r.name, kind: 'artemis', lat: r.center.lat, lon: r.center.lon, corners: r.corners, approx: true, source: 'georef', residualKm: r.residualKm, published: r.published || null });
    }
  } else {
    for (const [id, name, lat, lon] of ARTEMIS_FALLBACK) LANDING_SITES.push({ id, name, kind: 'artemis', lat, lon, approx: true, source: 'fallback' });
  }
  emit('sites:ready');
}
export function getSite(id) { return LANDING_SITES.find((s) => s.id === id) || null; }
export function sitesOfKind(kind) { return LANDING_SITES.filter((s) => s.kind === kind); }
/** Convertit un site en sélection (voir store.select). */
export function siteSelection(site) { return { key: site.id, siteId: site.id, name: site.name, lat: site.lat, lon: site.lon, kind: site.kind }; }
