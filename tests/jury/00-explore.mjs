// Inventaire : éléments interactifs et textes de chaque zone, en 1440×900. Sert à écrire les scénarios.
import fs from 'node:fs';
import { launch, listInteractive, scanText, LOG } from './lib.mjs';
const J = await launch(); const { page } = J; const dump = {};
try {
  const t = Date.now(); await J.open(); J.note(`prêt en ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await J.shot('00-accueil');
  dump.state = await page.evaluate(() => JSON.parse(JSON.stringify(window.RF.state)));
  for (const z of ['#header', '#left', '#main', '#right', '#timebar']) { dump[z] = { text: await J.text(z), items: await listInteractive(page, z) }; }
  dump.scan = await scanText(page);
  dump.ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  dump.html = await page.evaluate(() => ({ header: document.getElementById('header').outerHTML.slice(0, 6000), timebar: document.getElementById('timebar').outerHTML.slice(0, 9000), left: document.getElementById('left').outerHTML.slice(0, 9000), right: document.getElementById('right').outerHTML.slice(0, 5000), overlays: document.getElementById('main-overlays').outerHTML.slice(0, 5000), map: document.getElementById('view-map2d').outerHTML.slice(0, 5000) }));
} catch (e) { J.note('EXCEPTION ' + e.message); await J.shot('00-erreur'); }
fs.writeFileSync(`${LOG}/00-explore.json`, JSON.stringify(dump, null, 1));
await J.finish('00-explore');
