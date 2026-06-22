// Shared chunk materials. Opaque terrain uses MeshBasicMaterial with lighting
// (AO + skylight + face shade) baked into vertex colours and a global day/night
// tint. Water is a custom ShaderMaterial: Gerstner waves, fresnel reflection of
// the sky colour, animated sun specular, vertex-colour shading, and scene fog.

import * as THREE from 'three';
import { atlasTexture } from './textures.js';

export const opaqueMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  fog: true,
});

// Day/night tint applied to the whole opaque world (linear-space multiplier).
export function setWorldTint(r, g, b) {
  opaqueMaterial.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

// ---------------- Water ----------------
export const waterMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: true,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
      uHorizon: { value: new THREE.Color(0.6, 0.78, 0.95) },
      uOpacity: { value: 0.78 },
    },
  ]),
  vertexShader: `
    uniform float uTime;
    attribute vec3 color;
    varying vec3 vColor;
    varying vec3 vWorld;
    varying vec3 vNormal;
    #include <fog_pars_vertex>
    void main() {
      vColor = color;
      // Drive waves from WORLD position so they're seamless across chunk borders.
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
      // Three primary swells plus a small high-frequency ripple for a livelier,
      // less obviously-tiled surface. Derivatives below are matched analytically
      // so the lighting normal tracks the displacement exactly.
      float w = sin(wp.x * 0.6 + uTime * 1.6) * 0.06
              + sin(wp.z * 0.5 - uTime * 1.2) * 0.05
              + sin((wp.x + wp.z) * 0.9 + uTime * 2.3) * 0.03
              + sin((wp.x - wp.z) * 1.7 + uTime * 3.1) * 0.015;
      wp.y += w;
      float dx = 0.6 * cos(wp.x * 0.6 + uTime * 1.6) * 0.06
               + 0.9 * cos((wp.x + wp.z) * 0.9 + uTime * 2.3) * 0.03
               + 1.7 * cos((wp.x - wp.z) * 1.7 + uTime * 3.1) * 0.015;
      float dz = -0.5 * cos(wp.z * 0.5 - uTime * 1.2) * 0.05
               + 0.9 * cos((wp.x + wp.z) * 0.9 + uTime * 2.3) * 0.03
               - 1.7 * cos((wp.x - wp.z) * 1.7 + uTime * 3.1) * 0.015;
      vNormal = normalize(vec3(-dx, 1.0, -dz));
      vWorld = wp;
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform vec3 uSunDir;
    uniform vec3 uHorizon;
    uniform float uOpacity;
    varying vec3 vColor;
    varying vec3 vWorld;
    varying vec3 vNormal;
    #include <fog_pars_fragment>
    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorld);
      // Schlick-style fresnel with a small base reflectance so glancing water
      // catches the sky smoothly instead of snapping bright at the grazing edge.
      float ndv = max(dot(N, V), 0.0);
      float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);
      vec3 deep = vec3(0.03, 0.17, 0.31);
      vec3 shallow = vec3(0.10, 0.44, 0.58);
      // Bias the depth blend toward the deep tone so steeper wave faces gain
      // richer colour and the surface reads with more volume.
      vec3 base = mix(deep, shallow, pow(clamp(N.y, 0.0, 1.0), 1.4));
      base *= (0.45 + 0.55 * vColor.r);                 // baked sky/AO shading
      vec3 H = normalize(uSunDir + V);
      float ndh = max(dot(N, H), 0.0);
      // Tight sun glint plus a soft broad sheen for a more natural highlight.
      float spec = pow(ndh, 120.0) + 0.18 * pow(ndh, 16.0);
      vec3 col = mix(base, uHorizon, fres * 0.55) + spec * vec3(1.0, 0.96, 0.82);
      gl_FragColor = vec4(col, uOpacity);
      #include <fog_fragment>
    }`,
});

// Convenience handle so the loop can advance the wave animation.
export const waterTime = waterMaterial.uniforms.uTime;

// Sky drives the water's sun direction and fresnel reflection colour.
export function setWaterEnv(sunDir, horizonColor, opacity) {
  waterMaterial.uniforms.uSunDir.value.copy(sunDir);
  waterMaterial.uniforms.uHorizon.value.copy(horizonColor);
  if (opacity !== undefined) waterMaterial.uniforms.uOpacity.value = opacity;
}
