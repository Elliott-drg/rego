// Fond d'étoiles, Terre, Soleil et trajectoires autour de la Lune.
//
// La scène est dans le repère lunaire fixe : la Lune ne tourne pas, ce sont le Soleil et la Terre qui se
// déplacent. Les DIRECTIONS sont celles des éphémérides (science/ephemeris.js) ; les DISTANCES et les
// TAILLES sont comprimées pour tenir à l'écran (Terre réelle : ~221 rayons lunaires ; Soleil : ~86 000).
import * as THREE from 'three';
import { meToThree } from '../../core/coords.js';
import { bodiesInMoonFrame, SYNODIC_MONTH_DAYS } from '../../science/ephemeris.js';
import { cat } from '../../layers/palettes.js';
import { seededRandom, makeCanvas, canvasTexture, drawEarth, drawSunGlow, drawSubPoint } from './draw.js';
import { litSphereMaterial } from './materials.js';

/** Distances et tailles d'affichage, en rayons lunaires (illustratif). */
export const DISPLAY = { earthDist: 7, earthRadius: 0.5, sunDist: 11.5, sunSize: 2.6 };
const TRACK_POINTS = 240;
const TRACK_SPAN_MS = SYNODIC_MONTH_DAYS * 86400000;
const TRACK_REFRESH_MS = 6 * 3600000;       // la trajectoire est recentrée quand la date a bougé de plus de 6 h

const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };

/** 2 000 étoiles réparties uniformément sur une grande sphère (graine fixe). */
export function createStars(count = 2000, seed = 20261115) {
  const rnd = seededRandom(seed);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 400, z * 400, r * Math.sin(a) * 400], i * 3);
    const b = 0.25 + 0.75 * rnd() ** 2.2, warm = rnd();          // peu d'étoiles brillantes, teintes légèrement variées
    col.set([b * (0.9 + 0.1 * warm), b * 0.93, b * (1 - 0.12 * warm)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  stars.name = 'stars';
  stars.frustumCulled = false;
  return stars;
}

function trackLine(color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACK_POINTS * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false;
  return line;
}
function dashedLine(color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.75 }));
  line.frustumCulled = false;
  return line;
}
function subPointSprite(body, color) {
  const canvas = makeCanvas(64, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(drawSubPoint(canvas, body, color)), sizeAttenuation: false, depthTest: false, transparent: true }));
  sprite.renderOrder = 4;
  sprite.userData = { body, canvas, px: 22 };
  return sprite;
}

/**
 * @returns {{earthGroup:THREE.Group, sunGroup:THREE.Group, orbitGroup:THREE.Group, surfaceSprites:THREE.Sprite[],
 *   update(sub:object, timeMs:number):void, setCvd(cvd:string):void,
 *   earthPos:THREE.Vector3, sunPos:THREE.Vector3, sunTrackLabelPos:THREE.Vector3}}
 */
export function createSystem(cvd) {
  // --- Terre : petite sphère éclairée par le même Soleil ---
  const earthGroup = new THREE.Group(); earthGroup.name = 'earth';
  const earthTex = canvasTexture(drawEarth(makeCanvas(512, 256)));
  const earthMat = litSphereMaterial(earthTex, { night: 0.04, gain: 1.15 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(DISPLAY.earthRadius, 48, 32), earthMat);
  earthGroup.add(earth);

  // --- Soleil : disque lumineux ---
  const sunGroup = new THREE.Group(); sunGroup.name = 'sun';
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(drawSunGlow(makeCanvas(256, 256))), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sun.scale.setScalar(DISPLAY.sunSize);
  sunGroup.add(sun);

  // --- Trajectoires sur une lunaison, lignes de direction, points subsolaire et sub-terrestre ---
  const orbitGroup = new THREE.Group(); orbitGroup.name = 'orbits';
  const sunTrack = trackLine(cat('sun', cvd)), earthTrack = trackLine(cat('earth', cvd));
  const sunRay = dashedLine(cat('sun', cvd)), earthRay = dashedLine(cat('earth', cvd));
  const subSun = subPointSprite('sun', cat('sun', cvd)), subEarth = subPointSprite('earth', cat('earth', cvd));
  orbitGroup.add(sunTrack, earthTrack, sunRay, earthRay, subSun, subEarth);

  const api = {
    earthGroup, sunGroup, orbitGroup, surfaceSprites: [subSun, subEarth],
    earthPos: new THREE.Vector3(), sunPos: new THREE.Vector3(),
    sunTrackLabelPos: new THREE.Vector3(),
    update, setCvd,
  };
  let trackTimeMs = NaN;

  function setRay(line, dir, dist) {
    const p = line.geometry.attributes.position;
    p.setXYZ(0, dir[0] * 1.02, dir[1] * 1.02, dir[2] * 1.02); p.setXYZ(1, dir[0] * dist, dir[1] * dist, dir[2] * dist);
    p.needsUpdate = true; line.computeLineDistances();
  }

  /** Trajectoires apparentes sur une lunaison centrée sur la date : directions réelles, distance d'affichage fixe. */
  function updateTracks(timeMs) {
    trackTimeMs = timeMs;
    const ps = sunTrack.geometry.attributes.position, pe = earthTrack.geometry.attributes.position;
    for (let i = 0; i < TRACK_POINTS; i++) {
      const b = bodiesInMoonFrame(new Date(timeMs + (i / (TRACK_POINTS - 1) - 0.5) * TRACK_SPAN_MS));
      const s = meToThree(unit(b.sun), DISPLAY.sunDist), e = meToThree(unit(b.earth), DISPLAY.earthDist);
      ps.setXYZ(i, s[0], s[1], s[2]); pe.setXYZ(i, e[0], e[1], e[2]);
      if (i === 0) api.sunTrackLabelPos.set(s[0], s[1], s[2]);                    // il y a une demi-lunaison : côté opposé au Soleil
    }
    ps.needsUpdate = true; pe.needsUpdate = true;
  }

  /** @param sub résultat de subPoints(date) @param timeMs date simulée */
  function update(sub, timeMs) {
    const s = meToThree(unit(sub.sunVec)), e = meToThree(unit(sub.earthVec));
    api.sunPos.set(s[0], s[1], s[2]).multiplyScalar(DISPLAY.sunDist);
    api.earthPos.set(e[0], e[1], e[2]).multiplyScalar(DISPLAY.earthDist);
    sun.position.copy(api.sunPos); earth.position.copy(api.earthPos);
    // Soleil vu de la Terre : direction réelle (Soleil − Terre), pour une phase terrestre correcte
    const es = meToThree(unit([sub.sunVec[0] - sub.earthVec[0], sub.sunVec[1] - sub.earthVec[1], sub.sunVec[2] - sub.earthVec[2]]));
    earthMat.uniforms.sunDir.value.set(es[0], es[1], es[2]);
    setRay(sunRay, s, DISPLAY.sunDist); setRay(earthRay, e, DISPLAY.earthDist);
    subSun.position.set(s[0], s[1], s[2]).multiplyScalar(1.01); subEarth.position.set(e[0], e[1], e[2]).multiplyScalar(1.01);
    if (!(Math.abs(timeMs - trackTimeMs) < TRACK_REFRESH_MS)) updateTracks(timeMs);
  }

  function setCvd(c) {
    for (const [obj, name] of [[sunTrack, 'sun'], [sunRay, 'sun'], [earthTrack, 'earth'], [earthRay, 'earth']]) obj.material.color.set(cat(name, c));
    for (const sp of api.surfaceSprites) { drawSubPoint(sp.userData.canvas, sp.userData.body, cat(sp.userData.body, c)); sp.material.map.needsUpdate = true; }
  }
  return api;
}
