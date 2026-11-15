// Test navigateur de la carte 2D du pôle Sud (public/js/views/map2d.js), montée seule dans tests/pages/map2d.html.
//
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/map2d.browser.mjs
//
// Vérifie : orientation et géoréférencement (rendu WebGL et clics), accord du shader avec le moteur CPU
// (Soleil et Terre par rapport à l'horizon du relief), calques colorés, interactions, langues, écran étroit,
// perte du contexte WebGL, absence de WebGL 2 et de relief. Captures dans tests/.out/map2d-*.png.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, openPage, OUT } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasLayerNames = fs.existsSync(path.join(ROOT, 'public/js/i18n/layers.js'));
const srv = await serveStatic(ROOT);
const pageUrl = (query) => `${srv.url}tests/pages/map2d.html?${hasLayerNames ? 'layers=1&' : ''}${query}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
const info = (text) => console.log('INFO  ' + text);
// Artefact connu du serveur de test : Chromium signale « ERR_ABORTED » pour les gros binaires lus en flux
// par registry.fetchWithProgress, alors que les données sont complètes (taille contrôlée par le registre).
const real = (problems) => problems.filter((p) => !/requestfailed: \S+\.(i16|u8|u16) net::ERR_ABORTED/.test(p));

async function open(query, size) {
  const ctx = await openPage(pageUrl(query), size);
  ctx.page.on('console', (m) => {
    if (m.type() !== 'warning') return;
    if (m.text().includes('[i18n]')) ctx.problems.push('i18n: ' + m.text());
    // Erreurs WebGL (signalées en avertissements) ; le message de performance sur readPixels est attendu (contrôle, snapshot)
    else if (/WebGL|GL_INVALID|INVALID_/.test(m.text()) && !/GPU stall due to ReadPixels/.test(m.text())) ctx.problems.push('webgl: ' + m.text());
  });
  await ctx.page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  return ctx;
}
/** Attend que la carte n'ait plus rien à dessiner (image complète terminée). */
async function idle(page) {
  await page.waitForTimeout(260);
  await page.waitForFunction(() => window.T.map.perf.idle, null, { timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `map2d-${name}.png`) });
const view = (page) => page.evaluate(() => window.T.map.perf.view);
/** Position écran attendue d'un lieu, calculée ici d'après la définition de la carte (indépendamment de coords.js). */
async function screenOf(page, lat, lon) {
  const p = await page.evaluate(() => { const q = window.T.map.perf; return { v: q.view, w: q.cssW, h: q.cssH }; });
  const rho = 2 * 1737400 * Math.tan((90 + lat) * Math.PI / 360);
  const x = rho * Math.sin(lon * Math.PI / 180), y = rho * Math.cos(lon * Math.PI / 180);   // lon 0 vers le haut, 90°E à droite
  return { x: p.w / 2 + (x - p.v.cx) / p.v.scale, y: p.h / 2 - (y - p.v.cy) / p.v.scale };
}
/** Couleurs (r, v, b) de l'image exportée par snapshot() aux positions écran données. */
function snapshotPixels(page, points) {
  return page.evaluate(async (pts) => {
    const url = window.T.map.snapshot();
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const k = img.width / window.T.map.perf.cssW;
    return { width: img.width, height: img.height, isPng: url.startsWith('data:image/png'), px: pts.map((p) => [...g.getImageData(Math.floor(p.x * k), Math.floor(p.y * k), 1, 1).data.slice(0, 3)]) };
  }, points);
}
const setLayers = (page, ids, on) => page.evaluate(([list, v]) => list.forEach((id) => window.T.layers.toggle(id, v)), [ids, on]);
const VECTOR_LAYERS = ['graticule', 'names', 'sites_artemis', 'sites_historic', 'sites_missions', 'imports'];
const sel = (page) => page.evaluate(() => window.T.state.selection);

// =====================================================================================================
// 1. Bureau 1440 × 900, français
// =====================================================================================================
{
  const { browser, page, problems } = await open('lang=fr', { width: 1440, height: 900 });
  const W = 1440, H = 900;
  await idle(page);
  await shot(page, 'overview-fr');
  const perf0 = await page.evaluate(() => window.T.map.perf);
  info(`WebGL2 : interpolation des textures flottantes ${perf0.linearFloat ? 'disponible (LINEAR)' : 'absente (NEAREST)'}`);

  // ---- Orientation
  const v0 = await view(page);
  check('vue initiale : toute la carte, centrée sur le pôle', Math.abs(v0.cx) < 1 && Math.abs(v0.cy) < 1 && v0.scale > 900);
  const sh = await screenOf(page, -89.67, 129.2), ma = await screenOf(page, -86, 0);
  check('orientation : Shackleton près du centre, en bas à droite', sh.x > W / 2 && sh.y > H / 2 && Math.hypot(sh.x - W / 2, sh.y - H / 2) < 30, `(${(sh.x - W / 2).toFixed(1)} ; ${(sh.y - H / 2).toFixed(1)}) px du centre`);
  check('orientation : Malapert vers le haut', Math.abs(ma.x - W / 2) < 3 && ma.y < H / 2 - 80, `${(H / 2 - ma.y).toFixed(0)} px au-dessus du centre`);

  // ---- Géoréférencement du rendu WebGL : avec le seul calque d'altitude, la couleur de chaque pixel doit être
  //      celle de la palette pour la hauteur LOLA du lieu (à la modulation de relief près, qui garde la teinte).
  await setLayers(page, VECTOR_LAYERS, false); await setLayers(page, ['shade'], false);
  await page.evaluate(() => { window.T.layers.toggle('elevation', true); window.T.layers.setOpacity('elevation', 1); });
  await idle(page);
  {
    const pts = [];
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    while (pts.length < 60) { const lat = -76 - rnd() * 13.8, lon = rnd() * 360 - 180; const s = await screenOf(page, lat, lon); if (s.x > 60 && s.x < W - 60 && s.y > 60 && s.y < H - 60) pts.push({ lat, lon, ...s }); }
    const got = await snapshotPixels(page, pts);
    const want = await page.evaluate((list) => list.map((p) => {
      const l = window.T.layers.get('elevation'), hgt = window.T.terrain.heightAt(p.lat, p.lon);
      return window.T.palettes.colorAt(l.palette, (hgt - l.range[0]) / (l.range[1] - l.range[0]), 'none');
    }), pts);
    let good = 0, worst = 1;
    got.px.forEach((c, i) => {
      const w = want[i], dot = c[0] * w[0] + c[1] * w[1] + c[2] * w[2], cos = dot / (Math.hypot(...c) * Math.hypot(...w) || 1);
      if (cos > 0.997) good++; worst = Math.min(worst, cos);
    });
    check('rendu WebGL géoréférencé : couleur d\'altitude attendue en 60 points', good >= 57, `${good}/60 points (cosinus minimal ${worst.toFixed(4)})`);
    await shot(page, 'layer-elevation-alone');
    // Mode daltonien : la palette en texture est refaite
    const before = got.px[0];
    await page.evaluate(() => window.T.set({ cvd: 'deuteranopia' })); await idle(page);
    const after = (await snapshotPixels(page, [pts[0]])).px[0];
    const wantCvd = await page.evaluate((p) => { const l = window.T.layers.get('elevation'); return window.T.palettes.colorAt(l.palette, (window.T.terrain.heightAt(p.lat, p.lon) - l.range[0]) / (l.range[1] - l.range[0]), 'deuteranopia'); }, pts[0]);
    const cosCvd = (after[0] * wantCvd[0] + after[1] * wantCvd[1] + after[2] * wantCvd[2]) / (Math.hypot(...after) * Math.hypot(...wantCvd) || 1);
    check('mode daltonien : palette recréée', cosCvd > 0.997 && before.join() !== after.join(), `${before} -> ${after}`);
    await page.evaluate(() => window.T.set({ cvd: 'none' }));
  }
  await page.evaluate(() => { window.T.layers.toggle('elevation', false); window.T.layers.setOpacity('elevation', 0.6); });
  await setLayers(page, ['shade', ...VECTOR_LAYERS], true);
  await idle(page);

  // ---- Accord du shader avec le moteur CPU (Soleil : fraction du disque ; Terre : visible ou non)
  {
    const out = await page.evaluate(() => {
      const T = window.T, C = T.coords, R = C.MOON_RADIUS_M;
      const dates = [Date.UTC(2026, 10, 15, 12), Date.UTC(2027, 1, 20, 6), Date.UTC(2027, 5, 3, 18)];
      const pts = T.sites.LANDING_SITES.filter((s) => s.lat <= -75).map((s) => ({ lat: s.lat, lon: s.lon }));
      pts.push({ lat: -89.67, lon: 129.2 }, { lat: -89.45, lon: -137.3 }, { lat: -89.9, lon: 0 }, { lat: -85.99, lon: -2.9 }, { lat: -87.45, lon: -5 });
      let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      for (let i = 0; i < 44; i++) { const rho = Math.sqrt(rnd()) * 2 * R * Math.tan((i < 30 ? 5 : 14) * C.DEG / 2), a = rnd() * 2 * Math.PI; pts.push(C.spLatLonFromXY(rho * Math.sin(a), rho * Math.cos(a))); }
      // Marche fine de horizon.js dans l'azimut exact du corps (l'horizon du moteur est tabulé tous les 0,5° puis interpolé)
      const exactHorizon = (lat, lon, azDeg, h1) => {
        const { east, north, up } = C.enuBasis(lat, lon), ca = Math.cos(azDeg * C.DEG), sa = Math.sin(azDeg * C.DEG);
        const t = [0, 1, 2].map((k) => north[k] * ca + east[k] * sa), r1 = R + h1;
        let best = Math.tan(-Math.acos((R - 9000) / r1)), s = 120;
        while (s < 330000) {
          const ct = Math.cos(s / R), st = Math.sin(s / R), n = [0, 1, 2].map((k) => up[k] * ct + t[k] * st), q = C.spXYFromUnit(n), hgt = T.terrain.heightAtXY(q.x, q.y);
          if (!Number.isFinite(hgt)) break;
          best = Math.max(best, ((R + hgt) * ct - r1) / ((R + hgt) * st));
          s += Math.max(120, Math.min(480, s * 0.004));
        }
        return Math.atan(best) * C.RAD;
      };
      const rows = [];
      for (const p of pts) for (const timeMs of dates) {
        const cpu = T.engine.siteNow(p, timeMs), gpu = T.map.probe(p.lat, p.lon, timeMs);
        const h1 = cpu.horizon.siteHeightM + T.state.params.mastM;
        const hzSun = exactHorizon(p.lat, p.lon, cpu.sun.az, h1), hzEarth = exactHorizon(p.lat, p.lon, cpu.earth.az, h1);
        rows.push({
          gpuF: gpu.sunFraction, cpuF: cpu.sun.fraction, exactF: Math.max(0, Math.min(1, (cpu.sun.el + cpu.sun.radiusDeg - hzSun) / (2 * cpu.sun.radiusDeg))),
          gpuE: gpu.earthVisible, cpuE: cpu.earth.visible, cpuAbove: cpu.earth.aboveDeg, exactAbove: cpu.earth.el - hzEarth,
        });
      }
      return { rows, nPts: pts.length, nDates: dates.length };
    });
    const R_ = out.rows, n = R_.length;
    // Hors pénombre = le moteur voit le disque entier ou rien du tout
    const flat = R_.filter((r) => r.cpuF === 0 || r.cpuF === 1), flatOk = flat.filter((r) => Math.abs(r.gpuF - r.cpuF) <= 0.02);
    const earthClear = R_.filter((r) => Math.abs(r.cpuAbove) > 0.05), earthOk = earthClear.filter((r) => r.gpuE === r.cpuE);
    const exactSun = R_.filter((r) => Math.abs(r.gpuF - r.exactF) <= 0.03), exactEarth = R_.filter((r) => Math.abs(r.exactAbove) < 0.02 || r.gpuE === (r.exactAbove > 0));
    const lit = R_.filter((r) => r.cpuF > 0).length, vis = R_.filter((r) => r.cpuE).length;
    info(`contrôle GPU/CPU : ${out.nPts} points × ${out.nDates} dates = ${n} cas (Soleil visible dans ${lit}, Terre visible dans ${vis})`);
    check('Soleil : shader = engine.siteNow hors pénombre', flatOk.length / flat.length >= 0.97, `${flatOk.length}/${flat.length} cas hors pénombre (${(100 * flatOk.length / flat.length).toFixed(1)} %) ; ${n - flat.length} cas de pénombre, écart moyen de fraction ${(R_.filter((r) => r.cpuF > 0 && r.cpuF < 1).reduce((s, r) => s + Math.abs(r.gpuF - r.cpuF), 0) / Math.max(1, n - flat.length)).toFixed(3)}`);
    check('Terre : shader = engine.siteNow (hors ±0,05° de l\'horizon)', earthOk.length / earthClear.length >= 0.97, `${earthOk.length}/${earthClear.length} cas (${(100 * earthOk.length / earthClear.length).toFixed(1)} %)`);
    check('Soleil : shader = marche fine CPU dans l\'azimut exact', exactSun.length / n >= 0.99, `${exactSun.length}/${n} cas à 0,03 près (${(100 * exactSun.length / n).toFixed(1)} %), écart maximal ${Math.max(...R_.map((r) => Math.abs(r.gpuF - r.exactF))).toFixed(3)}`);
    check('Terre : shader = marche fine CPU dans l\'azimut exact', exactEarth.length / n >= 0.99, `${exactEarth.length}/${n} cas (${(100 * exactEarth.length / n).toFixed(1)} %)`);
  }

  // ---- Clics
  const features = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/features.json'), 'utf8'));
  const shack = features.find((f) => f.name === 'Shackleton');
  await page.evaluate((f) => window.T.map.flyTo(f.lat, f.lon, 120), shack); await idle(page);
  await shot(page, 'shackleton-fr');
  {
    const p = await screenOf(page, shack.lat, shack.lon);
    await page.mouse.click(p.x, p.y);
    const s1 = await sel(page);
    check('clic sur le nom d\'une formation : sélection de la formation IAU', s1?.kind === 'feature' && s1.name === 'Shackleton' && s1.lat === shack.lat && s1.lon === shack.lon, JSON.stringify(s1));
    await setLayers(page, ['names'], false); await idle(page);
    await page.mouse.click(p.x, p.y);
    const s2 = await sel(page);
    const dist = await page.evaluate(([a, b]) => window.T.coords.surfaceDistance(a.lat, a.lon, b.lat, b.lon), [s2, shack]);
    check('clic au centre de Shackleton : coordonnées IAU à moins de 1 km', s2?.kind === 'point' && dist < 1000, `${s2?.name} — ${dist.toFixed(0)} m de ${shack.lat}, ${shack.lon}`);
    await setLayers(page, ['names'], true);
    await shot(page, 'selection-point');
  }
  {
    const site = await page.evaluate(() => window.T.sites.LANDING_SITES.find((s) => s.id.startsWith('malapert')));
    await page.evaluate((s) => window.T.map.flyTo(s.lat, s.lon, 150), site); await idle(page);
    const c = await screenOf(page, site.lat, site.lon);
    await page.mouse.click(c.x + 3, c.y - 2);
    check('clic sur le marqueur d\'une région Artemis', (await sel(page))?.siteId === site.id);
    await page.evaluate(() => window.T.select(null));
    await page.mouse.click(c.x + 28, c.y + 24);     // dans le rectangle, loin du marqueur
    check('clic dans le rectangle d\'une région Artemis : la région', (await sel(page))?.siteId === site.id);
    await page.mouse.click(c.x + 28, c.y + 24);
    const s3 = await sel(page);
    check('second clic dans la région déjà sélectionnée : le point lui-même', s3?.kind === 'point' && !s3.siteId, s3?.name);
    await idle(page); await shot(page, 'artemis-region');
  }

  // ---- Survol, molette, glisser, double-clic, clavier, boutons
  {
    await page.mouse.move(700, 430);
    await page.waitForTimeout(150);
    const hov = await page.evaluate(() => ({ hover: window.T.state.hover, text: document.querySelector('.map2d .readout').textContent, hidden: document.querySelector('.map2d .readout').classList.contains('hidden') }));
    const want = await screenOf(page, hov.hover?.lat ?? 0, hov.hover?.lon ?? 0);
    check('survol : state.hover et lecture lat/lon, hauteur, pente', !hov.hidden && Math.hypot(want.x - 700, want.y - 430) < 1 && /°S, .*hauteur.*m.*pente.*°/.test(hov.text), hov.text);
    const before = await view(page);
    await page.mouse.wheel(0, -400); await page.waitForTimeout(120);
    const after = await view(page), still = await screenOf(page, hov.hover.lat, hov.hover.lon);
    check('molette : zoom centré sur le curseur', after.scale < before.scale * 0.7 && Math.hypot(still.x - 700, still.y - 430) < 1.5, `${before.scale.toFixed(0)} -> ${after.scale.toFixed(0)} m/px`);
    await page.mouse.down(); await page.mouse.move(760, 400, { steps: 4 }); await page.mouse.up();
    const dragged = await view(page), selBefore = await sel(page);
    check('glisser : la carte suit le pointeur, sans sélectionner', Math.abs((after.cx - dragged.cx) / dragged.scale - 60) < 1.5 && Math.abs((dragged.cy - after.cy) / dragged.scale + 30) < 1.5 && (selBefore?.key === (await sel(page))?.key));
    await page.mouse.dblclick(760, 400); await page.waitForTimeout(150);
    check('double-clic : zoom', (await view(page)).scale < dragged.scale * 0.6);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -900);
    await page.waitForTimeout(100);
    check('zoom maximal borné à 30 m/px', Math.abs((await view(page)).scale - 30) < 1e-6);
    await idle(page); await shot(page, 'zoom-max');
    await page.focus('#view-map2d');
    await page.keyboard.press('0'); await idle(page);
    const home = await view(page);
    check('clavier : 0 revient à la vue d\'ensemble', Math.abs(home.cx) < 1 && Math.abs(home.cy) < 1 && Math.abs(home.scale - v0.scale) < 1e-6);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 900);
    await page.waitForTimeout(100);
    check('zoom minimal borné à la carte entière', Math.abs((await view(page)).scale - v0.scale) < 1e-6);
    await page.keyboard.press('+'); await idle(page);
    await page.keyboard.press('ArrowRight'); await idle(page);
    const kb = await view(page);
    check('clavier : + zoome, les flèches déplacent', kb.scale < home.scale * 0.7 && kb.cx > 10000 && Math.abs(kb.cy) < 1);
    await page.click('.map2d .zoomctl button:nth-child(2)'); await idle(page);
    check('bouton − : dézoome', (await view(page)).scale > kb.scale * 1.4);
    await page.click('.map2d .zoomctl button:nth-child(1)'); await idle(page);
    await page.click('.map2d .zoomctl button:nth-child(3)'); await idle(page);
    const reset = await view(page);
    check('bouton de retour au pôle', Math.abs(reset.cx) < 1 && Math.abs(reset.scale - v0.scale) < 1e-6);
    // Hors du disque : rien
    const keyBefore = (await sel(page))?.key;
    await page.mouse.click(40, 860);
    check('clic hors du disque 75°S : rien', (await sel(page))?.key === keyBefore);
    await page.mouse.move(40, 860); await page.waitForTimeout(120);
    check('survol hors de la carte : message, hover nul', await page.evaluate(() => window.T.state.hover === null && /hors de la carte/.test(document.querySelector('.map2d .readout').textContent)));
  }

  // ---- Sélection, vol, comparaison, mesure, imports
  {
    await page.evaluate(() => window.T.select(null));
    check('bouton « centrer sur la sélection » inactif sans sélection', await page.evaluate(() => document.querySelector('.map2d .zoomctl button:nth-child(4)').disabled));
    await page.evaluate(() => window.T.emit('view:flyTo', { lat: -84.79, lon: 29.2 })); await idle(page);
    const fly = await view(page), at = await screenOf(page, -84.79, 29.2);
    check('événement view:flyTo : centre sur le lieu et zoome depuis la vue d\'ensemble', Math.hypot(at.x - W / 2, at.y - H / 2) < 1 && fly.scale === 200);
    await page.evaluate(() => window.T.select({ name: 'test', lat: -84.9, lon: 30, kind: 'point' })); await idle(page);
    const stay = await view(page);
    check('sélection visible à l\'écran : la vue ne bouge pas', stay.cx === fly.cx && stay.cy === fly.cy);
    await page.evaluate(() => window.T.select({ name: 'loin', lat: -80, lon: 120, kind: 'point' })); await idle(page);
    const moved = await view(page), nob = await screenOf(page, -80, 120);
    check('sélection hors de l\'écran : recentrage sans changer d\'échelle', Math.hypot(nob.x - W / 2, nob.y - H / 2) < 1 && moved.scale === fly.scale);
    await page.evaluate(() => window.T.select({ name: 'Apollo 11', lat: 0.67, lon: 23.47, kind: 'historic', key: 'apollo11' })); await idle(page);
    const same = await view(page);
    check('sélection hors de la grille polaire : la vue ne bouge pas', same.cx === moved.cx && same.cy === moved.cy);
    await page.evaluate(() => { const T = window.T; T.select(T.sites.siteSelection(T.sites.LANDING_SITES.find((s) => s.id.startsWith('nobile_rim_1') || s.name === 'Nobile Rim 1'))); });
    await page.click('.map2d .zoomctl button:nth-child(4)'); await idle(page);
    const onSel = await page.evaluate(() => window.T.state.selection), cs = await screenOf(page, onSel.lat, onSel.lon);
    check('bouton « centrer sur la sélection »', Math.hypot(cs.x - W / 2, cs.y - H / 2) < 1);
    // Scénarios, mesure, imports
    await page.evaluate(() => {
      const T = window.T;
      T.addToCompare({ key: 'a', name: 'A', lat: -85.9, lon: 36, kind: 'point' }); T.addToCompare({ key: 'b', name: 'B', lat: -86.4, lon: 40, kind: 'point' }); T.addToCompare({ key: 'c', name: 'C', lat: -85.7, lon: 42, kind: 'point' });
      T.set({ imports: [{ id: 'i1', name: 'Essai', color: '#c084fc', features: [
        { type: 'point', coords: [[-85.6, 33]], name: 'Point importé' }, { type: 'line', coords: [[-85.5, 30], [-86.2, 33], [-86.6, 30]] },
        { type: 'polygon', coords: [[-86.6, 42], [-86.9, 46], [-87.1, 41]] }] }], tool: 'measure', measure: [] });
    });
    const keyBefore = (await sel(page))?.key;
    await page.mouse.click(500, 300); await page.mouse.click(620, 380); await page.mouse.click(600, 520);
    const m = await page.evaluate(() => window.T.state.measure);
    const m0 = await screenOf(page, m[0]?.lat ?? 0, m[0]?.lon ?? 0);
    check('outil de mesure : chaque clic ajoute un point, la sélection ne change pas', m.length === 3 && Math.hypot(m0.x - 500, m0.y - 300) < 1 && (await sel(page))?.key === keyBefore);
    check('outil de mesure : curseur en croix', await page.evaluate(() => getComputedStyle(document.querySelector('.map2d-overlay')).cursor === 'crosshair'));
    await idle(page); await shot(page, 'compare-measure-imports');
    // Le calque vectoriel porte bien ces éléments : la couleur de la pastille A se trouve à côté du scénario A
    const a = await screenOf(page, -85.9, 36);
    const pill = (await snapshotPixels(page, [{ x: a.x + 13, y: a.y - 20 }])).px[0];
    const wantPill = await page.evaluate(() => window.T.palettes.hexToRgb(window.T.palettes.cat('a', 'none')));
    check('pastille du scénario A dessinée', Math.hypot(pill[0] - wantPill[0], pill[1] - wantPill[1], pill[2] - wantPill[2]) < 30, `${pill} / ${wantPill}`);
    await page.evaluate(() => window.T.set({ tool: null, measure: [], imports: [], compare: [] }));
    await page.evaluate(() => window.T.select(null));
  }

  // ---- Temps : les ombres tournent ; lecture animée puis image complète
  {
    await page.keyboard.press('0'); await idle(page);
    const grid = []; for (let y = 120; y < 800; y += 34) for (let x = 380; x < 1080; x += 34) grid.push({ x, y });
    await setLayers(page, VECTOR_LAYERS, false); await idle(page);
    const t0 = await page.evaluate(() => window.T.state.timeMs);
    const a = await snapshotPixels(page, grid);
    check('snapshot() : PNG à la taille du canvas', a.isPng && a.width === W && a.height === H);
    await setLayers(page, VECTOR_LAYERS, true);
    await page.evaluate((t) => window.T.set({ timeMs: t + 14.765 * 86400e3 }), t0); await idle(page);
    await shot(page, 'overview-half-lunation-later');
    await setLayers(page, VECTOR_LAYERS, false); await idle(page);
    const b = await snapshotPixels(page, grid);
    await setLayers(page, VECTOR_LAYERS, true);
    const lum = (c) => (c[0] + c[1] + c[2]) / 3;
    const flipped = grid.filter((_, i) => (lum(a.px[i]) > 95) !== (lum(b.px[i]) > 95)).length;
    const litA = a.px.filter((c) => lum(c) > 95).length, litB = b.px.filter((c) => lum(c) > 95).length;
    check('une demi-lunaison plus tard : l\'éclairement a basculé', flipped > grid.length * 0.5, `${flipped}/${grid.length} points changent de camp (éclairés : ${litA} puis ${litB})`);
    // Lecture animée : images allégées, puis une image complète à l'arrêt
    await idle(page);
    const frames0 = (await page.evaluate(() => window.T.map.perf)).frames;
    await page.evaluate(() => window.T.set({ playing: true }));
    for (let i = 1; i <= 4; i++) { await page.evaluate(([t, k]) => window.T.set({ timeMs: t + k * 3600e3 }), [t0, i]); await page.waitForTimeout(350); }
    const framesPlay = (await page.evaluate(() => window.T.map.perf)).frames;
    await page.waitForTimeout(400);
    await shot(page, 'playing-reduced');             // image intermédiaire : résolution réduite puis agrandie (machine lente)
    await page.evaluate(() => window.T.set({ playing: false })); await idle(page);
    const framesEnd = (await page.evaluate(() => window.T.map.perf)).frames;
    check('lecture animée : images allégées, image complète à l\'arrêt', framesPlay === frames0 && framesEnd === frames0 + 1, `images complètes : ${frames0} avant, ${framesPlay} pendant, ${framesEnd} après`);
    await page.evaluate((t) => window.T.set({ timeMs: t }), t0); await idle(page);
  }

  // ---- Calques colorés : légende, texture créée puis supprimée, capture de chacun
  {
    const all = await page.evaluate(() => window.T.layers.all().filter((l) => l.views.includes('map2d') && (l.palette || l.mask)).map((l) => ({ id: l.id, available: l.available, needs: l.needs, raster: l.kind === 'polar' && l.needs[0] !== 'sp_dem' })));
    await page.evaluate(() => window.T.map.flyTo(-88.2, 40, 420)); await idle(page);
    for (const l of all) {
      if (!l.available) { info(`calque ${l.id} indisponible (données absentes) : non testé`); continue; }
      await page.evaluate((id) => window.T.layers.toggle(id, true), l.id);
      if (l.raster) await page.waitForFunction((id) => window.T.map.perf.rasters.includes(id), l.needs[0], { timeout: 120000 });
      await idle(page);
      const leg = await page.evaluate(() => [...document.querySelectorAll('.map2d .legend .legend-item')].map((el) => el.textContent));
      const title = await page.evaluate((id) => window.T.t(`layer.${id}`), l.id);
      await shot(page, `layer-${l.id}`);
      await page.evaluate((id) => window.T.layers.toggle(id, false), l.id);
      await page.waitForTimeout(60);
      const left = await page.evaluate(() => ({ rasters: window.T.map.perf.rasters, hidden: document.querySelector('.map2d .legend').classList.contains('hidden') }));
      check(`calque ${l.id} : légende affichée${l.raster ? ', texture créée puis supprimée' : ''}`, leg.length === 1 && leg[0].includes(title) && left.hidden && (!l.raster || !left.rasters.includes(l.needs[0])), leg[0]);
    }
    // Empilement dans l'ordre du gestionnaire : palette + deux masques
    await setLayers(page, ['slope', 'landable', 'psr'], true);
    await page.waitForFunction(() => window.T.map.perf.rasters.includes('sp_psr'), null, { timeout: 120000 }).catch(() => {});
    await idle(page);
    check('trois calques empilés : trois entrées de légende', await page.evaluate(() => document.querySelectorAll('.map2d .legend .legend-item').length === 3));
    await shot(page, 'layers-stacked');
    await setLayers(page, ['slope', 'landable', 'psr'], false);
    // Paramètre : le seuil de pente change la légende
    await page.evaluate(() => { window.T.layers.toggle('landable', true); window.T.setParam('slopeLimitDeg', 5); });
    check('paramètre de pente : légende mise à jour', await page.evaluate(() => /5°/.test(document.querySelector('.map2d .legend').textContent)));
    await page.evaluate(() => { window.T.layers.toggle('landable', false); window.T.setParam('slopeLimitDeg', 10); });
    await idle(page);
  }

  // ---- Durée d'une image complète (rendu logiciel), plein écran
  {
    const time = async (label, prepare) => {
      const ms = [];
      await page.evaluate(prepare); await idle(page);
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.T.set({ timeMs: window.T.state.timeMs + 60000 })); await idle(page); ms.push((await page.evaluate(() => window.T.map.perf)).lastMs); }
      info(`durée d'une image complète 1440 × 900, ${label} : ${ms.map((v) => v.toFixed(0)).join(', ')} ms (WebGL logiciel)`);
    };
    await time('vue d\'ensemble, ombres seules', () => { window.T.map.flyTo(-90, 0, 1e9); });
    await time('Shackleton à 60 m/px, ombres seules', () => { window.T.map.flyTo(-89.67, 129.2, 60); });
    await time('vue d\'ensemble, ombres + Terre visible', () => { window.T.map.flyTo(-90, 0, 1e9); window.T.layers.toggle('earth_now', true); });
    await page.evaluate(() => window.T.layers.toggle('earth_now', false)); await idle(page);
  }

  // ---- Anglais
  {
    await page.evaluate(() => window.T.map.flyTo(-89.67, 129.2, 120)); await idle(page);
    await page.evaluate(() => { window.T.set({ lang: 'en' }); window.T.layers.toggle('sun_now', true); });
    await page.mouse.move(700, 430); await idle(page);
    const en = await page.evaluate(() => ({ titles: [...document.querySelectorAll('.map2d .zoomctl button')].map((b) => b.title), readout: document.querySelector('.map2d .readout').textContent, aria: document.getElementById('view-map2d').getAttribute('aria-label'), legend: document.querySelector('.map2d .legend').textContent }));
    check('anglais : boutons, lecture, légende', en.titles[0] === 'Zoom in' && /height.*slope/.test(en.readout) && /south pole/.test(en.aria) && /computed/.test(en.legend), `${en.titles.join(' | ')} — ${en.readout}`);
    await shot(page, 'shackleton-en');
    await page.evaluate(() => { window.T.layers.toggle('sun_now', false); window.T.set({ lang: 'fr' }); });
  }

  // ---- Perte puis retour du contexte WebGL
  {
    await page.evaluate(() => { window.__lose = document.querySelector('.map2d-gl').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
    await page.waitForFunction(() => !document.querySelector('.map2d-notice').classList.contains('hidden'), null, { timeout: 10000 });
    check('contexte WebGL perdu : message traduit', /contexte WebGL/.test(await page.evaluate(() => document.querySelector('.map2d-notice').textContent)));
    await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForFunction(() => document.querySelector('.map2d-notice').classList.contains('hidden'), null, { timeout: 60000 });
    await idle(page);
    const px = (await snapshotPixels(page, [{ x: 300, y: 300 }, { x: 720, y: 450 }, { x: 1000, y: 600 }, { x: 500, y: 700 }])).px;
    check('contexte WebGL rétabli : la carte se redessine', new Set(px.map((c) => c.join())).size > 1, px.map((c) => c.join(',')).join(' | '));
    await shot(page, 'after-context-restore');
  }
  check('bureau : zéro erreur console ou réseau, aucune clé de traduction manquante', real(problems).length === 0, real(problems).slice(0, 6).join(' ; '));
  await browser.close();
}

// =====================================================================================================
// 2. Téléphone 390 × 844, anglais
// =====================================================================================================
{
  const { browser, page, problems } = await open('lang=en', { width: 390, height: 844 });
  await idle(page);
  await shot(page, 'mobile-overview-en');
  const v0 = await view(page);
  check('téléphone : toute la carte tient dans la largeur', v0.scale > 2 * 457000 / 390 && v0.scale < 2 * 457000 / 390 * 1.1, `${v0.scale.toFixed(0)} m/px`);
  // Pincement : deux pointeurs tactiles qui s'écartent
  await page.evaluate(() => {
    const el = document.querySelector('.map2d-overlay'), r = el.getBoundingClientRect();
    const fire = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 11 }));
    fire('pointerdown', 11, 160, 400); fire('pointerdown', 12, 230, 400);
    for (let k = 1; k <= 6; k++) { fire('pointermove', 11, 160 - 10 * k, 400); fire('pointermove', 12, 230 + 10 * k, 400); }
    fire('pointerup', 11, 100, 400); fire('pointerup', 12, 290, 400);
  });
  const v1 = await view(page);
  check('pincement : zoom sans sélection', v1.scale < v0.scale * 0.5 && (await sel(page)) === null, `${v0.scale.toFixed(0)} -> ${v1.scale.toFixed(0)} m/px`);
  // Toucher bref : sélection d'un point
  await page.evaluate(() => {
    const el = document.querySelector('.map2d-overlay'), r = el.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: 'touch', clientX: r.left + 180, clientY: r.top + 330, bubbles: true, isPrimary: true }));
  });
  check('toucher bref : sélection', (await sel(page)) !== null);
  await page.evaluate(() => { window.T.map.flyTo(-89.67, 129.2, 150); window.T.layers.toggle('sun_avg', true); });
  await page.waitForFunction(() => window.T.map.perf.rasters.includes('sp_sun_avg'), null, { timeout: 120000 });
  await idle(page);
  await shot(page, 'mobile-shackleton-sun-avg-en');
  const boxes = await page.evaluate(() => Object.fromEntries(['.zoomctl', '.legend', '.readout'].map((s) => { const r = document.querySelector('.map2d ' + s).getBoundingClientRect(); return [s, [r.left, r.top, r.right, r.bottom]]; })));
  const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  check('téléphone : légende dans l\'écran, sans recouvrir les boutons de zoom', boxes['.legend'][0] >= 0 && boxes['.legend'][2] <= 390 && !overlap(boxes['.legend'], boxes['.zoomctl']), JSON.stringify(boxes));
  check('téléphone : zéro erreur console ou réseau', real(problems).length === 0, real(problems).slice(0, 6).join(' ; '));
  await browser.close();
}

// =====================================================================================================
// 3. Sans WebGL 2 ; sans relief
// =====================================================================================================
{
  const { browser, page, problems } = await open('lang=fr&nowebgl=1');
  const r = await page.evaluate(() => ({ text: document.querySelector('.map2d-notice').textContent, calls: [window.T.map.setActive(true), window.T.map.resize(), window.T.map.flyTo(-89, 0), window.T.map.snapshot()] }));
  check('sans WebGL 2 : message traduit, interface inerte', /WebGL 2/.test(r.text) && r.calls[3] === null, r.text);
  await page.evaluate(() => window.T.set({ lang: 'en' }));
  check('sans WebGL 2 : message traduit en anglais', /unavailable/.test(await page.evaluate(() => document.querySelector('.map2d-notice').textContent)));
  await shot(page, 'no-webgl2');
  check('sans WebGL 2 : zéro erreur console', real(problems).length === 0, real(problems).join(' ; '));
  await browser.close();
}
{
  const { browser, page, problems } = await open('lang=fr&nodem=1');
  await idle(page);
  await page.route('**/sp_dem_240m.i16', (route) => route.fulfill({ status: 404, body: 'absent' }));
  await page.evaluate(() => window.T.registry.ensureData('sp_dem').catch(() => {}));
  await page.waitForFunction(() => !document.querySelector('.map2d-notice').classList.contains('hidden'), null, { timeout: 20000 });
  await idle(page);
  const text = await page.evaluate(() => document.querySelector('.map2d-notice').textContent);
  await shot(page, 'no-dem');
  await page.mouse.click(720, 300);
  const s = await sel(page);
  const others = real(problems).filter((p) => !/sp_dem_240m\.i16|Failed to load resource/.test(p));
  check('sans relief : message, grille et sites dessinés, clic utilisable, aucun plantage', /Relief LOLA indisponible/.test(text) && s?.kind === 'point' && others.length === 0, `${text} ${others.join(' ; ')}`);
  await browser.close();
}

// =====================================================================================================
// 4. Dans l'application complète (indicatif : dépend des modules voisins, ne fait pas échouer ce test)
// =====================================================================================================
for (const [name, size] of [['app-desktop', { width: 1440, height: 900 }], ['app-mobile', { width: 390, height: 844 }]]) {
  const app = await serveStatic();
  const { browser, page, problems } = await openPage(app.url, size);
  try {
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
    await page.waitForFunction(() => window.RF?.views?.map2d?.perf?.idle, null, { timeout: 180000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `map2d-${name}.png`) });
    const p = await page.evaluate(() => { const q = window.RF.views.map2d.perf; return `${q.cssW} × ${q.cssH} px, ${q.view.scale.toFixed(0)} m/px, image complète en ${q.lastMs.toFixed(0)} ms`; });
    info(`application complète (${name}) : carte ${p} ; problèmes : ${real(problems).length ? real(problems).slice(0, 4).join(' ; ') : 'aucun'}`);
  } catch (e) { info(`application complète (${name}) non vérifiée : ${e.message.split('\n')[0]} ${real(problems).slice(0, 3).join(' ; ')}`); }
  await browser.close(); app.close();
}

srv.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies${failed.length ? ' — échecs : ' + failed.map((f) => f.name).join(' ; ') : ''}`);
process.exit(failed.length ? 1 : 0);
