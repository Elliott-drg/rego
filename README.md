# Regolith Finder

Outil local pour comparer vite des **sites** et des **dates** d'atterrissage au pôle Sud de la Lune :
où sont le Soleil et la Terre par rapport à l'horizon réel, combien de temps durent les nuits et les
coupures radio, quelle énergie solaire et quelle température attendre.

Tout tourne sur votre ordinateur (`localhost`). Aucun compte, aucune clé API, aucun site en lig    ne.

## Lancer

1. Décompressez le zip.
2. **Windows** : double-cliquez sur `LANCER.bat`. **macOS / Linux** : `./lancer.sh` dans un terminal.
3. Le navigateur s'ouvre sur `http://localhost:8080`. Gardez la fenêtre noire ouverte ; fermez-la pour arrêter.

Il faut **Node.js 18 ou plus** (https://nodejs.org, bouton « LTS »). Sans Node, le lanceur essaie Python :
l'application marche, mais sans les fonctions en ligne (comparaison avec JPL Horizons, cache sur disque).

Lancement à la main : `node server.mjs` (options `--port 8090`, `--no-open`).

Navigateur conseillé : Chrome, Edge ou Firefox récent, avec l'accélération graphique (WebGL2).

## Ce que fait l'application

| Écran | Contenu |
|---|---|
| Carte 2D du pôle Sud | Relief LOLA (240 m) avec les **ombres portées calculées à la date choisie**, calques (altitude, pente, Soleil visible, Terre visible, ensoleillement moyen, ombre permanente, températures Diviner), régions candidates Artemis, clic sur n'importe quel point |
| Globe 3D | Lune entière éclairée depuis la direction réelle du Soleil, Terre et Soleil, sites historiques et missions récentes, composition (Lunar Prospector), cube d'orientation |
| Fiche du site (à droite) | **Tour d'horizon** avec le Soleil et la Terre au-dessus du relief, temps avant le coucher du Soleil et avant la perte de la Terre, % d'ensoleillement, plus longue nuit, % de visibilité de la Terre, plus longue coupure, température, pente, ressources, notes |
| Barre de temps | Date et heure UTC, lecture accélérée, jour lunaire / 1 an / 10 ans, bandes « Soleil visible » et « Terre visible » |
| Comparer | Jusqu'à 3 scénarios (sites différents, ou même site à des dates différentes), tableau, radar, chronologie, les 9 régions candidates Artemis |
| Énergie | Pré-dimensionnement d'une base : stockage pour passer la plus longue nuit, solaire, fission, hybride |
| Données | Provenance de chaque fichier, catalogue des sources, **vérification en direct avec JPL Horizons** |

Français et anglais, mode daltonien (3 variantes), mode simplifié et mode expert, mode démonstration.

## D'où viennent les chiffres

Chaque valeur affichée porte une étiquette : **mesure**, **produit dérivé**, **calculé**, **modèle**,
**estimation** ou **hypothèse**.

- **Calculé par l'application** : positions du Soleil et de la Terre (Astronomy Engine, écart mesuré avec
  JPL Horizons : moins de 0,005° en élévation et en azimut ramené sur le ciel, sur 4 sites et 296 instants de 2026 à 2031), horizon du relief LOLA avec la courbure de la Lune,
  fenêtres d'ensoleillement et de liaison. Détail : `docs/VALIDATION.md`.
- **Données NASA embarquées** (≈ 160 Mo, dans `public/data/`) : relief LOLA, ensoleillement moyen, visibilité
  moyenne de la Terre et ombres permanentes (NASA PGDA, Mazarico et al. 2011), températures Diviner
  (Williams et al. 2019), composition et hydrogène Lunar Prospector, noms UAI. Sources, traitements et
  empreintes : `public/data/manifest.json`, lisible dans l'écran « Données ».
- **Modèle** : la température instantanée (bilan radiatif simplifié), le pré-dimensionnement énergétique.
- **Hypothèses de l'équipe** : la matrice de notes des 9 régions et les ordres de grandeur du cahier des
  charges. Ce n'est **pas** un classement de la NASA. L'application les affiche à côté de ses propres calculs.

Les 9 régions sont des **régions candidates** annoncées par la NASA le 28 octobre 2024 pour Artemis III,
pas des sites confirmés. Depuis le 27 février 2026, Artemis III est un vol d'essai en orbite terrestre :
le premier alunissage habité est prévu avec Artemis IV (début 2028), qui garde ces mêmes régions. Leurs
contours ont été relevés sur la carte publiée par la NASA, à 1 ou 2 km près.

## Recherche en direct dans les données de la NASA

- **Oui pour les éphémérides** : avec le serveur local (`LANCER.bat`), l'écran « Données » interroge
  JPL Horizons en direct et compare ses résultats au calcul local, pour le site et la date choisis.
- **Non pour les cartes** (relief, illumination, températures) : la NASA les publie en gros fichiers
  d'archive, pas par une API interrogeable point par point. Elles sont donc embarquées, ce qui permet aussi
  de travailler sans réseau.

## Documentation

- `docs/ARCHITECTURE.md` : modules, référentiel de coordonnées, contrats.
- `docs/VALIDATION.md` : méthodes de calcul et contrôles chiffrés.
- `docs/RAPPORT.md` : ce qui est fait, ce qui ne l'est pas, tests exécutés, limites.
- `tools/` : scripts qui reconstruisent `public/data/` à partir des fichiers sources de la NASA.

## Modifier

Pas de compilation : ce sont des modules JavaScript servis tels quels. Modifiez un fichier dans `public/`,
rechargez la page. L'équipe (fenêtre « À propos ») se règle dans `public/js/data/team.js`.

Projet de hackathon indépendant, non affilié à la NASA.
