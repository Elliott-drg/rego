// Points favorables des 9 régions (PGDA) + indicateurs calculés en ces points, année 2027.
import fs from 'node:fs';
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const { setDem } = await import('../public/js/science/terrain.js');
const rd = (f, T) => { const b = fs.readFileSync('public/data/' + f); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
setDem(rd('sp_dem_240m.i16', Int16Array));
// Injection des rasters dans le registre (hors navigateur) : on remplace fetch par une lecture disque.
globalThis.fetch = async (url) => { const b = fs.readFileSync('public/' + url); return { ok: true, headers: { get: () => null }, body: null, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString()) }; };
const reg = await import('../public/js/data/registry.js');
for (const id of ['sp_sun_avg', 'sp_earth_avg', 'sp_psr', 'sp_tmin', 'sp_tmax', 'sp_tavg', 'artemis_regions']) await reg.ensureData(id);
const eng = await import('../public/js/science/engine.js');
const { state } = await import('../public/js/core/store.js');
state.timeMs = Date.UTC(2027, 5, 1);
for (const r of reg.getData('artemis_regions')) {
  const b = eng.regionBest(r.corners);
  const line = [r.name.padEnd(20)];
  for (const [k, p] of [['centre', { lat: r.center.lat, lon: r.center.lon }], ['compromis', b.both], ['soleil', b.sun], ['terre', b.earth]]) {
    const m = eng.siteWindow(p, 'year').metrics, info = eng.pointInfo(p.lat, p.lon);
    line.push(`${k}: S ${m.sunPct.toFixed(0)}% (PGDA ${info.sunAvgPct.toFixed(0)}) nuit ${(m.longestNightH / 24).toFixed(1)}j T ${m.earthPct.toFixed(0)}% (PGDA ${info.earthAvgPct.toFixed(0)}) coup ${(m.longestBlackoutH / 24).toFixed(1)}j`);
  }
  console.log(line.join(' | '));
}
