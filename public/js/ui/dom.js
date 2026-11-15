// Petits outils DOM communs à toute l'interface.
import { t } from '../core/i18n.js';
import { icon } from './icons.js';

/** h('div', {class:'card', onclick: fn, dataset:{id:1}}, enfant, 'texte', [liste]) */
export function h(tag, attrs, ...children) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * Étiquette de provenance : dit si une valeur est mesurée, calculée, modélisée…
 * kind : 'measured' | 'derived' | 'computed' | 'model' | 'estimate' | 'hypothesis' | 'illustrative' | 'missing'
 */
export function provTag(kind, title) {
  return h('span', { class: `tag tag-${kind}`, title: title || t(`prov.${kind}.help`) }, t(`prov.${kind}`));
}
/** Ligne « libellé — valeur [provenance] » utilisée dans les fiches. */
export function row(label, value, opts = {}) {
  return h('div', { class: 'kv' + (opts.strong ? ' kv-strong' : '') },
    h('span', { class: 'kv-k' }, opts.icon ? icon(opts.icon) : null, label),
    h('span', { class: 'kv-v' }, value, opts.prov ? provTag(opts.prov, opts.provTitle) : null),
    opts.note ? h('span', { class: 'kv-note' }, opts.note) : null);
}
export function button(label, onclick, opts = {}) {
  return h('button', { class: `btn ${opts.kind ? 'btn-' + opts.kind : ''} ${opts.small ? 'btn-sm' : ''}`.trim(), type: 'button', onclick, title: opts.title, disabled: opts.disabled },
    opts.icon ? icon(opts.icon) : null, label);
}
export function section(title, ...children) {
  return h('section', { class: 'sec' }, h('h3', { class: 'sec-title' }, title), children);
}
/** Groupe repliable (état mémorisé par identifiant). */
export function collapsible(id, title, content, open = true) {
  let isOpen = open;
  try { const s = localStorage.getItem('rf.col.' + id); if (s !== null) isOpen = s === '1'; } catch { /* ignore */ }
  const d = h('details', { class: 'col', ...(isOpen ? { open: true } : {}) }, h('summary', {}, icon('chevron'), h('span', {}, title)), h('div', { class: 'col-body' }, content));
  d.addEventListener('toggle', () => { try { localStorage.setItem('rf.col.' + id, d.open ? '1' : '0'); } catch { /* ignore */ } });
  return d;
}
export function debounce(fn, ms = 150) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }
export function throttle(fn, ms = 100) {
  let last = 0, id = null, lastArgs;
  return (...a) => {
    lastArgs = a; const now = performance.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!id) id = setTimeout(() => { id = null; last = performance.now(); fn(...lastArgs); }, ms - (now - last));
  };
}
export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
