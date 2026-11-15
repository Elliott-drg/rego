// Test navigateur des outils annexes (import, mesure, fenêtres, visite guidée, démonstration).
// Monte les modules dans tests/pages/tools.html, puis les vérifie dans l'application réelle servie par server.mjs
// (visite guidée en 1440, 1300 et 390 px, démonstration sur un cycle complet). Captures : tests/.out/tools-*.png.
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/tools.browser.mjs
import baseAssert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, openPage, OUT } from './browser.mjs';

// Chaque appel à assert.* compte pour un contrôle (le total est affiché en fin de test).
let checks = 0;
// Un contrôle sans message qui échoue indique sa ligne (le message automatique de Node ne voit que cet intermédiaire).
const assert = new Proxy(baseAssert, {
  get: (target, key) => (typeof target[key] !== 'function' ? target[key] : (...args) => {
    checks++;
    try { return target[key](...args); } catch (e) {
      if (e.generatedMessage && key === 'ok') e.message = `contrôle en échec à la ligne ${new Error().stack.split('\n')[2]?.match(/:(\d+):\d+\)?$/)?.[1] ?? '?'}`;
      throw e;
    }
  }),
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const fx = (name) => path.join(HERE, 'fixtures', name);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `tools-${name}.png`), timeout: 60000 });   // rendu logiciel : une capture pendant la lecture du temps peut être lente
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Texte affiché d'une zone ; les espaces insécables (avant les unités, dans les nombres) deviennent des espaces simples. */
const text = async (page, selector) => (await page.innerText(selector)).replace(/[  ]/g, ' ');
/** « 15,16 km » ou “1,737.4 km” -> nombre (selon la langue). */
const parseNum = (text, lang = 'fr') => {
  const s = text.replace(/[\s  ]/g, '').match(/[−+-]?[\d.,]+/)[0].replace('−', '-');
  return Number(lang === 'fr' ? s.replace(',', '.') : s.replace(/,/g, ''));
};

// Chromium signale parfois « ERR_ABORTED » pour le relief (29 Mo, lu en flux par registry.js) alors que le fichier
// est arrivé en entier : open() vérifie que le relief est bien chargé, puis cette fausse alerte est écartée.
const HARMLESS = /requestfailed: \S+sp_dem_240m\.i16 net::ERR_ABORTED$/;
const real = (problems) => problems.filter((p) => !HARMLESS.test(p));

const server = await serveStatic(REPO);
const url = server.url + 'tests/pages/tools.html';
const results = [];
let failed = 0, current = null;   // contexte en cours : page (pour refermer une fenêtre après un échec) et problèmes relevés
async function step(name, fn) {
  const before = current ? current.problems.length : 0;
  try { await fn(); results.push(`ok     ${name}`); }
  catch (e) {
    failed++; results.push(`ÉCHEC  ${name}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`);
    for (let i = 0; i < 2; i++) await current?.page.keyboard.press('Escape').catch(() => {});
    await current?.page.evaluate(() => (window.T || window.RF).set({ lang: 'fr' })).catch(() => {});   // l'étape suivante repart en français
  }
  // Chaque erreur console ou réseau est rattachée à l'étape pendant laquelle elle est apparue.
  if (current) for (let i = before; i < current.problems.length; i++) current.problems[i] = `[${name}] ${current.problems[i]}`;
}

async function open(width, height) {
  const ctx = await openPage(url, { width, height });
  ctx.page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[i18n]')) ctx.problems.push('i18n: ' + m.text()); });
  await ctx.page.waitForSelector('body[data-ready="1"]', { timeout: 90000 });
  ctx.page.setDefaultTimeout(10000);
  current = ctx;
  assert.ok(await ctx.page.evaluate(async () => (await import('/public/js/science/terrain.js')).hasDem()), 'relief LOLA chargé');
  await ctx.page.evaluate(() => T.set({ lang: 'fr' }));
  return ctx;
}
const state = (page, expr) => page.evaluate(`(() => { const s = T.state; return ${expr}; })()`);
/** Texte d'une zone, en vérifiant qu'aucune valeur brute n'y traîne ([object …], undefined, NaN, clé de traduction). */
async function cleanText(page, selector) {
  const content = await text(page, selector);
  const raw = content.match(/\[object|undefined|NaN|\btools\.[a-z]+\./);
  assert.equal(raw, null, `valeur brute « ${raw?.[0]} » dans ${selector}`);
  return content;
}
async function chooseFile(page, file) {
  if (!(await page.$('.imp-file'))) await page.click('.imp-draft .btn-ghost');   // un brouillon est ouvert : on l'annule
  await page.setInputFiles('.imp-file', file);
  await page.waitForSelector('.imp-draft');
}

// =================================================================== 1440 × 900
{
  const { browser, page, problems } = await open(1440, 900);

  await step('import : fenêtre, formats annoncés, encart « non pris en charge »', async () => {
    await page.click('#b-import');
    await page.waitForSelector('[data-modal="importer"]');
    const text = await cleanText(page, '[data-modal="importer"]');
    for (const s of ['Importer des données', 'GeoJSON', 'CSV / TSV', 'Non pris en charge dans cette version', 'GeoTIFF', 'NetCDF', 'HDF5', 'FITS', 'OBJ/MTL', 'GLB/GLTF', 'STL', 'Aucun jeu importé']) assert.ok(text.includes(s), `texte attendu : ${s}`);
    assert.equal(await page.getAttribute('.imp-file', 'accept'), '.geojson,.json,.csv,.tsv,.txt');
    await shot(page, 'import-vide-1440');
  });

  await step('import GeoJSON : résumé, nom, couleur, ajout à l’état en [lat, lon]', async () => {
    await chooseFile(page, fx('points.geojson'));
    const sum = await text(page, '.imp-summary');
    assert.match(sum, /3 \(3 points\)/); assert.ok(sum.includes('-89,450°') && sum.includes('-83,660°'), sum);
    assert.ok(sum.includes('ne déclare pas de référentiel'), 'avertissement référentiel supposé');
    await page.fill('.imp-naming input[type="text"]', 'Points GeoJSON');
    await page.click('.imp-color[aria-label="Bleu"]');
    assert.equal(await page.getAttribute('.imp-color[aria-label="Bleu"]', 'aria-checked'), 'true');
    assert.equal(await page.inputValue('.imp-naming input[type="text"]'), 'Points GeoJSON');   // le nom saisi survit au choix de couleur
    await shot(page, 'import-geojson-1440');
    await page.click('.imp-actions .btn-primary');
    const ds = await state(page, 's.imports[0]');
    assert.equal(ds.name, 'Points GeoJSON'); assert.equal(ds.color, '#0072B2'); assert.equal(ds.features.length, 3);
    assert.deepEqual(ds.features[0].coords, [[-89.45, -137.3]]);
    assert.ok(Math.abs(ds.features[1].coords[0][1] + 68.7) < 1e-9, 'longitude 291,3 ramenée à −68,7');
    assert.ok((await text(page, '.imp-list')).includes('3 entités'));
  });

  await step('import CSV « ; » : aperçu, colonnes détectées, lignes invalides listées', async () => {
    await chooseFile(page, fx('sites-semicolon.csv'));
    const draft = await cleanText(page, '.imp-draft');
    assert.ok(draft.includes('Séparateur détecté : point-virgule') && draft.includes('Virgule décimale acceptée'), draft.slice(0, 200));
    assert.equal(await page.inputValue('select[data-col="lat"]'), '1'); assert.equal(await page.inputValue('select[data-col="lon"]'), '2'); assert.equal(await page.inputValue('select[data-col="name"]'), '0');
    assert.equal(await page.locator('.imp-preview tbody tr').count(), 7);
    const sum = await text(page, '.imp-summary');
    assert.match(sum, /Entités lues\s*3 \(3 points\)/); assert.match(sum, /hors de la Lune\s*2/); assert.match(sum, /Lignes invalides\s*2/);
    const rej = await text(page, '.imp-rejected');
    assert.ok(rej.includes('ligne 4') && rej.includes('latitude illisible') && rej.includes('ligne 7') && rej.includes('ligne trop courte'), rej);
    await shot(page, 'import-csv-1440');
    await page.click('.imp-actions .btn-primary');
    assert.deepEqual(await state(page, 's.imports[1].features.map((f) => f.coords[0])'), [[-89.45, -137.3], [-84.6, 31], [-88.5, -0.5]]);
    assert.equal(await state(page, 's.imports[1].features[0].name'), 'Crête');
  });

  await step('import CSV sans en-tête : rien n’est ajouté tant que les colonnes ne sont pas choisies', async () => {
    await chooseFile(page, fx('no-header.csv'));
    assert.ok((await text(page, '.imp-draft')).includes('pas de ligne d’en-tête'));
    assert.equal(await page.isDisabled('.imp-actions .btn-primary'), true);
    assert.equal(await page.$('.imp-summary'), null);
    await page.selectOption('select[data-col="lat"]', '0');
    await page.selectOption('select[data-col="lon"]', '0');
    assert.ok((await text(page, '.imp-draft')).includes('deux colonnes différentes'));
    await page.selectOption('select[data-col="lon"]', '1');
    assert.match(await text(page, '.imp-summary'), /3 \(3 points\)/);
    await page.click('.imp-actions .btn-ghost');
    assert.equal(await state(page, 's.imports.length'), 2);
  });

  await step('import : colonnes x/y non choisies automatiquement', async () => {
    await chooseFile(page, fx('xy.csv'));
    assert.ok((await text(page, '.imp-draft')).includes('s’appellent x et y'));
    assert.equal(await page.inputValue('select[data-col="lat"]'), '-1');
    assert.equal(await page.isDisabled('.imp-actions .btn-primary'), true);
  });

  await step('import : CRS projeté REFUSÉ avec message clair, format binaire refusé', async () => {
    await chooseFile(page, fx('crs-projected.geojson'));
    const err = await text(page, '.imp-error');
    assert.ok(err.includes('Fichier refusé') && err.includes('urn:ogc:def:crs:IAU:2015:30135') && err.includes('projection en mètres'), err);
    assert.equal(await page.$('.imp-actions .btn-primary'), null, 'aucun bouton d’ajout pour un fichier refusé');
    await shot(page, 'import-crs-refuse-1440');
    await chooseFile(page, { name: 'dem.tif', mimeType: 'image/tiff', buffer: Buffer.from([0x49, 0x49, 0x2a, 0]) });
    assert.ok((await text(page, '.imp-error')).includes('« .tif » n’est pas pris en charge'));
    await chooseFile(page, fx('empty.csv'));
    assert.ok((await text(page, '.imp-error')).includes('Le fichier est vide'));
    await page.click('.imp-draft .btn-ghost');
    assert.equal(await state(page, 's.imports.length'), 2);
  });

  await step('import : glisser-déposer', async () => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['{"type":"Feature","properties":{"name":"Déposé"},"geometry":{"type":"LineString","coordinates":[[0,-89],[0,-88]]}}'], 'depose.geojson', { type: 'application/geo+json' }));
      document.querySelector('.imp-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForSelector('.imp-summary');
    assert.match(await text(page, '.imp-summary'), /1 \(1 ligne\)/);
    await page.click('.imp-actions .btn-primary');
    assert.equal(await state(page, 's.imports[2].features[0].type'), 'line');
  });

  await step('import : mémorisation locale, plafond de 2 Mo signalé, rechargement', async () => {
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rf.imports')));
    assert.deepEqual(stored.map((d) => d.name), ['Points GeoJSON', 'sites-semicolon', 'depose']);
    await page.evaluate(() => T.set({ imports: [...T.state.imports, { id: 'gros', name: 'Jeu trop volumineux', color: '#E69F00', features: Array.from({ length: 70000 }, (_, i) => ({ type: 'point', coords: [[-80 - (i % 900) / 100, (i % 3600) / 10 - 180]] })) }] }));
    assert.ok((await text(page, '.imp-set[data-id="gros"]')).includes('non mémorisé'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rf.imports')).length), 3);
    assert.ok((await page.evaluate(() => localStorage.getItem('rf.imports').length)) < 2_000_000);
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]', { timeout: 90000 });
    await page.evaluate(() => T.set({ lang: 'fr' }));
    assert.deepEqual(await state(page, 's.imports.map((d) => d.name)'), ['Points GeoJSON', 'sites-semicolon', 'depose']);
  });

  await step('import : centrer, exporter en GeoJSON, supprimer', async () => {
    await page.click('#b-import');
    await page.click('.imp-set:nth-child(2) [aria-label="Centrer la vue sur ce jeu"]');
    assert.equal(await page.$('[data-modal="importer"]'), null, 'la fenêtre se ferme pour montrer la carte');
    const fly = await page.evaluate(() => T.flyTo.at(-1));
    assert.ok(Math.abs(fly.lat + 87.9) < 0.3 && fly.lon > 0 && fly.lon < 45, JSON.stringify(fly));   // direction moyenne des 3 points
    await page.click('#b-import');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.imp-set:nth-child(1) [aria-label="Exporter en GeoJSON"]')]);
    assert.equal(dl.suggestedFilename(), 'Points_GeoJSON.geojson');
    const gj = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepEqual(gj.features[0].geometry, { type: 'Point', coordinates: [-137.3, -89.45] });
    await page.click('.imp-set:nth-child(3) [aria-label="Supprimer ce jeu"]');
    assert.equal(await state(page, 's.imports.length'), 2);
    assert.equal(await page.locator('.imp-set').count(), 2);
    await shot(page, 'import-liste-1440');
    await page.keyboard.press('Escape');
  });

  await step('mesure : 3 points, distances égales aux valeurs calculées à la main, profil, méthode', async () => {
    assert.equal(await page.isVisible('.measure'), false);
    await page.evaluate(() => T.set({ tool: 'measure', measure: [] }));
    assert.ok((await text(page, '.measure')).includes('Cliquez sur la carte'));
    await page.evaluate(() => T.set({ measure: [{ lat: -89, lon: 0 }] }));
    assert.ok((await text(page, '.measure')).includes('Posez un second point'));
    await page.evaluate(() => T.set({ measure: [{ lat: -89, lon: 0 }, { lat: -88.5, lon: 0 }, { lat: -88.5, lon: 90 }] }));
    // À la main : 0,5° de méridien = 0,5 × 1 737 400 × π/180 = 15 161,7 m ; second segment : acos(sin²(88,5°)) = 0,037022 rad, × R = 64 322 m.
    const rows = await page.locator('.measure-segs tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText)));
    assert.equal(rows.length, 2);
    assert.ok(Math.abs(parseNum(rows[0][1]) - 15.16) < 0.006, rows[0][1]);
    const seg2 = Math.acos(Math.sin(88.5 * Math.PI / 180) ** 2) * 1737.4;
    assert.ok(Math.abs(seg2 - 64.322) < 0.001, `calcul de contrôle ${seg2}`);
    assert.ok(Math.abs(parseNum(rows[1][1]) - seg2) < 0.006, rows[1][1]);
    const stats = await page.locator('.measure-totals .stat').evaluateAll((els) => els.map((e) => e.innerText));
    assert.ok(stats[0].startsWith('Distance de surface') && Math.abs(parseNum(stats[0].split('\n')[1]) - (15.1617 + seg2)) < 0.006, stats[0]);
    assert.ok(/\d/.test(stats[1]) && /[+−]\d/.test(stats[2].replace(/\s/g, '')) && /°\s*\/\s*[\d,]+°/.test(stats[3]), stats.join(' | '));
    // La corde 3D d'un segment vaut au moins son dénivelé et reste proche de la distance de surface.
    assert.ok(parseNum(rows[0][2]) >= Math.abs(parseNum(rows[0][3])) / 1000 && Math.abs(parseNum(rows[0][2]) - 15.16) < 1, rows[0].join(' | '));
    assert.equal(await page.locator('.measure-chart svg path').count() >= 2, true);
    const method = await text(page, '.measure-method');
    assert.ok(method.startsWith('Méthode :') && method.includes('1 737,4 km') && method.includes('240 m par pixel') && /tous les 2\d\d m/.test(method), method);
    await shot(page, 'mesure-1440');
  });

  await step('mesure : annuler, hors grille polaire, export CSV, repli, déplacement, fermeture', async () => {
    await page.click('.measure-actions button:nth-child(1)');
    assert.equal(await state(page, 's.measure.length'), 2);
    assert.equal(await page.$('.measure-segs'), null, 'un seul segment : pas de tableau par segment');
    await page.evaluate(() => T.set({ measure: [...T.state.measure, { lat: -60, lon: 0 }] }));
    const txt = await cleanText(page, '.measure');
    assert.ok(txt.includes('hors de la grille polaire') && txt.includes('INDISPONIBLE'), txt.slice(0, 400));
    assert.ok((await text(page, '.measure-totals .stat:nth-child(1)')).includes('km'));
    assert.ok((await text(page, '.measure-totals .stat:nth-child(2)')).includes('—'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.measure-actions button:nth-child(3)')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
    assert.equal(csv[0], 'segment,distance_m,latitude_deg,longitude_deg,height_m'); assert.ok(csv.length > 60); assert.match(csv[1], /^1,0\.0,-89\.000000,0\.000000,-?\d+\.\d$/); assert.match(csv.at(-1), /,-60\.000000,0\.000000,$/);
    await page.click('.measure-head [aria-expanded]');
    assert.equal(await page.isVisible('.measure-body'), false);
    await page.click('.measure-head [aria-expanded]');
    const before = await page.locator('.measure').boundingBox();
    await page.mouse.move(before.x + 120, before.y + 18); await page.mouse.down(); await page.mouse.move(before.x - 180, before.y + 140, { steps: 5 }); await page.mouse.up();
    const after = await page.locator('.measure').boundingBox();
    assert.ok(Math.abs(after.x - (before.x - 300)) < 3 && Math.abs(after.y - (before.y + 122)) < 3, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    await page.click('.measure-actions button:nth-child(2)');
    assert.equal(await state(page, 's.measure.length'), 0);
    await page.click('.measure-head [aria-label="Fermer"]');
    assert.equal(await state(page, 's.tool'), null); assert.equal(await page.isVisible('.measure'), false);
  });

  await step('mesure en anglais', async () => {
    await page.evaluate(() => T.set({ lang: 'en', tool: 'measure', measure: [{ lat: -89, lon: 0 }, { lat: -88.5, lon: 0 }, { lat: -88.5, lon: 90 }] }));
    const txt = (await cleanText(page, '.measure')).toLowerCase();
    for (const s of ['surface distance', '3d distance', 'height difference', 'method:', '1,737.4 km', 'elevation profile', 'undo last point']) assert.ok(txt.includes(s), s);
    assert.ok(Math.abs(parseNum(await text(page, '.measure-segs tbody tr:first-child td:nth-child(2)'), 'en') - 15.16) < 0.006);
    await shot(page, 'mesure-en-1440');
    await page.evaluate(() => T.set({ lang: 'fr', tool: null, measure: [] }));
  });

  await step('historique : 12 missions datées, FR puis EN, clic = sélection du site', async () => {
    await page.click('#b-history');
    await page.waitForSelector('[data-modal="history"]');
    assert.equal(await page.locator('.hist-item').count(), 12);
    const first = await text(page, '.hist-item:first-child');
    assert.ok(first.includes('20 juil. 1969') && first.includes('Apollo 11') && first.includes('NASA') && first.includes('vol habité') && first.includes('Premier alunissage habité'), first);
    assert.ok((await text(page, '.hist-item:last-child')).includes('6 mars 2025'));
    await shot(page, 'historique-fr-1440');
    await page.evaluate(() => T.set({ lang: 'en' }));   // la fenêtre ouverte est redessinée dans la nouvelle langue
    const en = await cleanText(page, '[data-modal="history"]');
    assert.ok(en.includes('Moon landing history') && en.includes('20 Jul 1969') && en.includes('First crewed Moon landing') && en.includes('crewed flight'), en.slice(0, 300));
    await shot(page, 'historique-en-1440');
    await page.click('.hist-card[data-site="im1"]');
    assert.equal(await page.$('[data-modal="history"]'), null);
    assert.deepEqual(await state(page, '[s.selection.key, s.selection.kind]'), ['im1', 'mission']);
    assert.deepEqual(await page.evaluate(() => T.flyTo.at(-1)), { lat: -80.13, lon: 1.44 });
    await page.evaluate(() => T.set({ lang: 'fr' }));
  });

  await step('à propos : projet, équipe, indépendance, crédits lus dans le manifeste et LICENSES.md, FR puis EN', async () => {
    await page.click('#b-about');
    await page.waitForSelector('[data-modal="founders"]');
    await page.waitForFunction(() => document.querySelector('.about-libs')?.innerText.includes('0.170.0'));
    const fr = await cleanText(page, '[data-modal="founders"]');
    for (const s of ['Nathanael DURAND', 'Damien NIOCHE', 'non affilié à la NASA', 'défi proposé par la NASA', 'three', 'astronomy-engine', '2.1.19', 'MIT', 'Barlow', 'Topographie LOLA du pôle Sud', 'UCLA, équipe Diviner']) assert.ok(fr.includes(s), `texte attendu : ${s}`);
    assert.ok(!fr.includes('propriétaire du projet'), 'les éléments graphiques ne sont pas listés comme données');
    assert.ok(await page.evaluate(() => { const i = document.querySelector('.about-logo'); return i && i.complete && i.naturalWidth > 0; }), 'logo chargé');
    await shot(page, 'apropos-fr-1440');
    await page.evaluate(() => T.set({ lang: 'en' }));
    const en = await cleanText(page, '[data-modal="founders"]');
    for (const s of ['About Regolith Finder', 'not affiliated with NASA', 'Nathanael DURAND', 'NASA GSFC — LOLA team', 'Horizons system', '0.170.0']) assert.ok(en.includes(s), `expected text: ${s}`);
    await shot(page, 'apropos-en-1440');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('[data-modal="founders"]'), null);
    await page.evaluate(() => T.set({ lang: 'fr' }));
  });

  await step('visite guidée : 8 étapes au clavier, zones mises en évidence, « déjà vu » mémorisé', async () => {
    assert.equal(await page.evaluate(() => T.modals.tutorialSeen()), false);
    await page.click('#b-tutorial');
    await page.waitForSelector('.tour-card');
    const card = async () => (await text(page, '.tour-card')).toLowerCase();   // l'intitulé d'étape est affiché en capitales
    assert.ok((await card()).includes('étape 1 sur 8') && (await card()).includes('bienvenue'));
    assert.equal(await page.isVisible('.tour-spot'), false);
    const expected = ['#left .sitelist', '#right', '#timebar', '#left details.col', '.viewswitch', '#left .toolgrid', '#header'];
    for (let i = 0; i < expected.length; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(260);
      assert.ok((await card()).includes(`étape ${i + 2} sur 8`), await card());
      const boxes = await page.evaluate((sel) => { const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }; return { spot: r(document.querySelector('.tour-spot')), target: r(document.querySelector(sel)), card: r(document.querySelector('.tour-card')), w: innerWidth, h: innerHeight }; }, expected[i]);
      for (let k = 0; k < 4; k++) assert.ok(Math.abs(boxes.spot[k] - boxes.target[k]) <= 6, `étape ${i + 2} : zone ${expected[i]} ${JSON.stringify(boxes)}`);
      assert.ok(boxes.card[0] >= 0 && boxes.card[1] >= 0 && boxes.card[2] <= boxes.w && boxes.card[3] <= boxes.h, `carte hors écran à l’étape ${i + 2}`);
      // la carte d'explication ne recouvre pas la zone qu'elle désigne
      const overlap = Math.max(0, Math.min(boxes.card[2], boxes.spot[2]) - Math.max(boxes.card[0], boxes.spot[0])) * Math.max(0, Math.min(boxes.card[3], boxes.spot[3]) - Math.max(boxes.card[1], boxes.spot[1]));
      assert.equal(overlap, 0, `la carte recouvre la zone à l’étape ${i + 2}`);
      if (i === 1) await shot(page, 'tutoriel-fr-1440');
    }
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    assert.ok((await card()).includes('étape 6 sur 8'));
    await page.evaluate(() => T.set({ lang: 'en' }));
    assert.ok((await card()).includes('step 6 of 8') && (await card()).includes('compare'));
    await shot(page, 'tutoriel-en-1440');
    await page.evaluate(() => T.set({ lang: 'fr' }));
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.tour'), null);
    assert.equal(await page.evaluate(() => T.modals.tutorialSeen()), true);
    // boutons : Suivant jusqu'à Terminer
    await page.click('#b-tutorial');
    for (let i = 0; i < 7; i++) await page.click('.tour-actions .btn-primary');
    assert.equal(await text(page, '.tour-actions .btn-primary'), 'Terminer');
    await page.click('.tour-actions .btn-primary');
    assert.equal(await page.$('.tour'), null);
  });

  await step('démonstration : démarre, enchaîne, s’arrête au clic et rend l’état d’avant', async () => {
    await page.evaluate(() => { T.layers.toggle('elevation', true); T.set({ speed: 1000, timeMs: Date.UTC(2027, 0, 1), compare: [], view: 'map2d' }); T.flyTo.length = 0; });
    await page.click('#b-demo');
    await page.waitForSelector('.demo-banner');
    assert.equal(await state(page, 's.demo'), true);
    await page.waitForFunction(() => document.querySelector('.demo-caption').textContent.includes('1 sur 3'));   // après le chargement des cartes moyennes
    const banner = await text(page, '.demo-banner');
    assert.ok(/MODE DÉMONSTRATION/i.test(banner) && banner.includes('Cliquer pour reprendre la main') && banner.includes('Région 1 sur 3 : Malapert Massif, point de meilleur compromis'), banner);
    // Le lieu sélectionné est le point « meilleur compromis » de la région, pas son centre.
    const sel = await state(page, 's.selection');
    assert.deepEqual([sel.key, sel.kind, sel.siteId, sel.regionId, sel.variant, sel.name], ['malapert_massif:both', 'artemis', 'malapert_massif', 'malapert_massif', 'both', 'Malapert Massif — meilleur compromis']);
    const ref = await page.evaluate(async () => { const e = await import('/public/js/science/engine.js'), d = await import('/public/js/data/sites.js'); const site = d.getSite('malapert_massif'); return { both: e.regionBest(site.corners).both, centre: [site.lat, site.lon] }; });
    assert.deepEqual([sel.lat, sel.lon], [ref.both.lat, ref.both.lon]);
    assert.notDeepEqual([sel.lat, sel.lon], ref.centre);
    assert.equal(await state(page, 's.view'), 'map2d');
    assert.deepEqual(await page.evaluate(() => T.flyTo), [{ lat: sel.lat, lon: sel.lon }]);
    await shot(page, 'demo-1440');
    await sleep(3400);
    assert.deepEqual(await page.evaluate(() => [T.state.playing, T.state.speed, T.layers.isOn('sun_now'), T.layers.isOn('elevation')]), [true, 100000, true, false]);
    assert.ok((await text(page, '.demo-banner')).includes('100 000×'));
    await page.mouse.click(720, 480);
    await page.waitForFunction(() => !T.state.demo);
    assert.equal(await page.$('.demo-banner'), null);
    assert.deepEqual(await page.evaluate(() => [T.state.demo, T.state.playing, T.state.speed, T.state.timeMs, T.layers.isOn('sun_now'), T.layers.isOn('earth_now'), T.layers.isOn('elevation'), T.state.compare.length]),
      [false, false, 1000, Date.UTC(2027, 0, 1), false, false, true, 0]);
    // relance, puis arrêt au clavier ; aucun minuteur ne doit continuer à agir ensuite
    await page.click('#b-demo');
    await page.waitForSelector('.demo-banner');
    await sleep(500);
    await page.keyboard.press('a');
    await page.waitForFunction(() => !T.state.demo);
    await sleep(3600);
    assert.deepEqual(await page.evaluate(() => [T.state.playing, T.layers.isOn('sun_now'), document.querySelector('.demo-banner')]), [false, false, null]);
    // set({demo: true}) suffit à la lancer (le module suit state.demo), la molette l'arrête
    await page.evaluate(() => T.set({ demo: true }));
    await page.waitForSelector('.demo-banner');
    await sleep(500);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => !T.state.demo);
    await page.evaluate(() => T.layers.toggle('elevation', false));
  });

  await step('aucune erreur console, réseau ou clé de traduction manquante (1440)', async () => assert.deepEqual(real(problems), []));
  await browser.close();
}

// =================================================================== 390 × 844
{
  const { browser, page, problems } = await open(390, 844);
  const noOverflow = async (what) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `débordement horizontal : ${what}`);
  const inside = async (sel) => { const b = await page.locator(sel).boundingBox(); assert.ok(b && b.x >= 0 && b.x + b.width <= 390.5 && b.y >= 0 && b.y + b.height <= 844.5, `${sel} hors écran : ${JSON.stringify(b)}`); };

  await step('390 px : import (CSV) lisible, sans débordement', async () => {
    await page.click('#b-import');
    await shot(page, 'import-vide-390');
    await chooseFile(page, fx('sites-semicolon.csv'));
    await inside('[data-modal="importer"]'); await noOverflow('import');
    await shot(page, 'import-csv-390');
    await page.evaluate(() => document.querySelector('.imp-actions').scrollIntoView());
    await shot(page, 'import-csv-bas-390');
    await page.click('.imp-actions .btn-primary');
    assert.equal(await state(page, 's.imports.length'), 1);
    await chooseFile(page, fx('crs-projected.geojson'));
    await shot(page, 'import-crs-refuse-390');
    await page.keyboard.press('Escape');
  });

  await step('390 px : carte de mesure calée en bas, repliable', async () => {
    await page.evaluate(() => T.set({ tool: 'measure', measure: [{ lat: -89, lon: 0 }, { lat: -88.5, lon: 0 }, { lat: -88.5, lon: 90 }] }));
    const box = await page.locator('.measure').boundingBox(), main = await page.locator('#main').boundingBox();
    assert.ok(Math.abs(box.x - 8) < 1 && Math.abs(box.x + box.width - 382) < 1, JSON.stringify(box));
    assert.ok(Math.abs(box.y + box.height - (main.y + main.height - 8)) < 1.5 && box.height <= main.height * 0.56 + 1, `${JSON.stringify(box)} / ${JSON.stringify(main)}`);
    await noOverflow('mesure');
    await shot(page, 'mesure-390');
    await page.click('.measure-head [aria-expanded]');
    assert.ok((await page.locator('.measure').boundingBox()).height < 60);
    await shot(page, 'mesure-repliee-390');
    await page.evaluate(() => T.set({ tool: null, measure: [] }));
  });

  await step('390 px : historique et à propos (FR, EN)', async () => {
    await page.click('#b-history');
    await page.waitForSelector('.hist-item');
    await inside('[data-modal="history"]'); await noOverflow('historique'); await cleanText(page, '[data-modal="history"]');
    await shot(page, 'historique-fr-390');
    await page.keyboard.press('Escape');
    await page.click('#b-about');
    await page.waitForFunction(() => document.querySelector('.about-libs')?.innerText.includes('0.170.0'));
    await inside('[data-modal="founders"]'); await noOverflow('à propos'); await cleanText(page, '[data-modal="founders"]');
    await shot(page, 'apropos-fr-390');
    await page.evaluate(() => { T.set({ lang: 'en' }); document.querySelector('[data-modal="founders"] .modal-body').scrollTop = 420; });
    await shot(page, 'apropos-en-390');
    await page.keyboard.press('Escape');
    await page.evaluate(() => T.set({ lang: 'fr' }));
  });

  await step('390 px : visite guidée, carte toujours à l’écran, étapes centrées quand la zone est masquée', async () => {
    await page.click('#b-tutorial');
    for (let i = 0; i < 8; i++) {
      await sleep(240);
      await inside('.tour-card');
      const spot = await page.isVisible('.tour-spot');
      if (i === 1) assert.equal(spot, false, 'panneau gauche fermé : étape centrée');
      if (i === 3) { assert.equal(spot, true, 'barre de temps visible'); await shot(page, 'tutoriel-fr-390'); }
      if (i === 1) await shot(page, 'tutoriel-centre-390');
      await page.keyboard.press('ArrowRight');
    }
    assert.equal(await page.$('.tour'), null, 'la dernière étape + → termine la visite');
  });

  await step('390 px : bandeau de démonstration, arrêt au toucher', async () => {
    await page.click('#b-demo');
    await page.waitForSelector('.demo-banner');
    await page.waitForFunction(() => document.querySelector('.demo-caption').textContent.includes('1 sur 3'));
    await inside('.demo-banner');
    assert.equal(await state(page, 's.rightOpen'), false, 'la fiche en tiroir ne masque pas la carte');
    await shot(page, 'demo-390');
    await sleep(400);
    await page.mouse.click(200, 400);
    await page.waitForFunction(() => !T.state.demo);
  });

  await step('aucune erreur console, réseau ou clé de traduction manquante (390)', async () => assert.deepEqual(real(problems), []));
  await browser.close();
}

// =================================================================== Dans l'application réelle (public/index.html)
// Servie par le vrai serveur local (server.mjs sur un port libre) : branchement des outils dans la coquille,
// vraie carte, vraie barre de temps. La démonstration y tourne un cycle complet à ses durées normales (≈ 1 min).
async function startApp() {
  const proc = spawn(process.execPath, ['server.mjs', '--port', '0', '--no-open'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const appUrl = await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) resolve(m[0]); });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (code) => reject(new Error(`server.mjs s'est arrêté (code ${code}) : ${out}`)));
    setTimeout(() => reject(new Error(`server.mjs ne donne pas son adresse : ${out}`)), 15000);
  });
  return { appUrl, stop: () => proc.kill() };
}
async function openApp(appUrl, width, height) {
  const ctx = await openPage(appUrl, { width, height });
  ctx.page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[i18n]')) ctx.problems.push('i18n: ' + m.text()); });
  await ctx.page.waitForSelector('body[data-ready="1"]', { timeout: 180000 });
  ctx.page.setDefaultTimeout(10000);
  current = ctx;
  await ctx.page.evaluate(() => RF.set({ lang: 'fr' }));
  return ctx;
}
/** État de la visite guidée : zone mise en évidence comparée à la cible attendue (sélecteur ou libellé d'un bouton de l'en-tête). */
const tourProbe = (page, target) => page.evaluate((tg) => {
  const box = (e) => { const b = e.getBoundingClientRect(); return [Math.max(0, b.left), Math.max(0, b.top), Math.min(innerWidth, b.right), Math.min(innerHeight, b.bottom)]; };
  const spot = document.querySelector('.tour-spot'), card = document.querySelector('.tour-card'), c = card.getBoundingClientRect();
  const el = !tg ? null : tg.label ? [...document.querySelectorAll('#header button')].find((b) => b.getAttribute('aria-label') === tg.label) : document.querySelector(tg.sel);
  const shown = getComputedStyle(spot).display !== 'none';
  const sb = spot.getBoundingClientRect();
  return {
    centered: !shown,
    onTarget: !!el && shown && box(el).every((v, k) => Math.abs(v - [sb.left + 4, sb.top + 4, sb.right - 4, sb.bottom - 4][k]) <= 8),
    cardInside: c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 0.5 && c.bottom <= innerHeight + 0.5,
    hint: card.querySelector('.tour-hint:not([hidden])')?.textContent || '',
    title: card.querySelector('.tour-title').textContent,
  };
}, target);
/** Parcourt les 8 étapes et vérifie chaque cible attendue : [cible|null, début attendu de l'indication|''] par étape. */
async function walkTour(page, expected, shotName) {
  await page.waitForSelector('.tour-card');
  for (let i = 0; i < expected.length; i++) {
    await sleep(280);
    const [target, hint] = expected[i], p = await tourProbe(page, target);
    assert.ok(p.cardInside, `étape ${i + 1} : carte hors écran`);
    if (!target) assert.ok(p.centered, `étape ${i + 1} (${p.title}) : devrait être centrée`);
    else assert.ok(p.onTarget, `étape ${i + 1} (${p.title}) : la zone ${JSON.stringify(target)} n'est pas mise en évidence`);
    assert.ok(hint ? p.hint.startsWith(hint) : p.hint === '', `étape ${i + 1} (${p.title}) : indication « ${p.hint} », attendu « ${hint} »`);
    if (shotName && [1, 6, 7].includes(i)) await shot(page, `${shotName}-${i + 1}`);
    await page.keyboard.press('ArrowRight');
  }
  assert.equal(await page.$('.tour'), null, 'la visite se termine après la dernière étape');
}
const LEFT_BTN = { label: 'Afficher ou masquer les calques' }, RIGHT_BTN = { label: 'Afficher ou masquer la fiche du site' }, GEAR = { label: 'Réglages' };
const HINT_LEFT = 'Le panneau de gauche est fermé', HINT_RIGHT = 'La fiche du site est fermée', HINT_MENU = 'Sur cet écran, cette entrée est rangée dans le menu des réglages';

{
  const app = await startApp();
  // ----------------------------------------------------------------- 1440 × 900
  {
    const { browser, page, problems } = await openApp(app.appUrl, 1440, 900);
    await page.evaluate(() => localStorage.removeItem('rf.imports'));
    const tool = (label) => page.click(`#left .toolgrid button:has-text("${label}")`);

    await step('application : serveur local détecté, « Importer » ajoute un jeu à state.imports', async () => {
      assert.equal(await page.evaluate(() => RF.state.server), true);
      await tool('Importer');
      await page.waitForSelector('[data-modal="importer"]');   // module chargé à la demande par la coquille
      await chooseFile(page, fx('points.geojson'));
      await page.click('.imp-actions .btn-primary');
      assert.equal(await page.evaluate(() => RF.state.imports.length), 1);
      await sleep(600);
      await shot(page, 'app-import-1440');
      await page.keyboard.press('Escape');
    });

    await step('application : au redémarrage, le jeu mémorisé est rechargé sans ouvrir la fenêtre d’import', async () => {
      await page.reload();
      await page.waitForSelector('body[data-ready="1"]', { timeout: 180000 });
      assert.deepEqual(await page.evaluate(() => RF.state.imports.map((d) => [d.name, d.features.length])), [['points', 3]]);
      await page.evaluate(() => RF.set({ lang: 'fr' }));
    });

    await step('application : « Mesurer » affiche la carte de mesure sur la vraie carte', async () => {
      await tool('Mesurer');
      assert.equal(await page.evaluate(() => RF.state.tool), 'measure');
      await page.waitForSelector('.measure:not([hidden])');
      await page.evaluate(() => RF.set({ measure: [{ lat: -89, lon: 0 }, { lat: -88.5, lon: 0 }, { lat: -88.5, lon: 90 }] }));
      assert.ok(Math.abs(parseNum((await text(page, '.measure-totals .stat:first-child')).split('\n')[1]) - 79.48) < 0.006);
      await sleep(800);
      await shot(page, 'app-mesure-1440');
      await page.click('.measure-head [aria-label="Fermer"]');
      assert.equal(await page.evaluate(() => RF.state.tool), null);
    });

    await step('application : « Historique » et « À propos » depuis l’en-tête', async () => {
      await page.click('#header .navpills button:has-text("Historique")');
      await page.waitForSelector('.hist-item');
      const hist = await cleanText(page, '[data-modal="history"]');
      assert.ok(hist.includes('Première mission Apollo à emporter le véhicule lunaire') && hist.includes('pendant la journée lunaire') && hist.includes('Coordonnées : équipe LROC (NASA/ASU) pour la plupart, NSSDCA pour Apollo'), 'textes corrigés de l’historique');
      await page.click('.hist-card[data-site="im2"]');
      assert.equal(await page.evaluate(() => RF.state.selection.key), 'im2');
      await page.click('#header .navpills button:has-text("À propos")');
      await page.waitForSelector('.about-team');
      const about = await cleanText(page, '[data-modal="founders"]');
      assert.ok(about.includes('horizon du relief (LOLA, 240 m)') && !about.includes('horizon réel'), 'vocabulaire « horizon du relief »');
      await page.keyboard.press('Escape');
    });

    await step('application 1440 px : la visite guidée désigne les vraies zones, sans indication de repli', async () => {
      await tool('Tutoriel');
      await page.waitForSelector('.tour-card');
      await page.keyboard.press('ArrowRight');
      const site = await text(page, '.tour-card');
      assert.ok(site.includes('neuf régions candidates publiées par la NASA le 28/10/2024 pour Artemis III (l’alunissage est désormais prévu avec Artemis IV)'), site);
      await page.keyboard.press('ArrowLeft');
      await walkTour(page, [[null, ''], [{ sel: '#left .sitelist' }, ''], [{ sel: '#right' }, ''], [{ sel: '#timebar' }, ''], [{ sel: '#left details.col' }, ''],
        [{ sel: '.viewswitch' }, ''], [{ sel: '#left .toolgrid' }, ''], [{ sel: '#header .navpills' }, '']], 'app-tutoriel-1440');
    });

    await step('application 1300 px : navigation de l’en-tête masquée, l’étape « Horizons » désigne le menu des réglages', async () => {
      await page.setViewportSize({ width: 1300, height: 820 });
      await sleep(400);
      assert.equal(await page.isVisible('#header .navpills'), false);
      await tool('Tutoriel');
      await walkTour(page, [[null, ''], [{ sel: '#left .sitelist' }, ''], [{ sel: '#right' }, ''], [{ sel: '#timebar' }, ''], [{ sel: '#left details.col' }, ''],
        [{ sel: '.viewswitch' }, ''], [{ sel: '#left .toolgrid' }, ''], [GEAR, HINT_MENU]], 'app-tutoriel-1300');
      await page.setViewportSize({ width: 1440, height: 900 });
      await sleep(400);
    });

    await step('application : la démonstration tourne un cycle complet (3 régions, comparaison, retour à la première)', async () => {
      const T0 = Date.UTC(2027, 0, 1);
      await page.evaluate(async (t0) => {
        const st = await import('/js/core/store.js'), { layers } = await import('/js/layers/manager.js'), sites = await import('/js/data/sites.js');
        layers.toggle('elevation', true);
        st.set({ view: 'map2d', speed: 1000, playing: false, timeMs: t0, compare: [], selection: null });
        st.addToCompare(sites.siteSelection(sites.getSite('slater_plain')));
        const log = window.demoLog = [];
        const add = (type, v) => log.push({ type, v, timeMs: st.state.timeMs });
        st.on('change:selection', (s) => add('selection', s && { key: s.key, lat: s.lat, lon: s.lon, variant: s.variant, regionId: s.regionId, kind: s.kind }));
        st.on('change:view', (v) => add('view', v));
        st.on('change:playing', (v) => add('playing', v));
        st.on('change:compare', (c) => add('compare', c.map((x) => x.key)));
        st.on('layers:change', (id) => { if (id === 'sun_now' || id === 'earth_now') add('layer', `${id}:${layers.isOn(id)}`); });
        st.on('view:flyTo', (p) => add('flyTo', { lat: p.lat, lon: p.lon }));
      }, T0);
      await page.click('#header button:has-text("Démo")');
      await page.waitForSelector('.demo-banner');
      // Région 1 : jusqu'au calque « Terre visible », à mi-lecture
      await page.waitForFunction(() => demoLog.some((e) => e.type === 'layer' && e.v === 'earth_now:true'), null, { timeout: 60000 });
      assert.ok((await text(page, '.demo-banner')).includes('Malapert Massif : zones d’où la Terre est visible'));
      assert.ok((await text(page, '#right .pick.is-on')).includes('meilleur compromis'), 'la fiche montre le point « meilleur compromis » comme sélectionné');
      await sleep(1500);
      await shot(page, 'app-demo-region1-1440');
      // Vue de comparaison avec les trois points
      await page.waitForFunction(() => demoLog.some((e) => e.type === 'view' && e.v === 'compare'), null, { timeout: 90000 });
      assert.ok((await text(page, '.demo-banner')).includes('Comparaison des 3 sites'));
      await sleep(5000);
      assert.ok(await page.evaluate(() => document.querySelectorAll('#view-compare table tr').length > 5), 'tableau de comparaison rempli');
      await shot(page, 'app-demo-comparer-1440');
      // Début du second cycle : retour à la première région
      await page.waitForFunction(() => demoLog.filter((e) => e.type === 'selection' && e.v && e.v.key === 'malapert_massif:both').length >= 2, null, { timeout: 60000 });
      const log = await page.evaluate(() => demoLog);

      // 1. Chaque étape est atteinte, dans l'ordre.
      const regions = ['malapert_massif', 'mons_mouton_plateau', 'haworth'], keys = regions.map((r) => `${r}:both`);
      const token = (e) => (e.type === 'selection' ? `selection:${e.v && e.v.key}` : e.type === 'compare' ? `compare:${e.v.join(',')}` : e.type === 'flyTo' ? 'flyTo' : `${e.type}:${e.v}`);
      const expected = [...keys.flatMap((k) => [`selection:${k}`, 'flyTo', 'layer:sun_now:true', 'playing:true', 'layer:earth_now:true', 'playing:false']),
        'layer:sun_now:false', 'layer:earth_now:false', `compare:${keys.join(',')}`, 'view:compare', 'view:map2d', `selection:${keys[0]}`];
      let at = 0;
      for (const e of log) if (token(e) === expected[at]) at++;
      assert.equal(at, expected.length, `étape non atteinte : ${expected[at]} (journal : ${log.map(token).join(' › ')})`);

      // 2. Chaque région : point « meilleur compromis » (pas le centre), vue centrée dessus, le temps avance vraiment.
      const ref = await page.evaluate(async (ids) => { const e = await import('/js/science/engine.js'), d = await import('/js/data/sites.js'); return ids.map((id) => { const s = d.getSite(id); return { both: e.regionBest(s.corners).both, centre: [s.lat, s.lon] }; }); }, regions);
      for (let r = 0; r < regions.length; r++) {
        const i = log.findIndex((e) => e.type === 'selection' && e.v && e.v.key === keys[r]), sel = log[i].v;
        assert.deepEqual([sel.kind, sel.regionId, sel.variant], ['artemis', regions[r], 'both']);
        assert.deepEqual([sel.lat, sel.lon], [ref[r].both.lat, ref[r].both.lon], `${regions[r]} : point attendu de regionBest`);
        assert.notDeepEqual([sel.lat, sel.lon], ref[r].centre);
        assert.deepEqual(log.slice(i).find((e) => e.type === 'flyTo').v, { lat: sel.lat, lon: sel.lon });
        const play = log.slice(i).find((e) => e.type === 'playing' && e.v === true), stop = log.slice(i).find((e) => e.type === 'playing' && e.v === false);
        const days = (stop.timeMs - play.timeMs) / 86400e3;
        assert.ok(days > 5 && days < 20, `${regions[r]} : ${days.toFixed(1)} jours simulés pendant la lecture (≈ 13,9 attendus)`);
      }

      // 3. Arrêt au clic : état d'avant rendu, plus aucune action de la démo ensuite.
      await page.mouse.click(720, 450);
      await page.waitForFunction(() => !RF.state.demo);
      const after = await page.evaluate(async () => { const { layers } = await import('/js/layers/manager.js'); return { playing: RF.state.playing, speed: RF.state.speed, timeMs: RF.state.timeMs, compare: RF.state.compare.map((c) => c.key), sun: layers.isOn('sun_now'), earth: layers.isOn('earth_now'), elevation: layers.isOn('elevation'), banner: !!document.querySelector('.demo-banner'), n: demoLog.length }; });
      assert.deepEqual({ ...after, n: 0 }, { playing: false, speed: 1000, timeMs: T0, compare: ['slater_plain'], sun: false, earth: false, elevation: true, banner: false, n: 0 });
      await sleep(4500);
      const late = await page.evaluate((n) => demoLog.slice(n).filter((e) => e.type !== 'selection' && e.type !== 'flyTo').map((e) => e.type), after.n);
      assert.deepEqual(late, [], 'la démo arrêtée ne touche plus à l’état');
      await page.evaluate(async () => { const { layers } = await import('/js/layers/manager.js'); layers.toggle('elevation', false); RF.set({ compare: [] }); });
    });

    await step('application 1440 px : aucune erreur console ou réseau', async () => assert.deepEqual(real(problems), []));
    await browser.close();
  }

  // ----------------------------------------------------------------- 390 × 844
  {
    const { browser, page, problems } = await openApp(app.appUrl, 390, 844);
    const openTutorial = async () => { await page.click('#header button[aria-label="Réglages"]'); await page.click('.pop-nav button:has-text("Tutoriel")'); };

    await step('application 390 px : visite guidée ouverte depuis le menu des réglages, chaque étape désigne un élément visible', async () => {
      assert.deepEqual(await page.evaluate(() => [RF.state.leftOpen, RF.state.rightOpen]), [false, false]);
      await openTutorial();
      await walkTour(page, [[null, ''], [LEFT_BTN, HINT_LEFT], [RIGHT_BTN, HINT_RIGHT], [{ sel: '#timebar' }, ''], [LEFT_BTN, HINT_LEFT],
        [{ sel: '.viewswitch' }, ''], [GEAR, HINT_MENU], [GEAR, HINT_MENU]], 'app-tutoriel-390');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de débordement horizontal');
    });

    await step('application 390 px : panneau gauche ouvert, la visite désigne la liste des sites ; indication en anglais', async () => {
      await page.evaluate(() => RF.set({ leftOpen: true }));
      await sleep(400);
      await openTutorial();
      await page.waitForSelector('.tour-card');
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      const p = await tourProbe(page, { sel: '#left .sitelist' });
      assert.ok(p.onTarget && p.hint === '' && p.cardInside, JSON.stringify(p));
      await page.evaluate(() => RF.set({ lang: 'en' }));
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      const en = await tourProbe(page, { label: 'Show or hide the site sheet' });
      assert.ok(en.onTarget && en.hint.startsWith('The site sheet is closed') && en.cardInside, JSON.stringify(en));
      await shot(page, 'app-tutoriel-en-390');
      await page.keyboard.press('Escape');
      await page.evaluate(() => RF.set({ lang: 'fr', leftOpen: false }));
    });

    await step('application 390 px : aucune erreur console ou réseau', async () => assert.deepEqual(real(problems), []));
    await browser.close();
  }
  app.stop();
}

server.close();
console.log(results.join('\n'));
const steps = results.filter((r) => /^(ok|ÉCHEC) /.test(r)).length;
console.log(`\n${steps - failed}/${steps} étapes passées, ${checks} contrôles exécutés` + (failed ? ` — ${failed} étape(s) en échec` : ''));
process.exit(failed ? 1 : 0);
