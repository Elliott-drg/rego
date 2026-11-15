#!/usr/bin/env python3
"""Écrit public/data/manifest.json : provenance, empreintes et conventions de chaque fichier livré.

Les métadonnées descriptives sont ci-dessous ; taille, sha256 et empreintes des sources sont
recalculées à chaque exécution. Un fichier décrit mais absent fait échouer le script.
"""
import hashlib
import json
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import CHECK, DATA, RAW, ROOT

RETRIEVED = "2026-11-15"  # date UTC des téléchargements (tools/fetch_raw.sh)

GRID = ("Stéréographique polaire sud sphérique, R = 1737,4 km, échelle vraie au pôle, centre lat -90, "
        "lon 0 vers le haut de l'image, est positif (repère Mean Earth / Polar Axis, DE421). Grille 3812 x 3812, "
        "240 m/px, ligne par ligne depuis le haut. Pixel 0-based (col c, ligne r) : x = (c - 1905.5) * 240 m, "
        "y = (1905.5 - r) * 240 m ; x = rho sin(lon), y = rho cos(lon), rho = 2 R tan((90 + lat) / 2).")
EQC = ("Équirectangulaire (plate carrée) globale, ligne 0 = +90 deg, colonne 0 = lon -180 deg, centre = lon 0 "
       "(face visible), est positif vers la droite. Centre du pixel (c, r) : lon = -180 + (c + 0.5) * 360 / W, "
       "lat = 90 - (r + 0.5) * 180 / H.")
PD_NASA = ("Données NASA du domaine public (PDS) ; citer la source. https://pds.nasa.gov/datastandards/"
           "citing/ ")
CIT_MAZ = ("Mazarico, E., G. A. Neumann, D. E. Smith, M. T. Zuber, M. H. Torrence (2011), Illumination conditions "
           "of the lunar polar regions using LOLA topography, Icarus, 211, 1066-1081, "
           "doi:10.1016/j.icarus.2010.10.030.")
CIT_WIL = ("Williams, J.-P., B. T. Greenhagen, D. A. Paige, N. Schorghofer, E. Sefton-Nash, P. O. Hayne, "
           "P. G. Lucey, M. A. Siegler, K.-M. Aye (2019), Seasonal polar temperatures on the Moon, "
           "J. Geophys. Res. Planets, 124, 2505-2521, doi:10.1029/2019JE006028.")
ILLUM_URLS = lambda stem: [f"http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/{stem}.IMG",
                           f"http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/{stem}.LBL",
                           "https://pgda.gsfc.nasa.gov/products/69"]
DIV_URL = "https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/additional_maps/"
DIV_SRC = [f"diviner/polar_south_80_{s}_{k}-float.tif" for s in ("summer", "winter") for k in ("max", "min", "avg")]
DIV_COMMON = {
    "organism": "UCLA, équipe Diviner (LRO Diviner Lunar Radiometer Experiment) ; J.-P. Williams",
    "source_urls": [DIV_URL, "https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/aareadme.txt",
                    "https://www.diviner.ucla.edu/data"],
    "dtype": "uint16 little-endian", "shape": [3812, 3812], "units": "K",
    "encoding": "valeur = round(K x 10) ; 0 = sans donnée (hors couverture ou case sans mesure)",
    "projection": GRID, "resolution": "240 m/px (source : 240,036 m/px, 2533 x 2533, >= 80 deg S)",
    "citation": CIT_WIL,
    "license": "Données publiques de l'équipe Diviner (UCLA), sans compte ; l'équipe demande de citer "
               "Williams et al. (2019) pour les données polaires.",
}
DIV_LIM = ("Températures de brillance bolométriques mesurées (visée nadir, 5 juil. 2009 - 17 fév. 2019), "
           "compilées par saison (été / hiver = signe de la latitude subsolaire) : ce ne sont pas des "
           "températures physiques de sous-surface. Couverture : uniquement lat <= -80 deg (34,7 % de la grille), "
           "le reste vaut 0. Rééchantillonnage bilinéaire = lissage d'environ 2 x 2 px source (décalage d'un "
           "demi-pixel entre les deux grilles) : les extrêmes locaux sont légèrement atténués. 0,8 % des pixels "
           "ont un minimum inférieur à 20 K (minimum 9,3 K) et 11 pixels dépassent 400 K (maximum 415,1 K) : "
           "valeurs hors du domaine fiable de l'instrument, conservées telles quelles. 445 px ont tmin > tavg "
           "(cases où les voisins valides diffèrent d'une couche à l'autre). Recoupement indépendant avec "
           "Schorghofer & Williams (2020) : Tmax corrélation 0,987 (écart médian +1,0 K, RMS 8,6 K), Tmoy "
           "corrélation 0,995 (écart médian -0,2 K, RMS 3,2 K).")
DIV_TR = ("Lecture des GeoTIFF float32 (géotransformation et projection lues dans les tags : stéréographique "
          "polaire, lat origine -90, lon 0, R = 1737400 m, PixelIsArea). Rééchantillonnage bilinéaire vers la "
          "grille de référence, pondéré par les voisins valides (NaN ignorés ; sans donnée si poids valide < 0,5).")

FILES = [
    {"file": "sp_dem_240m.i16", "title": "Topographie LOLA du pôle Sud, 240 m (grille de référence)",
     "organism": "NASA GSFC, équipe LOLA (Lunar Reconnaissance Orbiter) ; PDS Geosciences Node",
     "product_id": "LDEM_75S_240M (LRO-L-LOLA-4-GDR-V1.0, version V2.0)",
     "source_urls": ["http://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG",
                     "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/"
                     "img/ldem_75s_240m.img"],
     "sources": ["ldem_75s_240m.img", "ldem_75s_240m.lbl"],
     "dtype": "int16 little-endian", "shape": [3812, 3812], "units": "m",
     "encoding": "hauteur (m) = DN x 0,5 par rapport à la sphère de 1737,4 km ; pas de valeur sans donnée",
     "projection": GRID, "resolution": "240 m/px",
     "transformations": "Aucune : copie octet pour octet de LDEM_75S_240M.IMG (fichier vérifié identique à la "
                        "copie du serveur LOLA imbrium.mit.edu).",
     "citation": "Smith, D. E., et al. (2010), The Lunar Orbiter Laser Altimeter investigation on the Lunar "
                 "Reconnaissance Orbiter mission, Space Sci. Rev., 150, 209-241, doi:10.1007/s11214-009-9512-y ; "
                 "Smith, D. E., et al. (2017), Summary of the results from the Lunar Orbiter Laser Altimeter "
                 "after seven years in lunar orbit, Icarus, 283, 70-91, doi:10.1016/j.icarus.2016.06.006.",
     "license": PD_NASA,
     "limitations": "Hauteur par rapport à une sphère, pas par rapport au géoïde. Les coins de l'image dépassent "
                    "75 deg S (jusqu'à ~69 deg S) ; interpolation entre traces LOLA loin du pôle."},
    {"file": "sp_sun_avg_240m.u8", "title": "Illumination solaire moyenne, pôle Sud",
     "organism": "NASA GSFC, PGDA / équipe LOLA (E. Mazarico)", "product_id": "AVGVISIB_75S_120M_201608",
     "source_urls": ILLUM_URLS("AVGVISIB_75S_120M_201608"),
     "sources": ["illum/AVGVISIB_75S_120M_201608.IMG", "illum/AVGVISIB_75S_120M_201608.LBL"],
     "dtype": "uint8", "shape": [3812, 3812], "units": "illumination solaire moyenne, de 0 à 1 (sans unité)",
     "encoding": "valeur = round(fraction x 250), 0-250 = 0-100 % ; 255 = sans donnée (aucun pixel concerné)",
     "projection": GRID, "resolution": "240 m/px (source 120 m/px)",
     "transformations": "DN int16 x 0,00004 (SCALING_FACTOR du label) = fraction ; moyenne des blocs 2 x 2 de "
                        "pixels de 120 m, exactement alignés sur la grille de 240 m (centre source 3811,5 px).",
     "citation": CIT_MAZ, "license": PD_NASA,
     "limitations": "Illumination solaire moyenne sur 18,6 ans, au sol (l'étiquette du produit la décrit à la fois "
                    "comme la part des pas de temps éclairés et comme la visibilité moyenne du disque) ; pas à "
                    "hauteur de mât. Calcul sur le DEM de 120 m : les pics très locaux sont lissés (maximum de la "
                    "carte 75 % après moyenne à 240 m). Moyenne à long terme, sans information de date."},
    {"file": "sp_earth_avg_240m.u8", "title": "Visibilité moyenne de la Terre, pôle Sud",
     "organism": "NASA GSFC, PGDA / équipe LOLA (E. Mazarico)", "product_id": "AVGVISIB_75S_120M_201608_EARTH",
     "source_urls": ILLUM_URLS("AVGVISIB_75S_120M_201608_EARTH"),
     "sources": ["illum/AVGVISIB_75S_120M_201608_EARTH.IMG", "illum/AVGVISIB_75S_120M_201608_EARTH.LBL"],
     "dtype": "uint8", "shape": [3812, 3812], "units": "visibilité moyenne de la Terre, de 0 à 1 (sans unité)",
     "encoding": "valeur = round(fraction x 250), 0-250 = 0-100 % ; 255 = sans donnée (aucun pixel concerné)",
     "projection": GRID, "resolution": "240 m/px (source 120 m/px)",
     "transformations": "Identiques à sp_sun_avg_240m.u8.",
     "citation": CIT_MAZ, "license": PD_NASA,
     "limitations": "Même définition que la carte solaire, pour la Terre : visible dès qu'une partie du disque "
                    "terrestre est dégagée, donc légèrement optimiste pour une liaison radio (note de la page "
                    "PGDA). Moyenne sur 18,6 ans, au sol, sans information de date."},
    {"file": "sp_psr_240m.u8", "title": "Régions en ombre permanente (PSR), pôle Sud",
     "organism": "NASA GSFC, PGDA / équipe LOLA (E. Mazarico)", "product_id": "LPSR_75S_120M_201608",
     "source_urls": ILLUM_URLS("LPSR_75S_120M_201608"),
     "sources": ["illum/LPSR_75S_120M_201608.IMG", "illum/LPSR_75S_120M_201608.LBL"],
     "dtype": "uint8", "shape": [3812, 3812], "units": "booléen",
     "encoding": "1 = PSR (au moins 3 des 4 sous-pixels de 120 m en ombre permanente), 0 sinon ; pas de sans-donnée",
     "projection": GRID, "resolution": "240 m/px (source 120 m/px)",
     "transformations": "Source binaire (DN +20000 = PSR, -20000 = non, d'après le label ; ce n'est pas un "
                        "identifiant de PSR). Majorité stricte par bloc 2 x 2 aligné ; les 51 430 blocs à égalité "
                        "2/4 sont classés non-PSR.",
     "citation": CIT_MAZ, "license": PD_NASA,
     "limitations": "Ombre permanente vis-à-vis du Soleil direct seulement (lumière diffusée ignorée), d'après le "
                    "DEM de 120 m : les petites PSR (< ~250 m) sont absentes. 7 827 px classés PSR ont une "
                    "illumination moyenne non nulle dans sp_sun_avg (blocs à 3/4)."},
    dict(DIV_COMMON, file="sp_tmax_240m.u16", title="Température de brillance bolométrique maximale (Diviner), pôle Sud",
         product_id="polar_south_80_summer_max + polar_south_80_winter_max (Williams et al. 2019, cartes dérivées)",
         sources=[s for s in DIV_SRC if "_max" in s],
         transformations=DIV_TR + " Puis maximum pixel à pixel des cartes « été max » et « hiver max » "
                                  "(l'été l'emporte sur 95 % des pixels).",
         limitations="Définition : maximum, sur les deux saisons, de la température bolométrique maximale par "
                     "case de 240 m. " + DIV_LIM),
    dict(DIV_COMMON, file="sp_tmin_240m.u16", title="Température de brillance bolométrique minimale (Diviner), pôle Sud",
         product_id="polar_south_80_summer_min + polar_south_80_winter_min (Williams et al. 2019, cartes dérivées)",
         sources=[s for s in DIV_SRC if "_min" in s],
         transformations=DIV_TR + " Puis minimum pixel à pixel des cartes « été min » et « hiver min ».",
         limitations="Définition : minimum, sur les deux saisons, de la température bolométrique minimale par "
                     "case. " + DIV_LIM),
    dict(DIV_COMMON, file="sp_tavg_240m.u16", title="Température de brillance bolométrique moyenne (Diviner), pôle Sud",
         product_id="polar_south_80_summer_avg + polar_south_80_winter_avg (Williams et al. 2019, cartes dérivées)",
         sources=[s for s in DIV_SRC if "_avg" in s],
         transformations=DIV_TR + " Puis moyenne arithmétique des cartes « été moy » et « hiver moy » (les deux "
                                  "saisons couvrent chacune une demi-année ; sans donnée si l'une manque).",
         limitations="Définition : moyenne des deux moyennes saisonnières, approximation de la moyenne annuelle "
                     "(ce n'est pas une carte publiée telle quelle). " + DIV_LIM),
    {"file": "moon_color_4k.jpg", "title": "Carte globale en couleurs de la Lune (LROC WAC), 4096 x 2048",
     "organism": "NASA's Scientific Visualization Studio (E. Wright) ; données LROC (ASU) et LOLA",
     "product_id": "CGI Moon Kit, SVS id 4720, lroc_color_poles_4k.tif (carte couleur de 2019)",
     "source_urls": ["https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif",
                     "https://svs.gsfc.nasa.gov/4720"],
     "sources": ["svs/lroc_color_poles_4k.tif"],
     "dtype": "JPEG RGB 8 bits (qualité 88, 4:2:0)", "shape": [2048, 4096, 3], "units": "couleur sRGB (albédo)",
     "encoding": "image", "projection": EQC, "resolution": "4096 x 2048 (~11,4 px/deg, ~2,7 km/px à l'équateur)",
     "transformations": "Conversion TIFF RGB 8 bits -> JPEG qualité 88, sans rééchantillonnage ni retouche.",
     "citation": "NASA's Scientific Visualization Studio, CGI Moon Kit (2019), https://svs.gsfc.nasa.gov/4720.",
     "license": "Image NASA, libre d'utilisation avec crédit « NASA's Scientific Visualization Studio » "
                "(https://www.nasa.gov/nasa-brand-center/images-and-media/).",
     "limitations": "Mosaïque d'albédo conçue pour le rendu 3D, pas une mesure photométrique ; les pôles sont "
                    "complétés par un rendu (variante « poles »). Une carte couleur plus récente (déc. 2025) existe "
                    "sur la même page et n'est pas utilisée ici. Convention vérifiée par l'albédo de 4 mers et par "
                    "corrélation du relief (tools/check/global_convention.json)."},
    {"file": "moon_color_2k.jpg", "title": "Carte globale en couleurs de la Lune (LROC WAC), 2048 x 1024",
     "organism": "NASA's Scientific Visualization Studio (E. Wright) ; données LROC (ASU) et LOLA",
     "product_id": "CGI Moon Kit, SVS id 4720, lroc_color_poles_4k.tif (carte couleur de 2019)",
     "source_urls": ["https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif",
                     "https://svs.gsfc.nasa.gov/4720"],
     "sources": ["svs/lroc_color_poles_4k.tif"],
     "dtype": "JPEG RGB 8 bits (qualité 88, 4:2:0)", "shape": [1024, 2048, 3], "units": "couleur sRGB (albédo)",
     "encoding": "image", "projection": EQC, "resolution": "2048 x 1024 (~5,7 px/deg)",
     "transformations": "Réduction Lanczos de 4096 x 2048 à 2048 x 1024, puis JPEG qualité 88.",
     "citation": "NASA's Scientific Visualization Studio, CGI Moon Kit (2019), https://svs.gsfc.nasa.gov/4720.",
     "license": "Image NASA, libre d'utilisation avec crédit « NASA's Scientific Visualization Studio ».",
     "limitations": "Voir moon_color_4k.jpg."},
    {"file": "global_ldem_4ppd.i16", "title": "Relief global de la Lune (LOLA), 4 px/deg",
     "organism": "NASA's Scientific Visualization Studio ; données de l'équipe LOLA (LRO)",
     "product_id": "CGI Moon Kit, SVS id 4720, ldem_4.tif",
     "source_urls": ["https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4.tif",
                     "https://svs.gsfc.nasa.gov/4720"],
     "sources": ["svs/ldem_4.tif", "svs/ldem_4_uint.tif"],
     "dtype": "int16 little-endian", "shape": [720, 1440], "units": "m",
     "encoding": "hauteur en mètres par rapport à la sphère de 1737,4 km ; pas de sans-donnée ; "
                 "min -8878 m, max +10504 m",
     "projection": EQC, "resolution": "4 px/deg (0,25 deg, ~7,6 km à l'équateur)",
     "transformations": "ldem_4.tif (float32, km par rapport à 1737,4 km, d'après la page du kit) x 1000, arrondi "
                        "au mètre. Recoupé avec ldem_4_uint.tif (uint16, demi-mètres par rapport à 1 727 400 m) : "
                        "écart max 0,001 m.",
     "citation": "NASA's Scientific Visualization Studio, CGI Moon Kit (2019), https://svs.gsfc.nasa.gov/4720 ; "
                 "données LOLA : Smith et al. (2010, 2017).",
     "license": "Image NASA, libre d'utilisation avec crédit « NASA's Scientific Visualization Studio ».",
     "limitations": "Relief très lissé (0,25 deg) : pour l'affichage du globe seulement, pas pour un calcul "
                    "d'horizon. Corrélation avec le DEM polaire de 240 m sur les parallèles 80, 82 et 85 deg S : "
                    "0,999 (écart médian < 4 m)."},
    {"file": "lpgrs_5deg.json", "title": "Abondances élémentaires Lunar Prospector GRS, pixels de 5 deg",
     "organism": "NASA PDS Geosciences Node ; T. H. Prettyman (Planetary Science Institute)",
     "product_id": "LPGRS_HIGH1_ELEM_ABUNDANCE_5DEG (LP-L-GRS-5-ELEM-ABUNDANCE-V1.0)",
     "source_urls": ["https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/"
                     "lpgrs_high1_elem_abundance_5deg.tab",
                     "https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/"
                     "lpgrs_high1_elem_abundance_5deg.lbl"],
     "sources": ["lp/lpgrs_high1_elem_abundance_5deg.tab", "lp/lpgrs_high1_elem_abundance_5deg.lbl"],
     "dtype": "JSON", "shape": [1790], "units": "oxydes en % massique ; K, Th, U en ppm massiques",
     "encoding": "PAS une grille régulière 5 x 5 deg : 1790 cellules de surface égale (champ cells, avec latMin, "
                 "latMax, lonMin, lonMax) rangées du sud au nord ; grid.latBands donne pour chaque bande nLon et "
                 "l'index de sa première cellule. Champs par cellule : FeO, TiO2, Al2O3, CaO, SiO2, MgO, Th, K, U "
                 "et sFeO... = incertitude 1 sigma. nodata = null (aucune cellule vide).",
     "projection": "Cellules lat/lon de surface égale, longitudes est positives -180..180",
     "resolution": "~5 deg d'arc (~150 km) ; résolution spatiale réelle de l'instrument à 100 km d'altitude "
                   "~5 deg (label)",
     "transformations": "Lecture des colonnes 1-15 d'après le label ; oxydes : fraction massique (g/g) x 100 ; "
                        "K, Th, U inchangés (ppm) ; incertitudes = racine des termes diagonaux E[i,i] de la matrice "
                        "d'erreur ; arrondi à 4 chiffres significatifs. Aucune conversion élément -> oxyde (le "
                        "label fournit les oxydes).",
     "citation": "Prettyman, T. H., J. J. Hagerty, R. C. Elphic, W. C. Feldman, D. J. Lawrence, G. W. McKinney, "
                 "D. T. Vaniman (2006), Elemental composition of the lunar surface: Analysis of gamma ray "
                 "spectroscopy data from Lunar Prospector, J. Geophys. Res., 111, E12007, "
                 "doi:10.1029/2005JE002656.",
     "license": PD_NASA,
     "limitations": "Résolution ~150 km : une seule valeur pour toute la calotte au sud de 87,5 deg S, 8 cellules "
                    "entre 82,5 et 87,5 deg S ; ne distingue pas les sites candidats entre eux. U est lié à Th par "
                    "l'algorithme (U = 0,27 Th). Phase haute altitude (100 km) uniquement. La somme des 6 oxydes "
                    "va de 88,7 à 107,1 % selon les cellules (médiane 98,5 %) : valeurs de la source, non "
                    "renormalisées ; TiO2 et K valent 0 dans quelques cellules."},
    {"file": "lp_hydrogen.json", "title": "Abondance d'hydrogène Lunar Prospector (spectromètre à neutrons), 0,5 deg",
     "organism": "Los Alamos National Laboratory (W. C. Feldman, D. J. Lawrence) ; diffusé par le PDS Geosciences Node",
     "product_id": "Produit spécial LP « Hydrogen_halfdeg » : hydrogenhd.txt / hydrogenhd.dat (version du 3 jan. 2002)",
     "source_urls": ["https://pds-geosciences.wustl.edu/missions/lunarp/reduced/hydrogenhd.txt",
                     "https://pds-geosciences.wustl.edu/missions/lunarp/reduced/hydrogenhd.dat",
                     "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html"],
     "sources": ["lp/hydrogenhd.txt", "lp/hydrogenhd.dat"],
     "dtype": "JSON", "shape": [360, 720], "units": "ppm massiques d'hydrogène",
     "encoding": "layers.H : 259 200 valeurs, ligne par ligne depuis le nord (latTop 90), depuis lon -180, pas "
                 "0,5 deg ; arrondi 0,1 ppm ; null = sans donnée (1 case, illisible à la source : 43-43,5 N, "
                 "153,5-154 E) ; 4 180 valeurs négatives de la source conservées (bruit autour de zéro).",
     "projection": "Grille lat/lon régulière 0,5 deg, est positif -180..180",
     "resolution": "cases de 0,5 deg ; empreinte réelle de l'instrument de plusieurs dizaines de km",
     "transformations": "Lecture de la table ASCII (limites lat/lon de chaque case), rangement nord -> sud. "
                        "Recoupé avec l'image binaire hydrogenhd.dat (int16 gros-boutiste, x10, 1re ligne = pôle "
                        "Sud) : écart max 0,1 ppm (troncature du binaire).",
     "citation": "Feldman, W. C., et al. (2001), Evidence for water ice near the lunar poles, J. Geophys. Res., "
                 "106(E10), 23231-23251, doi:10.1029/2000JE001444 ; Feldman, W. C., et al. (1998), Fluxes of fast "
                 "and epithermal neutrons from Lunar Prospector: Evidence for water ice at the lunar poles, "
                 "Science, 281, 1496-1500.",
     "license": "Diffusé publiquement par le PDS Geosciences Node. La page précise : produits spéciaux qui « do not "
                "represent a PDS peer-reviewed archive ».",
     "limitations": "Produit spécial non revu par les pairs du PDS. Hydrogène équivalent déduit des neutrons "
                    "épithermiques corrigés des thermiques ; peu fiable là où Th et terres rares sont élevés. "
                    "Carte fortement lissée : ne résout pas les cratères en ombre permanente individuels (moyenne "
                    "au sud de 85 deg S : 124 ppm ; bande équatoriale à moins de 10 deg de l'équateur : 58 ppm ; "
                    "moyennes pondérées par la surface des cases, soit par cos(lat) ; la moyenne simple des cases "
                    "au sud de 85 deg S vaut 131 ppm)."},
    {"file": "features.json", "title": "Nomenclature IAU de la Lune (sélection)",
     "organism": "USGS Astrogeology Science Center / IAU Working Group for Planetary System Nomenclature",
     "product_id": "Gazetteer of Planetary Nomenclature, MOON_nomenclature_center_pts (shapefile)",
     "source_urls": ["https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip",
                     "https://planetarynames.wr.usgs.gov/"],
     "sources": ["iau/MOON_nomenclature_center_pts.zip"],
     "dtype": "JSON", "shape": [1072], "units": "lat, lon en degrés ; diamKm en km",
     "encoding": "[{name, type, lat, lon (-180..180, est positif), diamKm}] trié par diamètre décroissant. "
                 "name = nom avec diacritiques ; type = descripteur IAU (ex. « Crater, craters », « Satellite "
                 "Feature »).",
     "projection": "Planétocentrique, sphère de 1737,4 km (GCS_Moon_2000)", "resolution": "points (centres)",
     "transformations": "Lecture de la table .dbf (9 087 entités, toutes « Adopted by IAU ») ; longitudes 0-360 est "
                        "ramenées à -180..180 ; sélection : latitude du centre < -60 deg (509 entités) ou diamètre "
                        ">= 80 km ailleurs (563 entités).",
     "citation": "Gazetteer of Planetary Nomenclature, International Astronomical Union (IAU) Working Group for "
                 "Planetary System Nomenclature (WGPSN), https://planetarynames.wr.usgs.gov/ (fichier daté du "
                 "14 nov. 2026).",
     "license": "Domaine public (USGS) ; citer le Gazetteer.",
     "limitations": "Centre et diamètre approximatifs (« longest dimension ») ; les cratères satellites (lettres) "
                    "au sud de 60 deg S sont inclus. Les noms informels des régions Artemis (ex. « Slater Plain ») "
                    "n'y figurent pas."},
    {"file": "artemis_regions.json", "title": "Les 9 régions candidates Artemis III (annonce NASA du 28/10/2024), "
                                              "coordonnées APPROXIMATIVES",
     "organism": "NASA (carte publiée avec l'annonce ; crédit lisible sur l'image : NASA/GSFC/ASU/USGS/ACDT) ; "
                 "géoréférencement : ce projet",
     "product_id": "site-atterrissage.webp (815 x 622 px), fourni par le propriétaire",
     "source_urls": ["https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"],
     "sources": ["artemis/site-atterrissage.webp"],
     "dtype": "JSON", "shape": [9], "units": "degrés ; km",
     "encoding": "[{id, name, center{lat, lon}, corners[4]{lat, lon} (ordre : coin image haut-gauche, haut-droit, "
                 "bas-droit, bas-gauche ; haut de l'image = lon 0), sizeKm[largeur, hauteur], centerXYkm (x, y "
                 "stéréographiques), method, residualKm (RMS du recalage), imagePx[gauche, haut, droite, bas], "
                 "published (null : aucune coordonnée officielle trouvée)}]",
     "projection": "Rectangles droits dans la projection de la carte (stéréographique polaire supposée) : ce ne "
                   "sont PAS des rectangles lat/lon ; relier les 4 coins par des segments dans le plan x, y.",
     "resolution": "image source ~0,50 km/px",
     "transformations": "Détection des rectangles jaunes (arêtes affinées au sous-pixel) ; similitude image -> plan "
                        "stéréographique recalée par corrélation entre l'image et la carte d'illumination moyenne "
                        "dérivée du DEM LOLA (corrélation 0,77) : pôle à 0,11 km de l'étoile verte, échelle 2,010 "
                        "px/km (barre d'échelle : 2,02), rotation 0,02 deg ; erreur résiduelle mesurée sur 9 "
                        "cratères (Shackleton, de Gerlache, Haworth, Shoemaker, Faustini, Nobile, Malapert, Slater, "
                        "Sverdrup) : RMS 0,79 km, max 1,09 km. Détail : tools/check/artemis_georef.json.",
     "citation": "NASA (28 oct. 2024), NASA Provides Update on Artemis III Moon Landing Regions.",
     "license": "Image NASA (libre d'utilisation avec crédit) ; coordonnées dérivées par ce projet.",
     "limitations": "Coordonnées lues sur une image basse résolution : incertitude ~1 km (recalage) + ~0,5 km "
                    "(lecture des arêtes), à afficher comme approximatives. Aucune coordonnée officielle 2024 "
                    "trouvée (champ published = null). Recoupement presse : « Peak near Cabeus B » à ~200 km du "
                    "pôle (ici 192 km), « de Gerlache Rim 2 » à ~50 km (ici 54 km). Les estimations grossières "
                    "fournies au départ (ex. Malapert Massif 86,6 deg S) diffèrent de 8 à 26 km de ces résultats."},
]

ASSETS = [
    {"file": "../assets/logo.webp", "title": "Logo Regolith Finder (image entière)", "organism": "propriétaire du projet",
     "product_id": "inbox/2026-11-15/logo.webp", "source_urls": [], "sources": ["assets/logo.webp"],
     "dtype": "WebP RGB", "shape": [637, 636, 3], "units": None, "encoding": "image", "projection": None,
     "resolution": "636 x 637", "transformations": "Copie identique.", "citation": None,
     "license": "Fourni par le propriétaire.", "limitations": None},
    {"file": "../assets/logo-256.png", "title": "Emblème rond du logo, 256 px", "organism": "propriétaire du projet",
     "product_id": "inbox/2026-11-15/logo.webp", "source_urls": [], "sources": ["assets/logo.webp"],
     "dtype": "PNG RGBA", "shape": [256, 256, 4], "units": None, "encoding": "image", "projection": None,
     "resolution": "256 x 256",
     "transformations": "Recadrage carré centré sur l'anneau bleu (centre et rayon détectés, point de l'orbite "
                        "inclus), sans le texte ; masque circulaire transparent ; réduction Lanczos.",
     "citation": None, "license": "Fourni par le propriétaire.", "limitations": None},
    {"file": "../assets/favicon.png", "title": "Favicon (emblème rond), 64 px", "organism": "propriétaire du projet",
     "product_id": "inbox/2026-11-15/logo.webp", "source_urls": [], "sources": ["assets/logo.webp"],
     "dtype": "PNG RGBA", "shape": [64, 64, 4], "units": None, "encoding": "image", "projection": None,
     "resolution": "64 x 64", "transformations": "Comme logo-256.png, à 64 px.", "citation": None,
     "license": "Fourni par le propriétaire.", "limitations": None},
]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def main():
    out = []
    for e in FILES + ASSETS:
        p = (DATA / e["file"]).resolve()
        assert p.exists(), f"fichier décrit mais absent : {p}"
        rec = {"file": e["file"], "title": e["title"], "organism": e["organism"], "product_id": e["product_id"],
               "source_urls": e["source_urls"], "retrieved": RETRIEVED, "sha256": sha(p), "bytes": p.stat().st_size}
        for k in ("dtype", "shape", "units", "encoding", "projection", "resolution", "transformations",
                  "citation", "license", "limitations"):
            rec[k] = e[k]
        rec["source_files"] = [{"path": "tools/raw/" + s, "bytes": (RAW / s).stat().st_size, "sha256": sha(RAW / s)}
                               for s in e["sources"]]
        out.append(rec)
    listed = {(DATA / e["file"]).resolve() for e in FILES + ASSETS}
    extra = [p.name for p in DATA.iterdir() if p.is_file() and p.resolve() not in listed and p.name != "manifest.json"]
    assert not extra, f"fichiers de public/data non décrits : {extra}"
    cp = CHECK / "control_points.json"
    manifest = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "tools/prepare_data.py (scripts dans tools/, sources dans tools/raw/, voir tools/fetch_raw.sh)",
        "reference_grid": {"description": GRID, "width": 3812, "height": 3812, "pixel_m": 240, "radius_m": 1737400,
                           "center_px": [1905.5, 1905.5], "lon0_up": True, "east_positive": True},
        "global_convention": EQC,
        "control_points": json.loads(cp.read_text())["points"] if cp.exists() else None,
        "files": out,
    }
    (DATA / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f"manifest.json : {len(out)} fichiers décrits")
    for r in out:
        print(f"  {r['bytes']:>10d}  {r['sha256'][:12]}  {r['file']}")


if __name__ == "__main__":
    main()
