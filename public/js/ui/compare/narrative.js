// Vue « Comparer » : phrases d'analyse. Chaque phrase est un gabarit rempli avec des cellules du
// tableau des critères (mêmes textes, même règle d'égalité) : rien n'y est affirmé qui ne soit affiché.

import { t, dateUTC } from '../../core/i18n.js';
import { LETTERS, displayName, regionVariant, sunNextText, earthNextText } from './analyze.js';
import { getSite } from '../../data/sites.js';
import { joinList, nb } from './util.js';

/**
 * Libellés des scénarios dans les phrases : « A (Malapert Massif) ». Si plusieurs scénarios portent
 * sur le même lieu, la date les distingue : « A (15 nov. 2026) ».
 */
function scenarioLabels(scenarios, analyses) {
  // Point choisi dans une région : le nom de la région suffit, sauf si deux scénarios portent sur la même région.
  const siteName = (sc) => {
    const alone = !scenarios.some((s) => s !== sc && s.siteId === sc.siteId);
    return (regionVariant(sc) && alone && getSite(sc.siteId)?.name) || displayName(sc);
  };
  const sameSite = (i) => scenarios.some((s, k) => k !== i && s.key === scenarios[i].key);
  const allSame = scenarios.length > 1 && scenarios.every((s) => s.key === scenarios[0].key);
  return scenarios.map((sc, i) => {
    const parts = [];
    if (!allSame) parts.push(siteName(sc));
    if (sameSite(i) && analyses[i]) parts.push(dateUTC(analyses[i].dateMs, false));
    return parts.length ? `${LETTERS[i]} (${parts.join(', ')})` : LETTERS[i];
  });
}

/**
 * @param {object[]} scenarios state.compare  @param {(object|null)[]} analyses  @param {object[]} model analyze.tableModel()
 * @returns {string[]} 3 à 5 phrases (aucune s'il n'y a pas de scénario calculé)
 */
export function buildNarrative(scenarios, analyses, model) {
  const ok = analyses.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) return [];
  const line = Object.fromEntries(model.map((r) => [r.row.id, r]));
  const labels = scenarioLabels(scenarios, analyses);
  // Insécables : dans une phrase, « 8,2 j » ou « 60,2 % » ne doivent pas se couper en fin de ligne.
  const cell = (id, i) => nb(line[id].cells[i].main);
  const out = [];

  // 1. État à la date de chaque scénario : ce qui compte le jour de l'atterrissage.
  const atDate = ok.map((i) => {
    const a = analyses[i];
    return t('compare.an.date.item', {
      l: LETTERS[i],
      sun: `${t(a.sunUp ? 'compare.sun.up' : 'compare.sun.down')} (${sunNextText(a)})`,
      earth: `${t(a.earthUp ? 'compare.earth.up' : 'compare.earth.down')} (${earthNextText(a)})`,
    });
  });
  out.push(t('compare.an.date', { list: atDate.join(t('compare.an.sep')) }));

  if (ok.length === 1) {
    const i = ok[0];
    out.push(t('compare.an.single.energy', { l: labels[i], sun: cell('sunPct', i), night: cell('night', i) }));
    out.push(t('compare.an.single.earth', { earth: cell('earthPct', i), blackout: cell('blackout', i), both: cell('both', i) }));
    out.push(t('compare.an.single.more'));
    return out;
  }

  const all = joinList(ok.map((i) => LETTERS[i]));
  const others = (id, winners) => ok.filter((i) => !winners.includes(i)).map((i) => t('compare.an.other', { l: LETTERS[i], v: cell(id, i) })).join(', ');
  /** Phrase « le meilleur est X (les autres : …) », ou sa variante « égalité ». */
  const ranked = (id, key, extra = {}) => {
    const { best } = line[id];
    if (!best || !best.winners.length) return null;
    const v = cell(id, best.winners[0]);
    if (best.tie) return t(`${key}.tie`, { list: all, v, ...extra });
    return t(key, { best: joinList(best.winners.map((i) => labels[i])), v, others: others(id, best.winners), ...extra });
  };

  // 2. Énergie  3. Liaison avec la Terre (avec la plus longue coupure de chaque scénario)
  const energy = ranked('sunPct', 'compare.an.energy');
  if (energy) out.push(energy);
  const earth = ranked('earthPct', 'compare.an.earth', { blackouts: ok.map((i) => `${LETTERS[i]} ${cell('blackout', i)}`).join(', ') });
  if (earth) out.push(earth);

  // 4. Plus longue nuit : le pire et le meilleur scénario
  const night = line.night;
  if (night.best && night.best.winners.length) {
    if (night.best.tie) out.push(t('compare.an.night.tie', { list: all, v: cell('night', ok[0]) }));
    else {
      const worstIdx = ok.reduce((w, i) => (night.values[i] > night.values[w] ? i : w), ok[0]);
      const worst = ok.filter((i) => cell('night', i) === cell('night', worstIdx));
      out.push(t('compare.an.night', {
        worst: joinList(worst.map((i) => labels[i])), v: cell('night', worstIdx),
        best: joinList(night.best.winners.map((i) => labels[i])), v2: cell('night', night.best.winners[0]),
      }));
    }
  }

  // 5. Compromis : Soleil et Terre ensemble, puis le score calculé s'il est comparable
  const both = ranked('both', 'compare.an.both');
  if (both) {
    const s = line.compScore.best;
    let tail = '.';
    if (s && s.winners.length) {
      const v = cell('compScore', s.winners[0]);
      tail = s.tie ? t('compare.an.score.tie', { v }) : t('compare.an.score', { best: joinList(s.winners.map((i) => LETTERS[i])), v });
    }
    out.push(both + tail);
  }
  return out;
}
