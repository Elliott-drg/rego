// Calques un par un (légende vs carte) puis contrôles de cohérence entre fiche, tour d'horizon, carte, barre de temps et vue Comparer.
import fs from 'node:fs';
import { launch, step, click, mapIdle, mapPx, scanText, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const R = { layers: {}, coh: {} };
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const setDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(600); };
const mainShot = async (name) => { const b = await page.locator('#main').boundingBox(); await J.shot(name, { clip: { x: b.x, y: b.y, width: b.width, height: b.height } }); };

await step(J, 'L0-ouverture', async () => {
  await J.open(); await setDate('2027-03-15T08:30'); await mapIdle(page); await page.waitForTimeout(2000);
  for (const s of await page.locator('#left details > summary').all()) { if (!(await s.evaluate((e) => e.parentElement.open))) { await s.scrollIntoViewIfNeeded(); await click(J, s); await page.waitForTimeout(150); } }
  R.layerDefs = await page.evaluate(async () => { const m = await import('./js/layers/manager.js'); return m.layers.all().map((l) => ({ id: l.id, group: l.group, kind: l.kind, views: l.views, status: l.status, on: l.on, available: l.available, exclusive: l.exclusive || null, palette: l.palette || null, range: l.range || null, unit: l.unit || null, mask: l.mask || null, base: !!l.base, missing: l.missing })); });
  J.note('calques définis : ' + R.layerDefs.map((l) => `${l.id}[${l.kind}${l.exclusive ? ',excl=' + l.exclusive : ''}${l.available ? '' : ',INDISPONIBLE:' + l.missing}${l.on ? ',on' : ''}]`).join(' '));
  await mainShot('L-00-base');
  J.note('légende de base : ' + JSON.stringify(await page.$$eval('#view-map2d .legend', (l) => l.map((e) => [e.classList.contains('hidden'), e.innerText.replace(/\s+/g, ' ')]))));
});

const colored = ['elevation', 'slope', 'landable', 'sun_now', 'sun_avg', 'earth_now', 'earth_avg', 'tmax', 'tavg', 'tmin', 'psr'];
for (const id of colored) {
  await step(J, 'L-' + id, async () => {
    const lab = page.locator(`#left label[for="ly-${id}"]`); if (!(await lab.count())) { J.note('calque absent du panneau'); return; }
    await lab.scrollIntoViewIfNeeded(); const disabled = await page.locator(`#ly-${id}`).isDisabled(); if (disabled) { J.note('case désactivée : ' + (await lab.locator('xpath=..').innerText()).replace(/\s+/g, ' ')); return; }
    const t = Date.now(); await click(J, lab); await page.waitForTimeout(800); const idle = await mapIdle(page, 120000); await page.waitForTimeout(1200);
    const others = await page.evaluate(async () => { const m = await import('./js/layers/manager.js'); return m.layers.all().filter((l) => l.on).map((l) => l.id); });
    const legend = await page.$$eval('#view-map2d .legend', (l) => l.map((e) => (e.classList.contains('hidden') ? '(cachée) ' : '') + e.innerText.replace(/\s+/g, ' '))); const row = (await lab.locator('xpath=..').innerText()).replace(/\s+/g, ' ');
    const notice = await page.$$eval('#view-map2d .map2d-notice', (l) => l.map((e) => (e.classList.contains('hidden') ? '' : e.innerText)));
    R.layers[id] = { legend, row, others, idle, ms: Date.now() - t, notice };
    J.note(`actifs=${others.join(',')} ; rendu ${idle ? 'terminé' : 'NON terminé'} en ${((Date.now() - t) / 1000).toFixed(1)} s ; légende=${JSON.stringify(legend)} ; ligne=${row} ; avis=${JSON.stringify(notice)}`);
    await mainShot('L-' + id);
    // lecture sous le curseur en 3 points : la valeur lue tombe-t-elle dans la plage de la légende ?
    const b = await page.locator('#view-map2d').boundingBox(); const reads = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.42, 0.42], [0.62, 0.6], [0.5, 0.3]]) { await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy); await page.waitForTimeout(450); reads.push(await page.$$eval('#view-map2d .readout', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')).join(''))); }
    R.layers[id].reads = reads; J.note('lectures sous le curseur : ' + JSON.stringify(reads));
    // curseur d'opacité : glisser vers la gauche
    const sl = lab.locator('xpath=..').locator('input[type=range]');
    if (await sl.count()) { const sb = await sl.boundingBox(); await page.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 0.25, sb.y + sb.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500); const op = await page.evaluate(async (id) => (await import('./js/layers/manager.js')).layers.get(id).opacity, id); J.note(`opacité après glisser à 25 % : ${op}`); await page.mouse.move(sb.x + sb.width * 0.25, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2, { steps: 6 }); await page.mouse.up(); }
    else J.note('pas de curseur d’opacité pour ce calque');
    const lab2 = page.locator(`#left label[for="ly-${id}"]`); await lab2.scrollIntoViewIfNeeded(); await click(J, lab2); await page.waitForTimeout(400);
    const still = await page.evaluate(async (id) => (await import('./js/layers/manager.js')).layers.isOn(id), id); if (still) J.note('DÉFAUT : le calque reste actif après le 2e clic');
  });
}
// calques de base et vectoriels : tout décocher puis recocher
await step(J, 'L-base-vecteurs', async () => {
  for (const id of ['shade', 'graticule', 'names', 'sites_artemis', 'sites_historic', 'sites_missions', 'imports']) { const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(250); }
  await mapIdle(page); await page.waitForTimeout(1500); await mainShot('L-tout-decoche');
  J.note('tout décoché : avis=' + JSON.stringify(await page.$$eval('#view-map2d .map2d-notice', (l) => l.map((e) => [e.className, e.innerText]))) + ' légende=' + JSON.stringify(await page.$$eval('#view-map2d .legend', (l) => l.map((e) => e.className + ' ' + e.innerText.replace(/\s+/g, ' ')))));
  for (const id of ['shade', 'graticule', 'names', 'sites_artemis', 'sites_historic', 'sites_missions', 'imports']) { const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(250); }
  // deux calques colorés de groupes différents en même temps : la légende les montre-t-elle tous les deux ?
  for (const id of ['sun_now', 'earth_now', 'psr']) { const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(300); }
  await mapIdle(page, 120000); await page.waitForTimeout(1500); await mainShot('L-sun-earth-psr');
  J.note('3 calques (sun_now, earth_now, psr) : actifs=' + JSON.stringify(await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.all().filter((l) => l.on).map((l) => l.id))) + ' légende=' + JSON.stringify(await page.$$eval('#view-map2d .legend', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))));
  for (const id of ['earth_now', 'psr']) { const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(300); }
});

// calques du globe
await step(J, 'L-globe', async () => {
  await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(12000);
  const labs = await page.$$eval('#left .ly', (l) => l.map((e) => [e.querySelector('input')?.id, e.innerText.replace(/\s+/g, ' '), e.querySelector('input')?.checked, e.querySelector('input')?.disabled]));
  J.note('calques proposés sur le globe : ' + JSON.stringify(labs));
  await J.shot('L-globe-00');
  for (const [id, , checked, dis] of labs) { if (!id || dis || checked) continue; if (/sites|imports|graticule|names/.test(id)) continue; const lab = page.locator(`#left label[for="${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(7000); await J.shot('L-globe-' + id.replace('ly-', '')); J.note(`globe ${id} : textes de la vue = ` + ((await J.text('#view-globe')) || '').replace(/\s+/g, ' ').slice(0, 400)); await click(J, lab); await page.waitForTimeout(800); }
  await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(3000);
});

// ------------------------------------------------------------------ Cohérence
await step(J, 'C1-valeurs-croisees', async () => {
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(2500);
  if (await page.locator('#right .pick').count()) { await click(J, page.locator('#right .pick').first()); await page.waitForTimeout(2500); }
  await setDate('2027-03-15T08:30'); await mapIdle(page); await page.waitForTimeout(2500);
  const eng = await page.evaluate(async () => { const e = await import('./js/science/engine.js'); const s = window.RF.state.selection; const site = { lat: s.lat, lon: s.lon }; const n = e.siteNow(site), tr = e.siteTransitions(site); const wl = e.siteWindow(site, 'lunarDay').metrics, wy = e.siteWindow(site, 'year').metrics; const pr = window.RF.views.map2d.probe(s.lat, s.lon); return { sel: s, now: { sunEl: n.sun.el, sunAz: n.sun.az, sunFrac: n.sun.fraction, sunHz: n.sun.horizonDeg, sunAbove: n.sun.aboveDeg, earthEl: n.earth.el, earthAz: n.earth.az, earthVis: n.earth.visible, earthHz: n.earth.horizonDeg, earthAbove: n.earth.aboveDeg }, tr: { sunNow: tr.sun.now, sunNextH: tr.sun.nextMs ? (tr.sun.nextMs - window.RF.state.timeMs) / 3600e3 : null, earthNow: tr.earth.now, earthNextH: tr.earth.nextMs ? (tr.earth.nextMs - window.RF.state.timeMs) / 3600e3 : null }, lunar: wl, year: wy, probe: pr, tempK: e.siteTemperatureNow(site) }; });
  R.coh.engine = eng; J.note('moteur : ' + JSON.stringify(eng));
  const per = page.locator('#right .seg.seg-full button'); const sheet = {};
  for (let i = 0; i < await per.count(); i++) { await click(J, per.nth(i)); await page.waitForTimeout(2000); sheet['period' + i] = await page.$$eval('#right .sec .stat-grid:not(.sky-stats) .stat', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))); }
  sheet.sky = await page.$$eval('#right .skyhost', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')));
  sheet.temp = await page.$$eval('#right .kv-strong', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')));
  R.coh.sheet = sheet; J.note('fiche : ' + JSON.stringify(sheet));
  await page.locator('#right').evaluate((e) => { e.scrollTop = 0; }); await page.locator('#right').screenshot({ path: 'tests/.out/jury-C1-fiche.png' });
  R.coh.jumps = await page.locator('#timebar .tb-jump').evaluateAll((l) => l.map((e) => [e.innerText.trim(), e.title])); J.note('boutons de saut : ' + JSON.stringify(R.coh.jumps));
  // Comparer
  await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(500);
  await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(10000);
  const periods = page.locator('#view-compare .cmp-top .seg button'); J.note('périodes de Comparer : ' + JSON.stringify(await periods.evaluateAll((l) => l.map((e) => [e.innerText.trim(), e.getAttribute('aria-pressed'), e.className]))));
  R.coh.compare = {};
  for (let i = 0; i < Math.min(4, await periods.count()); i++) { await click(J, periods.nth(i)); await page.waitForTimeout(6000); R.coh.compare['p' + i] = { card: await page.$$eval('#view-compare .cmp-card', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' '))), table: await page.$$eval('#view-compare table.cmp-table tr', (l) => l.map((e) => [...e.children].map((c) => c.innerText.replace(/\s+/g, ' ')).join(' ¦ '))) }; }
  J.note('Comparer : ' + JSON.stringify(R.coh.compare).slice(0, 6000));
  await J.shot('C1-comparer');
  await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(3000);
});

await step(J, 'C2-bandes-vs-pourcentage', async () => {
  // échelle 1 an : part de la bande « Soleil » colorée (pixels du canevas) contre le % « Soleil visible » de la fiche (période année)
  const scales = page.locator('#timebar .tb-scale-seg button');
  for (const [i, span] of [[1, 'year'], [0, 'lunarDay']]) {
    if (await scales.first().isVisible()) await click(J, scales.nth(i)); else await page.locator('#timebar .tb-scale-select').selectOption({ index: i });
    await page.waitForFunction(() => document.querySelector('#timebar .tb-busy')?.classList.contains('hidden'), null, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1500);
    const px = await page.evaluate(() => { const c = document.querySelector('#timebar .tb-canvas'); const g = c.getContext('2d'); const dpr = window.devicePixelRatio || 1; const count = (y) => { const d = g.getImageData(0, Math.round(y * dpr), c.width, 1).data; const h = {}; for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; h[k] = (h[k] || 0) + 1; } return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => [k, +(100 * n / c.width).toFixed(2)]); }; return { w: c.width, sun: count(5), earth: [count(14), count(16), count(18)] }; });
    const m = await page.evaluate(async (span) => { const e = await import('./js/science/engine.js'); const s = window.RF.state.selection; const w = e.siteWindow({ lat: s.lat, lon: s.lon }, span); const S = w.series; let any = 0, vis = 0; for (let k = 0; k < S.n; k++) { if (S.sunFrac[k] > 0) any++; if (S.earthVis[k] === 1) vis++; } return { sunPct: w.metrics.sunPct, sunDiscPct: w.metrics.sunDiscPct, earthPct: w.metrics.earthPct, sunAnyPct: 100 * any / S.n, earthVisPct: 100 * vis / S.n, t0: w.t0Ms, spanD: w.spanMs / 86400e3, n: S.n }; }, span);
    const tw = await page.evaluate(() => { const th = document.querySelector('#timebar .tb-thumb'); return { vmin: +th.getAttribute('aria-valuemin'), vmax: +th.getAttribute('aria-valuemax') }; });
    R.coh['bands_' + span] = { px, m, tw }; J.note(`${span} : pixels bande Soleil=${JSON.stringify(px.sun)} ; bande Terre=${JSON.stringify(px.earth)} ; moteur=${JSON.stringify(m)} ; fenêtre barre=${iso(tw.vmin)}→${iso(tw.vmax)} ; fenêtre moteur=${iso(m.t0)} +${m.spanD.toFixed(2)} j`);
    await page.locator('#timebar').screenshot({ path: `tests/.out/jury-C2-bandes-${span}.png` });
  }
  J.note('fiche (périodes) : ' + JSON.stringify(R.coh.sheet));
});

await step(J, 'C3-soleil-sous-relief-vs-ombre', async () => {
  // cherche, sur le jour lunaire, des instants où le Soleil est au-dessus de l'horizon géométrique mais caché par le relief, et l'inverse
  const cases = await page.evaluate(async () => { const e = await import('./js/science/engine.js'); const s = window.RF.state.selection; const site = { lat: s.lat, lon: s.lon }; const t0 = Date.UTC(2027, 2, 1); const out = { hiddenByTerrain: null, lit: null, partial: null, belowGeom: null }; for (let h = 0; h < 24 * 60; h += 2) { const tm = t0 + h * 3600e3; const n = e.siteNow(site, tm); if (!out.hiddenByTerrain && n.sun.el > 0.3 && n.sun.fraction === 0) out.hiddenByTerrain = tm; if (!out.lit && n.sun.fraction === 1) out.lit = tm; if (!out.partial && n.sun.fraction > 0.2 && n.sun.fraction < 0.8) out.partial = tm; if (!out.belowGeom && n.sun.el < -1) out.belowGeom = tm; } return out; });
  J.note('instants trouvés : ' + JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v ? iso(v) : null]))));
  const lab = page.locator('#left label[for="ly-sun_now"]'); const on = await page.locator('#ly-sun_now').isChecked(); if (!on) { await lab.scrollIntoViewIfNeeded(); await click(J, lab); }
  R.coh.shadow = [];
  for (const [k, tm] of Object.entries(cases)) { if (!tm) continue; await setDate(iso(tm)); await mapIdle(page, 120000); await page.waitForTimeout(2500);
    const v = await page.evaluate(async () => { const e = await import('./js/science/engine.js'); const s = window.RF.state.selection; const n = e.siteNow({ lat: s.lat, lon: s.lon }); const pr = window.RF.views.map2d.probe(s.lat, s.lon); return { sunEl: n.sun.el, frac: n.sun.fraction, hz: n.sun.horizonDeg, above: n.sun.aboveDeg, probe: pr }; });
    const sky = await page.$$eval('#right .sky-stats', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')));
    // survol du site sur la carte : lecture « Soleil » sous le curseur
    const s = (await J.state(['selection'])).selection; const p = await mapPx(page, s.lat, s.lon); await page.mouse.move(p.x + 3, p.y + 3); await page.waitForTimeout(700); const ro = await page.$$eval('#view-map2d .readout', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')).join(''));
    R.coh.shadow.push({ k, t: iso(tm), v, sky, ro }); J.note(`${k} ${iso(tm)} : moteur el=${v.sunEl.toFixed(2)}° fraction=${v.frac.toFixed(2)} horizon=${v.hz.toFixed(2)}° ; sonde carte=${JSON.stringify(v.probe)} ; fiche=${JSON.stringify(sky)} ; lecture carte=${ro}`);
    await J.shot('C3-' + k);
    await page.locator('#right .skyhost').screenshot({ path: `tests/.out/jury-C3-${k}-panorama.png` }).catch(() => {});
  }
});

fs.writeFileSync(`${LOG}/02-calques-coherence.json`, JSON.stringify(R, null, 1));
await J.finish('02-calques-coherence');
