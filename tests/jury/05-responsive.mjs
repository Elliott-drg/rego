// Parcours à une taille et dans une langue données : node tests/jury/05-responsive.mjs 390 844 fr   (ou 1024 700 en, 1440 900 en…)
// Captures : tests/.out/jury-R<largeur><langue>-*.png
import fs from 'node:fs';
import { launch, step, click, mapIdle, scanText, scanOverflow, listInteractive, LOG } from './lib.mjs';
const W = +(process.argv[2] || 390), H = +(process.argv[3] || 844), LANG = process.argv[4] || 'fr';
const tag = `R${W}${LANG}`; const J = await launch({ width: W, height: H, locale: LANG === 'fr' ? 'fr-FR' : 'en-US' }); const { page } = J;
const st = (k) => J.state(k); const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const other = LANG === 'fr' ? /\b(Loading|Settings|Sunrise|Sunset|Earth visible|Compare|Power|Close|Layers|Slope|Elevation|Search|the |and |with )\b/ : /\b(Chargement|Réglages|Lever|Coucher|Terre visible|Comparer|Énergie|Fermer|Calques|Pente|Altitude|Soleil|avec |pour |dans |les |des )\b/;
/** Contrôles communs à chaque écran : textes suspects, mélange de langues, débordements, texte tronqué. */
async function check(label, root = 'body') {
  const s = await scanText(page); if (s.length) J.note(`SUSPECTS (${label}) : ` + JSON.stringify(s.slice(0, 10)));
  const o = await scanOverflow(page, root); if (o.docW > o.winW + 1) J.note(`DÉBORDEMENT HORIZONTAL (${label}) : document ${o.docW} px > fenêtre ${o.winW} px`);
  if (o.offscreen?.length) J.note(`HORS ÉCRAN (${label}) : ` + JSON.stringify(o.offscreen.slice(0, 8)));
  if (o.clipped?.length) J.note(`TRONQUÉ (${label}) : ` + JSON.stringify(o.clipped.slice(0, 14).map((c) => `${c.text} [${c.w}/${c.sw}px ${c.where}]`)));
  const mix = await page.evaluate((src) => { const re = new RegExp(src); const out = []; const seen = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const tx = n.textContent.trim(); const el = n.parentElement; if (!tx || tx.length < 4 || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue; if (!re.test(tx)) continue; let hid = false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.hidden) { hid = true; break; } } const r = el.getBoundingClientRect(); if (hid || r.width === 0) continue; if (!seen.has(tx)) { seen.add(tx); out.push(tx.slice(0, 90) + ' @' + (el.closest('[id]')?.id || '?')); } } return out.slice(0, 25); }, other.source);
  if (mix.length) J.note(`AUTRE LANGUE ? (${label}) : ` + JSON.stringify(mix));
  // chevauchements entre boutons visibles
  const ov = await page.evaluate((root) => { const els = [...document.querySelectorAll(root + ' button, ' + root + ' input, ' + root + ' select')].filter((e) => { const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none') return false; const c = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2))); return c && (e.contains(c) || c.contains(e)); }); const out = []; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect(); if (els[i].contains(els[j]) || els[j].contains(els[i])) continue; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 4 && h > 4) out.push(`${(els[i].innerText || els[i].title || els[i].className).toString().trim().slice(0, 24)} ↔ ${(els[j].innerText || els[j].title || els[j].className).toString().trim().slice(0, 24)} (${Math.round(w)}×${Math.round(h)})`); } return out.slice(0, 10); }, root);
  if (ov.length) J.note(`CHEVAUCHEMENT de contrôles (${label}) : ` + JSON.stringify(ov));
}
const vis = async (sel) => { const l = page.locator(sel).first(); return (await l.count()) && (await l.isVisible()); };
const inView = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), on: r.right > 5 && r.left < window.innerWidth - 5 && r.width > 0 }; }, sel);
const openLeft = async () => { const p = await inView('#left'); if (!p?.on) { await click(J, '#header > .iconbtn'); await page.waitForTimeout(700); } };
const closeLeft = async () => { const p = await inView('#left'); if (p?.on && W < 980) { await click(J, '#header > .iconbtn'); await page.waitForTimeout(500); } };
const openRight = async () => { const p = await inView('#right'); if (!p?.on) { await click(J, '#header .header-right > .iconbtn:last-child'); await page.waitForTimeout(700); } };
const closeRight = async () => { const p = await inView('#right'); if (p?.on && W < 980) { await click(J, '#header .header-right > .iconbtn:last-child'); await page.waitForTimeout(500); } };
const setDate = async (v) => { const d = page.locator('#timebar .tb-date'); await d.fill(v); await d.dispatchEvent('change'); await page.waitForTimeout(700); };
const closeModal = async () => { const b = page.locator('.modal-head .iconbtn').first(); if (await b.count()) { await click(J, b); await page.waitForTimeout(300); } };
/** Ouvre une action (Énergie, Données…) par le chemin qu'un utilisateur trouverait à cette taille. */
async function openAction(idx, toolRe) {
  if (await vis('#header .navpills button')) { await click(J, page.locator('#header .navpills button').nth(idx)); return 'en-tête'; }
  // sinon : roue dentée → boutons de navigation
  await click(J, page.locator('#header .header-right .iconbtn').first()); await page.waitForTimeout(400);
  const b = page.locator('.popover.settings .pop-nav button').nth(idx); if (await b.count() && await b.isVisible()) { await click(J, b); return 'réglages'; }
  await page.keyboard.press('Escape'); await page.mouse.click(3, H / 2).catch(() => {}); await openLeft(); const tb = page.locator('#left .toolbtn', { hasText: toolRe }).first(); await tb.scrollIntoViewIfNeeded(); await click(J, tb); return 'panneau gauche';
}

await step(J, 'A-accueil', async () => {
  await J.open(); await mapIdle(page); await page.waitForTimeout(1500);
  const s = await st(['lang', 'leftOpen', 'rightOpen']); J.note(`taille ${W}×${H} langue navigateur ${LANG} → lang=${s.lang} leftOpen=${s.leftOpen} rightOpen=${s.rightOpen} ; #left=${JSON.stringify(await inView('#left'))} #right=${JSON.stringify(await inView('#right'))}`);
  if (s.lang !== LANG) { await click(J, page.locator('#header .lang-seg button').nth(LANG === 'fr' ? 0 : 1)); await page.waitForTimeout(600); }
  await J.shot(`${tag}-A1-accueil`);
  J.note('en-tête visible : ' + JSON.stringify((await listInteractive(page, '#header')).map((i) => `${i.text || i.title || i.aria}[${i.x},${i.w}]`)));
  J.note('barre de temps visible : ' + JSON.stringify((await listInteractive(page, '#timebar')).map((i) => `${(i.text || i.title || i.aria).slice(0, 26)}[${i.x},${i.y},${i.w}x${i.h}]`)));
  await check('accueil');
  await page.waitForTimeout(600);
  J.note('message d’accueil : ' + JSON.stringify(await page.$$eval('.toast', (l) => l.map((e) => e.innerText))));
});

await step(J, 'B-choisir-site', async () => {
  await openLeft(); await J.shot(`${tag}-B1-gauche`); await check('panneau gauche', '#left');
  const it = page.locator('#left .siteitem', { hasText: /Malapert/ }).first(); await it.scrollIntoViewIfNeeded(); await click(J, it); await page.waitForTimeout(1800);
  J.note(`après choix du site : #left=${JSON.stringify(await inView('#left'))} #right=${JSON.stringify(await inView('#right'))} sélection=${(await st(['selection'])).selection?.name}`);
  await J.shot(`${tag}-B2-apres-choix`);
  await closeLeft(); await openRight(); await page.waitForTimeout(2500); await J.shot(`${tag}-B3-fiche`); await check('fiche', '#right');
  const rb = await page.locator('#right').boundingBox(); if (rb) { await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); for (let k = 1; k <= 3; k++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(700); await J.shot(`${tag}-B4-fiche-${k}`); } await page.locator('#right').evaluate((e) => { e.scrollTop = 0; }); }
  if (await page.locator('#right .pick').count()) { await click(J, page.locator('#right .pick').first()); await page.waitForTimeout(2000); }
  await click(J, page.locator('#right .sheet-actions button').first()); await page.waitForTimeout(500);
  await closeRight(); await mapIdle(page); await page.waitForTimeout(1500); await J.shot(`${tag}-B5-carte-site`); await check('carte + site');
  // clic direct sur la carte
  const b = await page.locator('#view-map2d').boundingBox(); await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.35); J.clicks++; await page.waitForTimeout(1500); J.note(`clic carte : sélection=${(await st(['selection'])).selection?.name} ; #right=${JSON.stringify(await inView('#right'))} (la fiche s’ouvre-t-elle seule ?)`); await J.shot(`${tag}-B6-clic-carte`);
  await closeRight();
});

await step(J, 'C-temps', async () => {
  await setDate('2027-03-15T08:30'); await page.waitForTimeout(1500);
  await page.locator('#timebar').screenshot({ path: `tests/.out/jury-${tag}-C1-barre.png` }).catch(() => {});
  J.note('barre : hauteur=' + JSON.stringify(await inView('#timebar')) + ' ; contrôles=' + JSON.stringify((await listInteractive(page, '#timebar')).map((i) => `${(i.text || i.title || i.aria).slice(0, 30)}[${i.x},${i.y},${i.w}x${i.h}]${i.dis ? 'DIS' : ''}`)));
  const useSel = !(await vis('#timebar .tb-speed-seg button'));
  if (useSel) { J.note('vitesse en liste déroulante : ' + JSON.stringify(await page.locator('#timebar .tb-speed-select option').allInnerTexts())); await page.locator('#timebar .tb-speed-select').selectOption({ index: 5 }); } else await click(J, page.locator('#timebar .tb-speed-seg button').nth(5));
  if (await vis('#timebar .tb-scale-seg button')) await click(J, page.locator('#timebar .tb-scale-seg button').nth(0)); else await page.locator('#timebar .tb-scale-select').selectOption({ index: 0 });
  await page.waitForTimeout(1500); const t0 = (await st(['timeMs'])).timeMs; await click(J, '#timebar .tb-play'); await page.waitForTimeout(6000); await J.shot(`${tag}-C2-lecture`); await click(J, '#timebar .tb-play'); const t1 = (await st(['timeMs'])).timeMs; J.note(`lecture 6 s à 100 000× : +${((t1 - t0) / 86400e3).toFixed(1)} j`);
  const jumps = page.locator('#timebar .tb-jump'); for (let i = 0; i < 2; i++) { if (await jumps.nth(i).isVisible()) { const b0 = (await st(['timeMs'])).timeMs; await click(J, jumps.nth(i)); await page.waitForTimeout(1200); J.note(`saut ${i} « ${(await jumps.nth(i).innerText()).trim()} » : +${(((await st(['timeMs'])).timeMs - b0) / 86400e3).toFixed(2)} j`); } else J.note(`bouton de saut ${i} NON VISIBLE à cette taille`); }
  const tr = await page.locator('#timebar .tb-track').boundingBox(); if (tr) { await page.mouse.click(tr.x + tr.width * 0.5, tr.y + tr.height * 0.6); await page.waitForTimeout(800); J.note(`piste : largeur ${Math.round(tr.width)} px ; clic au milieu → ${iso((await st(['timeMs'])).timeMs)}`); }
  await check('barre de temps', '#timebar'); await setDate('2027-03-15T08:30');
});

await step(J, 'D-calques-legende', async () => {
  await openLeft(); for (const id of ['sun_now', 'earth_now']) { const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(300); }
  await J.shot(`${tag}-D0-gauche-calques`); await closeLeft(); await mapIdle(page, 120000); await page.waitForTimeout(1500); await J.shot(`${tag}-D1-calques`);
  J.note('légende : ' + JSON.stringify(await page.$$eval('#view-map2d .legend', (l) => l.map((e) => [e.className, e.innerText.replace(/\s+/g, ' '), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))));
  await check('carte + calques', '#main');
  await openLeft(); for (const id of ['sun_now', 'earth_now']) { const lab = page.locator(`#left label[for="ly-${id}"]`); await lab.scrollIntoViewIfNeeded(); await click(J, lab); await page.waitForTimeout(300); } await closeLeft();
});

await step(J, 'E-globe-comparer', async () => {
  await click(J, page.locator('.viewswitch button').nth(1)); await page.waitForTimeout(10000); await J.shot(`${tag}-E1-globe`); await check('globe', '#main');
  await click(J, page.locator('.viewswitch button').nth(2)); await page.waitForTimeout(9000); await J.shot(`${tag}-E2-comparer`); await check('comparer', '#view-compare');
  const same = page.locator('#view-compare .cmp-top button').nth(3); if (await same.count()) { await same.scrollIntoViewIfNeeded(); await click(J, page.locator('#view-compare .cmp-top button', { hasText: /Même site|Same site/ }).first()); await page.waitForTimeout(9000); }
  const b = await page.locator('#view-compare').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let k = 1; k <= 7; k++) { await page.mouse.wheel(0, Math.round(H * 0.7)); await page.waitForTimeout(1300); await J.shot(`${tag}-E3-comparer-${k}`); }
  await check('comparer (3 dates)', '#view-compare');
  await page.locator('#view-compare').evaluate((e) => { e.scrollTop = 0; }); await click(J, page.locator('.viewswitch button').nth(0)); await page.waitForTimeout(2500);
});

await step(J, 'F-fenetres', async () => {
  const defs = [[1, /Énergie|Power/, 'energie'], [2, /Données|Data/, 'donnees'], [3, /Histor/, 'historique'], [5, /propos|About/, 'apropos']];
  for (const [idx, re, name] of defs) {
    const via = await openAction(idx, re); await page.waitForTimeout(3000);
    if (!(await page.locator('.modal').count())) { J.note(`DÉFAUT : fenêtre ${name} introuvable (chemin : ${via})`); await J.shot(`${tag}-F-${name}-ABSENTE`); await page.keyboard.press('Escape'); continue; }
    const mb = await page.locator('.modal').boundingBox(); J.note(`fenêtre ${name} ouverte via ${via} ; boîte=${JSON.stringify(mb && [Math.round(mb.x), Math.round(mb.y), Math.round(mb.width), Math.round(mb.height)])}`);
    await J.shot(`${tag}-F-${name}-1`); await check(name, '.modal');
    if (name === 'donnees') { const tabs = page.locator('.modal [role=tab]'); for (let i = 1; i < await tabs.count(); i++) { await click(J, tabs.nth(i)); await page.waitForTimeout(1500); await J.shot(`${tag}-F-donnees-onglet${i}`); await check(`données onglet ${i}`, '.modal'); } }
    const body = page.locator('.modal .modal-body').first(); const bb = await body.boundingBox(); if (bb) { await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); for (let k = 2; k <= (name === 'energie' ? 5 : 3); k++) { await page.mouse.wheel(0, Math.round(bb.height * 0.85)); await page.waitForTimeout(600); await J.shot(`${tag}-F-${name}-${k}`); } if (name === 'energie') await check('énergie (bas)', '.modal'); }
    await closeModal(); await page.keyboard.press('Escape');
  }
  // import (panneau gauche)
  await openLeft(); const tb = page.locator('#left .toolbtn', { hasText: /Import/ }).first(); await tb.scrollIntoViewIfNeeded(); await J.shot(`${tag}-F-outils`); await click(J, tb); await page.waitForTimeout(1200); await J.shot(`${tag}-F-import`); await check('import', '.modal'); await closeModal(); await closeLeft();
  // réglages
  await click(J, page.locator('#header .header-right .iconbtn').first()); await page.waitForTimeout(500); await J.shot(`${tag}-F-reglages`); await check('réglages', '.popover.settings'); const pb = await page.locator('.popover.settings').boundingBox(); J.note('popover réglages : ' + JSON.stringify(pb && [Math.round(pb.x), Math.round(pb.y), Math.round(pb.width), Math.round(pb.height)]) + ` (fenêtre ${W}×${H})`); await page.keyboard.press('Escape'); if (await page.locator('.popover.settings').count()) await page.mouse.click(3, H - 200);
  // recherche
  if (await vis('#header .searchbox input')) { await click(J, '#header .searchbox input'); await page.keyboard.type('Shack', { delay: 30 }); await page.waitForTimeout(600); await J.shot(`${tag}-F-recherche`); const rb = await page.locator('.search-results').boundingBox(); J.note('liste de recherche : ' + JSON.stringify(rb && [Math.round(rb.x), Math.round(rb.y), Math.round(rb.width), Math.round(rb.height)])); await page.keyboard.press('Escape'); } else J.note('champ de recherche NON VISIBLE à cette taille');
});

await step(J, 'G-tutoriel', async () => {
  const via = await openAction(4, /Tutor/); await page.waitForTimeout(1200); J.note('tutoriel ouvert via ' + via);
  let k = 0; while (await page.locator('.tour-card').count() && k < 12) { const g = await page.evaluate(() => { const s = document.querySelector('.tour-spot').getBoundingClientRect(), c = document.querySelector('.tour-card').getBoundingClientRect(); const ov = !(c.right <= s.left || c.left >= s.right || c.bottom <= s.top || c.top >= s.bottom); return { centered: document.querySelector('.tour').classList.contains('is-centered'), spot: [Math.round(s.left), Math.round(s.top), Math.round(s.width), Math.round(s.height)], card: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], cardOff: c.left < 0 || c.top < 0 || c.right > window.innerWidth || c.bottom > window.innerHeight, recouvre: ov, title: document.querySelector('.tour-title').innerText }; }); J.note(`étape ${k + 1} « ${g.title} » : ${g.centered ? 'CENTRÉE (aucune zone montrée)' : 'zone ' + g.spot} carte ${g.card}${g.cardOff ? ' HORS ÉCRAN' : ''}${g.recouvre && !g.centered ? ' RECOUVRE LA ZONE' : ''}`); await J.shot(`${tag}-G-tuto-${k + 1}`); await check(`tutoriel ${k + 1}`, '.tour'); await click(J, page.locator('.tour-card .tour-actions button').last()); await page.waitForTimeout(800); k++; }
  J.note(`tutoriel : ${k} étapes`);
});

await step(J, 'H-autre-langue', async () => {
  // bascule de langue : visible ? puis nouveau contrôle global
  if (await vis('#header .lang-seg button')) { await click(J, page.locator('#header .lang-seg button').nth(LANG === 'fr' ? 1 : 0)); await page.waitForTimeout(1200); await J.shot(`${tag}-H-autre-langue`); await click(J, page.locator('#header .lang-seg button').nth(LANG === 'fr' ? 0 : 1)); } else J.note('bascule FR/EN NON VISIBLE dans l’en-tête à cette taille');
  // mode expert
  if (await vis('#header .mode-seg button')) { await click(J, page.locator('#header .mode-seg button').nth(1)); await page.waitForTimeout(800); await openRight(); await page.waitForTimeout(1500); await J.shot(`${tag}-H-expert`); await check('expert'); await click(J, page.locator('#header .mode-seg button').nth(0)).catch(() => {}); } else J.note('bascule Simplifié/Expert NON VISIBLE dans l’en-tête à cette taille');
});

await J.finish(`05-${tag}`);
