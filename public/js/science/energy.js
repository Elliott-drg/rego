// Pré-dimensionnement énergétique d'une base lunaire — calcul pur (ni DOM, ni état global, testable dans Node).
//
// Ce module ne valide aucune conception : il enchaîne des bilans simples à partir d'hypothèses toutes
// modifiables (FIELDS) et de l'éclairement du site calculé par le moteur (sitecalc.js).
//
// Conventions : puissances en kW au niveau du bus électrique de la base, énergies en kWh, durées en h,
// masses en kg. Les pourcentages des hypothèses sont saisis en % (90 = 90 %).
//
// Bilan retenu :
//   1. charges    P_moy = n·P_vie + P_hab + P_sci + P_véh + P_com + P_isru ; P_pointe = k_p·P_moy ; P_nuit = s·P_moy
//   2. nuit       E_nuit = P_nuit · t_nuit      t_nuit = durée RÉELLE de la plus longue nuit, donnée par le moteur
//                                               (elle peut déborder de la période analysée), ou durée imposée
//   3. stockage   C = max(E_nuit, E_tampon) / (η_d · DoD) · (1 + m)      avec η_c = η_d = √η_ar
//                 La simulation dispose de toute la capacité utile C · DoD, marge comprise : une heure de pénombre
//                 après la nuit suffit sinon à faire échouer un stockage calculé au plus juste. Le bilan dit donc
//                 ce qu'il reste de réserve au plus bas, et le « stockage qu'il aurait fallu » est donné sans marge.
//   4. solaire    pas de formule fermée : on cherche par dichotomie le plus petit champ solaire avec lequel la
//                 période, rejouée pas à pas (replayPeriod), ne laisse aucun déficit et ne vide pas le stockage d'un
//                 cycle à l'autre. La nuit n'est donc comptée qu'une fois : par l'éclairement réel de chaque pas.
//                 Au-delà de ARRAY_CAP_FACTOR × P_moy, on conclut « non viable avec ce stockage » sans chiffre.
//   5. recharge   P_rech = P_crête · f_dég · η_dist − P_moy   (surplus disponible en plein Soleil)
//   6. contrôle   les trois architectures sont rejouées de la même façon et reçoivent le même verdict.

export const LUNAR_DAY_H = 29.530588853 * 24;   // mois synodique moyen, en heures
/** Champ solaire jugé déraisonnable au-delà de ce multiple de la puissance moyenne (kWc par kW). */
export const ARRAY_CAP_FACTOR = 50;
/** Un manque inférieur à cette part de la charge (d'un pas, ou de la période) n'est pas compté comme un déficit. */
export const DEFICIT_TOLERANCE = 1e-3;

/**
 * Hypothèses numériques : bornes, pas et valeur par défaut. Les libellés, unités affichées et
 * justifications sont dans i18n/energy.js (clés energy.f.<id>, energy.why.<id>).
 */
export const FIELDS = {
  crew: { min: 2, max: 12, step: 1, def: 4, int: true },
  missionDays: { min: 1, max: 3650, step: 1, def: 180, int: true },
  // Postes de puissance moyenne (kW)
  lifeSupportKWpp: { min: 0, max: 20, step: 0.1, def: 1.5 },
  habitatKW: { min: 0, max: 200, step: 0.5, def: 5 },
  scienceKW: { min: 0, max: 200, step: 0.5, def: 2 },
  mobilityKW: { min: 0, max: 200, step: 0.5, def: 2 },
  commsKW: { min: 0, max: 100, step: 0.1, def: 1 },
  isruKW: { min: 0, max: 1000, step: 0.5, def: 0 },
  peakFactor: { min: 1, max: 5, step: 0.05, def: 1.5 },
  survivalPct: { min: 0, max: 100, step: 5, def: 100 },
  // Stockage
  roundTripPct: { min: 10, max: 100, step: 1, def: 90 },
  dodPct: { min: 10, max: 100, step: 1, def: 80 },
  specificEnergyWhKg: { min: 10, max: 2000, step: 10, def: 150 },
  marginPct: { min: 0, max: 200, step: 5, def: 20 },
  // Solaire
  cellEffPct: { min: 5, max: 50, step: 0.5, def: 30 },
  degradationPct: { min: 10, max: 100, step: 1, def: 85 },
  pmadEffPct: { min: 50, max: 100, step: 1, def: 90 },
  arealMassKgM2: { min: 0.2, max: 50, step: 0.1, def: 5 },
  solarConstantWM2: { min: 1300, max: 1420, step: 1, def: 1361 },
  // Fission (scénario technologique) et hybride
  fissionUnitKWe: { min: 1, max: 200, step: 1, def: 10 },
  fissionUnitMassKg: { min: 100, max: 50000, step: 50, def: 1500 },
  fissionSpare: { min: 0, max: 3, step: 1, def: 1, int: true },
  hybridBufferH: { min: 0, max: 72, step: 0.5, def: 4 },
  // Durée de nuit imposée à la main (354 h ≈ nuit lunaire loin des pôles)
  nightOverrideH: { min: 0, max: 10000, step: 1, def: 354 },
};

/** Préréglages de stockage (valeurs de travail modifiables, voir energy.why.* pour leur justification). */
export const STORAGE_PRESETS = {
  liion: { roundTripPct: 90, dodPct: 80, specificEnergyWhKg: 150 },
  rfc: { roundTripPct: 50, dodPct: 90, specificEnergyWhKg: 400 },
};
const CHOICES = {
  panelType: ['vertical', 'horizontal'],
  storagePreset: ['liion', 'rfc', 'custom'],
  period: ['year', 'lunarDay'],
};
export const DEFAULTS = Object.freeze({
  ...Object.fromEntries(Object.entries(FIELDS).map(([id, f]) => [id, f.def])),
  panelType: 'vertical', storagePreset: 'liion', period: 'year', nightOverride: false,
});

/**
 * Ramène des hypothèses quelconques (saisie, stockage local) dans leurs bornes.
 * @returns {{values:object, clamped:string[]}} `clamped` = champs corrigés (hors bornes ou illisibles)
 */
export function sanitize(raw = {}) {
  const values = {}, clamped = [];
  for (const [id, f] of Object.entries(FIELDS)) {
    const given = raw[id];
    let v = given === undefined || given === null || given === '' ? NaN : Number(given);
    if (!Number.isFinite(v)) { v = f.def; if (given !== undefined) clamped.push(id); }
    const bounded = Math.min(f.max, Math.max(f.min, f.int ? Math.round(v) : v));
    if (bounded !== v) clamped.push(id);
    values[id] = bounded;
  }
  for (const [id, list] of Object.entries(CHOICES)) values[id] = list.includes(raw[id]) ? raw[id] : DEFAULTS[id];
  values.nightOverride = raw.nightOverride === true;
  return { values, clamped };
}

// ---------------------------------------------------------------------------------------------
// Éclairement du site : passage de la série du moteur aux entrées du dimensionnement
// ---------------------------------------------------------------------------------------------

/**
 * Production relative d'un panneau à chaque pas de la série du moteur (mêmes définitions que
 * seriesMetrics : la moyenne ×100 redonne powerVerticalPct / powerHorizontalPct).
 * @param {{n:number, stepMs:number, sunFrac:Float32Array, sunEl:Float32Array}} series
 * @returns {{n:number, stepH:number, lit:Uint8Array, vertical:Float32Array, horizontal:Float32Array}}
 */
export function solarProfile(series) {
  const n = series.n, lit = new Uint8Array(n), vertical = new Float32Array(n), horizontal = new Float32Array(n);
  const DEG = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const f = series.sunFrac[i], el = series.sunEl[i] * DEG;
    lit[i] = f > 0 ? 1 : 0;
    vertical[i] = f * Math.cos(el);                  // panneau vertical tourné vers l'azimut du Soleil
    horizontal[i] = f * Math.max(0, Math.sin(el));   // panneau posé à plat
  }
  return { n, stepH: series.stepMs / 3600e3, lit, vertical, horizontal };
}

/**
 * Entrées « site » du dimensionnement, à partir des indicateurs du moteur (siteWindow().metrics) et du profil.
 * `longestNightH` est la durée réelle de la plus longue nuit (prolongée hors période par le moteur) ;
 * `longestNightInWindowH` sa part dans la période ; à défaut de ces champs (indicateurs bruts de
 * seriesMetrics), la nuit est celle de la série.
 * @param {object} metrics @param {ReturnType<typeof solarProfile>} profile
 */
export function siteInputs(metrics, profile) {
  return {
    sunPct: metrics.sunPct, longestNightH: metrics.longestNightH, longestDayH: metrics.longestDayH,
    longestNightInWindowH: metrics.longestNightInWindowH ?? metrics.longestNightH,
    nightBeyondWindow: !!metrics.nightBeyondWindow, nightCensored: !!metrics.nightCensored,
    powerVerticalPct: metrics.powerVerticalPct, powerHorizontalPct: metrics.powerHorizontalPct,
    profile,
  };
}

// ---------------------------------------------------------------------------------------------
// Bilan pas à pas
// ---------------------------------------------------------------------------------------------

/**
 * Simule le stockage pas à pas sur le profil d'éclairement.
 * Toutes les énergies sont comptées au bus, sauf le niveau du stockage (énergie contenue).
 * Un pas est « en déficit » si le manque dépasse DEFICIT_TOLERANCE × la charge du pas ; `hasDeficit` si
 * l'énergie non servie dépasse DEFICIT_TOLERANCE × le besoin.
 * @param {ReturnType<typeof solarProfile>} profile
 * @param {{panelType:string, installedKWp:number, derate:number, baseKW?:number, dayLoadKW:number, nightLoadKW:number,
 *          usableKWh:number, etaC:number, etaD:number}} p  derate = f_dég · η_dist ; baseKW = source constante (fission)
 * @param {{startIdx?:number, steps?:number, startLevelKWh?:number, probeStep?:number, keepLevels?:boolean}} opt
 *        parcours cyclique à partir de startIdx ; stockage plein au départ sauf startLevelKWh ;
 *        probeStep : pas après lequel le niveau est relevé (probeLevelKWh)
 */
export function simulateBalance(profile, p, opt = {}) {
  const n = profile.n, dt = profile.stepH, start = opt.startIdx ?? 0, steps = opt.steps ?? n;
  const factor = p.panelType === 'horizontal' ? profile.horizontal : profile.vertical;
  const kW = p.installedKWp * p.derate, base = p.baseKW ?? 0;
  const startLevel = Math.min(p.usableKWh, Math.max(0, opt.startLevelKWh ?? p.usableKWh));
  let level = startLevel, minLevel = level, probe = level;
  let need = 0, possible = 0, direct = 0, toStoreBus = 0, storedIn = 0, storedOut = 0, delivered = 0, curtailed = 0, unserved = 0, deficitSteps = 0;
  // Stockage qu'il aurait fallu pour ne jamais manquer : plus grand creux d'un réservoir sans fond, plafonné à « plein »
  let hollow = 0, required = 0;
  const days = new Set();
  const levels = opt.keepLevels ? new Float32Array(steps + 1) : null;
  if (levels) levels[0] = level;
  for (let k = 0; k < steps; k++) {
    const i = (start + k) % n;
    const gen = (kW * factor[i] + base) * dt, load = (profile.lit[i] ? p.dayLoadKW : p.nightLoadKW) * dt;
    need += load; possible += gen;
    if (gen >= load) {
      const surplus = gen - load, room = (p.usableKWh - level) / p.etaC, sent = Math.min(surplus, room);
      direct += load; toStoreBus += sent; storedIn += sent * p.etaC; level = Math.min(p.usableKWh, level + sent * p.etaC);
      curtailed += surplus - sent;
      hollow = Math.max(0, hollow - surplus * p.etaC);
    } else {
      const lack = load - gen, out = Math.min(lack, level * p.etaD), miss = lack - out;
      direct += gen; delivered += out; storedOut += out / p.etaD; level = Math.max(0, level - out / p.etaD);
      unserved += miss;
      if (miss > DEFICIT_TOLERANCE * load) { deficitSteps++; days.add(Math.floor((k * dt) / 24)); }
      hollow += lack / p.etaD; if (hollow > required) required = hollow;
    }
    if (level < minLevel) minLevel = level;
    if (levels) levels[k + 1] = level;
    if (k + 1 === opt.probeStep) probe = level;
  }
  return {
    hours: steps * dt, needKWh: need, possibleKWh: possible, servedKWh: direct + delivered, unservedKWh: unserved,
    curtailedKWh: curtailed, lossesKWh: (toStoreBus - storedIn) + (storedOut - delivered),
    startLevelKWh: startLevel, endLevelKWh: level, deltaStoreKWh: level - startLevel, probeLevelKWh: probe,
    deficitSteps, deficitHours: deficitSteps * dt, deficitDays: days.size, hasDeficit: unserved > DEFICIT_TOLERANCE * need,
    minLevelKWh: minLevel, requiredUsableKWh: required, levels,
  };
}

/**
 * Rejoue la période en régime établi, en deux passages :
 *   1. mise en régime : les premiers jours lunaires entiers de la période, stockage plein au départ ;
 *   2. mesure : la période entière, en partant du niveau atteint à la fin du premier passage.
 * Le raccord est en phase (un nombre entier de jours lunaires sépare les deux instants) : une période qui
 * commence en pleine nuit ne profite donc pas d'un stockage « plein par hypothèse ».
 * `sustainable` : après ce même nombre entier de jours lunaires, le second passage n'est pas plus bas qu'à
 * son départ — le stockage ne se vide pas d'un cycle à l'autre, et une nuit placée en fin de période doit
 * bien être rechargée.
 * `ok` (verdict affiché) : aucun pas en déficit au seuil DEFICIT_TOLERANCE, et régime tenable.
 * `exact` (critère de dimensionnement) : aucune énergie non servie du tout, et régime tenable.
 * @returns {ReturnType<typeof simulateBalance> & {sustainable:boolean, ok:boolean, exact:boolean}} bilan du second passage
 */
export function replayPeriod(profile, p, opt = {}) {
  const lunarSteps = Math.round(LUNAR_DAY_H / profile.stepH), cycles = Math.floor(profile.n / lunarSteps);
  const warmSteps = cycles >= 1 ? cycles * lunarSteps : profile.n;
  const warm = simulateBalance(profile, p, { steps: warmSteps });
  const run = simulateBalance(profile, p, { startLevelKWh: warm.endLevelKWh, probeStep: warmSteps, keepLevels: opt.keepLevels });
  run.sustainable = run.probeLevelKWh >= run.startLevelKWh - 1e-9 * Math.max(1, p.usableKWh);
  run.ok = run.deficitSteps === 0 && !run.hasDeficit && run.sustainable;
  run.exact = run.unservedKWh <= 1e-9 * run.needKWh && run.sustainable;
  return run;
}

/**
 * Plus petit champ solaire (kWc) avec lequel la période rejouée passe sans rien laisser non servi
 * (replayPeriod().exact), par dichotomie.
 * @returns {number|null} null si même `capKWp` ne suffit pas
 */
export function smallestArray(profile, p, capKWp) {
  const pass = (kWp) => replayPeriod(profile, { ...p, installedKWp: kWp }).exact;
  if (pass(0)) return 0;
  if (!(capKWp > 0) || !pass(capKWp)) return null;
  let lo = 0, hi = capKWp;
  for (let i = 0; i < 60 && hi - lo > 1e-4 * hi; i++) { const mid = (lo + hi) / 2; if (pass(mid)) hi = mid; else lo = mid; }
  return hi;
}

/** Plus longue suite de pas sans Soleil dans la période (la part visible de la plus longue nuit). */
function longestDarkRun(profile) {
  let best = 0, bestStart = -1, cur = 0, curStart = 0;
  for (let i = 0; i < profile.n; i++) {
    if (!profile.lit[i]) { if (cur === 0) curStart = i; cur++; if (cur > best) { best = cur; bestStart = curStart; } } else cur = 0;
  }
  return { start: bestStart, steps: best };
}

// ---------------------------------------------------------------------------------------------
// Dimensionnement
// ---------------------------------------------------------------------------------------------

const ceilUnits = (x) => Math.max(0, Math.ceil(x - 1e-9));

/**
 * @param {object} raw hypothèses (voir FIELDS et DEFAULTS) ; elles sont bornées par sanitize()
 * @param {ReturnType<typeof siteInputs>|null} site éclairement du site ; null = moteur indisponible
 * @returns {object} résultat complet ; toute grandeur impossible à calculer vaut null (jamais NaN ni négatif)
 */
export function computeEnergy(raw, site = null) {
  const { values: a, clamped } = sanitize(raw);
  const warnings = [], profile = site?.profile || null;

  // 1. Charges
  const items = [
    { id: 'lifeSupport', kW: a.crew * a.lifeSupportKWpp },
    { id: 'habitat', kW: a.habitatKW }, { id: 'science', kW: a.scienceKW }, { id: 'mobility', kW: a.mobilityKW },
    { id: 'comms', kW: a.commsKW }, { id: 'isru', kW: a.isruKW },
  ];
  const avgKW = items.reduce((s, it) => s + it.kW, 0);
  const peakKW = avgKW * a.peakFactor, nightKW = (avgKW * a.survivalPct) / 100, dailyKWh = avgKW * 24;
  const loads = { items, avgKW, peakKW, nightKW, dailyKWh, missionKWh: dailyKWh * a.missionDays };

  // 2. Nuit de dimensionnement : durée réelle donnée par le moteur, ou durée imposée
  let nightH = null, nightSource = 'none';
  if (a.nightOverride) { nightH = a.nightOverrideH; nightSource = 'override'; }
  else if (site) { nightH = site.longestNightH; nightSource = 'engine'; }
  const fromEngine = nightSource === 'engine';
  const night = {
    hours: nightH, source: nightSource,
    censored: fromEngine && !!site.nightCensored,              // aucune fin trouvée : la durée est un minorant
    beyondWindow: fromEngine && !!site.nightBeyondWindow,      // la nuit déborde de la période analysée
    inWindowH: fromEngine ? site.longestNightInWindowH : null,
  };
  if (!site) warnings.push('noEngine');
  if (site && site.sunPct <= 0) warnings.push('noSun');          // Soleil jamais visible sur la période

  // 3. Stockage : la plus longue nuit, avec au moins le tampon. `nominalKWh` = part utile hors marge de sécurité
  const etaRT = a.roundTripPct / 100, etaC = Math.sqrt(etaRT), etaD = etaC, dod = a.dodPct / 100, margin = a.marginPct / 100;
  const storeFor = (busKWh) => {
    const capacityKWh = (busKWh / (etaD * dod)) * (1 + margin);
    return { capacityKWh, usableKWh: capacityKWh * dod, nominalKWh: busKWh / etaD, massKg: (capacityKWh * 1000) / a.specificEnergyWhKg };
  };
  const bufferBusKWh = avgKW * a.hybridBufferH, buffer = storeFor(bufferBusKWh);
  const nightEnergyKWh = nightH === null ? null : nightKW * nightH;
  const store = nightEnergyKWh === null ? null : storeFor(Math.max(nightEnergyKWh, bufferBusKWh));
  const storage = store && {
    ...store, marginPlannedPct: (100 * margin) / (1 + margin), nightEnergyKWh, drawnKWh: nightEnergyKWh / etaD, bufferKWh: bufferBusKWh,
    governs: bufferBusKWh > nightEnergyKWh ? 'buffer' : 'night', etaC, etaD,
  };

  // 4. Champ solaire : le plus petit qui passe la période rejouée avec ce stockage
  const derate = (a.pmadEffPct / 100) * (a.degradationPct / 100), capKWp = ARRAY_CAP_FACTOR * avgKW;
  const sim = { panelType: a.panelType, installedKWp: 0, derate, baseKW: 0, dayLoadKW: avgKW, nightLoadKW: nightKW, usableKWh: 0, etaC, etaD };
  const arrayOf = (installedKWp) => {
    const areaM2 = (installedKWp * 1000) / (a.solarConstantWM2 * (a.cellEffPct / 100));
    return { installedKWp, areaM2, massKg: areaM2 * a.arealMassKgM2 };
  };
  /** Bilan rejoué + grandeurs dérivées (stockage qu'il aurait fallu, nuit continue équivalente). */
  const replay = (p, keepLevels = false) => {
    const b = replayPeriod(profile, p, { keepLevels });
    b.requiredCapacityKWh = b.requiredUsableKWh / dod;             // sans marge : comparable à la capacité installée
    b.equivalentNightH = nightKW > 0 ? (b.requiredUsableKWh * etaD) / nightKW : null;
    b.reserveMinPct = p.usableKWh > 0 ? (100 * b.minLevelKWh) / p.usableKWh : null;   // réserve au plus bas, en % de la capacité utile
    return b;
  };
  const verdict = (b) => ({ ok: b.ok, hasDeficit: b.hasDeficit, sustainable: b.sustainable, deficitDays: b.deficitDays, days: Math.round(b.hours / 24), unservedKWh: b.unservedKWh, needKWh: b.needKWh });

  let solarBlock = null;                    // raison pour laquelle l'architecture solaire n'est pas chiffrée
  if (!profile) solarBlock = 'noEngine'; else if (site.sunPct <= 0) solarBlock = 'noSun'; else if (!store) solarBlock = 'noNight';
  let array = null, balance = null, diagnosis = null;
  if (!solarBlock) {
    const p = { ...sim, usableKWh: store.usableKWh };
    const kWp = smallestArray(profile, p, capKWp);
    if (kWp === null) {
      // Même le plus grand champ admis ne passe pas : on dit ce qui manque, sans afficher de champ solaire
      solarBlock = 'notViable';
      const b = replay({ ...p, installedKWp: capKWp });
      const wanted = b.equivalentNightH === null ? null : Math.ceil(b.equivalentNightH / 10) * 10;
      diagnosis = {
        ...verdict(b), capKWp, requiredCapacityKWh: b.requiredCapacityKWh, equivalentNightH: b.equivalentNightH,
        // Durée de nuit à imposer pour dimensionner sur cette séquence (arrondie à la dizaine d'heures), si elle reste saisissable
        suggestedNightH: wanted !== null && wanted > nightH && wanted <= FIELDS.nightOverrideH.max ? wanted : null,
      };
      warnings.push('notViable');
    } else {
      balance = replay({ ...p, installedKWp: kWp }, true);
      const rechargeKW = Math.max(0, kWp * derate - avgKW);          // surplus au bus en plein Soleil
      array = { ...arrayOf(kWp), rechargeKW, rechargeHours: rechargeKW > 0 && nightEnergyKWh > 0 ? nightEnergyKWh / (etaRT * rechargeKW) : null };
    }
  }
  const solar = { feasible: !!array, block: solarBlock, derate, capKWp, diagnosis, ...(array || {}) };
  if (site && site.sunPct > 0 && a.panelType === 'horizontal' && site.powerVerticalPct > 4 * site.powerHorizontalPct) warnings.push('panelPoor');

  // 5. Niveau du stockage sur la plus longue nuit visible dans la période, puis le jour lunaire qui suit
  let timeline = null;
  if (store && nightH > 0) {
    // Niveaux tracés en énergie contenue : limite de décharge, puis seuil sous lequel la marge de sécurité est entamée
    const floorKWh = store.capacityKWh - store.usableKWh, marginLineKWh = store.capacityKWh - store.nominalKWh;
    const dark = balance ? longestDarkRun(profile) : null;
    if (dark && dark.steps > 0) {
      const stepH = profile.stepH, end = Math.min(profile.n, dark.start + dark.steps + Math.round(LUNAR_DAY_H / stepH)), pts = [];
      for (let k = dark.start; k <= end; k++) pts.push([(k - dark.start) * stepH, floorKWh + balance.levels[k]]);
      timeline = { kind: 'simulated', night: pts.slice(0, dark.steps + 1), day: pts.slice(dark.steps), floorKWh, marginLineKWh, capacityKWh: store.capacityKWh };
    } else {
      // À défaut de simulation (solaire non chiffré) : décharge idéale à puissance constante sur la nuit retenue
      timeline = { kind: 'ideal', night: [[0, store.capacityKWh], [nightH, store.capacityKWh - storage.drawnKWh]], day: [], floorKWh, marginLineKWh, capacityKWh: store.capacityKWh };
    }
  }
  if (balance) balance.levels = null;

  // 6. Architectures comparées, toutes rejouées de la même façon quand l'éclairement est connu
  const fissionUnits = ceilUnits(peakKW / a.fissionUnitKWe) + a.fissionSpare, fissionKW = fissionUnits * a.fissionUnitKWe;
  const hybridUnits = ceilUnits(nightKW / a.fissionUnitKWe), hybridKW = hybridUnits * a.fissionUnitKWe;
  const hybridSim = { ...sim, baseKW: hybridKW, usableKWh: buffer.usableKWh };
  const hybridKWp = profile ? smallestArray(profile, hybridSim, capKWp) : null;
  const hybridArray = hybridKWp === null ? null : arrayOf(hybridKWp);
  const architectures = [
    array
      ? { id: 'solar', feasible: true, solarKWp: array.installedKWp, fissionKW: 0, units: 0, storageKWh: store.capacityKWh, check: verdict(balance),
        massKg: array.massKg + store.massKg, parts: { solarKg: array.massKg, storageKg: store.massKg, fissionKg: 0 } }
      : { id: 'solar', feasible: false, block: solarBlock },
    { id: 'fission', feasible: true, solarKWp: 0, fissionKW, units: fissionUnits, spare: a.fissionSpare, storageKWh: 0,
      check: profile ? verdict(replay({ ...sim, baseKW: fissionKW })) : null,
      massKg: fissionUnits * a.fissionUnitMassKg, parts: { solarKg: 0, storageKg: 0, fissionKg: fissionUnits * a.fissionUnitMassKg } },
    hybridArray
      ? { id: 'hybrid', feasible: true, solarKWp: hybridKWp, fissionKW: hybridKW, units: hybridUnits, dayComplementKW: Math.max(0, avgKW - hybridKW),
        storageKWh: buffer.capacityKWh, areaM2: hybridArray.areaM2, check: verdict(replay({ ...hybridSim, installedKWp: hybridKWp })),
        massKg: hybridUnits * a.fissionUnitMassKg + hybridArray.massKg + buffer.massKg,
        parts: { solarKg: hybridArray.massKg, storageKg: buffer.massKg, fissionKg: hybridUnits * a.fissionUnitMassKg } }
      : { id: 'hybrid', feasible: false, block: profile ? 'notViable' : 'noEngine' },
  ];
  // « Masse la plus faible » : seulement parmi les architectures réalisables et sans déficit au rejeu
  let best = null;
  for (const arch of architectures) if (arch.feasible && (!arch.check || arch.check.ok) && (!best || arch.massKg < best.massKg)) best = arch;

  return {
    inputs: a, clamped, warnings,
    site: site ? { ...site, profile: undefined } : null,
    night, loads, storage, solar, balance, timeline, architectures, bestMassId: best ? best.id : null,
  };
}

/** Vérifie qu'aucune grandeur du résultat n'est négative ou non finie (null = « non calculable » est admis). */
export function findInvalid(result) {
  const bad = [];
  const walk = (v, path) => {
    if (v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v) || (v < 0 && !path.endsWith('deltaStoreKWh'))) bad.push(path); return; }
    if (ArrayBuffer.isView(v)) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k);
  };
  walk(result, '');
  return bad;
}

/** Tableau de lignes -> CSV (séparateur virgule, guillemets doublés, point décimal). */
export function toCsv(rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(Number.isFinite(v) ? +v.toPrecision(10) : '') : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
