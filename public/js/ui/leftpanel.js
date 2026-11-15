// Panneau gauche : calques (gestionnaire central), sites, outils.
import { state, set, on, select, emit } from '../core/store.js';
import { t } from '../core/i18n.js';
import { h, clear, collapsible, provTag } from './dom.js';
import { icon } from './icons.js';
import { layers, LAYER_GROUPS } from '../layers/manager.js';
import { cssGradient, cat } from '../layers/palettes.js';
import { sitesOfKind, siteSelection } from '../data/sites.js';
import { fmtLatLon } from '../core/coords.js';
import { actions } from './shell.js';

let adjusting = false;   // vrai pendant qu'on glisse un curseur d'opacité : la liste n'est pas reconstruite
const GROUP_ICON = { geo: 'mountain', sun: 'sun', comms: 'antenna', thermal: 'thermo', resources: 'droplet', sites: 'flag' };

function layerRow(l) {
  const id = `ly-${l.id}`;
  const cb = h('input', { type: 'checkbox', id, ...(l.on ? { checked: true } : {}), ...(l.available ? {} : { disabled: true }), onchange: (e) => layers.toggle(l.id, e.target.checked) });
  const swatch = l.palette ? h('span', { class: 'ly-swatch', style: { background: cssGradient(l.palette, state.cvd) } }) : l.mask ? h('span', { class: 'ly-swatch ly-mask', style: { background: cat(l.mask === 'earth' ? 'earth' : l.mask, state.cvd) } }) : null;
  const row = h('div', { class: 'ly' + (l.on ? ' is-on' : '') + (l.available ? '' : ' is-off'), title: t(`layer.${l.id}.desc`) },
    h('label', { class: 'check' + (l.available ? '' : ' disabled'), for: id }, cb, h('span', { class: 'ly-name' }, t(`layer.${l.id}`)), swatch),
    l.available ? null : h('div', { class: 'ly-missing' }, provTag('missing'), ' ', t('left.layerMissing')),
    l.on && !l.base && l.kind !== 'vector' ? h('div', { class: 'ly-ctl' },
      h('input', { type: 'range', min: 0, max: 100, value: Math.round(l.opacity * 100), 'aria-label': t('left.opacity'), title: t('left.opacity'), oninput: (e) => { adjusting = true; layers.setOpacity(l.id, e.target.value / 100); }, onchange: () => { adjusting = false; } }),
      provTag(l.status)) : null,
    l.on ? h('div', { class: 'ly-desc expert-only' }, t(`layer.${l.id}.desc`)) : null,
  );
  return row;
}

function renderLayers(host) {
  clear(host);
  const viewName = state.view === 'globe' ? 'globe' : 'map2d';
  if (state.view === 'compare') host.append(h('div', { class: 'note note-info', style: { margin: '10px 14px' } }, t('left.compareHint')));
  for (const g of LAYER_GROUPS) {
    const list = layers.all().filter((l) => l.group === g && l.views.includes(viewName));
    if (!list.length) continue;
    const nOn = list.filter((l) => l.on && l.available).length;
    const title = h('span', { class: 'col-title' }, icon(GROUP_ICON[g], 14), ' ', t('layergroup.' + g), nOn ? h('span', { class: 'count' }, String(nOn)) : null);
    host.append(collapsible('lg-' + g, title, list.map(layerRow), g !== 'thermal' && g !== 'resources'));
  }
}

function siteList(kind) {
  const list = sitesOfKind(kind);
  if (!list.length) return h('div', { class: 'dim', style: { padding: '4px 0' } }, t('ui.loading'));
  return h('div', { class: 'sitelist' }, list.map((s) => h('button', { type: 'button', class: 'siteitem' + (state.selection?.key === s.id ? ' is-on' : ''), onclick: () => { select(siteSelection(s)); emit('view:flyTo', { lat: s.lat, lon: s.lon }); } },
    h('span', { class: `mark mark-${kind}`, style: { background: cat(kind, state.cvd) } }),
    h('span', { class: 'siteitem-name' }, s.name),
    h('small', { class: 'mono' }, fmtLatLon(s.lat, s.lon, 1, state.lang)))));
}
function renderSites(host) {
  clear(host);
  host.append(
    collapsible('sites-artemis', h('span', { class: 'col-title' }, icon('rocket', 14), ' ', t('left.sites.artemis'), h('span', { class: 'count' }, String(sitesOfKind('artemis').length || ''))), [
      h('div', { class: 'note note-warn', style: { marginBottom: '8px' } }, t('left.sites.artemisNote')), siteList('artemis')], true),
    collapsible('sites-missions', h('span', { class: 'col-title' }, icon('flag', 14), ' ', t('left.sites.missions')), siteList('mission'), false),
    collapsible('sites-historic', h('span', { class: 'col-title' }, icon('history', 14), ' ', t('left.sites.historic')), siteList('historic'), false),
  );
}
function renderTools(host) {
  clear(host);
  const b = (ic, label, fn, on_ = false) => h('button', { type: 'button', class: 'toolbtn' + (on_ ? ' is-on' : ''), onclick: fn }, icon(ic, 16), h('span', {}, label));
  host.append(collapsible('tools', h('span', { class: 'col-title' }, icon('settings', 14), ' ', t('left.tools')), h('div', { class: 'toolgrid' },
    b('compare', t('left.tool.compare'), actions.plan), b('bolt', t('left.tool.energy'), actions.energy),
    b('ruler', t('left.tool.measure'), actions.measure, state.tool === 'measure'), b('upload', t('left.tool.import'), actions.importer),
    b('database', t('left.tool.data'), actions.dataCenter), b('help', t('left.tool.tutorial'), actions.tutorial)), true));
}

export function mountLeft(el) {
  const head = h('div', { class: 'panel-pad left-head' });
  const layersHost = h('div', {}), sitesHost = h('div', {}), toolsHost = h('div', {}), foot = h('div', { class: 'left-foot' });
  el.append(head, layersHost, sitesHost, toolsHost, foot);
  const renderHead = () => {
    clear(head);
    head.append(h('div', { class: 'eyebrow' }, t('left.navigator')),
      h('div', { class: 'panel-title' }, state.view === 'globe' ? t('left.title.globe') : state.view === 'compare' ? t('left.title.compare') : t('left.title.pole')),
      h('div', { class: 'chip chip-real', title: t('left.realData.help') }, h('i', {}), t('left.realData')));
  };
  const renderFoot = () => { clear(foot); foot.append(h('p', {}, t('left.sources')), h('p', { class: 'dim' }, t('left.disclaimer'))); };
  const all = () => { renderHead(); renderLayers(layersHost); renderSites(sitesHost); renderTools(toolsHost); renderFoot(); };
  all();
  on('layers:change', () => { if (!adjusting) renderLayers(layersHost); });
  // Sur petit écran, choisir un site referme le tiroir des calques pour laisser voir la fiche
  on('change:selection', (s) => { if (s && window.innerWidth < 980 && state.leftOpen) set({ leftOpen: false }); });
  on('sites:ready', () => renderSites(sitesHost));
  on('change', (keys) => {
    if (keys.includes('lang') || keys.includes('cvd')) return all();
    if (keys.includes('view')) { renderHead(); renderLayers(layersHost); }
    if (keys.includes('selection')) renderSites(sitesHost);
    if (keys.includes('tool')) renderTools(toolsHost);
  });
}
