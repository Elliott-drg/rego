// Cube d'orientation du globe : petit rendu 3D d'un cube dont chaque face nomme le côté de la Lune
// qu'on regarde (textures dessinées en canvas, traduites). Il suit la caméra du globe ; un clic sur
// une face (lancer de rayon) demande la vue correspondante. Sous le cube : point central de la vue
// et bouton « Vue système ».
import * as THREE from 'three';
import { state, on } from '../core/store.js';
import { t } from '../core/i18n.js';
import { fmtLat, fmtLatLon } from '../core/coords.js';
import { h } from '../ui/dom.js';
import '../i18n/globe.js';

// Ordre des faces de BoxGeometry : +X, −X, +Y, −Y, +Z, −Z. Dans la scène : +Z = face visible (lon 0°),
// +X = 90° Est, +Y = pôle Nord (voir core/coords.js).
export const CUBE_FACES = [
  { id: 'east', lat: 0, lon: 90, bg: '#1b2a44' },
  { id: 'west', lat: 0, lon: -90, bg: '#1b2a44' },
  { id: 'north', lat: 90, lon: 0, bg: '#b8382e' },
  { id: 'south', lat: -90, lon: 0, bg: '#b8382e' },
  { id: 'near', lat: 0, lon: 0, bg: '#1d5fd0' },
  { id: 'far', lat: 0, lon: 180, bg: '#33415a' },
];
const TEX = 192;

/** Dessine une face : fond uni, liseré, libellé sur une ou deux lignes. */
function drawFace(canvas, face) {
  const ctx = canvas.getContext('2d'), s = canvas.width;
  ctx.fillStyle = face.bg; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = s * 0.035; ctx.strokeRect(s * 0.02, s * 0.02, s * 0.96, s * 0.96);
  const words = t(`globe.cube.${face.id}`).toUpperCase().split(' ');
  const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : words;
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = s * 0.27;
  ctx.font = `600 ${size}px "Barlow Condensed", Barlow, "Segoe UI", sans-serif`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > s * 0.84) { size *= s * 0.84 / widest; ctx.font = `600 ${size}px "Barlow Condensed", Barlow, "Segoe UI", sans-serif`; }
  lines.forEach((l, i) => ctx.fillText(l, s / 2, s / 2 + (i - (lines.length - 1) / 2) * size * 1.08));
}

/**
 * @param {HTMLElement} host conteneur (coin haut droit du globe)
 * @param {{onFace:(face:{id:string,lat:number,lon:number})=>void, onSystemView:()=>void}} handlers
 * @returns {{sync(camera:THREE.Camera):void}}
 */
export function createViewCube(host, { onFace, onSystemView }) {
  const canvas = h('canvas', { class: 'globe-cube', width: TEX, height: TEX, role: 'img' });
  const facing = h('div', { class: 'globe-facing glass' });
  const sysBtn = h('button', { type: 'button', class: 'btn btn-sm globe-sysbtn', onclick: onSystemView });
  host.append(canvas, facing, sysBtn);

  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  let renderer = null, cube = null, camera = null, scene = null, faceCanvases = [];
  if (gl) {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    faceCanvases = CUBE_FACES.map(() => { const c = document.createElement('canvas'); c.width = c.height = TEX; return c; });
    const materials = faceCanvases.map((c) => {
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return new THREE.MeshBasicMaterial({ map: tex });
    });
    cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), materials);
    scene.add(cube);
    canvas.addEventListener('pointermove', (e) => setHover(faceAt(e)));
    canvas.addEventListener('pointerleave', () => setHover(-1));
    canvas.addEventListener('click', (e) => { const i = faceAt(e); if (i >= 0) onFace(CUBE_FACES[i]); });
    document.fonts?.ready.then(() => { paint(); });       // les polices arrivent après le premier dessin
  } else canvas.remove();                                   // sans WebGL : il reste le point central et le bouton

  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  /** Face sous le pointeur (indice dans CUBE_FACES), ou −1. */
  function faceAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(cube, false)[0];
    return hit ? hit.face.materialIndex : -1;
  }
  let hover = -1, lastQuat = new THREE.Quaternion(0, 0, 0, 0), lastFacing = '', lastPos = null;
  function setHover(i) {
    if (i === hover) return;
    hover = i;
    cube.material.forEach((m, k) => m.color.setScalar(k === hover ? 1.35 : 1));     // face survolée plus claire
    canvas.title = hover >= 0 ? t(`globe.cube.${CUBE_FACES[hover].id}`) : '';
    render();
  }
  function render() { if (renderer) renderer.render(scene, camera); }
  function paint() {
    if (!renderer) return;
    faceCanvases.forEach((c, i) => { drawFace(c, CUBE_FACES[i]); cube.material[i].map.needsUpdate = true; });
    render();
  }
  function texts() {
    canvas.setAttribute('aria-label', t('globe.cube.label'));
    sysBtn.textContent = t('globe.systemView'); sysBtn.title = t('globe.systemView.help');
    facing.title = t('globe.facing.help');
    lastFacing = ''; if (lastPos) writeFacing();
    paint();
  }
  function writeFacing() {
    // À l'aplomb d'un pôle, la longitude n'a pas de sens : latitude seule
    const pos = Math.abs(lastPos.lat) > 89.5 ? fmtLat(lastPos.lat, 0) : fmtLatLon(lastPos.lat, lastPos.lon, 0, state.lang);
    const text = t('globe.facing', { pos });
    if (text !== lastFacing) { lastFacing = text; facing.textContent = text; }
  }

  /** Aligne le cube sur la caméra du globe (qui regarde toujours le centre de la Lune). */
  function sync(mainCamera, centerLatLon) {
    lastPos = centerLatLon; writeFacing();
    if (!renderer || lastQuat.equals(mainCamera.quaternion)) return;
    lastQuat.copy(mainCamera.quaternion);
    camera.position.copy(mainCamera.position).setLength(4.7);
    camera.quaternion.copy(mainCamera.quaternion);
    render();
  }

  texts();
  on('change:lang', texts);
  return { sync };
}
