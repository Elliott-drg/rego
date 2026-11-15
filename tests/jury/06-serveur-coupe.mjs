// Coupure du serveur en cours d'usage. Ce script lance SON serveur (port 8233) pour pouvoir l'arrêter, puis le relance.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, step, click, mapIdle, scanText, LOG } from './lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const PORT = 8233; const URL1 = `http://127.0.0.1:${PORT}/`;
const startServer = () => { const p = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: 'ignore' }); return p; };
let srv = startServer(); await new Promise((r) => setTimeout(r, 1500));
const J = await launch(); const { page } = J; const st = (k) => J.state(k);
const toasts = async () => JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText)));
try {
await step(J, 'X0-usage-normal', async () => {
  await J.open(URL1); await mapIdle(page);
  await click(J, page.locator('#left .siteitem', { hasText: /Malapert/ }).first()); await page.waitForTimeout(2500);
  J.note('avant coupure : server=' + (await st(['server', 'online'])).server + ' ; données chargées=' + JSON.stringify(await page.evaluate(async () => { const r = await import('./js/data/registry.js'); return ['sp_dem', 'sp_sun_avg', 'sp_earth_avg', 'sp_psr', 'sp_tmax', 'sp_tmin', 'sp_tavg', 'global_ldem', 'lpgrs', 'lp_hydrogen', 'features'].map((id) => [id, r.dataLoaded(id)]); })));
});
await step(J, 'X1-coupure', async () => {
  srv.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1200)); J.note('serveur arrêté');
  // 1. continuer à travailler sur la carte : autre site, date, lecture
  await click(J, page.locator('#left .siteitem', { hasText: /Haworth/ }).first()); await page.waitForTimeout(2500); J.note('autre site : ' + (await st(['selection'])).selection?.name + ' ; fiche=' + ((await J.text('#right .sky-stats')) || 'ABSENTE').replace(/\s+/g, ' ').slice(0, 200) + ' ; toasts=' + (await toasts()));
  const d = page.locator('#timebar .tb-date'); await d.fill('2027-06-01T00:00'); await d.dispatchEvent('change'); await mapIdle(page); await page.waitForTimeout(2000); await J.shot('X1-a-carte-sans-serveur');
  // 2. calques
  for (const id of ['sun_now', 'tmax']) { const s = page.locator('#left details > summary'); for (const x of await s.all()) if (!(await x.evaluate((e) => e.parentElement.open))) { await x.scrollIntoViewIfNeeded(); await click(J, x); } const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await mapIdle(page); await page.waitForTimeout(1500); J.note(`calque ${id} sans serveur : légende=` + JSON.stringify(await page.$$eval('#view-map2d .legend', (l) => l.map((e) => e.innerText.replace(/\s+/g, ' ')))) + ' toasts=' + (await toasts())); await click(J, lab); }
  // 3. globe (texture 4k chargée à la demande ?)
  await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(12000); await J.shot('X1-b-globe-sans-serveur'); J.note('globe sans serveur : toasts=' + (await toasts()) + ' ; textes=' + ((await J.text('#view-globe')) || '').replace(/\s+/g, ' ').slice(0, 300));
  // 4. comparer
  const cov = await page.evaluate(() => { const out = []; for (const b of document.querySelectorAll('.viewswitch button')) { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); out.push([b.innerText.trim(), b.contains(top) || top === b ? 'cliquable' : 'RECOUVERT par ' + (top?.className || top?.tagName)]); } return out; }); J.note('bascule de vues pendant l’avis « globe sans texture » : ' + JSON.stringify(cov));
  await click(J, page.locator('#right .sheet-actions button').first()); await click(J, page.locator('#header .navpills button').nth(0)); await page.waitForTimeout(8000); await J.shot('X1-c-comparer-sans-serveur'); J.note('comparer sans serveur : ' + ((await J.text('#view-compare')) || '').replace(/\s+/g, ' ').slice(0, 300));
  // 5. fenêtres chargées à la demande (modules JS importés dynamiquement)
  for (const [i, name] of [[1, 'energie'], [2, 'donnees'], [3, 'historique'], [5, 'apropos'], [4, 'tutoriel']]) { await click(J, page.locator('#header .navpills button').nth(i)); await page.waitForTimeout(3500); const open = await page.locator('.modal, .tour-card').count(); J.note(`${name} sans serveur : ouverte=${!!open} ; toasts=${await toasts()} ; texte=` + ((await J.text('.modal, .tour-card')) || '').replace(/\s+/g, ' ').slice(0, 260)); await J.shot('X1-d-' + name + '-sans-serveur');
    if (name === 'donnees' && open) { const tabs = page.locator('.modal [role=tab]'); for (let k = 0; k < await tabs.count(); k++) { await click(J, tabs.nth(k)); await page.waitForTimeout(2000); J.note(`  onglet ${k} : ` + ((await J.text('.modal')) || '').replace(/\s+/g, ' ').slice(0, 500)); await J.shot(`X1-e-donnees-onglet${k}-sans-serveur`); } const ver = page.locator('.modal [role=tab][data-tab*="ver"]').first(); if (await ver.count()) { await click(J, ver); await page.waitForTimeout(800); const run = page.locator('.modal .btn-primary').first(); J.note('  Horizons sans serveur : bouton désactivé=' + (await run.isDisabled().catch(() => '?')) + ' titre=' + (await run.getAttribute('title').catch(() => ''))); if (!(await run.isDisabled().catch(() => true))) { await click(J, run); await page.waitForTimeout(8000); J.note('  résultat : ' + ((await J.text('.modal')) || '').replace(/\s+/g, ' ').slice(0, 900)); await J.shot('X1-f-horizons-sans-serveur'); } } }
    await page.keyboard.press('Escape'); const cb = page.locator('.modal-head .iconbtn').first(); if (await cb.count()) await cb.click(); const q = page.locator('.tour-card .tour-actions button').first(); if (await q.count()) await q.click(); await page.waitForTimeout(300); }
  const sc = await scanText(page); if (sc.length) J.note('SUSPECTS sans serveur : ' + JSON.stringify(sc));
  J.note('état : server=' + JSON.stringify(await st(['server', 'online'])));
  // 6. rechargement sans serveur
  await page.reload({ waitUntil: 'load', timeout: 15000 }).catch((e) => J.note('rechargement sans serveur : ' + e.message.split('\n')[0])); await page.waitForTimeout(1500); await J.shot('X1-g-rechargement-sans-serveur');
});
await step(J, 'X2-retour-serveur', async () => {
  srv = startServer(); await new Promise((r) => setTimeout(r, 1800));
  await page.goto(URL1, { waitUntil: 'load' }); await J.ready(); await page.waitForTimeout(2500); J.note('après relance : server=' + (await st(['server'])).server); await J.shot('X2-retour');
});
} finally { srv.kill('SIGTERM'); }
await J.finish('06-serveur-coupe');
