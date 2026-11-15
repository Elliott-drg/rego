// Test de bout en bout de l'application assemblée, avec le vrai serveur local (server.mjs).
// Parcours : démarrage, carte 2D, sélection, fiche, temps, calques, globe, comparaison, modales, anglais, mobile.
import { spawn } from 'node:child_process';
import { openPage, OUT } from './browser.mjs';
const PORT = 8137;
const srv = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
await new Promise((r) => setTimeout(r, 1500));
const results = []; const ok = (name, cond, extra = '') => { results.push([!!cond, name, extra]); console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name} ${extra}`); };
const { browser, page, problems } = await openPage(`http://127.0.0.1:${PORT}/`);
const shot = (n) => page.screenshot({ path: `${OUT}/e2e-${n}.png` });
try {
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  await page.evaluate(() => window.RF.set({ lang: 'fr', timeMs: Date.UTC(2027, 1, 10, 12) }));
  await page.waitForTimeout(4000);
  ok('serveur local détecté', await page.evaluate(() => window.RF.state.server === true));
  ok('carte 2D montée', await page.evaluate(() => !!window.RF.views.map2d && !!document.querySelector('#view-map2d canvas')));
  ok('barre de temps montée', await page.evaluate(() => document.getElementById('timebar').children.length > 0));
  await shot('01-carte');
  // Sélection d'une région puis d'un point favorable
  await page.evaluate(async () => { const s = await import('./js/data/sites.js'); const st = await import('./js/core/store.js'); st.select(s.siteSelection(s.getSite('malapert_massif'))); });
  await page.waitForSelector('.sheet-head'); await page.waitForTimeout(2500);
  ok('fiche : panorama d’horizon présent', await page.evaluate(() => !!document.querySelector('#right .skyhost canvas')));
  ok('fiche : points favorables proposés', await page.evaluate(() => document.querySelectorAll('#right .pick').length >= 3));
  await page.click('#right .pick'); await page.waitForTimeout(2500);
  await shot('02-site');
  const sheet = await page.evaluate(() => document.getElementById('right').innerText);
  ok('fiche : Soleil et Terre chiffrés', /Soleil visible/.test(sheet) && /Terre visible/.test(sheet) && /%/.test(sheet));
  // Calques
  await page.evaluate(async () => { const l = await import('./js/layers/manager.js'); l.layers.toggle('sun_now', true); l.layers.toggle('earth_now', true); });
  await page.waitForTimeout(3000); await shot('03-calques');
  ok('légende affichée', await page.evaluate(() => !!document.querySelector('#view-map2d .legend') && document.querySelector('#view-map2d .legend').innerText.length > 5));
  await page.evaluate(async () => { const l = await import('./js/layers/manager.js'); l.layers.toggle('sun_now', false); l.layers.toggle('earth_now', false); l.layers.toggle('tmax', true); });
  await page.waitForTimeout(3000); await shot('04-diviner');
  await page.evaluate(async () => { const l = await import('./js/layers/manager.js'); l.layers.toggle('tmax', false); });
  // Curseur d'opacité : il doit suivre le geste jusqu'au bout (il était reconstruit pendant le glisser)
  await page.evaluate(async () => { const l = await import('./js/layers/manager.js'); l.layers.toggle('elevation', true); });
  await page.waitForSelector('#left .ly-ctl input[type=range]');
  const box = await page.locator('#left .ly-ctl input[type=range]').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(box.x + box.width * (0.6 - 0.05 * k), box.y + box.height / 2);
  await page.mouse.up(); await page.waitForTimeout(400);
  const op = await page.evaluate(async () => (await import('./js/layers/manager.js')).layers.get('elevation').opacity);
  ok('curseur d’opacité : suit le glisser', op < 0.35, `(opacité ${op.toFixed(2)})`);
  await page.evaluate(async () => { const l = await import('./js/layers/manager.js'); l.layers.toggle('elevation', false); });
  // Lecture du temps
  const t0 = await page.evaluate(() => window.RF.state.timeMs);
  await page.evaluate(() => window.RF.set({ speed: 100000, playing: true })); await page.waitForTimeout(3000);
  const t1 = await page.evaluate(() => { window.RF.set({ playing: false }); return window.RF.state.timeMs; });
  ok('lecture : le temps avance', t1 - t0 > 3600e3, `(+${((t1 - t0) / 3600e3).toFixed(1)} h simulées en 3 s)`);
  // Globe
  await page.evaluate(() => window.RF.set({ view: 'globe' })); await page.waitForTimeout(6000); await shot('05-globe');
  ok('globe monté', await page.evaluate(() => !!window.RF.views.globe && !!document.querySelector('#view-globe canvas')));
  await page.evaluate(async () => { const s = await import('./js/data/sites.js'); const st = await import('./js/core/store.js'); st.select(s.siteSelection(s.getSite('apollo11'))); });
  await page.waitForTimeout(4000); await shot('06-globe-apollo');
  ok('site hors pôle : mention horizon lisse', /sphère lisse|relief local n’est pas pris en compte|relief non pris en compte/.test(await page.evaluate(() => document.getElementById('right').innerText)));
  // Comparaison
  await page.evaluate(async () => { const s = await import('./js/data/sites.js'); const st = await import('./js/core/store.js'); for (const id of ['malapert_massif', 'mons_mouton_plateau', 'slater_plain']) st.addToCompare(s.siteSelection(s.getSite(id))); st.set({ view: 'compare' }); });
  await page.waitForTimeout(6000); await shot('07-comparer');
  ok('comparaison : tableau rempli', await page.evaluate(() => document.querySelectorAll('#view-compare table tr').length > 10));
  // Modales
  for (const [name, sel] of [['énergie', 'energy'], ['données', 'dataCenter'], ['historique', 'history'], ['à propos', 'founders'], ['import', 'importer']]) {
    await page.evaluate(async (a) => { const sh = await import('./js/ui/shell.js'); await sh.actions[a](); }, sel);
    await page.waitForTimeout(2500);
    ok(`fenêtre ${name}`, await page.evaluate(() => !!document.querySelector('.modal') && document.querySelector('.modal').innerText.length > 40));
    await shot(`08-${sel}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.evaluate(async () => { const m = await import('./js/ui/modal.js'); m.closeModal(); });
  }
  // Anglais + expert + daltonien
  await page.evaluate(() => window.RF.set({ view: 'map2d', lang: 'en', mode: 'expert', cvd: 'deuteranopia' })); await page.waitForTimeout(3000); await shot('09-en-expert-cvd');
  const untranslated = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(e.textContent.trim()) && !/\.(js|json|i16|u8|u16|jpg|png|md|mjs|bat|sh|csv|geojson|tsv|txt|webp)$/.test(e.textContent.trim()) && !/^\d/.test(e.textContent.trim())).map((e) => e.textContent.trim()));
  ok('aucune clé de traduction visible', untranslated.length === 0, JSON.stringify([...new Set(untranslated)].slice(0, 12)));
  // Largeur d'un portable courant : la navigation reste dans l'en-tête, sans débordement
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(800); await shot('09b-1280');
  ok('1280 px : navigation visible', await page.evaluate(() => { const n = document.querySelector('#header .navpills'); return !!n && getComputedStyle(n).display !== 'none'; }));
  ok('1280 px : en-tête sans débordement', await page.evaluate(() => { const h = document.getElementById('header'); return h.scrollWidth <= h.clientWidth + 1 && [...h.querySelectorAll('.header-right > *')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1); }));
  // Mobile
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.RF.set({ lang: 'fr', leftOpen: false, rightOpen: false })); await page.waitForTimeout(2500); await shot('10-mobile');
  ok('mobile : pas de débordement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
} catch (e) { ok('parcours sans exception', false, e.message); await shot('99-erreur'); }
const real = problems.filter((p) => !/net::ERR_ABORTED/.test(p) || !/\/data\//.test(p));
ok('aucune erreur console ou réseau', real.length === 0, real.length ? '\n  ' + [...new Set(real)].slice(0, 25).join('\n  ') : '');
await browser.close(); srv.kill();
const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} contrôles passés`);
process.exit(failed ? 1 : 0);
