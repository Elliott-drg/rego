// Test navigateur du module « Dimensionnement énergétique » (monté seul dans tests/pages/energy.html).
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/energy.browser.mjs
// Captures : tests/.out/energy-*.png (à regarder). Sortie : liste des contrôles, code 1 au premier échec.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, openPage, OUT } from './browser.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MALAPERT = { key: 'test-malapert', name: 'Malapert (test)', lat: -85.99, lon: -2.9, kind: 'point' };
const SHACKLETON_FLOOR = { key: 'test-floor', name: 'Fond de Shackleton (test)', lat: -89.67, lon: 129.2, kind: 'point' };
const HAWORTH = { key: 'test-haworth', name: 'Haworth (test)', lat: -86.77, lon: -22.79, kind: 'point' };
const T0 = Date.UTC(2026, 10, 15);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok ' : '  ÉCHEC'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `energy-${name}.png`), ...opts });
/** Texte visible d'un élément, espaces insécables ramenées à des espaces simples. */
const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/[\u00a0\u202f]/g, ' '));
/** Texte d'une tuile de résultat (valeur + unité). */
const tileText = (page, id) => page.$eval(`.en-tile[data-res="${id}"] .stat-value`, (el) => el.textContent.replace(/[\u00a0\u202f]/g, ' ').trim());
const tileSub = (page, id) => page.$eval(`.en-tile[data-res="${id}"] .stat-sub`, (el) => el.textContent.replace(/[\u00a0\u202f]/g, ' ').trim());
// Chromium sans écran signale « net::ERR_ABORTED » sur le relief (29 Mo lus en flux par data/registry.js) alors que le
// fichier est reçu en entier et utilisé : le contrôle « relief chargé » ci-dessous le prouve. Ce seul message est écarté.
const real = (problems) => problems.filter((p) => !/sp_dem_240m\.i16 net::ERR_ABORTED/.test(p));
const ready = (page) => page.waitForSelector('.en-results[data-ready="1"]', { timeout: 60000 });
/** Nombre lu dans un texte formaté (fr : « 10 499,5 » ; en : « 10,499.5 »). */
function parseNum(str, lang) {
  const m = str.match(/[\d][\d\s.,]*/); if (!m) return NaN;
  const raw = m[0].replace(/\s/g, '');
  return Number(lang === 'fr' ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
}
async function open(page, selection, { lang = 'fr', mode = 'simple' } = {}) {
  await page.waitForSelector('body[data-ready="1"]', { timeout: 120000 });
  await page.evaluate(({ selection, lang, mode, T0 }) => {
    localStorage.removeItem('rf.energy');
    window.RF.set({ lang, mode, timeMs: T0, selection });
    window.RF.openEnergy();
  }, { selection, lang, mode, T0 });
  await ready(page);
}
const setRange = (page, id, value) => page.$eval('#en-f-' + id, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
async function noBadNumbers(page, label) {
  const str = await page.$eval('.en-results', (el) => el.innerText);
  check(`${label} : aucun NaN, undefined, Infinity ni valeur négative affichée`, !/NaN|undefined|Infinity|null/.test(str) && !/(^|[\s(])[-]\d/.test(str), (str.match(/.{0,20}(NaN|undefined|Infinity|null).{0,20}/) || [''])[0]);
  const missing = await page.$$eval('.modal *', (els) => els.filter((e) => e.children.length === 0 && /^energy\.|^ui\.|^mode\.|^kind\.|^prov\./.test(e.textContent.trim())).map((e) => e.textContent.trim()));
  check(`${label} : aucune clé de traduction ni variable {…} affichée brute`, missing.length === 0 && !/\{[a-z]+\}/i.test(str), missing.slice(0, 5).join(', ') + (str.match(/.{0,20}\{[a-z]+\}.{0,20}/i) || [''])[0]);
  // I12 : jamais « masse la plus faible » sur une architecture en déficit au rejeu
  const rows = await page.$$eval('.en-table tbody tr[data-feasible="1"]', (trs) => trs.map((tr) => ({ arch: tr.dataset.arch, best: tr.dataset.best, check: tr.querySelector('[data-check]')?.dataset.check || 'absent' })));
  check(`${label} : chaque architecture chiffrée porte un verdict de rejeu, la plus légère n’est pas en déficit`, rows.every((r) => r.check !== 'absent' && !(r.best === '1' && r.check === 'bad')), JSON.stringify(rows));
}

const srv = await serveStatic(REPO);
const url = srv.url + 'tests/pages/energy.html';
try {
  // ------------------------------------------------------------------ 1. Bureau, français, mode simplifié
  console.log('1. Bureau 1440×900, français, Malapert, mode simplifié');
  const desk = await openPage(url, { width: 1440, height: 900 });
  const page = desk.page;
  await open(page, MALAPERT);
  await shot(page, '1-fr-simple-non-viable');
  check('fenêtre large ouverte', await page.$eval('.modal', (m) => m.classList.contains('modal-wide') && m.dataset.modal === 'energy'));
  check('titre en français', (await page.textContent('.modal-title')) === 'Dimensionnement énergétique de la base');
  check('bandeau « pré-dimensionnement » en tête', /Pré-dimensionnement pédagogique, pas une validation de conception/.test(await page.textContent('.en-banner')));
  check('mode simplifié : 4 tuiles, toutes étiquetées « modèle »', (await page.$$('.en-tile')).length === 4 && (await page.$$('.en-tile .tag-model')).length === 4);
  check('mode simplifié : seulement site, équipage, mode survie', JSON.stringify(await page.$$eval('.en-form [data-group]', (els) => els.map((e) => e.dataset.group))) === '["site","crew","survival"]');
  check('mode simplifié : aucun champ numérique expert', (await page.$$('.en-form input[type="number"]')).length === 0);
  check('site affiché avec ses coordonnées', /85,99°\sS, 2,90°\sO/.test(await page.textContent('.en-coords')));
  const siteData = await text(page, '.en-sitedata');
  check('indicateurs du moteur étiquetés « calculé »', /Soleil visible/.test(siteData) && /Plus longue nuit continue/.test(siteData) && (await page.$$('.en-sitedata .tag-computed')).length >= 2, siteData.replace(/\n/g, ' | '));
  check('plus longue nuit de Malapert en 2026 : 415 h', /415 h/.test(siteData));
  check('relief LOLA chargé et utilisé (pas de note « horizon sans relief »)', !/sans relief/.test(siteData) && await page.evaluate(async () => (await import('/public/js/science/terrain.js')).hasDem()));
  check('valeurs par défaut étiquetées « hypothèse »', (await page.$$('.en-form .tag-hypothesis')).length >= 2);
  check('puissance moyenne par défaut : 16,0 kW', (await tileText(page, 'avg')) === '16,0 kW', await tileText(page, 'avg'));
  check('tuile « Énergie quotidienne à pleine charge » : 384 kWh/j', (await tileText(page, 'daily')) === '384 kWh/j' && /Énergie quotidienne à pleine charge/.test(await text(page, '.en-tile[data-res="daily"] .stat-label')), await tileText(page, 'daily'));
  check('énergie de la plus longue nuit : 16 kW × 415 h = 6 640 kWh', (await tileText(page, 'night')) === '6 640 kWh', await tileText(page, 'night'));
  const cap4 = parseNum(await tileText(page, 'storage'), 'fr');
  check('stockage installé : 6 640 / (√0,9 × 0,8) × 1,2 ≈ 10 499 kWh', Math.abs(cap4 - 10499) <= 1, String(cap4));
  // B2 + I11 : nuits de 168 h et 415 h séparées par 3 h de Soleil -> pas de champ solaire aberrant, un constat clair et neutre
  const verdict = await text(page, '.en-verdict');
  check('B2 : « non viable ici » dit en clair, sans chiffre de champ solaire', (await page.getAttribute('.en-verdict', 'data-verdict')) === 'notViable' && /Solaire \+ stockage non viable ici avec un stockage dimensionné sur la plus longue nuit \(17,3 j \(415 h\)\) : même un champ solaire de 800 kWc \(50 fois la puissance moyenne\) ne passe pas la période/.test(verdict), verdict.replace(/\n/g, ' | '));
  check('I11 : déficit formulé de façon neutre (ni le stockage ni les panneaux seuls)', /\d+ jours avec déficit sur 365 : ce dimensionnement \(stockage sur la plus longue nuit, champ solaire au plafond\) ne suffit pas sur ce site/.test(verdict) && !/à dimensionner le stockage/.test(verdict));
  check('stockage qu’il faudrait, donné en clair', /Il faudrait au moins [\d ]+ kWh de stockage, l’équivalent d’une nuit continue de 24,3 j \(583 h\)/.test(verdict), verdict.replace(/\n/g, ' | '));
  const solarRow = await text(page, '.en-table tr[data-arch="solar"]');
  check('tableau : solaire « non chiffrée ici », fission et hybride chiffrées', /Non chiffrée ici : aucun champ solaire raisonnable ne passe la période avec ce stockage/.test(solarRow) && JSON.stringify(await page.$$eval('.en-table tbody tr', (rows) => rows.map((r) => r.dataset.feasible))) === '["0","1","1"]', solarRow.replace(/\s+/g, ' '));
  check('unités explicites : fission en kWe, hybride en kWe + kWc', /40 kWe/.test(await text(page, '.en-table tr[data-arch="fission"] td')) && /20 kWe\s*\+ 0 kWc/.test(await text(page, '.en-table tr[data-arch="hybrid"] td')), await text(page, '.en-table tr[data-arch="hybrid"] td'));
  check('I12 : note sur les critères de dimensionnement différents', /ne sont pas dimensionnées sur le même critère : la fission seule couvre la pointe avec une unité de secours, l’hybride couvre la charge moyenne de nuit sans secours/.test(await text(page, '[data-note="criteria"]')));
  check('fission et hybride marquées « concept non opérationnel »', (await page.$$eval('.en-arch-c', (els) => els.map((e) => e.textContent))).filter((x) => /concept non opérationnel/i.test(x)).length === 2);
  check('lecture du résultat : site, charge, constat « pas viable en l’état »', /À Malapert \(test\).*plus longue nuit dure 17,3 j \(415 h\)/.test(await text(page, '.en-read')) && /aucun champ solaire raisonnable \(jusqu’à 50 fois la puissance moyenne\) ne passe la période/.test(await text(page, '.en-read')));
  await noBadNumbers(page, 'simple fr, non viable');

  // Le bouton applique la durée de nuit proposée : le solaire devient chiffrable
  await page.click('.en-verdict .btn');
  await ready(page);
  check('bouton « Dimensionner sur une nuit de 590 h » : nuit imposée affichée, avec retour possible', /Durée de nuit imposée\s+24,6 j \(590 h\)/.test(await text(page, '.en-sitedata')) && (await page.$$('.en-sitedata .en-inline-action .btn')).length === 1, (await text(page, '.en-sitedata')).replace(/\n/g, ' | '));
  check('nuit imposée : 16 kW × 590 h = 9 440 kWh', (await tileText(page, 'night')) === '9 440 kWh' && /nuit imposée de 24,6 j \(590 h\)/.test(await tileSub(page, 'night')), await tileText(page, 'night'));
  const okVerdict = await text(page, '.en-verdict');
  check('verdict : aucun déficit, réserve restante dite', (await page.getAttribute('.en-verdict', 'data-verdict')) === 'ok' && /Aucun déficit sur la période rejouée heure par heure\. Au plus bas, il reste \d+ % de la capacité utile \(la marge de sécurité en représente 17 %\)/.test(okVerdict), okVerdict);
  check('tableau : les 3 architectures chiffrées, solaire en kWc', JSON.stringify(await page.$$eval('.en-table tbody tr', (rows) => rows.map((r) => r.dataset.feasible))) === '["1","1","1"]' && /^\d+ kWc$/.test((await text(page, '.en-table tr[data-arch="solar"] td')).trim()), await text(page, '.en-table tr[data-arch="solar"] td'));
  const bestRows = await page.$$eval('.en-table tbody tr[data-best="1"]', (rows) => rows.map((r) => r.innerText));
  check('meilleure masse signalée par texte + symbole', bestRows.length === 1 && /✓ masse la plus faible/.test(bestRows[0]), bestRows.join(' / ').replace(/\s+/g, ' '));
  check('graphique du niveau de stockage : deux séries, deux repères', (await page.$$('.en-card[data-block="chart"] svg.chart-line path[fill="none"]')).length === 2 && (await page.$$('.en-card[data-block="chart"] .chart-legend span')).length === 2 && /limite de décharge/.test(await text(page, '.en-card[data-block="chart"]')) && /marge entamée en dessous/.test(await text(page, '.en-card[data-block="chart"]')));
  await noBadNumbers(page, 'simple fr, nuit imposée');
  await shot(page, '1-fr-simple-nuit-imposee');
  const cap590 = parseNum(await tileText(page, 'storage'), 'fr');
  check('stockage sur 590 h : ×590/415', Math.abs(cap590 / cap4 - 590 / 415) < 0.002, `${cap4} → ${cap590}`);

  // Formule au clic et au survol
  check('formule au survol (attribut title)', /P_moy = n × P_vie/.test(await page.getAttribute('.en-tile[data-res="avg"]', 'title')));
  await page.click('.en-tile[data-res="storage"]');
  const formula = await page.$eval('.en-formula[data-scope="tiles"]', (el) => (el.classList.contains('hidden') ? '' : el.innerText.replace(/[\u00a0\u202f]/g, ' ')));
  check('formule au clic sur « Stockage installé »', /C = E_nuit \/ \(η_d × DoD\) × \(1 \+ m\) = 9 440 kWh/.test(formula), formula.replace(/\n/g, ' | '));

  // ------------------------------------------------------------------ 2. Changement d'équipage
  console.log('2. Équipage : 4 → 8 personnes (recalcul immédiat)');
  await setRange(page, 'crew', 8);
  check('puissance moyenne : 8 × 1,5 + 10 = 22,0 kW', (await tileText(page, 'avg')) === '22,0 kW', await tileText(page, 'avg'));
  check('énergie quotidienne : 528 kWh/j', (await tileText(page, 'daily')) === '528 kWh/j');
  const cap8 = parseNum(await tileText(page, 'storage'), 'fr');
  check('plus d’équipage → plus de stockage (×22/16)', Math.abs(cap8 / cap590 - 22 / 16) < 0.002, `${cap590} → ${cap8}`);
  check('valeur du curseur affichée', /8\spersonnes/.test(await page.textContent('.en-range-v')));
  check('la formule ouverte suit le recalcul', /12 980 kWh/.test(await text(page, '.en-formula[data-scope="tiles"]')));
  await setRange(page, 'survivalPct', 50);
  check('mode survie 50 % → stockage ÷ 2', Math.abs(parseNum(await tileText(page, 'storage'), 'fr') / cap8 - 0.5) < 0.002);
  await setRange(page, 'survivalPct', 100);
  await shot(page, '2-fr-crew8');
  // Retour à la nuit calculée depuis le mode simplifié
  await page.click('.en-sitedata .en-inline-action .btn');
  await ready(page);
  check('« Revenir à la nuit calculée » : nuit du moteur rétablie (22 kW × 415 h = 9 130 kWh)', (await tileText(page, 'night')) === '9 130 kWh' && (await page.getAttribute('.en-verdict', 'data-verdict')) === 'notViable', await tileText(page, 'night'));

  // ------------------------------------------------------------------ 3. Mode expert
  console.log('3. Bascule en mode expert');
  await page.click('.en-bar .seg button[data-mode="expert"]');
  await ready(page);
  check('état global passé en expert', await page.evaluate(() => window.RF.state.mode === 'expert' && document.body.dataset.mode === 'expert'));
  check('6 tuiles en mode expert', (await page.$$('.en-tile')).length === 6);
  check('6 groupes d’hypothèses', JSON.stringify(await page.$$eval('.en-form [data-group]', (els) => els.map((e) => e.dataset.group))) === '["site","crew","loads","storage","solar","fission"]');
  const nFields = (await page.$$('.en-form input[type="number"]')).length;
  check('tous les champs numériques présents (22)', nFields === 22, String(nFields));
  check('chaque champ numérique porte l’étiquette « hypothèse » et une justification', await page.$$eval('.en-form .en-field', (els) => els.filter((e) => e.querySelector('input[type="number"], input[type="range"]')).every((e) => e.querySelector('.tag-hypothesis') && e.querySelector('.en-field-n').textContent.length > 20)));
  check('équipage conservé (8) après la bascule', (await page.$eval('#en-f-crew', (el) => el.value)) === '8');
  check('solaire non viable : tuiles « Solaire » et « Recharge » sans chiffre', (await tileText(page, 'solar')) === 'non chiffré' && (await tileText(page, 'recharge')) === 'non chiffré' && /aucun champ solaire raisonnable/.test(await tileSub(page, 'solar')));
  check('bloc « Rejeu heure par heure » : diagnostic au plafond', (await page.$$('.en-card[data-block="balance"] .kv')).length === 4 && /plus grand champ solaire admis \(1,10 MWc\)/.test(await text(page, '.en-card[data-block="balance"]')), await text(page, '.en-card[data-block="balance"]'));
  check('repliable « Méthode et formules » présent', (await page.$$('details[data-block="method"]')).length === 1);
  // I14 et repères vérifiés
  const loadsNote = await text(page, 'details[data-group="loads"] .en-group-n');
  check('I14 : Fission Surface Power = étude de phase 1 d’une démonstration, directive 2025 à 100 kWe ; ISS 75 à 90 kW', /phase 1 du projet Fission Surface Power \(2022\) portaient sur un réacteur de démonstration de 40 kWe/.test(loadsNote) && /au moins 100 kWe/.test(loadsNote) && /75 à 90 kW/.test(loadsNote) && !/vise 40 kWe pour une première base/.test(loadsNote) && !/84 à 120/.test(loadsNote), loadsNote);
  check('piles régénératives : énergie massique « rapportée à la capacité installée »', /rapportée ici à la capacité installée/.test(await text(page, 'details[data-group="storage"]')));
  await shot(page, '3-fr-expert-non-viable');

  // Nuit imposée par le bouton, en mode expert : la case et le champ suivent
  await page.click('.en-verdict .btn');
  await ready(page);
  check('bouton en mode expert : case cochée, champ à 590', (await page.isChecked('#en-override')) && (await page.inputValue('#en-f-nightOverrideH')) === '590');
  check('tuiles « Solaire » en kWc et « Recharge » en kW', /^\d[\d ,]* kWc$/.test(await tileText(page, 'solar')) && /^\d[\d ,]* kW$/.test(await tileText(page, 'recharge')) && /en plein Soleil ; plein de la plus longue nuit refait en/.test(await tileSub(page, 'recharge')), `${await tileText(page, 'solar')} / ${await tileText(page, 'recharge')}`);
  const balance = await text(page, '.en-card[data-block="balance"]');
  check('bloc « Rejeu » : 9 lignes, 0 jour de déficit, réserve et stockage requis ≤ installé (I9)', (await page.$$('.en-card[data-block="balance"] .kv')).length === 9 && /Jours avec déficit\s+0 sur 365/.test(balance) && /marge de sécurité comprise/.test(balance), balance.replace(/\n/g, ' | '));
  const required = parseNum((balance.match(/Stockage qu’il aurait fallu, sans marge\s+([\d ,]+ kWh)/) || ['', ''])[1], 'fr'), installed = parseNum(await tileText(page, 'storage'), 'fr');
  check('I9 : « aucun déficit » et stockage requis ≤ stockage installé', required > 0 && required <= installed + 1, `${required} ≤ ${installed}`);
  await page.click('.en-tile[data-res="solar"]');
  check('formule du champ solaire : dichotomie sur la période rejouée, plafond dit', /plus petit champ solaire avec lequel la période rejouée heure par heure ne laisse rien non servi/.test(await text(page, '.en-formula[data-scope="tiles"]')) && /plafond 1,10 MWc, soit 50 × P_moy/.test(await text(page, '.en-formula[data-scope="tiles"]')), (await text(page, '.en-formula[data-scope="tiles"]')).replace(/\n/g, ' | '));
  await shot(page, '3-fr-expert-haut');
  // Champ : ISRU 20 kW -> puissance moyenne 42 kW
  await page.fill('#en-f-isruKW', '20');
  check('ISRU 20 kW → puissance moyenne 42,0 kW', (await tileText(page, 'avg')) === '42,0 kW', await tileText(page, 'avg'));
  await page.fill('#en-f-isruKW', '0');
  // Accord au singulier
  await page.fill('#en-f-missionDays', '1');
  check('accord au singulier : « mission de 1 jour »', /^mission de 1 jour :/.test(await tileSub(page, 'daily')), await tileSub(page, 'daily'));
  await page.fill('#en-f-missionDays', '180');
  // Bornes : 5000 % de marge -> ramené à 200 %, signalé ; champ vidé -> message distinct
  await page.fill('#en-f-marginPct', '5000');
  check('valeur hors bornes signalée', (await page.getAttribute('#en-f-marginPct', 'aria-invalid')) === 'true' && /Hors bornes : valeur ramenée entre 0 et 200\./.test(await text(page, '#en-n-marginPct .en-bound')));
  await noBadNumbers(page, 'expert fr, valeur hors bornes');
  await page.$eval('#en-f-marginPct', (el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  check('valeur bornée réécrite dans le champ (200)', (await page.inputValue('#en-f-marginPct')) === '200');
  await page.fill('#en-f-marginPct', '');
  check('champ vidé : message distinct, valeur par défaut utilisée', /Champ vide : le calcul utilise la valeur par défaut \(20\)\./.test(await text(page, '#en-n-marginPct .en-bound')) && !/Hors bornes/.test(await text(page, '#en-n-marginPct .en-bound')) && /vides ou hors bornes/.test(await text(page, '.en-results')));
  await page.fill('#en-f-marginPct', '20');
  check('champ corrigé : plus de message', await page.$eval('#en-n-marginPct .en-bound', (el) => el.classList.contains('hidden')));
  // Préréglage piles à combustible régénératives
  const massLi = await tileSub(page, 'storage');
  await page.click('.en-seg button[data-v="rfc"]');
  check('préréglage RFC : champs remplis (50 %, 90 %, 400 Wh/kg)', (await page.inputValue('#en-f-roundTripPct')) === '50' && (await page.inputValue('#en-f-dodPct')) === '90' && (await page.inputValue('#en-f-specificEnergyWhKg')) === '400');
  check('préréglage RFC : masse de stockage différente', (await tileSub(page, 'storage')) !== massLi);
  await page.fill('#en-f-dodPct', '85');
  check('retouche manuelle → « valeurs personnalisées »', /valeurs personnalisées/.test(await page.textContent('.en-preset-custom')));
  await page.click('.en-seg button[data-v="liion"]');
  // Panneau horizontal au pôle : avertissement, et pas de chiffre aberrant
  await page.click('.en-seg button[data-v="horizontal"]');
  check('panneau horizontal à Malapert : avertissement, solaire non chiffré', /panneau vertical orientable produirait environ/.test(await text(page, '.en-results')) && (await tileText(page, 'solar')) === 'non chiffré');
  await noBadNumbers(page, 'expert fr, panneau horizontal');
  await page.click('.en-seg button[data-v="vertical"]');
  // Nuit imposée à la main
  await page.fill('#en-f-nightOverrideH', '100');
  check('nuit imposée de 100 h : 22 kW × 100 h = 2 200 kWh', (await tileText(page, 'night')) === '2 200 kWh', await tileText(page, 'night'));
  check('nuit imposée trop courte : non viable, tracé idéal annoncé', (await page.getAttribute('.en-verdict', 'data-verdict')) === 'notViable' && /Tracé idéal/.test(await text(page, '.en-card[data-block="chart"]')));
  await page.uncheck('#en-override');
  check('nuit du moteur rétablie', (await tileText(page, 'night')) === '9 130 kWh', await tileText(page, 'night'));
  // Période : jour lunaire
  await page.click('.en-seg button[data-v="lunarDay"]');
  await ready(page);
  check('période « jour lunaire » calculée', /Période analysée : du 15 nov\. 2026 au 14 déc\. 2026/.test(await text(page, '.en-period')), await text(page, '.en-period'));
  check('jour lunaire à Malapert : solaire chiffré, sous le plafond', (await page.getAttribute('.en-verdict', 'data-verdict')) === 'ok' && parseNum(await tileText(page, 'solar'), 'fr') < 200, await tileText(page, 'solar'));
  await noBadNumbers(page, 'expert fr, jour lunaire');
  await page.click('.en-seg button[data-v="year"]');
  await ready(page);
  // Formule d'une architecture + méthode
  await page.click('.en-table tr[data-arch="fission"] .en-val');
  check('formule d’architecture au clic, en kWe', /N = ⌈P_pointe \/ P_u⌉ \+ N_secours = ⌈33,0 kW \/ 10 kWe⌉ \+ 1 = 5/.test(await text(page, '.en-formula[data-scope="arch"]')), (await text(page, '.en-formula[data-scope="arch"]')).replace(/\n/g, ' | '));
  await page.click('details[data-block="method"] > summary');
  const method = await text(page, 'details[data-block="method"]');
  check('méthode : bilan explicite (nuit comptée une fois, dichotomie, deux passages, marge)', /La nuit n’est comptée qu’une fois/.test(method) && /cherché par dichotomie/.test(method) && /La période est jouée deux fois/.test(method) && /le rejeu peut l’entamer/.test(method));
  await page.$eval('.en-table', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, '3-fr-expert-architectures');
  await page.$eval('details[data-block="method"]', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, '3-fr-expert-methode');
  await page.click('details[data-block="method"] > summary');

  // ------------------------------------------------------------------ 4. Export
  console.log('4. Export CSV et JSON (solaire chiffré sur la nuit proposée)');
  await page.click('.en-verdict .btn');
  await ready(page);
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('.en-actions .btn:nth-child(2)')]);
  const csv = fs.readFileSync(await csvDl.path(), 'utf8').replace(/\u00a0/g, ' ');
  check('CSV : nom de fichier', csvDl.suggestedFilename() === 'regolith-finder-energie-malapert-test.csv', csvDl.suggestedFilename());
  check('CSV : en-tête, avertissement, site, hypothèses, résultats', /^\ufeffSection,Grandeur,Valeur,Unité,Nature\r\n/.test(csv) && /pas une validation de conception/.test(csv) && /Site,Latitude,-85\.99,°/.test(csv) && /Hypothèses,Équipage,8,personnes,hypothèse/.test(csv) && /Résultats,Puissance moyenne,22,kW/.test(csv) && /Hypothèses,Durée de nuit imposée,590,h,hypothèse/.test(csv), csv.split('\r\n').slice(0, 3).join(' | '));
  check('CSV : unités explicites (kWc pour le solaire, kWe pour les réacteurs)', /Résultats,Solaire crête installé,[\d.]+,kWc,/.test(csv) && /Fission seule — puissance des réacteurs,50,kWe,/.test(csv) && /Hybride — puissance crête des panneaux,[\d.]+,kWc,/.test(csv) && /Hybride — puissance des réacteurs,30,kWe,/.test(csv), (csv.match(/.*kWc.*/g) || []).slice(0, 3).join(' | '));
  check('CSV : nuit réelle et verdicts de rejeu', /Éclairement du site,Plus longue nuit continue,415,h,calculé \(moteur\)/.test(csv) && /La plus longue nuit déborde de la période,Non/.test(csv) && /Solaire \+ stockage — jours de déficit au rejeu,0,jours/.test(csv) && /Hybride — jours de déficit au rejeu,0,jours/.test(csv));
  check('CSV : aucun NaN', !/NaN|undefined|Infinity/.test(csv));
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.click('.en-actions .btn:nth-child(3)')]);
  const json = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8')), jb = json.results.balance;
  check('JSON : site, hypothèses, résultats, architectures avec verdict', json.module === 'energy' && json.site.lat === -85.99 && json.assumptions.crew === 8 && Math.abs(json.results.loads.avgKW - 22) < 1e-9 && json.architectures.length === 3 && json.architectures.every((x) => x.check && x.check.ok === true) && json.period.startUTC === '2026-01-01T00:00:00.000Z' && jb.deficitDays === 0 && json.results.nightIsLowerBound === false);
  check('JSON : conservation de l’énergie du rejeu', Math.abs(jb.possibleKWh - (jb.servedKWh + jb.curtailedKWh + jb.lossesKWh + jb.deltaStoreKWh)) < 1e-6 * jb.possibleKWh);
  check('JSON : stockage requis ≤ installé, champ solaire sous le plafond', jb.requiredCapacityKWh <= json.results.storage.capacityKWh * (1 + 1e-9) && json.results.solar.installedKWp <= json.results.solar.capKWp);

  // ------------------------------------------------------------------ 5. Anglais
  console.log('5. Anglais');
  await page.evaluate(() => window.RF.set({ lang: 'en' }));
  await ready(page);
  check('titre en anglais', (await page.textContent('.modal-title')) === 'Base power sizing');
  check('bandeau en anglais', /Educational pre-sizing, not a design validation/.test(await page.textContent('.en-banner')));
  check('tuiles en anglais, nombres au format anglais', (await tileText(page, 'avg')) === '22.0 kW' && (await tileText(page, 'daily')) === '528 kWh/day' && (await tileText(page, 'night')) === '12,980 kWh' && /kWp$/.test(await tileText(page, 'solar')), `${await tileText(page, 'avg')} / ${await tileText(page, 'daily')} / ${await tileText(page, 'night')} / ${await tileText(page, 'solar')}`);
  const enText = await page.$eval('.modal', (el) => el.innerText);
  check('aucun reste de français dans la fenêtre', !/hypothèse|Équipage|Stockage|calculé|nuit|Soleil visible|Puissance|Lecture|Méthode|déficit|jours|kWc/.test(enText), (enText.match(/.{0,25}(hypothèse|Équipage|Stockage|calculé|nuit|Puissance|Lecture|Méthode|déficit|jours|kWc).{0,25}/) || [''])[0]);
  check('étiquettes « assumption », « computed », « model »', (await page.$$eval('.en-form .tag-hypothesis', (els) => els.every((e) => e.textContent === 'assumption'))) && (await page.$$eval('.en-sitedata .tag-computed', (els) => els.length >= 5 && els.every((e) => e.textContent === 'computed'))) && (await page.$$eval('.en-tile .tag-model', (els) => els.length === 6 && els.every((e) => e.textContent === 'model'))));
  check('lecture du résultat en anglais', /At Malapert \(test\), over the analysis period, the Sun is visible 40% of the time and the longest night lasts 17\.3 d \(415 h\)\. The calculation uses an imposed night of 24\.6 d \(590 h\)\./.test(await text(page, '.en-read')), (await text(page, '.en-read')).slice(0, 220));
  check('I14 en anglais', /Phase 1 studies of the Fission Surface Power project \(2022\) covered a 40 kWe demonstration reactor/.test(await text(page, 'details[data-group="loads"] .en-group-n')));
  await noBadNumbers(page, 'expert en');
  await page.$eval('.modal-body', (el) => { el.scrollTop = 0; });
  await shot(page, '5-en-expert');
  await page.$eval('.en-table', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '5-en-expert-architectures');

  // ------------------------------------------------------------------ 6. Mémorisation et réinitialisation
  console.log('6. Mémorisation (localStorage rf.energy) et réinitialisation');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rf.energy')));
  check('hypothèses mémorisées sous rf.energy', stored && stored.crew === 8 && stored.panelType === 'vertical' && stored.period === 'year' && stored.nightOverride === true && stored.nightOverrideH === 590);
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]', { timeout: 120000 });
  await page.evaluate(({ MALAPERT, T0 }) => { window.RF.set({ lang: 'fr', mode: 'expert', timeMs: T0, selection: MALAPERT }); window.RF.openEnergy(); }, { MALAPERT, T0 });
  await ready(page);
  check('après rechargement : équipage 8 et nuit imposée retrouvés', (await page.$eval('#en-f-crew', (el) => el.value)) === '8' && (await tileText(page, 'avg')) === '22,0 kW' && (await tileText(page, 'night')) === '12 980 kWh');
  await page.click('.en-actions .btn:nth-child(1)');
  await ready(page);
  check('réinitialisation : équipage 4, 16,0 kW, nuit du moteur', (await page.$eval('#en-f-crew', (el) => el.value)) === '4' && (await tileText(page, 'avg')) === '16,0 kW' && (await tileText(page, 'night')) === '6 640 kWh' && !(await page.isChecked('#en-override')));
  check('réinitialisation mémorisée', await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('rf.energy')); return v.crew === 4 && v.nightOverride === false; }));

  // ------------------------------------------------------------------ 7. Cas particuliers de site
  console.log('7. Nuit qui déborde de la période, ombre permanente, changement de site, aucun site, mode daltonien');
  await page.keyboard.press('Escape');
  check('Échap ferme la fenêtre', (await page.$$('.modal')).length === 0);
  // Haworth, jour lunaire du 15/11/2026 : la plus longue nuit commence avant la période
  await page.evaluate((s) => { window.RF.set({ selection: s, mode: 'expert' }); window.RF.openEnergy(); }, HAWORTH);
  await ready(page);
  await page.click('.en-seg button[data-v="lunarDay"]');
  await ready(page);
  const hw = await text(page, '.en-sitedata');
  const realNight = parseNum((hw.match(/Plus longue nuit continue\s+[\d,]+ j \(([\d ]+) h\)/) || ['', ''])[1], 'fr'), inWindow = parseNum((hw.match(/qui n’en contient que [\d,]+ j \(([\d ]+) h\)/) || ['', ''])[1], 'fr');
  check('nuit qui déborde de la période : dite dans l’interface, durée réelle > part dans la période', /Cette nuit déborde de la période analysée/.test(hw) && realNight > inWindow && inWindow > 0, `${realNight} h en tout, ${inWindow} h dans la période`);
  check('stockage dimensionné sur la durée réelle (16 kW × durée réelle), et dit dans la tuile', Math.abs(parseNum(await tileText(page, 'night'), 'fr') - 16 * realNight) <= 16 && /elle déborde de la période/.test(await tileSub(page, 'night')), `${await tileText(page, 'night')} pour ${realNight} h`);
  check('lecture et graphique : la nuit déborde de la période', /dure [\d,]+ j \([\d ]+ h\) en tout et déborde de la période/.test(await text(page, '.en-read')) && /seule la part contenue dans la période est tracée/.test(await text(page, '.en-card[data-block="chart"]')));
  await noBadNumbers(page, 'nuit qui déborde');
  await shot(page, '7-fr-nuit-deborde');
  await page.click('.en-seg button[data-v="year"]');
  await ready(page);
  await page.keyboard.press('Escape');

  await page.evaluate((s) => { window.RF.set({ selection: s, mode: 'simple' }); window.RF.openEnergy(); }, SHACKLETON_FLOOR);
  await ready(page);
  check('ombre permanente : avertissement exact', /Site en ombre permanente sur la période : le solaire seul est impossible\./.test(await text(page, '.en-sitedata [data-warn="noSun"]')));
  check('ombre permanente : solaire non chiffré, fission et hybride (sans panneau) chiffrées', JSON.stringify(await page.$$eval('.en-table tbody tr', (rows) => rows.map((r) => r.dataset.feasible))) === '["0","1","1"]' && /le Soleil n’est jamais visible sur la période/.test(await text(page, '.en-table tr[data-arch="solar"]')) && /\+ 0 kWc/.test(await text(page, '.en-table tr[data-arch="hybrid"]')));
  check('I13 : durée et stockage donnés comme minorants (≥), note « aucune fin de nuit trouvée »', /^≥/.test(await tileText(page, 'night')) && /^≥/.test(await tileText(page, 'storage')) && /^nuit d’au moins .* : aucune fin trouvée$/.test(await tileSub(page, 'night')) && /≥ [\d ,]+ j \([\d ]+ h\)/.test(await text(page, '.en-sitedata')) && /Aucune fin de nuit trouvée dans les 400 jours explorés : cette durée est un minorant/.test(await text(page, '.en-sitedata')), `${await tileText(page, 'night')} / ${await tileText(page, 'storage')}`);
  const read13 = await text(page, '.en-read');
  check('I13 : la lecture dit « au moins », jamais « il faut installer »', /la nuit dure au moins/.test(read13) && /minorants, pas un besoin chiffré : au moins [\d ,]+ MWh à fournir, donc au moins [\d ,]+ MWh de stockage/.test(read13) && !/il faut installer/.test(read13), read13.slice(0, 400));
  const [csvDl2] = await Promise.all([page.waitForEvent('download'), page.click('.en-actions .btn:nth-child(2)')]);
  const csv2 = fs.readFileSync(await csvDl2.path(), 'utf8').replace(/\u00a0/g, ' ');
  check('I13 : le CSV marque les minorants et ajoute la ligne', /Aucune fin de nuit trouvée en 400 jours \(durée = minorant\),Oui,/.test(csv2) && /Résultats,Stockage installé,[\d.]+,kWh,minorant \(au moins\) : aucune fin de nuit trouvée/.test(csv2) && /Résultats,Énergie pour la plus longue nuit,[\d.]+,kWh,minorant \(au moins\)/.test(csv2) && /Résultats,Solaire \+ stockage chiffré,Non \(le Soleil n’est jamais visible sur la période\)/.test(csv2), (csv2.match(/.*minorant.*/g) || []).slice(0, 2).join(' | '));
  await noBadNumbers(page, 'ombre permanente');
  await shot(page, '7-fr-ombre-permanente');
  // Choisir un autre site dans la liste (région candidate Artemis ou site historique)
  const options = await page.$$eval('#en-site option', (els) => els.map((e) => e.value));
  check('liste des sites : sélection en cours + sites connus', options[0] === 'test-floor' && options.length > 10, `${options.length} options`);
  await page.selectOption('#en-site', 'apollo11');
  await ready(page);
  const apollo = await text(page, '.en-sitedata');
  check('Apollo 11 (hors grille polaire) : nuit ≈ 354 h et note « horizon sans relief »', /14,8 j \(354 h\)/.test(apollo) && /Horizon calculé sans relief/.test(apollo), apollo.replace(/\n/g, ' | '));
  check('Apollo 11 : cycle régulier, solaire chiffré sans bouton, aucun déficit', (await page.getAttribute('.en-verdict', 'data-verdict')) === 'ok' && (await page.$$('.en-verdict .btn')).length === 0 && JSON.stringify(await page.$$eval('.en-table tbody tr', (rows) => rows.map((r) => r.dataset.feasible))) === '["1","1","1"]');
  await noBadNumbers(page, 'Apollo 11');
  await page.keyboard.press('Escape');
  // Aucun site
  await page.evaluate(() => { window.RF.set({ selection: null }); window.RF.openEnergy(); });
  await ready(page);
  check('aucun site : message clair, besoins et fission chiffrés, pas de stockage inventé', /Aucun site sélectionné/.test(await text(page, '.en-results [data-state="nosite"]')) && (await tileText(page, 'avg')) === '16,0 kW' && (await tileText(page, 'storage')) === 'non chiffré' && await page.$eval('.en-table tr[data-arch="fission"]', (r) => r.dataset.feasible === '1' && r.querySelector('[data-check]').dataset.check === 'none'));
  check('aucun site : « seule architecture chiffrée ici »', /✓ seule architecture chiffrée ici/.test(await text(page, '.en-table tr[data-arch="fission"]')));
  await shot(page, '7-fr-aucun-site');
  await page.keyboard.press('Escape');
  // Appel avec un lieu en argument + mode daltonien
  await page.evaluate((s) => { window.RF.set({ cvd: 'deuteranopia', mode: 'expert' }); window.RF.openEnergy(s); }, MALAPERT);
  await ready(page);
  check('openEnergy(selection) : lieu passé en argument', /85,99°/.test(await page.textContent('.en-coords')));
  await page.click('.en-verdict .btn');
  await ready(page);
  const strokes = await page.$$eval('.en-card[data-block="chart"] svg.chart-line path[fill="none"]', (els) => els.map((e) => `${e.getAttribute('stroke')}|${e.getAttribute('stroke-dasharray') || ''}`));
  check('mode daltonien : palette sûre + traits distincts (plein / tirets)', strokes.length === 2 && strokes[0] === '#0072B2|' && strokes[1] === '#E69F00|6 4', strokes.join(' ; '));
  await page.$eval('.en-card[data-block="chart"]', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '7-fr-daltonien-graphique');
  check('bureau : aucune erreur console ni réseau', real(desk.problems).length === 0, real(desk.problems).slice(0, 5).join(' ; '));
  await desk.browser.close();

  // ------------------------------------------------------------------ 8. Mobile
  console.log('8. Mobile 390×844, français puis anglais');
  const mob = await openPage(url, { width: 390, height: 844 });
  const m = mob.page;
  await open(m, MALAPERT);
  await shot(m, '8-mobile-fr-simple-haut');
  const overflowOf = () => m.evaluate(() => { const b = document.querySelector('.modal-body'); return { body: b.scrollWidth - b.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth, wide: [...document.querySelectorAll('.modal-body *')].filter((e) => !e.closest('.en-table-wrap') && e.getBoundingClientRect().right > window.innerWidth + 1).length }; });
  check('mobile : une seule colonne', (await m.$eval('.en-grid', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 1);
  let overflow = await overflowOf();
  check('mobile, non viable : pas de débordement horizontal', overflow.body <= 1 && overflow.doc <= 1 && overflow.wide === 0, JSON.stringify(overflow));
  check('mobile : 4 tuiles sur 2 colonnes', (await m.$eval('.en-tiles', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 2 && (await m.$$('.en-tile')).length === 4);
  await m.$eval('.en-verdict', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(m, '8-mobile-fr-simple-non-viable');
  await m.click('.en-verdict .btn');
  await ready(m);
  overflow = await overflowOf();
  check('mobile, nuit imposée : pas de débordement horizontal', overflow.body <= 1 && overflow.doc <= 1 && overflow.wide === 0, JSON.stringify(overflow));
  await m.$eval('.en-tiles', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(m, '8-mobile-fr-simple-resultats');
  await m.$eval('.en-arch', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(m, '8-mobile-fr-simple-architectures');
  check('mobile : tableau lisible sans défilement latéral', await m.$eval('.en-table-wrap', (el) => el.scrollWidth - el.clientWidth <= 1), String(await m.$eval('.en-table-wrap', (el) => el.scrollWidth - el.clientWidth)));
  await setRange(m, 'crew', 12);
  check('mobile : équipage 12 → 28,0 kW', (await tileText(m, 'avg')) === '28,0 kW', await tileText(m, 'avg'));
  await m.evaluate(() => window.RF.set({ mode: 'expert', lang: 'en' }));
  await ready(m);
  check('mobile, expert, anglais : 6 tuiles, 22 champs', (await m.$$('.en-tile')).length === 6 && (await m.$$('.en-form input[type="number"]')).length === 22);
  overflow = await overflowOf();
  check('mobile, expert, anglais : pas de débordement horizontal', overflow.body <= 1 && overflow.wide === 0, JSON.stringify(overflow));
  await noBadNumbers(m, 'mobile expert en');
  await m.$eval('.modal-body', (el) => { el.scrollTop = 0; });
  await shot(m, '8-mobile-en-expert-haut');
  await m.$eval('details[data-group="loads"]', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(m, '8-mobile-en-expert-postes');
  await m.$eval('.en-tiles', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(m, '8-mobile-en-expert-tuiles');
  await m.$eval('.en-card[data-block="chart"]', (el) => el.scrollIntoView({ block: 'start' }));
  await shot(m, '8-mobile-en-expert-graphique');
  check('mobile : aucune erreur console ni réseau', real(mob.problems).length === 0, real(mob.problems).slice(0, 5).join(' ; '));
  await mob.browser.close();

  // ------------------------------------------------------------------ 9. Relief absent
  console.log('9. Relief LOLA non chargé (?nodem=1) : état dégradé propre');
  const bare = await openPage(url + '?nodem=1', { width: 1440, height: 900 });
  await open(bare.page, MALAPERT, { mode: 'expert' });
  check('sans relief : calcul fait sur l’horizon lisse, et dit', /Horizon calculé sans relief/.test(await text(bare.page, '.en-sitedata')) && (await tileText(bare.page, 'avg')) === '16,0 kW');
  await noBadNumbers(bare.page, 'sans relief');
  check('sans relief : aucune erreur console ni réseau', bare.problems.length === 0, bare.problems.slice(0, 5).join(' ; '));
  await bare.browser.close();
} finally {
  srv.close();
}
console.log(failures ? `\n${failures} contrôle(s) en échec` : '\nTous les contrôles passent. Captures : tests/.out/energy-*.png');
process.exit(failures ? 1 : 0);
