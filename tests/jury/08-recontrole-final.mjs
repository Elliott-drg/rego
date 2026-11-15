// Dernier passage sur le code tel qu'il est à la fin du test : rejoue en une fois les défauts relevés (le dépôt changeait pendant les parcours).
import fs from 'node:fs';
import { launch, step, click, mapIdle, mapPx, scanText, scanOverflow, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const st = (k) => J.state(k); const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const setDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(700); };
const R = {};
await step(J, 'F0', async () => { await J.open(); await mapIdle(page); await setDate('2027-03-15T08:30'); R.files = await page.evaluate(async () => { const out = {}; for (const f of ['js/ui/leftpanel.js', 'js/ui/shell.js', 'js/ui/compare.js', 'js/ui/rightpanel.js', 'js/ui/timebar.js', 'js/views/charts.js', 'js/core/store.js']) { const r = await fetch(f, { cache: 'no-store' }); out[f] = r.headers.get('last-modified') || r.status; } return out; }); J.note('fichiers servis (date de modification) : ' + JSON.stringify(R.files)); });

// JURY_ONLY=F3 node … : ne rejoue que certaines étapes (F0 est toujours jouée).
const ONLY = (process.env.JURY_ONLY || '').split(',').filter(Boolean);
const ensureClosed = async () => { for (let k = 0; k < 3 && (await page.locator('.modal, .tour-card, .popover.settings').count()); k++) { await page.keyboard.press('Escape'); const b = page.locator('.modal-head .iconbtn').first(); if (await b.count()) await b.click().catch(() => {}); if (await page.locator('.popover.settings').count()) await page.mouse.click(5, 400); await page.waitForTimeout(300); } };
const S = (name, fn) => (!ONLY.length || ONLY.some((o) => name.startsWith(o)) ? step(J, name, async () => { await ensureClosed(); await fn(); }) : null);

await S('F1-opacite', async () => {
  const lab = page.locator('#left label[for="ly-elevation"]'); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(800);
  const sl = lab.locator('xpath=..').locator('input[type=range]'); const b = await sl.boundingBox(); const v = +(await sl.inputValue()); const x0 = b.x + 8 + (b.width - 16) * (v / 100);
  await page.mouse.move(x0, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(x0 - b.width * 0.5, b.y + b.height / 2, { steps: 15 }); await page.mouse.up(); await page.waitForTimeout(300);
  const op = await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.get('elevation').opacity); J.note(`curseur d’opacité glissé de ${v} % vers la gauche (−50 % de la largeur) → ${Math.round(op * 100)} % ${Math.abs(op * 100 - (v - 55)) < 12 ? '(corrigé)' : '(DÉFAUT TOUJOURS PRÉSENT : le glisser s’arrête au premier pas)'}`);
  await click(J, page.locator('#left label[for="ly-elevation"]'));
});

await S('F2-fiche', async () => {
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(1500); await click(J, page.locator('#right .pick').first()); await mapIdle(page); await page.waitForTimeout(2500);
  await J.shot('F2-a-ecran'); const rb = await page.locator('#right').boundingBox(); await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  for (let k = 1; k <= 3; k++) { await page.mouse.wheel(0, 640); await page.waitForTimeout(700); await page.locator('#right').screenshot({ path: `tests/.out/jury-F2-b-fiche-${k}.png` }); }
  fs.writeFileSync(`${LOG}/08-fiche.txt`, (await J.text('#right')) || ''); await page.locator('#right').evaluate((e) => { e.scrollTop = 0; });
  // bouton « Centrer » avec un site hors carte, sélection d'une région par clic à l'intérieur
  const p = await mapPx(page, -86.6, -20.0); const vis = p.x > p.rect.l + 5 && p.x < p.rect.l + p.rect.w - 5 && p.y > p.rect.t + 60 && p.y < p.rect.t + p.rect.h - 5; await page.mouse.click(p.x, p.y); await page.waitForTimeout(1200); const s1 = (await st(['selection'])).selection; J.note(`clic carte en 86,60°S 20,0°O (dans la région voisine Haworth, point ${vis ? 'visible' : 'HORS ÉCRAN'}) → sélection « ${s1.name} » (${(+s1.lat).toFixed(2)}, ${(+s1.lon).toFixed(2)}) : ${s1.kind === 'point' ? 'point cliqué' : 'centre de la région, pas le point cliqué'}`); await J.shot('F2-d-clic-region-voisine');
  await page.locator('#timebar').screenshot({ path: 'tests/.out/jury-F2-c-barre.png' });
  J.note('barre : ' + JSON.stringify(await page.$$eval('#timebar .tb-jump', (l) => l.map((e) => [e.innerText.trim(), Math.round(e.getBoundingClientRect().width)]))) + ' ; liste vitesse tronquée ? ' + JSON.stringify(await page.$$eval('#timebar .tb-speed-select', (l) => l.map((e) => [e.clientWidth, e.scrollWidth, getComputedStyle(e).display]))));
});

await S('F3-comparer', async () => {
  await click(J, page.locator('#left .siteitem').filter({ has: page.locator('.siteitem-name', { hasText: /^Mons Mouton$/ }) }).first()); await page.waitForTimeout(1200); await click(J, page.locator('#right .sheet-actions button').first());
  await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(5000); await click(J, page.locator('#view-compare .cmp-top button', { hasText: /Même site|Same site/ })); await page.waitForTimeout(9000);
  await J.shot('F3-a-cartes'); J.note('en-têtes des cartes (la date du scénario y figure-t-elle ?) : ' + JSON.stringify(await page.$$eval('#view-compare .cmp-card-head', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))));
  const tb = page.locator('#view-compare table.cmp-table'); await tb.scrollIntoViewIfNeeded(); await page.waitForTimeout(600); await J.shot('F3-b-tableau');
  const ov = await page.evaluate(() => { const t = document.querySelector('#view-compare table.cmp-table'); const sc = t.closest('.cmp-scroll') || t.parentElement; return { tableW: t.scrollWidth, boxW: sc.clientWidth, scrollable: sc.scrollWidth > sc.clientWidth + 2, last: [...t.querySelectorAll('tr')].slice(3, 5).map((r) => { const c = r.lastElementChild; const b = c.getBoundingClientRect(), p = sc.getBoundingClientRect(); return [c.innerText.replace(/\s+/g, ' '), Math.round(b.right - p.right)]; }) }; });
  J.note('colonne « Meilleur » : ' + JSON.stringify(ov) + (ov.scrollable ? ' → DÉBORDE (défilement horizontal nécessaire)' : ' → entière'));
  await page.evaluate(() => window.RF.set({ compare: [] })); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(1500);
});

await S('F4-1280', async () => {
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(2500); await mapIdle(page); await J.shot('F4-1280x720');
  J.note('1280×720 : boutons d’en-tête visibles = ' + JSON.stringify(await page.$$eval('#header button', (l) => l.filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || e.title).trim()))));
  await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(2000); J.note('1366×768 : ' + JSON.stringify(await page.$$eval('#header button', (l) => l.filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || e.title).trim())))); await J.shot('F4-1366x768');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1500);
});

await S('F5-energie', async () => {
  const warn0 = J.problems.length;
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(1200);
  await click(J, page.locator('#right .sheet-actions button').nth(1)); await page.waitForTimeout(3500);
  let sc = await scanText(page); J.note('Énergie (simplifié) : suspects=' + JSON.stringify(sc)); await J.shot('F5-a-energie-simplifie');
  fs.writeFileSync(`${LOG}/08-energie-simple.txt`, (await J.text('.modal')) || '');
  const body = page.locator('.modal .modal-body'); const bb = await body.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  for (let k = 2; k <= 4; k++) { await page.mouse.wheel(0, Math.round(bb.height * 0.85)); await page.waitForTimeout(600); await J.shot(`F5-a-energie-simplifie-${k}`); } await body.evaluate((e) => { e.scrollTop = 0; });
  await click(J, page.locator('.modal .seg button', { hasText: /Expert/ }).first()); await page.waitForTimeout(1500); sc = await scanText(page); J.note('Énergie (expert) : suspects=' + JSON.stringify(sc)); await J.shot('F5-b-energie-expert');
  fs.writeFileSync(`${LOG}/08-energie-expert.txt`, (await J.text('.modal')) || '');
  for (let k = 2; k <= 6; k++) { await page.mouse.wheel(0, Math.round(bb.height * 0.85)); await page.waitForTimeout(600); await J.shot(`F5-b-energie-expert-${k}`); const at = await body.evaluate((e) => [e.scrollTop, e.scrollHeight - e.clientHeight]); if (at[0] >= at[1] - 2) break; } await body.evaluate((e) => { e.scrollTop = 0; });
  // champs numériques : valeurs extrêmes saisies au clavier
  const nums = page.locator('.modal input[type=number]'); const nn = await nums.count(); let tested = 0; const bad = [];
  for (let i = 0; i < nn; i++) { const n = nums.nth(i); if (!(await n.isVisible())) continue; const lbl = await n.evaluate((e) => (document.querySelector(`label[for="${e.id}"]`)?.innerText || e.closest('.en-field, label, tr, div')?.innerText || e.id || '').replace(/\s+/g, ' ').slice(0, 50)); const old = await n.inputValue(); const lim = await n.evaluate((e) => [e.min, e.max, e.step]);
    for (const v of ['0', '-10', '1e9', '']) { try { await n.scrollIntoViewIfNeeded(); await n.focus(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); if (v) await page.keyboard.type(v); await page.keyboard.press('Tab'); await page.waitForTimeout(350); const s2 = await scanText(page); const shown = await n.inputValue(); if (s2.length) bad.push({ champ: lbl, saisi: v, affiche: shown, suspects: s2.slice(0, 4) }); if (v === '1e9' || v === '-10') J.note(`champ « ${lbl} » [min ${lim[0]}, max ${lim[1]}] saisi ${v} → affiché « ${shown} »`); } catch (e) { J.note(`champ « ${lbl} » : ${String(e.message).split('\n')[0].slice(0, 120)}`); break; } }
    await n.focus(); await page.keyboard.press('Control+A'); await page.keyboard.type(old); await page.keyboard.press('Tab'); await page.waitForTimeout(200); tested++; }
  J.note(`champs numériques testés : ${tested}/${nn} ; valeurs produisant NaN/undefined/Infinity/clé brute : ` + JSON.stringify(bad));
  if (bad.length) await J.shot('F5-c-energie-valeur-extreme');
  // curseurs aux extrêmes
  const rg = page.locator('.modal input[type=range]'); const badR = []; for (let i = 0; i < await rg.count(); i++) { const r = rg.nth(i); if (!(await r.isVisible())) continue; await r.scrollIntoViewIfNeeded(); await r.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(300); let s3 = await scanText(page); if (s3.length) badR.push([i, 'min', s3.slice(0, 3)]); await page.keyboard.press('End'); await page.waitForTimeout(300); s3 = await scanText(page); if (s3.length) badR.push([i, 'max', s3.slice(0, 3)]); }
  J.note('curseurs aux extrêmes : ' + JSON.stringify(badR)); await J.shot('F5-d-energie-extremes');
  const reset = page.locator('.modal button', { hasText: /Réinitialiser|Reset/ }).first(); if (await reset.count()) await click(J, reset);
  // exports
  for (const re of [/CSV/, /JSON/]) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), click(J, page.locator('.modal button', { hasText: re }).first())]); if (dl) { const f = `${LOG}/energie-export-${re.source}.txt`; await dl.saveAs(f); const tx = fs.readFileSync(f, 'utf8'); J.note(`export ${re.source} : ${dl.suggestedFilename()} (${tx.length} caractères)${/NaN|undefined|\[object/.test(tx) ? ' CONTIENT NaN/undefined/[object : ' + tx.split('\n').filter((l) => /NaN|undefined|\[object/.test(l)).slice(0, 3).join(' ⏎ ') : ''}`); } else J.note(`export ${re.source} : aucun téléchargement`); }
  // anglais
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await click(J, page.locator('#header .lang-seg button').nth(1)); await click(J, page.locator('#right .sheet-actions button').nth(1)); await page.waitForTimeout(2500); sc = await scanText(page); J.note('Energy (EN) : suspects=' + JSON.stringify(sc)); await J.shot('F5-e-energy-EN');
  const fr = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.querySelector('.modal'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const tx = n.textContent.trim(); if (/\b(pendant|nuit|jours|avec|pour|dans|énergie|stockage|puissance|équipage|hypothèse|calculé|modèle)\b/i.test(tx)) out.push(tx.slice(0, 80)); } return out.slice(0, 15); }); J.note('Energy (EN) : textes restés en français = ' + JSON.stringify(fr));
  await page.keyboard.press('Escape'); await click(J, page.locator('#header .lang-seg button').nth(0)); await page.waitForTimeout(500);
  J.note('avertissements console pendant Énergie : ' + JSON.stringify([...new Set(J.problems.slice(warn0))].slice(0, 12)));
});

await S('F6-import-suite', async () => {
  await click(J, page.locator('#left .toolbtn', { hasText: /Import/ })); await page.waitForTimeout(1000);
  const up = async (f) => { await page.locator('.modal input[type=file]').first().setInputFiles(new URL('./fixtures/' + f, import.meta.url).pathname); await page.waitForTimeout(1500); const add = page.locator('.modal .btn-primary').last(); if (await add.count() && !(await add.isDisabled())) { await click(J, add); await page.waitForTimeout(1000); } };
  await up('points.geojson'); await up('points.csv'); J.note('jeux importés : ' + JSON.stringify((await st(['imports'])).imports.map((i) => [i.name, i.features.length])));
  const closeBtn = page.locator('.modal-head .iconbtn').first(); await click(J, closeBtn); await page.waitForTimeout(500); J.note('fenêtre fermée par la croix : ' + !(await page.locator('.modal').count()));
  await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(800); await click(J, page.locator('#view-map2d .zoomctl button').nth(2)); await mapIdle(page); await page.waitForTimeout(2500); await J.shot('F6-a-carte-imports');
  const p = await mapPx(page, -87.2, 125.4); await page.mouse.move(p.x, p.y); await page.waitForTimeout(500); await page.mouse.click(p.x, p.y); await page.waitForTimeout(1500); J.note('clic sur le point importé « Jury C2 » (87,2°S 125,4°E, aussi centre de Slater Plain) → ' + JSON.stringify((await st(['selection'])).selection));
  const p2 = await mapPx(page, -89.45, -137.3); await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(1500); J.note('clic sur le point importé « Jury C3 » (89,45°S 137,3°O) → ' + JSON.stringify((await st(['selection'])).selection));
  await click(J, '#header .searchbox input'); await page.keyboard.type('Jury', { delay: 30 }); await page.waitForTimeout(700); J.note('recherche « Jury » (noms importés) : ' + JSON.stringify(await page.$$eval('.search-results .search-item', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))))); await page.keyboard.press('Escape');
  await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(10000); await J.shot('F6-b-globe-imports'); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2000);
  await click(J, page.locator('#left .toolbtn', { hasText: /Import/ })); await page.waitForTimeout(800); await J.shot('F6-c-liste-jeux'); const del = page.locator('.modal .iconbtn.boxed').last(); const ttl = await del.getAttribute('title'); await click(J, del); await page.waitForTimeout(800); J.note(`« ${ttl} » → ${(await st(['imports'])).imports.length} jeu(x) restant(s) ; confirmation demandée : ${/confirm|sûr|Supprimer définitivement|certain/i.test((await J.text('.modal')) || '')} ; toasts=` + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
  await page.keyboard.press('Escape');
});

fs.writeFileSync(`${LOG}/08.json`, JSON.stringify(R, null, 1));
await J.finish('08-recontrole-final');
