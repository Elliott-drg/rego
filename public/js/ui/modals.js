// Fenêtres « Historique », « À propos » et visite guidée (tutoriel).
import { state, set, on, select, emit } from '../core/store.js';
import { t, has, dateUTC, int } from '../core/i18n.js';
import '../i18n/tools.js';
import { fmtLatLon } from '../core/coords.js';
import { LANDING_SITES, siteSelection } from '../data/sites.js';
import { MISSION_HISTORY } from '../data/history.js';
import { TEAM } from '../data/team.js';
import { tryData } from '../data/registry.js';
import { cat } from '../layers/palettes.js';
import { h, clear, button } from './dom.js';
import { icon } from './icons.js';
import { openModal, closeModal } from './modal.js';

// ------------------------------------------------------------------ Historique
/** Missions posées (types « historic » et « mission ») dans l'ordre chronologique, avec leurs repères. */
export function historyEntries() {
  return LANDING_SITES.filter((s) => s.kind === 'historic' || s.kind === 'mission')
    .map((site) => {
      const info = MISSION_HISTORY[site.id] || null;
      return { site, info, ms: info ? Date.parse(info.landedUTC + 'T00:00:00Z') : Date.UTC(site.year || 0, 0, 1) };
    })
    .sort((a, b) => a.ms - b.ms);
}

function showSite(site) {
  closeModal();
  if (state.view === 'compare') set({ view: site.lat > -75 ? 'globe' : 'map2d' });
  select(siteSelection(site));
  emit('view:flyTo', { lat: site.lat, lon: site.lon });
}

/** Frise des missions posées sur la Lune ; un clic sélectionne le site et ferme la fenêtre. */
export function openHistory() {
  openModal({
    id: 'history',
    title: () => t('tools.history.title'),
    render: (body) => {
      const dot = (kind) => h('i', { class: `hist-dot hist-dot-${kind}`, style: { background: cat(kind, state.cvd) } });
      const item = ({ site, info, ms }) => h('li', { class: 'hist-item' },
        h('div', { class: 'hist-date mono' }, info ? dateUTC(ms, false) : String(site.year ?? '—')),
        dot(site.kind),
        h('button', { type: 'button', class: 'hist-card', dataset: { site: site.id }, title: t('tools.history.show'), onclick: () => showSite(site) },
          h('span', { class: 'hist-name' }, site.name),
          h('span', { class: 'hist-meta' }, [site.agency, info ? t('tools.history.type.' + info.type) : null, t('kind.' + site.kind)].filter(Boolean).join(' · ')),
          info ? h('span', { class: 'hist-fact' }, t('tools.history.fact.' + site.id)) : null,
          h('span', { class: 'hist-foot' }, h('span', { class: 'mono' }, fmtLatLon(site.lat, site.lon, 2, state.lang)), h('span', { class: 'hist-go' }, t('tools.history.show'), icon('chevron', 14)))));
      clear(body).append(
        h('p', { class: 'muted' }, t('tools.history.intro')),
        h('div', { class: 'hist-legend' }, ['historic', 'mission'].map((k) => h('span', {}, dot(k), t('kind.' + k)))),
        h('ol', { class: 'hist-line' }, historyEntries().map(item)),
        h('p', { class: 'dim hist-note' }, t('tools.history.note')));
    },
  });
}

// ------------------------------------------------------------------ À propos
/** Bibliothèques listées dans le tableau de vendor/LICENSES.md : [{name, version, license}] sans doublon. */
export function parseLicenses(markdown) {
  const libs = new Map();
  for (const line of String(markdown).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 7 || !/^`.+`$/.test(cells[1])) continue;   // lignes du tableau : | `fichier` | paquet | version | … | licence | sha |
    const [, , name, version, , license] = cells;
    if (name && !libs.has(name)) libs.set(name, { name, version: version.replace(/\s*\(.*\)$/, ''), license });
  }
  return [...libs.values()];
}

/** Regroupe les fichiers de données du manifeste par organisme (les éléments graphiques du projet sont exclus). */
export function manifestCredits(manifest) {
  const files = (Array.isArray(manifest) ? manifest : manifest?.files || []).filter((f) => f && f.organism && typeof f.file === 'string' && !f.file.startsWith('../'));
  const groups = new Map();
  for (const f of files) { if (!groups.has(f.organism)) groups.set(f.organism, []); groups.get(f.organism).push(f.title || f.file); }
  return { count: files.length, groups: [...groups].map(([organism, titles]) => ({ organism, titles })) };
}

// Organismes à l'origine des données embarquées (liste courte, utilisée en anglais et quand le manifeste est absent).
const DATA_ORGS = ['lola', 'pgda', 'diviner', 'lp', 'svs', 'iau', 'horizons'];
const FONTS = [{ name: 'Barlow', license: 'SIL OFL 1.1' }, { name: 'IBM Plex Mono', license: 'SIL OFL 1.1' }];
const FALLBACK_LIBS = [{ name: 'three', version: '', license: 'MIT' }, { name: 'astronomy-engine', version: '', license: 'MIT' }];

const credits = { requested: false, manifest: null, libs: null };
/** Lit le manifeste des données et les licences des bibliothèques (une seule fois) ; absents = liste courte. */
async function loadCredits() {
  credits.requested = true;
  const [manifest, md] = await Promise.all([
    tryData('manifest'),
    fetch('vendor/LICENSES.md').then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ]);
  credits.manifest = manifest ? manifestCredits(manifest) : null;
  const libs = md ? parseLicenses(md) : [];
  credits.libs = libs.length ? libs : null;
}

function teamList() {
  return h('ul', { class: 'about-team' }, TEAM.map((m) => {
    const role = m.role?.[state.lang] || m.role?.fr || '';
    const initials = m.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return h('li', {}, h('span', { class: 'about-avatar', 'aria-hidden': 'true' }, initials), h('span', {}, h('strong', {}, m.name), role ? h('span', { class: 'muted' }, role) : null));
  }));
}
function dataCredits() {
  const m = credits.manifest;
  // Le manifeste est rédigé en français : en anglais on affiche la liste courte et on renvoie au Data Center.
  const fromManifest = m && m.count && state.lang === 'fr';
  const lines = fromManifest
    ? m.groups.map((g) => h('li', {}, h('strong', {}, g.organism), h('span', { class: 'muted' }, g.titles.join(' · '))))
    : DATA_ORGS.map((k) => h('li', {}, h('strong', {}, t(`tools.about.org.${k}`)), h('span', { class: 'muted' }, t(`tools.about.org.${k}.what`))));
  return h('div', {}, h('ul', { class: 'about-credits' }, lines),
    m && m.count ? h('p', { class: 'dim' }, t('tools.about.manifestNote', { n: int(m.count) })) : null);
}
function libCredits() {
  const line = (l) => h('li', {}, h('strong', {}, l.name), h('span', { class: 'mono muted' }, [l.version, l.license].filter(Boolean).join(' · ')));
  return h('ul', { class: 'about-credits about-libs' }, (credits.libs || FALLBACK_LIBS).map(line), FONTS.map((f) => line({ ...f, name: `${f.name} (${t('tools.about.font')})` })));
}

let aboutModal = null;   // fenêtre « À propos » ouverte, à redessiner quand les crédits sont lus

/** « À propos » : le projet, l'équipe, l'indépendance vis-à-vis de la NASA, les crédits. */
export function openFounders() {
  aboutModal = openModal({
    id: 'founders',
    title: () => t('tools.about.title'),
    onClose: () => { aboutModal = null; },
    render: (body) => {
      clear(body).append(
        h('div', { class: 'about-head' },
          h('img', { class: 'about-logo', src: 'assets/logo.webp', alt: t('tools.about.logoAlt'), onerror: (e) => e.target.remove() }),
          h('div', {}, h('div', { class: 'eyebrow' }, t('app.tagline')), h('p', { class: 'about-lead' }, t('tools.about.lead')), h('p', { class: 'muted' }, t('tools.about.what')))),
        h('div', { class: 'note note-warn about-indep' }, icon('info', 15), ' ', t('tools.about.independent')),
        h('h3', { class: 'sec-title' }, t('tools.about.team')), teamList(),
        h('h3', { class: 'sec-title' }, t('tools.about.data')), dataCredits(),
        h('h3', { class: 'sec-title' }, t('tools.about.libs')), libCredits(),
        h('p', { class: 'dim' }, t('tools.about.noCdn')));
    },
  });
  if (!credits.requested) loadCredits().then(() => aboutModal?.rerender());
}

// ------------------------------------------------------------------ Visite guidée
// Chaque étape vise la première cible présente et visible ; à défaut elle s'affiche au centre de l'écran.
// Une cible est un sélecteur CSS, ou un bouton de l'en-tête désigné par la clé de son libellé (`button`).
// `hint` ajoute une phrase quand c'est cette cible de repli qui sert : sous 1360 px la navigation de
// l'en-tête passe dans le menu des réglages, et sous 980 px les panneaux deviennent des tiroirs fermés.
const OPEN_LEFT = { button: 'shell.toggleLeft', hint: 'tools.tour.hint.left' };
const OPEN_RIGHT = { button: 'shell.toggleRight', hint: 'tools.tour.hint.right' };
const SETTINGS_MENU = { button: 'shell.settings', hint: 'tools.tour.hint.menu' };
const TOUR_STEPS = [
  { id: 'welcome', targets: [] },
  { id: 'site', targets: ['#left .sitelist', '#left', OPEN_LEFT] },
  { id: 'horizon', targets: ['#right', OPEN_RIGHT] },
  { id: 'time', targets: ['#timebar'] },
  { id: 'layers', targets: ['#left details.col', '#left', OPEN_LEFT] },
  { id: 'compare', targets: ['.viewswitch', '#main'] },
  { id: 'energy', targets: ['#left .toolgrid', '#header .navpills', SETTINGS_MENU, '#header'] },
  { id: 'verify', targets: ['#header .navpills', SETTINGS_MENU, '#header'] },
];
const SEEN_KEY = 'rf.tutorialSeen';
/** Vrai si la visite guidée a déjà été suivie ou quittée sur cet appareil. */
export function tutorialSeen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } }

let closeTour = null;

function targetElement(target) {
  if (typeof target === 'string') return document.querySelector(target);
  if (!has(target.button)) return null;   // libellés de la coquille absents : pas de bouton à désigner
  const label = t(target.button);
  return [...document.querySelectorAll('#header button')].find((b) => b.getAttribute('aria-label') === label) || null;
}

/** Première cible visible d'une étape : {left, top, width, height, hint} en pixels écran, ou null. */
function visibleTarget(targets) {
  for (const target of targets) {
    const el = targetElement(target);
    if (!el) continue;
    // Un panneau fermé (tiroir hors écran sur mobile) n'est pas ramené de force : on passe à la cible suivante.
    const host = (el.closest('#left, #right') || el).getBoundingClientRect();
    if (host.width === 0 || host.right <= 0 || host.left >= window.innerWidth) continue;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0), hgt = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    if (w > 24 && hgt > 24) return { left: Math.max(r.left, 0), top: Math.max(r.top, 0), width: w, height: hgt, hint: target.hint || null };
  }
  return null;
}

/** Visite guidée : met en évidence une zone de l'interface à chaque étape (←, →, Échap). */
export function openTutorial() {
  closeTour?.();
  closeModal();
  let index = 0;
  const spot = h('div', { class: 'tour-spot' });
  const card = h('div', { class: 'tour-card glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' });
  const root = h('div', { class: 'tour' }, spot, card);

  let rect = null;   // zone désignée par l'étape en cours
  const place = () => {
    rect = visibleTarget(TOUR_STEPS[index].targets);
    const W = window.innerWidth, H = window.innerHeight, gap = 14, m = 12;
    root.classList.toggle('is-centered', !rect);
    if (rect) Object.assign(spot.style, { left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = (W - cw) / 2, y = (H - ch) / 2;
    if (rect && W < 640) {                       // petit écran : la carte se cale en haut ou en bas, à l'opposé de la zone
      y = rect.top + rect.height / 2 > H / 2 ? m : H - ch - m;
    } else if (rect) {
      const clampX = (v) => Math.max(m, Math.min(W - cw - m, v)), clampY = (v) => Math.max(m, Math.min(H - ch - m, v));
      if (rect.left + rect.width + gap + cw <= W - m) { x = rect.left + rect.width + gap; y = clampY(rect.top); }
      else if (rect.left - gap - cw >= m) { x = rect.left - gap - cw; y = clampY(rect.top); }
      else if (rect.top + rect.height + gap + ch <= H - m) { x = clampX(rect.left + rect.width / 2 - cw / 2); y = rect.top + rect.height + gap; }
      else if (rect.top - gap - ch >= m) { x = clampX(rect.left + rect.width / 2 - cw / 2); y = rect.top - gap - ch; }
    }
    card.style.left = `${Math.max(m, x)}px`; card.style.top = `${Math.max(m, y)}px`;
  };
  const render = () => {
    const step = TOUR_STEPS[index], last = index === TOUR_STEPS.length - 1;
    const next = button(last ? t('tools.tour.finish') : t('tools.tour.next'), () => go(1), { kind: 'primary', small: true });
    const hint = h('p', { class: 'tour-hint', hidden: true });
    clear(card).append(
      h('div', { class: 'eyebrow' }, t('tools.tour.step', { i: index + 1, n: TOUR_STEPS.length })),
      h('h3', { id: 'tour-title', class: 'tour-title' }, t(`tools.tour.${step.id}.title`)),
      h('p', { class: 'tour-text' }, t(`tools.tour.${step.id}.text`)),
      hint,
      h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, TOUR_STEPS.map((_, i) => h('i', { class: i === index ? 'is-on' : i < index ? 'is-done' : '' }))),
      h('div', { class: 'tour-actions' },
        button(t('tools.tour.quit'), () => finish(), { kind: 'ghost', small: true }),
        h('span', { class: 'tour-keys dim' }, t('tools.tour.keys')),
        button(t('tools.tour.prev'), () => go(-1), { small: true, disabled: index === 0 }), next));
    place();
    if (rect?.hint) { hint.textContent = t(rect.hint); hint.hidden = false; place(); }   // la phrase ajoutée change la hauteur de la carte
    next.focus({ preventScroll: true });
  };
  function go(delta) {
    if (index + delta >= TOUR_STEPS.length) return finish();
    index = Math.max(0, index + delta);
    render();
  }
  const key = (e) => {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') finish();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const offLang = on('change:lang', render);
  function finish() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* stockage indisponible : la visite reste proposée */ }
    document.removeEventListener('keydown', key, true); window.removeEventListener('resize', render);
    offLang(); root.remove(); closeTour = null;
  }
  closeTour = finish;
  document.addEventListener('keydown', key, true); window.addEventListener('resize', render);   // la cible peut changer avec la largeur
  document.body.append(root);
  render();
}
