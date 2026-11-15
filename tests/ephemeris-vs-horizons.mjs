// Compare le calcul local (Astronomy Engine) à JPL Horizons (valeurs relevées le 15/11/2026,
// site lon 357.1°E, lat -85.99°, alt 4.0 km). Lancer : node tests/ephemeris-vs-horizons.mjs
import { sunEarthAt } from '../public/js/science/ephemeris.js';
const ref = {
  sun: [['2026-11-15', 117.370833, -0.286602], ['2026-11-20', 56.651851, 3.754250], ['2026-11-25', 355.792521, 5.516514],
        ['2026-11-30', 294.971496, 3.174527], ['2026-12-05', 234.260830, -0.888075], ['2026-12-10', 173.325388, -2.553572], ['2026-12-15', 112.452680, -0.159702]],
  earth: [['2026-11-15', 0.279505, 0.456051], ['2026-11-20', 355.632550, 7.171252], ['2026-11-25', 1.173984, 10.082438],
          ['2026-11-30', 9.017372, 3.929327], ['2026-12-05', 8.819355, -2.219344], ['2026-12-10', 3.925373, -1.639203], ['2026-12-15', 357.203063, 4.323047]],
};
let worst = { az: 0, el: 0 };
for (const body of ['sun', 'earth']) {
  for (const [d, az, el] of ref[body]) {
    const r = sunEarthAt(new Date(d + 'T00:00:00Z'), -85.99, -2.9, 4000)[body];
    let daz = r.az - az; if (daz > 180) daz -= 360; if (daz < -180) daz += 360;
    const del = r.el - el;
    worst.az = Math.max(worst.az, Math.abs(daz)); worst.el = Math.max(worst.el, Math.abs(del));
    console.log(body.padEnd(6), d, 'az', r.az.toFixed(4), `(${daz >= 0 ? '+' : ''}${daz.toFixed(4)})`, 'el', r.el.toFixed(4), `(${del >= 0 ? '+' : ''}${del.toFixed(4)})`);
  }
}
console.log('écart max : azimut', worst.az.toFixed(4), '° ; élévation', worst.el.toFixed(4), '°');
if (worst.az > 0.1 || worst.el > 0.05) { console.error('ÉCHEC : écart supérieur à la tolérance (0,1° az ; 0,05° él)'); process.exit(1); }
console.log('OK');
