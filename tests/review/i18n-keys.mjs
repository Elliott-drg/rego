// Relecture : jeux de clés FR/EN de chaque fichier i18n, variables {x} différentes, doublons entre fichiers,
// typographie française (espace avant : ; ? ! % », après «, guillemets droits, apostrophes), clés t('…') absentes.
// Usage : node tests/review/i18n-keys.mjs [--typo] [--used]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JS = path.join(ROOT, 'public/js');
const files = [...fs.readdirSync(path.join(JS, 'i18n')).filter((f) => f.endsWith('.js')).map((f) => 'i18n/' + f), 'data/history.js'];
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'rf-i18n-'));
fs.writeFileSync(path.join(tmp, 'stub.mjs'), 'export const calls = []; export function register(d) { calls.push(d); }\n');
const all = { fr: new Map(), en: new Map() }, perFile = {};
for (const f of files) {
  let src = fs.readFileSync(path.join(JS, f), 'utf8');
  src = src.replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/core\/i18n\.js';/, `import { register } from '${pathToFileURL(path.join(tmp, 'stub.mjs')).href}';`);
  // les autres imports relatifs sont résolus depuis l'emplacement d'origine
  src = src.replace(/from\s*'(\.\.?\/[^']+)'/g, (m, p) => `from '${pathToFileURL(path.resolve(path.join(JS, path.dirname(f)), p)).href}'`);
  const out = path.join(tmp, f.replace(/\//g, '__') + '.mjs'); fs.writeFileSync(out, src);
  const stub = await import(pathToFileURL(path.join(tmp, 'stub.mjs')).href); const before = stub.calls.length;
  try { globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} }; await import(pathToFileURL(out).href); } catch (e) { console.log('ÉCHEC import', f, e.message); continue; }
  const d = { fr: {}, en: {} }; for (const c of stub.calls.slice(before)) for (const l of ['fr', 'en']) Object.assign(d[l], c[l] || {});
  perFile[f] = d;
  const kf = Object.keys(d.fr), ke = Object.keys(d.en);
  const onlyFr = kf.filter((k) => !(k in d.en)), onlyEn = ke.filter((k) => !(k in d.fr));
  console.log(`${f.padEnd(22)} fr ${String(kf.length).padStart(4)}  en ${String(ke.length).padStart(4)}  seulement fr : ${onlyFr.length}  seulement en : ${onlyEn.length}`);
  for (const k of onlyFr) console.log('   seulement FR :', k); for (const k of onlyEn) console.log('   seulement EN :', k);
  for (const k of kf) if (k in d.en) {
    const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    if (vars(d.fr[k]) !== vars(d.en[k])) console.log(`   variables différentes ${k} : fr {${vars(d.fr[k])}} en {${vars(d.en[k])}}`);
    const nums = (s) => [...String(s).replace(/[\u00a0\u202f ]/g, '').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.')).sort().join(' ');
    if (process.argv.includes('--nums') && nums(d.fr[k]) !== nums(d.en[k])) console.log(`   chiffres différents ${k}\n      fr: ${d.fr[k]}\n      en: ${d.en[k]}`);
    if (typeof d.fr[k] === 'string' && d.fr[k] === d.en[k] && /[a-zà-ÿ]{4,} [a-zà-ÿ]{3,}/i.test(d.fr[k]) && process.argv.includes('--same')) console.log('   identique fr/en :', k, '=', d.fr[k]);
  }
  for (const l of ['fr', 'en']) for (const k of Object.keys(d[l])) { if (all[l].has(k) && all[l].get(k).v !== d[l][k]) console.log(`   clé redéfinie avec un autre texte (${l}) : ${k} (${all[l].get(k).f} puis ${f})`); all[l].set(k, { f, v: d[l][k] }); }
}
if (process.argv.includes('--typo')) {
  console.log('--- Typographie française');
  for (const [f, d] of Object.entries(perFile)) for (const [k, v] of Object.entries(d.fr)) {
    if (typeof v !== 'string') continue;
    const issues = [];
    const s = v.replace(/https?:\/\/\S+/g, '').replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/<[^>]+>/g, '');
    if (/[^\s\u00a0\u202f(«][;?!](?!\w)/.test(s) || /[^\s\u00a0\u202f:\/\d«(][:](?=\s|$)/.test(s)) issues.push('pas d’espace avant : ; ? !');
    if (/\d%/.test(s)) issues.push('pas d’espace avant %');
    if (/«(?![\u00a0\u202f ])|(?<![\u00a0\u202f ])»/.test(s)) issues.push('guillemets « » sans espace');
    if (/"[^"]+"/.test(s)) issues.push('guillemets droits');
    if (/\b(?:a|A) partir|\bdeja\b|\bcote\b(?! d)|\betre\b|\bmeme\b|\bdonnees\b|\bcalcule\b(?=s? (?:par|avec|sur))|\bselectionn|\bmethode\b|\bperiode\b|\bresultat|\bregion\b|\bregions\b|\benergie\b|\bduree\b|\betat\b|\bdegre\b|\becart\b|\belevation\b|\beclair/.test(s)) issues.push('accent manquant ?');
    if (issues.length) console.log(`   ${f} ${k} : ${issues.join(' ; ')}\n      ${v}`);
  }
}
if (process.argv.includes('--used')) {
  console.log('--- Clés t(\'…\') littérales utilisées dans le code et absentes des dictionnaires');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const srcs = [...walk(JS), path.join(ROOT, 'public/index.html')];
  for (const p of srcs) {
    const src = fs.readFileSync(p, 'utf8');
    const keys = new Set([...src.matchAll(/\bt\('([a-zA-Z0-9_.\-]+)'/g)].map((m) => m[1]).concat([...src.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1])));
    for (const k of keys) { if (k.endsWith('.')) continue; if (!all.fr.has(k) || !all.en.has(k)) console.log('  ', path.relative(ROOT, p), ':', k, all.fr.has(k) ? '(absente en EN)' : all.en.has(k) ? '(absente en FR)' : '(absente partout)'); }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
