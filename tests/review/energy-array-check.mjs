// Relecture : reproduction du constat « champ solaire aberrant quand la nuit approche un multiple du jour lunaire ».
import './_load.mjs';
const eng = await import('../../public/js/science/engine.js');
const en = await import('../../public/js/science/energy.js');
const reg = await import('../../public/js/data/registry.js');
await reg.ensureData('artemis_regions');
const regions = reg.getData('artemis_regions');
const a = en.sanitize ? en.sanitize({}).values ?? en.sanitize({}) : en.DEFAULTS;
for (const r of regions) {
  const site = { lat: r.center.lat, lon: r.center.lon };
  const w = eng.siteWindow(site, 'year', Date.UTC(2026, 5, 1));
  const prof = en.solarProfile(w.series), si = en.siteInputs(w.metrics, prof);
  let res; try { res = en.computeEnergy(a, si); } catch (e) { console.log(r.name, 'EXCEPTION', e.message); continue; }
  console.log(r.name.padEnd(20), 'nuit max', w.metrics.longestNightH.toFixed(0), 'h ; cycle : Soleil', si.cycleLitH.toFixed(0), 'h / ombre', si.cycleDarkH.toFixed(0), 'h ; charge moy.', res.loads.avgKW, 'kW ; champ', res.solar.feasible ? res.solar.installedKWp.toFixed(0) + ' kWc, ' + res.solar.areaM2.toFixed(0) + ' m²' : 'impossible (' + res.solar.block + ')', '; déficit', res.balance ? res.balance.unservedKWh.toFixed(0) + ' kWh' : '—');
}
