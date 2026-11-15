// Suite des objectifs : saisie clavier de la date, fiche complète (obj. 3-4), animation (obj. 6), clic sur le globe,
// scénarios « retard de calendrier » : (a) même site + 2 mois, (b) même date, site déplacé de quelques km.
import fs from 'node:fs';
import { launch, step, click, mapIdle, mapPx, scanText, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const R = {};
const st = (k) => J.state(k); const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const setDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(700); };
const pickSpeed = async (i) => { const b = page.locator('#timebar .tb-speed-seg button').nth(i); if (await b.isVisible()) await click(J, b); else { await page.locator('#timebar .tb-speed-select').selectOption({ index: i }); J.clicks = (J.clicks || 0) + 2; } };
const pickScale = async (i) => { const b = page.locator('#timebar .tb-scale-seg button').nth(i); if (await b.isVisible()) await click(J, b); else { await page.locator('#timebar .tb-scale-select').selectOption({ index: i }); J.clicks = (J.clicks || 0) + 2; } };
const rightShots = async (prefix, max = 9) => { await page.locator('#right').evaluate((e) => { e.scrollTop = 0; }); await page.waitForTimeout(300); await page.locator('#right').screenshot({ path: `tests/.out/jury-${prefix}-0.png` }); const rb = await page.locator('#right').boundingBox(); await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); for (let k = 1; k <= max; k++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(800); await page.locator('#right').screenshot({ path: `tests/.out/jury-${prefix}-${k}.png` }); const at = await page.locator('#right').evaluate((e) => [e.scrollTop, e.scrollHeight - e.clientHeight]); if (at[0] >= at[1] - 2) break; } await page.locator('#right').evaluate((e) => { e.scrollTop = 0; }); };

await step(J, 'S0', async () => { await J.open(); await mapIdle(page); });

await step(J, 'O2-saisie-clavier-date', async () => {
  const date = page.locator('#timebar .tb-date'); const b = await date.boundingBox();
  J.note('format affiché par le navigateur (langue fr-FR demandée) : voir capture ; valeur=' + (await date.inputValue()));
  await page.mouse.click(b.x + 12, b.y + b.height / 2); await page.waitForTimeout(200);
  // le Chromium sans écran affiche mm/jj/aaaa hh:mm AM : on tape dans cet ordre, comme le ferait l'utilisateur qui lit le champ
  await page.keyboard.type('03152027', { delay: 70 }); await page.keyboard.type('0830A', { delay: 70 }); await page.waitForTimeout(300);
  J.note('après frappe de 03152027 0830A dans le champ : valeur=' + (await date.inputValue()) + ' ; état=' + iso((await st(['timeMs'])).timeMs));
  await page.keyboard.press('Enter'); await page.waitForTimeout(800); const afterEnter = iso((await st(['timeMs'])).timeMs);
  await page.keyboard.press('Tab'); await page.waitForTimeout(800); const afterTab = iso((await st(['timeMs'])).timeMs);
  await page.mouse.click(b.x - 30, b.y - 200); await page.waitForTimeout(800); const afterBlur = iso((await st(['timeMs'])).timeMs);
  J.note(`date appliquée : après Entrée=${afterEnter} ; après Tab=${afterTab} ; après clic ailleurs=${afterBlur} (attendu 2027-03-15T08:30)`);
  await page.locator('#timebar').screenshot({ path: 'tests/.out/jury-O2-f-date-clavier.png' });
  // flèche haut/bas dans le champ date (incrément du segment)
  await page.mouse.click(b.x + 12, b.y + b.height / 2); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(600); J.note('2× flèche haut sur le 1er segment : valeur=' + (await date.inputValue()) + ' état=' + iso((await st(['timeMs'])).timeMs) + ' (le changement est-il appliqué sans quitter le champ ?)');
  await page.mouse.click(b.x - 30, b.y - 200); await page.waitForTimeout(600); J.note('après sortie du champ : état=' + iso((await st(['timeMs'])).timeMs));
  // Espace dans le champ date : ne doit pas lancer la lecture
  await page.mouse.click(b.x + 12, b.y + b.height / 2); await page.keyboard.press('Space'); await page.waitForTimeout(400); J.note('Espace dans le champ date → playing=' + (await st(['playing'])).playing); await page.keyboard.press('Escape'); await page.mouse.click(b.x - 30, b.y - 200); if ((await st(['playing'])).playing) await click(J, '#timebar .tb-play');
});

await step(J, 'O3-O4-fiche-complete', async () => {
  await setDate('2027-03-15T08:30');
  await click(J, page.locator('#right .quickpicks button', { hasText: /Malapert/ }).first().or(page.locator('#left .siteitem', { hasText: /Malapert/ }).first()).first()); await mapIdle(page); await page.waitForTimeout(3000);
  await rightShots('O4-fiche-region');
  const per = page.locator('#right .seg.seg-full button'); J.note('périodes de la fiche : ' + JSON.stringify(await per.allInnerTexts()));
  for (let i = 0; i < await per.count(); i++) { await click(J, page.locator('#right .seg.seg-full button').nth(i)); await page.waitForTimeout(2500); J.note(`période ${i} : ` + JSON.stringify(await page.$$eval('#right .sec .stat-grid:not(.sky-stats) .stat', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))))); }
  await click(J, page.locator('#right .seg.seg-full button').nth(0));
  const picks = page.locator('#right .pick'); J.note('points favorables : ' + JSON.stringify(await picks.allInnerTexts()));
  await click(J, picks.first()); await mapIdle(page); await page.waitForTimeout(3000); await J.shot('O3-e-meilleur-compromis');
  fs.writeFileSync(`${LOG}/01b-fiche-malapert-best.txt`, (await J.text('#right')) || '');
  J.note('tour d’horizon (meilleur compromis) : ' + JSON.stringify(await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))));
  await rightShots('O4-fiche-best');
  R.scan1 = await scanText(page); if (R.scan1.length) J.note('SUSPECTS : ' + JSON.stringify(R.scan1));
  // unités et provenance : valeurs de la fiche sans étiquette
  const kv = await page.$$eval('#right .kv', (l) => l.map((e) => ({ k: e.querySelector('.kv-k')?.innerText.trim(), v: e.querySelector('.kv-v')?.innerText.replace(/\s+/g, ' ').trim(), tag: !!e.querySelector('.tag') })));
  J.note('lignes de la fiche sans étiquette de provenance : ' + JSON.stringify(kv.filter((x) => !x.tag))); J.note('toutes les lignes : ' + JSON.stringify(kv.map((x) => `${x.k} = ${x.v}`)));
  const stats = await page.$$eval('#right .stat', (l) => l.map((e) => ({ t: e.innerText.replace(/\s+/g, ' '), tag: !!e.querySelector('.tag') }))); J.note('pavés chiffrés sans étiquette de provenance propre : ' + JSON.stringify(stats.filter((x) => !x.tag).map((x) => x.t)));
});

await step(J, 'O6-animation', async () => {
  J.clicks = 0; await setDate('2027-03-15T08:30'); await pickScale(0); await mapIdle(page); await page.waitForTimeout(2500);
  await pickSpeed(5); const t0 = (await st(['timeMs'])).timeMs; const w0 = Date.now();
  await click(J, '#timebar .tb-play'); await page.waitForTimeout(8000); await J.shot('O6-a-lecture-8s'); const sA = await st(['timeMs']);
  await page.waitForTimeout(8000); await J.shot('O6-b-lecture-16s'); const sB = await st(['timeMs', 'playing']); const w1 = Date.now();
  J.note(`lecture 100 000× : +${((sB.timeMs - t0) / 86400e3).toFixed(2)} j simulés en ${((w1 - w0) / 1000).toFixed(1)} s (théorie ${(((w1 - w0) / 1000) * 100000 / 86400).toFixed(2)} j) ; 8 s : ${iso(sA.timeMs)} ; 16 s : ${iso(sB.timeMs)} ; clics pour lancer = ${J.clicks}`);
  J.note('fiche pendant la lecture : ' + JSON.stringify(await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))) + ' ; titre de section : ' + JSON.stringify(await page.$$eval('#right .sec-title', (l) => l.map((e) => e.innerText).slice(0, 1))));
  await page.locator('body').press('Space'); await page.waitForTimeout(700); J.note('Espace (focus sur le corps de page) → playing=' + (await st(['playing'])).playing);
  if ((await st(['playing'])).playing) await click(J, '#timebar .tb-play'); await page.waitForTimeout(600);
  const dEnd = iso((await st(['timeMs'])).timeMs); const thumb = await page.locator('#timebar .tb-thumb').evaluate((e) => e.style.left); J.note(`jour lunaire : après lecture date=${dEnd}, curseur à ${thumb} de la piste`);
  // laisser dépasser la fin de la fenêtre « jour lunaire » : la piste se recale-t-elle ?
  await pickSpeed(6); await click(J, '#timebar .tb-play'); await page.waitForTimeout(6000); await click(J, '#timebar .tb-play'); await page.waitForTimeout(1500); const tw = await page.locator('#timebar .tb-thumb').evaluate((e) => [e.getAttribute('aria-valuemin'), e.getAttribute('aria-valuemax'), e.style.left]); J.note(`1 000 000× 6 s en échelle jour lunaire : date=${iso((await st(['timeMs'])).timeMs)} ; fenêtre=${iso(+tw[0])}→${iso(+tw[1])} ; curseur=${tw[2]}`);
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('O6-c-jour-lunaire-recale');
  // plusieurs jours lunaires : échelle 1 an
  await pickScale(1); await page.waitForTimeout(1500); const y0 = (await st(['timeMs'])).timeMs; await click(J, '#timebar .tb-play'); await page.waitForTimeout(10000); await J.shot('O6-d-lecture-1M-an'); const y1 = await st(['timeMs']); await click(J, '#timebar .tb-play'); await page.waitForTimeout(1500);
  J.note(`1 000 000× 10 s en échelle 1 an : +${((y1.timeMs - y0) / 86400e3).toFixed(1)} j (théorie 115,7) ; date=${iso(y1.timeMs)}`);
  // passage d'année pendant la lecture
  await setDate('2027-12-31T20:00'); await pickSpeed(5); await click(J, '#timebar .tb-play'); await page.waitForTimeout(9000); const e1 = await st(['timeMs', 'playing']); if (e1.playing) await click(J, '#timebar .tb-play'); await page.waitForTimeout(2500);
  const tw2 = await page.locator('#timebar .tb-thumb').evaluate((e) => [e.getAttribute('aria-valuemin'), e.getAttribute('aria-valuemax'), e.style.left]); J.note(`passage d’année (100 000×, 9 s depuis 2027-12-31T20:00) : date=${iso(e1.timeMs)} ; fenêtre=${iso(+tw2[0])}→${iso(+tw2[1])} ; période « Année » de la fiche : ` + JSON.stringify(await page.locator('#right .seg.seg-full button').allInnerTexts()));
  await page.locator('#timebar').screenshot({ path: 'tests/.out/jury-O6-e-passage-annee.png' });
  // lecture sur le globe
  await setDate('2027-03-15T08:30'); await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(9000); await pickSpeed(5); await click(J, '#timebar .tb-play'); await page.waitForTimeout(12000); await J.shot('O6-f-globe-lecture'); const g = await st(['timeMs']); await click(J, '#timebar .tb-play'); J.note(`lecture sur le globe 12 s à 100 000× : date=${iso(g.timeMs)} (+${((g.timeMs - Date.UTC(2027, 2, 15, 8, 30)) / 86400e3).toFixed(1)} j, théorie 13,9)`);
  // lecture dans la vue Comparer
  await click(J, page.locator('#right .sheet-actions button').first()); await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(6000); await click(J, '#timebar .tb-play'); await page.waitForTimeout(8000); await J.shot('O6-g-comparer-lecture'); await click(J, '#timebar .tb-play'); await page.waitForTimeout(2000); J.note('lecture dans Comparer : date courante affichée=' + JSON.stringify(await page.$$eval('#view-compare .cmp-now', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))) + ' ; état=' + iso((await st(['timeMs'])).timeMs));
  await pickSpeed(4);
});

await step(J, 'O5-clic-globe', async () => {
  await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(8000);
  const b = await page.locator('#view-globe').boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  for (const [dx, dy] of [[120, -90], [-140, 60], [0, -150]]) { await page.mouse.move(cx + dx, cy + dy); await page.waitForTimeout(900); const cur = ((await J.text('#view-globe')) || '').replace(/\s+/g, ' ').match(/Curseur\s*([^L]*)/); await page.mouse.click(cx + dx, cy + dy); J.clicks++; await page.waitForTimeout(4000); const s = await st(['selection', 'view']); J.note(`clic globe (${dx},${dy}) : curseur=« ${cur ? cur[1].trim() : '?'} » → sélection ${s.selection?.name} [${s.selection?.kind}] (${(+s.selection?.lat).toFixed(2)}, ${(+s.selection?.lon).toFixed(2)})`); }
  await J.shot('O5-j-globe-clic-libre');
  // boutons du globe
  const btns = page.locator('#view-globe button'); const nb = await btns.count();
  for (let i = 0; i < nb; i++) { const b2 = btns.nth(i); if (!(await b2.isVisible())) continue; const lbl = (await b2.innerText()).trim() || (await b2.getAttribute('title')) || ''; await click(J, b2); await page.waitForTimeout(4500); await J.shot(`O5-k-globe-bouton-${i}`); J.note(`bouton globe ${i} « ${lbl} » : textes=` + ((await J.text('#view-globe')) || '').replace(/\s+/g, ' ').slice(0, 260)); }
  // cube d'orientation : clic
  const cube = page.locator('#view-globe canvas').nth(1); if (await cube.count()) { const cb = await cube.boundingBox(); if (cb && cb.width < 200) { await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.waitForTimeout(4500); await J.shot('O5-l-globe-cube'); J.note('clic sur le cube d’orientation : centre=' + ((await J.text('#view-globe')) || '').replace(/\s+/g, ' ').slice(0, 80)); } }
  await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2500);
});

// ------------------------------------------------------------ Scénario (a) : même site, +2 mois
await step(J, 'Ra-meme-site-2-mois', async () => {
  await page.reload({ waitUntil: 'load' }); await J.ready(); await page.waitForTimeout(2500); J.clicks = 0; const w0 = Date.now();
  await setDate('2027-03-15T08:30'); J.clicks += 1;
  await click(J, page.locator('#right .quickpicks button', { hasText: /Mons Mouton$/ }).first().or(page.locator('#right .quickpicks button').nth(4)).first()); await page.waitForTimeout(2500);
  await click(J, page.locator('#right .pick').first()); await page.waitForTimeout(2000);
  await click(J, page.locator('#right .sheet-actions button').first());
  await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(6000);
  const same = page.locator('#view-compare .cmp-top button', { hasText: /Même site|Same site/ }); J.note('bouton « même site, autres dates » : ' + (await same.innerText()) + ' ; aide=' + (await same.getAttribute('title')));
  await click(J, same); await page.waitForTimeout(8000); let c = (await st(['compare'])).compare; J.note('après « Même site, autres dates » : ' + c.map((x) => `${x.name} @ ${x.dateMs ? iso(x.dateMs) : 'date courante'}`).join(' | '));
  await J.shot('Ra-1-meme-site-auto');
  // +2 mois exactement : il faut saisir la date du scénario B à la main
  const inp = page.locator('#view-compare .cmp-card').nth(1).locator('input[type=datetime-local]'); await inp.scrollIntoViewIfNeeded(); await inp.fill('2027-05-15T08:30'); await inp.dispatchEvent('change'); J.clicks += 1; await page.waitForTimeout(8000);
  // retirer le scénario C (+3 mois) pour ne garder que A et B
  await click(J, page.locator('#view-compare .cmp-card').nth(2).locator('button[data-action=remove]')); await page.waitForTimeout(6000);
  c = (await st(['compare'])).compare; J.note(`scénario (a) prêt en ${((Date.now() - w0) / 1000).toFixed(0)} s machine, ${J.clicks} clics/saisies : ` + c.map((x) => `${x.name} @ ${x.dateMs ? iso(x.dateMs) : 'date courante'}`).join(' | '));
  await page.locator('#view-compare').evaluate((e) => { e.scrollTop = 0; }); await page.waitForTimeout(800); await J.shot('Ra-2-haut');
  const table = await page.$$eval('#view-compare table.cmp-table tr', (l) => l.map((e) => [...e.children].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' ¦ '))); fs.writeFileSync(`${LOG}/01b-Ra-table.txt`, table.join('\n')); J.note('tableau (a) :\n' + table.join('\n'));
  const b = await page.locator('#view-compare').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let k = 1; k <= 6; k++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(1500); await J.shot(`Ra-3-defile-${k}`); }
  J.note('analyse rédigée (a) : ' + JSON.stringify(await page.$$eval('#view-compare .cmp-sec', (l) => l.filter((e) => /ANALYSE|ANALYSIS/i.test(e.querySelector('h3')?.innerText || '')).map((e) => e.innerText.replace(/\s+/g, ' ')))));
  // export CSV
  await page.locator('#view-compare').evaluate((e) => { e.scrollTop = 0; });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), click(J, page.locator('#view-compare .cmp-top button', { hasText: /CSV/ }))]);
  if (dl) { const f = `${LOG}/export-compare.csv`; await dl.saveAs(f); const csv = fs.readFileSync(f, 'utf8'); J.note(`export CSV : ${dl.suggestedFilename()} (${csv.length} caractères, ${csv.split('\n').length} lignes) ; début : ` + csv.slice(0, 700).replace(/\n/g, ' ⏎ ')); if (/NaN|undefined|\[object/.test(csv)) J.note('DÉFAUT CSV : contient NaN/undefined/[object : ' + csv.split('\n').filter((l) => /NaN|undefined|\[object/.test(l)).slice(0, 5).join(' ⏎ ')); } else J.note('DÉFAUT ? export CSV : aucun téléchargement');
});

// ------------------------------------------------------------ Scénario (b) : même date, site déplacé de quelques km
await step(J, 'Rb-site-deplace', async () => {
  J.clicks = 0; const w0 = Date.now();
  await click(J, page.locator('#view-compare .cmp-top button', { hasText: /Vider|Clear/ })); await page.waitForTimeout(800); await J.shot('Rb-0-comparer-vide'); J.note('Comparer vide : ' + ((await J.text('#view-compare')) || '').replace(/\s+/g, ' ').slice(0, 600));
  await click(J, page.locator('.viewswitch button').nth(0)); await mapIdle(page); await page.waitForTimeout(2000);
  const s0 = (await st(['selection'])).selection; J.note('site de départ : ' + JSON.stringify(s0));
  await click(J, page.locator('#right .sheet-actions button').first());
  // cliquer sur la carte à ~3 km puis ~8 km du site (clics réels) ; la région est déjà sélectionnée : le clic désigne le point
  const p0 = await mapPx(page, s0.lat, s0.lon); J.note(`échelle carte : ${p0.scale.toFixed(0)} m/px`);
  for (const km of [3, 8]) { const dx = (km * 1000) / p0.scale; await page.mouse.move(p0.x + dx, p0.y); await page.waitForTimeout(600); const ro = await page.$$eval('#view-map2d .readout', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')).join('')); await page.mouse.click(p0.x + dx, p0.y); J.clicks++; await page.waitForTimeout(2500); const s = (await st(['selection'])).selection; const d = await page.evaluate(async ([a, b]) => (await import('./js/core/coords.js')).surfaceDistance(a.lat, a.lon, b.lat, b.lon), [s0, s]); J.note(`clic à +${km} km (${dx.toFixed(0)} px) : lecture=${ro} → sélection ${s.name} [${s.kind}] à ${(d / 1000).toFixed(2)} km du départ`); await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(500); }
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('Rb-1-carte-3-points');
  await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(12000);
  const c = (await st(['compare'])).compare; J.note(`scénario (b) prêt en ${((Date.now() - w0) / 1000).toFixed(0)} s machine, ${J.clicks} clics : ` + c.map((x) => `${x.name} (${(+x.lat).toFixed(3)}, ${(+x.lon).toFixed(3)})`).join(' | '));
  await page.locator('#view-compare').evaluate((e) => { e.scrollTop = 0; }); await page.waitForTimeout(800); await J.shot('Rb-2-haut');
  const table = await page.$$eval('#view-compare table.cmp-table tr', (l) => l.map((e) => [...e.children].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' ¦ '))); fs.writeFileSync(`${LOG}/01b-Rb-table.txt`, table.join('\n')); J.note('tableau (b) :\n' + table.join('\n'));
  const b = await page.locator('#view-compare').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let k = 1; k <= 3; k++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(1500); await J.shot(`Rb-3-defile-${k}`); }
  J.note('analyse rédigée (b) : ' + JSON.stringify(await page.$$eval('#view-compare .cmp-sec', (l) => l.filter((e) => /ANALYSE|ANALYSIS/i.test(e.querySelector('h3')?.innerText || '')).map((e) => e.innerText.replace(/\s+/g, ' ')))));
  // les 9 régions Artemis (tableau du bas)
  await page.locator('#view-compare').evaluate((e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(1500); await J.shot('Rb-4-bas-artemis'); const art = page.locator('#view-compare .cmp-art-run, #view-compare .cmp-art-grp button').first(); J.note('section Artemis : ' + JSON.stringify(await page.$$eval('#view-compare section', (l) => l.slice(-2).map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 900)))));
  const runBtn = page.locator('#view-compare button', { hasText: /9 régions|nine regions|Calculer|Compute|Lancer/ }).last(); if (await runBtn.count()) { J.note('bouton : ' + (await runBtn.innerText())); await runBtn.scrollIntoViewIfNeeded(); await click(J, runBtn); await page.waitForTimeout(25000); await page.locator('#view-compare').evaluate((e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(800); await J.shot('Rb-5-artemis-calcule'); const t9 = await page.$$eval('#view-compare table.cmp-art-table tr', (l) => l.map((e) => [...e.children].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' ¦ '))); fs.writeFileSync(`${LOG}/01b-artemis9.txt`, t9.join('\n')); J.note('tableau des 9 régions :\n' + t9.join('\n')); const th = page.locator('#view-compare table.cmp-art-table th button, #view-compare table.cmp-art-table th.cmp-sort').nth(2); if (await th.count()) { await click(J, th); await page.waitForTimeout(1200); await J.shot('Rb-6-artemis-tri'); } }
  const sc = await scanText(page); if (sc.length) J.note('SUSPECTS : ' + JSON.stringify(sc));
});

fs.writeFileSync(`${LOG}/01b.json`, JSON.stringify(R, null, 1));
await J.finish('01b-objectifs-suite');
