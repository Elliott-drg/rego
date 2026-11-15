// Scénario de référence du cahier des charges de l'équipe (PAS un classement officiel de la NASA).
// Ces notes et ordres de grandeur sont des HYPOTHÈSES DE TRAVAIL : l'application les affiche à côté
// des valeurs qu'elle calcule elle-même (relief LOLA + éphémérides) pour qu'on puisse les confronter.

export const CRITERIA = ['comms', 'energy', 'radiation', 'landing', 'water', 'isru'];

// Notes /10 par critère (cahier des charges) et score global annoncé.
export const REFERENCE_SCORES = {
  mons_mouton_plateau: { comms: 7, energy: 7, radiation: 5, landing: 7.5, water: 5, isru: 6, stated: 6.5 },
  malapert_massif: { comms: 9, energy: 9, radiation: 5, landing: 5, water: 4, isru: 5, stated: 6.4 },
  mons_mouton: { comms: 7, energy: 7.5, radiation: 5, landing: 6, water: 5, isru: 6, stated: 6.3 },
  nobile_rim_2: { comms: 6.5, energy: 7, radiation: 6, landing: 5, water: 7, isru: 6, stated: 6.3 },
  nobile_rim_1: { comms: 6.5, energy: 6.5, radiation: 6, landing: 4.5, water: 7, isru: 6, stated: 6.0 },
  peak_near_cabeus_b: { comms: 6, energy: 5.5, radiation: 6, landing: 3, water: 10, isru: 5, stated: 5.8 },
  slater_plain: { comms: 8, energy: 3.5, radiation: 4, landing: 9, water: 2, isru: 6.5, stated: 5.6 },
  haworth: { comms: 5, energy: 5, radiation: 6, landing: 4, water: 8, isru: 5, stated: 5.4 },
  de_gerlache_rim_2: { comms: 3, energy: 6, radiation: 6, landing: 3.5, water: 7, isru: 5, stated: 5.0 },
};

// Le cahier des charges ne donne pas la formule du score global. Une moyenne simple ne redonne pas
// ses chiffres (écart jusqu'à 0,25). Ces poids, ajustés par moindres carrés, les reproduisent à 0,03 près :
//   score = Σ poids × note   (les poids sont modifiables dans l'interface).
export const DEFAULT_WEIGHTS = { comms: 15, energy: 25, radiation: 5, landing: 24, water: 19, isru: 12 };

// Ordres de grandeur annoncés par le cahier des charges (hypothèses, à vérifier). Intervalles [min, max].
export const REFERENCE_HYPOTHESES = {
  peak_near_cabeus_b: { earthPct: [60, 65], blackoutDays: [9, 11], earthElMax: 11, slopeOkPct: [35, 45], landableKm2: [4, 12], water: 'LCROSS ~5,6 % (Cabeus), LEND 2–4 % WEH' },
  haworth: { earthPct: [60, 60], blackoutDays: [10, 11], earthElMax: 9 },
  malapert_massif: { earthPct: [70, 75], earthPctSummit: [85, 95], blackoutDays: [7, 8], blackoutDaysSummit: [2, 4], earthElMax: 11, sunPct: [65, 85], nightDays: [2, 6], altitudeM: 4800 },
  mons_mouton: { earthPct: [65, 70], blackoutDays: [8, 9.5], earthElMax: 11 },
  mons_mouton_plateau: { earthPct: [65, 70], blackoutDays: [8, 9.5], earthElMax: 11 },
  nobile_rim_1: { earthPct: [63, 68], blackoutDays: [8.5, 10], earthElMax: 10 },
  nobile_rim_2: { earthPct: [63, 68], blackoutDays: [8.5, 10], earthElMax: 10 },
  de_gerlache_rim_2: { earthPct: [50, 50], blackoutDays: [13, 14], earthElMax: 7, slopeOkPct: [35, 45], nightDays: [10, 14] },
  slater_plain: { earthPct: [70, 70], blackoutDays: [8, 8], earthElMax: 12, sunPct: [35, 50], nightDays: [10, 14], slopeOkPct: [75, 85], landableKm2: [60, 100], altitudeM: -1000 },
};
// Valeurs générales du cahier des charges (hypothèses)
export const REFERENCE_GENERAL = {
  psrTempK: [25, 50], litTempK: [110, 260], gcrMSvPerDay: 1.3, gcrShieldingPct: [3, 20], feoPct: [3, 8], he3Ppb: [1, 5],
};
