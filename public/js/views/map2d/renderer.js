// Rendu WebGL2 de la carte 2D : relief LOLA, ombres portées en temps réel et calques colorés.
// Ne connaît ni le DOM (hors son canvas) ni les interactions : map2d.js lui donne une vue et lui demande une image.

import { state } from '../../core/store.js';
import { DEG, spXYFromLatLon } from '../../core/coords.js';
import { subPoints, SUN_RADIUS_KM } from '../../science/ephemeris.js';
import { SP_GRID, getDem } from '../../science/terrain.js';
import { ensureData, dataLoaded, getData } from '../../data/registry.js';
import { layers } from '../../layers/manager.js';
import { lut, cat, hexToRgb, NODATA_RGB } from '../../layers/palettes.js';
import { VERT, FRAG, KIND, PATTERN, MAX_LAYERS, RASTER_SLOTS, MARCH_LEVELS, MAX_SPANS } from './shaders.js';

const N = SP_GRID.n;
/** Rayon carte du parallèle limite (75°S) : au-delà, la grille n'a plus de données fiables. */
export const RHO_MAX = spXYFromLatLon(SP_GRID.minLat, 0).y;

// Marche vers l'horizon (voir horizonTan dans shaders.js). « full » : mêmes pas que science/horizon.js
// (120 m, puis 0,4 % de la distance, 480 m au plus, jusqu'à 330 km). « light » (lecture animée, gestes sur
// une machine lente) : pas doublés près du point, triplés au loin, et moins de tronçons.
// Lectures de texture par pixel pour la marche complète, mesurées sur 3 000 points × 4 dates par une
// simulation de la même marche : 27 en moyenne vers le Soleil (médiane 5, 99e centile 200, maximum 332),
// 23 vers la Terre ; au plus 92 tronçons (128 autorisés). Une marche sans pyramide en demande 700 à 1 000.
const MARCH = {
  full: { stepMin: 120, stepK: 0.004, stepMax: 480, maxDist: 330000, spans: MAX_SPANS },
  light: { stepMin: 240, stepK: 0.012, stepMax: 1440, maxDist: 330000, spans: 48 },
};

const RASTER_OF = { sun_avg: 'sp_sun_avg', earth_avg: 'sp_earth_avg', psr: 'sp_psr', tmax: 'sp_tmax', tavg: 'sp_tavg', tmin: 'sp_tmin' };
const SLOT_OF = { sp_sun_avg: 0, sp_earth_avg: 1, sp_psr: 2, sp_tmax: 3, sp_tavg: 4, sp_tmin: 5 };
const UNIT = { dem: 0, lut: 1, raster0: 2, demMax: 2 + RASTER_SLOTS, scratch: 3 + RASTER_SLOTS };   // unités de texture

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('shader : ' + gl.getShaderInfoLog(sh));
  return sh;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{bg:number[], onInvalidate:()=>void, onLost:()=>void, onRestored:()=>void}} hooks
 *   bg = couleur hors carte (0..1) ; onInvalidate = une texture vient d'arriver, il faut redessiner
 * @returns objet de rendu, ou null si WebGL2 est absent
 */
export function createRenderer(canvas, hooks) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  let prog = null, U = {}, demTex = null, demMaxTex = null, hasDem = false, hMax = 0, lodMax = 0, lutTex = null, lutRows = [], dummyTex = null, dummyIntTex = null;
  let fbo = null, fboTex = null, fboW = 0, fboH = 0, probeFbo = null, probeTex = null;
  let lost = false, dpr = 1, timing = 0;
  const rasters = new Map();     // id du jeu -> {tex, key} (key = plage de quantification)
  const pendingRasters = new Set();
  let eph = { timeMs: NaN };
  // Durée mesurée d'une image complète (ms) ; sert à choisir la résolution des images intermédiaires.
  const perf = { fullMs: NaN, frames: 0, lastMs: NaN };   // frames = images complètes terminées

  function init() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('programme : ' + gl.getProgramInfoLog(prog));
    U = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); const name = info.name.replace(/\[0\]$/, ''); U[name] = gl.getUniformLocation(prog, name); }
    gl.useProgram(prog);
    gl.uniform1i(U.uDem, UNIT.dem); gl.uniform1i(U.uDemMax, UNIT.demMax); gl.uniform1i(U.uLut, UNIT.lut);
    for (let s = 0; s < RASTER_SLOTS; s++) gl.uniform1i(U['uRas' + s], UNIT.raster0 + s);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Texture 1×1 pour les emplacements inutilisés (un sampler sans texture provoque un avertissement)
    dummyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dummyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    nearest(gl.TEXTURE_2D);
    dummyIntTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dummyIntTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, 1, 1, 0, gl.RED_INTEGER, gl.SHORT, new Int16Array([0]));
    nearest(gl.TEXTURE_2D);
    demTex = null; demMaxTex = null; hasDem = false; lutTex = null; fbo = null; fboTex = null; fboW = fboH = 0; probeFbo = null;
    rasters.clear(); pendingRasters.clear();
    uploadDem();
    setPalettes();
    syncLayers();
  }
  function nearest(target) {
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Envoie le MNT (Int16, DN × 0,5 m) en texture R32F avec ses niveaux réduits (moyennes 2×2). */
  function uploadDem() {
    const dem = getDem();
    if (!dem || lost) return;
    let level = new Float32Array(N * N), max = -Infinity;
    for (let i = 0; i < level.length; i++) { const h = dem[i] * SP_GRID.scale; level[i] = h; if (h > max) max = h; }
    hMax = max;
    if (demTex) gl.deleteTexture(demTex);
    demTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT.dem);
    gl.bindTexture(gl.TEXTURE_2D, demTex);
    let size = N, lod = 0;
    for (;;) {
      gl.texImage2D(gl.TEXTURE_2D, lod, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, level);
      if (size === 1) break;
      const half = size >> 1, next = new Float32Array(half * half);
      for (let r = 0; r < half; r++) {
        for (let c = 0, i = 2 * r * size, o = r * half; c < half; c++, i += 2, o++) next[o] = 0.25 * (level[i] + level[i + 1] + level[i + size] + level[i + size + 1]);
      }
      level = next; size = half; lod++;
    }
    lodMax = lod;
    // Sans l'extension, une texture flottante ne peut pas être interpolée : plus proche voisin.
    const linear = !!gl.getExtension('OES_texture_float_linear');
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    uploadDemMax(dem);
    hasDem = true;
    perf.fullMs = NaN;
  }

  /**
   * Pyramide de maxima pour la marche (texture entière R16I, DN). M[L] = maximum par blocs de 2^L pixels sur
   * la grille complétée à PAD ; le texel i du niveau L envoyé au shader est le maximum de M[L−1] sur
   * [2i−1, 2i+2] dans chaque direction : son bloc élargi d'un demi-texel de chaque côté.
   */
  function uploadDemMax(dem) {
    const { leaf, top, pad } = MARCH_LEVELS, NONE = -32768;
    let n0 = pad >> 1, m = new Int16Array(n0 * n0).fill(NONE);     // M[1], directement depuis le MNT
    for (let r = 0; r < N; r++) {
      for (let c = 0, i = r * N, o = (r >> 1) * n0; c < N; c++, i++) { const j = o + (c >> 1); if (dem[i] > m[j]) m[j] = dem[i]; }
    }
    if (demMaxTex) gl.deleteTexture(demMaxTex);
    demMaxTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT.demMax);
    gl.bindTexture(gl.TEXTURE_2D, demMaxTex);
    for (let L = 2; L <= top; L++) {
      const n1 = n0 >> 1;
      if (L >= leaf) {
        // Maximum séparable sur la fenêtre [2i−1, 2i+2] : colonnes puis lignes
        const tmp = new Int16Array(n0 * n1), d = new Int16Array(n1 * n1);
        for (let r = 0; r < n0; r++) {
          for (let c = 0; c < n1; c++) { let v = NONE; for (let k = Math.max(0, 2 * c - 1), e = Math.min(n0 - 1, 2 * c + 2); k <= e; k++) v = Math.max(v, m[r * n0 + k]); tmp[r * n1 + c] = v; }
        }
        for (let r = 0; r < n1; r++) {
          for (let c = 0; c < n1; c++) { let v = NONE; for (let k = Math.max(0, 2 * r - 1), e = Math.min(n0 - 1, 2 * r + 2); k <= e; k++) v = Math.max(v, tmp[k * n1 + c]); d[r * n1 + c] = v; }
        }
        gl.texImage2D(gl.TEXTURE_2D, L - leaf, gl.R16I, n1, n1, 0, gl.RED_INTEGER, gl.SHORT, d);
      }
      const next = new Int16Array(n1 * n1);                           // M[L]
      for (let r = 0; r < n1; r++) {
        for (let c = 0, i = 2 * r * n0, o = r * n1; c < n1; c++, i += 2, o++) next[o] = Math.max(m[i], m[i + 1], m[i + n0], m[i + n0 + 1]);
      }
      m = next; n0 = n1;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, top - leaf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Palettes des calques de la carte : une ligne de 256 couleurs par palette, refaites au changement de mode daltonien. */
  function setPalettes() {
    if (lost) return;
    lutRows = [...new Set(layers.all().filter((l) => l.views.includes('map2d') && l.palette).map((l) => l.palette))];
    const data = new Uint8Array(256 * 4 * Math.max(1, lutRows.length));
    lutRows.forEach((name, i) => data.set(lut(name, state.cvd), i * 256 * 4));
    if (!lutTex) lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT.lut);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, Math.max(1, lutRows.length), 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Crée les textures des rasters dont le calque vient de s'allumer, supprime celles des calques éteints. */
  function syncLayers() {
    if (lost) return;
    const wanted = new Map();
    for (const l of layers.active('map2d')) { const id = RASTER_OF[l.id]; if (id) wanted.set(id, l); }
    for (const [id, r] of rasters) if (!wanted.has(id)) { gl.deleteTexture(r.tex); rasters.delete(id); }
    for (const [id, l] of wanted) {
      const key = l.range ? l.range.join(':') : '';
      if (rasters.get(id)?.key === key || pendingRasters.has(id)) continue;
      if (dataLoaded(id)) { uploadRaster(id, l, key); continue; }
      pendingRasters.add(id);
      ensureData(id).then(() => {
        pendingRasters.delete(id);
        const now = layers.get(l.id);
        if (!lost && now?.on) { uploadRaster(id, now, key); hooks.onInvalidate(); }
      }, () => pendingRasters.delete(id));   // fichier absent : le gestionnaire de calques marque le calque indisponible
    }
  }
  function uploadRaster(id, layer, key) {
    let data = getData(id);
    if (data instanceof Uint16Array) {
      // Températures (K × 10) ramenées sur 1..255 dans la plage du calque ; 0 reste « sans donnée »
      const [lo, hi] = layer.range, q = new Uint8Array(data.length), k = 254 / ((hi - lo) * 10);
      for (let i = 0; i < data.length; i++) { const v = data[i]; q[i] = v === 0 ? 0 : 1 + Math.max(0, Math.min(254, Math.round((v - lo * 10) * k))); }
      data = q;
    }
    const old = rasters.get(id);
    if (old) gl.deleteTexture(old.tex);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT.raster0 + SLOT_OF[id]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    nearest(gl.TEXTURE_2D);
    rasters.set(id, { tex, key });
  }

  /** Décrit les calques colorés actifs pour le shader. */
  function setLayerUniforms() {
    const kinds = new Int32Array(MAX_LAYERS), P = new Float32Array(MAX_LAYERS * 4), Q = new Float32Array(MAX_LAYERS * 4);
    let count = 0, needSun = false, needEarth = false, shade = 0;
    const rgb = (name) => hexToRgb(cat(name, state.cvd)).map((v) => v / 255);
    for (const l of layers.active('map2d')) {
      if (l.id === 'shade') { shade = l.opacity; needSun = needSun || shade > 0; continue; }
      if (count >= MAX_LAYERS) break;
      let kind = 0, p = [l.opacity, l.range?.[0] ?? 0, l.range?.[1] ?? 1, Math.max(0, lutRows.indexOf(l.palette))], q = [0, 0, 0, 0];
      const rasterId = RASTER_OF[l.id];
      if (rasterId) {
        if (!rasters.has(rasterId)) continue;                         // texture pas encore arrivée
        if (l.mask) { kind = KIND.rasterMask; p[1] = PATTERN[l.mask] ?? 0; q = [...rgb(l.mask), SLOT_OF[rasterId]]; }
        else { kind = getData(rasterId) instanceof Uint16Array ? KIND.rasterQuant : KIND.rasterPct; q[3] = SLOT_OF[rasterId]; }
      } else if (l.id === 'elevation') kind = KIND.elevation;
      else if (l.id === 'slope') kind = KIND.slope;
      else if (l.id === 'landable') { kind = KIND.landable; p[1] = state.params.slopeLimitDeg; q = [...rgb(l.mask), PATTERN[l.mask] ?? 0]; }
      else if (l.id === 'sun_now') { kind = KIND.sunNow; needSun = true; }
      else if (l.id === 'earth_now') { kind = KIND.earthNow; needEarth = true; q = [...rgb(l.mask), PATTERN[l.mask] ?? 0]; }
      else continue;                                                  // calque vectoriel : dessiné par overlay.js
      kinds[count] = kind; P.set(p, count * 4); Q.set(q, count * 4); count++;
    }
    gl.uniform1i(U.uLayerCount, count);
    gl.uniform1iv(U.uLayerKind, kinds); gl.uniform4fv(U.uLayerP, P); gl.uniform4fv(U.uLayerQ, Q);
    gl.uniform1f(U.uShade, shade); gl.uniform1f(U.uLutRows, Math.max(1, lutRows.length));
    gl.uniform3f(U.uNoData, NODATA_RGB[0] / 255, NODATA_RGB[1] / 255, NODATA_RGB[2] / 255);
    gl.uniform1i(U.uNeedSun, needSun ? 1 : 0); gl.uniform1i(U.uNeedEarth, needEarth ? 1 : 0);
  }

  /** Uniforms communs au rendu et au contrôle : relief, Soleil, Terre, marche. */
  function setSceneUniforms(timeMs, march) {
    if (eph.timeMs !== timeMs) {
      const sp = subPoints(new Date(timeMs));
      eph = { timeMs, sun: sp.sunVec.map((v) => v / sp.sunDistKm), sunRad: Math.asin(SUN_RADIUS_KM / sp.sunDistKm), earth: sp.earthVec };
    }
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0 + UNIT.dem); gl.bindTexture(gl.TEXTURE_2D, hasDem ? demTex : dummyTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT.demMax); gl.bindTexture(gl.TEXTURE_2D, hasDem ? demMaxTex : dummyIntTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT.lut); gl.bindTexture(gl.TEXTURE_2D, lutTex);
    for (const [id, slot] of Object.entries(SLOT_OF)) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.raster0 + slot); gl.bindTexture(gl.TEXTURE_2D, rasters.get(id)?.tex || dummyTex);
    }
    gl.uniform1i(U.uHasDem, hasDem ? 1 : 0); gl.uniform1f(U.uHMax, hMax); gl.uniform1f(U.uDemLodMax, lodMax);
    gl.uniform1f(U.uRhoMax, RHO_MAX);
    gl.uniform3fv(U.uBg, hooks.bg);
    gl.uniform3fv(U.uSun, eph.sun); gl.uniform1f(U.uSunRad, eph.sunRad); gl.uniform3fv(U.uEarthKm, eph.earth);
    gl.uniform1f(U.uEarthMargin, state.params.earthMarginDeg * DEG); gl.uniform1f(U.uMast, state.params.mastM);
    gl.uniform1f(U.uStepMin, march.stepMin); gl.uniform1f(U.uStepK, march.stepK); gl.uniform1f(U.uStepMax, march.stepMax); gl.uniform1f(U.uMaxDist, march.maxDist);
    gl.uniform1i(U.uSpans, Math.min(MAX_SPANS, march.spans));
  }

  function ensureFbo(w, h) {
    if (fbo && fboW === w && fboH === h) return;
    if (!fbo) { fbo = gl.createFramebuffer(); fboTex = gl.createTexture(); }
    gl.activeTexture(gl.TEXTURE0 + UNIT.scratch);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    fboW = w; fboH = h;
  }

  /**
   * Résolution relative des images intermédiaires (déplacement, lecture animée) : 1 sur une machine qui
   * dessine l'image complète en moins de 30 ms, sinon réduite pour viser cette durée (jamais sous 1/4).
   */
  function fastScale() {
    if (!(perf.fullMs > 30)) return 1;
    return Math.max(0.25, Math.min(1, Math.sqrt(30 / perf.fullMs)));
  }

  /**
   * Dessine la carte.
   * @param {{cx:number, cy:number, scale:number}} view centre (m carte) et échelle (m par pixel CSS)
   * @param {{fast?:boolean, lightMarch?:boolean}} opts fast = image intermédiaire pendant un geste : sur une machine
   *   lente, résolution réduite et marche allégée ; lightMarch = marche allégée dans tous les cas (lecture animée)
   * @returns {boolean} true si l'image est de qualité complète (pleine résolution, marche complète)
   */
  function draw(view, opts = {}) {
    if (lost || !prog) return true;
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return true;
    const reduce = !!opts.fast && perf.fullMs > 30;
    const rs = reduce ? fastScale() : 1;
    const march = reduce || opts.lightMarch ? MARCH.light : MARCH.full;
    const complete = rs === 1 && march === MARCH.full;
    const w = Math.max(1, Math.round(W * rs)), h = Math.max(1, Math.round(H * rs));
    // On chronomètre les images complètes tant que la machine n'est pas classée « rapide », puis de temps en temps.
    const timed = complete && (!(perf.fullMs <= 30) || perf.frames % 25 === 0);
    const t0 = performance.now();
    setSceneUniforms(state.timeMs, march);
    setLayerUniforms();
    gl.uniform1i(U.uMode, 0);
    gl.uniform2f(U.uCenter, view.cx, view.cy);
    gl.uniform1f(U.uScale, view.scale / dpr * (W / w));
    gl.uniform2f(U.uSize, w, h); gl.uniform1f(U.uPx, dpr * w / W);
    if (rs < 1) { ensureFbo(w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); } else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (rs < 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    if (timed && !timing) {
      // Chronométrage sans bloquer : une barrière GPU, interrogée jusqu'à la fin réelle du dessin
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (lost) { timing = 0; return; }
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.TIMEOUT_EXPIRED) { timing = setTimeout(poll, 4); return; }
        gl.deleteSync(sync); timing = 0;
        if (st === gl.WAIT_FAILED) return;
        perf.lastMs = performance.now() - t0;
        perf.fullMs = Number.isFinite(perf.fullMs) ? 0.5 * perf.fullMs + 0.5 * perf.lastMs : perf.lastMs;
        perf.frames++;
      };
      timing = setTimeout(poll, 0);
    } else if (complete && !timed) perf.frames++;
    return complete;
  }

  /**
   * Contrôle : ce que le shader calcule en un point (fraction du disque solaire visible, Terre visible),
   * lu avec readPixels. tests/map2d.browser.mjs le compare au moteur CPU (engine.siteNow).
   * @returns {{sunFraction:number, earthVisible:boolean}|null}
   */
  function probe(lat, lon, timeMs = state.timeMs) {
    if (lost || !prog || !hasDem) return null;
    if (!probeFbo) {
      probeFbo = gl.createFramebuffer(); probeTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + UNIT.scratch);
      gl.bindTexture(gl.TEXTURE_2D, probeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      nearest(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probeTex, 0);
    }
    setSceneUniforms(timeMs, MARCH.full);
    const p = spXYFromLatLon(lat, lon), px = new Uint8Array(4), out = {};
    gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
    gl.viewport(0, 0, 1, 1);
    gl.uniform2f(U.uCenter, p.x, p.y); gl.uniform1f(U.uScale, 1); gl.uniform2f(U.uSize, 1, 1); gl.uniform1f(U.uPx, 1);
    gl.uniform1i(U.uMode, 1); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.sunFraction = px[0] / 255;
    gl.uniform1i(U.uMode, 2); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.earthVisible = px[0] > 127;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  /** Ajuste le tampon du canvas à sa taille CSS. @returns {boolean} true si la taille a changé */
  function resize(cssW, cssH, pixelRatio) {
    dpr = pixelRatio;
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width === W && canvas.height === H) return false;
    perf.fullMs *= (W * H) / (canvas.width * canvas.height);         // la durée d'une image suit le nombre de pixels
    canvas.width = W; canvas.height = H;
    return true;
  }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; hooks.onLost(); });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; init(); hooks.onRestored(); });
  init();

  return {
    draw, probe, resize, uploadDem, setPalettes, syncLayers,
    get lost() { return lost; },
    get hasDem() { return hasDem; },
    /** Mesures : durée d'une image complète (ms), chronométrage en cours (busy), rasters présents en texture. */
    get perf() { return { ...perf, busy: !!timing, fastScale: fastScale(), linearFloat: !!gl.getExtension('OES_texture_float_linear'), rasters: [...rasters.keys()] }; },
  };
}
