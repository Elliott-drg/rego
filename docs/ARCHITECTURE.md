# Regolith Finder — architecture et contrats entre modules

Application web locale (hackathon NASA « pôle Sud lunaire ») : comparer vite des sites et des dates
d'atterrissage, en montrant le Soleil et la Terre par rapport à l'horizon réel, pour juger l'énergie
solaire et les fenêtres de communication directe avec la Terre.

Sans étape de compilation : modules ES natifs servis tels quels (`public/`). Aucune ressource chargée
depuis Internet à l'exécution (pas de CDN). Bibliothèques embarquées : `vendor/three.module.js`,
`vendor/OrbitControls.js`, `vendor/astronomy.js` (Astronomy Engine). Import de three : `import * as THREE from 'three'`
(importmap dans `index.html`).

## Règles non négociables

1. **Ne jamais inventer de données.** Une valeur est mesurée, dérivée, calculée, modélisée, estimée ou
   hypothétique, et l'interface le dit avec `provTag(kind)` (`ui/dom.js`). Donnée absente = « — » + `provTag('missing')`.
2. Les notes et pourcentages du cahier des charges de l'équipe (`data/reference.js`) sont des
   **hypothèses**, jamais un « classement officiel NASA ». Les 9 régions Artemis III sont des **régions
   candidates** (annonce NASA du 28/10/2024), pas des sites confirmés ; leurs coordonnées sont approximatives.
3. **Une seule conversion de coordonnées** : `core/coords.js`. Ne jamais réécrire lat/lon → x,y,z ailleurs.
4. **Toutes les chaînes visibles passent par `t()`** (`core/i18n.js`), en français ET en anglais, dans un
   fichier `js/i18n/<module>.js` qui appelle `register({fr:{…}, en:{…}})`. Préfixe de clés = nom du module.
   Français soigné (accents, « », espaces avant `: ; ? ! %`), anglais naturel. Les nombres passent par
   `num()`, `pct()`, `deg()`, `temp()`, `duration()`, `dateUTC()`, `meters()` (formats selon la langue).
5. **La couleur n'est jamais le seul repère** (mode daltonien) : texte, forme, motif ou étiquette en plus.
   Couleurs de données via `layers/palettes.js` (`cat(name, state.cvd)`, `lut()`, `cssGradient()`), jamais en dur.
6. L'interface n'appelle pas directement les sources : elle passe par `science/engine.js` et `data/*`.
7. Ne modifier que SES fichiers (voir « Répartition »). Besoin d'un changement dans un fichier commun :
   le noter dans son rapport final, ne pas le faire.
8. Ne déclarer « fait » que ce qui a été exécuté. Le rapport final distingue : testé / écrit non testé / non fait.

## Arborescence

```
server.mjs                 serveur local sans dépendance (statique + /api/*), facultatif
public/index.html          coquille : #header #left #main(#view-map2d #view-globe #view-compare #main-overlays) #right #timebar
public/css/base.css        système visuel commun (variables, .btn .seg .card .kv .stat .tag .table .note .modal …)
public/css/<module>.css    styles propres à un module (déjà liés dans index.html : shell, map2d, globe, timebar, compare, energy, datacenter, tools)
public/js/main.js          démarrage, chargement des données, bascule des vues
public/js/core/            store.js (état + bus), i18n.js, coords.js
public/js/science/         ephemeris.js, terrain.js, horizon.js, sitecalc.js, thermal.js, scoring.js, engine.js (+ energy.js)
public/js/data/            registry.js (données embarquées), sites.js, reference.js (+ catalog.js, connectors/, cache.js)
public/js/layers/          manager.js (calques), palettes.js
public/js/views/           map2d.js, globe3d.js, viewcube.js, skyview.js, charts.js
public/js/ui/              dom.js, icons.js, modal.js, shell.js (en-tête, panneaux gauche et droit), timebar.js, compare.js, energy.js, datacenter.js, importer.js, measure.js, modals.js, demo.js
public/js/i18n/            core.js + un fichier par module
public/data/               rasters et tables (voir registry.js et manifest.json)
tests/                     tests node et navigateur (tests/browser.mjs)
```

## Référentiel (core/coords.js)

- Repère lunaire fixe ME : +Z pôle Nord, +X longitude 0°, +Y 90°E. Longitudes Est positives, [-180, 180].
  R = 1 737 400 m. Hauteurs en m au-dessus de cette sphère.
- Three.js : `meToThree([x,y,z], r)` → Y_three = Z_lune (Nord en haut), X_three = Y_lune, Z_three = X_lune.
  `latLonToThree(lat, lon, r)`, `threeToLatLon(x,y,z)`.
- Carte polaire Sud (grille des rasters `sp_*`, 3812×3812, 240 m/px, lon 0 vers le HAUT, 90°E à DROITE) :
  `spXYFromLatLon(lat, lon)` → mètres carte ; pixel (col c, ligne r) : `x = (c − 1905.5)·240`, `y = (1905.5 − r)·240`.
  `spLatLonFromXY`, `spScaleFactor(lat)`, `spXYFromUnit(n)`.
- Azimut : depuis le Nord, vers l'Est (0–360°). Élévation : au-dessus du plan horizontal local.

## État et bus (core/store.js)

`state` (lecture seule) ; `set({clé: valeur})` ; `on('change:clé', (v, old) => …)` ; `on('change', keys => …)` ;
`emit(evt, data)` ; `select(sel)` ; `addToCompare(sel, dateMs)` ; `removeFromCompare(i)` ; `setParam(name, v)` ; `toast(msg, kind)`.

| clé | valeurs |
|---|---|
| `lang` | `'fr'` \| `'en'` |
| `cvd` | `'none'` \| `'deuteranopia'` \| `'protanopia'` \| `'tritanopia'` |
| `mode` | `'simple'` \| `'expert'` (CSS : `.expert-only`, `.simple-only`) |
| `view` | `'map2d'` \| `'globe'` \| `'compare'` |
| `timeMs` | date courante simulée (ms UTC) |
| `playing`, `speed` | lecture ; `speed` = secondes simulées par seconde réelle (1, 10, 100, 1 000, 10 000, 100 000, 1 000 000) |
| `timeScale` | `'lunarDay'` \| `'year'` \| `'decade'` : étendue de la barre de temps |
| `selection` | `null` ou `{key, name, lat, lon, kind, siteId?}` ; kind ∈ artemis, historic, mission, feature, point, import |
| `hover` | `null` ou `{lat, lon}` |
| `compare` | ≤ 3 scénarios `{key, name, lat, lon, kind, siteId?, dateMs|null}` (`dateMs` null = date courante) |
| `params` | `{mastM, earthMarginDeg, slopeLimitDeg, landingRadiusM}` |
| `tool`, `measure` | `'measure'` ou null ; points `{lat, lon}` |
| `imports` | `[{id, name, color, features:[{type:'point'|'line'|'polygon', coords:[[lat,lon],…], name?, props?}]}]` |
| `server`, `online` | serveur local Node présent ; navigateur en ligne |

Événements libres : `layers:change` (id), `data:ready` (id), `data:progress`, `sites:ready`, `toast`,
`view:flyTo` `{lat, lon, zoom?}` (les vues doivent y répondre ; `zoom` = mètres par pixel pour la carte 2D), `view:snapshot`.

## Moteur scientifique (science/engine.js) — tout est synchrone et mémoïsé

- `pointInfo(lat, lon)` → `{polar, heightM, heightSource, slopeDeg, aspectDeg, sunAvgPct, earthAvgPct, psr, tmaxK, tminK, tavgK, lpgrs}` (NaN si absent).
- `siteNow(site, timeMs?)` → `{sun:{az, el, radiusDeg, horizonDeg, aboveDeg, fraction}, earth:{az, el, radiusDeg, horizonDeg, aboveDeg, visible, fraction}, horizon:{elev:Float32Array(720), n, siteHeightM, terrain}, sunVec, earthVec}`.
- `siteTransitions(site, timeMs?)` → `{sun:{now, nextMs}, earth:{now, nextMs}}` (prochain lever/coucher).
- `siteWindow(site, span, timeMs?)` avec span = `'lunarDay'` (29,53 j à partir de 00:00 UTC du jour de la date) \| `'year'` (année civile) \| `'decade'` \| nombre de jours
  → `{t0Ms, spanMs, series:{t0Ms, stepMs, n, sunEl, sunAz, sunFrac, earthEl, earthAz, earthAbove, earthVis, cosInc}, metrics, temps:Float32Array}`.
  Les durées `longestNightH`, `longestDayH`, `longestBlackoutH`, `longestContactH` sont réelles (prolongées hors période) ; `…Censored` = aucune fin trouvée en 400 j.
  `metrics` : `sunPct, sunDiscPct, powerVerticalPct, powerHorizontalPct, sunElMax, sunElMeanLit, longestNightH, longestDayH, earthPct, earthElMax, longestBlackoutH, longestContactH, bothPct, longestBothH, nightCensored, blackoutCensored`.
- `siteTemperatureNow(site, timeMs?)` (K, **modèle**), `valueAt(win, array, timeMs)`, `terrainAround(site)` → `{stats:{meanDeg, maxDeg, fracBelow, areaKm2, areaBelowKm2, hMin, hMax, hMean}, psrFrac}`.
- `runs(series, i => bool)` → intervalles `[t0, t1]` (ms) pour les bandes de temps.
- Plus bas niveau : `ephemeris.js` (`subPoints(date)`, `bodiesInMoonFrame`, `sunEarthAt`), `terrain.js` (`heightAt`, `slopeAt`, `elevationProfile`),
  `horizon.js` (`computeHorizon`, `horizonAt`), `scoring.js` (`weightedScore`, `referenceNotes`, `computedNotes`, `getWeights`, `setWeights`).
- Précision vérifiée : Soleil/Terre à moins de 0,005° de JPL Horizons en élévation et en azimut ramené sur le ciel (`tests/ephemeris-vs-horizons.mjs`, `docs/VALIDATION.md`).
- Coût : première série d'un an ≈ 0,3 s (éphémérides), puis ≈ 20 ms par site ; horizon ≈ 20–40 ms par site.

## Données (data/registry.js)

`ensureData(id)` (Promise), `tryData(id)`, `dataLoaded(id)`, `dataAvailable(id)`, `getData(id)`, `samplePolar(id, lat, lon)`,
`sampleGlobalHeight(lat, lon)`, `sampleLpgrs(lat, lon)`. Jeux : `sp_dem` (Int16, ×0,5 m), `sp_sun_avg`/`sp_earth_avg`
(Uint8, v/2,5 = %, 255 = sans donnée), `sp_psr` (Uint8 0/1), `sp_tmax`/`sp_tmin`/`sp_tavg` (Uint16, K×10, 0 = sans donnée),
`global_ldem` (Int16 1440×720, m, ligne 0 = Nord, colonne 0 = −180°), `lpgrs` (JSON 5°), `features` (JSON), `artemis_regions`, `manifest`.
Textures du globe : `data/moon_color_4k.jpg`, `data/moon_color_2k.jpg` (équirectangulaire, colonne 0 = −180°).

## Calques (layers/manager.js)

`layers.all()`, `layers.active('map2d'|'globe')` (ordre du fond vers le dessus), `layers.get(id)`, `layers.toggle(id, on?)`,
`layers.setOpacity(id, v)`, `layers.move(id, ±1)`, événement `layers:change`. Chaque calque : `{id, group, kind, views, status,
source, palette?, range?, unit?, mask?, element?, on, opacity, order, available}`. Libellés : `t('layer.<id>')`, `t('layer.<id>.desc')`
(dictionnaire dans `i18n/layers.js`, tenu par l'intégrateur).

## Modules d'interface : signatures attendues par main.js / shell.js

| fichier | export |
|---|---|
| `views/map2d.js` | `createMap2D(container)` → `{setActive(on), resize(), flyTo(lat, lon, metersPerPx?), snapshot()}` |
| `views/globe3d.js` | `createGlobe(container)` → `{setActive(on), resize(), flyTo(lat, lon), snapshot()}` |
| `views/skyview.js` | `createSkyView(container, opts?)` → `{update(), destroy()}` (suit `state.selection` et `state.timeMs`) |
| `ui/timebar.js` | `mountTimebar(container)` |
| `ui/compare.js` | `mountCompare(container)` → `{setActive(on)}` |
| `ui/energy.js` | `openEnergy(selection?)` |
| `ui/datacenter.js` | `openDataCenter()` ; `data/connectors/horizons.js` : `verifyWithHorizons(site, timeMs)` |
| `ui/importer.js` | `openImporter()` |
| `ui/measure.js` | `mountMeasure(container)` |
| `ui/modals.js` | `openHistory()`, `openFounders()`, `openTutorial()` |
| `ui/demo.js` | `startDemo()`, `stopDemo()` |

## Style

Maquettes de référence : `/home/codex/harness/inbox/2026-11-15/image_1.webp`, `image_3.webp`, `image_4.webp` (interface type
« Luna Maps » sombre), `materiau.webp` (appli d'origine), `logo.webp`. Thème sombre bleu nuit, panneaux nets, contrôles compacts,
chiffres en police à chasse fixe (`.mono`). Réutiliser les classes de `base.css` avant d'en créer. Pas d'emoji, pas d'effets
gratuits. Lisible dès 360 px de large (les panneaux deviennent des tiroirs sous 980 px).

## Tests

- Node : `node tests/<fichier>.mjs` (les modules `science/*`, `core/coords.js` s'importent dans Node ; `store.js` a besoin de `localStorage` : voir `tests/site-metrics.mjs`).
- Navigateur (Chromium sans écran, WebGL logiciel, lent) — un seul test à la fois sur la machine, donc toujours sous verrou :
  ```
  D=/home/codex/.cache/paintseed-browser-deps/unpacked
  flock /home/codex/harness/projets/regolith-finder/.dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node tests/<fichier>.browser.mjs
  ```
  `tests/browser.mjs` fournit `serveStatic()`, `openPage(url)` (collecte des erreurs console/réseau) et `OUT` (captures dans `tests/.out/`).
  Regarder ses captures d'écran (outil Read sur le PNG) avant de dire qu'un écran est bon.
- Machine partagée (7,6 Go de RAM) : pas de traitement lourd en parallèle, ne tuer aucun processus qui n'est pas le sien.
