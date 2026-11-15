// Traductions : toutes les chaînes de l'interface passent par t().
//   register({ fr: { 'energy.title': 'Énergie' }, en: { 'energy.title': 'Energy' } });
//   t('energy.title')  ·  t('site.nightDays', { n: 3.2 })  -> remplace {n}
// Dans le HTML statique : <span data-i18n="clé"></span>, data-i18n-title, data-i18n-placeholder.

import { state, on } from './store.js';

const dict = { fr: {}, en: {} };
export function register(d) {
  for (const lang of ['fr', 'en']) if (d[lang]) Object.assign(dict[lang], d[lang]);
}
export function t(key, vars) {
  let s = dict[state.lang]?.[key] ?? dict.fr[key] ?? dict.en[key];
  if (s === undefined) { if (!t._warned?.has(key)) { (t._warned ??= new Set()).add(key); console.warn('[i18n] clé manquante :', key); } return key; }
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
export function has(key) { return dict.fr[key] !== undefined || dict.en[key] !== undefined; }
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.documentElement.lang = state.lang;
}
on('change:lang', () => applyI18n());

// ---- Nombres, dates, durées (selon la langue) ----
const locale = () => (state.lang === 'fr' ? 'fr-FR' : 'en-GB');
export function num(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  // L'espace fine insécable (U+202F) du format français n'existe pas dans la police à chasse fixe : on met une insécable simple.
  return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u202f/g, '\u00a0');
}
export function int(v) { return num(v, 0); }
export function pct(v, digits = 0) { return Number.isFinite(v) ? `${num(v, digits)}${state.lang === 'fr' ? '\u00a0%' : '%'}` : '—'; }
export function deg(v, digits = 1) { return Number.isFinite(v) ? `${num(v, digits)}°` : '—'; }
export function dateUTC(ms, withTime = true) {
  if (!Number.isFinite(ms)) return '—';
  const o = withTime ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' } : { dateStyle: 'medium', timeZone: 'UTC' };
  return new Date(ms).toLocaleString(locale(), o) + (withTime ? ' UTC' : '');
}
/** Durée lisible à partir d'heures : « 3,2 j », « 14 h », « 25 min ». */
export function duration(hours) {
  if (!Number.isFinite(hours)) return '—';
  const a = Math.abs(hours);
  if (a >= 48) return `${num(hours / 24, 1)}\u00a0${state.lang === 'fr' ? 'j' : 'd'}`;
  if (a >= 1) return `${num(hours, a < 10 ? 1 : 0)}\u00a0h`;
  return `${num(hours * 60, 0)}\u00a0min`;
}
/** Température dans les deux unités : « 92 K (−181 °C) ». */
export function temp(k, digits = 0) {
  if (!Number.isFinite(k)) return '—';
  const c = k - 273.15, K = `${num(k, digits)}\u00a0K`, C = `${num(c, digits)}\u00a0°C`;
  return state.tempUnit === 'C' ? `${C} (${K})` : `${K} (${C})`;
}
export function meters(m) {
  if (!Number.isFinite(m)) return '—';
  return Math.abs(m) >= 10000 ? `${num(m / 1000, 1)}\u00a0km` : `${num(m, 0)}\u00a0m`;
}
export function km(mVal, digits = 1) { return Number.isFinite(mVal) ? `${num(mVal / 1000, digits)}\u00a0km` : '—'; }
