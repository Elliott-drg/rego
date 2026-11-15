// Repères historiques des missions posées sur la Lune qui figurent dans data/sites.js (types « historic » et « mission »).
//
// Chaque entrée est indexée par l'identifiant du site. Ne contient que des faits publics, chacun relu
// dans la source indiquée en commentaire (consultées le 15/11/2026) ; pas d'anecdote.
// Les dates d'alunissage sont en temps universel (UTC).
//
// type : 'crewed' (vol habité) · 'rover' (atterrisseur et rover) · 'sample' (retour d'échantillons) ·
//        'lander' (atterrisseur) · 'commercial' (atterrisseur privé, programme CLPS de la NASA).
// Les textes sont enregistrés dans le dictionnaire commun : t('tools.history.fact.<id>').
// Dans les textes : \u00a0 = espace insécable (avant une unité), \u202f = espace fine insécable (milliers).

import { register } from '../core/i18n.js';

/** @type {Record<string, {landedUTC:string, type:'crewed'|'rover'|'sample'|'lander'|'commercial'}>} */
export const MISSION_HISTORY = {
  // 20 juillet 1969, 20:17:40 UT, Mare Tranquillitatis — https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo11info.html
  apollo11: { landedUTC: '1969-07-20', type: 'crewed' },
  // 19 novembre 1969, 06:54:35 UT, Oceanus Procellarum — https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo12info.html
  apollo12: { landedUTC: '1969-11-19', type: 'crewed' },
  // 30 juillet 1971, 22:16:29 UT, Hadley Rille / Apennins — https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo15info.html
  apollo15: { landedUTC: '1971-07-30', type: 'crewed' },
  // 11 décembre 1972, 19:54:57 UT, Taurus-Littrow — https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo17info.html
  apollo17: { landedUTC: '1972-12-11', type: 'crewed' },
  // 15 janvier 1973, cratère Le Monnier — https://lroc.im-ldi.com/images/699
  luna21: { landedUTC: '1973-01-15', type: 'rover' },
  // 1er décembre 2020, 15:11 UTC, Oceanus Procellarum — https://lroc.im-ldi.com/images/1172
  change5: { landedUTC: '2020-12-01', type: 'sample' },
  // 23 août 2023, à environ 600 km du pôle Sud — https://www.nasa.gov/image-article/nasas-lro-observes-chandrayaan-3-landing-site/
  chandrayaan3: { landedUTC: '2023-08-23', type: 'rover' },
  // 20 janvier 2024 à 0 h 20 JST, soit le 19 à 15:20 UTC — https://global.jaxa.jp/press/2024/01/20240125-1_e.html
  slim: { landedUTC: '2024-01-19', type: 'lander' },
  // 22 février 2024, région du pôle Sud — https://www.nasa.gov/image-article/odysseus-lands-on-the-moon/
  im1: { landedUTC: '2024-02-22', type: 'commercial' },
  // 1er juin 2024 (22:23 UTC ; 2 juin à Pékin) — https://www.nasa.gov/centers-and-facilities/goddard/nasas-lro-spots-chinas-change-6-spacecraft-on-lunar-far-side
  change6: { landedUTC: '2024-06-01', type: 'sample' },
  // 2 mars 2025, Mare Crisium — https://www.nasa.gov/news-release/nasa-science-continues-after-fireflys-first-moon-mission-concludes/
  blueghost1: { landedUTC: '2025-03-02', type: 'commercial' },
  // 6 mars 2025, Mons Mouton — https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/
  im2: { landedUTC: '2025-03-06', type: 'commercial' },
};

register({
  fr: {
    // Premier alunissage habité ; 21 h 36 min à la surface — https://www.nasa.gov/history/apollo-11-mission-overview/
    'tools.history.fact.apollo11': 'Premier alunissage habité. Neil Armstrong et Buzz Aldrin passent 21\u00a0h\u00a036\u00a0min à la surface, dans la mer de la Tranquillité.',
    // À 538 pieds (164 m) de Surveyor 3, posée en avril 1967 ; caméra et autres pièces rapportées — https://www.nasa.gov/humans-in-space/lunar-encore-leads-to-first-precision-extraterrestrial-landing
    'tools.history.fact.apollo12': 'Alunissage de précision à moins de 200\u00a0m de la sonde Surveyor 3, posée là en 1967. Charles Conrad et Alan Bean en rapportent la caméra et d’autres pièces.',
    // Premier véhicule conduit sur la Lune par des astronautes ; 66 h 55 min à la surface — https://www.nasa.gov/missions/apollo/apollo-15-mission-details/
    // (le premier véhicule lunaire est le rover soviétique Lunokhod 1, en 1970 : d'où « première mission Apollo »)
    'tools.history.fact.apollo15': 'Première mission Apollo à emporter le véhicule lunaire (Lunar Roving Vehicle). David Scott et James Irwin passent près de trois jours (66\u00a0h\u00a055\u00a0min) au pied des Apennins, près de la rainure Hadley.',
    // Dernière mission lunaire Apollo ; 75 h à la surface — https://www.nasa.gov/missions/apollo/apollo-17-mission-details/
    // Schmitt géologue — https://www.nasa.gov/former-astronaut-harrison-schmitt/
    'tools.history.fact.apollo17': 'Dernier alunissage habité à ce jour. Eugene Cernan et le géologue Harrison Schmitt passent 75\u00a0heures dans la vallée de Taurus-Littrow.',
    // Lunokhod 2, environ 39 km (distance réévaluée avec les images LRO) — https://lroc.im-ldi.com/posts/774 ; fin d'activité en mai 1973 — https://lroc.im-ldi.com/images/699
    'tools.history.fact.luna21': 'Dépose le rover soviétique Lunokhod 2 dans le cratère Le Monnier. Il parcourt environ 39\u00a0km en quatre mois (distance réévaluée à partir des images de la sonde LRO).',
    // Environ 1 731 g (CNSA) ; retour le 16 décembre 2020 UTC (17 à Pékin) ; premier depuis Luna 24 — https://english.nao.cas.cn/ne2015/News2015/202012/t20201221_260671.html
    // Près du Mons Rümker — https://www.nationalgeographic.com/science/article/china-launches-first-moon-sample-return-mission-in-over-40-years
    'tools.history.fact.change5': 'Se pose dans l’océan des Tempêtes, près du Mons Rümker, et rapporte environ 1\u202f731\u00a0g d’échantillons sur Terre le 16 décembre 2020 (UTC) : premier retour d’échantillons lunaires depuis Luna 24 (1976).',
    // Site visé vers 69,37° S ; durée de mission : un jour lunaire (~14 jours terrestres) — https://www.isro.gov.in/Chandrayaan3_Details.html
    // Mise en sommeil du rover le 2 septembre 2023, de l'atterrisseur le 4 — https://www.space.com/chandrayaan-3-rover-lander-sleep-mode
    'tools.history.fact.chandrayaan3': 'Premier alunissage en douceur de l’Inde, vers 69°\u00a0S. L’atterrisseur Vikram et le rover Pragyan fonctionnent pendant la journée lunaire, soit environ deux semaines terrestres.',
    // Environ 55 m à l'est de la cible ; poussée d'un des deux moteurs principaux perdue ; panneaux solaires tournés vers l'ouest,
    // sans production d'électricité à l'arrivée — https://global.jaxa.jp/press/2024/01/20240125-1_e.html
    // Près du cratère Shioli — https://www.nasa.gov/missions/lro/nasas-lro-spots-japans-moon-lander
    'tools.history.fact.slim': 'Démonstration d’alunissage de précision de la JAXA : l’engin se pose à environ 55\u00a0m de sa cible, près du cratère Shioli. Il perd la poussée d’un de ses deux moteurs principaux en fin de descente et s’immobilise dans une position où ses panneaux solaires ne produisent d’abord pas d’électricité.',
    // Premier alunissage américain depuis Apollo 17, premier du programme CLPS — https://www.nasa.gov/image-article/odysseus-lands-on-the-moon/
    // Engin incliné contre le sol ; instruments arrêtés sept jours après l'alunissage — https://www.nasa.gov/missions/artemis/clps/nasa-collects-first-surface-science-in-decades-via-commercial-moon-mission/
    'tools.history.fact.im1': 'Premier alunissage américain depuis Apollo 17 et première livraison réussie du programme CLPS de la NASA, par un engin privé. Odysseus se pose incliné contre le sol et fonctionne sept jours.',
    // Bord sud du bassin Apollo — https://www.nasa.gov/centers-and-facilities/goddard/nasas-lro-spots-chinas-change-6-spacecraft-on-lunar-far-side
    // Premier retour d'échantillons de la face cachée, capsule posée le 25 juin 2024 — https://www.scientificamerican.com/article/china-returns-first-ever-samples-from-the-moons-far-side/
    'tools.history.fact.change6': 'Se pose dans le bassin Apollo, sur la face cachée, à l’intérieur du bassin Pôle Sud-Aitken. Premier retour d’échantillons de la face cachée, arrivé sur Terre le 25 juin 2024.',
    // Dix instruments NASA, environ 14 jours, fin de mission le 16 mars 2025 — https://www.nasa.gov/news-release/nasa-science-continues-after-fireflys-first-moon-mission-concludes/
    'tools.history.fact.blueghost1': 'Se pose dans la mer des Crises (Mare Crisium) avec dix instruments de la NASA. Fonctionne environ deux semaines, jusqu’au début de la nuit lunaire.',
    // Environ 250 m de la cible, sur le flanc dans un cratère, fin de mission le 7 mars 2025 — https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/
    'tools.history.fact.im2': 'Se pose sur Mons Mouton, à environ 250\u00a0m de sa cible, mais couché dans un cratère. Ses panneaux ne pouvant plus recharger les batteries, la mission s’arrête le lendemain.',
  },
  en: {
    'tools.history.fact.apollo11': 'First crewed Moon landing. Neil Armstrong and Buzz Aldrin spent 21\u00a0hours 36\u00a0minutes on the surface, in the Sea of Tranquility.',
    'tools.history.fact.apollo12': 'Precision landing less than 200\u00a0m from the Surveyor 3 probe, which had landed there in 1967. Charles Conrad and Alan Bean brought back its camera and other parts.',
    'tools.history.fact.apollo15': 'First Apollo mission to carry the Lunar Roving Vehicle. David Scott and James Irwin spent nearly three days (66\u00a0h 55\u00a0min) at the foot of the Apennines, next to Hadley Rille.',
    'tools.history.fact.apollo17': 'Last crewed Moon landing to date. Eugene Cernan and geologist Harrison Schmitt spent 75\u00a0hours in the Taurus-Littrow valley.',
    'tools.history.fact.luna21': 'Delivered the Soviet rover Lunokhod 2 to Le Monnier crater. It drove about 39\u00a0km in four months (distance revised from Lunar Reconnaissance Orbiter images).',
    'tools.history.fact.change5': 'Landed in Oceanus Procellarum, near Mons Rümker, and returned about 1,731\u00a0g of samples to Earth on 16 December 2020 (UTC): the first lunar sample return since Luna 24 (1976).',
    'tools.history.fact.chandrayaan3': 'India’s first soft landing on the Moon, near 69°\u00a0S. The Vikram lander and the Pragyan rover operated through one lunar daytime (about two Earth weeks).',
    'tools.history.fact.slim': 'JAXA’s precision-landing demonstrator touched down about 55\u00a0m from its target, near Shioli crater. It lost thrust from one of its two main engines late in the descent and came to rest in a position where its solar cells produced no power at first.',
    'tools.history.fact.im1': 'First American Moon landing since Apollo 17 and first successful delivery of NASA’s CLPS programme, by a privately built lander. Odysseus came to rest leaning on the surface and operated for seven days.',
    'tools.history.fact.change6': 'Landed in the Apollo basin on the far side, inside the South Pole-Aitken basin. First sample return from the far side, delivered to Earth on 25 June 2024.',
    'tools.history.fact.blueghost1': 'Landed in Mare Crisium carrying ten NASA instruments. It operated for about two weeks, until the start of lunar night.',
    'tools.history.fact.im2': 'Landed on Mons Mouton about 250\u00a0m from its target, but on its side inside a crater. With its solar panels unable to recharge the batteries, the mission ended the next day.',
  },
});
