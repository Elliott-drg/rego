// Relecture : fraction du disque visible (9 bandes) contre la valeur exacte pour un horizon plat, et cas limites.
import './_load.mjs';
const { discFractionVisible, horizonAt } = await import('../../public/js/science/horizon.js');
const flat = (h) => ({ n: 720, elev: new Float32Array(720).fill(h) });
const exact = (d, R) => { const x = Math.max(-1, Math.min(1, d / R)); return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI; }; // d = él centre − horizon
let worst = 0;
for (let d = -0.266; d <= 0.2661; d += 0.0133) { const f = discFractionVisible(flat(1), 40, 1 + d, 0.266), e = exact(d, 0.266); worst = Math.max(worst, Math.abs(f - e)); }
console.log('horizon plat, 41 positions du disque : écart max fraction calculée − exacte =', worst.toFixed(4));
console.log('disque tangent par-dessous (él = h − R) :', discFractionVisible(flat(1), 40, 1 - 0.266, 0.266), '; juste au-dessus du bord (h − R + 0,001°) :', discFractionVisible(flat(1), 40, 1 - 0.265, 0.266).toExponential(2));
console.log('azimut 359,9 → interpolation circulaire :', horizonAt({ n: 720, elev: Float32Array.from({ length: 720 }, (_, i) => i) }, 359.75).toFixed(2), '(attendu 359,5 = moyenne de 719 et 0)');
console.log('azimut négatif −0,25 :', horizonAt({ n: 720, elev: Float32Array.from({ length: 720 }, (_, i) => i) }, -0.25).toFixed(2), '; 720,25 :', horizonAt({ n: 720, elev: Float32Array.from({ length: 720 }, (_, i) => i) }, 720.25).toFixed(2));
// encoche étroite de 0,2° de large (plus étroite que le disque) : les 9 bandes la voient-elles ?
const notch = flat(2); for (let i = 79; i <= 81; i++) notch.elev[i] = 0;   // encoche entre 39,5° et 40,5°
console.log('disque derrière une crête à 2°, encoche de 1° centrée sur le Soleil (él 1°) :', discFractionVisible(notch, 40, 1, 0.266).toFixed(3));
// près du zénith : élargissement en azimut borné
console.log('él 89,9° : fraction', discFractionVisible(flat(0), 10, 89.9, 0.266));
