// Cas tordus : hors disque, zooms extrêmes, dates lointaines, 1 000 000× pendant 20 s, langue/daltonien pendant la lecture,
// site de l'hémisphère Nord depuis la carte 2D, redimensionnement, rechargement (préférences), mode Démo 60 s.
import fs from 'node:fs';
import { launch, step, click, mapIdle, mapPx, scanText, scanOverflow, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const R = {};
const st = (k) => J.state(k); const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const typeDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(700); };
const scan = async (label) => { const s = await scanText(page); if (s.length) J.note(`TEXTES SUSPECTS (${label}) : ` + JSON.stringify(s)); return s; };

await step(J, 'T0-ouverture', async () => { await J.open(); await mapIdle(page); });

await step(J, 'T1-hors-disque', async () => {
  const b = await page.locator('#view-map2d').boundingBox();
  for (const [name, x, y] of [['coin bas-gauche', b.x + 14, b.y + b.height - 14], ['coin haut-droit', b.x + b.width - 14, b.y + 60], ['bord gauche milieu', b.x + 8, b.y + b.height / 2]]) { await page.mouse.move(x, y); await page.waitForTimeout(400); const ro = await page.$$eval('#view-map2d .readout', (l) => l.map((e) => (e.classList.contains('hidden') ? '(cachée)' : e.innerText.replace(/\s+/g, ' '))).join('')); await page.mouse.click(x, y); J.clicks++; await page.waitForTimeout(700); J.note(`clic ${name} : sélection=${JSON.stringify((await st(['selection'])).selection)} ; lecture=${ro} ; toasts=` + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText)))); }
  await J.shot('T1-hors-disque');
  // double-clic et clic droit
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1500); J.note('double-clic au centre : sélection=' + JSON.stringify((await st(['selection'])).selection?.name) + ' échelle=' + (await page.evaluate(() => window.RF.views.map2d.perf.view.scale)).toFixed(0));
  await page.mouse.click(b.x + b.width / 2 + 60, b.y + b.height / 2, { button: 'right' }); await page.waitForTimeout(500); J.note('clic droit : menu natif non vérifiable ; sélection=' + JSON.stringify((await st(['selection'])).selection?.name));
});

await step(J, 'T2-zoom-extremes', async () => {
  const b = await page.locator('#view-map2d').boundingBox(); const cx = b.x + b.width * 0.55, cy = b.y + b.height * 0.42;
  await page.mouse.move(cx, cy); for (let k = 0; k < 25; k++) { await page.mouse.wheel(0, -500); await page.waitForTimeout(120); }
  await mapIdle(page); await page.waitForTimeout(2500); const vmax = await page.evaluate(() => window.RF.views.map2d.perf.view); J.note('zoom maximum : ' + JSON.stringify(vmax)); await J.shot('T2-zoom-max');
  await page.mouse.click(cx + 30, cy + 20); J.clicks++; await page.waitForTimeout(1500); J.note('clic au zoom max : ' + JSON.stringify((await st(['selection'])).selection)); await mapIdle(page); await page.waitForTimeout(1500); await J.shot('T2-zoom-max-selection');
  // glisser très loin au zoom max (sortir du disque ?)
  for (let r = 0; r < 6; r++) { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 600, cy - 300, { steps: 5 }); await page.mouse.up(); }
  await mapIdle(page); await page.waitForTimeout(1500); J.note('après 6 grands glissers : ' + JSON.stringify(await page.evaluate(() => window.RF.views.map2d.perf.view))); await J.shot('T2-glisser-loin');
  for (let k = 0; k < 30; k++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(100); }
  await mapIdle(page); await page.waitForTimeout(2000); J.note('zoom minimum : ' + JSON.stringify(await page.evaluate(() => window.RF.views.map2d.perf.view))); await J.shot('T2-zoom-min');
  // clavier sur la carte
  await page.locator('#view-map2d').focus().catch(() => {}); for (const k of ['+', '+', 'ArrowLeft', 'ArrowUp', '-', '0']) { await page.keyboard.press(k); await page.waitForTimeout(500); } J.note('clavier (+ + ← ↑ - 0) : ' + JSON.stringify(await page.evaluate(() => window.RF.views.map2d.perf.view)) + ' ; focus sur ' + (await page.evaluate(() => document.activeElement?.id || document.activeElement?.className)));
});

await step(J, 'T3-dates-lointaines', async () => {
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(1500); if (await page.locator('#right .pick').count()) await click(J, page.locator('#right .pick').first());
  for (const d of ['2035-06-15T12:00', '2020-02-29T23:59', '1900-01-01T00:00', '2199-12-31T23:59', '1969-07-20T20:17', '2027-03-15T08:30']) {
    await typeDate(d); await mapIdle(page); await page.waitForTimeout(2500);
    const s = await st(['timeMs']); const sky = await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))); const stats = await page.$$eval('#right .sec .stat-grid:not(.sky-stats) .stat', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')));
    J.note(`date ${d} → état ${iso(s.timeMs)} ; champ=${await page.locator('#timebar .tb-date').inputValue()} ; tour d’horizon=${JSON.stringify(sky)} ; période=${JSON.stringify(stats)}`);
    for (let i = 0; i < 3; i++) { const sc = page.locator('#timebar .tb-scale-seg button').nth(i); if (await sc.isVisible()) await click(J, sc); else await page.locator('#timebar .tb-scale-select').selectOption({ index: i }); await page.waitForTimeout(i === 2 ? 9000 : 2500); if (i === 2) J.note(`  échelle 10 ans : titre=« ${await page.locator('#timebar .tb-scale-seg button').nth(2).getAttribute('title')} » ; occupé=` + JSON.stringify(await page.$$eval('#timebar .tb-busy', (l) => l.map((e) => [e.classList.contains('hidden'), e.innerText])))); }
    await scan('date ' + d); await J.shot('T3-date-' + d.slice(0, 4));
    const sc1 = page.locator('#timebar .tb-scale-seg button').nth(1); if (await sc1.isVisible()) await click(J, sc1); else await page.locator('#timebar .tb-scale-select').selectOption({ index: 1 });
  }
  // champ vidé
  const dd = page.locator('#timebar .tb-date'); await dd.fill(''); await dd.dispatchEvent('change'); await page.waitForTimeout(800); J.note(`champ date vidé → état ${iso((await st(['timeMs'])).timeMs)} ; champ=« ${await dd.inputValue()} »`);
});

await step(J, 'T4-vitesse-max-20s', async () => {
  await typeDate('2027-03-15T08:30'); const lab = page.locator('#left label[for="ly-sun_now"]'); await lab.scrollIntoViewIfNeeded(); await click(J, lab);
  const pickSpeed = async (i) => { const b = page.locator('#timebar .tb-speed-seg button').nth(i); if (await b.isVisible()) await click(J, b); else await page.locator('#timebar .tb-speed-select').selectOption({ index: i }); };
  await pickSpeed(6); await page.evaluate(() => { window.__raf = 0; window.__long = []; const tick = () => { window.__raf++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {} });
  const t0 = (await st(['timeMs'])).timeMs; const w0 = Date.now(); await click(J, '#timebar .tb-play');
  const probes = [];
  for (let k = 0; k < 4; k++) { await page.waitForTimeout(4000); const a = Date.now(); await page.evaluate(() => 1); const lag = Date.now() - a; probes.push(lag); if (k === 1) await J.shot('T4-a-1M-8s'); }
  // pendant la lecture : changer de langue (clic réel) et mesurer le délai
  let a = Date.now(); await click(J, page.locator('#header .lang-seg button').nth(1)); await page.waitForFunction(() => /Power|Data/.test(document.querySelector('#header .navpills').innerText), null, { timeout: 30000 }).catch(() => J.note('DÉFAUT : en-tête pas passé en anglais en 30 s')); const langMs = Date.now() - a;
  await page.waitForTimeout(1500); await J.shot('T4-b-lecture-EN'); await scan('lecture + EN');
  // daltonien pendant la lecture
  a = Date.now(); await click(J, page.locator('#header .header-right .iconbtn').first()); await page.waitForTimeout(300); const pop = await page.locator('.popover.settings').count(); if (pop) { await page.locator('.popover.settings select').nth(0).selectOption('protanopia'); await page.waitForTimeout(1500); } const cvdMs = Date.now() - a; await J.shot('T4-c-lecture-cvd'); await page.keyboard.press('Escape'); await page.mouse.click(5, 300);
  await page.waitForTimeout(2000);
  const s1 = await st(['timeMs', 'playing', 'lang', 'cvd']); const w1 = Date.now(); const perf = await page.evaluate(() => ({ raf: window.__raf, long: window.__long.length, longMax: Math.max(0, ...window.__long), longSum: window.__long.reduce((x, y) => x + y, 0) }));
  J.note(`1 000 000× pendant ${((w1 - w0) / 1000).toFixed(1)} s : +${((s1.timeMs - t0) / 86400e3).toFixed(1)} j simulés (théorie ${((w1 - w0) / 1000 * 11.574).toFixed(1)} j) ; date=${iso(s1.timeMs)} ; images=${perf.raf} (${(perf.raf / ((w1 - w0) / 1000)).toFixed(1)}/s) ; tâches longues=${perf.long}, max ${perf.longMax} ms, total ${perf.longSum} ms ; délais d’un aller-retour=${JSON.stringify(probes)} ms ; changement de langue=${langMs} ms ; popover ouvert=${pop} ; état=${JSON.stringify(s1)}`);
  // pause par clic réel
  a = Date.now(); await click(J, '#timebar .tb-play'); await page.waitForTimeout(600); J.note(`pause : playing=${(await st(['playing'])).playing} (clic traité en ${Date.now() - a} ms)`);
  await mapIdle(page); await page.waitForTimeout(2500); await J.shot('T4-d-apres-pause'); await scan('après 1M×');
  J.note('fiche après lecture : ' + JSON.stringify(await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))) + ' ; date de la fiche : ' + JSON.stringify(await page.$$eval('#right .sec-title .mono', (l) => l.map((e) => e.innerText))) + ' ; barre : ' + (await page.locator('#timebar .tb-date').inputValue()));
  // langue pendant la lecture sur la vue Comparer et le globe
  await click(J, page.locator('#header .lang-seg button').nth(0)); await page.waitForTimeout(800);
  await click(J, page.locator('#header .header-right .iconbtn').first()); await page.waitForTimeout(300); if (await page.locator('.popover.settings').count()) { await page.locator('.popover.settings select').nth(0).selectOption('none'); } await page.keyboard.press('Escape'); await page.mouse.click(5, 300);
  await click(J, lab).catch(() => {});
  await pickSpeed(4);
});

await step(J, 'T5-site-nord-depuis-2D', async () => {
  // dans la vue 2D : liste « sites historiques » → Apollo 15 (26°N)
  for (const s of await page.locator('#left details > summary').all()) { if (!(await s.evaluate((e) => e.parentElement.open))) { await s.scrollIntoViewIfNeeded(); await click(J, s); } }
  const ap = page.locator('#left .siteitem', { hasText: /Apollo 15/ }).first(); await ap.scrollIntoViewIfNeeded(); await click(J, ap); await page.waitForTimeout(10000);
  let s = await st(['selection', 'view']); J.note(`Apollo 15 depuis la carte 2D → vue=${s.view} sélection=${s.selection?.name} (${s.selection?.lat})`); await J.shot('T5-a-apollo15');
  J.note('fiche (début) : ' + ((await J.text('#right')) || '').replace(/\s+/g, ' ').slice(0, 1200)); await scan('Apollo 15');
  const rb = await page.locator('#right').boundingBox(); await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); for (let k = 1; k <= 5; k++) { await page.mouse.wheel(0, 650); await page.waitForTimeout(700); await page.locator('#right').screenshot({ path: `tests/.out/jury-T5-b-fiche-apollo15-${k}.png` }); }
  await page.locator('#right').evaluate((e) => { e.scrollTop = 0; });
  // retour à la carte 2D avec ce site : que voit-on ?
  await click(J, page.locator('.viewswitch button').nth(0)); await mapIdle(page); await page.waitForTimeout(2500); s = await st(['selection', 'view']); J.note(`retour carte 2D : vue=${s.view} ; bouton « centrer sur le lieu » désactivé=${await page.locator('#view-map2d .zoomctl button').nth(3).isDisabled()} ; avis=` + JSON.stringify(await page.$$eval('#view-map2d .map2d-notice', (l) => l.map((e) => (e.classList.contains('hidden') ? '' : e.innerText))))); await J.shot('T5-c-retour-2D');
  // bouton « Centrer » de la fiche alors que le site est hors carte
  await click(J, page.locator('#right .sheet-actions button').nth(2)); await page.waitForTimeout(1500); J.note('« Centrer » (site hors carte, vue 2D) : vue=' + (await st(['view'])).view + ' ; carte=' + JSON.stringify(await page.evaluate(() => window.RF.views.map2d.perf.view)) + ' ; toasts=' + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
  // site à 69°S (Chandrayaan-3) : hors disque 75°S
  const ch = page.locator('#left .siteitem', { hasText: /Chandrayaan/ }).first(); await ch.scrollIntoViewIfNeeded(); await click(J, ch); await page.waitForTimeout(8000); J.note('Chandrayaan-3 (69°S) → vue=' + (await st(['view'])).view + ' ; fiche : ' + ((await J.text('#right')) || '').replace(/\s+/g, ' ').slice(0, 500)); await J.shot('T5-d-chandrayaan');
  await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2000);
});

await step(J, 'T6-redimensionnement', async () => {
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await mapIdle(page); await page.waitForTimeout(1500);
  for (const [w, h] of [[1100, 720], [979, 700], [760, 900], [500, 640], [1920, 1080], [1440, 400], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(1800); await mapIdle(page, 60000); await page.waitForTimeout(1200);
    const info = await page.evaluate(() => { const p = window.RF.views.map2d.perf; const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }; const c = document.querySelector('#view-map2d canvas'); return { map: [p.cssW, p.cssH], canvas: [c.width, c.height], left: r('#left'), right: r('#right'), main: r('#main'), timebar: r('#timebar'), header: r('#header'), docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, leftOpen: window.RF.state.leftOpen, rightOpen: window.RF.state.rightOpen }; });
    J.note(`fenêtre ${w}×${h} : ${JSON.stringify(info)}`); const ov = await scanOverflow(page); if (ov.offscreen.length) J.note(`  HORS ÉCRAN : ${JSON.stringify(ov.offscreen.slice(0, 8))}`); if (ov.docW > ov.winW + 1) J.note(`  DÉBORDEMENT HORIZONTAL : ${ov.docW} > ${ov.winW}`);
    await J.shot(`T6-fenetre-${w}x${h}`);
  }
});

await step(J, 'T7-rechargement-preferences', async () => {
  // régler : anglais, expert, daltonien, °C, mât 10 m, site + comparaison, calque, date, panneau gauche fermé, groupe replié
  await click(J, page.locator('#header .lang-seg button').nth(1)); await click(J, page.locator('#header .mode-seg button').nth(1));
  await click(J, page.locator('#header .header-right .iconbtn').first()); await page.waitForTimeout(300); await page.locator('.popover.settings select').nth(0).selectOption('tritanopia'); await page.waitForTimeout(400);
  if (!(await page.locator('.popover.settings').count())) await click(J, page.locator('#header .header-right .iconbtn').first()); await page.locator('.popover.settings select').nth(1).selectOption('C'); await page.waitForTimeout(300);
  if (!(await page.locator('.popover.settings').count())) await click(J, page.locator('#header .header-right .iconbtn').first()); const n = page.locator('.popover.settings input[type=number]').first(); await n.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('10'); await page.keyboard.press('Tab'); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.mouse.click(5, 300);
  await click(J, page.locator('#right .sheet-actions button').first()).catch(() => {}); await typeDate('2028-01-05T10:00');
  const lab = page.locator('#left label[for="ly-earth_avg"]'); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await click(J, page.locator('#left details > summary').first());
  await page.waitForTimeout(1000); const before = await st(['lang', 'mode', 'cvd', 'tempUnit', 'params', 'selection', 'compare', 'timeMs', 'view', 'leftOpen', 'speed', 'timeScale']); const layersBefore = await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.all().filter((l) => l.on).map((l) => l.id));
  const lsBefore = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  await J.shot('T7-a-avant-rechargement');
  await page.reload({ waitUntil: 'load' }); await J.ready(); await page.waitForTimeout(4000); await mapIdle(page);
  const after = await st(['lang', 'mode', 'cvd', 'tempUnit', 'params', 'selection', 'compare', 'timeMs', 'view', 'leftOpen', 'speed', 'timeScale']); const layersAfter = await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.all().filter((l) => l.on).map((l) => l.id));
  const cmp = {}; for (const k of Object.keys(before)) cmp[k] = JSON.stringify(before[k]) === JSON.stringify(after[k]) ? 'conservé' : `PERDU (${JSON.stringify(before[k]).slice(0, 80)} → ${JSON.stringify(after[k]).slice(0, 80)})`;
  cmp.calques = JSON.stringify(layersBefore) === JSON.stringify(layersAfter) ? 'conservés' : `PERDUS (${layersBefore} → ${layersAfter})`;
  cmp.groupeReplie = (await page.locator('#left details').first().evaluate((e) => e.open)) ? 'PERDU (rouvert)' : 'conservé (replié)';
  R.reload = cmp; J.note('après rechargement : ' + JSON.stringify(cmp, null, 1)); J.note('localStorage : ' + JSON.stringify(lsBefore));
  await J.shot('T7-b-apres-rechargement'); await scan('après rechargement');
  // remise à plat
  await click(J, page.locator('#header .lang-seg button').nth(0)); await click(J, page.locator('#header .mode-seg button').nth(0)); await click(J, page.locator('#header .header-right .iconbtn').first()); await page.waitForTimeout(300); await page.locator('.popover.settings select').nth(0).selectOption('none'); if (!(await page.locator('.popover.settings').count())) await click(J, page.locator('#header .header-right .iconbtn').first()); await page.locator('.popover.settings select').nth(1).selectOption('K'); if (!(await page.locator('.popover.settings').count())) await click(J, page.locator('#header .header-right .iconbtn').first()); const n2 = page.locator('.popover.settings input[type=number]').first(); await n2.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('2'); await page.keyboard.press('Tab'); await page.keyboard.press('Escape'); await page.mouse.click(5, 300);
});

await step(J, 'T8-demo-60s', async () => {
  await typeDate('2027-03-15T08:30'); const before = await st(['view', 'timeMs', 'speed', 'compare', 'selection', 'playing']); const layersBefore = await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.all().filter((l) => l.on).map((l) => l.id));
  const demo = page.locator('#header .header-right > button.btn'); J.note('bouton Démo : « ' + (await demo.innerText()).trim() + ' » ; aide : ' + (await demo.getAttribute('title')));
  await demo.click(); const w0 = Date.now(); const seen = [];
  for (const sec of [2, 6, 12, 18, 26, 34, 42, 50, 58, 64]) { await page.waitForTimeout(Math.max(0, sec * 1000 - (Date.now() - w0))); const s = await st(['view', 'timeMs', 'playing', 'speed', 'selection', 'demo']); const cap = await page.$$eval('.demo-banner', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')).join('')); seen.push({ sec, view: s.view, playing: s.playing, sel: s.selection?.name, date: iso(s.timeMs), cap, demo: s.demo }); await J.shot(`T8-demo-${String(sec).padStart(2, '0')}s`); const sc = await scanText(page); if (sc.length) J.note(`  démo ${sec} s SUSPECTS ${JSON.stringify(sc.slice(0, 5))}`); }
  for (const x of seen) J.note(`démo ${x.sec} s : vue=${x.view} lecture=${x.playing} site=${x.sel} date=${x.date} demo=${x.demo} ; bandeau=« ${x.cap} »`);
  // reprendre la main : déplacement de souris seul, puis clic sur la carte
  await page.mouse.move(700, 400); await page.mouse.move(720, 420); await page.waitForTimeout(500); J.note('mouvement de souris seul : demo=' + (await st(['demo'])).demo);
  await page.mouse.click(700, 420); await page.waitForTimeout(1500);
  const after = await st(['view', 'timeMs', 'speed', 'compare', 'selection', 'playing', 'demo']); const layersAfter = await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.all().filter((l) => l.on).map((l) => l.id));
  J.note(`reprise par clic : demo=${after.demo} ; bandeau présent=${await page.locator('.demo-banner').count()} ; vue ${before.view}→${after.view} ; date ${iso(before.timeMs)}→${iso(after.timeMs)} ; vitesse ${before.speed}→${after.speed} ; lecture=${after.playing} ; sélection ${before.selection?.name}→${after.selection?.name} ; comparaison ${before.compare.length}→${after.compare.length} ; calques ${layersBefore}→${layersAfter}`);
  await mapIdle(page); await page.waitForTimeout(1500); await J.shot('T8-demo-apres-reprise'); J.note('bouton Démo après : classe=' + (await demo.getAttribute('class')));
  // démo lancée depuis une fenêtre ouverte + arrêt par le bouton lui-même
  await demo.click(); await page.waitForTimeout(2500); await demo.click().catch(() => {}); await page.waitForTimeout(800); J.note('2e clic sur Démo : demo=' + (await st(['demo'])).demo);
});

fs.writeFileSync(`${LOG}/04-cas-tordus.json`, JSON.stringify(R, null, 1));
await J.finish('04-cas-tordus');
