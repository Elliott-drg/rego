// Shaders de la carte 2D (WebGL2). Un seul programme : un triangle plein écran, tout se joue dans le
// fragment shader, qui refait pour chaque pixel le calcul de science/horizon.js :
//   pixel -> point de la carte stéréographique -> normale de la sphère -> marche le long du grand cercle
//   vers le Soleil (puis vers la Terre) dans le MNT LOLA -> élévation de l'horizon -> fraction éclairée.
// Les formules de projection répètent celles de core/coords.js (GLSL oblige) ; tests/map2d.browser.mjs
// compare le résultat du shader au moteur CPU (engine.siteNow) point par point.

/** Types de calques colorés compris par le shader (uLayerKind). */
export const KIND = { elevation: 1, slope: 2, landable: 3, sunNow: 4, earthNow: 5, rasterPct: 6, rasterMask: 7, rasterQuant: 8 };
/** Motifs de hachures des masques (uLayerQ.w pour les masques calculés, voir map2d/renderer.js). */
export const PATTERN = { ok: 0, earth: 1, psr: 2 };
export const MAX_LAYERS = 8;
export const RASTER_SLOTS = 6;
/**
 * Pyramide de maxima du MNT utilisée par la marche (voir horizonTan) : niveaux LEAF..TOP, le niveau L ayant
 * des texels de 240·2^L m sur la grille complétée à PAD pixels (PAD / 2^TOP entier).
 */
export const MARCH_LEVELS = { leaf: 3, top: 8, pad: 3840 };
/** Nombre maximal de tronçons examinés par marche, compilé dans la boucle (le nombre réel est un uniform). */
export const MAX_SPANS = 128;

export const VERT = `#version 300 es
void main() {
  // Triangle couvrant tout l'écran, sans tampon de sommets
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 outColor;

const float R = 1737400.0;        // rayon de référence (m), core/coords.js
const float N = 3812.0;           // côté de la grille polaire (pixels)
const float CELL = 240.0;         // maille (m)
const float HALF = 1906.0;        // centre de la grille en coordonnées de texture (1905,5 + 0,5)
const float FLOOR_H = -9000.0;    // niveau le plus bas plausible : horizon minimal (comme horizon.js)
const int MAX_SPANS = ${MAX_SPANS};
const int LEAF = ${MARCH_LEVELS.leaf};       // niveau le plus fin de la pyramide de maxima (texels de 1 920 m)
const int TOP = ${MARCH_LEVELS.top};        // niveau le plus grossier (texels de 61 km)
const int MAX_LAYERS = ${MAX_LAYERS};

uniform vec2 uCenter;       // centre de la vue (m carte)
uniform float uScale;       // m carte par pixel du tampon
uniform vec2 uSize;         // taille du tampon (px)
uniform float uPx;          // pixels du tampon par pixel CSS (taille des hachures)
uniform float uRhoMax;      // rayon carte du parallèle 75°S (m)
uniform vec3 uBg;           // couleur hors de la carte

uniform sampler2D uDem;     // hauteur LOLA (m), niveaux de mipmap = moyennes
uniform highp isampler2D uDemMax;   // maxima du MNT (DN = 0,5 m) par blocs dilatés, niveaux LEAF..TOP
uniform bool uHasDem;
uniform float uHMax;        // hauteur maximale du MNT (m) : borne d'arrêt de la marche
uniform float uDemLodMax;

uniform vec3 uSun;          // direction du Soleil (unitaire, repère ME)
uniform float uSunRad;      // demi-diamètre apparent du Soleil (rad)
uniform vec3 uEarthKm;      // vecteur centre Lune -> Terre (km, repère ME)
uniform float uEarthMargin; // marge exigée au-dessus de l'horizon pour la liaison (rad)
uniform float uMast;        // hauteur de l'observateur au-dessus du sol (m)
uniform float uStepMin;     // pas de la marche fine : clamp(uStepK·s, uStepMin, uStepMax)
uniform float uStepK;
uniform float uStepMax;
uniform float uMaxDist;     // portée de la marche (m)
uniform int uSpans;         // nombre maximal de tronçons examinés
uniform bool uNeedSun;
uniform bool uNeedEarth;
uniform int uMode;          // 0 = carte ; 1 = contrôle Soleil ; 2 = contrôle Terre (valeur brute pour readPixels)

uniform float uShade;       // opacité du fond ombré (0 = fond neutre)
uniform int uLayerCount;
uniform int uLayerKind[MAX_LAYERS];
uniform vec4 uLayerP[MAX_LAYERS];   // opacité, min, max, ligne de palette
uniform vec4 uLayerQ[MAX_LAYERS];   // couleur du masque (rvb) ; w = n° de raster, seuil ou motif selon le type
uniform sampler2D uLut;             // palettes : une ligne de 256 couleurs par palette
uniform float uLutRows;
uniform vec3 uNoData;
uniform sampler2D uRas0;
uniform sampler2D uRas1;
uniform sampler2D uRas2;
uniform sampler2D uRas3;
uniform sampler2D uRas4;
uniform sampler2D uRas5;

// ---------------------------------------------------------------- Relief
vec2 texelOf(vec2 q) { return vec2(q.x / CELL + HALF, HALF - q.y / CELL); }
float demAt(vec2 q, float lod) { return textureLod(uDem, texelOf(q) / N, lod).r; }

/** Point du grand cercle partant de la normale n dans la direction t, à la distance au sol s -> texels du MNT. */
vec2 rayTexel(vec3 n, vec3 t, float s) {
  float th = s / R, th2 = th * th;
  vec3 m = n * (1.0 - th2 * (0.5 - th2 / 24.0)) + t * (th * (1.0 - th2 * (1.0 / 6.0 - th2 / 120.0)));
  return vec2(m.y, -m.x) * (2.0 * R / (CELL * (1.0 - m.z))) + HALF;   // projection stéréographique
}
/**
 * Tangente de l'élévation d'un point de hauteur h à la distance s, vu de la hauteur h0 (rayons r2 et r1,
 * angle au centre θ = s/R) : tan(él) = (r2·cos θ − r1) / (r2·sin θ), écrit ((h − h0) − r2·(1 − cos θ)) / (r2·sin θ)
 * pour ne pas soustraire deux grands nombres en simple précision.
 */
float tanOf(float h, float h0, float s) {
  float th = s / R, th2 = th * th, r2 = R + h;
  return ((h - h0) - r2 * th2 * (0.5 - th2 / 24.0)) / (r2 * th * (1.0 - th2 * (1.0 / 6.0 - th2 / 120.0)));
}
bool inGrid(vec2 tc) { return tc.x >= 0.5 && tc.y >= 0.5 && tc.x <= N - 0.5 && tc.y <= N - 0.5; }

/**
 * Tangente de l'élévation de l'horizon du relief, vu de la hauteur h0, dans la direction horizontale t
 * (unitaire, perpendiculaire à la normale n). Résultat borné à [lowTan, stopTan] : on ne cherche que ce qui
 * peut cacher le corps visé (au-dessous de lowTan le relief ne le touche pas, au-dessus de stopTan il le
 * cache en entier).
 *
 * Marche fine identique à science/horizon.js (pas de 120 m, puis 0,4 % de la distance, 480 m au plus),
 * mais seulement là où c'est utile : le trajet est découpé en tronçons, et une pyramide de maxima du MNT
 * dit en une lecture si le relief d'un tronçon peut dépasser l'horizon déjà trouvé. Sinon le tronçon est
 * sauté et le suivant est deux fois plus long ; si oui, on redescend jusqu'au niveau LEAF, puis marche fine.
 * Un texel de niveau L couvre son carré élargi d'un demi-texel de chaque côté : il majore donc le relief
 * (interpolation bilinéaire comprise) à moins de T/2 − 240 m du point lu, d'où la longueur des tronçons.
 */
float horizonTan(vec3 n, vec3 t, float h0, float lowTan, float stopTan) {
  float r1 = R + h0, rf = R + FLOOR_H;
  float best = max(lowTan, -sqrt(max(0.0, (h0 - FLOOR_H) * (r1 + rf))) / rf);   // sphère lisse au niveau le plus bas
  float s = 0.0;         // début du tronçon courant
  float q = 0.0;         // dernier point de la marche fine
  int L = LEAF;
  for (int i = 0; i < MAX_SPANS; i++) {
    if (i >= uSpans || best > stopTan || s >= uMaxDist) break;
    // Même le relief le plus haut de la carte ne dépasserait plus l'horizon déjà trouvé
    if (s > 0.0 && tanOf(uHMax, h0, s) < best) break;
    float a = 0.96 * CELL * float((1 << L) - 2);                    // longueur du tronçon (0,96 : échelle carte/sol ≤ 1,035 aux coins de la grille)
    vec2 tc = rayTexel(n, t, s + 0.5 * a);
    if (inGrid(tc)) {
      float A = 0.5 * float(texelFetch(uDemMax, ivec2(tc) >> L, L - LEAF).r) - h0;
      float s0 = max(s, 60.0);
      // Majorant de tanOf sur le tronçon : le terme de hauteur au plus près (ou au plus loin s'il est négatif),
      // le terme de courbure −tan(θ/2) au plus près ; 1,012 et 1,0041 couvrent r2·sin θ ≠ s.
      float bound = (A >= 0.0 ? 1.012 * A / s0 : A / (1.0041 * (s + a))) - s0 / (2.0 * R);
      if (bound <= best) { s += a; L = min(L + 1, TOP); continue; }
    }
    if (L > LEAF) { L--; continue; }
    // Marche fine sur le tronçon (le dernier point peut le dépasser : aucun trou entre deux tronçons)
    q = max(q, s);
    bool left = false;
    for (int j = 0; j < 16; j++) {
      if (q >= s + a || best > stopTan) break;
      q += clamp(uStepK * q, uStepMin, uStepMax);
      vec2 tq = rayTexel(n, t, q);
      if (!inGrid(tq)) { left = true; break; }
      best = max(best, tanOf(textureLod(uDem, tq / N, 0.0).r, h0, q));
    }
    if (left) break;                                                // sortie du MNT
    s += a;
  }
  return best;
}

// ---------------------------------------------------------------- Rasters (u8, plus proche voisin ou bilinéaire)
float rasTexel(int slot, ivec2 ij) {
  float v;
  if (slot == 0) v = texelFetch(uRas0, ij, 0).r;
  else if (slot == 1) v = texelFetch(uRas1, ij, 0).r;
  else if (slot == 2) v = texelFetch(uRas2, ij, 0).r;
  else if (slot == 3) v = texelFetch(uRas3, ij, 0).r;
  else if (slot == 4) v = texelFetch(uRas4, ij, 0).r;
  else v = texelFetch(uRas5, ij, 0).r;
  return floor(v * 255.0 + 0.5);
}
/** Valeur 0..255 du raster au point q et validité (0 = sans donnée). Même règle que registry.samplePolar. */
vec2 rasterAt(int slot, vec2 q, float noData, bool nearest) {
  vec2 cr = clamp(vec2(q.x / CELL + HALF - 0.5, HALF - 0.5 - q.y / CELL), 0.0, N - 1.0);
  float vn = rasTexel(slot, ivec2(floor(cr + 0.5)));
  if (nearest) return vec2(vn, vn == noData ? 0.0 : 1.0);
  vec2 c0 = min(floor(cr), N - 2.0), f = cr - c0;
  ivec2 i0 = ivec2(c0);
  float a = rasTexel(slot, i0), b = rasTexel(slot, i0 + ivec2(1, 0));
  float c = rasTexel(slot, i0 + ivec2(0, 1)), d = rasTexel(slot, i0 + ivec2(1, 1));
  if (a == noData || b == noData || c == noData || d == noData) return vec2(vn, vn == noData ? 0.0 : 1.0);
  return vec2(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), 1.0);
}

// ---------------------------------------------------------------- Motifs (la couleur n'est jamais le seul repère)
float stripes(vec2 px, vec2 dir, float period, float width) {
  float d = abs(fract(dot(px, dir) / period) - 0.5) * period;       // distance à l'axe de la bande (px CSS)
  return 1.0 - smoothstep(width * 0.5 - 0.6, width * 0.5 + 0.6, d);
}
float pattern(float kind, vec2 px) {
  if (kind < 0.5) return stripes(px, vec2(0.7071, -0.7071), 7.0, 2.0);       // « ok » : hachures montantes
  if (kind < 1.5) return stripes(px, vec2(0.7071, 0.7071), 7.0, 2.0);        // « Terre » : hachures descendantes
  vec2 g = abs(fract(px / 6.0) - 0.5) * 6.0;                                 // « ombre permanente » : points
  return 1.0 - smoothstep(0.9, 1.9, length(g));
}

void main() {
  vec2 p = uCenter + (gl_FragCoord.xy - 0.5 * uSize) * uScale;       // point de la carte (m), y vers le haut
  float rho = length(p);
  float edge = uMode == 0 ? clamp((uRhoMax - rho) / uScale + 0.5, 0.0, 1.0) : 1.0;
  if (edge <= 0.0) { outColor = vec4(uBg, 1.0); return; }

  // Normale de la sphère et axes x/y de la carte ramenés sur la sphère (repère ME), sans singularité au pôle
  float k2 = rho * rho / (4.0 * R * R);
  float D = R * (1.0 + k2);
  vec3 n = vec3(p.y, p.x, -R * (1.0 - k2)) / D;
  vec3 ex = vec3(-p.x * p.y / (2.0 * R), R + (p.y * p.y - p.x * p.x) / (4.0 * R), p.x) / D;
  vec3 ey = vec3(R + (p.x * p.x - p.y * p.y) / (4.0 * R), -p.x * p.y / (2.0 * R), p.y) / D;
  float kS = 1.0 + k2;                                               // échelle locale carte / sol

  float h0 = 0.0, slopeDeg = 0.0;
  vec2 gH = vec2(0.0);                                               // pente utilisée pour l'ombrage (lissée à petite échelle)
  if (uHasDem) {
    h0 = demAt(p, 0.0);
    float d0 = CELL * kS;
    vec2 g0 = vec2(demAt(p + vec2(d0, 0.0), 0.0) - demAt(p - vec2(d0, 0.0), 0.0),
                   demAt(p + vec2(0.0, d0), 0.0) - demAt(p - vec2(0.0, d0), 0.0)) / (2.0 * CELL);
    slopeDeg = degrees(atan(length(g0)));                            // même définition que terrain.slopeAt
    float lod = clamp(log2(uScale / CELL), 0.0, uDemLodMax);
    if (lod > 0.05) {
      float dH = max(d0, 0.75 * uScale);
      gH = vec2(demAt(p + vec2(dH, 0.0), lod) - demAt(p - vec2(dH, 0.0), lod),
                demAt(p + vec2(0.0, dH), lod) - demAt(p - vec2(0.0, dH), lod)) * kS / (2.0 * dH);
    } else gH = g0;
  }

  // ---- Soleil : fraction du disque au-dessus de l'horizon du relief
  float sz = dot(uSun, n);
  float sunEl = asin(clamp(sz, -1.0, 1.0));
  float f = 1.0;
  if (uHasDem && (uNeedSun || uMode == 1)) {
    vec3 t = normalize(uSun - sz * n);
    float hz = atan(horizonTan(n, t, h0 + uMast, tan(sunEl - uSunRad), tan(sunEl + uSunRad)));
    f = clamp((sunEl + uSunRad - hz) / (2.0 * uSunRad), 0.0, 1.0);
  }
  // ---- Terre : visible si elle dépasse l'horizon du relief de plus que la marge
  float earthVis = 0.0;
  if (uHasDem && (uNeedEarth || uMode == 2)) {
    vec3 e = normalize(uEarthKm - n * ((R + h0 + uMast) * 1e-3));    // la Terre est à distance finie
    float ez = dot(e, n);
    vec3 t = normalize(e - ez * n);
    float limit = tan(asin(clamp(ez, -1.0, 1.0)) - uEarthMargin);   // horizon le plus haut qui laisse passer la liaison
    earthVis = horizonTan(n, t, h0 + uMast, limit, limit) > limit ? 0.0 : 1.0;
  }
  if (uMode == 1) { outColor = vec4(f, 0.0, 0.0, 1.0); return; }
  if (uMode == 2) { outColor = vec4(earthVis, 0.0, 0.0, 1.0); return; }

  // ---- Fond : relief lisible partout (trois éclairages fixes à l'écran) + éclairement réel
  vec3 nT = normalize(vec3(-gH * 1.6, 1.0));                         // normale du terrain, relief accentué pour l'ombrage doux
  float amb = 0.5 * max(0.0, dot(nT, vec3(-0.454, 0.454, 0.766)))
            + 0.3 * max(0.0, dot(nT, vec3(0.0, 0.643, 0.766)))
            + 0.2 * max(0.0, dot(nT, vec3(-0.643, 0.0, 0.766)));
  float rel = amb / 0.766;                                           // 1 sur terrain plat
  vec3 col = vec3(0.105, 0.120, 0.155);                              // fond neutre si le calque d'ombrage est éteint
  if (uShade > 0.0 && uHasDem) {
    // Lumière directe : Lambert sur la pente réelle, normalisé par l'éclairement d'un sol plat. Près du pôle
    // le Soleil rase l'horizon (≈ 1,5°) : sans cette normalisation tout serait presque noir.
    vec3 sL = vec3(dot(uSun, ex), dot(uSun, ey), sz);                // Soleil dans le repère local (x carte, y carte, haut)
    float inc = max(0.0, dot(normalize(vec3(-gH, 1.0)), sL));
    float ref = max(sz, 0.035);
    float lit = inc / (inc + ref);                                   // 0,5 sur sol plat, → 1 face au Soleil
    vec3 shadowC = vec3(0.030, 0.040, 0.066) + vec3(0.118, 0.132, 0.170) * pow(rel, 1.6);
    vec3 sunC = vec3(0.940, 0.922, 0.885) * (0.19 + 0.81 * pow(lit, 1.25)) * (0.64 + 0.36 * rel);
    col = mix(col, mix(shadowC, sunC, f), uShade);
  }
  float relief = 0.50 + 0.52 * rel;                                  // modulation des calques colorés par le relief
  vec3 neutral = vec3(0.285, 0.300, 0.335) * relief;                 // relief seul, sans éclairement

  // ---- Calques colorés, du fond vers le dessus
  vec2 px = gl_FragCoord.xy / uPx;
  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= uLayerCount) break;
    int kind = uLayerKind[i];
    vec4 P = uLayerP[i], Q = uLayerQ[i];
    float value = 0.0, valid = 1.0, mask = -1.0, pat = 0.0;
    if (kind == ${KIND.elevation}) value = h0;
    else if (kind == ${KIND.slope}) value = slopeDeg;
    else if (kind == ${KIND.landable}) { mask = slopeDeg < P.y ? 1.0 : 0.0; pat = Q.w; }
    else if (kind == ${KIND.sunNow}) value = f * 100.0;
    else if (kind == ${KIND.earthNow}) { mask = earthVis; pat = Q.w; }
    else if (kind == ${KIND.rasterPct}) { vec2 r = rasterAt(int(Q.w), p, 255.0, false); value = r.x / 2.5; valid = r.y; }
    else if (kind == ${KIND.rasterMask}) { vec2 r = rasterAt(int(Q.w), p, 255.0, true); mask = r.x > 0.5 ? r.y : 0.0; pat = P.y; }
    else { vec2 r = rasterAt(int(Q.w), p, 0.0, false); value = mix(P.y, P.z, (r.x - 1.0) / 254.0); valid = r.y; }
    if (mask >= 0.0) {
      col = mix(col, Q.rgb, P.x * mask * (0.50 + 0.50 * pattern(pat, px)));
    } else if (valid < 0.5) {
      col = mix(mix(col, neutral, P.x), uNoData, P.x * 0.55 * stripes(px, vec2(1.0, 0.0), 6.0, 1.6));   // sans donnée : gris à rayures verticales
    } else {
      float tn = clamp((value - P.y) / (P.z - P.y), 0.0, 1.0);
      vec3 c = texture(uLut, vec2((tn * 255.0 + 0.5) / 256.0, (P.w + 0.5) / uLutRows)).rgb;
      // Sous une palette, les ombres du moment sont atténuées d'autant : la clarté doit dire la valeur, pas l'heure
      col = mix(mix(col, neutral, P.x), c * relief, P.x);
    }
  }
  outColor = vec4(mix(uBg, col, edge), 1.0);
}`;
