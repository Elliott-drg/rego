# Consignes communes aux agents (à lire en entier avant de coder)

Projet : `/home/codex/harness/projets/regolith-finder/`. Lis d'abord `docs/ARCHITECTURE.md` (contrats, règles, tests),
puis les fichiers communs que tu utilises (`public/js/core/*.js`, `public/js/science/engine.js`, `public/js/ui/dom.js`,
`public/js/views/charts.js`, `public/css/base.css`, `public/js/layers/*.js`, `public/js/data/*.js`).
Le cahier des charges complet de l'équipe est dans `/home/codex/harness/inbox/2026-11-15/Consignes_nasa.txt`
(lignes 1-38 : le défi NASA ; 42-1095 : « prompt maître » ; 1097-1162 : premier prompt). Les maquettes sont les images
`image_1.webp`, `image_3.webp`, `image_4.webp`, `materiau.webp` du même dossier (regarde-les avec l'outil Read).

- D'autres agents écrivent d'autres fichiers du même dépôt EN MÊME TEMPS. Ne touche qu'aux fichiers qui te sont attribués.
  Aucune commande git. Ne tue aucun processus qui n'est pas le tien. Pas de sudo, pas d'installation globale.
- Les fichiers communs sont figés : si tu as besoin d'un ajout (une clé d'état, une fonction), contourne-le dans tes
  fichiers et signale-le dans ton rapport ; ne modifie pas le fichier commun.
- Qualité avant tout : code lisible, commenté en français là où ce n'est pas évident, pas de code mort, pas de
  fonctionnalité simulée. Ce qui n'est pas réellement implémenté ne doit pas apparaître dans l'interface.
- Chaque texte visible est traduit FR + EN dans TON fichier `public/js/i18n/<module>.js` (importé en tête de ton module).
- Teste réellement dans le navigateur (recette dans ARCHITECTURE.md, toujours sous `flock .dev/browser.lock`), en
  1440×900 et en 390×844, en français et en anglais ; regarde tes captures ; zéro erreur console. Écris ton test dans
  `tests/<module>.browser.mjs` (il doit rester et être relançable). Si un module voisin n'existe pas encore, ton test
  monte TON module seul dans une page de test (`tests/pages/<module>.html`, servie par `serveStatic()` avec la racine
  du dépôt — adapte les chemins) ou via `public/index.html` si elle fonctionne.
- Les données sont dans `public/data/` (un autre agent finit de les livrer ; `sp_dem_240m.i16`, `sp_sun_avg_240m.u8`,
  `sp_earth_avg_240m.u8`, `sp_psr_240m.u8`, `sp_t{max,min,avg}_240m.u16`, `global_ldem_4ppd.i16`, `lpgrs_5deg.json`,
  `moon_color_4k.jpg` sont déjà là). Un fichier absent doit donner un état « indisponible » propre, jamais un plantage.
- Rapport final court : fichiers écrits ; ce qui est testé (avec le résultat) ; ce qui est écrit mais non testé ;
  ce qui n'est pas fait ; changements souhaités dans les fichiers communs ; limites connues. Pas de récit.
