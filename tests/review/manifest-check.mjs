// Relecture (5) : manifest.json contre les fichiers (codage, extrêmes, points de contrôle) et contre registry.js.
import fs from 'node:fs';
import { rd, ROOT } from './_load.mjs';
const reg = await import('../../public/js/data/registry.js');
const man = JSON.parse(fs.readFileSync(ROOT + '/public/data/manifest.json', 'utf8'));
for (const id of ['sp_dem', 'sp_sun_avg', 'sp_earth_avg', 'sp_psr', 'sp_tmax', 'sp_tmin', 'sp_tavg', 'global_ldem', 'lpgrs', 'lp_hydrogen', 'features', 'artemis_regions']) await reg.ensureData(id);
const stat = (a, nod) => { let mn = Infinity, mx = -Infinity, n = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === nod) { n++; continue; } if (v < mn) mn = v; if (v > mx) mx = v; } return { mn, mx, nod: n }; };
const N = 3812;
for (const [id, nod, sc, unit] of [['sp_dem', null, 0.5, 'm'], ['sp_sun_avg', 255, 0.4, '%'], ['sp_earth_avg', 255, 0.4, '%'], ['sp_psr', null, 1, ''], ['sp_tmax', 0, 0.1, 'K'], ['sp_tmin', 0, 0.1, 'K'], ['sp_tavg', 0, 0.1, 'K'], ['global_ldem', null, 1, 'm']]) {
  const a = reg.getData(id), s = stat(a, nod);
  console.log(id.padEnd(13), 'n', a.length, 'min', (s.mn * sc).toFixed(1), 'max', (s.mx * sc).toFixed(1), unit, 'sans-donnée', s.nod, `(${(100 * s.nod / a.length).toFixed(1)} %)`, id.startsWith('sp_') && a.length !== N * N ? 'TAILLE ≠ 3812²' : '');
}
{ // valeurs brutes > 250 autres que 255 dans les cartes PGDA ; valeurs PSR hors 0/1
  for (const id of ['sp_sun_avg', 'sp_earth_avg']) { const a = reg.getData(id); let bad = 0; for (let i = 0; i < a.length; i++) if (a[i] > 250 && a[i] !== 255) bad++; console.log(id, 'octets 251–254 :', bad); }
  const p = reg.getData('sp_psr'); let bad = 0, ones = 0; for (let i = 0; i < p.length; i++) { if (p[i] > 1) bad++; if (p[i] === 1) ones++; } console.log('sp_psr valeurs > 1 :', bad, '; pixels PSR :', ones);
  // couverture Diviner : part des pixels valides et latitude maximale d'un pixel valide
  const t = reg.getData('sp_tmax'); let maxRho = 0, valid = 0; for (let r = 0; r < N; r += 1) for (let c = 0; c < N; c += 1) if (t[r * N + c]) { valid++; const x = (c - 1905.5) * 240, y = (1905.5 - r) * 240, rho = Math.hypot(x, y); if (rho > maxRho) maxRho = rho; }
  console.log('sp_tmax valides', (100 * valid / t.length).toFixed(1), '% ; latitude la plus au nord d’un pixel valide', (-90 + 2 * Math.atan(maxRho / (2 * 1737400)) * 180 / Math.PI).toFixed(2));
}
console.log('--- points de contrôle du manifeste, relus par samplePolar / heightAt (plus proche pixel)');
const { terrain } = await import('./_load.mjs');
const { spXYFromLatLon } = await import('../../public/js/core/coords.js');
for (const cp of man.control_points) {
  const p = spXYFromLatLon(cp.lat, cp.lon), px = terrain.pxFromXY(p.x, p.y), c = Math.round(px.c), r = Math.round(px.r), i = r * N + c;
  const got = { col: c, row: r, dem_m: reg.getData('sp_dem')[i] * 0.5, sun: reg.getData('sp_sun_avg')[i] / 2.5, earth: reg.getData('sp_earth_avg')[i] / 2.5, psr: reg.getData('sp_psr')[i], tmax: reg.getData('sp_tmax')[i] / 10, tmin: reg.getData('sp_tmin')[i] / 10, tavg: reg.getData('sp_tavg')[i] / 10 };
  const ok = got.col === cp.col && got.row === cp.row && got.dem_m === cp.dem_m && Math.abs(got.sun - cp.sun_avg_pct) < 0.05 && Math.abs(got.earth - cp.earth_avg_pct) < 0.05 && got.psr === cp.psr && (cp.tmax_K == null || Math.abs(got.tmax - cp.tmax_K) < 0.05);
  console.log(ok ? 'OK ' : 'ÉCART', cp.name, JSON.stringify(got), ok ? '' : JSON.stringify(cp).slice(0, 300));
}
console.log('--- structures JSON');
const g = reg.getData('lpgrs'); console.log('lpgrs clés', Object.keys(g), 'cells', g.cells?.length, 'ex.', JSON.stringify(g.cells?.[0]).slice(0, 200));
console.log('lpgrs au pôle Sud', JSON.stringify(reg.sampleLpgrs(-89, 10)).slice(0, 200), '; lon 180', !!reg.sampleLpgrs(0, 180), '; lon −180', !!reg.sampleLpgrs(0, -180), '; lat 90', !!reg.sampleLpgrs(90, 0));
const hy = reg.getData('lp_hydrogen'); console.log('lp_hydrogen clés', Object.keys(hy), 'grid', JSON.stringify(hy.grid), 'nodata', hy.nodata, 'H n', hy.layers.H.length, '; H(−89.9, 0) =', reg.sampleHydrogen(-89.9, 0), '; H(43.25, 153.75) =', reg.sampleHydrogen(43.25, 153.75), '; H(0, 180) =', reg.sampleHydrogen(0, 180));
let s85 = 0, n85 = 0; for (let la = -89.75; la < -85; la += 0.5) for (let lo = -179.75; lo < 180; lo += 0.5) { const v = reg.sampleHydrogen(la, lo); if (Number.isFinite(v)) { s85 += v * Math.cos(la * Math.PI / 180); n85 += Math.cos(la * Math.PI / 180); } } console.log('H moyen au sud de 85°S (pondéré surface)', (s85 / n85).toFixed(0), 'ppm (manifeste : 131)');
console.log('global_ldem : Apollo 11', reg.sampleGlobalHeight(0.6741, 23.4731).toFixed(0), 'm (attendu ≈ −1930) ; pôle S', reg.sampleGlobalHeight(-89.9, 0).toFixed(0), '; lon 179,9', reg.sampleGlobalHeight(10, 179.95).toFixed(0), '; lon −179,9', reg.sampleGlobalHeight(10, -179.95).toFixed(0), '; lon 180 exact', reg.sampleGlobalHeight(10, 180).toFixed(0));
// corrélation relief global / polaire à 80°S pour vérifier la convention de longitude (signe)
{ let sxy = 0, sxx = 0, syy = 0, sx = 0, sy = 0, n = 0, sxy2 = 0; for (let lo = -180; lo < 180; lo += 1) { const a = terrain.heightAt(-80, lo), b = reg.sampleGlobalHeight(-80, lo), b2 = reg.sampleGlobalHeight(-80, -lo); n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b; sxy2 += a * b2; }
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy)); console.log('corrélation MNT polaire / global à 80°S : r =', r.toFixed(3), '(longitude inversée :', ((n * sxy2 - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))).toFixed(3) + ')'); }
const feats = reg.getData('features'); const sh = feats.find((f) => f.name === 'Shackleton'), ty = feats.find((f) => f.name === 'Tycho'), ma = feats.find((f) => /Malapert$/.test(f.name));
console.log('features', feats.length, JSON.stringify(sh), JSON.stringify(ty), JSON.stringify(ma));
if (sh) console.log('hauteur MNT au centre de Shackleton', terrain.heightAt(sh.lat, sh.lon).toFixed(0), 'm (fond attendu ≈ −2800 à −2900) ; PSR', reg.samplePolar('sp_psr', sh.lat, sh.lon));
console.log('régions Artemis', reg.getData('artemis_regions').map?.((r) => `${r.id}:${r.center.lat.toFixed(2)},${r.center.lon.toFixed(2)}`).join(' ') || Object.keys(reg.getData('artemis_regions')));
// fichiers déclarés par registry.js absents du manifeste, et inversement
const listed = new Set(man.files.map((f) => f.file));
for (const [id, d] of Object.entries(reg.DATASETS)) if (id !== 'manifest' && !listed.has(d.file)) console.log('registry → fichier absent du manifeste :', id, d.file);
const regFiles = new Set(Object.values(reg.DATASETS).map((d) => d.file));
for (const f of listed) if (!regFiles.has(f) && !f.startsWith('../')) console.log('manifeste → fichier non déclaré dans registry.js :', f);
