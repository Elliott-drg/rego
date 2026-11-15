// Température de surface instantanée : MODÈLE simplifié (ce n'est pas une mesure).
//
// Bilan radiatif d'une couche de surface de capacité thermique surfacique C :
//     C · dT/dt = (1 − A) · S · f · cos(i) − ε · σ · T⁴
//   A = albédo (0,12), ε = émissivité (0,95), S = 1361 W/m² (constante solaire à 1 UA ; la variation
//   de ±3,4 % au fil de l'année n'est pas appliquée par le moteur), f = fraction du disque solaire visible au-dessus de l'horizon réel,
//   i = angle d'incidence sur la pente locale (MNT 240 m).
//   C = 1,5·10⁵ J/m²/K, choisi pour qu'une nuit équatoriale de 14 jours refroidisse vers ~90–95 K
//   (ordre de grandeur des mesures Diviner). Plancher : température minimale Diviner du pixel si
//   elle est disponible, sinon 25 K (valeur de travail, flux géothermique et lumière diffusée ignorés).
// Limites : pas de conduction en profondeur, pas de lumière ni de chaleur renvoyées par le relief voisin
// (en ombre permanente le modèle reste donc au plancher, alors que Diviner y mesure des maximums plus
// élevés), pente à 240 m.

export const THERMAL = { albedo: 0.12, emissivity: 0.95, solar: 1361, capacity: 1.5e5, floorK: 25 };
const SIGMA = 5.670374419e-8;

export function equilibriumK(fluxAbs, p = THERMAL) { return Math.pow(Math.max(0, fluxAbs) / (p.emissivity * SIGMA), 0.25); }

/**
 * Intègre le modèle sur une série (sitecalc.siteSeries).
 * @param {object} S série @param {{floorK?:number, capK?:number, sunDistAU?:number, startK?:number}} opts
 * @returns {Float32Array} température (K) à chaque pas
 */
export function temperatureSeries(S, opts = {}) {
  const p = THERMAL, floor = opts.floorK ?? p.floorK, cap = opts.capK ?? Infinity;
  const sol = p.solar / ((opts.sunDistAU ?? 1) ** 2);
  const T = new Float32Array(S.n);
  const flux = (i) => (1 - p.albedo) * sol * S.sunFrac[i] * S.cosInc[i];
  // État initial : équilibre si éclairé, sinon plancher (l'effet s'efface en quelques jours simulés)
  let t = Math.max(floor, opts.startK ?? equilibriumK(flux(0)));
  const dt = S.stepMs / 1000;
  for (let i = 0; i < S.n; i++) {
    const F = flux(i);
    let remaining = dt;
    while (remaining > 0) {
      const tau = p.capacity / (4 * p.emissivity * SIGMA * Math.max(t, 20) ** 3);
      const h = Math.min(remaining, tau / 4);
      t += h * (F - p.emissivity * SIGMA * t ** 4) / p.capacity;
      if (t < floor) t = floor;
      remaining -= h;
    }
    T[i] = Math.min(cap, t);
  }
  return T;
}

export const kToC = (k) => k - 273.15;
