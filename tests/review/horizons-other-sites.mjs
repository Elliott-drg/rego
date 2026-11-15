// Relecture (a) : az/él Soleil et Terre contre JPL Horizons relevé en direct le 15/11/2026,
// sur 3 sites et des dates DIFFÉRENTS de tests/ephemeris-vs-horizons.mjs.
// Usage : node tests/review/horizons-other-sites.mjs <dossier des réponses Horizons h_*.txt>
import fs from 'node:fs';
import { sunEarthAt } from '../../public/js/science/ephemeris.js';
const dir = process.argv[2];
const sites = { a11: [0.6741, 23.4731, 0], sr: [-89.45, -137.3, 1954.5], ce4: [-45.44, 177.6, -5900] };
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
let worst = { az: 0, el: 0, azSky: 0 };
for (const [id, [lat, lon, h]] of Object.entries(sites)) for (const body of ['sun', 'earth']) {
  const txt = fs.readFileSync(`${dir}/h_${body}_${id}.txt`, 'utf8');
  const rows = txt.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
  for (const row of rows) {
    const c = row.split(',').map((s) => s.trim());
    const m = c[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
    const d = new Date(Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]));
    const az = +c[3], el = +c[4];
    const r = sunEarthAt(d, lat, lon, h)[body];
    let daz = r.az - az; if (daz > 180) daz -= 360; if (daz < -180) daz += 360;
    const del = r.el - el, dazSky = daz * Math.cos(el * Math.PI / 180);
    worst.az = Math.max(worst.az, Math.abs(daz)); worst.el = Math.max(worst.el, Math.abs(del)); worst.azSky = Math.max(worst.azSky, Math.abs(dazSky));
    console.log(id.padEnd(4), body.padEnd(5), d.toISOString().slice(0, 10), 'Horizons az', az.toFixed(4), 'el', el.toFixed(4), '| écart az', daz.toFixed(4), '(sur le ciel', dazSky.toFixed(4) + ')', 'él', del.toFixed(4));
  }
}
console.log('écart max : azimut', worst.az.toFixed(4), '° ; azimut×cos(él)', worst.azSky.toFixed(4), '° ; élévation', worst.el.toFixed(4), '°');
