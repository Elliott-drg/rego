// Vue « Comparer » : petits outils partagés par ses modules.
import { t } from '../../core/i18n.js';

/**
 * Remplace le contenu d'un élément. Comme dom.h(), accepte des nœuds, des chaînes, des listes
 * imbriquées et ignore null / undefined / false (Element.append, lui, écrirait « null »).
 */
export function put(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

/** Rend les espaces insécables : « 3,1 j » ou « 97 % » ne se coupent pas en fin de ligne. */
export function nb(text) { return String(text).replaceAll(' ', String.fromCharCode(160)); }

/** « A, B et C » dans la langue courante. */
export function joinList(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${t('compare.and')} ${items[items.length - 1]}`;
}
