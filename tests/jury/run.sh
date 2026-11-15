#!/bin/bash
# Tests « jury » : vrais clics, clavier, molette et glisser dans un Chromium sans écran, sous le verrou navigateur.
#
#   1. serveur :  node server.mjs --port 8231 --no-open        (ou JURY_URL=http://127.0.0.1:<port>/)
#   2. un script : tests/jury/run.sh 01-objectifs.mjs [arguments]
#
#   00-explore.mjs             inventaire des contrôles (1440×900)
#   01-objectifs.mjs           objectifs 1, 2, 5, 7 du défi + tutoriel
#   01b-objectifs-suite.mjs    objectifs 3, 4, 6, clic sur le globe, scénarios (a) +2 mois et (b) site déplacé
#   02-calques-coherence.mjs   calques un par un (légende), cohérence fiche / carte / barre de temps / Comparer
#   03-boutons-fenetres.mjs    en-tête, recherche, réglages, Énergie, Données + JPL Horizons, Import, Historique, À propos, Mesure
#   04-cas-tordus.mjs          hors disque, zooms, dates 1900–2199, 1 000 000×, site Nord, redimensionnement, rechargement, Démo 60 s
#   05-responsive.mjs L H lang parcours complet à une taille et une langue (ex. 390 844 fr ; 1024 700 en)
#   06-serveur-coupe.mjs       lance son propre serveur (port 8233), le coupe en cours d'usage, le relance
#   07-verifs-ciblees.mjs      curseur d'opacité, 4e scénario, focus clavier, 9 régions, fluidité à 1 000 000×
#   08-recontrole-final.mjs    rejoue en une fois les défauts relevés (à lancer après correction)
#   i18n-cles.mjs              contrôle statique des dictionnaires (Node seul : node tests/jury/i18n-cles.mjs)
#
#   JURY_ONLY=M1,M2 (scripts 03, 07, 08) : ne rejouer que certaines étapes.
#   Captures : tests/.out/jury-*.png — journaux : tests/jury/out/
cd "$(dirname "$0")/../.." || exit 1
D=/home/codex/.cache/paintseed-browser-deps/unpacked
s="$1"; shift
exec flock .dev/browser.lock env LD_LIBRARY_PATH=$D/usr/lib/x86_64-linux-gnu:$D/lib/x86_64-linux-gnu node "tests/jury/$s" "$@"
