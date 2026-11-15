# Méthodes de calcul et validation

Tous les contrôles ci-dessous se relancent depuis la racine du projet. Les chiffres sont ceux obtenus le
15 novembre 2026.

## 1. Position du Soleil et de la Terre vues d'un site

**Méthode** (`public/js/science/ephemeris.js`)

1. Positions géocentriques du Soleil et de la Lune en équatorial J2000 : Astronomy Engine 2.1.19
   (VSOP87 et théorie lunaire), aberration du Soleil incluse.
2. Orientation de la Lune : modèle de rotation de l'UAI (pôle + angle du méridien origine, librations
   physiques principales), fourni par `RotationAxis(Body.Moon)`. On en tire les trois axes du repère
   lunaire fixe, proche du repère « Mean Earth / Polar Axis » des cartes LOLA.
3. Les vecteurs Lune → Soleil et Lune → Terre sont exprimés dans ce repère, puis vus depuis le site
   (rayon 1 737,4 km + altitude LOLA + hauteur du mât). Azimut depuis le Nord vers l'Est, élévation
   au-dessus du plan horizontal local. Pas de réfraction : la Lune n'a pas d'atmosphère.

**Contrôle contre JPL Horizons** (DE441, observateur à la surface de la Lune, site 85,99°S 2,9°O, 4 km
d'altitude, 7 dates du 15/11 au 15/12/2026) : `node tests/ephemeris-vs-horizons.mjs`

| Contrôle | Azimut brut | Azimut ramené sur le ciel | Élévation |
|---|---|---|---|
| Site du test (7 dates, `tests/ephemeris-vs-horizons.mjs`) | 0,004° | — | 0,002° |
| Relecture indépendante : Apollo 11, crête de Shackleton, Chang'e 4, 2028-2031, 42 points (`tests/review/horizons-other-sites.mjs`) | 0,009° | 0,003° | 0,003° |
| Par le serveur local : 4 sites, 296 instants de 2026 à 2031 (`node tests/server.test.mjs`) | 0,036° | 0,004° | 0,005° |

À retenir : **moins de 0,005° en élévation et en azimut ramené sur le ciel**. L'azimut brut peut s'écarter
jusqu'à 0,04° quand l'astre est presque au zénith (Apollo 11, Soleil à 88°) : à cette hauteur un petit
déplacement sur le ciel fait tourner l'azimut de beaucoup, c'est pourquoi on le multiplie par le cosinus
de l'élévation. Le disque solaire fait 0,53° : l'erreur est 100 fois plus petite que lui.
L'écran « Données → Vérification
en direct » refait cette comparaison pour n'importe quel site et n'importe quelle date (serveur local requis).

## 2. Horizon du relief

**Méthode** (`public/js/science/horizon.js`)

Pour 720 azimuts (pas de 0,5°), on avance le long du grand cercle : pas de 120 m près du site, croissant
jusqu'à 480 m, jusqu'à 330 km. À chaque pas on lit la hauteur LOLA (bilinéaire, MNT `LDEM_75S_240M`) et on
calcule l'angle exact entre le site (rayon r₁) et le point de relief (rayon r₂) séparés d'un angle au
centre θ :

    tan(élévation) = (r₂·cos θ − r₁) / (r₂·sin θ)

La courbure de la Lune est donc prise en compte sans approximation. On garde le maximum par azimut.
Hors du MNT (au nord de 75°S) : horizon de la sphère lisse, signalé dans l'interface.

- **Soleil** : le disque (rayon apparent ≈ 0,266°) est découpé en 9 bandes verticales, chacune comparée à
  l'horizon de son propre azimut. On obtient la part du disque visible, de 0 à 1.
- **Terre** : visible si son centre dépasse l'horizon de la marge choisie (0° par défaut, réglable).

## 3. Fenêtres d'ensoleillement et de liaison : contrôle contre les cartes de la NASA

Les cartes « Lunar Polar Illumination » du NASA PGDA (Mazarico et al., 2011) donnent, pour chaque pixel,
la part moyenne du disque solaire visible et la visibilité moyenne de la Terre sur un cycle de 18,6 ans.
Elles ont été calculées par une autre équipe, avec un autre code. On compare nos valeurs, calculées sur
deux ans (2026-2027), en 150 points tirés au hasard entre 84°S et 90°S : `node tests/validation-pgda.mjs`

| Indicateur | Corrélation | Écart absolu moyen | Biais |
|---|---|---|---|
| Soleil : part moyenne du disque visible | 0,996 | 1,1 point | −0,8 point |
| Terre : une partie du disque visible | 0,994 | 1,9 point | −1,1 point |
| Terre : centre au-dessus de l'horizon (critère de l'application) | 0,983 | 5,4 points | −5,4 points |

Lecture : notre calcul reproduit les cartes de la NASA à un ou deux points de pourcentage près. La
dernière ligne montre l'effet du critère plus sévère retenu pour les communications (le centre de la
Terre doit être dégagé, pas seulement son bord).

Limites de cette comparaison :

- deux ans contre 18,6 ans, MNT à 240 m ici contre 120 m pour les cartes PGDA ;
- l'étiquette du produit PGDA décrit la carte solaire de deux façons (« part des pas de temps éclairés par
  une fraction quelconque du disque » et « visibilité moyenne du disque ») ; nos deux indicateurs s'en
  écartent chacun d'environ 1 point, la comparaison ne les départage pas ;
- **le contrôle est fait au sol (mât de 0 m), sur des points pris au hasard.** Dans l'application, le calcul
  se fait par défaut à 2 m au-dessus du sol (hauteur du mât, réglable). Aux points les mieux éclairés des
  régions candidates, ces 2 m suffisent à dépasser la carte PGDA de 12 points en moyenne, jusqu'à 18
  (`node tests/review/best-points-bias.mjs`) : sur une crête, l'horizon se joue à moins de 250 m, sous la
  résolution du relief. Ces chiffres « au mât » sont donc optimistes sur les crêtes ; la fiche affiche la
  valeur PGDA au sol à côté.

Contrôle hors pôle (`node tests/engine.test.mjs`), site d'Apollo 11, année 2026 : Soleil visible 51 % du
temps, plus longue nuit 14,8 jours, Terre toujours visible. Valeurs attendues : 50 %, 14,77 jours, 100 %.

## 4. Les points favorables des régions candidates

Pour chaque région Artemis III, l'application propose trois points : le mieux éclairé, celui d'où la Terre
est le plus souvent visible, et le meilleur compromis (produit des deux), choisis sur les cartes PGDA parmi
les pixels de pente inférieure au seuil d'atterrissage. Le centre géométrique d'une région est souvent un
mauvais point : `node tests/region-best.mjs` (année 2027).

| Région | Soleil visible, centre → compromis | Terre visible, centre → compromis |
|---|---|---|
| Peak near Cabeus B | 31 % → 60 % | 0 % → 82 % |
| Haworth | 17 % → 54 % | 38 % → 72 % |
| Malapert Massif | 31 % → 55 % | 24 % → 100 % |
| Mons Mouton Plateau | 34 % → 56 % | 73 % → 100 % |
| Mons Mouton | 26 % → 53 % | 40 % → 100 % |
| Nobile Rim 1 | 34 % → 51 % | 47 % → 78 % |
| Nobile Rim 2 | 41 % → 48 % | 64 % → 83 % |
| de Gerlache Rim 2 | 37 % → 64 % | 50 % → 53 % |
| Slater Plain | 5 % → 68 % | 34 % → 43 % |

C'est l'illustration chiffrée de la remarque du défi : quelques kilomètres changent tout.

**Plus longue nuit, plus longue coupure.** Ces durées sont celles des séquences entières qui touchent la
période étudiée : une nuit commencée avant le début de la période est comptée en entier (sinon une
période qui débute en pleine nuit la couperait en deux). La recherche s'arrête à 400 jours de part et
d'autre ; au-delà, l'interface affiche « plus de 400 j » (ombre ou coupure permanente à cette échelle).
Contrôle : au site d'Apollo 11, la nuit vaut 14,7 jours quel que soit le jour où commence la période
(`node tests/engine.test.mjs`).

**Prochain lever ou coucher.** Recherche au pas d'une heure, puis instant affiné à la seconde. Un passage
de moins d'une heure entre deux échantillons peut être manqué ; un liseré de Soleil de 0,2 % du disque
compte comme un lever.

## 5. Pente

`terrain.slopeAt` : différences centrées de la hauteur au-dessus de la sphère, sur une base de 240 m, dans
le repère local Est/Nord (facteur d'échelle de la projection corrigé). C'est la pente par rapport à la
verticale locale. Elle est mesurée à l'échelle de 240 m : un atterrisseur est sensible à des pentes plus
locales, que ce MNT ne voit pas.

## 6. Température instantanée (modèle)

`thermal.js` : bilan radiatif d'une couche de surface,

    C · dT/dt = (1 − A) · S · f · cos(i) − ε · σ · T⁴

avec A = 0,12, ε = 0,95, S = 1 361 W/m², f = part du disque solaire visible (horizon réel), i = incidence
sur la pente locale, C = 1,5·10⁵ J/m²/K. Plancher : température minimale Diviner du pixel quand elle
existe, sinon 25 K. C est réglé pour qu'une nuit équatoriale refroidisse vers 90 K : au site d'Apollo 11
le modèle donne 88 à 386 K sur l'année (mesures Diviner à l'équateur : environ 95 à 390 K).

Ce n'est pas une mesure : pas de conduction en profondeur, pas de lumière ni de chaleur renvoyées par le
relief voisin. Conséquence : en ombre permanente le modèle reste à son plancher (fond de Shackleton :
37 K constants, alors que Diviner y mesure jusqu'à 96 K). La constante solaire est fixe (la variation
annuelle de ±3,4 % n'est pas appliquée). Les cartes Diviner (maximum, minimum, moyenne) affichées à côté sont, elles, des mesures.

## 7. Notes

`scoring.js` : score = Σ poids × note / Σ poids. Le cahier des charges de l'équipe donne des notes par
critère et un score global, sans formule. Une moyenne simple ne redonne pas ses scores (écart jusqu'à
0,25). Les poids par défaut (communications 15, énergie 25, radiation 5, atterrissage 24, eau 19, autres
ISRU 12), ajustés par moindres carrés, les redonnent à 0,03 près. Ils sont modifiables.

Les « notes calculées » viennent des indicateurs ci-dessus par des règles simples écrites dans
`scoring.js`. Radiation et « autres ISRU » ne sont pas calculables avec les données embarquées : la
note de référence est reprise et étiquetée « hypothèse ».
