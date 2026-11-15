// Panorama d'horizon (views/skyview.js) et barre de temps (ui/timebar.js), montés seuls dans tests/pages/sky-timebar.html.
// Lancement (un seul test navigateur à la fois sur la machine) :
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/sky-timebar.browser.mjs
// Captures dans tests/.out/sky-*.png et tests/.out/timebar-*.png. Code de sortie 1 si une vérification échoue.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, openPage, OUT } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = await serveStatic(ROOT);
const PAGE = `${srv.url}tests/pages/sky-timebar.html`;
const SITES = {
  shackleton: { key: 'test:shackleton', name: 'Crête de Shackleton', lat: -89.45, lon: -137.3, kind: 'point' },
  malapert: { key: 'test:malapert', name: 'Malapert', lat: -85.99, lon: -2.9, kind: 'point' },
  apollo11: { key: 'apollo11', siteId: 'apollo11', name: 'Apollo 11 — Tranquility Base', lat: 0.6741, lon: 23.4731, kind: 'historic' },
};
const T_REF = Date.UTC(2026, 10, 15, 12);            // date de référence des captures
const T_NIGHT = Date.UTC(2026, 4, 5);                // nuit polaire sur la crête de Shackleton (fraction du disque = 0)
const DAY = 86400e3, HOUR = 3600e3;

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : 'ÉCHEC '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// Chromium signale parfois « ERR_ABORTED » pour le relief (29 Mo lus en flux) alors que le fichier est arrivé entier :
// la page ne devient « prête » qu'après ce chargement, et les contrôles « relief pris en compte » le confirment.
const realProblems = (list) => list.filter((p) => !/^requestfailed: .*sp_dem_240m\.i16 net::ERR_ABORTED$/.test(p));

async function open(url, size) {
  const ctx = await openPage(url, size);
  await ctx.page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  return ctx;
}
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const setState = (page, patch) => page.evaluate((p) => window.RF.set(p), patch);
const selectSite = (page, site) => page.evaluate((s) => window.RF.select(s), site);
const panelWidth = (page, w) => page.evaluate((px) => { document.getElementById('panel').style.width = `${px}px`; }, w);
const barWidth = (page, w) => page.evaluate((px) => { document.getElementById('timebar-box').style.width = px ? `${px}px` : '100%'; }, w);
/** Attend que les quatre chiffres clés soient affichés. */
const transitionsReady = (page) => page.waitForFunction(() => document.querySelectorAll('#sky .sky-stats .stat-value').length === 4, null, { timeout: 20000 });
const bandsReady = (page) => page.waitForFunction(() => document.querySelector('.tb-busy').classList.contains('hidden'), null, { timeout: 60000 });
const statTexts = (page) => page.evaluate(() => [...document.querySelectorAll('#sky .sky-stats .stat')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const untranslated = (page) => page.evaluate(() => [...document.querySelectorAll('body *')]
  .flatMap((e) => [e.children.length === 0 ? e.textContent.trim() : '', e.getAttribute('title') || '', e.getAttribute('aria-label') || ''])
  .filter((s) => /^(sky|timebar|body|prov|ui)\.[a-z]/i.test(s)));

// =====================================================================================================
// 1. Bureau 1440×900, français
// =====================================================================================================
let { browser, page, problems } = await open(PAGE, { width: 1440, height: 900 });
console.log('— Panorama, bureau, français');
await setState(page, { lang: 'fr', timeMs: T_REF, timeScale: 'year', playing: false });

// Sans sélection : état vide, boutons de saut désactivés
check('état vide sans sélection', await page.evaluate(() => !document.querySelector('#sky .sky-empty').classList.contains('hidden') && document.querySelector('#sky .sky-body').classList.contains('hidden')));
check('sauts désactivés sans sélection', await page.evaluate(() => [...document.querySelectorAll('.tb-jump')].every((b) => b.disabled)));
check('aria-label de l’état vide', (await page.getAttribute('#sky canvas', 'aria-label')).includes('aucun site'));

// Trois sites, largeur de la fiche (344 px) puis large (900 px)
for (const [id, site] of Object.entries(SITES)) {
  await selectSite(page, site);
  await panelWidth(page, 344); await settle(page); await transitionsReady(page);
  await page.locator('#panel').screenshot({ path: `${OUT}/sky-${id}-fr-344.png` });
  await panelWidth(page, 900); await settle(page);
  await page.locator('#panel').screenshot({ path: `${OUT}/sky-${id}-fr-900.png` });
  const info = await page.evaluate(() => {
    const L = window.RF.sky.layout(), now = window.RF.engine.siteNow(window.RF.state.selection);
    return { elMin: L.elMin, elMax: L.elMax, exag: L.verticalExaggeration, azMin: L.azMin, terrain: now.horizon.terrain, sunEl: now.sun.el, earthEl: now.earth.el, earthVis: now.earth.visible,
      aria: document.querySelector('#sky canvas').getAttribute('aria-label'), note: !document.querySelector('#sky .sky-noterrain').classList.contains('hidden') };
  });
  console.log(`   ${id} : cadre ${info.elMin}°…${info.elMax}°, exagération ×${info.exag.toFixed(1)}, centre ${info.azMin === 0 ? 'Sud' : 'Nord'} ; ${info.aria}`);
  console.log(`   ${(await statTexts(page)).join(' | ')}`);
  check(`${id} : quatre chiffres clés`, (await statTexts(page)).length === 4);
  check(`${id} : mention « relief non pris en compte » ${info.terrain ? 'absente' : 'présente'}`, info.note === !info.terrain);
  check(`${id} : phrase d’accessibilité`, /Soleil .*horizon, Terre (visible|masquée)\./.test(info.aria) && info.aria.includes(info.earthVis ? 'visible' : 'masquée'));
}

// Temps restants : mêmes dates que le moteur
await selectSite(page, SITES.shackleton); await settle(page); await transitionsReady(page);
const cmp = await page.evaluate(() => {
  const { engine, state } = window.RF, tr = engine.siteTransitions(state.selection, Math.ceil(state.timeMs / 60000) * 60000);
  const subs = [...document.querySelectorAll('#sky .sky-stats .stat-sub')].map((e) => e.textContent);
  const fmt = (ms) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  return { sunSub: subs[2], earthSub: subs[3], sunWant: tr.sun.nextMs === null ? null : fmt(tr.sun.nextMs), earthWant: tr.earth.nextMs === null ? null : fmt(tr.earth.nextMs), sunNow: tr.sun.now, earthNow: tr.earth.now,
    labels: [...document.querySelectorAll('#sky .sky-stat-name')].map((e) => e.textContent) };
});
check('date du prochain basculement du Soleil = moteur', cmp.sunWant === null ? /Recherche/.test(cmp.sunSub) : cmp.sunSub === cmp.sunWant, `${cmp.labels[2]} : ${cmp.sunSub}`);
check('date du prochain basculement de la Terre = moteur', cmp.earthWant === null ? /Recherche/.test(cmp.earthSub) : cmp.earthSub === cmp.earthWant, `${cmp.labels[3]} : ${cmp.earthSub}`);
check('libellés coucher/lever et perte/retour selon l’état', cmp.labels[2].startsWith(cmp.sunNow ? 'Coucher' : 'Lever') && cmp.labels[3].startsWith(cmp.earthNow ? 'Perte' : 'Retour'));

// Basculement dans la minute en cours : le moteur décrit le début de la minute (état contraire), le compte à rebours suit siteNow()
const flip = await page.evaluate(() => {
  const { engine, state, set, sky } = window.RF, site = state.selection;
  const next = engine.siteTransitions(site, state.timeMs).earth.nextMs, t = Math.ceil(next) + 2000;
  set({ timeMs: t }); sky.update();
  const now = engine.siteNow(site, t), stale = engine.siteTransitions(site, t), fresh = engine.siteTransitions(site, Math.floor(t / 60000) * 60000 + 60000);
  const card = document.querySelectorAll('#sky .sky-stats .stat')[3];
  const fmt = (ms) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  return { sameMinute: Math.floor(t / 60000) === Math.floor(next / 60000), visible: now.earth.visible, staleNow: stale.earth.now, name: card.querySelector('.sky-stat-name').textContent, value: card.querySelector('.stat-value').textContent.trim(), sub: card.querySelector('.stat-sub').textContent, want: fmt(fresh.earth.nextMs) };
});
check('basculement dans la minute : état de siteNow() affiché, pas celui (contraire) du début de minute', flip.sameMinute && flip.visible !== flip.staleNow && flip.name.startsWith(flip.visible ? 'Perte' : 'Retour') && flip.value !== '—' && flip.sub === flip.want, `${flip.name} ${flip.value} (${flip.sub}) ; moteur au début de la minute : Terre ${flip.staleNow ? 'visible' : 'masquée'}`);
check('note sur les passages de moins d’une heure', /moins d’une heure peuvent être manqués/.test(await page.textContent('#sky .sky-foot')));
check('légende : « Horizon du relief (LOLA, 240 m) »', /Horizon du relief \(LOLA, 240\sm\)/.test(await page.textContent('#sky .sky-legend')));
await setState(page, { timeMs: T_REF });

// La trajectoire dessinée couvre toujours la date courante : 10 dates tirées au hasard (graine fixe) + deux bords de grille
const cover = await page.evaluate(() => {
  const { set, sky } = window.RF, out = [];
  let seed = 20261115; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const dates = Array.from({ length: 10 }, () => Math.round(Date.UTC(2026, 0, 1) + rnd() * 3652 * 86400e3));
  dates.push(700 * 29 * 86400e3 - 1000, 700 * 29 * 86400e3);
  for (const t of dates) { set({ timeMs: t }); sky.update(); const k = sky.layout().track; out.push({ t, ok: k.t0Ms <= t && t <= k.t1Ms, lead: (t - k.t0Ms) / 86400e3 }); }
  return out;
});
check('trajectoire : la date courante est dans la série dessinée (12 dates)', cover.every((c) => c.ok), cover.map((c) => `${new Date(c.t).toISOString().slice(0, 10)} J+${c.lead.toFixed(1)}`).join(', '));
await setState(page, { timeMs: T_REF });

// Site entre 75° S et 80° S : l'horizon peut être tronqué au bord du relief embarqué
await selectSite(page, { key: 'test:bord', name: 'Bord du relief', lat: -77, lon: 0, kind: 'point' }); await settle(page);
const edge = await page.evaluate(() => ({ terrain: window.RF.engine.siteNow(window.RF.state.selection).horizon.terrain, shown: !document.querySelector('#sky .sky-edge').classList.contains('hidden'), text: document.querySelector('#sky .sky-edge').textContent }));
check('77° S : mention « relief connu jusqu’à 75° S »', edge.terrain === true && edge.shown && /75° S seulement/.test(edge.text), edge.text);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-bord-77S-fr.png` });
await selectSite(page, SITES.shackleton); await settle(page);
check('crête de Shackleton : pas de mention de bord', await page.evaluate(() => document.querySelector('#sky .sky-edge').classList.contains('hidden')));

// Malapert : la Terre ne revient pas en 400 jours à ce point précis
await selectSite(page, SITES.malapert); await settle(page); await transitionsReady(page);
const mal = await statTexts(page);
check('« aucun changement dans les 400 jours » quand nextMs est null', /Aucun changement dans les 400\sjours/.test(mal[3]) && /Recherche jusqu’au/.test(mal[3]), mal[3]);

// Survol : azimut, élévation, hauteur du relief
await selectSite(page, SITES.shackleton); await settle(page);
const box = await page.locator('#sky canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4); await settle(page, 200);
const hov = await page.evaluate(({ fx, fy }) => {
  const L = window.RF.sky.layout(), c = document.querySelector('#sky canvas').getBoundingClientRect();
  const az = ((L.azMin + ((fx * c.width - L.plot.x) / L.plot.w) * L.azSpan) % 360 + 360) % 360;
  const hz = window.RF.engine.siteNow(window.RF.state.selection).horizon, f = az * hz.n / 360, i = Math.floor(f) % hz.n, j = (i + 1) % hz.n;
  return { text: document.querySelector('#sky .sky-readout').textContent, az, relief: hz.elev[i] * (1 - (f - Math.floor(f))) + hz.elev[j] * (f - Math.floor(f)) };
}, { fx: 0.5, fy: 0.4 });
const hovNums = hov.text.replace(/−/g, '-').match(/-?\+?\d+,\d/g)?.map((s) => Number(s.replace('+', '').replace(',', '.'))) ?? [];
check('survol : azimut et hauteur du relief du moteur', /^Azimut .* élévation .* relief /.test(hov.text) && near(hovNums[0], hov.az, 0.11) && near(hovNums[2], hov.relief, 0.06), hov.text);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-shackleton-survol.png` });
await page.mouse.move(5, 5);

// Recentrage Nord / Sud
const c0 = await page.evaluate(() => window.RF.sky.layout().azMin);
await page.click('#sky .sky-center .seg button:not(.is-on)'); await settle(page, 200);
const c1 = await page.evaluate(() => window.RF.sky.layout().azMin);
check('recentrage Nord/Sud', c0 !== c1 && [0, 180].includes(c0) && [0, 180].includes(c1), `azimut du bord gauche ${c0}° → ${c1}°`);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-shackleton-recentre.png` });

// Cohérence : Soleil couché => disque entièrement sous la silhouette
await setState(page, { timeMs: T_NIGHT }); await settle(page);
const night = await page.evaluate(() => {
  const { engine, state, sky } = window.RF, now = engine.siteNow(state.selection), L = sky.layout(), hz = now.horizon;
  const at = (az) => { const f = (((az % 360) + 360) % 360) * hz.n / 360, i = Math.floor(f) % hz.n, j = (i + 1) % hz.n, w = f - Math.floor(f); return hz.elev[i] * (1 - w) + hz.elev[j] * w; };
  let worst = Infinity;                               // marge en px entre le haut du disque et la silhouette, sur toute sa largeur
  for (let k = -4; k <= 4; k++) { const d = (k / 4) * now.sun.radiusDeg, top = now.sun.el + Math.sqrt(Math.max(0, now.sun.radiusDeg ** 2 - d * d)); worst = Math.min(worst, L.yOf(top) - L.yOf(at(now.sun.az + d))); }
  const c = document.querySelector('#sky canvas'), dpr = c.width / c.getBoundingClientRect().width, g = c.getContext('2d');
  const px = (x, y) => [...g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
  return { fraction: now.sun.fraction, above: now.sun.aboveDeg, worst, sunY: L.sun.y, ridgeY: L.yOf(at(now.sun.az)), centre: px(L.sun.x, L.sun.y), voisin: px(L.sun.x - 40, L.sun.y) };
});
const dist = Math.hypot(...night.centre.slice(0, 3).map((v, i) => v - night.voisin[i]));
check('date de nuit : fraction du disque = 0 (moteur)', night.fraction === 0, `centre du Soleil ${night.above.toFixed(2)}° sous le relief`);
check('disque dessiné sous la silhouette (géométrie)', night.worst > 0, `haut du disque ${night.worst.toFixed(1)} px sous la silhouette ; centre y=${night.sunY.toFixed(1)}, crête y=${night.ridgeY.toFixed(1)}`);
check('disque dessiné sous la silhouette (pixels : couleur du relief au centre du disque)', dist < 12, `centre rgb(${night.centre.slice(0, 3)}), relief voisin rgb(${night.voisin.slice(0, 3)})`);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-shackleton-nuit.png` });
await transitionsReady(page);
check('nuit : « Lever du Soleil dans … »', /^Lever du Soleil dans/.test((await statTexts(page))[2]), (await statTexts(page))[2]);

// Zoom Terre
await setState(page, { timeMs: T_REF });
await page.click('#sky .sky-head .seg button:nth-child(2)'); await settle(page);
const zoom = await page.evaluate(() => { const L = window.RF.sky.layout(); return { mode: L.mode, span: L.azSpan, ex: L.verticalExaggeration, rx: L.earth.rx, ry: L.earth.ry, inside: L.earth.x > L.plot.x && L.earth.x < L.plot.x + L.plot.w }; });
check('Zoom Terre : 30° d’azimut, échelles égales, Terre dans le cadre', zoom.mode === 'zoom' && zoom.span === 30 && near(zoom.ex, 1, 1e-9) && zoom.inside, `Terre ${zoom.rx.toFixed(1)} × ${zoom.ry.toFixed(1)} px`);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-shackleton-zoom-900.png` });
await panelWidth(page, 344); await settle(page);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-shackleton-zoom-344.png` });
for (const id of ['malapert', 'apollo11']) {
  await selectSite(page, SITES[id]); await panelWidth(page, 900); await settle(page);
  await page.locator('#panel').screenshot({ path: `${OUT}/sky-${id}-zoom-900.png` });
  // Terre haute dans le ciel (Apollo 11) : le dessin dit que les disques sont étirés en azimut ; pas au pôle
  const stretch = await page.evaluate(() => [...document.querySelectorAll('#sky .sky-readout')].filter((x) => !x.classList.contains('hidden')).map((x) => x.textContent).find((x) => /étiré/.test(x)) || '');
  check(`${id} : mention d’étirement en azimut ${id === 'apollo11' ? 'présente' : 'absente'}`, (stretch !== '') === (id === 'apollo11'), stretch);
}
await page.click('#sky .sky-head .seg button:nth-child(1)');

// Temps de dessin d'une image (30 dessins à des dates différentes, fiche de 344 px puis 900 px)
for (const w of [344, 900]) {
  await selectSite(page, SITES.shackleton); await panelWidth(page, w); await settle(page);
  const cost = await page.evaluate(() => {
    const { set, sky } = window.RF, out = [];
    for (let k = 0; k < 30; k++) { set({ timeMs: Date.UTC(2026, 10, 15, 12) + k * 3600e3 }); sky.update(); out.push(sky.layout().drawMs); }
    out.sort((a, b) => a - b); return { med: out[15], max: out[29] };
  });
  check(`temps de dessin (${w} px)`, cost.med < 25, `médiane ${cost.med.toFixed(1)} ms, maximum ${cost.max.toFixed(1)} ms`);
}

// Vue comparaison : trois panoramas compacts à site et date imposés
await page.evaluate(({ sites, t }) => { window.RF.compare([{ site: sites.shackleton, timeMs: t }, { site: sites.malapert, timeMs: t }, { site: sites.apollo11, timeMs: t + 10 * 86400e3 }]); }, { sites: SITES, t: T_REF });
await settle(page, 500);
check('version compacte : dessin sans chiffres, phrase de synthèse', await page.evaluate(() => document.querySelectorAll('#compare .sky-compact canvas').length === 3 && !document.querySelector('#compare .stat') && [...document.querySelectorAll('#compare .sky-summary')].every((e) => e.textContent.length > 20)));
await page.locator('#compare').screenshot({ path: `${OUT}/sky-compact-fr.png` });

// -----------------------------------------------------------------------------------------------------
console.log('— Barre de temps, bureau, français');
await setState(page, { timeMs: T_REF, timeScale: 'year' }); await selectSite(page, SITES.shackleton);
const win = (p = page) => p.evaluate(() => { const th = document.querySelector('.tb-thumb'); return [Number(th.getAttribute('aria-valuemin')), Number(th.getAttribute('aria-valuemax'))]; });
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Trois largeurs de barre : 784 px (1440 px avec les deux panneaux), 1264 px (un panneau), 1900 px (grand écran)
for (const [w, label] of [[784, 'moyenne'], [1264, 'large'], [1900, 'complete']]) {
  await page.setViewportSize({ width: Math.max(1440, w + 20), height: 900 });
  await barWidth(page, w);
  for (const scale of ['lunarDay', 'year', 'decade']) {
    await setState(page, { timeScale: scale }); await settle(page, 700); await bandsReady(page); await settle(page, 200);
    await page.locator('#timebar').screenshot({ path: `${OUT}/timebar-${label}-${scale}-fr.png` });
    const [a, b] = await win();
    console.log(`   ${label} / ${scale} : fenêtre ${iso(a)} → ${iso(b)}`);
    if (scale === 'lunarDay') check(`${label} : jour lunaire = 29,53 j dès 00:00 UTC`, a === Date.UTC(2026, 10, 15) && near(b - a, 29.530588853 * DAY, 1));
    if (scale === 'year') check(`${label} : année civile`, a === Date.UTC(2026, 0, 1) && b === Date.UTC(2027, 0, 1));
    if (scale === 'decade') check(`${label} : décennie 2026–2036`, a === Date.UTC(2026, 0, 1) && b === Date.UTC(2036, 0, 1));
  }
  const fits = await page.evaluate(() => { const c = document.querySelector('.tb-controls'), r = c.getBoundingClientRect(); return { rows: new Set([...c.children].map((e) => Math.round(e.getBoundingClientRect().top))).size, overflow: c.scrollWidth > Math.ceil(r.width) + 1, h: document.getElementById('timebar').offsetHeight }; });
  check(`${label} (${w} px) : commandes sur une ligne, sans débordement, barre ≤ 92 px (--timebar-h)`, fits.rows === 1 && !fits.overflow && fits.h <= 92, `hauteur de la barre ${fits.h} px`);
  const shown = await page.evaluate(() => { const vis = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none'; return { seg: vis('.tb-speed-seg'), select: vis('.tb-speed-select'), jumpText: vis('.tb-jump .tb-wide') }; });
  check(`${label} : vitesses en ${w < 1090 ? 'liste' : 'boutons'}, sauts ${w > 1440 ? 'avec' : 'sans'} texte`, shown.seg === (w >= 1090) && shown.select === (w < 1090) && shown.jumpText === (w > 1440));
}
const speedLabels = await page.evaluate(() => [...document.querySelectorAll('.tb-speed-seg button')].map((b) => b.textContent.replace(/\s/g, ' ')));
check('vitesses : « 1 000× » avec son espace, comme « 10 000× »', speedLabels.join('|') === '1×|10×|100×|1 000×|10 000×|100 000×|1 000 000×', speedLabels.join(' '));
await page.setViewportSize({ width: 1440, height: 900 });
await barWidth(page, 784);

// Fenêtres hors 2026–2036 et ré-ancrage du jour lunaire
await setState(page, { timeScale: 'decade', timeMs: Date.UTC(2040, 2, 3) }); await settle(page, 700);
let [wa, wb] = await win();
check('décennie contenant la date hors 2026–2036', wa === Date.UTC(2036, 0, 1) && wb === Date.UTC(2046, 0, 1), `${iso(wa)} → ${iso(wb)}`);
await setState(page, { timeMs: Date.UTC(2021, 6, 1) }); await settle(page, 700); [wa, wb] = await win();
check('décennie avant 2026', wa === Date.UTC(2016, 0, 1) && wb === Date.UTC(2026, 0, 1), `${iso(wa)} → ${iso(wb)}`);
await setState(page, { timeMs: T_REF, timeScale: 'lunarDay' }); await settle(page, 700);
await setState(page, { timeMs: T_REF + 40 * DAY }); await settle(page, 700); [wa, wb] = await win();
check('jour lunaire ré-ancré quand la date sort de la fenêtre', wa === Date.UTC(2026, 11, 25), iso(wa));

// Bandes : l'infobulle (issue des bandes) dit la même chose que siteNow() à douze dates de l'année
await setState(page, { timeMs: T_REF, timeScale: 'year' }); await settle(page, 700); await bandsReady(page);
const track = await page.locator('.tb-track').boundingBox();
let agree = 0; const disagreements = [];
for (let k = 0; k < 12; k++) {
  const fx = (k + 0.37) / 12;
  await page.mouse.move(track.x + track.width * fx, track.y + 10); await page.waitForTimeout(40);
  const r = await page.evaluate((f) => {
    const { engine, state } = window.RF, t0 = Date.UTC(2026, 0, 1), ms = Math.round(t0 + f * (Date.UTC(2027, 0, 1) - t0)), now = engine.siteNow(state.selection, ms);
    return { tip: document.querySelector('.tb-tip').textContent, sun: now.sun.fraction > 0, earth: now.earth.visible };
  }, fx);
  const ok = r.tip.includes(r.sun ? 'Soleil visible' : 'nuit') && r.tip.includes(r.earth ? 'Terre visible' : 'Terre masquée');
  if (ok) agree++; else disagreements.push(r.tip);
}
check('bandes cohérentes avec siteNow() (12 dates)', agree >= 11, `${agree}/12${disagreements.length ? ` ; écart : ${disagreements.join(' / ')}` : ''}`);
await page.locator('#timebar-box').screenshot({ path: `${OUT}/timebar-infobulle-fr.png` });
await page.mouse.move(5, 5);
const bandPixels = await page.evaluate(() => {
  const c = document.querySelector('.tb-canvas'), g = c.getContext('2d'), dpr = c.width / c.getBoundingClientRect().width;
  const row = (y) => { const d = g.getImageData(0, Math.round(y * dpr), c.width, 1).data, set = new Set(); for (let i = 0; i < d.length; i += 4) set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return set.size; };
  return { sun: row(5), earth: row(17) };
});
check('bandes dessinées dans la piste (Soleil et Terre)', bandPixels.sun >= 2 && bandPixels.earth >= 2, `${bandPixels.sun} et ${bandPixels.earth} couleurs`);

// Pas de recalcul quand rien n'a changé : le cache de bandes sert au retour sur une échelle déjà vue
const t0 = Date.now(); await setState(page, { timeScale: 'decade' }); await settle(page, 100); await bandsReady(page);
check('retour sur « 10 ans » sans recalcul', Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
await setState(page, { timeScale: 'year' }); await settle(page, 300);

// Curseur : clic = saut, glisser
await page.mouse.click(track.x + track.width * 0.25, track.y + 30); await settle(page, 150);
let tm = await page.evaluate(() => window.RF.state.timeMs);
const yearSpan = Date.UTC(2027, 0, 1) - Date.UTC(2026, 0, 1);
check('clic dans la piste = saut', near(tm, Date.UTC(2026, 0, 1) + 0.25 * yearSpan, yearSpan / track.width * 1.5), new Date(tm).toISOString());
await page.mouse.move(track.x + track.width * 0.25, track.y + 30); await page.mouse.down();
await page.mouse.move(track.x + track.width * 0.5, track.y + 30, { steps: 6 }); await page.mouse.move(track.x + track.width * 0.75, track.y + 30, { steps: 6 }); await page.mouse.up();
tm = await page.evaluate(() => window.RF.state.timeMs);
check('glisser le curseur', near(tm, Date.UTC(2026, 0, 1) + 0.75 * yearSpan, yearSpan / track.width * 1.5), new Date(tm).toISOString());
const thumbAt = await page.evaluate(() => parseFloat(document.querySelector('.tb-thumb').style.left));
check('le curseur suit la date', near(thumbAt, 75, 0.3), `${thumbAt} %`);

// Clavier
await page.evaluate(() => document.activeElement?.blur());
await setState(page, { timeMs: T_REF, playing: false });
await page.keyboard.press('ArrowRight'); let k1 = await page.evaluate(() => window.RF.state.timeMs);
await page.keyboard.press('Shift+ArrowLeft'); let k2 = await page.evaluate(() => window.RF.state.timeMs);
check('← → : ±1 h ; Maj : ±1 jour', k1 === T_REF + HOUR && k2 === T_REF + HOUR - DAY);
await page.keyboard.press('Space'); const p1 = await page.evaluate(() => window.RF.state.playing);
await page.keyboard.press('Space'); const p2 = await page.evaluate(() => window.RF.state.playing);
check('Espace = lecture / pause', p1 === true && p2 === false);
await page.focus('.tb-date'); await page.keyboard.press('Space');
check('Espace ignoré dans un champ de saisie', await page.evaluate(() => window.RF.state.playing) === false);

// Date UTC éditable, bouton Maintenant
await page.fill('.tb-date', '2030-06-21T08:30'); await page.dispatchEvent('.tb-date', 'change');
check('saisie de la date interprétée en UTC', await page.evaluate(() => window.RF.state.timeMs) === Date.UTC(2030, 5, 21, 8, 30));
await page.evaluate(() => document.activeElement?.blur());
await page.click('.tb-now');
check('bouton Maintenant', near(await page.evaluate(() => window.RF.state.timeMs), Date.now(), 5000));
check('le champ affiche la date courante en UTC', await page.evaluate(() => document.querySelector('.tb-date').value === new Date(Math.floor(window.RF.state.timeMs / 60000) * 60000).toISOString().slice(0, 16)), await page.inputValue('.tb-date'));

// Sauts : prochain coucher/lever du Soleil, prochaine perte ou prochain retour de la Terre
await setState(page, { timeMs: T_REF }); await settle(page, 400);
for (const [body, sel] of [['sun', '.tb-jump:nth-child(1)'], ['earth', '.tb-jump:nth-child(2)']]) {
  const before = await page.evaluate((b) => { const { engine, state } = window.RF, tr = engine.siteTransitions(state.selection, Math.ceil(state.timeMs / 60000) * 60000)[b]; return { want: Math.ceil(tr.nextMs), title: document.querySelectorAll('.tb-jump')[b === 'sun' ? 0 : 1].title, up: tr.now }; }, body);
  await page.click(sel); await settle(page, 400);
  const after = await page.evaluate((b) => { const { engine, state } = window.RF, now = engine.siteNow(state.selection); return { t: state.timeMs, up: b === 'sun' ? now.sun.fraction > 0 : now.earth.visible, title: document.querySelectorAll('.tb-jump')[b === 'sun' ? 0 : 1].title }; }, body);
  check(`saut ${body} : date du moteur, état basculé, libellé mis à jour`, after.t === before.want && after.up !== before.up && after.title !== before.title, `${before.title} → ${new Date(after.t).toISOString()} ; ensuite : ${after.title}`);
  await setState(page, { timeMs: T_REF }); await settle(page, 350);
}
await selectSite(page, SITES.malapert); await settle(page, 400);
await page.click('.tb-jump:nth-child(2)'); await settle(page, 200);
check('saut impossible (aucun changement en 400 jours) : message, date inchangée', await page.evaluate((t) => window.RF.state.timeMs === t && /400\sjours/.test(window.RF.toasts.at(-1)?.message || ''), T_REF));
await selectSite(page, SITES.shackleton);

// Lecture : la date avance à la vitesse annoncée (mesure sur 3 s réelles)
for (const speed of [1, 10000, 1000000]) {
  await setState(page, { timeMs: T_REF, speed, playing: true });
  await page.waitForTimeout(400);                      // laisse passer le premier calcul de fenêtre
  // Vitesse entre le premier et le dernier pas observés en 3 s : la date avance par pas, on ne mesure pas à cheval sur un pas.
  const m = await page.evaluate(() => new Promise((resolve) => {
    const steps = [];
    const off = window.RF.on('change:timeMs', (v) => steps.push([performance.now(), v]));
    setTimeout(() => { off(); const a = steps[0], b = steps.at(-1); resolve({ real: b[0] - a[0], sim: b[1] - a[1], steps: steps.length }); }, 3000);
  }));
  await setState(page, { playing: false });
  const rate = m.sim / m.real;
  check(`lecture ${speed}× : vitesse mesurée`, m.real > 2500 && near(rate / speed, 1, 0.02), `${(m.sim / 1000).toFixed(1)} s simulées en ${(m.real / 1000).toFixed(2)} s réelles (${m.steps} pas) = ${rate.toFixed(0)}× (${await page.evaluate((s) => window.RF.speedEquivalent(s), speed)})`);
}
check('équivalents parlants', await page.evaluate(() => [10000, 1000000].map((s) => window.RF.speedEquivalent(s)).join(' ; ')) === '2,8\u00a0h/s ; 11,6\u00a0j/s');
await setState(page, { speed: 10000, playing: true }); await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/sky-timebar-lecture-fr.png` });
await setState(page, { playing: false });

// Daltonien, puis anglais
await setState(page, { timeMs: T_REF, timeScale: 'year', cvd: 'deuteranopia' }); await panelWidth(page, 900); await settle(page, 500);
await page.screenshot({ path: `${OUT}/sky-timebar-daltonien-fr.png` });
await setState(page, { cvd: 'none', lang: 'en' }); await settle(page, 500); await transitionsReady(page);
check('aucune clé non traduite visible (fr puis en)', (await untranslated(page)).length === 0, (await untranslated(page)).join(', '));
const en = await statTexts(page);
check('anglais : notes traduites (passages brefs, horizon du relief)', /shorter than one hour may be missed/.test(await page.textContent('#sky .sky-foot')) && /Terrain horizon \(LOLA, 240\sm\)/.test(await page.textContent('#sky .sky-legend')));
check('anglais : chiffres clés traduits', /Sun/.test(en[0]) && /Earth/.test(en[1]) && /(Sunset|Sunrise) in/.test(en[2]) && /(Earthset|Earthrise)/.test(en[3]), en.join(' | '));
await page.screenshot({ path: `${OUT}/sky-timebar-en-1440.png` });
await panelWidth(page, 344); await settle(page);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-shackleton-en-344.png` });
await barWidth(page, 1264); await setState(page, { timeScale: 'decade' }); await settle(page, 500); await bandsReady(page);
await page.locator('#timebar').screenshot({ path: `${OUT}/timebar-large-decade-en.png` });

check('bureau : aucune erreur console ni requête en échec', realProblems(problems).length === 0, realProblems(problems).join(' ; '));
await browser.close();

// =====================================================================================================
// 2. Téléphone 390×844, français puis anglais
// =====================================================================================================
console.log('— Téléphone 390×844');
({ browser, page, problems } = await open(PAGE, { width: 390, height: 844 }));
await setState(page, { lang: 'fr', timeMs: T_REF, timeScale: 'year', playing: false });
await selectSite(page, SITES.shackleton); await settle(page, 600); await transitionsReady(page); await bandsReady(page);
await page.screenshot({ path: `${OUT}/sky-timebar-mobile-fr.png`, fullPage: false });
const mob = await page.evaluate(() => {
  const c = document.querySelector('.tb-controls'), vis = (s) => getComputedStyle(document.querySelector(s)).display !== 'none';
  return { rows: new Set([...c.children].map((e) => Math.round(e.getBoundingClientRect().top))).size, overflow: document.documentElement.scrollWidth > window.innerWidth,
    speedSelect: vis('.tb-speed-select'), speedSeg: vis('.tb-speed-seg'), scaleSelect: vis('.tb-scale-select'), h: document.getElementById('timebar').offsetHeight, trackW: document.querySelector('.tb-track').clientWidth };
});
check('téléphone : commandes sur deux lignes, vitesses en liste déroulante, pas de débordement', mob.rows === 2 && mob.speedSelect && !mob.speedSeg && mob.scaleSelect && !mob.overflow, `barre ${mob.h} px, piste ${mob.trackW} px`);
await page.selectOption('.tb-speed-select', '1000000');
check('téléphone : choix de la vitesse dans la liste', await page.evaluate(() => window.RF.state.speed) === 1000000);
await page.selectOption('.tb-scale-select', 'lunarDay'); await settle(page, 600); await bandsReady(page);
check('téléphone : choix de l’échelle dans la liste', await page.evaluate(() => window.RF.state.timeScale) === 'lunarDay');
// Curseur au doigt
const tr2 = await page.locator('.tb-track').boundingBox();
const cdp = await page.context().newCDPSession(page);     // vrais événements tactiles (le navigateur en tire les pointerdown/move/up)
const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: tr2.y + 28 }] });
await touch('touchStart', tr2.x + tr2.width * 0.2);
for (const f of [0.3, 0.4, 0.5, 0.6]) await touch('touchMove', tr2.x + tr2.width * f);
await touch('touchEnd');
const touchT = await page.evaluate(() => window.RF.state.timeMs);
check('téléphone : curseur glissé au doigt', near(touchT, Date.UTC(2026, 10, 15) + 0.6 * 29.530588853 * DAY, 29.53 * DAY / tr2.width * 1.5), new Date(touchT).toISOString());
await page.screenshot({ path: `${OUT}/sky-timebar-mobile-jour-lunaire-fr.png` });
await page.click('#sky .sky-head .seg button:nth-child(2)'); await settle(page);
await page.locator('#panel').screenshot({ path: `${OUT}/sky-mobile-zoom-fr.png` });
await setState(page, { lang: 'en', timeScale: 'decade' }); await settle(page, 600); await bandsReady(page); await transitionsReady(page);
await page.screenshot({ path: `${OUT}/sky-timebar-mobile-en.png` });
check('téléphone : aucune clé non traduite', (await untranslated(page)).length === 0);
check('téléphone : aucune erreur console ni requête en échec', realProblems(problems).length === 0, realProblems(problems).join(' ; '));
await browser.close();

// =====================================================================================================
// 3. Relief absent (fichier non chargé) : horizon lisse et mention, pas de plantage
// =====================================================================================================
console.log('— Relief LOLA absent');
({ browser, page, problems } = await open(`${PAGE}?dem=0`, { width: 1440, height: 900 }));
await setState(page, { lang: 'fr', timeMs: T_REF, timeScale: 'lunarDay' });
await selectSite(page, SITES.shackleton); await settle(page, 600); await transitionsReady(page); await bandsReady(page);
check('sans relief : horizon de la sphère + mention traduite', await page.evaluate(() => window.RF.engine.siteNow(window.RF.state.selection).horizon.terrain === false && !document.querySelector('#sky .sky-noterrain').classList.contains('hidden') && /relief non pris en compte/.test(document.querySelector('#sky .sky-noterrain').textContent)));
await page.screenshot({ path: `${OUT}/sky-timebar-sans-relief-fr.png` });
check('sans relief : aucune erreur console', realProblems(problems).length === 0, realProblems(problems).join(' ; '));
await browser.close();

srv.close();
console.log(failures.length ? `\n${failures.length} vérification(s) en échec :\n - ${failures.join('\n - ')}` : '\nToutes les vérifications passent.');
process.exit(failures.length ? 1 : 0);
