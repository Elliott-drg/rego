// En-tête, réglages, fenêtres (Énergie, Données + JPL Horizons, Import, Historique, À propos), recherche, mesure. Vrais clics, 1440×900, FR.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, step, click, mapIdle, mapPx, scanText, scanOverflow, listInteractive, LOG } from './lib.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const J = await launch(); const { page } = J; const R = {};
const st = (k) => J.state(k);
const scan = async (label) => { const s = await scanText(page); if (s.length) J.note(`TEXTES SUSPECTS (${label}) : ` + JSON.stringify(s)); const o = await scanOverflow(page, '.modal') ; if (o.clipped?.length) J.note(`TEXTE TRONQUÉ dans la fenêtre (${label}) : ` + JSON.stringify(o.clipped.slice(0, 12))); };
const setDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(600); };
/** Fait défiler la fenêtre ouverte et la capture écran par écran. */
async function modalTour(name, max = 6) {
  const m = page.locator('.modal').first(); if (!(await m.count())) { J.note(`DÉFAUT : aucune fenêtre ouverte pour ${name}`); return ''; }
  const txt = await m.innerText(); fs.writeFileSync(`${LOG}/03-${name}.txt`, txt);
  J.note(`fenêtre ${name} : ${txt.length} caractères ; titre « ${(await page.locator('.modal-title').first().innerText()).trim()} » ; taille ` + JSON.stringify(await m.boundingBox()));
  await J.shot(`M-${name}-1`);
  const body = page.locator('.modal .modal-body').first(); const bb = await body.boundingBox();
  for (let k = 2; k <= max; k++) { const at = await body.evaluate((e) => [e.scrollTop, e.scrollHeight - e.clientHeight]); if (at[0] >= at[1] - 2) break; await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.wheel(0, Math.round(bb.height * 0.85)); await page.waitForTimeout(700); await J.shot(`M-${name}-${k}`); }
  await body.evaluate((e) => { e.scrollTop = 0; });
  await scan(name); return txt;
}
const closeModal = async () => { const b = page.locator('.modal-head .iconbtn').first(); if (await b.count()) { await click(J, b); await page.waitForTimeout(300); } };

await step(J, 'H0-ouverture', async () => { await J.open(); await setDate('2027-03-15T08:30'); await mapIdle(page); await page.waitForTimeout(1500); });

// JURY_ONLY=M1,M2 node … : ne rejoue que certaines étapes (H0 est toujours jouée).
const ONLY = (process.env.JURY_ONLY || '').split(',').filter(Boolean);
const ensureClosed = async () => { for (let k = 0; k < 3 && (await page.locator('.modal, .tour-card, .popover.settings').count()); k++) { await page.keyboard.press('Escape'); const b = page.locator('.modal-head .iconbtn').first(); if (await b.count()) await b.click().catch(() => {}); if (await page.locator('.popover.settings').count()) await page.mouse.click(5, 400); await page.waitForTimeout(300); } };
const S = (name, fn) => (!ONLY.length || ONLY.some((o) => name.startsWith(o)) ? step(J, name, async () => { await ensureClosed(); await fn(); }) : null);

await S('H1-panneaux', async () => {
  const w0 = (await page.locator('#view-map2d').boundingBox()).width;
  await click(J, '#header > .iconbtn'); await page.waitForTimeout(900); const w1 = (await page.locator('#view-map2d').boundingBox()).width; await mapIdle(page); await J.shot('H1-a-sans-gauche');
  await click(J, '#header .header-right > .iconbtn:last-child'); await page.waitForTimeout(900); const w2 = (await page.locator('#view-map2d').boundingBox()).width; await mapIdle(page); await page.waitForTimeout(1000); await J.shot('H1-b-sans-panneaux');
  J.note(`largeur carte : ${w0} → sans gauche ${w1} → sans les deux ${w2} ; vue=${JSON.stringify(await page.evaluate(() => { const p = window.RF.views.map2d.perf; return [p.cssW, p.cssH, p.view]; }))}`);
  await click(J, '#header > .iconbtn'); await click(J, '#header .header-right > .iconbtn:last-child'); await page.waitForTimeout(900); const w3 = (await page.locator('#view-map2d').boundingBox()).width; J.note(`rouverts : ${w3}`); await mapIdle(page);
});

await S('H2-recherche', async () => {
  const inp = page.locator('#header .searchbox input'); R.search = {};
  for (const q of ['Shackleton', 'Apollo', '85.4 S 31.8 E', '-89,45 ; -137,3', 'xyzzy§§ 999999', '-89.45, -137.3', '89.45S 137.3W', '95 S 400 E', 'shackle', 'APOLLO 17', 'mons', '0 0']) {
    await click(J, inp); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await page.keyboard.type(q, { delay: 25 }); await page.waitForTimeout(500);
    const items = await page.$$eval('.search-results:not(.hidden) .search-item', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')));
    if (['Shackleton', 'Apollo', '-89,45 ; -137,3', 'xyzzy§§ 999999', '95 S 400 E'].includes(q)) await J.shot('H2-recherche-' + q.replace(/[^a-z0-9]+/gi, '_').slice(0, 20));
    await page.keyboard.press('Enter'); await page.waitForTimeout(1200); const s = await st(['selection', 'view']);
    R.search[q] = { items, sel: s.selection, view: s.view }; J.note(`« ${q} » → ${items.length} proposition(s) ${JSON.stringify(items.slice(0, 6))} ; Entrée → ${s.selection ? `${s.selection.name} (${(+s.selection.lat).toFixed(3)}, ${(+s.selection.lon).toFixed(3)}) [${s.selection.kind}]` : 'rien'} vue=${s.view} ; champ=« ${await inp.inputValue()} »`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (s.view === 'globe') { await page.waitForTimeout(5000); if (q === 'Apollo') await J.shot('H2-apollo-globe'); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2500); }
  }
  // sélection à la souris dans la liste, flèches clavier
  await click(J, inp); await page.keyboard.type('nobile', { delay: 25 }); await page.waitForTimeout(500); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await J.shot('H2-fleches'); const it = page.locator('.search-results .search-item').nth(1); if (await it.count()) { await it.click(); J.clicks++; } await page.waitForTimeout(1500); J.note('clic souris sur la 2e proposition de « nobile » → ' + JSON.stringify((await st(['selection'])).selection?.name));
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('H2-apres-recherche');
});

await S('H3-reglages', async () => {
  const gear = page.locator('#header .header-right .iconbtn').first(); await click(J, gear); await page.waitForTimeout(500); await J.shot('H3-a-reglages');
  J.note('réglages : ' + (await J.text('.popover.settings')).replace(/\s+/g, ' | '));
  J.note('contrôles : ' + JSON.stringify((await listInteractive(page, '.popover.settings')).map((i) => [i.sel, i.text.slice(0, 30), i.title.slice(0, 60), i.type])));
  const sels = page.locator('.popover.settings select'); const nums = page.locator('.popover.settings input[type=number]');
  // daltonisme : 3 variantes, avec un calque coloré actif
  const lab = page.locator('#left label[for="ly-sun_avg"]'); await lab.scrollIntoViewIfNeeded().catch(() => {});
  for (const v of ['deuteranopia', 'protanopia', 'tritanopia']) { if (!(await page.locator('.popover.settings').count())) { await click(J, gear); await page.waitForTimeout(300); } await page.locator('.popover.settings select').nth(0).selectOption(v); await page.waitForTimeout(500); if (v === 'deuteranopia') { await page.mouse.click(700, 500); await page.waitForTimeout(200); await click(J, lab); } await mapIdle(page); await page.waitForTimeout(1500); await J.shot('H3-b-cvd-' + v); J.note(`cvd=${v} : état=${(await st(['cvd'])).cvd} ; popover encore ouvert=${await page.locator('.popover.settings').count()} ; légende=` + JSON.stringify(await page.$$eval('#view-map2d .legend', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))))); }
  if (!(await page.locator('.popover.settings').count())) { await click(J, gear); await page.waitForTimeout(300); }
  await page.locator('.popover.settings select').nth(0).selectOption('none'); await click(J, lab).catch(() => {});
  if (!(await page.locator('.popover.settings').count())) { await click(J, gear); await page.waitForTimeout(300); }
  // unité de température
  await page.locator('.popover.settings select').nth(1).selectOption('C'); await page.waitForTimeout(800); J.note('°C : ligne température de la fiche = ' + JSON.stringify(await page.$$eval('#right .kv-strong', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))));
  await page.locator('.popover.settings select').nth(1).selectOption('K'); 
  // langue changée depuis le popover : le popover lui-même se traduit-il ?
  await page.locator('.popover.settings select').nth(3).selectOption('en'); await page.waitForTimeout(800); J.note('popover après passage en anglais : ' + (await J.text('.popover.settings'))?.replace(/\s+/g, ' | ')); await J.shot('H3-c-popover-apres-EN');
  if (await page.locator('.popover.settings').count()) await page.locator('.popover.settings select').nth(3).selectOption('fr'); else { await click(J, page.locator('#header .lang-seg button').first()); }
  await page.waitForTimeout(600);
  if (!(await page.locator('.popover.settings').count())) { await click(J, gear); await page.waitForTimeout(300); }
  // paramètres numériques : valeurs normales, hors bornes, vides, texte
  const names = ['mastM', 'earthMarginDeg', 'slopeLimitDeg', 'landingRadiusM'];
  for (const [i, vals] of [[0, ['10', '500', '-5', '', 'abc', '2']], [1, ['2', '99', '0']], [2, ['5', '0', '10']], [3, ['1000', '50', '99999', '2000']]]) for (const v of vals) { const n = page.locator('.popover.settings input[type=number]').nth(i); await n.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); if (v) await page.keyboard.type(v); await page.keyboard.press('Tab'); await page.waitForTimeout(700); const p = (await st(['params'])).params; J.note(`paramètre ${names[i]} saisi « ${v} » → état ${p[names[i]]} ; champ affiche « ${await n.inputValue()} »`); }
  await page.waitForTimeout(1500); await J.shot('H3-d-params');
  // export PNG
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), click(J, page.locator('.popover.settings button').first())]);
  if (dl) { const f = `${LOG}/export.png`; await dl.saveAs(f); J.note(`export PNG : ${dl.suggestedFilename()} (${fs.statSync(f).size} octets)`); fs.copyFileSync(f, path.resolve(HERE, '..', '.out', 'jury-H3-e-export-carte.png')); } else J.note('DÉFAUT ? export PNG : aucun téléchargement ; toasts=' + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
  // boutons de navigation du popover
  if (!(await page.locator('.popover.settings').count())) { await click(J, gear); await page.waitForTimeout(300); }
  J.note('boutons de navigation du popover : ' + JSON.stringify(await page.locator('.popover.settings .pop-nav button').allInnerTexts()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); J.note('Échap ferme le popover : ' + !(await page.locator('.popover.settings').count()));
  if (await page.locator('.popover.settings').count()) { await page.mouse.click(700, 450); await page.waitForTimeout(300); J.note('clic à côté ferme le popover : ' + !(await page.locator('.popover.settings').count()) + ' ; sélection après ce clic : ' + JSON.stringify((await st(['selection'])).selection?.name)); }
});

await S('M1-energie', async () => {
  // sans sélection
  const closeBtn = page.locator('#right .sheet-top .iconbtn'); if (await closeBtn.count()) { await click(J, closeBtn); await page.waitForTimeout(500); }
  await click(J, page.locator('#header .navpills button').nth(1)); await page.waitForTimeout(2500); await J.shot('M-energie-sans-site'); J.note('Énergie sans site : ' + ((await J.text('.modal')) || 'PAS DE FENÊTRE').replace(/\s+/g, ' ').slice(0, 500));
  J.note('contrôles (sans site) : ' + JSON.stringify((await listInteractive(page, '.modal')).map((i) => [i.sel.slice(0, 40), i.text.slice(0, 30), i.type, i.dis]).slice(0, 40)));
  await closeModal();
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(2000);
  await click(J, page.locator('#right .sheet-actions button').nth(1)); await page.waitForTimeout(4000);
  await modalTour('energie', 8);
  const items = await listInteractive(page, '.modal'); J.note('contrôles Énergie : ' + JSON.stringify(items.map((i) => [i.sel.slice(0, 44), i.text.slice(0, 34), i.title.slice(0, 40), i.type, i.dis ? 'DIS' : ''])));
  // tous les boutons segmentés et onglets
  const segs = page.locator('.modal .seg button, .modal [role=tab]'); const ns = await segs.count();
  for (let i = 0; i < ns; i++) { const b = segs.nth(i); const lbl = (await b.innerText()).trim(); await b.scrollIntoViewIfNeeded(); await click(J, b); await page.waitForTimeout(1500); const s = await scanText(page); J.note(`Énergie bouton « ${lbl} » ; suspects=${JSON.stringify(s)}`); await J.shot(`M-energie-seg-${i}`); }
  // champs numériques : valeurs extrêmes
  const nums = page.locator('.modal input[type=number]'); const nn = await nums.count(); J.note(`champs numériques : ${nn}`);
  for (let i = 0; i < nn; i++) { const n = nums.nth(i); if (!(await n.isVisible())) { J.note(`champ ${i} non visible (section repliée ?)`); continue; } try { const lblN = await n.evaluate((e) => (e.closest('label, .field, .kv, tr, div')?.innerText || '').replace(/\s+/g, ' ').slice(0, 60)); const old = await n.inputValue(); for (const v of ['0', '-10', '1e9', '']) { await n.scrollIntoViewIfNeeded(); await n.click({ timeout: 5000 }); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); if (v) await page.keyboard.type(v); await page.keyboard.press('Tab'); await page.waitForTimeout(500); const s = await scanText(page); const shown = await n.inputValue(); if (s.length) { J.note(`Énergie champ ${i} « ${lblN} » = « ${v} » (affiché « ${shown} ») → SUSPECTS ${JSON.stringify(s.slice(0, 6))}`); await J.shot(`M-energie-champ-${i}-${v || 'vide'}`); } else if (v === '1e9' || v === '-10') J.note(`Énergie champ ${i} « ${lblN} » = « ${v} » → affiché « ${shown} »`); } await n.click(); await page.keyboard.press('Control+A'); await page.keyboard.type(old); await page.keyboard.press('Tab'); await page.waitForTimeout(300); } catch (e) { J.note(`champ ${i} : ${String(e.message).split('\n')[0].slice(0, 160)}`); } }
  const ranges = page.locator('.modal input[type=range]'); for (let i = 0; i < await ranges.count(); i++) { const r = ranges.nth(i); await r.scrollIntoViewIfNeeded(); const b = await r.boundingBox(); if (!b) continue; await page.mouse.click(b.x + 2, b.y + b.height / 2); await page.waitForTimeout(400); let s = await scanText(page); if (s.length) J.note(`Énergie curseur ${i} au minimum → SUSPECTS ${JSON.stringify(s.slice(0, 5))}`); await page.mouse.click(b.x + b.width - 2, b.y + b.height / 2); await page.waitForTimeout(400); s = await scanText(page); if (s.length) J.note(`Énergie curseur ${i} au maximum → SUSPECTS ${JSON.stringify(s.slice(0, 5))}`); }
  await J.shot('M-energie-apres-extremes'); fs.writeFileSync(`${LOG}/03-energie-apres.txt`, (await J.text('.modal')) || '');
  // Échap
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); J.note('Échap ferme Énergie : ' + !(await page.locator('.modal').count()));
});

await S('M2-donnees', async () => {
  await click(J, page.locator('#header .navpills button').nth(2)); await page.waitForTimeout(3500);
  const tabs = page.locator('.modal [role=tab]'); const nt = await tabs.count(); J.note('onglets Données : ' + JSON.stringify(await tabs.allInnerTexts()));
  for (let i = 0; i < nt; i++) { await click(J, tabs.nth(i)); await page.waitForTimeout(2500); await modalTour(`donnees-onglet${i}`, 4); J.note(`onglet ${i} contrôles : ` + JSON.stringify((await listInteractive(page, '.modal')).map((x) => [x.text.slice(0, 30), x.type, x.dis ? 'DIS' : '']).slice(0, 50))); }
  // Vérification JPL Horizons
  const ver = page.locator('.modal [role=tab][data-tab*="ver"], .modal [role=tab][data-tab*="hor"]').first(); if (await ver.count()) await click(J, ver); else J.note('onglet de vérification introuvable par data-tab ; onglets : ' + JSON.stringify(await tabs.evaluateAll((l) => l.map((e) => e.dataset.tab))));
  await page.waitForTimeout(1500);
  const run = page.locator('.modal .btn-primary').first(); J.note('bouton principal : « ' + (await run.innerText().catch(() => '?')) + ' » désactivé=' + (await run.isDisabled().catch(() => '?')));
  const t0 = Date.now(); await click(J, run); await page.waitForTimeout(1500); await J.shot('M-horizons-en-cours');
  for (let k = 0; k < 45; k++) { await page.waitForTimeout(2000); const dis = await page.locator('.modal .btn-primary').first().isDisabled().catch(() => false); if (!dis) break; }
  J.note(`JPL Horizons : réponse en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const txt = await modalTour('horizons-resultat', 5); J.note('résultat Horizons : ' + txt.replace(/\s+/g, ' ').slice(0, 2500));
  R.horizons = txt;
  // 2e site (hémisphère nord) via la liste de la fenêtre
  const pick = page.locator('.modal select.dc-sitepick'); if (await pick.count()) { const opts = await pick.locator('option').evaluateAll((l) => l.map((o) => [o.value, o.textContent])); J.note('sites proposés : ' + opts.length + ' ' + JSON.stringify(opts.slice(0, 5))); const ap = opts.find((o) => /Apollo 11/.test(o[1])); if (ap) { await pick.selectOption(ap[0]); await page.waitForTimeout(1500); const run2 = page.locator('.modal .btn-primary').first(); await click(J, run2); for (let k = 0; k < 45; k++) { await page.waitForTimeout(2000); if (!(await page.locator('.modal .btn-primary').first().isDisabled().catch(() => false))) break; } const t2 = (await J.text('.modal')) || ''; fs.writeFileSync(`${LOG}/03-horizons-apollo11.txt`, t2); J.note('Horizons Apollo 11 : ' + t2.replace(/\s+/g, ' ').slice(0, 1500)); await J.shot('M-horizons-apollo11'); } }
  // onglet sources : « tester tout »
  const src = page.locator('.modal [role=tab][data-tab="sources"]'); if (await src.count()) { await click(J, src); await page.waitForTimeout(1500); const s = page.locator('.modal input[type=search]'); if (await s.count()) { await s.click(); await page.keyboard.type('diviner'); await page.waitForTimeout(800); J.note('recherche « diviner » dans les sources : ' + (await page.locator('.modal .dc-src-toggle').count()) + ' source(s)'); await J.shot('M-donnees-sources-diviner'); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await page.waitForTimeout(500); } const tog = page.locator('.modal .dc-src-toggle').first(); if (await tog.count()) { await click(J, tog); await page.waitForTimeout(800); await J.shot('M-donnees-source-ouverte'); const test = page.locator('.modal .dc-src button.btn, .modal button.btn-sm').filter({ hasText: /Tester|Test/ }).first(); if (await test.count() && !(await test.isDisabled())) { await click(J, test); await page.waitForTimeout(12000); await J.shot('M-donnees-source-testee'); J.note('test d’une source : ' + ((await J.text('.modal')) || '').replace(/\s+/g, ' ').slice(0, 900)); } } }
  await scan('données-fin');
  await closeModal();
});

await S('M3-import', async () => {
  await click(J, page.locator('#left .toolbtn').nth(3)).catch(async () => { await click(J, page.locator('#left .toolbtn', { hasText: /Import/ })); }); await page.waitForTimeout(1500);
  await modalTour('import-vide', 2);
  const tryFile = async (file, label) => {
    const input = page.locator('.modal input[type=file]').first(); await input.setInputFiles(path.join(HERE, 'fixtures', file)); await page.waitForTimeout(2000);
    const txt = ((await J.text('.modal')) || '').replace(/\s+/g, ' '); J.note(`import ${label} — aperçu : ` + txt.slice(0, 1400)); await J.shot('M-import-' + label + '-apercu');
    J.note('contrôles : ' + JSON.stringify((await listInteractive(page, '.modal')).map((x) => [x.sel.slice(0, 30), x.text.slice(0, 40), x.type, x.dis ? 'DIS' : '']).slice(0, 40)));
    const add = page.locator('.modal .btn-primary').last(); if (await add.count() && !(await add.isDisabled())) { await click(J, add); await page.waitForTimeout(1500); const imps = (await st(['imports'])).imports; J.note(`après « ajouter » : ${imps.length} jeu(x) : ` + JSON.stringify(imps.map((i) => [i.name, i.color, i.features.map((f) => `${f.type}:${f.name || ''}:${JSON.stringify(f.coords).slice(0, 60)}`)]))); await J.shot('M-import-' + label + '-ajoute'); } else J.note(`import ${label} : pas de bouton d’ajout actif ; toasts=` + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
    await scan('import-' + label);
  };
  await tryFile('points.geojson', 'geojson'); await tryFile('points.csv', 'csv-fr'); await tryFile('simple.csv', 'csv-simple'); await tryFile('casse.geojson', 'casse');
  J.note('fenêtre import, liste des jeux : ' + ((await J.text('.modal')) || '').replace(/\s+/g, ' ').slice(0, 900));
  J.note('boutons par jeu : ' + JSON.stringify(await page.$$eval('.modal .iconbtn.boxed', (l) => l.map((e) => e.title))));
  await closeModal(); await page.keyboard.press('Escape');
  await click(J, page.locator('#view-map2d .zoomctl button').nth(2)); await mapIdle(page); await page.waitForTimeout(2500); await J.shot('M-import-carte');
  // cliquer sur un point importé sur la carte
  const p = await mapPx(page, -85.9, -0.5); await page.mouse.click(p.x, p.y); J.clicks++; await page.waitForTimeout(1500); J.note('clic sur le point importé « Jury A » → sélection ' + JSON.stringify((await st(['selection'])).selection));
  // les points importés sont-ils trouvés par la recherche ?
  await click(J, '#header .searchbox input'); await page.keyboard.type('Jury', { delay: 30 }); await page.waitForTimeout(600); J.note('recherche « Jury » : ' + JSON.stringify(await page.$$eval('.search-results .search-item', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))))); await page.keyboard.press('Escape');
  // globe : les imports y figurent-ils ?
  await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(10000); await J.shot('M-import-globe'); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2500);
  // supprimer un jeu depuis la fenêtre
  await click(J, page.locator('#left .toolbtn', { hasText: /Import/ })); await page.waitForTimeout(1000); const del = page.locator('.modal .iconbtn.boxed').last(); if (await del.count()) { const ttl = await del.getAttribute('title'); await click(J, del); await page.waitForTimeout(800); J.note(`clic « ${ttl} » → ${(await st(['imports'])).imports.length} jeu(x) restant(s) ; confirmation demandée : ` + (await page.locator('.modal').innerText()).replace(/\s+/g, ' ').slice(0, 200)); }
  await closeModal();
});

await S('M4-historique-apropos', async () => {
  await click(J, page.locator('#header .navpills button').nth(3)); await page.waitForTimeout(1500); await modalTour('historique', 6);
  const cards = page.locator('.modal .hist-card'); J.note(`historique : ${await cards.count()} missions ; dates : ` + JSON.stringify(await page.$$eval('.modal .hist-date', (l) => l.map((e) => e.innerText))));
  const c = cards.filter({ hasText: /Apollo 17/ }).first(); if (await c.count()) { await c.scrollIntoViewIfNeeded(); await click(J, c); await page.waitForTimeout(9000); const s = await st(['selection', 'view']); J.note(`clic Apollo 17 → ${s.selection?.name} vue=${s.view} ; fenêtre fermée=${!(await page.locator('.modal').count())}`); await J.shot('M-historique-apollo17'); }
  await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2500); await J.shot('M-retour-carte-avec-site-nord'); J.note('retour carte 2D avec un site nord sélectionné : avis=' + JSON.stringify(await page.$$eval('#view-map2d .map2d-notice', (l) => l.map((e) => [e.className, e.innerText]))) + ' vue=' + (await st(['view'])).view);
  await click(J, page.locator('#header .navpills button').nth(5)); await page.waitForTimeout(2500); await modalTour('apropos', 5);
  // clic sur le fond : ferme ?
  await page.mouse.click(20, 400); await page.waitForTimeout(400); J.note('clic sur le fond ferme la fenêtre : ' + !(await page.locator('.modal').count()));
  await click(J, '#header .brand'); await page.waitForTimeout(1000); J.note('clic sur le logo → fenêtre : ' + (await page.locator('.modal-title').first().innerText().catch(() => 'aucune'))); await closeModal();
});

await S('M5-mesure', async () => {
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await mapIdle(page); await page.waitForTimeout(2500);
  await click(J, page.locator('#left .toolbtn', { hasText: /Mesur/ })); await page.waitForTimeout(600);
  const b = await page.locator('#view-map2d').boundingBox(); const pts = [[0.35, 0.4], [0.55, 0.55], [0.7, 0.35]];
  for (const [fx, fy] of pts) { await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy); J.clicks++; await page.waitForTimeout(900); }
  await page.waitForTimeout(1500); await J.shot('M-mesure');
  J.note('mesure : points=' + (await st(['measure'])).measure.length + ' ; panneau=' + JSON.stringify(await page.$$eval('#main-overlays > *:not(.viewswitch)', (l) => l.map((e) => e.className + ' :: ' + e.innerText.replace(/\s+/g, ' ').slice(0, 700)))));
  J.note('contrôles de mesure : ' + JSON.stringify((await listInteractive(page, '#main-overlays')).map((x) => [x.sel.slice(0, 30), x.text.slice(0, 30), x.title.slice(0, 40)])));
  await scan('mesure');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); J.note('Échap : outil=' + (await st(['tool'])).tool);
  if ((await st(['tool'])).tool) await click(J, page.locator('#left .toolbtn', { hasText: /Mesur/ }));
});

fs.writeFileSync(`${LOG}/03-boutons-fenetres.json`, JSON.stringify(R, null, 1));
await J.finish('03-boutons-fenetres');
