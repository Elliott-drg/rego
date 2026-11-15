#!/usr/bin/env bash
# Télécharge toutes les sources publiques (sans clé ni compte) dans tools/raw/.
# IPv4 forcé. Relançable : un fichier déjà présent n'est pas retéléchargé.
# Le logo et la carte Artemis viennent de l'inbox du propriétaire (copie locale, pas de réseau).
set -euo pipefail
cd "$(dirname "$0")/raw"
get() { # get <dossier> <url> [nom]
  local d="$1" u="$2" n="${3:-$(basename "$2")}"
  mkdir -p "$d"
  [ -s "$d/$n" ] || { echo "-> $d/$n"; curl -4 -fsS --retry 3 -m 3000 -o "$d/$n.part" "$u" && mv "$d/$n.part" "$d/$n"; }
}

# 1. LOLA GDR (grille de référence), copie canonique identique à pds-geosciences
get . http://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG ldem_75s_240m.img
get . http://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.LBL ldem_75s_240m.lbl

# 2. PGDA / LOLA « Lunar Polar Illumination » (Mazarico et al. 2011)
for f in AVGVISIB_75S_120M_201608 AVGVISIB_75S_120M_201608_EARTH LPSR_75S_120M_201608; do
  get illum http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/$f.LBL
  get illum http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/$f.IMG
done

# 3. Diviner, températures polaires saisonnières (Williams et al. 2019), serveur UCLA.
#    Le serveur n'envoie pas sa chaîne de certificats intermédiaires et propose un échange DH
#    trop faible : on reconstruit la chaîne depuis les URL « CA Issuers » des certificats, on la
#    VÉRIFIE contre les racines du système (pas de -k), et on exclut les suites DHE.
mkdir -p diviner
if [ ! -s diviner/ucla-ca-bundle.pem ]; then
  t=$(mktemp -d)
  curl -4 -fsS --retry 5 -m 30 -o "$t/i.crt" http://repository.emsign.com/certs/EEEMIncommonOVG2C.crt
  curl -4 -fsS --retry 5 -m 30 -o "$t/c.p7c" http://repository.emsign.com/certs/EMIncommonOVG2C.p7c
  openssl x509 -inform DER -in "$t/i.crt" -out "$t/i.pem"
  openssl pkcs7 -inform DER -in "$t/c.p7c" -print_certs -out "$t/c.pem"
  echo | openssl s_client -4 -connect luna1.diviner.ucla.edu:443 -servername luna1.diviner.ucla.edu 2>/dev/null | openssl x509 > "$t/leaf.pem"
  cat "$t/i.pem" "$t/c.pem" > "$t/extra.pem"
  openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted "$t/extra.pem" "$t/leaf.pem"
  cat /etc/ssl/certs/ca-certificates.crt "$t/extra.pem" > diviner/ucla-ca-bundle.pem
  rm -rf "$t"
fi
U=https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar
ucla() { [ -s "diviner/$2" ] || { echo "-> diviner/$2"; curl -4 -fsS --retry 3 -m 900 --cacert diviner/ucla-ca-bundle.pem --ciphers 'DEFAULT:!DHE:!DH' -o "diviner/$2.part" "$1" && mv "diviner/$2.part" "diviner/$2"; }; }
ucla $U/aareadme.txt aareadme_level4_polar.txt
for s in summer winter; do for k in max min avg; do
  ucla $U/additional_maps/polar_south_80_${s}_${k}-float.tif polar_south_80_${s}_${k}-float.tif
done; done
# Recoupement seulement (Schorghofer & Williams 2020), non livré :
ucla $U/24x6_240m/additional_maps/aareadme.txt aareadme_24x6_additional.txt
ucla $U/24x6_240m/additional_maps/polar_south_80_Tmax.grd polar_south_80_Tmax.grd
ucla $U/24x6_240m/additional_maps/polar_south_80_Tmean.grd polar_south_80_Tmean.grd

# 4. NASA SVS CGI Moon Kit (id 4720)
S=https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720
get svs $S/lroc_color_poles_4k.tif
get svs $S/ldem_4.tif
get svs $S/ldem_4_uint.tif
get svs https://svs.gsfc.nasa.gov/4720 svs4720.html

# 5. Lunar Prospector : GRS 5 deg (PDS) et hydrogène 0,5 deg (produit spécial)
L=https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001
get lp $L/data/lpgrs_high1_elem_abundance_5deg.tab
get lp $L/data/lpgrs_high1_elem_abundance_5deg.lbl
get lp $L/data/lpgrs_elem_abundance.fmt
get lp $L/aareadme.txt
get lp https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html
get lp https://pds-geosciences.wustl.edu/missions/lunarp/reduced/hydrogenhd.txt
get lp https://pds-geosciences.wustl.edu/missions/lunarp/reduced/hydrogenhd.dat

# 6. Nomenclature IAU (USGS)
get iau https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip
[ -s iau/MOON_nomenclature_center_pts.dbf ] || (cd iau && unzip -o -q MOON_nomenclature_center_pts.zip)

# 7. Bibliothèques (paquets npm officiels)
mkdir -p npm
[ -s npm/three-0.170.0.tgz ] || (cd npm && npm pack three@0.170.0 --silent)
[ -s npm/astronomy-engine-2.1.19.tgz ] || (cd npm && npm pack astronomy-engine@2.1.19 --silent)
[ -d npm/three/package ] || (mkdir -p npm/three && tar -xzf npm/three-0.170.0.tgz -C npm/three)
[ -d npm/astro/package ] || (mkdir -p npm/astro && tar -xzf npm/astronomy-engine-2.1.19.tgz -C npm/astro)
get npm https://raw.githubusercontent.com/cosinekitty/astronomy/master/LICENSE astronomy-LICENSE

# 8. Fichiers fournis par le propriétaire
I=/home/codex/harness/inbox/2026-11-15
mkdir -p artemis assets
[ -s artemis/site-atterrissage.webp ] || cp "$I/site-atterrissage.webp" artemis/
[ -s assets/logo.webp ] || cp "$I/logo.webp" assets/
echo "tools/raw complet"
