// Marqueurs posés sur le globe : sites (une forme par type), lieu sélectionné (anneau),
// scénarios comparés (pastilles A/B/C) et données importées (points, lignes, polygones).
//
// Les sprites gardent une taille constante à l'écran (sizeAttenuation: false) et ne sont pas testés en
// profondeur : la vue les masque elle-même quand ils passent derrière la Lune (voir frame()).
import * as THREE from 'three';
import { latLonToThree, greatCirclePoint, surfaceDistance, RAD } from '../../core/coords.js';
import { cat } from '../../layers/palettes.js';
import { LANDING_SITES } from '../../data/sites.js';
import { makeCanvas, canvasTexture, drawMarker, drawRing, drawBadge, KIND_SHAPE } from './draw.js';

const R_SPRITE = 1.01, R_LINE = 1.005;
const SIZE_PX = { artemis: 17, historic: 15, mission: 16, import: 11, cross: 16, ring: 32, badge: 26 };
const LETTERS = 'ABC';

export function createMarkers() {
  const group = new THREE.Group(); group.name = 'markers';
  const pool = new Map();        // clé -> {material, used} : un matériau (et sa texture) par forme et couleur
  let sprites = [], siteSprites = [], lines = [];
  let hoverId = null;

  function material(key, draw) {
    let e = pool.get(key);
    if (!e) {
      e = { material: new THREE.SpriteMaterial({ map: canvasTexture(draw(makeCanvas(64, 64))), sizeAttenuation: false, depthTest: false, transparent: true }) };
      pool.set(key, e);
    }
    e.used = true;
    return e.material;
  }
  function addSprite(mat, px, lat, lon, order, data = {}) {
    const s = new THREE.Sprite(mat);
    s.position.fromArray(latLonToThree(lat, lon, R_SPRITE));
    s.renderOrder = order;
    s.userData = { px, ...data };
    group.add(s); sprites.push(s);
    return s;
  }
  /** Ligne posée sur la surface, densifiée le long des grands cercles (un point tous les 2° au plus). */
  function addLine(coords, color, closed) {
    const pts = [], list = closed ? [...coords, coords[0]] : coords;
    for (let i = 0; i < list.length; i++) {
      const [lat, lon] = list[i];
      if (i > 0) {
        const [lat0, lon0] = list[i - 1];
        const n = Math.ceil(surfaceDistance(lat0, lon0, lat, lon, 1) * RAD / 2);
        for (let k = 1; k < n; k++) { const p = greatCirclePoint(lat0, lon0, lat, lon, k / n); pts.push(...latLonToThree(p.lat, p.lon, R_LINE)); }
      }
      pts.push(...latLonToThree(lat, lon, R_LINE));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    group.add(line); lines.push(line);
  }

  /**
   * Reconstruit tous les marqueurs.
   * @param {{cvd:string, kinds:Set<string>, selection:object|null, compare:object[], imports:object[]|null}} v
   *   kinds = types de sites affichés ; imports = null si le calque est éteint
   */
  function sync(v) {
    for (const s of sprites) group.remove(s);
    for (const l of lines) { group.remove(l); l.geometry.dispose(); l.material.dispose(); }
    sprites = []; siteSprites = []; lines = [];
    for (const e of pool.values()) e.used = false;

    for (const site of LANDING_SITES) {
      if (!v.kinds.has(site.kind)) continue;
      const color = cat(site.kind, v.cvd), shape = KIND_SHAPE[site.kind];
      siteSprites.push(addSprite(material(`${shape}|${color}`, (c) => drawMarker(c, shape, color)), SIZE_PX[site.kind], site.lat, site.lon, 5, { site }));
    }
    for (const imp of v.imports || []) {
      const color = imp.color || cat('import', v.cvd);
      for (const f of imp.features || []) {
        if (!f.coords?.length) continue;
        if (f.type === 'point') for (const [lat, lon] of f.coords) addSprite(material(`square|${color}`, (c) => drawMarker(c, 'square', color)), SIZE_PX.import, lat, lon, 4);
        else addLine(f.coords, color, f.type === 'polygon');
      }
    }
    const sel = v.selection;
    if (sel) {
      // Croix au point exact si aucun marqueur de site n'y est affiché (point libre, formation, calque éteint)
      if (!siteSprites.some((s) => s.userData.site.id === sel.siteId)) {
        const color = cat('point', v.cvd);
        addSprite(material(`cross|${color}`, (c) => drawMarker(c, 'cross', color)), SIZE_PX.cross, sel.lat, sel.lon, 6);
      }
      addSprite(material('ring', drawRing), SIZE_PX.ring, sel.lat, sel.lon, 6);
    }
    v.compare.forEach((c, i) => {
      const color = cat(LETTERS[i].toLowerCase(), v.cvd);
      const s = addSprite(material(`badge|${LETTERS[i]}|${color}`, (cv) => drawBadge(cv, LETTERS[i], color)), SIZE_PX.badge, c.lat, c.lon, 7);
      // Pointe de la pastille au-dessus du lieu ; même lieu à plusieurs dates : pastilles côte à côte
      const same = v.compare.slice(0, i).filter((o) => o.lat === c.lat && o.lon === c.lon).length;
      s.center.set(0.5 - 0.85 * same, -0.3);
    });

    for (const [key, e] of pool) if (!e.used) { e.material.map.dispose(); e.material.dispose(); pool.delete(key); }
    setHover(hoverId);
  }

  function setHover(id) {
    hoverId = id;
    for (const s of siteSprites) s.userData.hover = s.userData.site.id === id;
  }

  /**
   * Site sous le rayon du pointeur : le marqueur visible dont le centre est le plus proche du rayon,
   * à moins de `tolPx` pixels. `pxScale` = taille (à distance 1) d'un pixel d'écran.
   */
  function pick(ray, cameraPos, pxScale, tolPx) {
    let best = null, bestPx = tolPx;
    for (const s of siteSprites) {
      if (!s.visible) continue;
      const px = Math.sqrt(ray.distanceSqToPoint(s.position)) / (pxScale * s.position.distanceTo(cameraPos));
      if (px <= bestPx) { bestPx = px; best = s.userData.site; }
    }
    return best;
  }

  /** À chaque image : taille constante à l'écran et masquage derrière la Lune. */
  function frame(pxScale, isHidden) {
    for (const s of sprites) {
      s.visible = !isHidden(s.position);
      s.scale.setScalar(s.userData.px * pxScale * (s.userData.hover ? 1.35 : 1));
    }
  }

  return { group, sync, setHover, pick, frame };
}
