// Tests du pré-dimensionnement énergétique (calcul pur). Lancer : node --test tests/energy.test.mjs
// Les valeurs attendues sont calculées à la main dans les commentaires.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeEnergy, simulateBalance, replayPeriod, smallestArray, solarProfile, siteInputs, sanitize, findInvalid, toCsv,
  DEFAULTS, FIELDS, STORAGE_PRESETS, LUNAR_DAY_H, ARRAY_CAP_FACTOR, DEFICIT_TOLERANCE,
} from '../public/js/science/energy.js';

const near = (got, want, tol = 1e-6, msg = '') => assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${msg} attendu ${want}, obtenu ${got}`);

// Hypothèses « rondes » pour le calcul à la main : 4 personnes, 16 kW moyens.
const BASE = {
  ...DEFAULTS, crew: 4, lifeSupportKWpp: 1.5, habitatKW: 5, scienceKW: 2, mobilityKW: 2, commsKW: 1, isruKW: 0,
  peakFactor: 1.5, survivalPct: 100, roundTripPct: 81, dodPct: 80, specificEnergyWhKg: 200, marginPct: 25,
  cellEffPct: 30, degradationPct: 80, pmadEffPct: 90, arealMassKgM2: 5, solarConstantWM2: 1361,
  fissionUnitKWe: 10, fissionUnitMassKg: 1500, fissionSpare: 1, hybridBufferH: 4, panelType: 'vertical',
};
// Indicateurs seuls, sans profil d'éclairement : suffisant pour les charges, le stockage et la fission.
const SITE = { sunPct: 50, longestNightH: 100, longestDayH: 300, powerVerticalPct: 40, powerHorizontalPct: 5, nightCensored: false };
const arch = (r, id) => r.architectures.find((x) => x.id === id);

/** Profil au pas d'une heure à partir de segments [éclairé ?, heures] ; panneau vertical à plein quand il fait jour. */
function profileOf(segments, cycles = 1) {
  const one = segments.flatMap(([v, h]) => Array(h).fill(v)), lit = [];
  for (let c = 0; c < cycles; c++) lit.push(...one);
  return { n: lit.length, stepH: 1, lit: Uint8Array.from(lit), vertical: Float32Array.from(lit), horizontal: new Float32Array(lit.length) };
}
/** Site factice : `nightH` = plus longue nuit, comme la donnerait le moteur. */
const siteOf = (profile, nightH, extra = {}) => {
  const litPct = (100 * profile.lit.reduce((s, v) => s + v, 0)) / profile.n;
  return siteInputs({ sunPct: litPct, longestNightH: nightH, longestDayH: 0, powerVerticalPct: litPct, powerHorizontalPct: 0, nightCensored: false, ...extra }, profile);
};
// Cycle régulier d'un jour lunaire de 709 h : 354 h de jour, 355 h de nuit, répété 3 fois.
const REGULAR = profileOf([[1, 354], [0, 355]], 3);

test('cas 1 — charges : moyenne, énergie quotidienne, pointe', () => {
  const r = computeEnergy(BASE, SITE);
  near(r.loads.avgKW, 16);            // 4 × 1,5 + 5 + 2 + 2 + 1 + 0
  near(r.loads.dailyKWh, 384);        // 16 kW × 24 h
  near(r.loads.peakKW, 24);           // 16 × 1,5
  near(r.loads.items[0].kW, 6);       // support de vie : 4 × 1,5
  near(r.loads.missionKWh, 384 * 180);
});

test('cas 2 — énergie de nuit, capacité et masse de stockage', () => {
  const r = computeEnergy(BASE, SITE);
  near(r.storage.nightEnergyKWh, 1600);                 // 16 kW × 100 h
  near(r.storage.etaD, 0.9);                            // √0,81
  near(r.storage.capacityKWh, 2777.7777778);            // 1600 / (0,9 × 0,8) × 1,25
  near(r.storage.usableKWh, 2222.2222222);              // × 0,8
  near(r.storage.nominalKWh, 1777.7777778);             // 1600 / 0,9 : part utile hors marge
  near(r.storage.massKg, 13888.888889);                 // 2 777 778 Wh / 200 Wh/kg
  near(r.storage.marginPlannedPct, 20);                 // 0,25 / 1,25 de la capacité utile
  assert.equal(r.storage.governs, 'night');
});

test('cas 3 — champ solaire : la dichotomie retrouve la formule fermée sur un cycle régulier', () => {
  // Un jour de 354 h, une nuit de 355 h. En régime établi, les heures de jour doivent fournir la charge de jour et
  // rendre au stockage l'énergie de la nuit : P_crête × 0,72 = 16 + 16 × 355 / (0,81 × 354)  ->  P_crête = 49,7335 kWc
  const r = computeEnergy(BASE, siteOf(REGULAR, 355));
  assert.equal(r.solar.feasible, true);
  near(r.solar.installedKWp, (16 + (16 * 355) / (0.81 * 354)) / 0.72, 2e-4);
  near(r.solar.rechargeKW, (16 * 355) / (0.81 * 354), 5e-4);            // P_rech = P_crête × 0,72 − 16 = E_nuit / (η_ar × t_jour)
  near(r.solar.rechargeHours, 354, 5e-4);                               // le plein de la nuit est refait en un jour
  near(r.solar.areaM2, (r.solar.installedKWp * 1000) / (1361 * 0.3));   // ≈ 121,8 m²
  near(r.solar.massKg, r.solar.areaM2 * 5);
  assert.equal(r.balance.ok, true); assert.equal(r.balance.deficitDays, 0); near(r.balance.unservedKWh, 0, 1e-6);
  // Minimalité : 1 % de panneaux en moins et la période ne passe plus
  const p = { panelType: 'vertical', derate: 0.72, baseKW: 0, dayLoadKW: 16, nightLoadKW: 16, usableKWh: r.storage.usableKWh, etaC: 0.9, etaD: 0.9 };
  assert.equal(replayPeriod(REGULAR, { ...p, installedKWp: r.solar.installedKWp }).ok, true);
  assert.equal(replayPeriod(REGULAR, { ...p, installedKWp: r.solar.installedKWp * 0.99 }).ok, false);
});

test('cas 4 — fission seule : unités pour la pointe + secours', () => {
  const f = arch(computeEnergy(BASE, SITE), 'fission');
  assert.equal(f.units, 4);                              // ⌈24 / 10⌉ = 3, + 1 de secours
  near(f.fissionKW, 40); near(f.massKg, 6000); near(f.storageKWh, 0); near(f.solarKWp, 0);
  // Pointe exactement multiple de l'unité : pas d'unité en trop
  assert.equal(arch(computeEnergy({ ...BASE, peakFactor: 1.25 }, SITE), 'fission').units, 3);   // 20 kW -> 2 + 1
});

test('cas 5 — hybride : fission pour la nuit, solaire pour le complément de jour, tampon de 4 h', () => {
  const r = computeEnergy({ ...BASE, survivalPct: 50 }, siteOf(REGULAR, 355)), h = arch(r, 'hybrid');
  near(r.loads.nightKW, 8);
  assert.equal(h.units, 1); near(h.fissionKW, 10);       // ⌈8 / 10⌉
  near(h.dayComplementKW, 6);                            // 16 − 10
  near(h.storageKWh, 111.11111111);                      // tampon : 16 × 4 / (0,9 × 0,8) × 1,25
  // Le jour, il manque 6 kW ; le tampon (88,9 kWh utiles, rechargé la nuit par les 2 kW de surplus du réacteur) en rend
  // 88,9 × 0,9 = 80 kWh sur 354 h, soit 0,226 kW : P_crête = (6 − 0,226) / 0,72 = 8,0195 kWc
  near(h.solarKWp, (6 - 80 / 354) / 0.72, 2e-3);
  near(h.massKg, 1500 + 111111.11111 / 200 + ((h.solarKWp * 1000) / (1361 * 0.3)) * 5, 1e-6);
  assert.equal(h.check.ok, true);
});

test('cas 6 — mode survie : seule la part maintenue compte la nuit', () => {
  const r = computeEnergy({ ...BASE, survivalPct: 25 }, SITE);
  near(r.loads.nightKW, 4); near(r.storage.nightEnergyKWh, 400);
  near(r.storage.capacityKWh, 2777.7777778 / 4);
  near(r.loads.avgKW, 16);                               // la charge de jour ne change pas
});

test('cas 7 — durée de nuit imposée', () => {
  const r = computeEnergy({ ...BASE, nightOverride: true, nightOverrideH: 354 }, SITE);
  assert.equal(r.night.source, 'override'); near(r.night.hours, 354);
  near(r.storage.nightEnergyKWh, 16 * 354);
  assert.equal(r.night.beyondWindow, false); assert.equal(r.night.censored, false);   // ces drapeaux ne valent que pour la nuit du moteur
  // Sans moteur, la nuit imposée suffit pour le stockage ; le solaire reste « non chiffré »
  const r2 = computeEnergy({ ...BASE, nightOverride: true, nightOverrideH: 354 }, null);
  near(r2.storage.capacityKWh, (16 * 354) / 0.72 * 1.25);
  assert.equal(r2.solar.feasible, false); assert.equal(r2.solar.block, 'noEngine');
  assert.equal(arch(r2, 'solar').feasible, false); assert.equal(arch(r2, 'fission').feasible, true); assert.equal(arch(r2, 'fission').check, null);
  assert.deepEqual(findInvalid(r2), []);
  // Sans moteur ni nuit imposée : pas de stockage inventé
  const r3 = computeEnergy(BASE, null);
  assert.equal(r3.storage, null); assert.equal(r3.night.hours, null); assert.ok(r3.warnings.includes('noEngine'));
});

test('cas 8 — préréglage piles à combustible régénératives', () => {
  const r = computeEnergy({ ...BASE, ...STORAGE_PRESETS.rfc, marginPct: 0 }, siteOf(REGULAR, 355));
  near(r.storage.capacityKWh, (16 * 355) / (Math.SQRT1_2 * 0.9));     // η_d = √0,5
  near(r.storage.massKg, ((16 * 355) / (Math.SQRT1_2 * 0.9)) * 1000 / 400);
  near(r.solar.rechargeKW, (16 * 355) / (0.5 * 354), 5e-4);           // ≈ 32 kW : la recharge double la charge de jour
});

test('cas 9 — tampon minimal : sans nuit, le stockage n’est pas nul', () => {
  // Soleil permanent mais disque à moitié masqué 3 h par jour lunaire : sans tampon, aucun champ raisonnable ne passerait
  const p = profileOf([[1, 706], [1, 3]], 3); for (let c = 0; c < 3; c++) for (let k = 706; k < 709; k++) p.vertical[c * 709 + k] = 0.01;
  const r = computeEnergy(BASE, siteOf(p, 0));
  assert.equal(r.storage.governs, 'buffer');
  near(r.storage.capacityKWh, (16 * 4) / 0.72 * 1.25);                // tampon de 4 h : 111,1 kWh
  assert.equal(r.solar.feasible, true);
  near(r.solar.installedKWp, 16 / 0.72, 2e-2);                        // la charge de jour, à peu près
  assert.equal(r.timeline, null);
});

test('meilleure masse : la plus faible parmi les architectures réalisables et sans déficit', () => {
  const r = computeEnergy(BASE, siteOf(REGULAR, 355));
  const ok = r.architectures.filter((x) => x.feasible && x.check.ok);
  assert.equal(ok.length, 3);
  assert.equal(r.bestMassId, ok.reduce((m, x) => (x.massKg < m.massKg ? x : m)).id);
  near(arch(r, 'solar').massKg, r.storage.massKg + r.solar.massKg);
});

test('monotonie : plus d’équipage ou nuit plus longue -> plus de stockage', () => {
  let prev = -1;
  for (let crew = 2; crew <= 12; crew++) { const c = computeEnergy({ ...BASE, crew }, SITE).storage.capacityKWh; assert.ok(c > prev, `équipage ${crew}`); prev = c; }
  prev = -1;
  for (const h of [10, 100, 354, 1000, 4000]) { const c = computeEnergy(BASE, { ...SITE, longestNightH: h }).storage.capacityKWh; assert.ok(c > prev, `nuit ${h} h`); prev = c; }
  // Et dans l'autre sens : meilleure énergie massique -> stockage plus léger ; marge plus grande -> plus de capacité
  assert.ok(computeEnergy({ ...BASE, specificEnergyWhKg: 400 }, SITE).storage.massKg < computeEnergy(BASE, SITE).storage.massKg);
  assert.ok(computeEnergy({ ...BASE, marginPct: 50 }, SITE).storage.capacityKWh > computeEnergy(BASE, SITE).storage.capacityKWh);
  // Champ solaire : plus d'équipage -> plus de panneaux
  assert.ok(computeEnergy({ ...BASE, crew: 8 }, siteOf(REGULAR, 355)).solar.installedKWp > computeEnergy(BASE, siteOf(REGULAR, 355)).solar.installedKWp);
});

test('cas limite — nuit nulle : stockage réduit au tampon, solaire pour la seule charge de jour', () => {
  const always = profileOf([[1, 709]], 3);
  const r = computeEnergy({ ...BASE, hybridBufferH: 0 }, siteOf(always, 0));
  near(r.storage.capacityKWh, 0); near(r.storage.massKg, 0);
  near(r.solar.installedKWp, 16 / 0.72, 2e-4); near(r.solar.rechargeKW, 0, 1e-2);
  assert.equal(r.timeline, null);
  assert.deepEqual(findInvalid(r), []);
});

test('cas limite — nuit sur toute la période : pas de solaire, la durée de nuit est un minorant', () => {
  const dark = siteInputs({ sunPct: 0, longestNightH: 9600 + 8761, longestNightInWindowH: 8761, nightBeyondWindow: true, longestDayH: 0, powerVerticalPct: 0, powerHorizontalPct: 0, nightCensored: true }, profileOf([[0, 8761]]));
  const r = computeEnergy(BASE, dark);
  assert.ok(r.warnings.includes('noSun')); assert.equal(r.night.censored, true); assert.equal(r.night.beyondWindow, true);
  assert.equal(r.solar.feasible, false); assert.equal(r.solar.block, 'noSun');
  assert.equal(arch(r, 'solar').feasible, false);
  // La fission seule et l'hybride (réacteurs pour la charge de nuit, aucun apport solaire) restent chiffrables
  assert.equal(arch(r, 'fission').check.ok, true); assert.equal(arch(r, 'hybrid').feasible, true); near(arch(r, 'hybrid').solarKWp, 0);
  near(r.storage.nightEnergyKWh, 16 * (9600 + 8761));
  assert.equal(r.balance, null);
  assert.deepEqual(findInvalid(r), []);
});

test('cas limite — rendements de 100 % : la capacité égale l’énergie de nuit', () => {
  const r = computeEnergy({ ...BASE, roundTripPct: 100, dodPct: 100, marginPct: 0, pmadEffPct: 100, degradationPct: 100 }, siteOf(REGULAR, 355));
  near(r.storage.capacityKWh, 16 * 355); near(r.storage.usableKWh, 16 * 355); near(r.storage.nominalKWh, 16 * 355);
  near(r.solar.installedKWp, 16 + (16 * 355) / 354, 2e-4);            // charge de jour + recharge sans perte
  near(r.balance.lossesKWh, 0, 1e-9);
});

test('bornes : valeurs illisibles ou hors limites ramenées dans FIELDS, aucun NaN ni négatif', () => {
  const { values, clamped } = sanitize({ crew: 40, lifeSupportKWpp: -3, roundTripPct: 'abc', dodPct: 0, panelType: 'x', nightOverride: 'yes', specificEnergyWhKg: Infinity });
  assert.equal(values.crew, 12); assert.equal(values.lifeSupportKWpp, 0); assert.equal(values.roundTripPct, FIELDS.roundTripPct.def);
  assert.equal(values.dodPct, 10); assert.equal(values.panelType, 'vertical'); assert.equal(values.nightOverride, false);
  assert.equal(values.specificEnergyWhKg, FIELDS.specificEnergyWhKg.def);
  for (const id of ['crew', 'lifeSupportKWpp', 'roundTripPct', 'dodPct', 'specificEnergyWhKg']) assert.ok(clamped.includes(id), id);
  assert.deepEqual(sanitize(DEFAULTS).clamped, []);
  // Balayage : extrêmes de chaque champ, un par un, sur plusieurs sites (profil court pour rester rapide)
  const small = profileOf([[1, 40], [0, 30], [1, 2], [0, 28]], 8);
  const sites = [siteOf(small, 30), siteOf(profileOf([[1, 100]], 8), 0), siteOf(profileOf([[0, 100]], 8), 9700, { nightCensored: true }), SITE, null];
  for (const site of sites) for (const [id, f] of Object.entries(FIELDS)) for (const v of [f.min, f.max, -1e9, 1e9, NaN]) {
    for (const panelType of ['vertical', 'horizontal']) {
      const bad = findInvalid(computeEnergy({ ...BASE, [id]: v, panelType, nightOverride: id === 'nightOverrideH' }, site));
      assert.deepEqual(bad, [], `${id} = ${v}`);
    }
  }
  // Tout à zéro : résultats nuls, pas de division par zéro
  const zero = computeEnergy({ ...BASE, lifeSupportKWpp: 0, habitatKW: 0, scienceKW: 0, mobilityKW: 0, commsKW: 0 }, siteOf(REGULAR, 355));
  near(zero.loads.avgKW, 0); near(zero.storage.capacityKWh, 0); near(zero.solar.installedKWp, 0); assert.deepEqual(findInvalid(zero), []);
});

// ---- Bilan pas à pas --------------------------------------------------------------------------

const SIM = { panelType: 'vertical', installedKWp: 30, derate: 1, dayLoadKW: 10, nightLoadKW: 10, usableKWh: 15, etaC: 1, etaD: 1 };

test('bilan pas à pas — petit cas suivi à la main', () => {
  // 6 pas d'une heure : jour, jour, nuit, nuit, jour, jour. Production 30 kW, charge 10 kW, stockage utile 15 kWh, sans perte.
  const b = simulateBalance(profileOf([[1, 2], [0, 2], [1, 2]]), SIM, { keepLevels: true });
  near(b.possibleKWh, 120); near(b.needKWh, 60);
  near(b.unservedKWh, 5);          // 2e heure de nuit : 10 demandés, 5 restants
  near(b.servedKWh, 55); near(b.curtailedKWh, 65); near(b.lossesKWh, 0); near(b.deltaStoreKWh, 0);
  assert.equal(b.deficitHours, 1); assert.equal(b.deficitDays, 1); assert.equal(b.hasDeficit, true);
  near(b.requiredUsableKWh, 20);   // il aurait fallu 20 kWh utiles pour passer les deux heures de nuit
  assert.deepEqual(Array.from(b.levels), [15, 15, 15, 5, 0, 15, 15]);
  // Source constante (réacteur) : 10 kW en continu couvrent la charge, le stockage ne bouge pas
  const f = simulateBalance(profileOf([[1, 2], [0, 2], [1, 2]]), { ...SIM, installedKWp: 0, baseKW: 10 });
  near(f.unservedKWh, 0); near(f.minLevelKWh, 15); assert.equal(f.deficitSteps, 0);
  // Niveau de départ imposé et relevé intermédiaire
  const s = simulateBalance(profileOf([[0, 2], [1, 2]]), SIM, { startLevelKWh: 12, probeStep: 2 });
  near(s.startLevelKWh, 12); near(s.probeLevelKWh, 0); near(s.unservedKWh, 8); near(s.endLevelKWh, 15); near(s.deltaStoreKWh, 3);
});

test('I10 — un manque infime n’est pas un déficit (seuils à 0,1 %)', () => {
  near(DEFICIT_TOLERANCE, 1e-3);
  // 1 000 pas de jour sans stockage. Sur 30 pas, la production n'atteint que 99,95 % de la charge : manque de 0,05 %.
  const p = profileOf([[1, 1000]]); for (let i = 0; i < 30; i++) p.vertical[i * 24] = 0.9995;
  const tiny = simulateBalance(p, { ...SIM, installedKWp: 10, usableKWh: 0 });
  near(tiny.unservedKWh, 30 * 10 * 0.0005, 1e-3);                // 0,15 kWh sur 10 000 : 0,0015 % du besoin
  assert.equal(tiny.deficitSteps, 0, 'aucun pas en déficit'); assert.equal(tiny.deficitDays, 0); assert.equal(tiny.hasDeficit, false);
  const replayed = replayPeriod(p, { ...SIM, installedKWp: 10, usableKWh: 0 });
  assert.equal(replayed.ok, true); assert.equal(replayed.exact, false);   // verdict affiché : pas de déficit ; critère de dimensionnement : pas atteint
  // Le même profil avec un manque de 1 % sur ces pas : 30 pas en déficit sur 30 jours distincts, mais 0,03 % du besoin seulement
  for (let i = 0; i < 30; i++) p.vertical[i * 24] = 0.99;
  const small = simulateBalance(p, { ...SIM, installedKWp: 10, usableKWh: 0 });
  assert.equal(small.deficitSteps, 30); assert.equal(small.deficitDays, 30); assert.equal(small.hasDeficit, false);
  // Et un manque franc : 20 % sur ces pas -> 0,6 % du besoin
  for (let i = 0; i < 30; i++) p.vertical[i * 24] = 0.8;
  assert.equal(simulateBalance(p, { ...SIM, installedKWp: 10, usableKWh: 0 }).hasDeficit, true);
});

test('bilan pas à pas — conservation de l’énergie, avec pertes', () => {
  // Profil pseudo-aléatoire reproductible, éclairement partiel
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = 2000, lit = new Uint8Array(n), vertical = new Float32Array(n), horizontal = new Float32Array(n);
  let on = true, left = 0;
  for (let i = 0; i < n; i++) { if (left-- <= 0) { on = !on; left = Math.floor(rnd() * 120); } lit[i] = on ? 1 : 0; vertical[i] = on ? 0.3 + 0.7 * rnd() : 0; horizontal[i] = vertical[i] * 0.1; }
  const profile = { n, stepH: 0.5, lit, vertical, horizontal };
  for (const panelType of ['vertical', 'horizontal']) for (const eta of [1, 0.9, 0.5]) for (const usableKWh of [0, 50, 400, 5000]) for (const baseKW of [0, 5]) {
    const p = { panelType, installedKWp: 60, derate: 0.8, baseKW, dayLoadKW: 16, nightLoadKW: 9, usableKWh, etaC: Math.sqrt(eta), etaD: Math.sqrt(eta) };
    for (const b of [simulateBalance(profile, p), replayPeriod(profile, p)]) {
      near(b.possibleKWh, b.servedKWh + b.curtailedKWh + b.lossesKWh + b.deltaStoreKWh, 1e-9, 'production = servi + inutilisé + pertes + variation du stock ;');
      near(b.needKWh, b.servedKWh + b.unservedKWh, 1e-9, 'besoin = servi + non servi ;');
      assert.ok(b.unservedKWh >= 0 && b.curtailedKWh >= 0 && b.lossesKWh >= -1e-9 && b.minLevelKWh >= 0);
    }
    // Avec le stockage « qu'il aurait fallu », plus aucun manque
    const b = simulateBalance(profile, p), again = simulateBalance(profile, { ...p, usableKWh: b.requiredUsableKWh + 1e-6 });
    near(again.unservedKWh, 0, 1e-6, 'stockage requis -> zéro manque ;');
    if (b.unservedKWh > 1e-6) assert.ok(b.requiredUsableKWh > usableKWh);
  }
});

test('rejeu en régime établi : une période qui finit ou commence par une nuit', () => {
  // Jour lunaire unique : 400 h de jour puis 309 h de nuit. Un seul passage, stockage plein au départ, laisserait croire
  // qu'il suffit d'alimenter la charge de jour (la nuit finale n'est jamais rechargée).
  const day = profileOf([[1, 400], [0, 309]]), p = { ...SIM, dayLoadKW: 16, nightLoadKW: 16, usableKWh: 16 * 309, installedKWp: 16.5 };
  assert.equal(simulateBalance(day, p).unservedKWh, 0);                           // un passage : aucun manque avec 16,5 kWc…
  const r = replayPeriod(day, p);
  assert.equal(r.ok, false); assert.ok(r.deficitDays > 0);                        // … mais rejouée à la suite, la nuit n'est plus couverte
  // Stockage un peu plus grand que la nuit : plus de déficit, mais il se vide de 4 744 kWh par cycle -> régime non tenable
  const drain = replayPeriod(day, { ...p, usableKWh: 16 * 309 * 3 });
  assert.equal(drain.deficitSteps, 0); assert.equal(drain.sustainable, false); assert.equal(drain.ok, false);
  // Le plus petit champ tenable recharge la nuit pendant le jour : 16 + 16 × 309 / 400 = 28,36 kWc
  near(smallestArray(day, p, 800), 16 + (16 * 309) / 400, 2e-4);
  // Même période commencée en pleine nuit (200 h de nuit, 400 h de jour, 109 h de nuit) : même réponse
  near(smallestArray(profileOf([[0, 200], [1, 400], [0, 109]]), p, 800), 16 + (16 * 309) / 400, 2e-4);
  // Aucun champ ne passe si le stockage est trop petit, quel que soit le plafond
  assert.equal(smallestArray(day, { ...p, usableKWh: 16 * 300 }, 800), null);
  assert.equal(smallestArray(day, { ...p, dayLoadKW: 0, nightLoadKW: 0 }, 800), 0);
});

test('profil d’éclairement tiré de la série du moteur', () => {
  const frac = [[0, 10], [1, 3], [0, 20], [1, 5]].flatMap(([v, k]) => Array(k).fill(v));
  const p = solarProfile({ n: frac.length, stepMs: 3600e3, sunFrac: Float32Array.from(frac), sunEl: Float32Array.from(frac.map(() => 30)) });
  assert.equal(p.stepH, 1);
  near(p.vertical[11], Math.cos(Math.PI / 6), 1e-6); near(p.horizontal[11], 0.5, 1e-6); assert.equal(p.vertical[0], 0);
  // Soleil sous l'horizontale géométrique mais visible (crête plus basse que le site) : le panneau à plat ne produit rien
  const low = solarProfile({ n: 1, stepMs: 3600e3, sunFrac: Float32Array.of(1), sunEl: Float32Array.of(-1) });
  assert.equal(low.horizontal[0], 0); assert.equal(low.lit[0], 1);
  near(LUNAR_DAY_H, 708.734, 1e-5);
  // siteInputs : à défaut des champs « réels » du moteur, la nuit dans la période vaut la nuit de la série
  const s = siteInputs({ sunPct: 50, longestNightH: 20, longestDayH: 5, powerVerticalPct: 40, powerHorizontalPct: 1 }, p);
  assert.equal(s.longestNightInWindowH, 20); assert.equal(s.nightBeyondWindow, false); assert.equal(s.nightCensored, false);
});

test('B2 — le champ solaire est continu quand la nuit passe de 700 à 720 h', () => {
  // Hiver polaire : une nuit de T heures par période de deux jours lunaires (1 418 h), le reste au Soleil.
  // Aucune fenêtre arbitraire ne doit faire sauter la puissance crête autour de 709 h (un jour lunaire).
  const at = (T) => computeEnergy(BASE, siteOf(profileOf([[1, 1418 - T], [0, T]], 3), T)).solar;
  let prev = null;
  for (let T = 700; T <= 720; T++) {
    const so = at(T);
    assert.equal(so.feasible, true, `nuit de ${T} h : chiffrable`);
    near(so.installedKWp, (16 + (16 * T) / (0.81 * (1418 - T))) / 0.72, 5e-4, `nuit de ${T} h, formule fermée ;`);   // ≈ 49 à 50,5 kWc
    assert.ok(so.installedKWp <= ARRAY_CAP_FACTOR * 16);
    if (prev !== null) assert.ok(so.installedKWp > prev && so.installedKWp - prev < 0.005 * prev, `saut entre ${T - 1} h et ${T} h : ${prev} -> ${so.installedKWp}`);
    prev = so.installedKWp;
  }
});

test('B2 — pas de champ solaire aberrant : au-delà du plafond, « non viable » sans chiffre', () => {
  // Deux nuits de 300 h séparées par une heure de Soleil, puis 108 h de jour : le stockage, dimensionné sur 300 h
  // (375 h avec la marge), ne peut pas franchir 600 h d'ombre, quel que soit le champ solaire.
  const p = profileOf([[0, 300], [1, 1], [0, 300], [1, 108]], 3);
  const r = computeEnergy(BASE, siteOf(p, 300));
  assert.equal(r.solar.feasible, false); assert.equal(r.solar.block, 'notViable'); assert.ok(r.warnings.includes('notViable'));
  assert.equal(r.solar.installedKWp, undefined); assert.equal(arch(r, 'solar').feasible, false); assert.equal(r.balance, null);
  const d = r.solar.diagnosis;
  near(d.capKWp, 800);                                                   // 50 × 16 kW
  assert.ok(d.deficitDays > 0 && d.hasDeficit && !d.ok);
  assert.ok(d.equivalentNightH > 500 && d.equivalentNightH <= 600 && d.requiredCapacityKWh > r.storage.capacityKWh);
  assert.equal(d.suggestedNightH, Math.ceil(d.equivalentNightH / 10) * 10);
  assert.deepEqual(findInvalid(r), []);
  // En imposant la nuit proposée, le solaire redevient chiffrable, sous le plafond, sans déficit
  const r2 = computeEnergy({ ...BASE, nightOverride: true, nightOverrideH: d.suggestedNightH }, siteOf(p, 300));
  assert.equal(r2.solar.feasible, true); assert.ok(r2.solar.installedKWp <= 800); assert.equal(r2.balance.ok, true);
});

test('I9 — « aucun déficit » n’est jamais affiché à côté d’un stockage requis supérieur au stockage installé', () => {
  // Nuit de 100 h, une heure de Soleil, nuit de 15 h : 115 h d'ombre que seule la marge (25 %) permet de franchir.
  const gap = profileOf([[0, 100], [1, 1], [0, 15], [1, 593]], 3);
  const cases = [];
  for (const marginPct of [0, 10, 25, 50]) for (const [profile, T] of [[REGULAR, 355], [gap, 100], [profileOf([[1, 300], [0, 409]], 3), 409]]) cases.push(computeEnergy({ ...BASE, marginPct }, siteOf(profile, T)));
  let checked = 0;
  for (const r of cases) {
    if (!r.balance) continue;
    checked++;
    assert.equal(r.balance.hasDeficit, false);
    assert.ok(r.balance.requiredCapacityKWh <= r.storage.capacityKWh * (1 + 1e-9), `requis ${r.balance.requiredCapacityKWh} > installé ${r.storage.capacityKWh} (marge ${r.inputs.marginPct} %)`);
    assert.ok(r.balance.reserveMinPct >= 0 && r.balance.reserveMinPct <= 100);
  }
  assert.ok(checked >= 9);
  // Le cas « 115 h d'ombre » avec 25 % de marge : il passe en entamant la marge, et le bilan le dit
  const r = computeEnergy({ ...BASE, marginPct: 25 }, siteOf(gap, 100));
  assert.equal(r.solar.feasible, true);
  assert.ok(r.balance.requiredCapacityKWh > r.storage.capacityKWh / 1.25, 'la séquence dépasse la part hors marge');
  assert.ok(r.balance.reserveMinPct < r.storage.marginPlannedPct, 'la réserve au plus bas est inférieure à la marge prévue');
});

test('I12 — chaque architecture est rejouée ; aucune architecture en déficit n’est « la plus légère »', () => {
  const profiles = [[REGULAR, 355], [profileOf([[1, 122], [0, 168], [1, 3], [0, 416]], 4), 416], [profileOf([[1, 600], [0, 109]], 3), 109]];
  for (const [profile, T] of profiles) for (const survivalPct of [100, 60, 20]) {
    const r = computeEnergy({ ...BASE, survivalPct }, siteOf(profile, T));
    for (const x of r.architectures) {
      if (!x.feasible) continue;
      assert.ok(x.check, `${x.id} : verdict du rejeu présent`);
      assert.equal(x.check.ok, true, `${x.id} (survie ${survivalPct} %) : ${x.check.deficitDays} j de déficit`);
    }
    const best = arch(r, r.bestMassId); assert.ok(best.check.ok);
    // Contre-vérification indépendante de l'hybride : mêmes tailles, rejeu direct
    const h = arch(r, 'hybrid');
    if (h.feasible) {
      const etaD = Math.sqrt(0.81), usable = (16 * 4 / (etaD * 0.8)) * 1.25 * 0.8;
      const b = replayPeriod(profile, { panelType: 'vertical', installedKWp: h.solarKWp, derate: 0.72, baseKW: h.fissionKW, dayLoadKW: 16, nightLoadKW: 16 * survivalPct / 100, usableKWh: usable, etaC: etaD, etaD });
      assert.equal(b.deficitDays, 0); assert.equal(b.ok, true);
    }
  }
});

test('export CSV : guillemets, séparateurs, nombres', () => {
  assert.equal(toCsv([['a', 'b,c', 'd"e'], [1.5, null, 1 / 3]]), 'a,"b,c","d""e"\r\n1.5,,0.3333333333\r\n');
});

// ---- Textes (FR + EN) ----------------------------------------------------------------------------

test('I11, I13, I14 — textes : déficit neutre, minorant dit « au moins », repères NASA exacts', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  globalThis.document ??= { querySelectorAll: () => [], documentElement: {} };   // i18n réapplique les textes du DOM au changement de langue
  const { t } = await import('../public/js/core/i18n.js');
  const { set } = await import('../public/js/core/store.js');
  await import('../public/js/i18n/energy.js');
  const plain = (key, vars) => t(key, vars).replace(/[\u00a0\u202f]/g, ' ');
  set({ lang: 'fr' });
  // I11 : le déficit n'est plus attribué au seul stockage
  const bad = plain('energy.bal.bad', { days: '12 jours', n: '365' });
  assert.match(bad, /ce dimensionnement \(stockage sur la plus longue nuit, champ solaire/); assert.doesNotMatch(bad, /à dimensionner le stockage/);
  // I13 : ombre permanente -> « au moins », jamais « il faut installer »
  const cens = plain('energy.read.nightCensored', { night: '400 j', en: '1 MWh', cap: '2 MWh' });
  assert.match(cens, /au moins/); assert.doesNotMatch(cens, /il faut installer/);
  // I14 : 40 kWe = exigence de la phase 1 d'une démonstration, pas un objectif « pour une première base »
  const note = plain('energy.g.loadsNote');
  assert.doesNotMatch(note, /vise 40 kWe pour une première base/); assert.match(note, /phase 1/); assert.match(note, /40 kWe/); assert.match(note, /au moins 100 kWe/);
  assert.match(note, /75 à 90 kW/); assert.doesNotMatch(note, /84 à 120/);
  assert.match(plain('energy.why.fissionUnitMassKg'), /phase 1/);
  // Accords au singulier
  assert.equal(plain('energy.days.one'), 'jour'); assert.equal(plain('energy.days.many'), 'jours');
  set({ lang: 'en' });
  assert.doesNotMatch(plain('energy.g.loadsNote'), /targets 40 kWe for a first base/); assert.match(plain('energy.g.loadsNote'), /Phase 1/);
  assert.match(plain('energy.read.nightCensored', { night: 'x', en: 'y', cap: 'z' }), /at least/);
  assert.doesNotMatch(plain('energy.bal.bad', { days: '12 days', n: '365' }), /does not size the storage/);
  set({ lang: 'fr' });
});

// ---- Avec le vrai moteur (si le relief LOLA est présent) -------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demFile = [path.join(root, 'public/data/sp_dem_240m.i16'), path.join(root, 'tools/raw/ldem_75s_240m.img')].find((f) => fs.existsSync(f));
const skip = demFile ? false : 'relief LOLA absent';
/** Fenêtre du moteur (siteWindow) et entrées du dimensionnement pour un lieu, au 15/11/2026. */
async function engineSite(lat, lon, period) {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const { setDem, hasDem } = await import('../public/js/science/terrain.js');
  if (!hasDem()) { const buf = fs.readFileSync(demFile); setDem(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)); }
  const { siteWindow } = await import('../public/js/science/engine.js');
  const win = siteWindow({ lat, lon }, period, Date.UTC(2026, 10, 15));
  return { m: win.metrics, profile: solarProfile(win.series), site: siteInputs(win.metrics, solarProfile(win.series)) };
}
function regionCenter(id, fallback) {
  try { const r = JSON.parse(fs.readFileSync(path.join(root, 'public/data/artemis_regions.json'), 'utf8')).find((x) => x.id === id); return [r.center.lat, r.center.lon]; } catch { return fallback; }
}

test('moteur réel — Malapert, année 2026 : profil cohérent, diagnostic puis dimensionnement sur la nuit proposée', { skip }, async () => {
  const { m, profile, site } = await engineSite(-85.99, -2.9, 'year');
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  near(100 * mean(profile.vertical), m.powerVerticalPct, 1e-4); near(100 * mean(profile.horizontal), m.powerHorizontalPct, 1e-3);
  near(100 * mean(profile.lit), m.sunPct, 1e-9);
  const r = computeEnergy(DEFAULTS, site);
  assert.deepEqual(findInvalid(r), []);
  assert.equal(r.night.source, 'engine'); near(r.night.hours, m.longestNightH);
  near(r.storage.nightEnergyKWh, r.loads.nightKW * m.longestNightH);
  // Nuits de 168 h et 415 h séparées par 3 h de Soleil : le stockage « plus longue nuit » ne suffit pas, c'est dit sans chiffre de champ solaire
  assert.equal(r.solar.block, 'notViable'); assert.ok(r.solar.diagnosis.suggestedNightH > m.longestNightH);
  for (const x of r.architectures) if (x.feasible) assert.equal(x.check.ok, true, x.id);
  const r2 = computeEnergy({ ...DEFAULTS, nightOverride: true, nightOverrideH: r.solar.diagnosis.suggestedNightH }, site), b = r2.balance;
  assert.equal(r2.solar.feasible, true); assert.ok(r2.solar.installedKWp < ARRAY_CAP_FACTOR * r2.loads.avgKW / 2);
  assert.equal(b.ok, true); assert.equal(b.deficitDays, 0);
  near(b.possibleKWh, b.servedKWh + b.curtailedKWh + b.lossesKWh + b.deltaStoreKWh, 1e-9);
  near(b.needKWh, b.servedKWh + b.unservedKWh, 1e-9);
  assert.ok(b.requiredCapacityKWh <= r2.storage.capacityKWh * (1 + 1e-9));
  assert.equal(r2.timeline.kind, 'simulated');
  console.log(`    Malapert 2026 : nuit ${m.longestNightH} h -> non viable (nuit équivalente ${r.solar.diagnosis.equivalentNightH.toFixed(0)} h) ; `
    + `nuit imposée ${r2.night.hours} h -> stockage ${r2.storage.capacityKWh.toFixed(0)} kWh, solaire ${r2.solar.installedKWp.toFixed(1)} kWc, réserve au plus bas ${b.reserveMinPct.toFixed(1)} %`);
});

test('moteur réel — la durée de nuit retenue est la durée réelle du moteur, même si elle déborde de la période', { skip }, async () => {
  // Nobile Rim 1, jour lunaire du 15/11/2026 : la plus longue nuit commence avant la période (relecture : 307 h dans la période, 459 h en tout)
  const [lat, lon] = regionCenter('nobile-rim-1', [-86.1, 37.1]);
  const cases = [await engineSite(lat, lon, 'lunarDay'), await engineSite(...regionCenter('haworth', [-87.2, -23.3]), 'lunarDay'), await engineSite(...regionCenter('slater-plain', [-87.6, 125.7]), 'lunarDay')];
  let beyond = 0;
  for (const { m, site } of cases) {
    const r = computeEnergy({ ...DEFAULTS, period: 'lunarDay' }, site);
    near(r.night.hours, m.longestNightH);                                   // durée réelle, pas celle de la série
    assert.equal(r.night.beyondWindow, !!m.nightBeyondWindow); near(r.night.inWindowH, m.longestNightInWindowH);
    near(r.storage.nightEnergyKWh, r.loads.nightKW * m.longestNightH);
    if (m.nightBeyondWindow) { beyond++; assert.ok(r.night.hours > r.night.inWindowH); }
    assert.deepEqual(findInvalid(r), []);
  }
  assert.ok(beyond >= 1, 'au moins un des cas a une nuit qui déborde de la période');
});

test('moteur réel — B2 : aucun champ solaire aberrant sur les centres des régions, année 2026', { skip }, async () => {
  for (const id of ['haworth', 'mons-mouton', 'slater-plain', 'mons-mouton-plateau', 'de-gerlache-rim-2']) {
    const { site } = await engineSite(...regionCenter(id, [-87.2, -23.3]), 'year');
    const r = computeEnergy(DEFAULTS, site), cap = ARRAY_CAP_FACTOR * r.loads.avgKW;
    if (r.solar.feasible) { assert.ok(r.solar.installedKWp <= cap, `${id} : ${r.solar.installedKWp} kWc`); assert.equal(r.balance.ok, true); assert.ok(r.balance.requiredCapacityKWh <= r.storage.capacityKWh * (1 + 1e-9)); }
    else { assert.equal(r.solar.block, 'notViable'); assert.equal(r.solar.installedKWp, undefined); assert.ok(r.solar.diagnosis.deficitDays > 0 || !r.solar.diagnosis.sustainable); }
    for (const x of r.architectures) if (x.feasible) assert.equal(x.check.ok, true, `${id} ${x.id}`);
    assert.notEqual(arch(r, r.bestMassId)?.check?.ok, false);
    assert.deepEqual(findInvalid(r), []);
  }
});
