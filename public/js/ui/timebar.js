// Barre de temps : lecture, date UTC, échelle (jour lunaire, 1 an, 10 ans), curseur, et, pour le site
// sélectionné, les périodes « Soleil visible » et « Terre visible » calculées par le moteur.
//
//   mountTimebar(document.getElementById('timebar'));
//
// La barre ne possède aucune donnée : elle lit et écrit state.timeMs, state.playing, state.speed et
// state.timeScale. Les autres modules n'ont qu'à écouter 'change:timeMs'.

import { state, set, on, toast } from '../core/store.js';
import { t, int, num, dateUTC } from '../core/i18n.js';
import '../i18n/timebar.js';
import { siteNow, siteWindow, siteTransitions, runs, LUNAR_DAY_MS, DAY_MS, HOUR_MS } from '../science/engine.js';
import { cat } from '../layers/palettes.js';
import { h, clear, throttle } from './dom.js';
import { icon } from './icons.js';

const SPEEDS = [1, 10, 100, 1000, 10000, 100000, 1000000];   // secondes simulées par seconde réelle
const SCALES = ['lunarDay', 'year', 'decade'];
const MAX_STEP_MS = 1000;            // pas réel maximal pris en compte : un onglet endormi ne fait pas bondir la date
const WATCHDOG_MS = 200;             // sans image pendant ce délai, la lecture avance quand même (page visible)
const DECADE_START_YEAR = 2026;      // le cahier des charges demande une échelle de dix ans qui part de 2026
const BAND_H = 10, BAND_GAP = 2, RAIL_Y = 27.5, TRACK_H = 42;
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const OWN_KEYS = 'button, a[href], summary, [role="button"], [role="slider"], [role="listbox"], [role="menu"], [role="radiogroup"], [role="tablist"]';

const locale = () => (state.lang === 'fr' ? 'fr-FR' : 'en-GB');
const startOfUTCDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
const siteKey = (s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}|${state.params.mastM}|${state.params.earthMarginDeg}`;

/** Équivalent parlant d'une vitesse : « 2,8 h/s », « 11,6 j/s ». */
export function speedEquivalent(speed) {
  if (speed === 1) return t('timebar.eq.real');
  if (speed < 60) return t('timebar.eq.s', { v: int(speed) });
  if (speed < 3600) return t('timebar.eq.min', { v: num(speed / 60, 1) });
  if (speed < 86400) return t('timebar.eq.h', { v: num(speed / 3600, 1) });
  return t('timebar.eq.d', { v: num(speed / 86400, 1) });
}

/**
 * Étendue du curseur pour une échelle et une date.
 *   lunarDay : 29,53 j à partir du début du jour UTC ; la fenêtre précédente est gardée tant que la date y reste.
 *   year     : année civile de la date.
 *   decade   : 2026–2036 ; hors de cette décennie, la décennie de même grille (…2016, 2026, 2036…) qui contient la date.
 * @returns {{scale:string, t0:number, t1:number}}
 */
export function timeWindow(scale, timeMs, prev = null) {
  if (scale === 'lunarDay') {
    if (prev && prev.scale === 'lunarDay' && timeMs >= prev.t0 && timeMs < prev.t1) return prev;
    const t0 = startOfUTCDay(timeMs);
    return { scale, t0, t1: t0 + LUNAR_DAY_MS };
  }
  const year = new Date(timeMs).getUTCFullYear();
  if (scale === 'decade') {
    const y0 = DECADE_START_YEAR + 10 * Math.floor((year - DECADE_START_YEAR) / 10);
    return { scale, t0: Date.UTC(y0, 0, 1), t1: Date.UTC(y0 + 10, 0, 1) };
  }
  return { scale: 'year', t0: Date.UTC(year, 0, 1), t1: Date.UTC(year + 1, 0, 1) };
}

/** Graduations d'une fenêtre : {t, major, label} ; les libellés s'espacent selon la largeur disponible. */
function ticksFor(win, width) {
  const out = [], pxPerDay = (width / (win.t1 - win.t0)) * DAY_MS;
  const label = (ms, o) => new Date(ms).toLocaleDateString(locale(), { timeZone: 'UTC', ...o });
  if (win.scale === 'lunarDay') {
    const every = [1, 2, 3, 5, 10].find((d) => d * pxPerDay >= 56) ?? 15;
    for (let ms = win.t0, d = 0; ms <= win.t1; ms += DAY_MS, d++) {
      out.push({ t: ms, major: d % every === 0, label: d % every === 0 ? label(ms, { day: 'numeric', month: 'short' }) : null });
    }
  } else if (win.scale === 'year') {
    const y = new Date(win.t0).getUTCFullYear(), every = [1, 2, 3].find((m) => m * 30 * pxPerDay >= 40) ?? 6;
    for (let m = 0; m < 12; m++) {
      const ms = Date.UTC(y, m, 1);
      out.push({ t: ms, major: m % every === 0, label: m % every === 0 ? (m === 0 ? String(y) : label(ms, { month: 'short' })) : null });
    }
  } else {
    const y0 = new Date(win.t0).getUTCFullYear(), every = 365 * pxPerDay >= 36 ? 1 : 2, quarters = 91 * pxPerDay >= 6;
    for (let k = 0; k < 10; k++) {
      out.push({ t: Date.UTC(y0 + k, 0, 1), major: true, label: k % every === 0 ? String(y0 + k) : null });
      if (quarters) for (const m of [3, 6, 9]) out.push({ t: Date.UTC(y0 + k, m, 1), major: false, label: null });
    }
  }
  return out;
}

/** Vrai si `ms` tombe dans l'un des intervalles triés [début, fin]. */
function inIntervals(list, ms) {
  let a = 0, b = list.length - 1;
  while (a <= b) { const m = (a + b) >> 1; if (ms < list[m][0]) b = m - 1; else if (ms > list[m][1]) a = m + 1; else return true; }
  return false;
}

export function mountTimebar(container) {
  let win = timeWindow(state.timeScale, state.timeMs);
  let dragging = false, raf = 0, watchdog = 0, lastStep = 0, carry = 0;
  // Bandes de visibilité : un morceau par jour lunaire ou par année, calculé une fois par site et par réglages
  const bandCache = new Map();        // `${site}|${morceau}` -> {t0, t1, sun:[[a,b]…], earth:[[a,b]…]}
  let bandSig = '', bandJob = 0, pieces = [], todo = [];
  let ui = null, trackW = 0, hatch = null, hatchKey = '';

  const root = h('div', { class: 'tb', role: 'group' });
  const canvas = h('canvas', { class: 'tb-canvas', 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  container.append(h('div', { class: 'tb-host' }, root));     // .tb-host : repère de largeur pour la mise en page (requêtes de conteneur)

  // ---------- Structure ----------
  /** Un réglage à choix unique, rendu deux fois : boutons (large) et liste déroulante (étroit) ; le CSS affiche l'un ou l'autre. */
  function choice(cls, label, values, current, optionLabel, buttonLabel, help, onPick) {
    const seg = h('div', { class: `seg ${cls}-seg`, role: 'group', 'aria-label': label },
      values.map((v) => h('button', { type: 'button', class: v === current ? 'is-on' : '', 'aria-pressed': String(v === current), title: help(v), dataset: { value: v }, onclick: () => onPick(v) }, buttonLabel(v))));
    const select = h('select', { class: `input ${cls}-select`, 'aria-label': label, title: label, onchange: (e) => onPick(values.find((v) => String(v) === e.target.value)) },
      values.map((v) => h('option', { value: v, ...(v === current ? { selected: true } : {}) }, optionLabel(v))));
    return { seg, select };
  }
  // Séparateur de milliers dès 1 000 (int() l'omet en français pour les nombres de quatre chiffres)
  const speedLabel = (v) => `${v.toLocaleString(locale(), { useGrouping: 'always' })}×`;
  /** Infobulle d'une échelle ; pour « 10 ans », la décennie qui serait affichée à la date courante. */
  function scaleHelp(v) {
    if (v !== 'decade') return t(`timebar.scale.${v}.help`);
    const y0 = new Date(timeWindow('decade', state.timeMs).t0).getUTCFullYear();
    return t('timebar.scale.decade.help', { from: y0, to: y0 + 10 });
  }

  /** (Re)construit la barre : au montage et à chaque changement de langue. */
  function build() {
    clear(root);
    root.setAttribute('aria-label', t('timebar.label'));
    const speed = choice('tb-speed', t('timebar.speed'), SPEEDS, state.speed,
      (v) => t('timebar.speed.option', { x: speedLabel(v), eq: speedEquivalent(v) }), speedLabel,
      (v) => t('timebar.speed.help', { x: speedLabel(v), eq: speedEquivalent(v) }), (v) => set({ speed: v }));
    const scale = choice('tb-scale', t('timebar.scale'), SCALES, state.timeScale,
      (v) => t(`timebar.scale.${v}`), (v) => t(`timebar.scale.${v}`), scaleHelp, (v) => set({ timeScale: v }));
    ui = {
      play: h('button', { type: 'button', class: 'btn btn-primary tb-play', onclick: () => set({ playing: !state.playing }) }),
      date: h('input', { type: 'datetime-local', class: 'input tb-date', step: '60', min: '1900-01-01T00:00', max: '2199-12-31T23:59', 'aria-label': t('timebar.date'), title: t('timebar.date'), onchange: onDateInput }),
      now: h('button', { type: 'button', class: 'btn tb-now', title: t('timebar.now.help'), 'aria-label': t('timebar.now.help'), onclick: () => set({ timeMs: Date.now() }) }, icon('clock'), h('span', { class: 'tb-wide' }, t('timebar.now'))),
      speed, scale,
      eq: h('span', { class: 'mono tb-eq', title: t('timebar.speed') }),
      jumpSun: h('button', { type: 'button', class: 'btn tb-jump', onclick: () => jump('sun') }),
      jumpEarth: h('button', { type: 'button', class: 'btn tb-jump', onclick: () => jump('earth') }),
      bandLabels: h('div', { class: 'tb-bandlabels' },
        h('span', { title: t('timebar.band.sun') }, h('i', { class: 'tb-swatch tb-swatch-sun' }), h('span', { class: 'tb-wide' }, t('timebar.band.sun.short')), h('span', { class: 'tb-narrow' }, icon('sun', 11))),
        h('span', { title: t('timebar.band.earth') }, h('i', { class: 'tb-swatch tb-swatch-earth' }), h('span', { class: 'tb-wide' }, t('timebar.band.earth.short')), h('span', { class: 'tb-narrow' }, icon('earth', 11)))),
      hint: h('div', { class: 'tb-hint' }),
      busy: h('div', { class: 'tb-busy mono hidden', role: 'status' }),
      progress: h('div', { class: 'tb-progress' }),
      thumb: h('div', { class: 'tb-thumb', role: 'slider', tabindex: '0', 'aria-label': t('timebar.slider'), title: t('timebar.slider.help'), onkeydown: onThumbKey }),
      tip: h('div', { class: 'tb-tip mono hidden' }),
    };
    ui.track = h('div', { class: 'tb-track', onpointerdown: onTrackDown, onpointermove: onTrackMove, onpointerup: onTrackUp, onpointercancel: onTrackUp, onpointerleave: () => { if (!dragging) ui.tip.classList.add('hidden'); } },
      canvas, ui.hint, ui.busy, ui.progress, ui.thumb, ui.tip);
    root.append(
      h('div', { class: 'tb-controls' },
        h('div', { class: 'tb-group tb-group-time' }, ui.play, ui.date, h('span', { class: 'mono dim tb-utc' }, t('timebar.utc')), ui.now),
        h('div', { class: 'tb-group tb-group-speed' }, speed.seg, speed.select, ui.eq),
        h('div', { class: 'tb-group tb-group-scale' }, scale.seg, scale.select),
        h('div', { class: 'tb-group tb-group-jump' }, ui.jumpSun, ui.jumpEarth)),
      h('div', { class: 'tb-trackrow' }, ui.bandLabels, ui.track));
    syncPlay(); syncSpeed(); syncTime(true); syncJumps(); syncBandChrome();
  }

  // ---------- Synchronisation avec l'état ----------
  function syncPlay() {
    const action = t(state.playing ? 'timebar.pause' : 'timebar.play');
    clear(ui.play).append(icon(state.playing ? 'pause' : 'play', 18));
    ui.play.title = t('timebar.playHint', { action }); ui.play.setAttribute('aria-label', action);
    ui.play.setAttribute('aria-pressed', String(state.playing));
  }
  function syncChoice(c, value) {
    for (const b of c.seg.children) { const isOn = b.dataset.value === String(value); b.classList.toggle('is-on', isOn); b.setAttribute('aria-pressed', String(isOn)); }
    c.select.value = String(value);
  }
  function syncSpeed() { syncChoice(ui.speed, state.speed); ui.eq.textContent = speedEquivalent(state.speed); }
  function syncScale() {
    syncChoice(ui.scale, state.timeScale);
    ui.scale.seg.lastChild.title = scaleHelp('decade');
  }

  /** Date, curseur et fenêtre ; `force` redessine même si la fenêtre n'a pas changé. */
  function syncTime(force = false) {
    const next = timeWindow(state.timeScale, state.timeMs, win);
    const moved = next.t0 !== win.t0 || next.t1 !== win.t1 || next.scale !== win.scale;
    win = next;
    const frac = Math.max(0, Math.min(1, (state.timeMs - win.t0) / (win.t1 - win.t0)));
    ui.thumb.style.left = ui.progress.style.width = `${(frac * 100).toFixed(3)}%`;
    if (document.activeElement !== ui.date) {             // ne pas réécrire le champ pendant qu'on le saisit
      const d = new Date(Math.floor(state.timeMs / 60000) * 60000);
      const v = Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
      if (ui.date.value !== v) ui.date.value = v;
    }
    syncAria();
    if (moved || force) { syncScale(); refreshBands(); drawTrack(); }
  }
  const syncAria = throttle(() => {
    ui.thumb.setAttribute('aria-valuemin', String(win.t0)); ui.thumb.setAttribute('aria-valuemax', String(win.t1));
    ui.thumb.setAttribute('aria-valuenow', String(Math.round(state.timeMs))); ui.thumb.setAttribute('aria-valuetext', dateUTC(state.timeMs));
  }, 500);

  /** Boutons « aller au prochain… » : le libellé suit l'état du moment au site sélectionné. */
  function syncJumps() {
    const sel = state.selection;
    let sunUp = true, earthUp = true;
    if (sel) { const now = siteNow(sel); sunUp = now.sun.fraction > 0; earthUp = now.earth.visible; }
    const fill = (btn, ico, key) => {
      const sig = `${key}|${sel ? sel.name : ''}|${state.lang}`;
      if (btn.dataset.sig === sig) return;
      btn.dataset.sig = sig; btn.disabled = !sel;
      const help = sel ? t(`timebar.jump.${key}.help`, { site: sel.name }) : t('timebar.jump.needSite');
      btn.title = help; btn.setAttribute('aria-label', help);
      clear(btn).append(icon(ico), h('span', { class: 'tb-wide' }, t(`timebar.jump.${key}`)), icon('chevron', 13));
    };
    fill(ui.jumpSun, 'sun', sunUp ? 'sunset' : 'sunrise');
    fill(ui.jumpEarth, 'earth', earthUp ? 'earthLoss' : 'earthBack');
  }
  const syncJumpsSoon = throttle(syncJumps, 250);

  function jump(body) {
    const sel = state.selection; if (!sel) return;
    // Le moteur arrondit à la minute : interroger la minute qui vient garantit un résultat postérieur à la date courante.
    const next = siteTransitions(sel, Math.ceil(state.timeMs / 60000) * 60000)[body].nextMs;
    if (next === null) { toast(t('timebar.jump.none', { site: sel.name }), 'warn'); return; }
    set({ timeMs: Math.ceil(next) });
  }

  function onDateInput() {
    const v = ui.date.value;
    const ms = v ? Date.parse(v.length === 16 ? `${v}:00Z` : `${v}Z`) : NaN;       // la saisie est en UTC
    if (Number.isFinite(ms)) set({ timeMs: ms }); else syncTime();
  }

  // ---------- Lecture ----------
  // La date avance du temps réel écoulé × la vitesse, à chaque image. Si les images n'arrivent plus alors que la
  // page est visible (rendu logiciel saturé), un minuteur prend le relais pour tenir la vitesse annoncée.
  /** Avance la date du temps réel écoulé depuis le dernier pas (plafonné : un onglet endormi ne fait pas bondir la date). */
  function step() {
    const nowMs = performance.now(), dt = Math.min(MAX_STEP_MS, nowMs - lastStep);
    lastStep = nowMs;
    const advance = dt * state.speed + carry, whole = Math.floor(advance);        // ms simulées ; le reste est reporté (vitesse 1×)
    carry = advance - whole;
    if (whole > 0) set({ timeMs: state.timeMs + whole });
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; tick(true); });
    clearTimeout(watchdog);
    watchdog = setTimeout(() => tick(document.visibilityState === 'visible'), WATCHDOG_MS);
  }
  /** @param {boolean} advance faux quand la page est masquée : le temps simulé attend, sans rattrapage au retour */
  function tick(advance) {
    if (!state.playing) { clearTimeout(watchdog); return; }
    if (advance) step(); else lastStep = performance.now();
    schedule();
  }
  function startLoop() {
    if (!state.playing) return;
    lastStep = performance.now(); carry = 0;         // toujours repartir de maintenant
    schedule();
  }

  // ---------- Clavier ----------
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(EDITABLE)) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (target && target !== ui.thumb && target.closest(OWN_KEYS)) return;      // Espace actionne déjà l'élément qui a le focus
      e.preventDefault(); set({ playing: !state.playing });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (target && target !== ui.thumb && target.closest('[role="slider"], [role="listbox"], [role="menu"], [role="radiogroup"], [role="tablist"]')) return;
      e.preventDefault();
      set({ timeMs: state.timeMs + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? DAY_MS : HOUR_MS) });
    }
  }
  /** Touches propres au curseur quand il a le focus (les flèches sont traitées par onKey). */
  function onThumbKey(e) {
    const span = win.t1 - win.t0;
    const to = { Home: win.t0, End: win.t1 - 60000, PageUp: state.timeMs + span / 10, PageDown: state.timeMs - span / 10 }[e.key];
    if (to === undefined) return;
    e.preventDefault(); set({ timeMs: Math.round(to) });
  }

  // ---------- Curseur ----------
  function timeAt(clientX) {
    const r = ui.track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.min(win.t1 - 60000, Math.round(win.t0 + frac * (win.t1 - win.t0)));     // on reste dans la fenêtre affichée
  }
  function onTrackDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    try { ui.track.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché : le glisser reste suivi tant qu'il survole la piste */ }
    set({ timeMs: timeAt(e.clientX) }); showTip(e.clientX);
    e.preventDefault(); ui.thumb.focus({ preventScroll: true });
  }
  function onTrackMove(e) {
    if (dragging) set({ timeMs: timeAt(e.clientX) });
    showTip(e.clientX);
  }
  function onTrackUp(e) {
    if (!dragging) return;
    dragging = false;                                    // la capture du pointeur est relâchée d'office par le navigateur
    if (e.pointerType !== 'mouse') ui.tip.classList.add('hidden');
  }
  /** Infobulle : date sous le pointeur et, si le calcul est fait, état du Soleil et de la Terre à cette date. */
  function showTip(clientX) {
    const r = ui.track.getBoundingClientRect(), ms = timeAt(clientX);
    const piece = pieces.map((p) => bandCache.get(p.key)).find((b) => b && ms >= b.t0 && ms <= b.t1);
    const parts = [dateUTC(ms)];
    if (piece) parts.push(t(inIntervals(piece.sun, ms) ? 'timebar.tip.sunOn' : 'timebar.tip.sunOff'), t(inIntervals(piece.earth, ms) ? 'timebar.tip.earthOn' : 'timebar.tip.earthOff'));
    ui.tip.textContent = parts.join(' · ');
    ui.tip.classList.remove('hidden');
    const half = ui.tip.offsetWidth / 2;
    ui.tip.style.left = `${Math.max(half, Math.min(r.width - half, clientX - r.left))}px`;
  }

  // ---------- Bandes « Soleil visible » / « Terre visible » ----------
  /** Morceaux à calculer pour la fenêtre : le jour lunaire affiché, l'année, ou les dix années une par une. */
  function piecesFor(site) {
    const sk = siteKey(site);
    if (win.scale === 'lunarDay') return [{ key: `${sk}|L${win.t0}`, span: 'lunarDay', at: win.t0 }];
    const y0 = new Date(win.t0).getUTCFullYear(), count = win.scale === 'decade' ? 10 : 1;
    return Array.from({ length: count }, (_, k) => ({ key: `${sk}|Y${y0 + k}`, span: 'year', at: Date.UTC(y0 + k, 6, 1) }));
  }
  function refreshBands() {
    const sel = state.selection;
    const sig = sel ? `${siteKey(sel)}|${win.scale}|${win.t0}` : '';
    if (sig === bandSig) return;                           // rien n'a changé : ni site, ni réglages, ni fenêtre
    bandSig = sig; bandJob++;
    pieces = sel ? piecesFor(sel) : [];
    todo = pieces.filter((p) => !bandCache.has(p.key));
    syncBandChrome(); drawTrack();
    if (todo.length) computeNext(bandJob, { lat: sel.lat, lon: sel.lon });
  }
  /** Calcule un morceau puis rend la main : dix années s'enchaînent sans figer l'interface. */
  function computeNext(job, site) {
    setTimeout(() => {
      if (job !== bandJob) return;                         // le site ou la fenêtre a changé entre-temps
      const p = todo.shift();
      const S = siteWindow(site, p.span, p.at).series;
      bandCache.set(p.key, { t0: S.t0Ms, t1: S.t0Ms + (S.n - 1) * S.stepMs, sun: runs(S, (i) => S.sunFrac[i] > 0), earth: runs(S, (i) => S.earthVis[i] === 1) });
      if (bandCache.size > 60) bandCache.delete(bandCache.keys().next().value);
      syncBandChrome(); drawTrack();
      if (todo.length) computeNext(job, site);
    }, state.playing ? 120 : 15);
  }
  function syncBandChrome() {
    const sel = state.selection;
    ui.bandLabels.classList.toggle('is-off', !sel);
    ui.bandLabels.title = sel ? t('timebar.band.help', { site: sel.name }) : '';
    ui.hint.textContent = sel ? '' : t('timebar.band.none');
    ui.busy.classList.toggle('hidden', !todo.length);
    if (todo.length) ui.busy.textContent = pieces.length > 1 ? t('timebar.busyCount', { done: pieces.length - todo.length, total: pieces.length }) : t('timebar.busy');
  }

  /** Motif hachuré de la bande « Terre » : la bande se reconnaît à sa texture, pas seulement à sa couleur. */
  function earthHatch(color, dpr) {
    const key = `${color}|${dpr}`;
    if (hatchKey !== key) {
      const s = Math.round(5 * dpr), c = h('canvas', { width: s, height: s }), x = c.getContext('2d');
      x.fillStyle = color; x.globalAlpha = 0.38; x.fillRect(0, 0, s, s);
      x.globalAlpha = 1; x.strokeStyle = color; x.lineWidth = Math.max(1, 1.2 * dpr);
      x.beginPath();
      for (const o of [-s, 0, s]) { x.moveTo(o - 1, s + 1); x.lineTo(o + s + 1, -1); }      // trois diagonales : le motif se raccorde d'une tuile à l'autre
      x.stroke();
      hatch = ctx.createPattern(c, 'repeat'); hatchKey = key;
    }
    return hatch;
  }

  /** Dessin de la piste : bandes, rail, graduations. Le curseur est un élément du DOM, déplacé sans redessiner. */
  function drawTrack() {
    const W = Math.floor(ui.track.clientWidth);
    if (W < 40) return;
    trackW = W;
    const dpr = window.devicePixelRatio || 1, cs = getComputedStyle(root);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(TRACK_H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(TRACK_H * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const X = (ms) => ((ms - win.t0) / (win.t1 - win.t0)) * W;

    // Bandes (en pixels physiques, pour que le motif reste net)
    const rows = [{ y: 0, get: (b) => b.sun, fill: cat('sun', state.cvd) }, { y: BAND_H + BAND_GAP, get: (b) => b.earth, fill: earthHatch(cat('earth', state.cvd), dpr) }];
    for (const row of rows) {
      ctx.fillStyle = v('--bg-2', '#101827'); ctx.fillRect(0, row.y * dpr, W * dpr, BAND_H * dpr);
      for (const p of pieces) {
        const b = bandCache.get(p.key); if (!b) continue;
        const x0 = Math.max(0, X(b.t0)), x1 = Math.min(W, X(b.t1));
        if (x1 <= x0) continue;
        ctx.fillStyle = v('--bg-4', '#1f2d46'); ctx.fillRect(x0 * dpr, row.y * dpr, (x1 - x0) * dpr, BAND_H * dpr);     // période calculée, astre absent
        ctx.fillStyle = row.fill;
        for (const [a, c] of row.get(b)) {
          const xa = Math.max(0, X(a)), xb = Math.min(W, X(c));
          if (xb > xa) ctx.fillRect(Math.round(xa * dpr), row.y * dpr, Math.max(1, Math.round((xb - xa) * dpr)), BAND_H * dpr);
        }
      }
    }

    // Rail et graduations
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = v('--line-2', '#2b3b57'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, RAIL_Y); ctx.lineTo(W, RAIL_Y); ctx.stroke();
    ctx.font = `10px ${v('--mono', 'monospace')}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    let lastLabelEnd = -Infinity;
    for (const tk of ticksFor(win, W)) {
      const x = Math.min(W - 0.5, Math.round(X(tk.t)) + 0.5);
      ctx.strokeStyle = tk.major ? v('--text-3', '#74839b') : v('--line-2', '#2b3b57');
      ctx.beginPath(); ctx.moveTo(x, RAIL_Y - (tk.major ? 4 : 2)); ctx.lineTo(x, RAIL_Y + (tk.major ? 4 : 2)); ctx.stroke();
      if (!tk.label) continue;
      const w = ctx.measureText(tk.label).width;
      if (x + 3 + w > W || x + 3 < lastLabelEnd + 6) continue;       // pas de libellé coupé ni de chevauchement
      ctx.fillStyle = v('--text-3', '#74839b'); ctx.fillText(tk.label, x + 3, TRACK_H - 2);
      lastLabelEnd = x + 3 + w;
    }
  }

  // ---------- Montage ----------
  build();
  new ResizeObserver(() => { if (Math.floor(ui.track.clientWidth) !== trackW) drawTrack(); }).observe(root);
  on('change:timeMs', () => { syncTime(); syncJumpsSoon(); });
  on('change:timeScale', () => { win = timeWindow(state.timeScale, state.timeMs); syncTime(true); });
  on('change:playing', () => { syncPlay(); startLoop(); });
  on('change:speed', syncSpeed);
  on('change:selection', () => { syncJumps(); refreshBands(); });
  on('change:params', () => { syncJumps(); refreshBands(); });
  on('change:cvd', drawTrack);
  on('change:lang', build);
  document.addEventListener('keydown', onKey);
  document.fonts?.ready.then(drawTrack);
  startLoop();
}
