// Tests Node des outils annexes : analyseurs d'import (GeoJSON, CSV/TSV), mesures, fonctions pures des fenêtres.
//   node tests/tools.test.mjs
import baseAssert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// store.js lit localStorage et navigator à l'import : on fournit le minimum hors navigateur.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.navigator ??= { language: 'fr' };
// Changer de langue (set({lang})) rafraîchit les attributs data-i18n du document : ici, un document vide suffit.
globalThis.document ??= { querySelectorAll: () => [], documentElement: {} };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const fixture = (name) => fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const imp = await import('../public/js/ui/importer.js');
const { measurePath, profileToCSV, niceBounds } = await import('../public/js/ui/measure.js');
const { parseLicenses, manifestCredits, historyEntries } = await import('../public/js/ui/modals.js');
const { MISSION_HISTORY } = await import('../public/js/data/history.js');
const { TEAM } = await import('../public/js/data/team.js');
const { has, t } = await import('../public/js/core/i18n.js');
const { set } = await import('../public/js/core/store.js');
const { setDem, heightAt } = await import('../public/js/science/terrain.js');
const { MOON_RADIUS_M } = await import('../public/js/core/coords.js');

// Chaque appel à assert.* compte pour un contrôle (le total est affiché en fin de test).
let checks = 0;
const assert = new Proxy(baseAssert, { get: (target, key) => (typeof target[key] === 'function' ? (...args) => { checks++; return target[key](...args); } : target[key]) });

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(name); console.error(`ÉCHEC  ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (tolérance ${tol})`);
const codes = (r) => r.rejected.map((x) => x.code);

// ------------------------------------------------------------------ GeoJSON
test('GeoJSON : points, longitude 0–360 ramenée à ±180, ordre [lat, lon] dans l’état', () => {
  const r = imp.parseGeoJSON(fixture('points.geojson'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { point: 3, line: 0, polygon: 0 });
  assert.deepEqual(r.features[0], { type: 'point', coords: [[-89.45, -137.3]], name: 'Bord de Shackleton', props: { name: 'Bord de Shackleton', note: 'crête' } });
  near(r.features[1].coords[0][1], -68.7, 1e-9, 'longitude 291,3');
  assert.equal(r.features[1].coords[0][0], -83.66);
  assert.equal(r.features[2].name, 'p3');                                   // nom repris de l'identifiant
  assert.deepEqual(r.features[2].props, { rang: 3, valide: true });        // propriétés simples seulement
  assert.deepEqual(r.warnings.sort(), ['crs_assumed', 'z_ignored']);
  assert.equal(r.rejected.length, 0);
  near(r.bbox.latMin, -89.45, 1e-9); near(r.bbox.latMax, -83.66, 1e-9); near(r.bbox.lonMin, -137.3, 1e-9); near(r.bbox.lonMax, 30, 1e-9);
});

test('GeoJSON : lignes, polygones, géométries multiples ; entités refusées listées', () => {
  const r = imp.parseGeoJSON(fixture('shapes.geojson'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { point: 2, line: 3, polygon: 3 });
  assert.deepEqual(r.features[0].coords, [[-89, 0], [-88, 0], [-88, 90]]);
  assert.equal(r.features[1].type, 'polygon');
  assert.equal(r.features[1].coords.length, 5);                             // contour extérieur seul
  assert.ok(r.warnings.includes('holes_ignored'));
  assert.deepEqual(codes(r), ['geom_null', 'out_of_range', 'geom_unsupported', 'coords_invalid']);
  assert.deepEqual(r.rejected.map((x) => x.where), [6, 7, 8, 9]);           // numéro de l'entité dans le fichier
  assert.equal(r.outOfRange, 1);
});

test('GeoJSON : Feature seule et géométrie seule', () => {
  const f = imp.parseGeoJSON(fixture('feature.geojson'));
  assert.equal(f.ok, true);
  assert.deepEqual(f.features, [{ type: 'line', coords: [[-88, -2], [-88, 2]], name: 'Un seul tracé', props: { title: 'Un seul tracé' } }]);
  const g = imp.parseGeoJSON(fixture('geometry.geojson'));
  assert.deepEqual(g.features, [{ type: 'point', coords: [[-45, 180]] }]);
});

test('GeoJSON : référentiel géographique lunaire accepté, terrestre signalé, projeté REFUSÉ', () => {
  const lunar = imp.parseGeoJSON(fixture('crs-lunar.geojson'));
  assert.equal(lunar.ok, true); assert.equal(lunar.crs.kind, 'lunar'); assert.deepEqual(lunar.warnings, []);
  const earth = imp.parseGeoJSON(fixture('crs-earth.geojson'));
  assert.equal(earth.ok, true); assert.deepEqual(earth.warnings, ['crs_earth']);
  const proj = imp.parseGeoJSON(fixture('crs-projected.geojson'));
  assert.equal(proj.ok, false);
  assert.deepEqual(proj.error, { code: 'crs', detail: 'urn:ogc:def:crs:IAU:2015:30135' });
});

test('classifyCrs : codes courants', () => {
  const kind = (name) => imp.classifyCrs({ type: 'name', properties: { name } }).kind;
  assert.equal(imp.classifyCrs(undefined).kind, 'none');
  for (const n of ['IAU_2015:30100', 'IAU2000:30100', 'urn:ogc:def:crs:IAU:2015:30100', 'ESRI:104903', 'GCS_Moon_2000']) assert.equal(kind(n), 'lunar', n);
  for (const n of ['urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'urn:ogc:def:crs:EPSG::4326']) assert.equal(kind(n), 'earth', n);
  for (const n of ['EPSG:3857', 'urn:ogc:def:crs:EPSG::32633', 'IAU_2015:30135', 'IAU_2015:30110', 'IAU_2015:49900', 'Moon_South_Pole_Stereographic']) assert.equal(kind(n), 'other', n);
  assert.equal(imp.classifyCrs({ type: 'link', properties: { href: 'http://example.org/crs' } }).kind, 'other');
  assert.equal(imp.classifyCrs({ type: 'name' }).kind, 'other');
});

test('GeoJSON : fichiers vides, illisibles ou d’un autre type', () => {
  assert.equal(imp.parseGeoJSON(fixture('empty.geojson')).error.code, 'empty');
  assert.equal(imp.parseGeoJSON('﻿  \n').error.code, 'empty');
  assert.equal(imp.parseGeoJSON(fixture('broken.geojson')).error.code, 'json');
  assert.deepEqual(imp.parseGeoJSON(fixture('not-geojson.json')).error, { code: 'not_geojson', detail: 'Topology' });
  assert.equal(imp.parseGeoJSON('[1, 2]').error.code, 'not_geojson');
  assert.equal(imp.parseGeoJSON('{"type":"FeatureCollection","features":[]}').error.code, 'no_features');
});

test('GeoJSON : coordonnées en mètres sans crs -> toutes rejetées « hors Lune », rien n’est placé', () => {
  const r = imp.parseGeoJSON('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[-37940,90310]}}]}');
  assert.equal(r.ok, true); assert.equal(r.features.length, 0); assert.equal(r.outOfRange, 1); assert.equal(r.bbox, null);
});

test('GeoJSON : BOM UTF-8 accepté', () => {
  const r = imp.parseGeoJSON('﻿' + fixture('crs-lunar.geojson'));
  assert.equal(r.ok, true); assert.equal(r.features[0].name, 'Malapert');
});

test('Export GeoJSON : aller-retour [lon, lat], polygones refermés', () => {
  const r = imp.parseGeoJSON(fixture('shapes.geojson'));
  const dataset = { id: 'x', name: 'Essai', color: '#fff', features: [...r.features, { type: 'polygon', coords: [[-80, 1], [-80, 2], [-79, 2]] }] };
  const gj = imp.datasetToGeoJSON(dataset);
  assert.equal(gj.type, 'FeatureCollection');
  assert.deepEqual(gj.features[0].geometry, { type: 'LineString', coordinates: [[0, -89], [0, -88], [90, -88]] });
  assert.deepEqual(gj.features.at(-1).geometry.coordinates, [[[1, -80], [2, -80], [2, -79], [1, -80]]]);   // anneau refermé
  const back = imp.parseGeoJSON(JSON.stringify(gj));
  assert.deepEqual(back.counts, { point: 2, line: 3, polygon: 4 });
  assert.deepEqual(back.features[0].coords, r.features[0].coords);
  assert.equal(back.features[0].name, 'Traverse');
});

// ------------------------------------------------------------------ CSV / TSV
test('CSV virgule : en-tête détecté, guillemets, longitude 0–360', () => {
  const table = imp.analyzeCSV(fixture('sites.csv'));
  assert.equal(table.ok, true); assert.equal(table.delimiter, ','); assert.equal(table.hasHeader, true); assert.equal(table.decimalComma, false);
  assert.deepEqual(table.columns, ['name', 'lat', 'lon', 'height_m']);
  assert.deepEqual(table.detected, { lat: 1, lon: 2, name: 0, confident: true, reason: '' });
  const r = imp.csvToFeatures(table, table.detected);
  assert.equal(r.features.length, 4); assert.equal(r.rejected.length, 0);
  assert.deepEqual(r.features[0], { type: 'point', coords: [[-89.45, -137.3]], name: 'Shackleton rim', props: { height_m: '1200' } });
  assert.equal(r.features[1].name, 'Mons Mouton, plateau');
  near(r.features[2].coords[0][1], -68.7, 1e-9); assert.equal(r.features[2].props, undefined);
  assert.equal(r.features[3].name, 'Quoted "name"');
});

test('CSV point-virgule : virgules décimales, lignes invalides comptées et localisées', () => {
  const table = imp.analyzeCSV(fixture('sites-semicolon.csv'));
  assert.equal(table.delimiter, ';'); assert.equal(table.decimalComma, true);
  assert.deepEqual(table.detected, { lat: 1, lon: 2, name: 0, confident: true, reason: '' });
  const r = imp.csvToFeatures(table, table.detected);
  assert.deepEqual(r.features.map((f) => f.coords[0]), [[-89.45, -137.3], [-84.6, 31], [-88.5, -0.5]]);
  assert.deepEqual(r.features[0].props, { 'Altitude (m)': '1200' });
  assert.deepEqual(r.rejected.map((x) => [x.where, x.code]), [[4, 'lat_invalid'], [5, 'out_of_range'], [6, 'out_of_range'], [7, 'short_row']]);
  assert.equal(r.outOfRange, 2);
  assert.ok(r.rejected[0].detail.includes('abc'));
});

test('TSV : suffixes et préfixes N/S/E/W/O, contradictions refusées', () => {
  const table = imp.analyzeCSV(fixture('sites.tsv'));
  assert.equal(table.delimiter, '\t');
  assert.equal(table.detected.confident, true);
  const r = imp.csvToFeatures(table, table.detected);
  assert.deepEqual(r.features.map((f) => f.coords[0]), [[-85.3, 31.2], [-84.5, -68.7], [-80, -120.5], [10, -20]]);
  assert.deepEqual(r.rejected.map((x) => [x.where, x.code]), [[6, 'lat_invalid'], [7, 'lat_invalid']]);
});

test('parseCoordinate', () => {
  const p = imp.parseCoordinate;
  assert.equal(p('-85.3', 'lat'), -85.3); assert.equal(p(' 85.3 ° S', 'lat'), -85.3); assert.equal(p('N12', 'lat'), 12);
  assert.equal(p('31°O', 'lon'), -31); assert.equal(p('31W', 'lon'), -31); assert.equal(p('31E', 'lon'), 31); assert.equal(p('−12.5', 'lon'), -12.5);
  assert.equal(p('85,3', 'lat', true), 85.3); assert.ok(Number.isNaN(p('85,3', 'lat', false))); assert.ok(Number.isNaN(p('1.234,5', 'lat', true)));
  for (const bad of ['', 'abc', '12E', '-80S', 'N12S', '1e3', '12 34', '85°30\'S']) assert.ok(Number.isNaN(p(bad, 'lat', true)), `« ${bad} » devrait être refusé`);
  assert.ok(Object.is(p('0S', 'lat'), 0));
});

test('CSV sans en-tête : choix manuel obligatoire', () => {
  const table = imp.analyzeCSV(fixture('no-header.csv'));
  assert.equal(table.hasHeader, false);
  assert.deepEqual(table.detected, { lat: -1, lon: -1, name: -1, confident: false, reason: 'no_header' });
  const r = imp.csvToFeatures(table, { lat: 0, lon: 1, name: -1 });
  assert.equal(r.features.length, 3); near(r.features[2].coords[0][1], -68.7, 1e-9);
});

test('CSV : colonnes x/y jamais choisies automatiquement ; colonnes ambiguës', () => {
  const xy = imp.analyzeCSV(fixture('xy.csv'));
  assert.equal(xy.detected.reason, 'xy'); assert.equal(xy.detected.confident, false); assert.equal(xy.detected.lat, -1);
  const r = imp.csvToFeatures(xy, { lat: 2, lon: 1, name: 0 });           // choix manuel : les valeurs en mètres sont rejetées
  assert.equal(r.features.length, 0); assert.equal(r.outOfRange, 2);
  assert.equal(imp.analyzeCSV(fixture('two-lats.csv')).detected.reason, 'ambiguous');
  assert.equal(imp.detectColumns(['Site', 'Latitude (°N)', 'Longitude (°E)'], true).confident, true);
  assert.equal(imp.detectColumns(['a', 'b'], true).reason, 'not_found');
});

test('CSV : BOM UTF-8, fins de ligne CRLF, accents', () => {
  const table = imp.analyzeCSV(fixture('bom.csv'));
  assert.deepEqual(table.columns, ['Nom', 'Latitude', 'Longitude']);
  const r = imp.csvToFeatures(table, table.detected);
  assert.deepEqual(r.features, [{ type: 'point', coords: [[-87.45, -5]], name: 'Cratère Haworth' }, { type: 'point', coords: [[-86, -2.9]], name: 'Massif Malapert' }]);
});

test('CSV : fichier vide, en-tête seul, une seule colonne', () => {
  assert.equal(imp.analyzeCSV(fixture('empty.csv')).error.code, 'empty');
  assert.equal(imp.analyzeCSV(fixture('header-only.csv')).error.code, 'no_rows');
  assert.equal(imp.analyzeCSV(fixture('one-column.txt')).error.code, 'one_column');
});

test('splitDelimited : numéros de ligne, lignes vides, saut de ligne entre guillemets', () => {
  const rows = imp.splitDelimited('a,b\n\n"x\ny",2\r\n3,4', ',');
  assert.deepEqual(rows, [{ line: 1, cells: ['a', 'b'] }, { line: 3, cells: ['x\ny', '2'] }, { line: 5, cells: ['3', '4'] }]);
});

test('formatOfFile : seuls les formats réellement lus', () => {
  assert.equal(imp.formatOfFile('a.GeoJSON'), 'geojson'); assert.equal(imp.formatOfFile('a.json'), 'geojson');
  for (const f of ['a.csv', 'a.tsv', 'a.txt']) assert.equal(imp.formatOfFile(f), 'csv');
  for (const f of ['dem.tif', 'a.tiff', 'a.nc', 'a.h5', 'a.fits', 'a.obj', 'a.glb', 'a.stl', 'sansextension']) assert.equal(imp.formatOfFile(f), null, f);
});

// ------------------------------------------------------------------ Emprise, centre, mémorisation
test('Centre d’un jeu autour du pôle et de l’antiméridien', () => {
  const c = imp.featuresCenter([{ type: 'line', coords: [[-88, 179], [-88, -179]] }]);
  near(c.lat, -88, 0.01); near(Math.abs(c.lon), 180, 1e-6);
  const pole = imp.featuresCenter([{ type: 'polygon', coords: [[-89, 0], [-89, 90], [-89, 180], [-89, -90]] }]);
  near(pole.lat, -90, 1e-6);
  assert.equal(imp.featuresCenter([]), null);
});

test('Mémorisation : plafond respecté, jeux trop gros écartés ; stockage abîmé ignoré', () => {
  const small = { id: 'a', name: 'petit', color: '#fff', features: [{ type: 'point', coords: [[-80, 10]] }] };
  const big = { id: 'b', name: 'gros', color: '#fff', features: Array.from({ length: 2000 }, (_, i) => ({ type: 'point', coords: [[-80, i / 100]] })) };
  const plan = imp.planStorage([small, big, { ...small, id: 'c' }], 5000);
  assert.deepEqual(plan.kept.map((d) => d.id), ['a', 'c']); assert.deepEqual(plan.skipped, ['b']);
  assert.ok(JSON.stringify(plan.kept).length <= 5000);
  assert.deepEqual(imp.sanitizeImports('n’importe quoi'), []);
  assert.deepEqual(imp.sanitizeImports([small, { id: 'z', name: 'cassé', color: '#fff', features: [{ type: 'point', coords: [[-120, 0]] }] }, null, { id: 1 }]), [small]);
});

// ------------------------------------------------------------------ Mesure
test('Mesure sans relief : distance de surface seule (valeurs calculées à la main)', () => {
  setDem(null);
  const m = measurePath([{ lat: -89, lon: 0 }, { lat: -88, lon: 0 }, { lat: -88, lon: 90 }]);
  // 1° de méridien = R·π/180 = 1 737 400 × 0,017453293 = 30 323,35 m
  near(m.segments[0].surfaceM, 30323.35, 0.05, 'segment 1');
  // angle au centre entre (88°S, 0°) et (88°S, 90°E) : cos c = sin²(88°) -> c = 2,82814° -> 85 759,0 m
  const c = Math.acos(Math.sin(88 * Math.PI / 180) ** 2);
  near(c * 180 / Math.PI, 2.8281, 1e-4, 'angle');
  near(m.segments[1].surfaceM, c * MOON_RADIUS_M, 0.01, 'segment 2');
  near(m.total.surfaceM, 30323.35 + c * MOON_RADIUS_M, 0.1, 'total');
  for (const k of ['chordM', 'dhM', 'meanSlopeDeg', 'maxSlopeDeg']) { assert.ok(Number.isNaN(m.total[k]), k); assert.ok(Number.isNaN(m.segments[0][k]), k); }
  assert.equal(m.profile.length, m.profile.filter((p, i) => i === 0 || p.d > m.profile[i - 1].d).length);   // distances strictement croissantes
  near(m.profile.at(-1).d, m.total.surfaceM, 1e-6);
});

test('Axe du profil : bornes rondes qui contiennent toujours les données', () => {
  for (const [lo, hi] of [[-1418, -20], [0, 1], [1200, 1200], [-3, 8000], [-4321.5, -4320.9], [100, 499], [-4200, 6800], [0.2, 0.3]]) {
    const b = niceBounds(lo, hi);
    assert.ok(b.min <= lo && b.max >= hi && b.max > b.min, `${lo}..${hi} -> ${JSON.stringify(b)}`);
    assert.ok(b.max - b.min <= 4 * Math.max(hi - lo, 4), `bornes trop larges pour ${lo}..${hi} : ${JSON.stringify(b)}`);
  }
  assert.deepEqual(niceBounds(-1418, -20), { min: -1600, max: 0 });
});

const demFile = path.join(ROOT, 'public/data/sp_dem_240m.i16');
if (fs.existsSync(demFile)) {
  test('Mesure avec le relief LOLA : cohérence des distances, du dénivelé et des pentes', () => {
    const buf = fs.readFileSync(demFile);
    setDem(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
    const pts = [{ lat: -89.45, lon: -137.3 }, { lat: -89.67, lon: 129.2 }, { lat: -88.5, lon: 30 }];   // crête de Shackleton -> fond -> extérieur
    const m = measurePath(pts);
    assert.deepEqual(m.heights, pts.map((p) => heightAt(p.lat, p.lon)));
    assert.ok(m.heights[0] - m.heights[1] > 2000, `la crête domine le fond de Shackleton de plus de 2 km (${m.heights[0] - m.heights[1]} m)`);
    near(m.segments[0].dhM, m.heights[1] - m.heights[0], 1e-9); near(m.total.dhM, m.heights[2] - m.heights[0], 1e-9);
    for (const s of m.segments) {
      // corde 3D : au moins le dénivelé, et proche de √(corde horizontale² + dénivelé²) pour un segment court
      assert.ok(s.chordM >= Math.abs(s.dhM));
      const flat = 2 * MOON_RADIUS_M * Math.sin(s.surfaceM / (2 * MOON_RADIUS_M));
      near(s.chordM, Math.hypot(flat, s.dhM), 0.01 * s.chordM, 'corde');
      assert.ok(s.maxSlopeDeg >= s.meanSlopeDeg && s.meanSlopeDeg > 0 && s.maxSlopeDeg < 60);
      assert.ok(s.stepM <= 240 && s.stepM > 200); assert.equal(s.partial, false);
    }
    near(m.total.chordM, m.segments[0].chordM + m.segments[1].chordM, 1e-6);
    assert.equal(m.total.maxSlopeDeg, Math.max(m.segments[0].maxSlopeDeg, m.segments[1].maxSlopeDeg));
    assert.ok(m.total.meanSlopeDeg >= Math.min(...m.segments.map((s) => s.meanSlopeDeg)) && m.total.meanSlopeDeg <= Math.max(...m.segments.map((s) => s.meanSlopeDeg)));
    near(m.profile[0].h, m.heights[0], 1e-9); near(m.profile.at(-1).h, m.heights[2], 1e-9);
    const csv = profileToCSV(m.profile).trim().split('\n');
    assert.equal(csv[0], 'segment,distance_m,latitude_deg,longitude_deg,height_m'); assert.equal(csv.length, m.profile.length + 1);
    assert.match(csv[1], /^1,0\.0,-89\.450000,-137\.300000,-?\d+\.\d$/);
  });
  test('Mesure : point hors de la grille polaire -> hauteur indisponible, distance de surface conservée', () => {
    const m = measurePath([{ lat: -89, lon: 0 }, { lat: -60, lon: 0 }]);
    near(m.segments[0].surfaceM, 29 * 30323.35, 2);
    assert.ok(Number.isFinite(m.heights[0]) && Number.isNaN(m.heights[1]));
    assert.ok(Number.isNaN(m.total.chordM) && Number.isNaN(m.total.dhM));
    assert.equal(m.segments[0].partial, true);
    assert.match(profileToCSV(m.profile).trim().split('\n').at(-1), /,$/);   // hauteur vide en fin de trajet
  });
} else console.warn('sp_dem_240m.i16 absent : tests de mesure avec relief non exécutés');

// ------------------------------------------------------------------ Fenêtres : fonctions pures et données
test('Historique : chaque site « historic » / « mission » a ses repères, dans l’ordre chronologique', () => {
  const list = historyEntries();
  assert.equal(list.length, 12);
  for (const { site, info, ms } of list) {
    assert.ok(info, `repères manquants pour ${site.id}`);
    assert.equal(new Date(ms).getUTCFullYear(), site.year, `année de ${site.id}`);
    assert.ok(has(`tools.history.fact.${site.id}`) && has(`tools.history.type.${info.type}`), site.id);
  }
  assert.deepEqual(list.map((e) => e.ms), list.map((e) => e.ms).sort((a, b) => a - b));
  assert.equal(list[0].site.id, 'apollo11'); assert.equal(list.at(-1).site.id, 'im2');
  assert.deepEqual(Object.keys(MISSION_HISTORY).filter((id) => !list.some((e) => e.site.id === id)), []);
});

test('Historique : faits corrigés, et une source (URL) en commentaire à côté de chaque date et de chaque fait', () => {
  const plain = (lang, id) => { set({ lang }); return t(`tools.history.fact.${id}`).replace(/[\u00a0\u202f]/g, ' '); };
  assert.ok(plain('fr', 'apollo15').startsWith('Première mission Apollo à emporter le véhicule lunaire (Lunar Roving Vehicle).'));
  assert.ok(plain('en', 'apollo15').startsWith('First Apollo mission to carry the Lunar Roving Vehicle.'));
  assert.ok(plain('fr', 'chandrayaan3').includes('pendant la journée lunaire, soit environ deux semaines terrestres'));
  assert.ok(plain('en', 'chandrayaan3').includes('through one lunar daytime (about two Earth weeks)'));
  assert.ok(plain('fr', 'change6').includes('bassin Apollo') && plain('en', 'change6').includes('the Apollo basin') && !plain('en', 'change6').includes('Apollo crater'));
  set({ lang: 'fr' });
  const lines = fs.readFileSync(path.join(ROOT, 'public/js/data/history.js'), 'utf8').split('\n');
  const frEnd = lines.findIndex((l) => l.startsWith('  en: {'));
  for (const id of Object.keys(MISSION_HISTORY)) {
    const date = lines.findIndex((l) => l.startsWith(`  ${id}: {`)), fact = lines.findIndex((l, i) => i < frEnd && l.includes(`'tools.history.fact.${id}'`));
    assert.match(lines[date - 1], /^\s*\/\/ .*https:\/\/\S+/, `source de la date de ${id}`);
    assert.match(lines[fact - 1], /^\s*\/\/ .*https:\/\/\S+|^\s*\/\/ \(/, `source du fait de ${id}`);
    let k = fact - 1; while (/^\s*\/\//.test(lines[k])) k--;
    assert.ok(lines.slice(k + 1, fact).some((l) => /https:\/\/\S+/.test(l)), `URL de source pour ${id}`);
  }
});

test('Équipe préremplie', () => {
  assert.deepEqual(TEAM.map((m) => m.name), ['Nathanael DURAND', 'Damien NIOCHE']);
});

test('Crédits : lecture de vendor/LICENSES.md et du manifeste', () => {
  const libs = parseLicenses(fs.readFileSync(path.join(ROOT, 'public/vendor/LICENSES.md'), 'utf8'));
  assert.deepEqual(libs, [{ name: 'three', version: '0.170.0', license: 'MIT' }, { name: 'astronomy-engine', version: '2.1.19', license: 'MIT' }]);
  assert.deepEqual(parseLicenses('pas de tableau'), []);
  const c = manifestCredits({ files: [{ file: 'a.i16', title: 'A', organism: 'NASA' }, { file: 'b.u8', title: 'B', organism: 'NASA' }, { file: '../assets/logo.webp', title: 'Logo', organism: 'projet' }, { file: 'c.json' }] });
  assert.deepEqual(c, { count: 2, groups: [{ organism: 'NASA', titles: ['A', 'B'] }] });
  assert.deepEqual(manifestCredits(null), { count: 0, groups: [] });
});

// ------------------------------------------------------------------ Traductions
test('i18n : mêmes clés en français et en anglais ; toutes les clés utilisées existent', () => {
  const keysOf = (src) => new Set([...src.matchAll(/'(tools\.[A-Za-z0-9_.]+)'\s*:/g)].map((m) => m[1]));
  for (const file of ['public/js/i18n/tools.js', 'public/js/data/history.js']) {
    const [fr, en] = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\n {2}en: \{/);
    assert.ok(en, `${file} : bloc anglais introuvable`);
    const a = keysOf(fr), b = keysOf(en);
    assert.deepEqual([...a].filter((k) => !b.has(k)), [], `${file} : clés sans anglais`);
    assert.deepEqual([...b].filter((k) => !a.has(k)), [], `${file} : clés sans français`);
  }
  const used = new Set();
  for (const file of ['ui/importer.js', 'ui/measure.js', 'ui/modals.js', 'ui/demo.js']) {
    for (const m of fs.readFileSync(path.join(ROOT, 'public/js', file), 'utf8').matchAll(/'(tools\.[A-Za-z0-9_.]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);
  }
  // Clés complétées par un suffixe dans le code (« .help », « .short ») : on vérifie les deux formes.
  const missing = [...used].filter((k) => !has(k) && !(has(k + '.short') && has(k + '.help')));
  assert.deepEqual(missing, []);
  for (const code of ['unsupported', 'too_big', 'read', 'empty', 'json', 'not_geojson', 'crs', 'no_features', 'one_column', 'no_rows']) assert.ok(has('tools.import.err.' + code), code);
  for (const code of ['out_of_range', 'coords_invalid', 'not_feature', 'geom_null', 'geom_unsupported', 'short_row', 'lat_invalid', 'lon_invalid']) assert.ok(has('tools.import.rej.' + code), code);
  for (const code of ['crs_assumed', 'crs_earth', 'z_ignored', 'holes_ignored']) assert.ok(has('tools.import.warn.' + code), code);
  for (const code of ['no_header', 'ambiguous', 'xy', 'not_found']) assert.ok(has('tools.import.detect.' + code), code);
  for (const c of imp.IMPORT_COLORS) { assert.ok(has('tools.import.color.' + c.key)); assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/); }
  assert.equal(new Set(imp.IMPORT_COLORS.map((c) => c.hex)).size, imp.IMPORT_COLORS.length);
});

console.log(`${passed} test(s) réussi(s), ${failures.length} échec(s), ${checks} contrôles exécutés`);
if (failures.length) process.exit(1);
