// Vue « Globe 3D » : la Lune entière, éclairée depuis la direction réelle du Soleil, avec la Terre, les
// sites, les calques globaux et le cube d'orientation.
//
// Repère : celui de core/coords.js (rayon lunaire = 1 ; +Y nord, +Z longitude 0°, +X 90° Est). La Lune est
// fixe ; le Soleil et la Terre sont placés d'après les éphémérides à `state.timeMs`.
// La boucle d'animation ne tourne que lorsque la vue est active, et ne redessine que si quelque chose a changé.
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { state, set, on, select } from '../core/store.js';
import { t, num, meters } from '../core/i18n.js';
import { latLonToThree, threeToLatLon, meToThree, threeToMe, fmtLatLon, DEG } from '../core/coords.js';
import { subPoints } from '../science/ephemeris.js';
import { pointInfo } from '../science/engine.js';
import { layers } from '../layers/manager.js';
import { cat, cssGradient, NODATA_RGB } from '../layers/palettes.js';
import { siteSelection } from '../data/sites.js';
import { h, clear, provTag, throttle } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import '../i18n/globe.js';
import { createViewCube } from './viewcube.js';
import { litSphereMaterial } from './globe/materials.js';
import { createStars, createSystem, DISPLAY } from './globe/system.js';
import { createMarkers } from './globe/markers.js';
import { loadLayerData, overlaySize, overlayNote, paintOverlay } from './globe/overlay.js';
import { makeCanvas, canvasTexture, legendSwatch, KIND_SHAPE } from './globe/draw.js';

const FOV = 40, MIN_DIST = 1.4, MAX_DIST = 120;
const FLY_MS = 800;
const TEMP_REFRESH_MS = 500;                 // le modèle de température est repeint au plus 2 fois par seconde
const SITE_LAYERS = { sites_artemis: 'artemis', sites_historic: 'historic', sites_missions: 'mission' };
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Vue de remplacement quand WebGL 2 est absent. */
function unsupported(container) {
  const msg = h('div', { class: 'empty globe-nowebgl' });
  const write = () => { msg.textContent = t('globe.noWebgl'); };
  write(); on('change:lang', write);
  container.append(msg);
  return { setActive() {}, resize() {}, flyTo() {}, snapshot() { return null; } };
}

/**
 * @param {HTMLElement} container
 * @returns {{setActive(on:boolean):void, resize():void, flyTo(lat:number, lon:number):void, snapshot():string|null, inspect():object}}
 */
export function createGlobe(container) {
  container.classList.add('globe');
  const canvas = h('canvas', { class: 'globe-canvas', tabindex: '0' });
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return unsupported(container);

  // ------------------------------------------------------------------ Scène
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 1000);
  scene.add(createStars());

  // Lune : 256 × 256 segments. La sphère de Three.js place u = 0,5 (centre de la texture, longitude 0°)
  // vers +X ; un quart de tour de la géométrie l'amène vers +Z, où core/coords.js place la longitude 0°.
  const moonGroup = new THREE.Group(); moonGroup.name = 'moon';
  const sphere = new THREE.SphereGeometry(1, 256, 256);
  sphere.rotateY(-Math.PI / 2);
  const placeholder = new THREE.DataTexture(new Uint8Array([150, 150, 152, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace; placeholder.needsUpdate = true;
  const moonMat = litSphereMaterial(placeholder, { night: 0.09, gain: 1.25 });
  moonGroup.add(new THREE.Mesh(sphere, moonMat));

  // Surcouche des calques colorés : sphère à peine plus grande, même calage de texture. Un maillage plus léger
  // suffit (ses facettes restent au-dessus de la Lune : flèche de 0,06 % pour 128 × 64 segments, écart de 0,3 %).
  const overlaySphere = new THREE.SphereGeometry(1, 128, 64);
  overlaySphere.rotateY(-Math.PI / 2);
  const overlayMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const overlayMesh = new THREE.Mesh(overlaySphere, overlayMat);
  overlayMesh.scale.setScalar(1.003); overlayMesh.visible = false; overlayMesh.name = 'overlay';
  moonGroup.add(overlayMesh);

  const graticule = buildGraticule();
  moonGroup.add(graticule);
  const markers = createMarkers();
  moonGroup.add(markers.group);
  const system = createSystem(state.cvd);
  scene.add(moonGroup, system.earthGroup, system.sunGroup, system.orbitGroup);

  // ------------------------------------------------------------------ Interface
  const labels = h('div', { class: 'globe-labels', 'aria-hidden': 'true' });
  const mkLabel = (cls) => { const el = h('div', { class: `globe-label ${cls}` }); el.hidden = true; labels.append(el); return el; };
  const lblEarth = mkLabel('is-earth'), lblSun = mkLabel('is-sun'), lblSunTrack = mkLabel('is-track is-sun'), lblEarthTrack = mkLabel('is-track is-earth');
  const lblSel = mkLabel('is-selection'), tip = mkLabel('globe-tip glass');
  const note = h('div', { class: 'float note note-warn globe-note', role: 'status' }); note.hidden = true;

  const zoomBtn = (name, key, fn) => h('button', { type: 'button', class: 'iconbtn boxed', onclick: fn, dataset: { i18nKey: key } }, icon(name));
  const zoomctl = h('div', { class: 'float zoomctl' },
    zoomBtn('plus', 'globe.zoomIn', () => zoomBy(0.7)), zoomBtn('minus', 'globe.zoomOut', () => zoomBy(1 / 0.7)), zoomBtn('target', 'globe.home', goHome));

  const nav = h('div', { class: 'float globe-nav' });
  const cube = createViewCube(nav, { onFace: (f) => flyTo(f.lat, f.lon), onSystemView: systemView });

  const info = h('div', { class: 'glass globe-info' });
  const valSun = h('span', { class: 'kv-v' }), valEarth = h('span', { class: 'kv-v' }), valCursor = h('span', { class: 'kv-v' });
  const keySun = h('span', { class: 'kv-k' }), keyEarth = h('span', { class: 'kv-k' }), keyCursor = h('span', { class: 'kv-k' });
  const noteLight = h('span', { class: 'kv-note' });
  const rowCursor = h('div', { class: 'kv globe-cursor' }, keyCursor, valCursor);
  info.append(h('div', { class: 'kv' }, keySun, valSun, noteLight), h('div', { class: 'kv' }, keyEarth, valEarth), rowCursor);

  const legendBody = h('div', { class: 'globe-legend-body' });
  const legendToggle = h('button', { type: 'button', class: 'globe-legend-toggle', onclick: () => setLegendOpen(legend.classList.contains('is-collapsed')) }, icon('chevron', 14), h('span', {}));
  const legend = h('div', { class: 'float legend glass globe-legend' }, legendToggle, legendBody);
  const bottom = h('div', { class: 'globe-bottom' }, info, legend);
  container.append(canvas, labels, zoomctl, nav, note, bottom);

  // ------------------------------------------------------------------ Caméra et contrôles
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.enablePan = false;                       // la Lune reste au centre
  controls.minDistance = MIN_DIST; controls.maxDistance = MAX_DIST;
  controls.zoomSpeed = 0.9;
  controls.addEventListener('change', invalidate);   // molette et glisser déplacent la caméra hors de la boucle

  let width = 0, height = 0, pxScale = 0.001;       // pxScale : taille d'un pixel d'écran à la distance 1
  let active = false, raf = 0, needsRender = true, ephemDirty = true, frames = 0;
  let fly = null, pending = null, legendAuto = true;
  let sub = null;                                   // dernières éphémérides (subPoints)
  const sunUnit = new THREE.Vector3(0, 0, 1);
  const halfFov = () => { const v = FOV * DEG / 2; return Math.min(v, Math.atan(Math.tan(v) * camera.aspect)); };
  /** Distance d'où la Lune occupe ~72 % du plus petit côté de la vue. */
  const homeDistance = () => 1 / Math.sin(0.72 * halfFov());
  /** Distance d'où l'on voit, du dessus, la Terre, le Soleil et leurs trajectoires. */
  const systemDistance = () => Math.min(MAX_DIST, (DISPLAY.sunDist + DISPLAY.sunSize * 0.6) / Math.tan(halfFov()));

  function invalidate() { needsRender = true; }

  /**
   * Lance une transition de caméra. `dirAt(e, out)` donne la direction (unitaire) à l'avancement e ∈ [0, 1] ;
   * la distance est interpolée en logarithme. `key` identifie la destination (évite de relancer la même).
   */
  function startFly(key, dist, ms, dirAt) {
    fly = { key, dirAt, d0: camera.position.length(), d1: dist, t0: performance.now(), ms };
    controls.enabled = false;
    clearHover();                                    // la surface va bouger sous le pointeur
  }
  /** Annule l'inertie d'OrbitControls : sinon son reste déplacerait la caméra à la fin de la transition. */
  function stopInertia() { controls.enableDamping = false; controls.update(); controls.enableDamping = true; }
  /** Vers une direction quelconque : interpolation sphérique (arc de grand cercle). */
  function flyDir(dir, dist, ms = FLY_MS, key = null) {
    stopInertia();
    const u0 = camera.position.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(u0, dir), qe = new THREE.Quaternion();
    startFly(key, dist, ms, (e, out) => out.copy(u0).applyQuaternion(qe.identity().slerp(q, e)));
  }
  /**
   * Vers l'aplomb d'un pôle : azimut et angle polaire interpolés ensemble, jusqu'à l'azimut 0. L'image arrive ainsi
   * toujours dans le même sens (pôle Sud : longitude 0° vers le haut et 90° Est à droite, comme la carte 2D).
   */
  function flyPole(north, dist, key) {
    stopInertia();
    const s = new THREE.Spherical().setFromVector3(camera.position);
    const dTheta = -Math.atan2(Math.sin(s.theta), Math.cos(s.theta)), phi1 = north ? 1e-3 : Math.PI - 1e-3;
    startFly(key, dist, FLY_MS, (e, out) => out.setFromSphericalCoords(1, s.phi + (phi1 - s.phi) * e, s.theta + dTheta * e));
  }
  function flyTo(lat, lon, dist) {
    if (!active || !width) { pending = { lat, lon, dist }; return; }
    const pole = Math.abs(lat) > 89.9, key = pole ? `pole:${Math.sign(lat)}` : `${lat},${lon}`;
    if (fly && dist === undefined && fly.key === key) return;                // même destination déjà en cours
    const d = camera.position.length();
    const target = dist ?? (d > 2 * homeDistance() ? homeDistance() : d);     // on revient d'une vue lointaine
    if (pole) flyPole(lat > 0, target, key);
    else flyDir(new THREE.Vector3().fromArray(latLonToThree(lat, lon)), target, FLY_MS, key);
  }
  function zoomBy(f) { flyDir(camera.position.clone().normalize(), THREE.MathUtils.clamp(camera.position.length() * f, MIN_DIST, MAX_DIST), 260); }
  function goHome() { const c = threeToLatLon(camera.position.x, camera.position.y, camera.position.z); flyTo(c.lat, c.lon, homeDistance()); }
  function systemView() { flyTo(90, 0, systemDistance()); }
  /** Rotation au clavier (pas en degrés) autour de la Lune. */
  function nudge(dAz, dPolar) {
    const s = new THREE.Spherical().setFromVector3(camera.position);
    s.theta += dAz * DEG; s.phi = THREE.MathUtils.clamp(s.phi + dPolar * DEG, 1e-3, Math.PI - 1e-3);
    flyDir(new THREE.Vector3().setFromSpherical(s).normalize(), s.radius, 180);
  }

  // ------------------------------------------------------------------ Texture de la Lune
  function loadMoonTexture() {
    // 4k (4096 × 2048) si la carte graphique l'accepte, sinon 2k ; 2k aussi si le fichier 4k manque
    const files = renderer.capabilities.maxTextureSize >= 4096 ? ['data/moon_color_4k.jpg', 'data/moon_color_2k.jpg'] : ['data/moon_color_2k.jpg'];
    const loader = new THREE.TextureLoader();
    const attempt = (i) => {
      if (i >= files.length) { note.textContent = t('globe.noTexture'); note.hidden = false; return; }
      loader.load(files[i], (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping;           // pas de couture au méridien ±180°
        moonMat.uniforms.map.value = tex; moonMat.userData.file = files[i];
        placeholder.dispose();
        invalidate();
      }, undefined, () => attempt(i + 1));
    };
    attempt(0);
  }

  // ------------------------------------------------------------------ Grille
  function buildGraticule() {
    const pts = [], R = 1.004, STEP = 2;
    const seg = (a, b) => { pts.push(...latLonToThree(a[0], a[1], R), ...latLonToThree(b[0], b[1], R)); };
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += STEP) seg([lat, lon], [lat + STEP, lon]);
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += STEP) seg([lat, lon], [lat, lon + STEP]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xa9c4ee, transparent: true, depthWrite: false }));
    lines.name = 'graticule';
    return lines;
  }

  // ------------------------------------------------------------------ Calques
  const overlay = { layer: null, texture: null, textureFor: null, painted: '', loading: false, token: 0 };
  function disposeOverlayTexture() {
    overlay.texture?.dispose();
    overlay.texture = null; overlay.textureFor = null; overlay.painted = '';
    overlayMat.map = null; overlayMesh.visible = false;
  }
  /** Peint le calque coloré actif (le plus haut de la pile) ; ne repeint que si le calque, la palette ou les données ont changé. */
  async function syncOverlay(activeLayers) {
    const layer = activeLayers.filter((l) => l.palette).at(-1) || null;
    overlay.layer = layer;
    const token = ++overlay.token;
    if (!layer) { overlay.loading = false; disposeOverlayTexture(); return; }
    overlayMat.opacity = layer.opacity;
    const key = `${layer.id}|${state.cvd}`;
    if (overlay.painted === key) return;
    overlay.loading = true;
    let data = null;
    try { data = await loadLayerData(layer); } catch { /* jeu absent : le gestionnaire retire le calque (layers:change) */ }
    if (token !== overlay.token) return;                      // une demande plus récente a pris le relais
    overlay.loading = false;
    if (!data && layer.id !== 'g_temp') { disposeOverlayTexture(); renderLegend(); invalidate(); return; }
    if (ephemDirty) updateEphemeris();                         // direction du Soleil à jour pour le modèle de température
    if (overlay.textureFor !== layer.id) {
      disposeOverlayTexture();
      const [w, hgt] = overlaySize(layer);
      overlay.texture = canvasTexture(makeCanvas(w, hgt));
      overlay.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      overlay.texture.wrapS = THREE.RepeatWrapping;
      overlay.textureFor = layer.id;
      overlayMat.map = overlay.texture; overlayMat.needsUpdate = true;
    }
    paintOverlay(overlay.texture.image, layer, data, state.cvd, { sunUnit: threeToMe(sunUnit.toArray()) });
    overlay.texture.needsUpdate = true;
    overlay.painted = key;
    overlayMesh.visible = true;
    renderLegend(); invalidate();
  }
  /** Le modèle de température suit la date : repeint dans la même texture, au plus 2 fois par seconde. */
  const repaintTemp = throttle(() => {
    if (overlay.layer?.id !== 'g_temp' || overlay.textureFor !== 'g_temp') return;
    paintOverlay(overlay.texture.image, overlay.layer, null, state.cvd, { sunUnit: threeToMe(sunUnit.toArray()) });
    overlay.texture.needsUpdate = true; invalidate();
  }, TEMP_REFRESH_MS);

  function syncMarkers(activeLayers = layers.active('globe')) {
    const ids = new Set(activeLayers.map((l) => l.id));
    const kinds = new Set(Object.entries(SITE_LAYERS).filter(([id]) => ids.has(id)).map(([, kind]) => kind));
    markers.sync({ cvd: state.cvd, kinds, selection: state.selection, compare: state.compare, imports: ids.has('imports') ? state.imports : null });
    lblSel.textContent = state.selection ? state.selection.name : '';
    invalidate();
  }
  function syncLayers() {
    const act = layers.active('globe');
    const get = (id) => act.find((l) => l.id === id);
    moonMat.uniforms.daylight.value = get('g_daylight') ? 1 : 0;
    graticule.visible = !!get('graticule'); graticule.material.opacity = 0.55 * (get('graticule')?.opacity ?? 0);
    const orbits = !!get('orbits');
    system.earthGroup.visible = system.sunGroup.visible = system.orbitGroup.visible = orbits;
    syncMarkers(act);
    syncOverlay(act);
    renderLegend(); writeInfo(); invalidate();
  }

  // ------------------------------------------------------------------ Légende et encart d'information
  function setLegendOpen(open) { legendAuto = false; legend.classList.toggle('is-collapsed', !open); legendToggle.setAttribute('aria-expanded', String(open)); }
  /** « 0 % FeO » (français) / « 0% FeO » (anglais) ; les autres unités gardent l'espace. */
  const withUnit = (v, unit) => `${num(v, 0)}${unit.startsWith('%') && state.lang === 'en' ? '' : ' '}${unit}`;
  function renderLegend() {
    legendToggle.lastChild.textContent = t('globe.legend'); legendToggle.title = t('globe.legend.toggle');
    clear(legendBody);
    const act = layers.active('globe'), has = (id) => act.some((l) => l.id === id);
    const item = (...kids) => { const el = h('div', { class: 'legend-item' }, kids); legendBody.append(el); return el; };
    const title = (text, status, help) => h('div', { class: 'globe-legend-title' }, h('span', {}, text), provTag(status, help));
    const L = overlay.layer;
    if (L) {
      const kind = overlayNote(L);
      item(title(t(`layer.${L.id}`), L.status),
        overlay.loading ? h('div', { class: 'muted' }, t('ui.loading')) : [
          h('div', { class: 'legend-bar', style: { background: cssGradient(L.palette, state.cvd) } }),
          h('div', { class: 'legend-scale' }, h('span', {}, withUnit(L.range[0], L.unit)), h('span', {}, withUnit(L.range[1], L.unit))),
          kind ? h('div', { class: 'globe-legend-note' }, t(`globe.legend.${kind}`)) : null,
          kind === 'cells' || kind === 'halfdeg' ? h('div', { class: 'globe-legend-row' }, h('i', { class: 'swatch', style: { background: `rgb(${NODATA_RGB.join(',')})` } }), t('ui.noData')) : null,
        ]);
    }
    if (has('orbits')) {
      const line = (name) => h('span', {}, h('i', { class: 'globe-line', style: { borderColor: cat(name, state.cvd) } }), t(`body.${name}`));
      item(title(t('layer.orbits'), 'illustrative', t('globe.legend.system.help')), h('div', { class: 'globe-legend-row' }, line('sun'), line('earth')),
        h('div', { class: 'globe-legend-note' }, t('globe.legend.system')));
    }
    const kinds = Object.entries(SITE_LAYERS).filter(([id]) => has(id)).map(([, kind]) => kind);
    if (kinds.length || state.compare.length) {
      item(kinds.map((kind) => h('div', { class: 'globe-legend-row' }, legendSwatch(KIND_SHAPE[kind], cat(kind, state.cvd)), h('span', {}, t(`kind.${kind}`)),
        kind === 'artemis' ? provTag('estimate', t('globe.legend.approx')) : null)),
      state.compare.length ? h('div', { class: 'globe-legend-row' }, h('b', { class: 'globe-abc' }, 'A B C'), t('globe.legend.compare')) : null);
    }
    legend.hidden = !legendBody.childElementCount;
  }

  const pos = (p, d = 1) => fmtLatLon(p.lat, p.lon, d, state.lang);
  function writeInfo() {
    keySun.textContent = t('globe.subsolar'); keySun.title = t('globe.subsolar.help');
    keyEarth.textContent = t('globe.subearth'); keyEarth.title = t('globe.subearth.help');
    keyCursor.textContent = t('globe.cursor');
    if (sub) {
      clear(valSun).append(pos(sub.subsolar), provTag('computed'));
      clear(valEarth).append(pos(sub.subearth), provTag('computed'));
      lblEarth.textContent = t('globe.earthDist', { km: num(sub.earthDistKm, 0) });
      lblSun.textContent = t('globe.sunDist', { mkm: num(sub.sunDistKm / 1e6, 1) });
    }
    lblSunTrack.textContent = t('globe.sunTrack'); lblEarthTrack.textContent = t('globe.earthTrack');
    noteLight.textContent = moonMat.uniforms.daylight.value ? '' : `(${t('globe.uniformLight')})`;
    writeCursor();
  }
  const writeInfoSoon = throttle(writeInfo, 120);
  let cursor = null;
  function writeCursor() {
    clear(valCursor);
    if (!cursor) { valCursor.append('—'); return; }
    const hM = pointInfo(cursor.lat, cursor.lon).heightM;
    valCursor.append(pos(cursor, 2));
    if (Number.isFinite(hM)) valCursor.append(` · ${meters(hM)}`, provTag('measured'));
  }

  // ------------------------------------------------------------------ Éphémérides
  function updateEphemeris() {
    ephemDirty = false;
    sub = subPoints(new Date(state.timeMs));
    const s = threeDir(sub.sunVec);
    sunUnit.copy(s); moonMat.uniforms.sunDir.value.copy(s);
    system.update(sub, state.timeMs);
    writeInfoSoon();
    if (overlay.layer?.id === 'g_temp') repaintTemp();
  }
  /** Vecteur du repère lunaire (km) -> direction unitaire dans la scène. */
  function threeDir(v) { return new THREE.Vector3().fromArray(meToThree(v, 1 / Math.hypot(v[0], v[1], v[2]))); }

  // ------------------------------------------------------------------ Pointeur : survol, clic, lancer de rayon
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), moonSphere = new THREE.Sphere(new THREE.Vector3(), 1), hit = new THREE.Vector3();
  let down = null, hoverSite = null, lastPointer = null;
  function castRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    raycaster.setFromCamera(ndc, camera);
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  /** Sous le pointeur : un site (marqueur) et/ou un point de la surface. */
  function probe(e) {
    const at = castRay(e);
    const site = markers.pick(raycaster.ray, camera.position, pxScale, e.pointerType === 'touch' ? 22 : 11);
    const p = raycaster.ray.intersectSphere(moonSphere, hit);
    return { at, site, point: p ? threeToLatLon(p.x, p.y, p.z) : null };
  }
  const onHover = throttle(() => {              // ~15 fois par seconde
    if (!lastPointer || !active) return;
    const { at, site, point } = probe(lastPointer);
    if (site !== hoverSite) { hoverSite = site; markers.setHover(site?.id ?? null); invalidate(); }
    container.classList.toggle('is-pointing', !!site);
    tip.hidden = !site;
    if (site) {
      clear(tip).append(h('b', {}, site.name), h('span', {}, t(`kind.${site.kind}`) + (site.approx ? ` · ${t('globe.legend.approx')}` : '')));
      const left = at.x > width - 260, above = at.y > height - 90;        // l'étiquette reste dans la vue
      tip.style.transform = `translate(${Math.round(at.x + (left ? -14 : 14))}px, ${Math.round(at.y + (above ? -14 : 14))}px) translate(${left ? '-100%' : '0'}, ${above ? '-100%' : '0'})`;
    }
    cursor = point; writeCursor();
    set({ hover: point });
  }, 66);
  function clearHover() {
    lastPointer = null; cursor = null; hoverSite = null;
    markers.setHover(null); tip.hidden = true; container.classList.remove('is-pointing');
    writeCursor(); set({ hover: null }); invalidate();
  }
  // Capture : passe avant OrbitControls, pour qu'un appui pendant une transition rende aussitôt la main
  canvas.addEventListener('pointerdown', (e) => {
    if (fly) { fly = null; controls.enabled = true; }
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    container.classList.add('is-dragging');
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && e.buttons === 0) { lastPointer = e; onHover(); }
  });
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('pointerup', (e) => {
    container.classList.remove('is-dragging');
    const d = down; down = null;
    if (!d || d.id !== e.pointerId || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;   // c'était un glisser
    const { site, point } = probe(e);
    if (site) select(siteSelection(site));
    else if (point) select({ name: fmtLatLon(point.lat, point.lon, 2, state.lang), lat: point.lat, lon: point.lon, kind: 'point' });
  });
  canvas.addEventListener('pointercancel', () => { down = null; container.classList.remove('is-dragging'); });
  canvas.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
    if (k) { nudge(k[0], k[1]); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') zoomBy(0.7);
    else if (e.key === '-') zoomBy(1 / 0.7);
  });
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', invalidate);

  // ------------------------------------------------------------------ Rendu
  const proj = new THREE.Vector3();
  /** Vrai si la Lune (sphère unité) cache le point vu de la caméra. */
  function hiddenByMoon(p) {
    const c = camera.position, dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const a = dx * dx + dy * dy + dz * dz, b = 2 * (c.x * dx + c.y * dy + c.z * dz), cc = c.lengthSq() - 1;
    const disc = b * b - 4 * a * cc;
    if (disc <= 0) return false;
    const s = (-b - Math.sqrt(disc)) / (2 * a);
    return s > 0 && s < 0.999;
  }
  /** Place une étiquette HTML, centrée, près d'un point de la scène (masquée hors champ ou derrière la Lune). */
  function placeLabel(el, p, dy, show) {
    let ok = show && !hiddenByMoon(p);
    if (ok) { proj.copy(p).project(camera); ok = proj.z < 1 && Math.abs(proj.x) < 1 && Math.abs(proj.y) < 1; }
    el.hidden = !ok;
    if (!ok) return;
    const half = el.offsetWidth / 2 + 4;                                       // l'étiquette reste entière dans la vue
    const x = Math.max(half, Math.min(width - half, (proj.x + 1) / 2 * width));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round((1 - proj.y) / 2 * height + dy)}px) translate(-50%, -50%)`;
  }
  const selPos = new THREE.Vector3();
  function renderFrame() {
    const d = camera.position.length();
    camera.near = Math.max(0.05, d * 0.02); camera.updateProjectionMatrix();     // précision de profondeur en vue lointaine
    controls.rotateSpeed = THREE.MathUtils.clamp((d - 1) / (homeDistance() - 1), 0.06, 1);
    // De loin (vue système), les marqueurs rapetissent puis disparaissent : ils couvriraient la Lune
    const shrink = Math.min(1, 1.6 * homeDistance() / d), sitesShown = shrink >= 0.4;
    markers.frame(pxScale * shrink, sitesShown ? hiddenByMoon : () => true);
    const orbits = system.orbitGroup.visible;
    for (const s of system.surfaceSprites) { s.visible = !hiddenByMoon(s.position); s.scale.setScalar(s.userData.px * pxScale * Math.max(0.6, shrink)); }
    const earthPx = DISPLAY.earthRadius / (camera.position.distanceTo(system.earthPos) * pxScale);
    placeLabel(lblEarth, system.earthPos, -earthPx - 13, orbits);
    placeLabel(lblEarthTrack, system.earthPos, earthPx + 14, orbits && d > 8);
    placeLabel(lblSun, system.sunPos, -24, orbits);
    placeLabel(lblSunTrack, system.sunTrackLabelPos, -10, orbits && d > 8);
    const sel = state.selection;
    if (sel) selPos.fromArray(latLonToThree(sel.lat, sel.lon, 1.01));
    placeLabel(lblSel, selPos, 20, !!sel && sitesShown);
    cube.sync(camera, threeToLatLon(camera.position.x, camera.position.y, camera.position.z));
    renderer.render(scene, camera);
    frames++;
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.ms), e = easeInOut(k);
      fly.dirAt(e, camera.position).multiplyScalar(Math.exp(Math.log(fly.d0) + (Math.log(fly.d1) - Math.log(fly.d0)) * e));
      camera.lookAt(0, 0, 0);
      if (k >= 1) { fly = null; controls.enabled = true; }
      needsRender = true;
    } else if (controls.update()) needsRender = true;
    if (ephemDirty) { updateEphemeris(); needsRender = true; }
    if (!needsRender) return;
    needsRender = false;
    renderFrame();
  }

  // ------------------------------------------------------------------ API
  function resize() {
    const w = container.clientWidth, hgt = container.clientHeight;
    if (!w || !hgt) return;
    const first = !width;
    width = w; height = hgt;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
    pxScale = 2 * Math.tan(FOV * DEG / 2) / hgt;
    if (legendAuto) { legend.classList.toggle('is-collapsed', w < 720); legendToggle.setAttribute('aria-expanded', String(w >= 720)); }
    if (first) {
      // Première vue : le lieu sélectionné s'il y en a un, sinon la face visible, légèrement vue du sud
      const start = pending || state.selection || { lat: -18, lon: 8 };
      pending = null;
      camera.position.fromArray(latLonToThree(Math.max(-89.9, Math.min(89.9, start.lat)), start.lon, homeDistance()));
      camera.lookAt(0, 0, 0); controls.update();
    }
    invalidate();
  }
  function setActive(v) {
    if (v === active) return;
    active = v;
    cancelAnimationFrame(raf);
    if (!active) { clearHover(); return; }
    resize();
    ephemDirty = true; invalidate();
    if (pending) { const p = pending; pending = null; flyTo(p.lat, p.lon, p.dist); }
    raf = requestAnimationFrame(tick);
  }
  function snapshot() {
    if (!width) return null;
    if (ephemDirty) updateEphemeris();
    renderFrame();                                  // même tâche que toDataURL : le tampon de dessin est encore valide
    return canvas.toDataURL('image/png');
  }
  /** Diagnostic (tests, contrôle de la mémoire) : compteurs du moteur de rendu et projection d'un lieu à l'écran. */
  function inspect() {
    return {
      frames, active, moonTexture: moonMat.userData.file || null, overlay: overlay.textureFor,
      memory: { ...renderer.info.memory }, cameraDistance: camera.position.length(),
      center: threeToLatLon(camera.position.x, camera.position.y, camera.position.z),
      project(lat, lon) {
        const p = new THREE.Vector3().fromArray(latLonToThree(lat, lon, 1.01)), visible = !hiddenByMoon(p);
        p.project(camera);
        return { x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, visible };
      },
    };
  }

  // ------------------------------------------------------------------ Abonnements
  function texts() {
    canvas.setAttribute('aria-label', t('globe.canvasLabel'));
    for (const b of zoomctl.children) { b.title = t(b.dataset.i18nKey); b.setAttribute('aria-label', b.title); }
    if (!note.hidden) note.textContent = t('globe.noTexture');
    renderLegend(); writeInfo(); invalidate();
  }
  on('change:timeMs', () => { ephemDirty = true; });
  on('change:lang', texts);
  on('change:cvd', () => { overlay.painted = ''; system.setCvd(state.cvd); syncLayers(); });
  on('layers:change', syncLayers);
  on('sites:ready', () => syncMarkers());
  on('change:selection', (s) => { syncMarkers(); if (s) flyTo(s.lat, s.lon); });
  on('change:compare', () => { syncMarkers(); renderLegend(); });
  on('change:imports', () => syncMarkers());
  on('view:flyTo', (p) => { if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) flyTo(p.lat, p.lon); });
  new ResizeObserver(() => { if (active) resize(); }).observe(container);
  if (window.matchMedia('(hover: none)').matches) rowCursor.hidden = true;   // pas de survol sur écran tactile

  loadMoonTexture();
  texts();
  syncLayers();
  return { setActive, resize, flyTo: (lat, lon) => flyTo(lat, lon), snapshot, inspect };
}
