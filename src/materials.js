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
      vec3 p = position;
      float w = sin(p.x * 0.6 + uTime * 1.6) * 0.06
              + sin(p.z * 0.5 - uTime * 1.2) * 0.05
              + sin((p.x + p.z) * 0.9 + uTime * 2.3) * 0.03;
      p.y += w;
      float dx = 0.6 * cos(p.x * 0.6 + uTime * 1.6) * 0.06
               + 0.9 * cos((p.x + p.z) * 0.9 + uTime * 2.3) * 0.03;
      float dz = -0.5 * cos(p.z * 0.5 - uTime * 1.2) * 0.05
               + 0.9 * cos((p.x + p.z) * 0.9 + uTime * 2.3) * 0.03;
      vNormal = normalize(vec3(-dx, 1.0, -dz));
      vec4 worldPos = modelMatrix * vec4(p, 1.0);
      vWorld = worldPos.xyz;
      vec4 mvPosition = viewMatrix * worldPos;
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
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      vec3 deep = vec3(0.04, 0.20, 0.34);
      vec3 shallow = vec3(0.10, 0.42, 0.56);
      vec3 base = mix(deep, shallow, clamp(N.y, 0.0, 1.0));
      base *= (0.45 + 0.55 * vColor.r);                 // baked sky/AO shading
      vec3 H = normalize(uSunDir + V);
      float spec = pow(max(dot(N, H), 0.0), 90.0);
      vec3 col = mix(base, uHorizon, fres * 0.6) + spec * vec3(1.0, 0.95, 0.8);
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
