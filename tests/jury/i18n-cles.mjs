// Contrôle statique (Node, sans navigateur) : clés présentes en français mais pas en anglais (ou l'inverse), valeurs identiques
// dans les deux langues (oubli de traduction probable), et clés littérales t('…') utilisées dans le code mais absentes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'js');
const dict = { fr: {}, en: {} }; const origin = {};
globalThis.__reg = (d, file) => { for (const l of ['fr', 'en']) for (const [k, v] of Object.entries(d[l] || {})) { dict[l][k] = v; origin[k] = file; } };
for (const f of fs.readdirSync(path.join(ROOT, 'i18n')).filter((x) => x.endsWith('.js'))) {
  let src = fs.readFileSync(path.join(ROOT, 'i18n', f), 'utf8');
  src = src.replace(/^import[^\n]*\n/gm, '').replace(/\bregister\(/g, `globalThis.__reg(`).replace(/globalThis\.__reg\(([\s\S]*?)\);?\s*$/m, (m) => m);
  // on passe le nom du fichier en 2e argument en enveloppant l'appel
  src = `const __f=${JSON.stringify(f)}; const __r=globalThis.__reg; globalThis.__reg=(d)=>__r(d,__f);\n${src}\nglobalThis.__reg=__r;`;
  try { await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64')); } catch (e) { console.log(`(${f} : non évaluable hors navigateur — ${e.message.slice(0, 80)})`); }
}
const fr = Object.keys(dict.fr), en = Object.keys(dict.en);
const onlyFr = fr.filter((k) => !(k in dict.en)), onlyEn = en.filter((k) => !(k in dict.fr));
console.log(`clés : ${fr.length} en français, ${en.length} en anglais`);
console.log(`\nabsentes en anglais (${onlyFr.length}) → le texte français s'affiche en mode EN :`); for (const k of onlyFr) console.log(`  ${k}  [${origin[k]}]  « ${String(dict.fr[k]).slice(0, 70)} »`);
console.log(`\nabsentes en français (${onlyEn.length}) :`); for (const k of onlyEn) console.log(`  ${k}  [${origin[k]}]  « ${String(dict.en[k]).slice(0, 70)} »`);
const same = fr.filter((k) => k in dict.en && dict.fr[k] === dict.en[k] && /[a-zà-ÿ]{4,}/i.test(dict.fr[k]) && String(dict.fr[k]).split(/\s+/).length >= 3);
console.log(`\nidentiques dans les deux langues, 3 mots ou plus (${same.length}) :`); for (const k of same) console.log(`  ${k}  « ${String(dict.fr[k]).slice(0, 90)} »`);
// variables {x} différentes entre les langues
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const diffVars = fr.filter((k) => k in dict.en && vars(dict.fr[k]) !== vars(dict.en[k]));
console.log(`\nvariables différentes entre FR et EN (${diffVars.length}) :`); for (const k of diffVars) console.log(`  ${k} : fr{${vars(dict.fr[k])}} en{${vars(dict.en[k])}}`);
// clés littérales utilisées dans le code
const used = new Map(); const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'i18n') walk(p); } else if (f.name.endsWith('.js')) { const s = fs.readFileSync(p, 'utf8'); for (const m of s.matchAll(/\bt\('([a-zA-Z0-9_.]+)'\s*[,)]/g)) { if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, p)); } } } }; walk(ROOT);
const missing = [...used].filter(([k]) => !(k in dict.fr) && !(k in dict.en));
console.log(`\nclés littérales t('…') utilisées dans le code : ${used.size} ; absentes des dictionnaires (${missing.length}) → la clé brute s'afficherait :`); for (const [k, f] of missing) console.log(`  ${k}  [${f}]`);
// espaces avant ; : ? ! % en français (insécable attendue)
const badFr = fr.filter((k) => /[^\s\u00a0\u202f(«][;:?!%](\s|$)/.test(String(dict.fr[k]).replace(/https?:\S+/g, '').replace(/\d\d:\d\d/g, '').replace(/\{[^}]*\}/g, 'X')) && !/^[\d.,]+$/.test(dict.fr[k]));
console.log(`\nfrançais : ponctuation haute sans espace avant (${badFr.length}) — premiers cas :`); for (const k of badFr.slice(0, 15)) console.log(`  ${k}  « ${String(dict.fr[k]).slice(0, 90)} »`);
