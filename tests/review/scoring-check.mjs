// Relecture : les poids par défaut redonnent-ils les scores « annoncés » ? (VALIDATION : 0,03 ; reference.js : 0,05 ; moyenne simple : 0,25)
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const { REFERENCE_SCORES, DEFAULT_WEIGHTS, CRITERIA } = await import('../../public/js/data/reference.js');
const { weightedScore } = await import('../../public/js/science/scoring.js');
let maxW = 0, maxS = 0;
for (const [id, r] of Object.entries(REFERENCE_SCORES)) {
  const w = weightedScore(r), s = CRITERIA.reduce((a, c) => a + r[c], 0) / CRITERIA.length;
  maxW = Math.max(maxW, Math.abs(w - r.stated)); maxS = Math.max(maxS, Math.abs(s - r.stated));
  console.log(id.padEnd(22), 'annoncé', r.stated, 'pondéré', w.toFixed(3), 'moyenne simple', s.toFixed(3));
}
console.log('somme des poids', Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b), '; écart max pondéré', maxW.toFixed(3), '; écart max moyenne simple', maxS.toFixed(3));
