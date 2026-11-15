// Catalogue interne des sources scientifiques (cahier des charges, section 4.1).
//
// CE FICHIER EST PARTAGÉ : le navigateur l'importe (Data Center) et le serveur local (server.mjs) le
// charge pour sa liste blanche. Il ne doit donc contenir AUCUN import et aucun accès au DOM.
// Les textes descriptifs (produits, repère, unités, limites) sont dans js/i18n/datacenter.js, sous les
// clés `dc.src.<id>.*` et `dc.prod.<id>` ; ici ne figurent que des faits indépendants de la langue.
//
// Règle : chaque adresse a été interrogée réellement (curl -4, HEAD puis GET partiel) le jour indiqué
// par CATALOG_VERIFIED ; `status` est le code HTTP constaté ce jour-là depuis la machine de
// développement (0 = échec avant toute réponse HTTP, voir `note`). Le bouton « Tester » du Data Center
// refait la mesure depuis le PC de l'utilisateur.
//
// access : 'embedded'  = produit livré dans public/data, disponible hors ligne
//          'online'    = interrogé en direct par le serveur local (Internet requis)
//          'local'     = calcul fait dans le navigateur, sans réseau
//          'reference' = référence documentaire : l'application ne lit pas cette source
// protocol : 'archive' = fichiers à télécharger par HTTPS (pas d'interface de requête)
//            'rest'    = interface HTTP interrogeable (paramètres dans l'URL)
//            'wmts'    = tuiles cartographiques OGC WMTS
//            'web'     = site ou application web seulement (aucune interface de données utilisée)
//            'library' = bibliothèque logicielle embarquée
// probe : adresse testée par GET /api/probe?id=… (toujours l'une des `urls` de la source).

export const CATALOG_VERIFIED = '2026-11-15';

const PDS_GEO = 'https://pds-geosciences.wustl.edu';
const LOLA_POLAR = `${PDS_GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img`;
const IMBRIUM = 'https://imbrium.mit.edu';
const LPGRS = `${PDS_GEO}/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data`;
const TREK_WAC = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0';

export const SOURCES = [
  {
    id: 'lola', name: 'LOLA — Lunar Orbiter Laser Altimeter (LRO)',
    organism: 'NASA GSFC (LOLA Science Team) · NASA PDS Geosciences Node (WUSTL)',
    access: 'embedded', protocol: 'archive',
    formats: ['PDS3 IMG (int16 LSB) + LBL'],
    files: ['sp_dem_240m.i16'],
    urls: [
      { role: 'home', url: `${PDS_GEO}/missions/lro/lola.htm`, status: 200 },
      { role: 'product', url: `${LOLA_POLAR}/ldem_75s_240m.lbl`, status: 200 },
      { role: 'product', url: `${LOLA_POLAR}/ldem_75s_240m.img`, status: 200 },
      { role: 'mirror', url: `${IMBRIUM}/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.LBL`, status: 200 },
    ],
    probe: `${LOLA_POLAR}/ldem_75s_240m.lbl`,
  },
  {
    id: 'pgda_illum', name: 'PGDA — Lunar Polar Illumination (Mazarico et al., 2011)',
    organism: 'NASA GSFC · PGDA (pgda.gsfc.nasa.gov), E. Mazarico',
    access: 'embedded', protocol: 'archive',
    formats: ['PDS3 IMG (int16 LSB) + LBL'],
    files: ['sp_sun_avg_240m.u8', 'sp_earth_avg_240m.u8', 'sp_psr_240m.u8'],
    urls: [
      { role: 'home', url: 'https://pgda.gsfc.nasa.gov/products/69', status: 200 },
      { role: 'product', url: `${IMBRIUM}/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608.LBL`, status: 200 },
      { role: 'product', url: `${IMBRIUM}/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608_EARTH.LBL`, status: 200 },
      { role: 'product', url: `${IMBRIUM}/EXTRAS/ILLUMINATION/IMG/LPSR_75S_120M_201608.LBL`, status: 200 },
    ],
    probe: 'https://pgda.gsfc.nasa.gov/products/69',
  },
  {
    id: 'diviner', name: 'Diviner Lunar Radiometer Experiment (LRO)',
    organism: 'Diviner team at UCLA (Williams et al., 2019) · archive: NASA PDS Geosciences Node',
    access: 'embedded', protocol: 'archive',
    formats: ['GeoTIFF float32', 'ASCII', 'GMT grd', 'PNG'],
    files: ['sp_tmax_240m.u16', 'sp_tmin_240m.u16', 'sp_tavg_240m.u16'],
    urls: [
      { role: 'home', url: 'https://www.diviner.ucla.edu/data', status: 200 },
      { role: 'archive', url: `${PDS_GEO}/missions/lro/diviner.htm`, status: 200 },
      // Serveur des cartes polaires embarquées : chaîne de certificats incomplète et échange
      // Diffie-Hellman refusé par curl et par Node (ERR_SSL_DH_KEY_TOO_SMALL) ; voir tools/fetch_raw.sh.
      { role: 'product', url: 'https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/', status: 0, note: 'tls' },
    ],
    probe: 'https://www.diviner.ucla.edu/data',
  },
  {
    id: 'lp_grs', name: 'Lunar Prospector — Gamma Ray Spectrometer (GRS)',
    organism: 'NASA PDS Geosciences Node (WUSTL) · T. H. Prettyman',
    access: 'embedded', protocol: 'archive',
    formats: ['PDS3 ASCII table (.tab + .lbl)'],
    files: ['lpgrs_5deg.json'],
    urls: [
      { role: 'home', url: `${PDS_GEO}/missions/lunarp/index.htm`, status: 200 },
      { role: 'product', url: `${LPGRS}/lpgrs_high1_elem_abundance_5deg.tab`, status: 200 },
      { role: 'product', url: `${LPGRS}/lpgrs_high1_elem_abundance_5deg.lbl`, status: 200 },
    ],
    probe: `${LPGRS}/lpgrs_high1_elem_abundance_5deg.lbl`,
  },
  {
    id: 'lp_ns', name: 'Lunar Prospector — Neutron Spectrometer (hydrogen map)',
    organism: 'Los Alamos National Laboratory · NASA PDS Geosciences Node (WUSTL)',
    access: 'embedded', protocol: 'archive',
    formats: ['ASCII table (.txt)', 'binary int16 (.dat)'],
    files: ['lp_hydrogen.json'],
    urls: [
      { role: 'home', url: `${PDS_GEO}/missions/lunarp/reduced_special.html`, status: 200 },
      { role: 'product', url: `${PDS_GEO}/missions/lunarp/reduced/hydrogenhd.txt`, status: 200 },
    ],
    probe: `${PDS_GEO}/missions/lunarp/reduced_special.html`,
  },
  {
    id: 'svs_moonkit', name: 'NASA SVS — CGI Moon Kit',
    organism: 'NASA Scientific Visualization Studio (GSFC)',
    access: 'embedded', protocol: 'archive',
    formats: ['TIFF'],
    files: ['moon_color_4k.jpg', 'moon_color_2k.jpg', 'global_ldem_4ppd.i16'],
    urls: [
      { role: 'home', url: 'https://svs.gsfc.nasa.gov/4720', status: 200 },
      { role: 'product', url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif', status: 200 },
    ],
    probe: 'https://svs.gsfc.nasa.gov/4720',
  },
  {
    id: 'iau_gazetteer', name: 'Gazetteer of Planetary Nomenclature (IAU / USGS)',
    organism: 'USGS Astrogeology Science Center · IAU WGPSN',
    access: 'embedded', protocol: 'archive',
    formats: ['Shapefile (.zip)'],
    files: ['features.json'],
    urls: [
      { role: 'home', url: 'https://planetarynames.wr.usgs.gov/', status: 200 },
      { role: 'product', url: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip', status: 200 },
    ],
    probe: 'https://planetarynames.wr.usgs.gov/',
  },
  {
    // Annonce du 28/10/2024 faite pour Artemis III. Pages NASA lues le 15/11/2026 : Artemis III est devenu un vol
    // d'essai en orbite terrestre basse ; le premier alunissage habité est prévu avec Artemis IV (début 2028),
    // dont la page présente les mêmes neuf régions candidates.
    id: 'artemis_regions', name: 'NASA — Artemis candidate landing regions (announced 28 Oct 2024)',
    organism: 'NASA',
    access: 'embedded', protocol: 'web',
    formats: ['HTML + image'],
    files: ['artemis_regions.json'],
    urls: [
      { role: 'home', url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/', status: 200 },
      { role: 'doc', url: 'https://www.nasa.gov/mission/artemis-iv/', status: 200 },
      { role: 'doc', url: 'https://www.nasa.gov/mission/artemis-iii/', status: 200 },
    ],
    probe: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
  },
  {
    id: 'horizons', name: 'JPL Horizons',
    organism: 'NASA JPL — Solar System Dynamics Group',
    access: 'online', protocol: 'rest',
    formats: ['text', 'JSON'],
    files: [],
    urls: [
      // HEAD renvoie 405 ; GET répond 200. Aucun en-tête Access-Control-Allow-Origin constaté :
      // un navigateur ne peut pas l'appeler directement, d'où le passage par le serveur local.
      { role: 'api', url: 'https://ssd.jpl.nasa.gov/api/horizons.api', status: 200, note: 'head405' },
      { role: 'doc', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html', status: 200 },
      { role: 'home', url: 'https://ssd.jpl.nasa.gov/horizons/', status: 200 },
    ],
    probe: 'https://ssd.jpl.nasa.gov/api/horizons.api',
  },
  {
    id: 'astronomy_engine', name: 'Astronomy Engine 2.1.19',
    organism: 'Don Cross (open source, MIT)',
    access: 'local', protocol: 'library',
    formats: ['JavaScript (ES module)'],
    files: [],
    urls: [
      { role: 'home', url: 'https://github.com/cosinekitty/astronomy', status: 200 },
    ],
    probe: 'https://github.com/cosinekitty/astronomy',
  },
  {
    id: 'moon_trek', name: 'NASA Moon Trek',
    organism: 'NASA (trek.nasa.gov)',
    access: 'reference', protocol: 'wmts',
    formats: ['JPEG tiles 256 px'],
    files: [],
    urls: [
      { role: 'home', url: 'https://trek.nasa.gov/moon/', status: 200 },
      { role: 'api', url: `${TREK_WAC}/WMTSCapabilities.xml`, status: 200 },
      { role: 'product', url: `${TREK_WAC}/default/default028mm/0/0/0.jpg`, status: 200 },
    ],
    probe: `${TREK_WAC}/WMTSCapabilities.xml`,
  },
  {
    id: 'quickmap', name: 'LROC QuickMap',
    organism: 'Applied Coherent Technology, for the LROC team (ASU)',
    access: 'reference', protocol: 'web',
    formats: ['web application'],
    files: [],
    urls: [
      { role: 'home', url: 'https://quickmap.lroc.im-ldi.com/', status: 200 },
      // Ancienne adresse du cahier des charges : redirige (301) vers la précédente.
      { role: 'mirror', url: 'https://quickmap.lroc.asu.edu/', status: 301, note: 'redirect' },
    ],
    probe: 'https://quickmap.lroc.im-ldi.com/',
  },
  {
    id: 'ode_rest', name: 'ODE — Orbital Data Explorer (REST interface)',
    organism: 'NASA PDS Geosciences Node (WUSTL)',
    access: 'reference', protocol: 'rest',
    formats: ['JSON', 'XML'],
    files: [],
    urls: [
      { role: 'doc', url: 'https://oderest.rsl.wustl.edu/', status: 200 },
      { role: 'api', url: 'https://oderest.rsl.wustl.edu/live2/?query=iipt&output=JSON&odemetadb=moon', status: 200 },
      { role: 'home', url: 'https://ode.rsl.wustl.edu/moon/', status: 200 },
    ],
    probe: 'https://oderest.rsl.wustl.edu/live2/?query=iipt&output=JSON&odemetadb=moon',
  },
  {
    id: 'lend', name: 'LEND — Lunar Exploration Neutron Detector (LRO)',
    organism: 'LEND Science Team · NASA PDS Geosciences Node (WUSTL)',
    access: 'reference', protocol: 'archive',
    formats: ['PDS4 bundle', 'PDS3 (EDR, RDR)'],
    files: [],
    urls: [
      { role: 'home', url: `${PDS_GEO}/missions/lro/lend.htm`, status: 200 },
      { role: 'archive', url: `${PDS_GEO}/lro/lro-l-lend-2-edr-v1/lrolen_0xxx/`, status: 200 },
    ],
    probe: `${PDS_GEO}/missions/lro/lend.htm`,
  },
  {
    id: 'minirf', name: 'Mini-RF — Miniature Radio Frequency radar (LRO)',
    organism: 'JHU APL (Mini-RF Science Team) · NASA PDS Geosciences Node (WUSTL)',
    access: 'reference', protocol: 'archive',
    formats: ['PDS3', 'PDS4'],
    files: [],
    urls: [
      { role: 'home', url: `${PDS_GEO}/missions/lro/mrf.htm`, status: 200 },
      { role: 'archive', url: `${PDS_GEO}/lro/lro-l-mrflro-5-global-mosaic-v1/`, status: 200 },
    ],
    probe: `${PDS_GEO}/missions/lro/mrf.htm`,
  },
  {
    id: 'm3', name: 'M3 — Moon Mineralogy Mapper (Chandrayaan-1)',
    organism: 'NASA PDS Cartography and Imaging Sciences Node (pds-imaging.jpl.nasa.gov)',
    access: 'reference', protocol: 'archive',
    formats: ['PDS3'],
    files: [],
    urls: [
      // 403 constaté depuis la machine de développement (hébergeur) : à retester depuis le PC de l'utilisateur.
      { role: 'archive', url: 'https://pds-imaging.jpl.nasa.gov/volumes/m3.html', status: 403, note: 'forbidden' },
      { role: 'home', url: `${PDS_GEO}/missions/chandrayaan1/default.htm`, status: 200 },
      { role: 'api', url: 'https://ode.rsl.wustl.edu/moon/', status: 200 },
    ],
    probe: 'https://pds-imaging.jpl.nasa.gov/volumes/m3.html',
  },
  {
    id: 'lamp', name: 'LAMP — Lyman-Alpha Mapping Project (LRO)',
    organism: 'NASA PDS Cartography and Imaging Sciences Node (pds-imaging.jpl.nasa.gov)',
    access: 'reference', protocol: 'archive',
    formats: ['PDS3 (EDR, RDR, GDR)'],
    files: [],
    urls: [
      { role: 'archive', url: 'https://pds-imaging.jpl.nasa.gov/volumes/lro.html', status: 403, note: 'forbidden' },
      { role: 'home', url: `${PDS_GEO}/missions/lro/default.htm`, status: 200 },
      { role: 'api', url: 'https://ode.rsl.wustl.edu/moon/', status: 200 },
    ],
    probe: 'https://pds-imaging.jpl.nasa.gov/volumes/lro.html',
  },
  {
    id: 'shadowcam', name: 'ShadowCam (KPLO / Danuri)',
    organism: 'ShadowCam team (shadowcam.im-ldi.com) · NASA / KARI',
    access: 'reference', protocol: 'archive',
    formats: ['PDS4 bundle', 'Cloud Optimized GeoTIFF'],
    files: [],
    urls: [
      { role: 'home', url: 'https://shadowcam.im-ldi.com/archive', status: 200 },
      { role: 'archive', url: 'https://pds.shadowcam.im-ldi.com/', status: 200 },
    ],
    probe: 'https://pds.shadowcam.im-ldi.com/',
  },
  {
    id: 'spice_naif', name: 'SPICE — NAIF generic kernels',
    organism: 'NASA JPL — Navigation and Ancillary Information Facility (NAIF)',
    access: 'reference', protocol: 'archive',
    formats: ['SPICE kernels (SPK .bsp, PCK .bpc/.tpc, LSK, FK)'],
    files: [],
    urls: [
      { role: 'archive', url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/', status: 200 },
      { role: 'doc', url: 'https://naif.jpl.nasa.gov/naif/data_generic.html', status: 200 },
    ],
    probe: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/',
  },
  {
    id: 'pds', name: 'NASA Planetary Data System (PDS)',
    organism: 'NASA',
    access: 'reference', protocol: 'archive',
    formats: ['PDS3', 'PDS4'],
    files: [],
    urls: [
      { role: 'home', url: 'https://pds.nasa.gov/', status: 200 },
      { role: 'archive', url: `${PDS_GEO}/dataserv/moon.html`, status: 200 },
    ],
    probe: 'https://pds.nasa.gov/',
  },
];

// Produits téléchargeables à la demande par le serveur local (GET /api/fetch?id=…), rangés dans
// .cache/products/. `bytes` est la taille annoncée par le serveur d'origine le jour de la vérification
// (indicative : c'est la longueur réellement reçue qui fait foi). `text` : le fichier est lisible tel quel.
export const PRODUCTS = [
  { id: 'lola_ldem_75s_240m_lbl', source: 'lola', file: 'ldem_75s_240m.lbl', url: `${LOLA_POLAR}/ldem_75s_240m.lbl`, bytes: 4990, text: true },
  { id: 'lola_ldem_75s_240m_img', source: 'lola', file: 'ldem_75s_240m.img', url: `${LOLA_POLAR}/ldem_75s_240m.img`, bytes: 29062688, text: false },
  { id: 'pgda_avgvisib_sun_lbl', source: 'pgda_illum', file: 'AVGVISIB_75S_120M_201608.LBL', url: `${IMBRIUM}/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608.LBL`, bytes: 4092, text: true },
  { id: 'pgda_avgvisib_earth_lbl', source: 'pgda_illum', file: 'AVGVISIB_75S_120M_201608_EARTH.LBL', url: `${IMBRIUM}/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608_EARTH.LBL`, bytes: 4112, text: true },
  { id: 'pgda_psr_lbl', source: 'pgda_illum', file: 'LPSR_75S_120M_201608.LBL', url: `${IMBRIUM}/EXTRAS/ILLUMINATION/IMG/LPSR_75S_120M_201608.LBL`, bytes: 3913, text: true },
  { id: 'lpgrs_5deg_lbl', source: 'lp_grs', file: 'lpgrs_high1_elem_abundance_5deg.lbl', url: `${LPGRS}/lpgrs_high1_elem_abundance_5deg.lbl`, bytes: 8110, text: true },
  { id: 'lpgrs_5deg_tab', source: 'lp_grs', file: 'lpgrs_high1_elem_abundance_5deg.tab', url: `${LPGRS}/lpgrs_high1_elem_abundance_5deg.tab`, bytes: 1575200, text: true },
];

export const ACCESS_MODES = ['embedded', 'online', 'local', 'reference'];

export function sourceById(id) { return SOURCES.find((s) => s.id === id) || null; }
export function productById(id) { return PRODUCTS.find((p) => p.id === id) || null; }
export function productsOfSource(id) { return PRODUCTS.filter((p) => p.source === id); }
/** Source du catalogue dont provient un fichier embarqué (nom dans public/data), ou null. */
export function sourceOfFile(file) { return SOURCES.find((s) => s.files.includes(file)) || null; }
