// Chaînes communes (interface générale, provenance, unités). Chaque module ajoute les siennes avec register().
import { register } from '../core/i18n.js';

register({
  fr: {
    'app.tagline': 'Explorer · Analyser · Choisir',
    'boot.dem': 'Chargement du relief du pôle Sud (LOLA, 29 Mo)…', 'boot.ui': 'Préparation de l’interface…',
    'boot.demMissing': 'Relief LOLA introuvable (public/data/sp_dem_240m.i16) : les calculs d’horizon sont désactivés.',
    'ui.close': 'Fermer', 'ui.cancel': 'Annuler', 'ui.ok': 'OK', 'ui.apply': 'Appliquer', 'ui.reset': 'Réinitialiser', 'ui.add': 'Ajouter', 'ui.remove': 'Retirer',
    'ui.loading': 'Chargement…', 'ui.none': 'Aucun', 'ui.yes': 'Oui', 'ui.no': 'Non', 'ui.unavailable': 'Indisponible', 'ui.noData': 'Sans donnée',
    'ui.export': 'Exporter', 'ui.details': 'Détails', 'ui.method': 'Méthode', 'ui.source': 'Source', 'ui.now': 'Maintenant',
    'view.map2d': 'Carte 2D pôle Sud', 'view.globe': 'Globe 3D', 'view.compare': 'Comparer',
    'mode.simple': 'Simplifié', 'mode.expert': 'Expert',
    // Provenance des valeurs
    'prov.measured': 'mesure', 'prov.measured.help': 'Produit issu d’un instrument (ex. altimètre LOLA, radiomètre Diviner).',
    'prov.derived': 'produit dérivé', 'prov.derived.help': 'Produit scientifique publié, calculé par une équipe à partir de mesures.',
    'prov.computed': 'calculé', 'prov.computed.help': 'Calculé par Regolith Finder (éphémérides + relief LOLA). Méthode dans la documentation.',
    'prov.model': 'modèle', 'prov.model.help': 'Modèle simplifié : ordre de grandeur, pas une mesure.',
    'prov.estimate': 'estimation', 'prov.estimate.help': 'Estimation ou indice indirect.',
    'prov.hypothesis': 'hypothèse', 'prov.hypothesis.help': 'Valeur de travail, non vérifiée.',
    'prov.illustrative': 'illustratif', 'prov.illustrative.help': 'Représentation illustrative, sans valeur de mesure.',
    'prov.imported': 'importé', 'prov.imported.help': 'Donnée fournie par l’utilisateur : l’application ne la vérifie pas.',
    'prov.missing': 'indisponible', 'prov.missing.help': 'Aucune donnée pour ce point.',
    // Critères de notation
    'crit.comms': 'Communications', 'crit.energy': 'Énergie', 'crit.radiation': 'Radiation', 'crit.landing': 'Atterrissage', 'crit.water': 'Eau', 'crit.isru': 'Autres ISRU',
    // Types de sites
    'kind.artemis': 'Région candidate Artemis', 'kind.historic': 'Site historique', 'kind.mission': 'Mission récente', 'kind.feature': 'Formation nommée', 'kind.point': 'Point libre', 'kind.import': 'Donnée importée',
    'body.sun': 'Soleil', 'body.earth': 'Terre', 'body.moon': 'Lune',
    'unit.days': 'jours', 'unit.hours': 'heures',
  },
  en: {
    'app.tagline': 'Explore · Analyze · Select',
    'boot.dem': 'Loading south pole terrain (LOLA, 29 MB)…', 'boot.ui': 'Preparing the interface…',
    'boot.demMissing': 'LOLA terrain not found (public/data/sp_dem_240m.i16): horizon calculations are disabled.',
    'ui.close': 'Close', 'ui.cancel': 'Cancel', 'ui.ok': 'OK', 'ui.apply': 'Apply', 'ui.reset': 'Reset', 'ui.add': 'Add', 'ui.remove': 'Remove',
    'ui.loading': 'Loading…', 'ui.none': 'None', 'ui.yes': 'Yes', 'ui.no': 'No', 'ui.unavailable': 'Unavailable', 'ui.noData': 'No data',
    'ui.export': 'Export', 'ui.details': 'Details', 'ui.method': 'Method', 'ui.source': 'Source', 'ui.now': 'Now',
    'view.map2d': 'South pole 2D map', 'view.globe': '3D globe', 'view.compare': 'Compare',
    'mode.simple': 'Simple', 'mode.expert': 'Expert',
    'prov.measured': 'measured', 'prov.measured.help': 'Instrument product (e.g. LOLA altimeter, Diviner radiometer).',
    'prov.derived': 'derived product', 'prov.derived.help': 'Published science product computed by a team from measurements.',
    'prov.computed': 'computed', 'prov.computed.help': 'Computed by Regolith Finder (ephemeris + LOLA terrain). Method in the documentation.',
    'prov.model': 'model', 'prov.model.help': 'Simplified model: order of magnitude, not a measurement.',
    'prov.estimate': 'estimate', 'prov.estimate.help': 'Estimate or indirect indicator.',
    'prov.hypothesis': 'assumption', 'prov.hypothesis.help': 'Working value, not verified.',
    'prov.illustrative': 'illustrative', 'prov.illustrative.help': 'Illustrative rendering, not a measurement.',
    'prov.imported': 'imported', 'prov.imported.help': 'Data supplied by the user: the app does not check it.',
    'prov.missing': 'unavailable', 'prov.missing.help': 'No data at this point.',
    'crit.comms': 'Communications', 'crit.energy': 'Power', 'crit.radiation': 'Radiation', 'crit.landing': 'Landing', 'crit.water': 'Water', 'crit.isru': 'Other ISRU',
    'kind.artemis': 'Artemis candidate region', 'kind.historic': 'Historic site', 'kind.mission': 'Recent mission', 'kind.feature': 'Named feature', 'kind.point': 'Free point', 'kind.import': 'Imported data',
    'body.sun': 'Sun', 'body.earth': 'Earth', 'body.moon': 'Moon',
    'unit.days': 'days', 'unit.hours': 'hours',
  },
});
