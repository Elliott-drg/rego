// Les 7 objectifs du défi NASA, de bout en bout, avec de vrais clics (1440×900, navigateur en français).
import fs from 'node:fs';
import { launch, step, click, mapIdle, mapPx, scanText, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const R = {};
const sel = () => J.state(['selection', 'view', 'timeMs', 'playing', 'speed', 'timeScale', 'lang', 'mode', 'compare']);
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const rightText = async () => (await J.text('#right')) || '';

await step(J, 'O0-chargement', async () => {
  const t = Date.now(); await page.goto('http://127.0.0.1:8231/', { waitUntil: 'load' });
  await page.waitForTimeout(700); await J.shot('O0-a-chargement-700ms');
  await J.ready(); R.loadS = (Date.now() - t) / 1000; J.note(`appli prête en ${R.loadS.toFixed(1)} s`);
  await page.waitForTimeout(1500); await J.shot('O0-b-toast-bienvenue');
  await mapIdle(page); await page.waitForTimeout(2500); await J.shot('O0-c-accueil');
  const s = await sel(); J.note(`état initial : lang=${s.lang} mode=${s.mode} view=${s.view} timeScale=${s.timeScale} speed=${s.speed} date=${iso(s.timeMs)}`);
  J.note('en-tête : ' + (await J.text('#header')).replace(/\s+/g, ' | '));
  J.note('droite (vide) : ' + (await rightText()).replace(/\s+/g, ' ').slice(0, 500));
  J.note('résumés panneau gauche : ' + JSON.stringify(await page.$$eval('#left details > summary', (l) => l.map((e) => [e.innerText.trim().replace(/\s+/g, ' '), e.parentElement.open]))));
});

// ------------------------------------------------------------ Objectif 1 : sites notables, coordonnées libres, comparaison
await step(J, 'O1-liste-sites', async () => {
  J.clicks = 0;
  // un planificateur cherche « Apollo » dans la liste de gauche : il faut déplier « historiques »
  const sums = page.locator('#left details > summary');
  const n = await sums.count();
  for (let i = 0; i < n; i++) { const open = await sums.nth(i).evaluate((e) => e.parentElement.open); const hasSites = await sums.nth(i).evaluate((e) => !!e.parentElement.querySelector('.sitelist, .dim')); const txt = (await sums.nth(i).innerText()).trim(); if (!open && /mission|histor|apollo|poser|land/i.test(txt)) { await sums.nth(i).scrollIntoViewIfNeeded(); await click(J, sums.nth(i)); J.note(`déplié : « ${txt} » (contient liste : ${hasSites})`); } }
  await page.waitForTimeout(500);
  const sites = await page.$$eval('#left .siteitem', (l) => l.map((e) => e.innerText.trim().replace(/\s+/g, ' ')));
  J.note(`sites listés (${sites.length}) : ` + sites.join(' ; '));
  R.sites = sites;
  await page.locator('#left').evaluate((e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(300); await J.shot('O1-a-listes-depliees');
  // clic sur un site du pôle Sud d'une mission récente
  const im = page.locator('#left .siteitem', { hasText: /IM-2|Athena|Chandrayaan-3|Odysseus|IM-1/ }).first();
  if (await im.count()) { const name = (await im.innerText()).replace(/\s+/g, ' '); await im.scrollIntoViewIfNeeded(); await click(J, im); await mapIdle(page); await page.waitForTimeout(2500); const s = await sel(); J.note(`clic « ${name} » → sélection ${s.selection?.name} (${s.selection?.lat}, ${s.selection?.lon}) vue=${s.view}`); await J.shot('O1-b-mission-recente'); }
  // clic sur Apollo 11 (hémisphère nord → bascule globe attendue)
  const ap = page.locator('#left .siteitem', { hasText: /Apollo 11/ }).first();
  if (await ap.count()) { await ap.scrollIntoViewIfNeeded(); await click(J, ap); await page.waitForTimeout(9000); const s = await sel(); J.note(`clic « Apollo 11 » → sélection ${s.selection?.name} vue=${s.view}`); await J.shot('O1-c-apollo11-globe'); J.note('fiche Apollo 11 : ' + (await rightText()).replace(/\s+/g, ' ').slice(0, 900)); }
  else J.note('DÉFAUT ? pas d’entrée « Apollo 11 » dans le panneau gauche');
  J.note(`clics pour : déplier + choisir un site récent + Apollo 11 = ${J.clicks}`);
});

await step(J, 'O1-coordonnees-libres', async () => {
  J.clicks = 0;
  await click(J, '#header .searchbox input'); await page.keyboard.type('85.4 S 31.8 E', { delay: 40 }); await page.waitForTimeout(600);
  await J.shot('O1-d-recherche-coords');
  J.note('propositions : ' + JSON.stringify(await page.$$eval('.search-results .search-item', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))));
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  let s = await sel(); J.note(`après Entrée : sélection ${JSON.stringify(s.selection)} vue=${s.view}`);
  if (s.view !== 'map2d') J.note('la vue reste sur le globe alors que le point est au pôle Sud (pas de retour automatique à la carte 2D)');
  await page.waitForTimeout(6000); await J.shot('O1-e-point-libre');
  J.note('fiche point libre (début) : ' + (await rightText()).replace(/\s+/g, ' ').slice(0, 700));
  J.note(`clics+saisie pour un point libre : ${J.clicks} clic + 13 touches + Entrée`);
});

await step(J, 'O1-comparer', async () => {
  J.clicks = 0;
  // 1er scénario : le point libre courant
  const addBtn = page.locator('#right .sheet-actions button').first();
  J.note('bouton d’action n°1 de la fiche : « ' + (await addBtn.innerText()).trim() + ' »');
  await click(J, addBtn); await page.waitForTimeout(800); await J.shot('O1-f-ajoute-comparaison');
  // 2e : une région Artemis depuis la liste
  const a1 = page.locator('#left .siteitem').first(); await a1.scrollIntoViewIfNeeded(); const n1 = (await a1.innerText()).replace(/\s+/g, ' '); await click(J, a1); await page.waitForTimeout(2500);
  await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(600);
  // 3e : une autre
  const a2 = page.locator('#left .siteitem').nth(4); await a2.scrollIntoViewIfNeeded(); const n2 = (await a2.innerText()).replace(/\s+/g, ' '); await click(J, a2); await page.waitForTimeout(2500);
  await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(600);
  J.note(`ajoutés : point libre, « ${n1} », « ${n2} »`);
  // ouvrir la vue Comparer par la bascule de vue
  const vs = page.locator('.viewswitch button'); J.note('bascule de vues : ' + JSON.stringify(await vs.allInnerTexts()));
  await click(J, vs.nth(2)); await page.waitForTimeout(12000);
  const s = await sel(); J.note(`vue=${s.view} ; scénarios=${s.compare.map((c) => c.name).join(' | ')}`);
  await J.shot('O1-g-comparer-haut');
  const cmpText = (await J.text('#view-compare')) || ''; fs.writeFileSync(`${LOG}/01-compare-text.txt`, cmpText);
  J.note('vue Comparer, longueur du texte : ' + cmpText.length + ' ; titres : ' + JSON.stringify(await page.$$eval('#view-compare h3', (l) => l.map((e) => e.innerText.trim()).slice(0, 30))));
  // défilement de la vue Comparer, capture par écran
  const scroller = await page.evaluate(() => { const v = document.querySelector('#view-compare'); let best = v; for (const e of v.querySelectorAll('*')) { if (e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) { best = e; break; } } best.setAttribute('data-jury-scroll', '1'); return { sh: best.scrollHeight, ch: best.clientHeight, cls: best.className }; });
  J.note('zone défilante Comparer : ' + JSON.stringify(scroller));
  const box = await page.locator('#view-compare').boundingBox();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 700); await page.waitForTimeout(1800); await J.shot(`O1-h-comparer-defile-${k}`); const at = await page.evaluate(() => { const e = document.querySelector('[data-jury-scroll]'); return [e.scrollTop, e.scrollHeight - e.clientHeight]; }); if (at[0] >= at[1] - 2) break; }
  J.note(`clics pour comparer 3 sites : ${J.clicks}`);
  // 4e ajout : limite de 3 ?
  await click(J, vs.nth(0)); await page.waitForTimeout(3000);
  const a3 = page.locator('#left .siteitem').nth(2); await a3.scrollIntoViewIfNeeded(); await click(J, a3); await page.waitForTimeout(2000);
  await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(700);
  const s2 = await sel(); J.note(`4e ajout : ${s2.compare.length} scénarios (${s2.compare.map((c) => c.name).join(' | ')}) ; toasts : ` + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
  await J.shot('O1-i-4e-ajout');
});

// ------------------------------------------------------------ Objectif 2 : date et heure, autres jours lunaires et saisons
await step(J, 'O2-date-heure', async () => {
  J.clicks = 0;
  const first = page.locator('#left .siteitem').first(); await first.scrollIntoViewIfNeeded(); await click(J, first); await mapIdle(page); await page.waitForTimeout(2000);
  const date = page.locator('#timebar .tb-date');
  J.note('champ date : valeur=' + (await date.inputValue()) + ' ; libellé voisin=' + JSON.stringify(await page.$$eval('#timebar .tb-group-time *', (l) => l.filter((e) => e.children.length === 0 && e.innerText).map((e) => e.innerText.trim()))));
  // saisie clavier comme un humain : clic dans le champ puis frappe jj mm aaaa hh mm
  await click(J, date); await page.keyboard.press('Control+A');
  await page.keyboard.type('15032027', { delay: 60 }); await page.keyboard.press('Tab'); await page.keyboard.type('0830', { delay: 60 });
  await page.waitForTimeout(400); const typed = await date.inputValue(); J.note(`après frappe « 15032027 Tab 0830 » : champ=${typed}`);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300); await page.locator('#main').click({ position: { x: 5, y: 5 } }).catch(() => {}); await page.waitForTimeout(1500);
  let s = await sel(); J.note(`date d’état après frappe : ${iso(s.timeMs)} (attendu 2027-03-15T08:30)`);
  if (iso(s.timeMs) !== '2027-03-15T08:30') { await date.fill('2027-03-15T08:30'); await date.dispatchEvent('change'); await page.waitForTimeout(1500); s = await sel(); J.note(`après fill() : ${iso(s.timeMs)}`); }
  await mapIdle(page); await page.waitForTimeout(2500); await J.shot('O2-a-date-saisie');
  J.note('barre de temps (texte) : ' + (await J.text('#timebar')).replace(/\s+/g, ' | '));
  // échelles : jour lunaire, 1 an, 10 ans
  const scales = page.locator('#timebar .tb-scale-seg button'); J.note('échelles : ' + JSON.stringify(await scales.allInnerTexts()) + ' visibles=' + (await scales.first().isVisible()));
  for (let i = 0; i < 3; i++) { await click(J, scales.nth(i)); await page.waitForTimeout(7000); const st = await sel(); J.note(`échelle ${st.timeScale} ; busy=` + JSON.stringify(await page.$$eval('#timebar .tb-busy', (l) => l.map((e) => [e.className, e.innerText])))); await page.locator('#timebar').screenshot({ path: `tests/.out/jury-O2-b-echelle-${i}.png` }).catch(() => {}); }
  // glisser le curseur à la souris sur l'échelle 1 an
  await click(J, scales.nth(1)); await page.waitForTimeout(4000);
  const tr = await page.locator('#timebar .tb-track').boundingBox(); const th = await page.locator('#timebar .tb-thumb').boundingBox();
  await page.mouse.move(th.x + th.width / 2, th.y + th.height / 2); await page.mouse.down(); for (let k = 1; k <= 12; k++) { await page.mouse.move(th.x + th.width / 2 + (tr.width * 0.4 * k) / 12, th.y + th.height / 2); await page.waitForTimeout(120); } await J.shot('O2-c-glisser-curseur'); await page.mouse.up(); await page.waitForTimeout(2500);
  s = await sel(); J.note(`après glisser du curseur de +40 % de la piste (1 an) : ${iso(s.timeMs)} playing=${s.playing}`);
  // clic direct sur la piste à 10 %
  await page.mouse.click(tr.x + tr.width * 0.1, tr.y + tr.height * 0.6); J.clicks++; await page.waitForTimeout(2500); s = await sel(); J.note(`clic sur la piste à 10 % : ${iso(s.timeMs)}`);
  // survol : infobulle
  await page.mouse.move(tr.x + tr.width * 0.63, tr.y + tr.height * 0.6); await page.waitForTimeout(700); J.note('infobulle au survol de la piste : ' + JSON.stringify(await page.$$eval('#timebar .tb-tip', (l) => l.map((e) => [e.className, e.innerText]))));
  await page.locator('#timebar').screenshot({ path: 'tests/.out/jury-O2-d-survol-piste.png' }).catch(() => {});
  // clavier sur le curseur
  await page.locator('#timebar .tb-thumb').focus(); const t0 = (await sel()).timeMs; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500); const t1 = (await sel()).timeMs; await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(500); const t2 = (await sel()).timeMs; await page.keyboard.press('PageUp'); await page.waitForTimeout(500); const t3 = (await sel()).timeMs;
  J.note(`clavier sur le curseur (1 an) : → = +${((t1 - t0) / 3600e3).toFixed(1)} h ; Maj+→ = +${((t2 - t1) / 3600e3).toFixed(1)} h ; PageUp = ${((t3 - t2) / 3600e3).toFixed(1)} h`);
  // bouton Maintenant
  await click(J, '#timebar .tb-now'); await page.waitForTimeout(1500); s = await sel(); J.note(`bouton Maintenant → ${iso(s.timeMs)} (horloge réelle ${iso(Date.now())})`);
  // sauts : prochain coucher du Soleil / perte de la Terre
  const jumps = page.locator('#timebar .tb-jump'); J.note('boutons de saut : ' + JSON.stringify(await jumps.evaluateAll((l) => l.map((e) => [e.innerText.trim(), e.title, e.disabled]))));
  for (let i = 0; i < 2; i++) { const before = (await sel()).timeMs; await click(J, jumps.nth(i)); await page.waitForTimeout(2500); const after = (await sel()).timeMs; J.note(`saut ${i} : ${iso(before)} → ${iso(after)} (+${((after - before) / 86400e3).toFixed(2)} j) ; libellé ensuite « ${(await jumps.nth(i).innerText()).trim()} » ; toasts=` + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText)))); }
  await J.shot('O2-e-apres-sauts');
  J.note(`clics objectif 2 : ${J.clicks}`);
});

// ------------------------------------------------------------ Objectifs 3 et 4 : Soleil/Terre vs horizon, temps restants, métriques
await step(J, 'O3-O4-horizon-metriques', async () => {
  await page.locator('#timebar .tb-date').fill('2027-03-15T08:30'); await page.locator('#timebar .tb-date').dispatchEvent('change'); await page.waitForTimeout(800);
  // région Artemis (centre) puis « meilleur compromis »
  const first = page.locator('#left .siteitem', { hasText: /Malapert/ }).first(); await first.scrollIntoViewIfNeeded(); await click(J, first); await mapIdle(page); await page.waitForTimeout(3500);
  await page.locator('#right').evaluate((e) => { e.scrollTop = 0; });
  await J.shot('O3-a-fiche-region');
  await page.locator('#right').screenshot({ path: 'tests/.out/jury-O3-b-fiche-haut.png' });
  const rt = await rightText(); fs.writeFileSync(`${LOG}/01-fiche-malapert.txt`, rt);
  J.note('fiche Malapert (texte complet dans out/01-fiche-malapert.txt) ; tour d’horizon : ' + JSON.stringify(await page.$$eval('#right .skyhost', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 900)))));
  J.note('boutons du tour d’horizon : ' + JSON.stringify(await page.$$eval('#right .skyhost button', (l) => l.map((e) => [e.innerText.trim(), e.title, e.getAttribute('aria-pressed')]))));
  // survol du panorama
  const cv = await page.locator('#right .skyhost canvas').first().boundingBox();
  if (cv) { for (const fx of [0.2, 0.5, 0.8]) { await page.mouse.move(cv.x + cv.width * fx, cv.y + cv.height * 0.5); await page.waitForTimeout(500); J.note(`survol panorama x=${fx} : ` + JSON.stringify(await page.$$eval('#right .sky-readout', (l) => l.map((e) => [e.classList.contains('hidden'), e.innerText.replace(/\s+/g, ' ')])))); } await page.locator('#right .skyhost').screenshot({ path: 'tests/.out/jury-O3-c-panorama-survol.png' }); }
  // autres boutons (modes) du panorama
  const sb = page.locator('#right .skyhost .seg button'); const nb = await sb.count();
  for (let i = 0; i < nb; i++) { await click(J, sb.nth(i)); await page.waitForTimeout(1500); await page.locator('#right .skyhost').screenshot({ path: `tests/.out/jury-O3-d-panorama-mode-${i}.png` }); }
  if (nb) await click(J, sb.nth(0));
  // défilement de la fiche, écran par écran
  const rb = await page.locator('#right').boundingBox(); await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  for (let k = 1; k <= 8; k++) { await page.mouse.wheel(0, 640); await page.waitForTimeout(900); await page.locator('#right').screenshot({ path: `tests/.out/jury-O4-fiche-defile-${k}.png` }); const at = await page.locator('#right').evaluate((e) => [e.scrollTop, e.scrollHeight - e.clientHeight]); if (at[0] >= at[1] - 2) break; }
  // période : jour lunaire / année
  await page.locator('#right').evaluate((e) => { e.scrollTop = 0; });
  const per = page.locator('#right .seg.seg-full button'); J.note('périodes de la fiche : ' + JSON.stringify(await per.allInnerTexts()));
  for (let i = 0; i < await per.count(); i++) { await click(J, per.nth(i)); await page.waitForTimeout(2500); J.note(`période ${i} : ` + JSON.stringify(await page.$$eval('#right .sec .stat-grid:not(.sky-stats) .stat', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))))); }
  // point « meilleur compromis »
  const picks = page.locator('#right .pick'); J.note('points favorables : ' + JSON.stringify(await picks.allInnerTexts()));
  if (await picks.count()) { await click(J, picks.first()); await mapIdle(page); await page.waitForTimeout(3000); await J.shot('O3-e-meilleur-compromis'); fs.writeFileSync(`${LOG}/01-fiche-malapert-best.txt`, await rightText()); J.note('tour d’horizon (meilleur compromis) : ' + JSON.stringify(await page.$$eval('#right .skyhost', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 900))))); }
});

// ------------------------------------------------------------ Objectif 5 : carte 2D, vue 3D
await step(J, 'O5-carte-2D', async () => {
  const box = await page.locator('#view-map2d').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // molette : zoom avant 3 crans, glisser, zoom arrière
  await page.mouse.move(cx, cy); for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(700); }
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('O5-a-zoom-molette'); J.note('vue après 3 crans de molette : ' + JSON.stringify(await page.evaluate(() => window.RF.views.map2d.perf.view)));
  await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 10; k++) { await page.mouse.move(cx + 18 * k, cy + 9 * k); await page.waitForTimeout(80); } await page.mouse.up();
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('O5-b-glisser'); J.note('vue après glisser : ' + JSON.stringify(await page.evaluate(() => window.RF.views.map2d.perf.view)) + ' sélection inchangée : ' + (await sel()).selection?.name);
  // survol : lecture sous le curseur
  await page.mouse.move(cx - 120, cy - 60); await page.waitForTimeout(900); J.note('lecture sous le curseur : ' + JSON.stringify(await page.$$eval('#view-map2d .readout', (l) => l.map((e) => [e.classList.contains('hidden'), e.innerText.replace(/\s+/g, ' ')]))));
  await J.shot('O5-c-survol-lecture');
  // boutons de zoom
  const zb = page.locator('#view-map2d .zoomctl button'); J.note('boutons zoom : ' + JSON.stringify(await zb.evaluateAll((l) => l.map((e) => [e.title, e.disabled]))));
  for (let i = 0; i < await zb.count(); i++) { await click(J, zb.nth(i)); await page.waitForTimeout(1200); J.note(`bouton zoom ${i} → échelle ${(await page.evaluate(() => window.RF.views.map2d.perf.view.scale)).toFixed(0)} m/px`); }
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('O5-d-apres-boutons-zoom');
});
await step(J, 'O5-globe-3D', async () => {
  const vs = page.locator('.viewswitch button'); await click(J, vs.nth(1)); await page.waitForTimeout(12000); await J.shot('O5-e-globe');
  J.note('globe : contrôles = ' + JSON.stringify(await page.$$eval('#view-globe button, #view-globe select, #view-globe input', (l) => l.filter((e) => e.getBoundingClientRect().width > 0).map((e) => [e.innerText.trim().slice(0, 30), e.title || e.getAttribute('aria-label') || '', e.type]))));
  J.note('globe : textes = ' + ((await J.text('#view-globe')) || '').replace(/\s+/g, ' ').slice(0, 700));
  const box = await page.locator('#view-globe').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 8; k++) { await page.mouse.move(cx + 25 * k, cy - 20 * k); await page.waitForTimeout(250); } await page.mouse.up(); await page.waitForTimeout(6000); await J.shot('O5-f-globe-tourne');
  await page.mouse.move(cx, cy); for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(900); } await page.waitForTimeout(5000); await J.shot('O5-g-globe-zoom');
  for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(500); } await page.waitForTimeout(5000); await J.shot('O5-h-globe-dezoom-max');
  // clic sur le globe : sélection d'un point ?
  const before = (await sel()).selection; await page.mouse.click(cx + 40, cy + 30); J.clicks++; await page.waitForTimeout(5000); const after = (await sel()).selection; J.note(`clic sur le globe : sélection ${before?.name} → ${after?.name} (${after?.lat?.toFixed?.(2)}, ${after?.lon?.toFixed?.(2)}) vue=${(await sel()).view}`); await J.shot('O5-i-globe-clic');
  await click(J, vs.nth(0)); await page.waitForTimeout(3000);
});

// ------------------------------------------------------------ Objectif 6 : animation sur un jour lunaire et plusieurs
await step(J, 'O6-animation', async () => {
  const first = page.locator('#left .siteitem', { hasText: /Malapert/ }).first(); await first.scrollIntoViewIfNeeded(); await click(J, first); await page.waitForTimeout(1500);
  await page.locator('#timebar .tb-date').fill('2027-03-15T08:30'); await page.locator('#timebar .tb-date').dispatchEvent('change');
  const scales = page.locator('#timebar .tb-scale-seg button'); await click(J, scales.nth(0)); await mapIdle(page); await page.waitForTimeout(3000);
  const sp = page.locator('#timebar .tb-speed-seg button'); J.note('vitesses : ' + JSON.stringify(await sp.evaluateAll((l) => l.map((e) => [e.innerText.trim(), e.title]))) + ' ; équivalent affiché : ' + (await J.text('#timebar .tb-eq')));
  await click(J, sp.nth(5)); await page.waitForTimeout(300);
  const t0 = (await sel()).timeMs; const w0 = Date.now();
  await click(J, '#timebar .tb-play'); await page.waitForTimeout(8000); await J.shot('O6-a-lecture-8s');
  const sA = await sel(); await page.waitForTimeout(8000); await J.shot('O6-b-lecture-16s'); const sB = await sel(); const w1 = Date.now();
  J.note(`lecture 100 000× : ${((sB.timeMs - t0) / 86400e3).toFixed(2)} j simulés en ${((w1 - w0) / 1000).toFixed(1)} s réelles (théorie ${(((w1 - w0) / 1000) * 100000 / 86400).toFixed(2)} j) ; playing=${sB.playing} ; à 8 s : ${iso(sA.timeMs)} ; à 16 s : ${iso(sB.timeMs)}`);
  J.note('fiche pendant la lecture, tour d’horizon : ' + JSON.stringify(await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))));
  // pause au clavier (Espace) ?
  await page.locator('#main').click({ position: { x: 300, y: 300 } }).catch(() => {}); await page.waitForTimeout(400); const afterMapClick = await sel(); J.note('un clic sur la carte pendant la lecture → sélection : ' + afterMapClick.selection?.name + ' playing=' + afterMapClick.playing);
  await page.keyboard.press('Space'); await page.waitForTimeout(700); J.note('touche Espace → playing=' + (await sel()).playing);
  if ((await sel()).playing) { await click(J, '#timebar .tb-play'); await page.waitForTimeout(500); }
  // plusieurs jours lunaires : échelle 1 an, 1 000 000×
  await click(J, scales.nth(1)); await click(J, sp.nth(6)); const y0 = (await sel()).timeMs; await click(J, '#timebar .tb-play'); await page.waitForTimeout(10000); await J.shot('O6-c-lecture-1M-an'); const y1 = await sel(); await click(J, '#timebar .tb-play'); await page.waitForTimeout(1500);
  J.note(`lecture 1 000 000× sur 10 s : +${((y1.timeMs - y0) / 86400e3).toFixed(1)} j simulés (théorie 115,7 j) ; date ${iso(y1.timeMs)}`);
  await mapIdle(page); await page.waitForTimeout(2000); await J.shot('O6-d-apres-pause');
  // la date dépasse-t-elle la fin de l'échelle ? que se passe-t-il au bout de la piste (31 déc.) ?
  await page.locator('#timebar .tb-date').fill('2027-12-31T20:00'); await page.locator('#timebar .tb-date').dispatchEvent('change'); await page.waitForTimeout(1500);
  await click(J, sp.nth(5)); await click(J, '#timebar .tb-play'); await page.waitForTimeout(9000); const e1 = await sel(); J.note(`fin d’année, lecture 100 000× 9 s depuis 2027-12-31T20:00 : date=${iso(e1.timeMs)} playing=${e1.playing}`); if (e1.playing) await click(J, '#timebar .tb-play'); await page.waitForTimeout(2500);
  await page.locator('#timebar').screenshot({ path: 'tests/.out/jury-O6-e-passage-annee.png' }).catch(() => {});
});

// ------------------------------------------------------------ Objectif 7 : expert / curieux
await step(J, 'O7-modes-tutoriel', async () => {
  await page.locator('#timebar .tb-date').fill('2027-03-15T08:30'); await page.locator('#timebar .tb-date').dispatchEvent('change'); await page.waitForTimeout(2500);
  const modes = page.locator('#header .mode-seg button'); J.note('modes : ' + JSON.stringify(await modes.evaluateAll((l) => l.map((e) => [e.innerText.trim(), e.title, e.getAttribute('aria-pressed')]))));
  const simpleText = await rightText(); await click(J, modes.nth(1)); await mapIdle(page); await page.waitForTimeout(2500); const expertText = await rightText();
  J.note(`fiche : ${simpleText.length} caractères en simple, ${expertText.length} en expert`);
  const sLines = new Set(simpleText.split('\n').map((x) => x.trim())); const extra = expertText.split('\n').map((x) => x.trim()).filter((x) => x && !sLines.has(x));
  J.note('lignes ajoutées par le mode expert (fiche) : ' + JSON.stringify(extra.slice(0, 40)));
  await J.shot('O7-a-expert'); await page.locator('#right').screenshot({ path: 'tests/.out/jury-O7-b-expert-fiche.png' });
  await click(J, modes.nth(0)); await page.waitForTimeout(1000);
  // Tutoriel : toutes les étapes, au bouton
  await click(J, page.locator('#header .navpills button').nth(4)); await page.waitForTimeout(1200);
  let k = 0; const seen = [];
  while (await page.locator('.tour-card').count() && k < 14) { const card = (await J.text('.tour-card')).replace(/\s+/g, ' '); seen.push(card.slice(0, 260)); const spot = await page.evaluate(() => { const s = document.querySelector('.tour-spot'); const c = document.querySelector('.tour-card'); const r = s.getBoundingClientRect(), q = c.getBoundingClientRect(); const ov = !(q.right < r.left || q.left > r.right || q.bottom < r.top || q.top > r.bottom); return { spot: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], card: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)], centered: document.querySelector('.tour').classList.contains('is-centered'), recouvre: ov }; }); J.note(`tutoriel étape ${k + 1} : ${JSON.stringify(spot)} — ${card.slice(0, 200)}`); await J.shot(`O7-c-tutoriel-${k + 1}`); const next = page.locator('.tour-card .tour-actions button').last(); await click(J, next); await page.waitForTimeout(900); k++; }
  J.note(`tutoriel : ${k} étapes parcourues ; fermé à la fin : ${!(await page.locator('.tour-card').count())}`);
  R.scan = await scanText(page); J.note('textes suspects à la fin : ' + JSON.stringify(R.scan));
});

fs.writeFileSync(`${LOG}/01-objectifs.json`, JSON.stringify(R, null, 1));
await J.finish('01-objectifs');
