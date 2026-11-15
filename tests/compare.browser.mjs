// Test navigateur de la vue « Comparer », montée seule dans tests/pages/compare.html.
//   D=/home/codex/.cache/paintseed-browser-deps/unpacked
//   flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/compare.browser.mjs
// Captures dans tests/.out/compare-*.png ; l'export CSV dans tests/.out/compare-export.csv.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic, openPage, OUT } from './browser.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.UTC(2026, 10, 15, 12);
const failures = [];
const check = (ok, label, detail = '') => { console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(label); };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
/** « 42,5 % », « 6.41 / 10 », « +3,2° » → nombre */
const parseNum = (s) => Number(String(s).replace(/[\u00a0\u202f\s]/g, '').replace(',', '.').replace(/[^0-9.+-].*$/, ''));

const srv = await serveStatic(REPO);
const pageUrl = (query = '') => `${srv.url}tests/pages/compare.html${query}`;

async function open(query, size) {
  const ctx = await openPage(pageUrl(query), size);
  // Une clé de traduction manquante n'est qu'un avertissement console : le test doit la voir.
  ctx.page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[i18n]')) ctx.problems.push('i18n: ' + m.text()); });
  await ctx.page.waitForSelector('body[data-ready="1"]', { timeout: 120000 });
  await ctx.page.waitForSelector('.cmp-top');
  return ctx;
}
// Chromium signale « ERR_ABORTED » pour les gros rasters lus en flux par registry.fetchWithProgress alors
// que la lecture aboutit. Ces lignes sont écartées, et le chargement réel est vérifié par dataLoaded().
const realProblems = (problems) => problems.filter((p) => !/^requestfailed: \S+\/public\/data\/\S+ net::ERR_ABORTED$/.test(p));
const DATASETS = ['sp_dem', 'sp_sun_avg', 'sp_earth_avg', 'sp_psr', 'sp_tmax', 'sp_tmin', 'global_ldem'];
const allLoaded = (page) => page.evaluate((ids) => ids.filter((id) => !window.RF.registry.dataLoaded(id)), DATASETS);
const settle = (page) => page.waitForTimeout(400);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `compare-${name}.png`) });
/** Capture de toute la vue : la zone défile à l'intérieur, on agrandit donc la fenêtre le temps de la photo. */
async function shotFull(page, name) {
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.querySelector('.cmp').scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.min(9000, height + 4) });
  await page.waitForTimeout(250);
  await shot(page, name);
  await page.setViewportSize(size);
  await page.waitForTimeout(150);
}
const cellText = (page, row, col) => page.evaluate(([r, c]) => document.querySelector(`.cmp-table tr[data-row="${r}"] td[data-col="${c}"] .cmp-val`)?.textContent ?? null, [row, col]);
const waitScenarios = (page, n) => page.waitForFunction((k) => document.querySelectorAll('.cmp-card').length === k && (k === 0 || document.querySelectorAll('.cmp-table tr[data-row]').length > 20), n);

// =====================================================================================
// 1. Bureau 1440 × 900, français
// =====================================================================================
{
  const { browser, page, problems } = await open('', { width: 1440, height: 900 });

  // --- État vide ---
  check(await page.isVisible('.cmp-empty'), 'état vide affiché sans scénario');
  check((await page.textContent('[data-action="quick"]')).includes('Malapert Massif, Mons Mouton Plateau et Slater Plain'), 'raccourci des trois régions');
  check(await page.isDisabled('[data-action="add"]') && await page.isDisabled('[data-action="csv"]'), 'boutons inactifs sans sélection ni scénario');
  check(await page.isHidden('.cmp-table-sec'), 'pas de tableau sans scénario');
  await shot(page, 'empty-1440');

  // --- Trois sites (raccourci : point « meilleur compromis » de chaque région) ---
  await page.click('[data-action="quick"]');
  await waitScenarios(page, 3);
  await page.evaluate(() => window.RF.secondary);
  await settle(page);
  const notLoaded = await allLoaded(page);
  check(notLoaded.length === 0, 'données embarquées chargées', notLoaded.join(', '));
  const sc3 = await page.evaluate(() => window.RF.state.compare.map((c) => ({ key: c.key, kind: c.kind, siteId: c.siteId, lat: c.lat, lon: c.lon, dateMs: c.dateMs })));
  check(sc3.map((s) => s.key).join() === 'malapert_massif:both,mons_mouton_plateau:both,slater_plain:both', 'trois scénarios « meilleur compromis »', sc3.map((s) => s.key).join());
  check(sc3.every((s) => s.kind === 'artemis' && s.dateMs === null), 'scénarios Artemis à la date courante');
  const nRows = await page.locator('.cmp-table tr[data-row]').count();
  check(nRows === 28, '28 lignes d’indicateurs', String(nRows));
  check(await page.locator('.cmp-table .cmp-row-label .tag').count() === nRows, 'une étiquette de provenance par libellé');
  check(await page.locator('.cmp-thumb-canvas:visible').count() === 3, 'trois vignettes de relief');
  // La vignette n'est pas vide : le relief ombré donne des pixels variés.
  const spread = await page.evaluate(() => {
    const c = document.querySelector('.cmp-thumb-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0; for (let i = 0; i < d.length; i += 4 * 97) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    return max - min;
  });
  check(spread > 80, 'vignette : relief ombré dessiné', `étendue des niveaux ${spread}`);
  await shot(page, '3sites-1440');
  await shotFull(page, '3sites-1440-full');

  // --- Contrôle chiffré : le tableau reprend engine.siteWindow / siteNow pour le scénario A ---
  const ref = await page.evaluate(() => {
    const { engine, state, i18n } = window.RF, sc = state.compare[0], site = { lat: sc.lat, lon: sc.lon };
    const m = engine.siteWindow(site, 'lunarDay', state.timeMs).metrics, now = engine.siteNow(site, state.timeMs), ter = engine.terrainAround(site), info = engine.pointInfo(sc.lat, sc.lon);
    return {
      m: { sunPct: m.sunPct, sunDiscPct: m.sunDiscPct, powerVerticalPct: m.powerVerticalPct, earthPct: m.earthPct, bothPct: m.bothPct, sunElMax: m.sunElMax, earthElMax: m.earthElMax, longestNightH: m.longestNightH, longestBlackoutH: m.longestBlackoutH, nightCensored: m.nightCensored, blackoutCensored: m.blackoutCensored },
      night: m.nightCensored ? null : i18n.duration(m.longestNightH), blackout: m.blackoutCensored ? null : i18n.duration(m.longestBlackoutH),
      sunEl: now.sun.el, earthMargin: now.earth.aboveDeg, fracBelow: ter.stats.fracBelow, slope: info.slopeDeg, sunAvg: info.sunAvgPct,
    };
  });
  for (const [row, value, eps] of [['sunPct', ref.m.sunPct, 0.051], ['sunDiscAvg', ref.m.sunDiscPct, 0.051], ['power', ref.m.powerVerticalPct, 0.051], ['earthPct', ref.m.earthPct, 0.051], ['both', ref.m.bothPct, 0.051],
    ['sunElMax', ref.m.sunElMax, 0.051], ['earthElMax', ref.m.earthElMax, 0.051], ['sunEl', ref.sunEl, 0.051], ['earthMargin', ref.earthMargin, 0.051], ['slopeOk', 100 * ref.fracBelow, 0.51], ['slope', ref.slope, 0.051], ['sunAvg', ref.sunAvg, 0.51]]) {
    const txt = await cellText(page, row, 'A');
    check(near(parseNum(txt), value, eps), `tableau = moteur : ${row}`, `« ${txt} » pour ${value.toFixed(3)}`);
  }
  if (ref.night) { const txt = await cellText(page, 'night', 'A'); check(txt === ref.night || ref.m.longestNightH === 0, 'tableau = moteur : plus longue nuit', `« ${txt} » pour ${ref.night} (${(ref.m.longestNightH / 24).toFixed(2)} j)`); }
  if (ref.blackout) { const txt = await cellText(page, 'blackout', 'A'); check(txt === ref.blackout || ref.m.longestBlackoutH === 0, 'tableau = moteur : plus longue coupure', `« ${txt} » pour ${ref.blackout}`); }

  // --- Colonne « Meilleur » ---
  const best = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cmp-table tr[data-row]')].map((tr) => [tr.dataset.row, tr.querySelector('.cmp-best').textContent.trim()])));
  check(best.sunEl === '' && best.tempNow === '' && best.height === '', 'pas de meilleur sur les lignes descriptives');
  check(/^(A|B|C|=)/.test(best.sunPct) && best.sunPct.includes('plus haut'), 'meilleur + règle « plus haut »', best.sunPct);
  check(best.night.includes('plus bas'), 'règle « plus bas » pour la nuit', best.night);
  const sunVals = await Promise.all(['A', 'B', 'C'].map(async (c) => parseNum(await cellText(page, 'sunPct', c))));
  const expectBest = 'ABC'[sunVals.indexOf(Math.max(...sunVals))];
  check(best.sunPct.startsWith(expectBest) || best.sunPct.startsWith('='), 'le meilleur « Soleil visible » est le plus haut', `${sunVals.join(' / ')} → ${best.sunPct}`);

  // --- Radar, chronologie, analyse ---
  check(await page.locator('.cmp-radar svg polygon[stroke-width="2"]').count() === 3, 'radar : trois séries');
  check(await page.locator('.cmp-radar .chart-legend span').count() === 3, 'radar : légende à trois entrées');
  await page.click('[data-radar="ref"]');
  check((await page.textContent('.cmp-radar')).includes('hypothèses'), 'radar : bascule vers les notes de référence');
  await page.click('[data-radar="comp"]');
  check(await page.locator('.cmp-tl-block').count() === 3 && await page.locator('.cmp-tl-block svg rect').count() > 9, 'chronologie : trois blocs de bandes');
  const sentences = await page.locator('.cmp-an p').allTextContents();
  check(sentences.length >= 3 && sentences.length <= 5, 'analyse : 3 à 5 phrases', String(sentences.length));
  console.log(sentences.map((s) => '      · ' + s).join('\n'));
  // Chaque pourcentage cité dans l'analyse figure dans le tableau.
  const plain = (t) => t.replace(/\u00a0/g, ' ');
  const tableText = plain(await page.textContent('.cmp-table'));
  const cited = plain(sentences.join(' ')).match(/\d+,\d %/g) || [];
  check(cited.length > 3 && cited.every((v) => tableText.includes(v)), 'analyse : chaque pourcentage cité est dans le tableau', `${cited.length} valeurs`);

  // --- Export CSV ---
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv"]')]);
  const csvPath = path.join(OUT, 'compare-export.csv');
  await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n').map((l) => l.split(';'));
  check(csv.startsWith('\ufeff') && /\.csv$/.test(dl.suggestedFilename()), 'CSV : fichier UTF-8 avec BOM', dl.suggestedFilename());
  check(lines[0].join('|') === 'Section|Indicateur|Unité|Nature|A|B|C|Meilleur|Règle', 'CSV : en-têtes en français', lines[0].join('|'));
  check(lines.length === 1 + 7 + nRows && lines.every((l) => l.length === 9), 'CSV : toutes les lignes du tableau (+ 7 lignes de description)', `${lines.length} lignes`);
  const csvSun = lines.find((l) => l[1] === 'Soleil visible, part du temps');
  check(!!csvSun && near(parseNum(csvSun[4]), ref.m.sunPct, 0.051) && csvSun[2] === '%', 'CSV : valeur « Soleil visible » = moteur', csvSun?.join(';'));
  check(lines[1][4].startsWith('Malapert Massif') && lines[5][4] === new Date(T0).toISOString().replace('.000Z', 'Z'), 'CSV : site et date du scénario', `${lines[1][4]} · ${lines[5][4]}`);

  // --- Pondération ---
  const before = await cellText(page, 'compScore', 'A');
  await page.evaluate(() => { const i = document.querySelector('.cmp-w-row input[data-crit="energy"]'); i.value = '50'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(page);
  const after = await cellText(page, 'compScore', 'A');
  check(before !== after && (await page.textContent('.cmp-w-total')).includes('125'), 'curseur de poids : score recalculé, total affiché', `${before} → ${after}`);
  await page.click('.cmp-w-foot .btn');
  await settle(page);
  check(await cellText(page, 'compScore', 'A') === before && (await page.textContent('.cmp-w-total')).includes('100'), 'réinitialisation des poids');
  const refScore = parseNum(await cellText(page, 'refScore', 'A'));
  check(near(refScore, 6.4, 0.051), 'score de référence Malapert ≈ 6,4 annoncé', String(refScore));

  // --- Paramètres de calcul (state.params) ---
  await page.evaluate(() => window.RF.set({ params: { ...window.RF.state.params, slopeLimitDeg: 5 } }));
  await settle(page);
  const slopeLabel = await page.textContent('.cmp-table tr[data-row="slopeOk"] th');
  const below5 = await page.evaluate(() => { const { engine, state } = window.RF, sc = state.compare[0]; return 100 * engine.terrainAround({ lat: sc.lat, lon: sc.lon }).stats.fracBelow; });
  const cell5 = await cellText(page, 'slopeOk', 'A');
  check(slopeLabel.includes('< 5°') && near(parseNum(cell5), below5, 0.51) && below5 < 100 * ref.fracBelow, 'paramètres : seuil de pente à 5° repris par le libellé et la valeur', `${cell5} (10° : ${(100 * ref.fracBelow).toFixed(0)} %)`);
  await page.evaluate(() => window.RF.set({ params: { ...window.RF.state.params, slopeLimitDeg: 10 } }));
  await settle(page);

  // --- Année civile ---
  await page.click('[data-period="year"]');
  await settle(page);
  const yearRef = await page.evaluate(() => { const { engine, state } = window.RF, sc = state.compare[0]; const w = engine.siteWindow({ lat: sc.lat, lon: sc.lon }, 'year', state.timeMs); return { sunPct: w.metrics.sunPct, t0: w.t0Ms, days: w.spanMs / 86400e3 }; });
  check(near(parseNum(await cellText(page, 'sunPct', 'A')), yearRef.sunPct, 0.051) && yearRef.t0 === Date.UTC(2026, 0, 1) && yearRef.days === 365, 'année civile : tableau = siteWindow(…, "year")', `${yearRef.sunPct.toFixed(2)} %`);
  check((await page.textContent('.cmp-table')).includes('Sur l’année civile'), 'année civile : titre du groupe');
  await shotFull(page, '3sites-year-1440-full');
  await page.click('[data-period="lunarDay"]');
  await settle(page);

  // --- Même site, autres dates ---
  await page.click('[data-action="same"]');
  await settle(page);
  const same = await page.evaluate(() => window.RF.state.compare.map((c) => ({ key: c.key, dateMs: c.dateMs })));
  const LD = 29.530588853 * 86400e3;
  check(same.length === 3 && same.every((s) => s.key === 'malapert_massif:both') && same[0].dateMs === T0 && near(same[1].dateMs - T0, LD, 1) && near(same[2].dateMs - T0, 3 * LD, 1), 'même site à trois dates : +0, +1 et +3 mois synodiques');
  const heads = await page.locator('.cmp-col-date').allTextContents();
  check(new Set(heads).size === 3, 'les colonnes portent trois dates différentes', heads.join(' | '));
  const an2 = await page.locator('.cmp-an p').allTextContents();
  check(an2.some((s) => /A \(\d+ \S+ 2026\)|B \(\d+ \S+ 202\d\)|C \(\d+ \S+ 2027\)/.test(s)), 'analyse : scénarios désignés par leur date', an2[1]);
  await shot(page, 'dates-1440');
  await shotFull(page, 'dates-1440-full');

  // --- Date d'un scénario modifiée à la main, puis retour à la date courante ---
  await page.fill('[data-scenario="B"] input[type="datetime-local"]', '2027-03-01T06:00');
  await page.dispatchEvent('[data-scenario="B"] input[type="datetime-local"]', 'change');
  await settle(page);
  check(await page.evaluate(() => window.RF.state.compare[1].dateMs) === Date.UTC(2027, 2, 1, 6), 'champ date : la date du scénario B est enregistrée en UTC');
  check((await page.textContent('[data-scenario="B"] .cmp-date-state')).includes('Date fixée'), 'champ date : mention « Date fixée »');
  await page.click('[data-scenario="B"] .cmp-date-state .btn');
  await settle(page);
  check(await page.evaluate(() => window.RF.state.compare[1].dateMs) === null && (await page.textContent('[data-scenario="B"] .cmp-date-state')).includes('Suit la date courante'), '« Suivre la date courante » vide la date');

  // --- Lecture : au plus un recalcul par seconde ---
  await page.evaluate(() => { window.__renders = 0; new MutationObserver(() => { window.__renders++; }).observe(document.querySelector('.cmp-table-sec .cmp-scroll'), { childList: true }); });
  await page.evaluate(async () => {
    const { set, state } = window.RF; set({ playing: true });
    const end = performance.now() + 3200;
    while (performance.now() < end) { set({ timeMs: state.timeMs + 600e3 }); await new Promise((r) => setTimeout(r, 30)); }
    set({ playing: false });
  });
  await page.waitForTimeout(1200);
  const renders = await page.evaluate(() => window.__renders);
  check(renders >= 2 && renders <= 5, 'lecture : tableau recalculé au plus une fois par seconde', `${renders} rendus en 3,2 s pour ~100 changements de date`);
  await page.evaluate((t) => window.RF.set({ timeMs: t }), T0);

  // --- Vue inactive : aucun calcul ---
  await page.evaluate(() => { window.RF.view.setActive(false); window.__renders = 0; window.RF.set({ compare: window.RF.state.compare.slice(0, 2) }); });
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__renders) === 0 && await page.locator('.cmp-card').count() === 3, 'vue inactive : rien n’est recalculé');
  await page.evaluate(() => window.RF.view.setActive(true));
  await waitScenarios(page, 2);
  check(true, 'vue réactivée : mise à jour (2 scénarios)');

  // --- Site hors grille polaire + bouton « Ajouter le site sélectionné » + « Ouvrir » ---
  await page.evaluate(() => { const { select, getSite, siteSelection } = window.RF; select(siteSelection(getSite('apollo11'))); });
  await page.click('[data-action="add"]');
  await waitScenarios(page, 3);
  await settle(page);
  check((await page.textContent('[data-scenario="C"]')).includes('Hors de la grille polaire') && (await page.textContent('[data-scenario="C"]')).includes('Horizon de la sphère lisse'), 'Apollo 11 : pas de vignette, horizon lisse signalé');
  check((await cellText(page, 'slope', 'C')) === '—' && await page.locator('.cmp-table tr[data-row="slope"] td[data-col="C"] .tag-missing').count() === 1, 'Apollo 11 : pente absente = « — » + étiquette « indisponible »');
  check((await page.locator('.cmp-table tr[data-row="compScore"] td[data-col="C"]').textContent()).includes('critères sur 6'), 'Apollo 11 : score partiel signalé');
  check((await page.locator('.cmp-table tr[data-row="compScore"] .cmp-best').textContent()).trim().startsWith('—'), 'scores sur des critères différents : pas de meilleur');
  await shotFull(page, 'apollo-1440-full');

  // --- Nuit commencée avant la période : durée réelle, pas la partie comprise dans la période (Apollo 11, 06/03/2027) ---
  await page.evaluate(() => { const { set, state } = window.RF; set({ compare: state.compare.map((c, i) => (i === 2 ? { ...c, dateMs: Date.UTC(2027, 2, 6) } : c)) }); });
  await settle(page);
  const b1 = await page.evaluate(() => {
    const { engine, state, i18n } = window.RF, sc = state.compare[2], m = engine.siteWindow({ lat: sc.lat, lon: sc.lon }, 'lunarDay', sc.dateMs).metrics;
    return { real: m.longestNightH, inWindow: m.longestNightInWindowH, beyond: m.nightBeyondWindow, censored: m.nightCensored, text: i18n.duration(m.longestNightH) };
  });
  const b1cell = await page.locator('.cmp-table tr[data-row="night"] td[data-col="C"]').textContent();
  check(!b1.censored && b1cell.startsWith(b1.text) && near(b1.real / 24, 14.7, 0.5) && b1.real >= b1.inWindow, 'plus longue nuit : durée réelle du moteur (Apollo 11, 06/03/2027)', `« ${b1cell} » ; réelle ${(b1.real / 24).toFixed(2)} j, dans la période ${(b1.inWindow / 24).toFixed(2)} j`);
  check(b1cell.includes('déborde de la période') === !!b1.beyond, 'plus longue nuit : mention « déborde de la période » conforme au moteur', String(b1.beyond));
  check((await page.textContent('.cmp-table tr[data-row="night"] th')).includes('durée réelle'), 'libellé « plus longue nuit qui touche la période (durée réelle) »');
  await page.evaluate(() => { const { set, state } = window.RF; set({ compare: state.compare.map((c, i) => (i === 2 ? { ...c, dateMs: null } : c)) }); });
  await settle(page);
  await page.click('[data-scenario="C"] [data-action="open"]');
  const opened = await page.evaluate(() => ({ view: window.RF.state.view, key: window.RF.state.selection.key }));
  check(opened.view === 'globe' && opened.key === 'apollo11', '« Ouvrir » Apollo 11 → globe', JSON.stringify(opened));
  await page.click('[data-scenario="A"] [data-action="open"]');
  const opened2 = await page.evaluate(() => ({ view: window.RF.state.view, sel: window.RF.state.selection }));
  check(opened2.view === 'map2d' && opened2.sel.variant === 'both' && opened2.sel.regionId === 'malapert_massif', '« Ouvrir » un point de région → carte 2D, variante conservée', JSON.stringify(opened2.sel));
  // --- Nuit sans fin dans les 400 jours explorés : fond de Shackleton ---
  await page.evaluate(() => { const { set, state } = window.RF; set({ compare: [...state.compare.slice(0, 2), { key: 'pt:shackleton-floor', name: 'Fond de Shackleton', lat: -89.67, lon: 129.2, kind: 'point', dateMs: null }] }); });
  await page.waitForFunction(() => document.querySelector('[data-scenario="C"] .cmp-card-name')?.textContent === 'Fond de Shackleton');
  await settle(page);
  const cens = await page.evaluate(() => { const { engine, state } = window.RF, sc = state.compare[2]; const m = engine.siteWindow({ lat: sc.lat, lon: sc.lon }, 'lunarDay', state.timeMs).metrics; return { night: m.nightCensored, h: m.longestNightH }; });
  const censCell = plain(await cellText(page, 'night', 'C'));
  if (cens.night) check(censCell === 'plus de 400 j', 'nuit censurée : « plus de 400 j »', censCell);
  else console.log(`non testé : le fond de Shackleton n’est pas en nuit censurée (${(cens.h / 24).toFixed(1)} j)`);
  check(!(await page.textContent('.cmp')).includes('toute la période'), 'plus aucune mention « toute la période »');
  check(await page.locator('.cmp-table tr[data-row="compScore"] th .tag-estimate').count() === 1, 'score calculé étiqueté « estimation »');
  check((await page.textContent('.cmp-table')).includes('Produits publiés au point (NASA PGDA, équipe Diviner)'), 'groupe « Produits publiés au point »');
  await shotFull(page, 'shackleton-1440-full');
  await page.click('[data-scenario="C"] [data-action="remove"]');
  await waitScenarios(page, 2);
  check(true, 'retrait d’un scénario');

  // --- Les 9 régions candidates Artemis III ---
  await page.click('.cmp-art > summary');
  await page.waitForSelector('.cmp-art-progress [data-ms]', { timeout: 120000 });
  const ms1 = Number(await page.getAttribute('.cmp-art-progress [data-ms]', 'data-ms'));
  check(await page.locator('.cmp-art-table tbody tr').count() === 9, 'neuf régions dans le tableau');
  console.log(`      · calcul des 9 régions (meilleur compromis, premier passage) : ${ms1} ms`);
  check((await page.textContent('.cmp-art .note')).includes('pas un classement de la NASA') && (await page.textContent('.cmp-art .note')).includes('Artemis IV'), 'bandeau d’avertissement (Artemis III publié, alunissage prévu avec Artemis IV)');
  const firstRow = await page.locator('.cmp-art-table tbody tr').first().getAttribute('data-region');
  check(firstRow === 'mons_mouton_plateau', 'tri par défaut : score recalculé décroissant', firstRow);
  check(await page.locator('.cmp-art-table .cmp-ref').count() >= 9, 'repères « dans / hors » l’intervalle annoncé', String(await page.locator('.cmp-art-table .cmp-ref').count()));
  const marks = await page.locator('.cmp-art-table .cmp-ref').allTextContents();
  check(marks.every((m) => /^(✓ dans|✗ hors) /.test(m)), 'repère = symbole + texte', marks[0]);
  await shotFull(page, 'artemis-1440-full');
  // Tri au clic
  await page.click('.cmp-art-table th[data-sort="earth"] .cmp-sort');
  const earthCol = await page.evaluate(() => [...document.querySelectorAll('.cmp-art-table tbody td[data-col="earth"] .cmp-val')].map((e) => e.textContent));
  const earthNums = earthCol.map(parseNum);
  check(earthNums.every((v, i) => i === 0 || v <= earthNums[i - 1]), 'tri au clic sur « Terre » (décroissant)', earthCol.join(' '));
  await page.click('.cmp-art-table th[data-sort="earth"] .cmp-sort');
  const earthAsc = (await page.evaluate(() => [...document.querySelectorAll('.cmp-art-table tbody td[data-col="earth"] .cmp-val')].map((e) => e.textContent))).map(parseNum);
  check(earthAsc.every((v, i) => i === 0 || v >= earthAsc[i - 1]), 'second clic : tri croissant');
  // Ajout du point étudié à la comparaison
  await page.click('.cmp-art-table tr[data-region="haworth"] .iconbtn');
  await waitScenarios(page, 3);
  check(await page.evaluate(() => window.RF.state.compare[2].key) === 'haworth:both', 'ajout d’une région : le point « meilleur compromis » est ajouté');
  // Point étudié : centre de la région
  await page.click('.cmp-variant [data-variant="centre"]');
  await page.waitForFunction(() => document.querySelector('.cmp-variant [data-variant="centre"]').classList.contains('is-on') && document.querySelector('.cmp-art-progress [data-ms]'));
  const ms2 = Number(await page.getAttribute('.cmp-art-progress [data-ms]', 'data-ms'));
  console.log(`      · calcul des 9 régions (centres) : ${ms2} ms`);
  check((await page.textContent('.cmp-art .note')).includes('le centre de la région, pas un site d’atterrissage'), 'bandeau « centre de la région »');
  const centre = await page.evaluate(() => {
    const { engine, state, getSite } = window.RF, s = getSite('slater_plain');
    return { sunPct: engine.siteWindow({ lat: s.lat, lon: s.lon }, 'lunarDay', state.timeMs).metrics.sunPct, cell: document.querySelector('.cmp-art-table tr[data-region="slater_plain"] td[data-col="sun"] .cmp-val').textContent };
  });
  check(near(parseNum(centre.cell), centre.sunPct, 0.051), 'régions : valeur « Soleil » du centre = siteWindow', `${centre.cell} pour ${centre.sunPct.toFixed(2)}`);
  await shotFull(page, 'artemis-centre-1440-full');
  await page.click('.cmp-variant [data-variant="both"]');
  await page.waitForFunction(() => document.querySelector('.cmp-variant [data-variant="both"]').classList.contains('is-on') && document.querySelector('.cmp-art-progress [data-ms]'));
  await page.click('.cmp-art > summary');

  // --- Mode daltonien ---
  await page.evaluate(() => window.RF.set({ cvd: 'deuteranopia' }));
  await waitScenarios(page, 3);
  await settle(page);
  await shot(page, 'cvd-1440');
  await page.evaluate(() => window.RF.set({ cvd: 'none' }));
  await waitScenarios(page, 3);

  // --- Vider ---
  await page.click('[data-action="clear"]');
  await waitScenarios(page, 0);
  check(await page.isVisible('.cmp-empty'), '« Vider » ramène l’état vide');

  check(realProblems(problems).length === 0, 'bureau FR : aucune erreur console ni réseau', realProblems(problems).slice(0, 5).join(' | '));
  await browser.close();
}

// =====================================================================================
// 2. Bureau 1440 × 900, anglais ; puis largeur réelle entre les deux panneaux de l'application (784 px)
// =====================================================================================
{
  const { browser, page, problems } = await open('?lang=en', { width: 1440, height: 900 });
  check((await page.textContent('.cmp-empty')).includes('No scenario to compare yet'), 'anglais : état vide');
  await page.click('[data-action="quick"]');
  await waitScenarios(page, 3);
  await page.evaluate(() => window.RF.secondary);
  await settle(page);
  const txt = await page.textContent('.cmp');
  check(['Criteria', 'Best', 'Sun visible, share of time', 'Longest radio blackout', 'Aligned timeline', 'Analysis', 'Criteria weights', 'best trade-off'].every((s) => txt.includes(s)), 'anglais : libellés traduits');
  check(!/[a-z]\.[a-z]+\.[a-z]/.test(await page.textContent('.cmp-table')), 'anglais : pas de clé de traduction brute dans le tableau');
  const en = await page.locator('.cmp-an p').allTextContents();
  console.log(en.map((s) => '      · ' + s).join('\n'));
  check(en.length >= 3 && en.length <= 5 && en[0].startsWith('At the scenario date'), 'anglais : analyse par gabarits');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv"]')]);
  const p = path.join(OUT, 'compare-export-en.csv'); await dl.saveAs(p);
  const head = fs.readFileSync(p, 'utf8').replace(/^\ufeff/, '').split('\r\n')[0];
  check(head === 'Section;Indicator;Unit;Nature;A;B;C;Best;Rule', 'anglais : en-têtes du CSV', head);
  await shot(page, '3sites-en-1440');
  await shotFull(page, '3sites-en-1440-full');
  await page.click('.cmp-art > summary');
  await page.waitForSelector('.cmp-art-progress [data-ms]', { timeout: 120000 });
  await shotFull(page, 'artemis-en-1440-full');
  // Bascule de langue à chaud : la vue est reconstruite, les scénarios restent.
  await page.evaluate(() => window.RF.set({ lang: 'fr' }));
  await page.waitForFunction(() => document.querySelector('.cmp-title')?.textContent.includes('Comparer'));
  await waitScenarios(page, 3);
  check((await page.textContent('.cmp-card-name')).includes('meilleur compromis'), 'changement de langue à chaud : noms des points retraduits');
  // Largeur de la zone centrale quand les deux panneaux de l'application sont ouverts
  await page.setViewportSize({ width: 784, height: 900 });
  await settle(page);
  await shotFull(page, '3sites-784-full');
  check(realProblems(problems).length === 0, 'bureau EN : aucune erreur console ni réseau', realProblems(problems).slice(0, 5).join(' | '));
  await browser.close();
}

// =====================================================================================
// 3. Mobile 390 × 844, français puis anglais
// =====================================================================================
{
  const { browser, page, problems } = await open('', { width: 390, height: 844 });
  await shot(page, 'empty-390');
  await page.click('[data-action="quick"]');
  await waitScenarios(page, 3);
  await page.evaluate(() => window.RF.secondary);
  await settle(page);
  const geo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.cmp-card')].map((c) => c.getBoundingClientRect());
    const wrap = document.querySelector('.cmp-table-sec .cmp-scroll');
    wrap.scrollLeft = 200;
    const label = document.querySelector('.cmp-table tr[data-row="sunPct"] th').getBoundingClientRect(), box = wrap.getBoundingClientRect();
    const out = { stacked: cards[1].top >= cards[0].bottom && cards[2].top >= cards[1].bottom, scrolls: wrap.scrollWidth > wrap.clientWidth + 50, scrolled: wrap.scrollLeft, sticky: Math.abs(label.left - box.left) < 2, pageOverflow: document.querySelector('.cmp').scrollWidth > document.querySelector('#view-compare').clientWidth + 1 };
    wrap.scrollLeft = 0;
    return out;
  });
  check(geo.stacked, 'mobile : colonnes scénario empilées');
  check(geo.scrolls && geo.scrolled > 100 && geo.sticky, 'mobile : tableau défilable horizontalement, première colonne figée', JSON.stringify(geo));
  check(!geo.pageOverflow, 'mobile : la page elle-même ne déborde pas en largeur');
  await shot(page, '3sites-390');
  await shotFull(page, '3sites-390-full');
  await page.evaluate(() => { document.querySelector('.cmp-table-sec .cmp-scroll').scrollLeft = 220; document.querySelector('.cmp-table-sec').scrollIntoView(); });
  await shot(page, 'table-scrolled-390');
  await page.click('.cmp-art > summary');
  await page.waitForSelector('.cmp-art-progress [data-ms]', { timeout: 120000 });
  await page.evaluate(() => document.querySelector('.cmp-art').scrollIntoView());
  await shot(page, 'artemis-390');
  await page.evaluate(() => window.RF.set({ lang: 'en' }));
  await page.waitForFunction(() => document.querySelector('.cmp-title')?.textContent.includes('Compare'));
  await waitScenarios(page, 3);
  await settle(page);
  await shotFull(page, '3sites-en-390-full');
  check(realProblems(problems).length === 0, 'mobile : aucune erreur console ni réseau', realProblems(problems).slice(0, 5).join(' | '));
  await browser.close();
}

// =====================================================================================
// 4. Dans l'application complète (public/index.html), si elle démarre : la vue se monte et s'affiche
// =====================================================================================
{
  const { browser, page, problems } = await openPage(`${srv.url}public/index.html`, { width: 1440, height: 900 });
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[i18n]') && m.text().includes('compare.')) problems.push('i18n: ' + m.text()); });
  const booted = await page.waitForSelector('body[data-ready="1"]', { timeout: 90000 }).then(() => true, () => false);
  if (!booted) console.log('non testé : public/index.html ne démarre pas (modules voisins en cours d’écriture)');
  else {
    await page.evaluate(() => { const { set, state } = window.RF; set({ compare: [{ key: 'pt:test', name: 'Point test', lat: -89.45, lon: -137.3, kind: 'point', dateMs: null }], view: 'compare', timeMs: state.timeMs }); });
    const shown = await page.waitForSelector('#view-compare .cmp-table tr[data-row="sunPct"]', { timeout: 30000 }).then(() => true, () => false);
    check(shown, 'application complète : la vue Comparer se monte et calcule un scénario');
    await page.waitForTimeout(500);
    await shot(page, 'integration-1440');
    const mine = realProblems(problems).filter((p) => /compare|pageerror/.test(p));
    check(mine.length === 0, 'application complète : aucune erreur venant de la vue Comparer', mine.slice(0, 4).join(' | '));
    if (realProblems(problems).length !== mine.length) console.log('      · autres messages console (modules voisins) : ' + realProblems(problems).filter((p) => !mine.includes(p)).slice(0, 4).join(' | '));
  }
  await browser.close();
}

srv.close();
console.log(failures.length ? `\n${failures.length} ÉCHEC(S) :\n - ${failures.join('\n - ')}` : '\nTout est vert.');
process.exit(failures.length ? 1 : 0);
