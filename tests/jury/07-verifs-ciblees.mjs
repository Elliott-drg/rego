// Vérifications ciblées de défauts soupçonnés pendant les parcours précédents (reproduction minimale, vrais gestes).
import fs from 'node:fs';
import { launch, step, click, mapIdle, mapPx, scanText, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const st = (k) => J.state(k); const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const op = (id) => page.evaluate(async (id) => (await import('./js/layers/manager.js')).layers.get(id).opacity, id);
const setDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(700); };

await step(J, 'V0', async () => { await J.open(); await mapIdle(page); await setDate('2027-03-15T08:30'); });

// JURY_ONLY=V4,V5 node … : ne rejoue que certaines étapes (V0 est toujours jouée).
const ONLY = (process.env.JURY_ONLY || '').split(',').filter(Boolean);
const ensureClosed = async () => { for (let k = 0; k < 3 && (await page.locator('.modal, .tour-card, .popover.settings').count()); k++) { await page.keyboard.press('Escape'); const b = page.locator('.modal-head .iconbtn').first(); if (await b.count()) await b.click().catch(() => {}); if (await page.locator('.popover.settings').count()) await page.mouse.click(5, 400); await page.waitForTimeout(300); } };
const S = (name, fn) => (!ONLY.length || ONLY.some((o) => name.startsWith(o)) ? step(J, name, async () => { await ensureClosed(); await fn(); }) : null);

await S('V1-curseur-opacite', async () => {
  const lab = page.locator('#left label[for="ly-elevation"]'); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await mapIdle(page); await page.waitForTimeout(800);
  const slider = () => lab.locator('xpath=..').locator('input[type=range]');
  const b = await slider().boundingBox(); const v0 = await op('elevation'); const val0 = await slider().inputValue();
  // saisir la poignée là où elle se trouve, puis glisser lentement vers la gauche (20 pas)
  const thumbX = b.x + 8 + (b.width - 16) * (+val0 / 100); await page.mouse.move(thumbX, b.y + b.height / 2); await page.mouse.down(); const trace = [];
  for (let k = 1; k <= 20; k++) { await page.mouse.move(thumbX - (b.width * 0.6 * k) / 20, b.y + b.height / 2); await page.waitForTimeout(60); if (k % 5 === 0) trace.push([k, +(await op('elevation')).toFixed(2), await page.evaluate(() => document.querySelectorAll('#left input[type=range]').length)]); }
  await page.mouse.up(); await page.waitForTimeout(400); const v1 = await op('elevation');
  J.note(`glisser la poignée d’opacité de ${val0} % vers −60 % de la largeur : opacité ${v0} → ${v1.toFixed(2)} (attendu ≈ ${(Math.max(0, +val0 / 100 - 0.65)).toFixed(2)}) ; trace [pas, opacité, nb curseurs] = ${JSON.stringify(trace)}`);
  const same = await page.evaluate(() => { const e = document.querySelector('#left input[type=range]'); if (!window.__sl) { window.__sl = e; return 'premier'; } return window.__sl === e ? 'même élément' : 'élément REMPLACÉ'; });
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height / 2); await page.waitForTimeout(300); const same2 = await page.evaluate(() => { const e = document.querySelector('#left input[type=range]'); return window.__sl === e ? 'même élément' : 'élément REMPLACÉ à chaque changement'; });
  J.note(`clic au milieu de la glissière → opacité ${(await op('elevation')).toFixed(2)} ; ${same} → ${same2}`);
  // clavier : focus puis 5× flèche gauche
  await slider().focus(); for (let k = 0; k < 5; k++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(120); } J.note(`5× flèche gauche au clavier → opacité ${(await op('elevation')).toFixed(2)} (attendu −0,05) ; focus encore sur le curseur : ` + (await page.evaluate(() => document.activeElement?.type === 'range')));
  await J.shot('V1-opacite'); await click(J, page.locator('#left label[for="ly-elevation"]'));
});

await S('V2-comparaison-4e-site', async () => {
  for (const name of [/Haworth/, /Malapert/, /Slater/, /Nobile Rim 1/]) { const it = page.locator('#left .siteitem', { hasText: name }).first(); await it.scrollIntoViewIfNeeded(); await click(J, it); await page.waitForTimeout(1200); await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(700); J.note(`ajout ${name} → ${(await st(['compare'])).compare.map((c) => c.name).join(' | ')} ; message : ` + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText)))); }
  await J.shot('V2-4e-ajout'); await page.waitForTimeout(4200);
  // re-cliquer « Dans la comparaison » sur un site déjà présent : doublon ?
  await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(500); J.note('2e clic sur le bouton d’un site déjà comparé (« ' + (await page.locator('#right .sheet-actions button').first().innerText()).trim() + ' ») → ' + (await st(['compare'])).compare.map((c) => c.name).join(' | ') + ' ; message : ' + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
});

await S('V3-fenetre-plus-courte-qu-une-heure', async () => {
  // le prochain lever/coucher est cherché par pas d'une heure : existe-t-il, sur 60 jours, une éclipse du Soleil par le relief < 1 h que le compte à rebours saute ?
  const r = await page.evaluate(async () => { const e = await import('./js/science/engine.js'); const sites = (await import('./js/data/sites.js')).sitesOfKind('artemis'); const out = []; for (const s of sites) { const site = { lat: s.lat, lon: s.lon }; const t0 = Date.UTC(2027, 2, 1); let prev = e.siteNow(site, t0).sun.fraction > 0, start = t0; const short = []; for (let m = 5; m <= 60 * 24 * 60; m += 5) { const t = t0 + m * 60000; const v = e.siteNow(site, t).sun.fraction > 0; if (v !== prev) { const dur = (t - start) / 60000; if (dur < 60 && start !== t0) short.push([new Date(start).toISOString().slice(0, 16), dur, prev ? 'jour' : 'nuit']); start = t; prev = v; } } out.push([s.name, short.length, short.slice(0, 3)]); } return out; });
  J.note('épisodes Soleil visible/masqué de moins de 60 min sur 60 jours (pas de 5 min), par région : ' + JSON.stringify(r));
  const hit = r.find((x) => x[1] > 0);
  if (hit) { const [name, , list] = hit; const [startIso] = list[0]; await click(J, page.locator('#left .siteitem', { hasText: name }).first()); await page.waitForTimeout(1200); const before = new Date(Date.parse(startIso + ':00Z') - 3 * 3600e3).toISOString().slice(0, 16); await setDate(before); await page.waitForTimeout(1500); J.note(`${name}, 3 h avant un épisode de ${list[0][1]} min (${list[0][2]}) débutant à ${startIso} : fiche = ` + JSON.stringify(await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))))); await J.shot('V3-episode-court'); }
});

await S('V4-divers', async () => {
  // Échap ferme-t-il la fiche ? la recherche ? Tab : ordre de focus des premiers éléments
  // fenêtre Énergie ouverte au clic : où va le focus clavier ? (la fenêtre est annoncée aria-modal)
  await click(J, page.locator('#header .navpills button').nth(1)); await page.waitForTimeout(2500); const inModal0 = await page.evaluate(() => !!document.activeElement?.closest('.modal'));
  const order = []; for (let k = 0; k < 14; k++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return `${e.tagName.toLowerCase()}:${(e.innerText || e.title || e.getAttribute('aria-label') || e.placeholder || '').trim().slice(0, 18)}${cs.outlineStyle === 'none' && cs.boxShadow === 'none' ? ' [SANS repère de focus]' : ''}`; })); }
  const inModal = await page.evaluate(() => !!document.activeElement?.closest('.modal'));
  J.note(`fenêtre Énergie ouverte : focus dans la fenêtre à l’ouverture=${inModal0} ; après 14 Tab=${inModal} ; ordre de tabulation : ` + JSON.stringify(order)); await J.shot('V4-focus'); await ensureClosed();
  // titre de l'onglet et langue du document
  J.note('document : title=' + (await page.title()) + ' ; html lang=' + (await page.evaluate(() => document.documentElement.lang)) + ' ; état lang=' + (await st(['lang'])).lang);
  await click(J, page.locator('#header .lang-seg button').nth(1)); await page.waitForTimeout(500); J.note('après EN : html lang=' + (await page.evaluate(() => document.documentElement.lang)) + ' ; aria-label des panneaux : ' + JSON.stringify(await page.$$eval('aside', (l) => l.map((e) => e.getAttribute('aria-label')))));
  // noms de sites et de régions : traduits ? (liste en EN vs FR)
  J.note('EN : sites = ' + JSON.stringify(await page.$$eval('#left .siteitem .siteitem-name', (l) => l.map((e) => e.innerText).slice(0, 21))));
  await click(J, page.locator('#header .lang-seg button').nth(0)); await page.waitForTimeout(500);
  J.note('FR : sites = ' + JSON.stringify(await page.$$eval('#left .siteitem .siteitem-name', (l) => l.map((e) => e.innerText).slice(0, 21))));
});


await S('V6-neuf-regions-artemis', async () => {
  // le tableau des 9 régions est replié tout en bas de la vue Comparer
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(1200); await click(J, page.locator('#right .sheet-actions button').first());
  await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(6000);
  const folds = page.locator('#view-compare .cmp-fold'); J.note('sections repliées : ' + JSON.stringify(await folds.evaluateAll((l) => l.map((e) => [e.innerText.replace(/\s+/g, ' ').slice(0, 60), Math.round(e.getBoundingClientRect().top + document.querySelector('#view-compare').scrollTop)]))));
  const sum = page.locator('#view-compare .cmp-fold summary, #view-compare .cmp-fold button').first(); await sum.scrollIntoViewIfNeeded(); const t0 = Date.now(); await click(J, sum); await page.waitForTimeout(1500); await J.shot('V6-a-artemis-ouvert');
  for (let k = 0; k < 30; k++) { const busy = await page.locator('#view-compare .cmp-art-progress').count(); const rows = await page.locator('#view-compare table.cmp-art-table tbody tr').count(); if (rows >= 9 && !busy) break; await page.waitForTimeout(2000); }
  J.note(`tableau des 9 régions affiché en ${((Date.now() - t0) / 1000).toFixed(0)} s ; contrôles : ` + JSON.stringify(await page.$$eval('#view-compare .cmp-fold button', (l) => l.map((e) => e.innerText.trim().slice(0, 40) || e.title).slice(0, 30))));
  const run = page.locator('#view-compare .cmp-art-run button, #view-compare button.cmp-art-run').first(); if (await run.count()) { J.note('bouton de calcul : « ' + (await run.innerText()) + ' »'); await click(J, run); for (let k = 0; k < 40; k++) { await page.waitForTimeout(2000); if (!(await page.locator('#view-compare .cmp-art-progress').count())) break; } }
  const t9 = await page.$$eval('#view-compare table.cmp-art-table tr', (l) => l.map((e) => [...e.children].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' ¦ '))); fs.writeFileSync(`${LOG}/07-artemis9.txt`, t9.join('\n')); J.note('tableau des 9 régions :\n' + t9.join('\n'));
  await page.locator('#view-compare .cmp-fold').first().scrollIntoViewIfNeeded(); await page.waitForTimeout(600); await J.shot('V6-b-artemis-tableau');
  const sortBtn = page.locator('#view-compare table.cmp-art-table .cmp-sort').nth(3); if (await sortBtn.count()) { await click(J, sortBtn); await page.waitForTimeout(800); J.note('tri sur « ' + (await sortBtn.innerText()).trim() + ' » : ordre = ' + JSON.stringify(await page.$$eval('#view-compare table.cmp-art-table tbody tr', (l) => l.map((e) => e.children[0].innerText.replace(/\s+/g, ' ').slice(0, 30))))); await J.shot('V6-c-artemis-tri'); }
  const vari = page.locator('#view-compare .cmp-variant button'); if (await vari.count()) { J.note('variantes de point : ' + JSON.stringify(await vari.allInnerTexts())); await click(J, vari.nth(1)); await page.waitForTimeout(8000); await J.shot('V6-d-artemis-variante'); }
  const sc = await scanText(page); if (sc.length) J.note('SUSPECTS : ' + JSON.stringify(sc));
  const m2 = page.locator('#view-compare .cmp-fold').nth(1).locator('summary, button').first(); if (await m2.count()) { await m2.scrollIntoViewIfNeeded(); await click(J, m2); await page.waitForTimeout(800); await J.shot('V6-e-methode'); J.note('méthode et limites : ' + (await page.locator('#view-compare .cmp-fold').nth(1).innerText()).replace(/\s+/g, ' ').slice(0, 1500)); }
  await page.evaluate(() => window.RF.set({ compare: [] })); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(1500);
});

await S('V5-fluidite-vitesse-max', async () => {
  // Qui bloque l'interface à 1 000 000× ? On mesure images/s et tâches longues dans plusieurs configurations (le WebGL logiciel fausse la carte : la vue Comparer et le panneau fermé servent de témoins).
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(1500); await setDate('2027-03-15T08:30');
  await page.evaluate(() => { window.__m = { raf: 0, long: [] }; const tick = () => { window.__m.raf++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); });
  const pickSpeed = async (i) => { const b = page.locator('#timebar .tb-speed-seg button').nth(i); if (await b.isVisible()) await b.click(); else await page.locator('#timebar .tb-speed-select').selectOption({ index: i }); };
  const pickScale = async (i) => { const b = page.locator('#timebar .tb-scale-seg button').nth(i); if (await b.isVisible()) await b.click(); else await page.locator('#timebar .tb-scale-select').selectOption({ index: i }); };
  const measure = async (label, secs = 10) => { await page.evaluate(() => { window.__m.raf = 0; window.__m.long = []; }); const t0 = (await st(['timeMs'])).timeMs, w0 = Date.now(); await page.evaluate(() => window.RF.set({ playing: true })); await page.waitForTimeout(secs * 1000); const a = Date.now(); await page.evaluate(() => window.RF.set({ playing: false })); const lag = Date.now() - a; const m = await page.evaluate(() => ({ raf: window.__m.raf, n: window.__m.long.length, max: Math.max(0, ...window.__m.long), sum: window.__m.long.reduce((x, y) => x + y, 0) })); const dt = (Date.now() - w0) / 1000; const t1 = (await st(['timeMs'])).timeMs; J.note(`${label} : ${(m.raf / dt).toFixed(1)} images/s ; tâches longues ${m.n} (max ${m.max} ms, ${(100 * m.sum / (dt * 1000)).toFixed(0)} % du temps) ; +${((t1 - t0) / 86400e3).toFixed(1)} j simulés en ${dt.toFixed(1)} s ; délai de réponse ${lag} ms`); await page.waitForTimeout(1500); };
  await pickSpeed(6);
  await pickScale(1); await measure('carte 2D, fiche ouverte (période jour lunaire), échelle 1 an, 1 000 000×');
  await pickScale(0); await measure('carte 2D, fiche ouverte, échelle jour lunaire, 1 000 000×');
  await click(J, '#header .header-right > .iconbtn:last-child'); await page.waitForTimeout(600); await measure('carte 2D, fiche FERMÉE, échelle jour lunaire, 1 000 000×'); await click(J, '#header .header-right > .iconbtn:last-child');
  await click(J, page.locator('#right .sheet-actions button').first()); await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(6000);
  await measure('vue Comparer (pas de WebGL), fiche ouverte, échelle jour lunaire, 1 000 000×');
  await click(J, '#header .header-right > .iconbtn:last-child'); await page.waitForTimeout(600); await measure('vue Comparer, fiche FERMÉE, échelle jour lunaire, 1 000 000×'); await click(J, '#header .header-right > .iconbtn:last-child');
  await pickSpeed(5); await measure('vue Comparer, fiche ouverte, 100 000×');
  await page.evaluate(() => window.RF.set({ selection: null })); await page.waitForTimeout(500); await pickSpeed(6); await measure('vue Comparer, AUCUN site sélectionné (1 scénario), 1 000 000×');
  await page.evaluate(() => window.RF.set({ compare: [] })); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2000); await measure('carte 2D seule, aucun site, 1 000 000× (coût du WebGL logiciel seul)');
  await pickSpeed(4); await pickScale(1);
});

await J.finish('07-verifs-ciblees');
