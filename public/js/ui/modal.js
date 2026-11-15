// Fenêtres modales et notifications.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';
import { on } from '../core/store.js';

let current = null;
/**
 * @param {{title:string, wide?:boolean, render:(body:HTMLElement, api:{close:Function, rerender:Function})=>void, onClose?:Function, id?:string}} opts
 * `render` est rappelé quand la langue change (les contenus doivent donc utiliser t()).
 */
export function openModal(opts) {
  closeModal();
  const body = h('div', { class: 'modal-body' });
  const titleEl = h('h2', { class: 'modal-title' });
  const api = { close: closeModal, rerender: () => { titleEl.textContent = typeof opts.title === 'function' ? opts.title() : opts.title; clear(body); opts.render(body, api); } };
  const box = h('div', { class: 'modal' + (opts.wide ? ' modal-wide' : ''), role: 'dialog', 'aria-modal': 'true', dataset: { modal: opts.id || '' } },
    h('header', { class: 'modal-head' }, titleEl, h('button', { class: 'iconbtn', type: 'button', title: t('ui.close'), onclick: closeModal }, icon('close', 18))),
    body);
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) closeModal(); } }, box);
  document.body.append(back);
  const off = on('change:lang', api.rerender);
  const key = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', key);
  current = { back, off, key, onClose: opts.onClose };
  api.rerender();
  return api;
}
export function closeModal() {
  if (!current) return;
  current.back.remove(); current.off(); document.removeEventListener('keydown', current.key);
  const cb = current.onClose; current = null; cb?.();
}
export function isModalOpen() { return !!current; }

// Notifications : store.toast('message', 'info'|'ok'|'warn'|'error')
export function initToasts() {
  const host = h('div', { class: 'toasts', 'aria-live': 'polite' });
  document.body.append(host);
  on('toast', ({ message, kind }) => {
    const el = h('div', { class: `toast toast-${kind}` }, message);
    host.append(el);
    setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 7000 : 3800);
  });
}
