// Légende de la carte 2D : une entrée par calque coloré actif (palette ou masque), avec sa provenance.
// Les motifs des masques reprennent ceux du shader : la couleur n'est jamais le seul repère.

import { state } from '../../core/store.js';
import { t, num, pct, deg } from '../../core/i18n.js';
import { layers } from '../../layers/manager.js';
import { cssGradient, cat, NODATA_RGB } from '../../layers/palettes.js';
import { h, clear, provTag } from '../../ui/dom.js';

function value(v, unit) {
  if (unit === '%') return pct(v, 0);
  if (unit === '°') return deg(v, 0);
  return `${num(v, 0)} ${unit}`;
}
function maskNote(layer) {
  if (layer.id === 'landable') return t('map2d.legend.landable', { v: deg(state.params.slopeLimitDeg, 0) });
  if (layer.id === 'earth_now') return t('map2d.legend.earthNow', { v: deg(state.params.earthMarginDeg, 1) });
  return t('map2d.legend.psr');
}

/** Remplit (ou masque, s'il n'y a rien à expliquer) le panneau de légende. */
export function renderLegend(el) {
  const items = layers.active('map2d').filter((l) => l.palette || l.mask).reverse();   // le calque du dessus en premier
  clear(el);
  el.classList.toggle('hidden', !items.length);
  for (const l of items) {
    const head = h('div', { class: 'map2d-lg-head' }, h('span', { class: 'map2d-lg-title' }, t(`layer.${l.id}`)), provTag(l.status));
    if (l.mask) {
      el.append(h('div', { class: 'legend-item' }, head,
        h('div', { class: 'map2d-lg-mask' }, h('span', { class: `map2d-pat map2d-pat-${l.mask}`, style: { color: cat(l.mask, state.cvd) } }), h('span', {}, maskNote(l)))));
      continue;
    }
    const hasNoData = l.kind === 'polar' && l.needs?.[0] !== 'sp_dem';
    el.append(h('div', { class: 'legend-item' }, head,
      h('div', { class: 'legend-bar', style: { background: cssGradient(l.palette, state.cvd) } }),
      h('div', { class: 'legend-scale' }, h('span', {}, value(l.range[0], l.unit)), h('span', {}, value(l.range[1], l.unit))),
      hasNoData ? h('div', { class: 'map2d-lg-mask' }, h('span', { class: 'map2d-pat map2d-pat-nodata', style: { color: `rgb(${NODATA_RGB.join(',')})` } }), h('span', {}, t('map2d.legend.noData'))) : null));
  }
}
