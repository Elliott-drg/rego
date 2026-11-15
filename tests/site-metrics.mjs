// Indicateurs calculés pour quelques points connus (nécessite public/data/sp_dem_240m.i16 ou tools/raw/ldem_75s_240m.img).
import fs from 'node:fs';
import { setDem, heightAt, slopeAt, slopeStats } from '../public/js/science/terrain.js';
import { siteSeries, seriesMetrics, DAY_MS, instantState, nextTransition } from '../public/js/science/sitecalc.js';
import { temperatureSeries } from '../public/js/science/thermal.js';
const f = fs.existsSync('public/data/sp_dem_240m.i16') ? 'public/data/sp_dem_240m.i16' : 'tools/raw/ldem_75s_240m.img';
const buf = fs.readFileSync(f); setDem(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
const pts = [['Crête Shackleton (89.45S 137.3W)', -89.45, -137.3], ['Fond Shackleton', -89.67, 129.2], ['Malapert', -85.99, -2.9], ['Haworth fond (87.45S 5W)', -87.45, -5], ['Pôle', -90, 0], ['Mons Mouton', -84.6, 31]];
const t0 = Date.UTC(2026, 0, 1);
for (const [name, lat, lon] of pts) {
  const site = { lat, lon };
  let t = performance.now();
  const S = siteSeries(site, t0, 365.25 * DAY_MS);
  const m = seriesMetrics(S);
  const dt = performance.now() - t;
  const T = temperatureSeries(S);
  let tmin = 1e9, tmax = 0; for (let i = 24 * 60; i < S.n; i++) { if (T[i] < tmin) tmin = T[i]; if (T[i] > tmax) tmax = T[i]; }
  const sl = slopeAt(lat, lon), st = slopeStats(lat, lon, 2000);
  console.log(`${name.padEnd(34)} h=${heightAt(lat, lon).toFixed(0).padStart(6)} m pente=${sl ? sl.slopeDeg.toFixed(1) : '—'}° (<10° sur 2 km : ${st ? (100 * st.fracBelow).toFixed(0) : '—'} %)  Soleil ${m.sunPct.toFixed(1)} % (disque ${m.sunDiscPct.toFixed(1)} %) nuit max ${(m.longestNightH / 24).toFixed(1)} j  Terre ${m.earthPct.toFixed(1)} % blackout max ${(m.longestBlackoutH / 24).toFixed(1)} j  T ${tmin.toFixed(0)}–${tmax.toFixed(0)} K  [${dt.toFixed(0)} ms]`);
}
const tr = nextTransition({ lat: -85.99, lon: -2.9 }, Date.UTC(2026, 10, 15), 'sun');
console.log('Malapert, Soleil visible le 15/11/2026 ?', tr.now, '→ bascule', tr.nextMs && new Date(tr.nextMs).toISOString());
