// Matériau « sphère éclairée par le Soleil » commun à la Lune et à la Terre.
import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Éclairement : loi en cos(i)^0,6 (la Lune réelle s'assombrit moins vers le terminateur qu'une sphère
// lambertienne), coupée net à cos(i) = 0 : le terminateur est la vraie limite géométrique jour/nuit.
// `night` = niveau résiduel du côté nuit, pour que la surface reste lisible.
// `daylight` = 0 : éclairage uniforme (calque « jour et nuit » éteint).
const FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform float daylight;
  uniform float night;
  uniform float gain;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vec3 albedo = texture2D(map, vUv).rgb;
    float c = dot(normalize(vNormalW), sunDir);
    float lit = pow(max(c, 0.0), 0.6) * smoothstep(0.0, 0.01, c);
    float k = mix(1.0, night + (gain - night) * lit, daylight);
    gl_FragColor = vec4(albedo * k, 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * @param {THREE.Texture} map texture couleur (sRGB)
 * @param {{night?:number, gain?:number}} opts niveau côté nuit et gain côté jour (linéaires)
 */
export function litSphereMaterial(map, { night = 0.1, gain = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, sunDir: { value: new THREE.Vector3(0, 0, 1) },
      daylight: { value: 1 }, night: { value: night }, gain: { value: gain },
    },
    vertexShader: VERT, fragmentShader: FRAG,
  });
}
