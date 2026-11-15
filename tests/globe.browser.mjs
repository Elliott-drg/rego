// Test navigateur de la vue « Globe 3D » (page tests/pages/globe.html, qui monte le module seul).
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/globe.browser.mjs
// Captures dans tests/.out/globe-*.png. Code de sortie 1 si une vérification échoue.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, openPage, OUT } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = await serveStatic(ROOT);
const T0 = Date.UTC(2026, 10, 14, 21, 3);        // date de la capture de l'appli d'origine (« Sub-solar point: 115.9°E, 1.6°S »)
const pageUrl = (extra = '') => `${srv.url}tests/pages/globe.html?t=${T0}${extra}`;
const COLOR_LAYERS = ['g_topo', 'g_feo', 'g_tio2', 'g_alca', 'g_sio2', 'g_h', 'g_temp'];

// Les rasters binaires sont lus par flux (data/registry.js, fetchWithProgress) : Chromium signale alors la requête
// comme « ERR_ABORTED » alors que le fichier est reçu en entier (sa taille est contrôlée par le registre).
const real = (problems) => problems.filter((p) => !/requestfailed: \S+\.(i16|u8|u16) net::ERR_ABORTED/.test(p));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
const ready = async (page) => {
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
};
const textureLoaded = (page) => page.waitForFunction(() => window.RFT.globe.inspect().moonTexture, null, { timeout: 120000 });
const inspect = (page) => page.evaluate(() => { const i = window.RFT.globe.inspect(); return { frames: i.frames, memory: i.memory, overlay: i.overlay, moonTexture: i.moonTexture, cameraDistance: i.cameraDistance, center: i.center }; });
const project = (page, lat, lon) => page.evaluate(([la, lo]) => window.RFT.globe.inspect().project(la, lo), [lat, lon]);
/** Attend la fin d'une transition de caméra et le rendu qui suit. */
const settle = (page, ms = 1300) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: `${OUT}/globe-${name}.png` });
const flyTo = async (page, lat, lon) => { await page.evaluate(([la, lo]) => window.RFT.globe.flyTo(la, lo), [lat, lon]); await settle(page); };
const toggle = (page, id, on) => page.evaluate(([i, o]) => window.RFT.layers.toggle(i, o), [id, on]);
/** Active un calque coloré et attend que sa texture soit peinte et affichée. */
async function showLayer(page, id) {
  const f0 = (await inspect(page)).frames;
  await toggle(page, id, true);
  await page.waitForFunction(([i, f]) => { const s = window.RFT.globe.inspect(); return s.overlay === i && s.frames > f; }, [id, f0], { timeout: 60000 });
}
/** Luminance moyenne (7 × 7 px) de l'image rendue aux lieux donnés. */
const luminance = (page, pts) => page.evaluate(async (list) => {
  const g = window.RFT.globe, img = new Image();
  img.src = g.snapshot(); await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const k = img.width / document.getElementById('view-globe').clientWidth;
  return list.map(([lat, lon]) => {
    const p = g.inspect().project(lat, lon), d = ctx.getImageData(Math.round(p.x * k) - 3, Math.round(p.y * k) - 3, 7, 7).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return p.visible ? s / 49 : NaN;
  });
}, pts);
const untranslated = (page) => page.evaluate(() => [...document.querySelectorAll('#view-globe *')].filter((e) => e.children.length === 0 && /^(globe|layer|kind|prov|body|ui)\.[a-z]/i.test(e.textContent.trim())).map((e) => e.textContent.trim()));

// =================================================================== 1. Bureau 1440 × 900, français
{
  const { browser, page, problems } = await openPage(pageUrl('&lang=fr'));
  await ready(page); await textureLoaded(page); await settle(page, 800);
  let s = await inspect(page);
  check('texture 4k chargée', s.moonTexture === 'data/moon_color_4k.jpg', s.moonTexture);
  const info = await page.evaluate(() => document.querySelector('.globe-info').innerText.replace(/\s+/g, ' '));
  check('point subsolaire = capture d’origine (1,6°S, 115,9°E)', info.includes('1.6°S, 115.9°E'), info);
  check('point sub-terrestre affiché', /Point sub-terrestre \d+\.\d°[NS], \d+\.\d°[EO]/.test(info));
  await shot(page, 'fr-initial');

  // --- Calage de la texture : éclairage uniforme, sans marqueurs ; mers sombres, cratères à rayons clairs
  for (const id of ['g_daylight', 'orbits', 'sites_artemis', 'sites_historic', 'sites_missions', 'graticule']) await toggle(page, id, false);
  await flyTo(page, 5, 10);
  const maria = [['Mer des Crises', 17, 59], ['Mer de la Sérénité', 27, 18], ['Mer des Pluies', 35, -17], ['Mer de la Tranquillité', 8, 31], ['Mer des Humeurs', -24, -39], ['Platon', 51.6, -9.4]];
  const bright = [['Tycho', -43.3, -11.4], ['Aristarque', 23.7, -47.4], ['Copernic', 9.6, -20.1], ['hautes terres 60°S', -60, 10], ['hautes terres 25°S 39°E', -24, 39]];
  const lm = await luminance(page, maria.map((m) => m.slice(1))), lb = await luminance(page, bright.map((m) => m.slice(1)));
  console.log('      luminance mers    :', maria.map((m, i) => `${m[0]} ${lm[i].toFixed(0)}`).join(', '));
  console.log('      luminance clairs  :', bright.map((m, i) => `${m[0]} ${lb[i].toFixed(0)}`).join(', '));
  check('calage de la texture (mers sombres, cratères clairs aux bonnes coordonnées)', Math.max(...lm) + 12 < Math.min(...lb), `mers ≤ ${Math.max(...lm).toFixed(0)}, clairs ≥ ${Math.min(...lb).toFixed(0)}`);
  // Marqueurs de contrôle (calque « imports ») pour la vérification visuelle : points et polygone
  await page.evaluate(() => window.RFT.set({ imports: [{ id: 'ctl', name: 'Contrôle', color: '#ff00ff', features: [
    { type: 'point', coords: [[17, 59], [-43.3, -11.4], [9.6, -20.1], [23.7, -47.4], [51.6, -9.4]] },
    { type: 'polygon', coords: [[10, 50], [10, 68], [24, 68], [24, 50]] }, { type: 'line', coords: [[-43.3, -11.4], [9.6, -20.1]] }] }] }));
  await settle(page, 400);
  await shot(page, 'calage-controle');
  await page.evaluate(() => window.RFT.set({ imports: [] }));
  for (const id of ['g_daylight', 'orbits', 'sites_artemis', 'sites_historic', 'sites_missions', 'graticule']) await toggle(page, id, true);
  await settle(page, 400);
  await shot(page, 'face-visible');

  // --- Survol, clic sur Apollo 11, clic libre, glisser
  const a11 = await project(page, 0.6741, 23.4731);
  await page.mouse.move(a11.x, a11.y); await page.waitForTimeout(300);
  const tipText = await page.evaluate(() => { const e = document.querySelector('.globe-tip'); return e.hidden ? '' : e.innerText; });
  check('survol d’Apollo 11 : étiquette', /Apollo 11/.test(tipText) && /Site historique/.test(tipText), tipText.replace(/\n/g, ' | '));
  const hov = await page.evaluate(() => window.RFT.state.hover);
  check('survol : state.hover au bon endroit', hov && Math.abs(hov.lat - 0.67) < 1 && Math.abs(hov.lon - 23.47) < 1, JSON.stringify(hov));
  await shot(page, 'survol-apollo11');
  await page.mouse.click(a11.x, a11.y);
  let sel = await page.evaluate(() => window.RFT.state.selection);
  check('clic sur le marqueur Apollo 11 → sélection du site', sel?.siteId === 'apollo11' && sel.kind === 'historic' && sel.lat === 0.6741, JSON.stringify(sel));
  await settle(page);
  s = await inspect(page);
  check('la caméra tourne vers le lieu sélectionné', Math.abs(s.center.lat - 0.6741) < 0.05 && Math.abs(s.center.lon - 23.4731) < 0.05, JSON.stringify(s.center));
  await shot(page, 'selection-apollo11');
  await page.mouse.move(60, 300); await page.waitForTimeout(250);
  check('hors de la Lune : hover vide', (await page.evaluate(() => window.RFT.state.hover)) === null);
  await page.mouse.click(870, 330);
  sel = await page.evaluate(() => window.RFT.state.selection);
  const back = sel ? await project(page, sel.lat, sel.lon) : null;
  check('clic ailleurs sur la Lune → point libre aux bonnes coordonnées', sel?.kind === 'point' && /°[NS], /.test(sel.name) && Math.hypot(back.x - 870, back.y - 330) < 4, sel ? `${sel.name} (reprojeté à ${Math.hypot(back.x - 870, back.y - 330).toFixed(1)} px)` : 'aucune sélection');
  await settle(page);
  const before = await inspect(page);
  await page.mouse.move(720, 450); await page.mouse.down(); await page.mouse.move(820, 450, { steps: 6 }); await page.mouse.up();
  await settle(page, 700);
  s = await inspect(page);
  const sel2 = await page.evaluate(() => window.RFT.state.selection);
  check('glisser : la vue tourne, la sélection ne change pas', Math.abs(s.center.lon - before.center.lon) > 3 && sel2.key === sel.key, `lon ${before.center.lon.toFixed(1)} → ${s.center.lon.toFixed(1)}`);
  await page.mouse.move(720, 450); await page.mouse.wheel(0, -400); await settle(page, 500);
  check('molette : zoom', (await inspect(page)).cameraDistance < before.cameraDistance * 0.9);
  await page.evaluate(() => window.RFT.emit('view:flyTo', { lat: 20, lon: -60 })); await settle(page);
  s = await inspect(page);
  check('événement view:flyTo', Math.abs(s.center.lat - 20) < 0.05 && Math.abs(s.center.lon + 60) < 0.05, JSON.stringify(s.center));
  check('étiquette de survol retirée quand la vue bouge', await page.evaluate(() => document.querySelector('.globe-tip').hidden));
  await page.focus('.globe-canvas'); await page.keyboard.press('ArrowRight'); await settle(page, 600);
  s = await inspect(page);
  check('clavier : flèche droite = 10° vers l’est', Math.abs(s.center.lon + 50) < 0.1 && Math.abs(s.center.lat - 20) < 0.1, JSON.stringify(s.center));
  await page.setViewportSize({ width: 1000, height: 700 }); await settle(page, 600);
  const size = await page.evaluate(() => { const c = document.querySelector('.globe-canvas'); return [c.width, c.height, c.clientWidth, c.clientHeight]; });
  check('redimensionnement : le canvas suit la vue', size.join() === '1000,700,1000,700', size.join(' × '));
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page, 600);

  // --- Comparaison A/B/C, pôle Sud (9 régions), cube
  await page.evaluate(() => {
    const { addToCompare, select } = window.RFT;
    addToCompare({ key: 'haworth', name: 'Haworth', lat: -86.77, lon: -22.79, kind: 'artemis', siteId: 'haworth' });
    addToCompare({ key: 'im2', name: 'IM-2', lat: -84.79, lon: 29.2, kind: 'mission', siteId: 'im2' });
    addToCompare({ key: 'pt', name: 'Point', lat: -80, lon: 60, kind: 'point' });
    select(null);
  });
  await flyTo(page, -85, 30);
  await page.click('.globe-cube');                               // la face au centre du cube est alors « Pôle Sud »
  await settle(page);
  s = await inspect(page);
  const sp = await page.evaluate(() => { const p = window.RFT.globe.inspect().project; return { up: p(-80, 0), down: p(-80, 180), east: p(-80, 90), west: p(-80, -90) }; });
  check('clic sur la face « Pôle Sud » du cube → vue polaire, orientée comme la carte 2D (0° en haut, 90° E à droite)', s.center.lat < -89.8 && sp.up.y < sp.down.y - 50 && sp.east.x > sp.west.x + 50 && Math.abs(sp.up.x - sp.down.x) < 2, JSON.stringify(s.center));
  for (let i = 0; i < 7; i++) { await page.mouse.move(720, 450); await page.mouse.wheel(0, -300); await page.waitForTimeout(120); }
  await settle(page, 700);
  const vis = await page.evaluate(async () => {
    const { LANDING_SITES } = await import('./js/data/sites.js');
    return LANDING_SITES.filter((x) => x.kind === 'artemis').map((x) => ({ id: x.id, ...window.RFT.globe.inspect().project(x.lat, x.lon) }));
  });
  check('pôle Sud : les 9 régions candidates Artemis III sont à l’écran', vis.length === 9 && vis.every((v) => v.visible && v.x > 0 && v.x < 1440 && v.y > 0 && v.y < 900), `${vis.length} régions`);
  await shot(page, 'pole-sud-9-regions');
  await page.evaluate(() => window.RFT.set({ compare: [] }));
  await page.click('.zoomctl button:nth-child(3)'); await settle(page);
  await flyTo(page, 0, 180); await shot(page, 'face-cachee');
  s = await inspect(page);
  check('face cachée', Math.abs(Math.abs(s.center.lon) - 180) < 0.1 && Math.abs(s.center.lat) < 0.1);

  // --- Vue système
  await page.click('.globe-sysbtn'); await settle(page, 1500);
  s = await inspect(page);
  const lab = await page.evaluate(() => ['.globe-label.is-earth:not(.is-track)', '.globe-label.is-sun:not(.is-track)'].map((q) => { const e = document.querySelector(q), r = e.getBoundingClientRect(); return { hidden: e.hidden, text: e.textContent, x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
  check('vue système : au-dessus du pôle Nord, Terre (en bas) et Soleil dans le champ', s.center.lat > 89.8 && s.cameraDistance > 25 && lab[0].y > 450 && lab.every((l) => !l.hidden && l.x > 0 && l.y > 0 && l.r < 1440 && l.b < 900), lab.map((l) => l.text).join(' ; '));
  const legend = await page.evaluate(() => document.querySelector('.globe-legend').innerText.replace(/\s+/g, ' '));
  check('légende : trajectoires marquées « illustratif »', /ILLUSTRATIF/i.test(legend) && /non à l’échelle/.test(legend));
  await shot(page, 'vue-systeme');
  await page.click('.zoomctl button:nth-child(3)'); await settle(page);
  await flyTo(page, 5, 10);

  // --- Calques colorés : capture de chacun, légende
  for (const id of COLOR_LAYERS) {
    await showLayer(page, id);
    if (id === 'g_h') { await flyTo(page, -75, 0); await shot(page, 'calque-g_h-sud'); await flyTo(page, 5, 10); }
    if (id === 'g_temp') await flyTo(page, 0, 70);
    await settle(page, 300);
    const lg = await page.evaluate(() => document.querySelector('.globe-legend .legend-item').innerText.replace(/\s+/g, ' '));
    const bar = await page.evaluate(() => !!document.querySelector('.globe-legend .legend-bar')?.style.background);
    check(`calque ${id} : texture peinte et légende`, bar && !/layer\./.test(lg), lg);
    await shot(page, `calque-${id}`);
  }
  // Le modèle de température suit la date : la zone chaude se déplace avec le point subsolaire
  const hot0 = (await luminance(page, [[0, 115.9 - 60]]))[0];
  await page.evaluate((t) => window.RFT.set({ timeMs: t }), T0 + 7 * 86400000); await settle(page, 1300);
  const hot1 = (await luminance(page, [[0, 115.9 - 60]]))[0];
  check('g_temp recalculé quand la date change', Math.abs(hot1 - hot0) > 8, `luminance ${hot0.toFixed(0)} → ${hot1.toFixed(0)}`);
  await page.evaluate((t) => window.RFT.set({ timeMs: t }), T0);
  await flyTo(page, 5, 10);

  // --- Mémoire : 20 bascules de calque
  await showLayer(page, 'g_topo'); await settle(page, 300);
  const m1 = (await inspect(page)).memory;
  for (let i = 0; i < 20; i++) await showLayer(page, COLOR_LAYERS[(i + 1) % COLOR_LAYERS.length]);
  await showLayer(page, 'g_topo'); await settle(page, 300);
  const m2 = (await inspect(page)).memory;
  check('mémoire stable après 20 bascules de calque', m2.textures === m1.textures && m2.geometries === m1.geometries, `textures ${m1.textures} → ${m2.textures}, géométries ${m1.geometries} → ${m2.geometries}`);
  await toggle(page, 'g_topo', false); await settle(page, 400);
  const m3 = (await inspect(page)).memory;
  check('texture de surcouche libérée quand aucun calque coloré n’est actif', m3.textures === m1.textures - 1 && (await inspect(page)).overlay === null, `textures ${m3.textures}`);

  // --- Images par seconde (la date avance à chaque image : rendu continu)
  const fps = async () => page.evaluate(() => new Promise((res) => {
    const g = window.RFT.globe, f0 = g.inspect().frames, t0 = performance.now();
    const step = () => {
      window.RFT.set({ timeMs: window.RFT.state.timeMs + 600000 });
      if (performance.now() - t0 < 3000) requestAnimationFrame(step); else res((g.inspect().frames - f0) / ((performance.now() - t0) / 1000));
    };
    requestAnimationFrame(step);
  }));
  const fpsPlain = await fps();
  await showLayer(page, 'g_temp'); const fpsTemp = await fps(); await toggle(page, 'g_temp', false);
  console.log(`      images/s (Chromium logiciel, 1440 × 900) : ${fpsPlain.toFixed(1)} sans calque, ${fpsTemp.toFixed(1)} avec le modèle de température`);
  check('rendu continu pendant la lecture', fpsPlain > 1);
  const idle0 = (await inspect(page)).frames; await page.waitForTimeout(1000);
  check('aucun rendu quand rien ne change', (await inspect(page)).frames - idle0 <= 1);
  await page.evaluate(() => window.RFT.globe.setActive(false));
  const off0 = (await inspect(page)).frames;
  await page.evaluate(() => window.RFT.set({ timeMs: window.RFT.state.timeMs + 3600000 })); await page.waitForTimeout(500);
  check('vue inactive : boucle arrêtée', (await inspect(page)).frames === off0);
  await page.evaluate(() => window.RFT.globe.setActive(true)); await settle(page, 400);

  // --- snapshot(), anglais, mode daltonien
  const snap = await page.evaluate(() => window.RFT.globe.snapshot());
  check('snapshot() : PNG non vide', snap.startsWith('data:image/png;base64,') && snap.length > 50000 && (await luminance(page, [[5, 10]]))[0] > 5, `${Math.round(snap.length / 1024)} ko`);
  await page.evaluate((t) => window.RFT.set({ lang: 'en', timeMs: t }), T0);
  await showLayer(page, 'g_feo'); await settle(page, 500);
  const en = await page.evaluate(() => document.getElementById('view-globe').innerText.replace(/\s+/g, ' '));
  check('anglais : textes traduits', /Sub-solar point 1\.6°S, 115\.9°E/.test(en) && /Sub-Earth point/.test(en) && /Facing \d+°[NS], \d+°[EW]/.test(en) && /System view \(top-down\)/.test(en) && /Legend/i.test(en) && /Iron \(FeO\)/.test(en), en.slice(0, 160));
  check('aucune clé de traduction visible', (await untranslated(page)).length === 0, (await untranslated(page)).join(', '));
  await shot(page, 'en-feo');
  await page.evaluate(() => window.RFT.set({ cvd: 'deuteranopia' })); await settle(page, 700);
  await shot(page, 'en-feo-deuteranopie');
  await page.evaluate(() => window.RFT.set({ cvd: 'none', lang: 'fr' }));
  check('bureau : zéro erreur console ou réseau', real(problems).length === 0, real(problems).join(' ; '));
  await browser.close();
}

// =================================================================== 2. Téléphone 390 × 844, français puis anglais
{
  const { browser, page, problems } = await openPage(pageUrl('&lang=fr'), { width: 390, height: 844 });
  await ready(page); await textureLoaded(page); await settle(page, 800);
  const boxes = await page.evaluate(() => Object.fromEntries(['.globe-nav', '.globe-info', '.globe-legend', '.zoomctl'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, { x: r.x, y: r.y, r: r.right, b: r.bottom }]; })));
  const inside = Object.values(boxes).every((b) => b.x >= 0 && b.y >= 0 && b.r <= 390 && b.b <= 844);
  const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  check('téléphone : contrôles dans l’écran, sans chevauchement', inside && !overlap(boxes['.globe-info'], boxes['.globe-legend']) && !overlap(boxes['.globe-nav'], boxes['.zoomctl']), JSON.stringify(boxes));
  const globeFits = await page.evaluate(() => { const g = window.RFT.globe.inspect(); const a = g.project(g.center.lat, g.center.lon + 80), b = g.project(g.center.lat, g.center.lon - 80); return a.x < 390 && b.x > 0; });
  check('téléphone : la Lune tient dans la largeur', globeFits);
  await shot(page, 'mobile-fr');
  await page.click('.globe-legend-toggle'); await showLayer(page, 'g_topo'); await settle(page, 400);
  await shot(page, 'mobile-fr-legende');
  await page.click('.globe-legend-toggle');
  await page.evaluate(() => window.RFT.set({ lang: 'en' })); await page.click('.globe-sysbtn'); await settle(page, 1500);
  const sun = await page.evaluate(() => { const e = document.querySelector('.globe-label.is-sun:not(.is-track)'), r = e.getBoundingClientRect(); return !e.hidden && r.x >= 0 && r.right <= 390; });
  check('téléphone : vue système, Soleil dans le champ', sun);
  await shot(page, 'mobile-en-systeme');
  check('téléphone : zéro erreur console ou réseau', real(problems).length === 0, real(problems).join(' ; '));
  await browser.close();
}

// =================================================================== 3. Sans WebGL
{
  const { browser, page, problems } = await openPage(pageUrl('&lang=fr&nowebgl=1'));
  await ready(page);
  const msg = await page.evaluate(() => document.querySelector('.globe-nowebgl')?.innerText || '');
  const api = await page.evaluate(() => { const g = window.RFT.globe; g.resize(); g.flyTo(0, 0); return g.snapshot(); });
  check('sans WebGL : message traduit, interface inerte mais sans erreur', /WebGL est indisponible/.test(msg) && api === null && problems.length === 0, msg || problems.join(' ; '));
  await page.evaluate(() => window.RFT.set({ lang: 'en' }));
  check('sans WebGL : message en anglais', /WebGL is not available/.test(await page.evaluate(() => document.querySelector('.globe-nowebgl').innerText)));
  await shot(page, 'sans-webgl');
  await browser.close();
}

// =================================================================== 4. Fichiers absents : replis
{
  const { browser, page, problems } = await openPage(pageUrl('&lang=fr'));
  await ready(page);
  await page.route('**/moon_color_4k.jpg', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/lpgrs_5deg.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.reload(); await ready(page); await textureLoaded(page);
  check('texture 4k absente → repli sur la 2k', (await inspect(page)).moonTexture === 'data/moon_color_2k.jpg');
  problems.length = 0;
  await toggle(page, 'g_feo', true); await settle(page, 1500);
  const st = await page.evaluate(() => ({ overlay: window.RFT.globe.inspect().overlay, available: window.RFT.layers.get('g_feo').available, legend: document.querySelector('.globe-legend').innerText }));
  const other = real(problems).filter((p) => !/lpgrs_5deg\.json|Failed to load resource/.test(p));
  check('jeu LPGRS absent : calque indisponible, pas de plantage', st.overlay === null && st.available === false && !/FeO/.test(st.legend) && other.length === 0, other.join(' ; '));
  await page.route('**/moon_color_2k.jpg', (r) => r.fulfill({ status: 404, body: '' }));
  await page.reload(); await ready(page);
  await page.waitForFunction(() => !document.querySelector('.globe-note').hidden, null, { timeout: 30000 });
  check('aucune texture : avertissement traduit, globe gris', /Image de la surface introuvable/.test(await page.evaluate(() => document.querySelector('.globe-note').innerText)));
  await settle(page, 500); await shot(page, 'sans-texture');
  await browser.close();
}

// =================================================================== 5. Dans l'application complète (indicatif : les autres modules évoluent)
{
  const app = await serveStatic();
  const { browser, page, problems } = await openPage(app.url);
  try {
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
    await page.evaluate((t) => { window.RF.set({ timeMs: t, view: 'globe' }); }, T0);
    await page.waitForFunction(() => window.RF.views.globe?.inspect().moonTexture, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/globe-dans-appli.png` });
    const s = await page.evaluate(() => { const i = window.RF.views.globe.inspect(); return { frames: i.frames, active: i.active }; });
    console.log(`INFO  application complète : globe actif=${s.active}, ${s.frames} images ; problèmes : ${real(problems).length ? real(problems).join(' ; ') : 'aucun'}`);
  } catch (e) { console.log('INFO  application complète non testée :', e.message.split('\n')[0], problems.slice(0, 5).join(' ; ')); }
  await browser.close(); app.close();
}

srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies${failed.length ? ' — échecs : ' + failed.map((f) => f.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
