// Shared chunk materials. Opaque terrain and animated transparent water both use
// MeshBasicMaterial so lighting is fully baked into vertex colors (AO + skylight)
// and globally tinted via material.color for the day/night cycle.

import * as THREE from 'three';
import { atlasTexture } from './textures.js';

export const opaqueMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  fog: true,
});

// One shared uniform drives the water surface wave across all chunk meshes.
export const waterTime = { value: 0 };

export const waterMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture,
  vertexColors: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: true,
});
waterMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = waterTime;
  shader.vertexShader =
    'uniform float uTime;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(uTime * 1.7 + position.x * 0.6 + position.z * 0.6) * 0.045
                      + sin(uTime * 1.1 + position.x * 0.3 - position.z * 0.45) * 0.03;`,
    );
};

// Day/night tint applied to the whole world (linear-space multiplier).
export function setWorldTint(r, g, b) {
  opaqueMaterial.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  waterMaterial.color.setRGB(r * 0.9 + 0.1, g * 0.95 + 0.05, b, THREE.LinearSRGBColorSpace);
}
