// Shared material language for GunGame's stylized-modern look. Everything is PBR
// (MeshStandardMaterial) so it reacts to the scene's real lighting + shadows, but kept
// clean and a touch saturated (Fortnite-leaning) rather than gritty-photoreal.
import * as THREE from 'three';

// A small cache so identical materials are shared (fewer draw-state changes).
const _cache = new Map();

// Make (or fetch) a stylized PBR material. `o` = { color, rough, metal, emissive,
// emissiveIntensity, flatShading }.
export function mat(o = {}) {
  const key = JSON.stringify(o);
  if (_cache.has(key)) return _cache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xaab2bd,
    roughness: o.rough ?? 0.8,
    metalness: o.metal ?? 0.0,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    flatShading: !!o.flatShading,
  });
  _cache.set(key, m);
  return m;
}

// A named palette — call PALETTE.x() to get the shared material. Tuned to read well
// under the ACES-tonemapped sun + sky fill.
export const PALETTE = {
  // --- environment ---
  concrete:   () => mat({ color: 0x8b94a3, rough: 0.95 }),
  concreteDk: () => mat({ color: 0x5a626f, rough: 0.95 }),
  plaster:    () => mat({ color: 0xc8cdd6, rough: 0.9 }),
  asphalt:    () => mat({ color: 0x3a3f48, rough: 1.0 }),
  metal:      () => mat({ color: 0x9aa3ad, rough: 0.45, metal: 0.85 }),
  metalDk:    () => mat({ color: 0x4b525c, rough: 0.5, metal: 0.8 }),
  rust:       () => mat({ color: 0xa6603a, rough: 0.85, metal: 0.3 }),
  wood:       () => mat({ color: 0xb6843f, rough: 0.8 }),
  woodDk:     () => mat({ color: 0x7c5527, rough: 0.85 }),
  sand:       () => mat({ color: 0xd9c08a, rough: 1.0 }),
  grass:      () => mat({ color: 0x6fae47, rough: 1.0 }),
  glass:      () => new THREE.MeshStandardMaterial({ color: 0x9fd4e6, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.34 }),
  // --- accents / team colours ---
  orange:     () => mat({ color: 0xff7a2f, rough: 0.6, emissive: 0xff7a2f, emissiveIntensity: 0.25 }),
  blue:       () => mat({ color: 0x36d1ff, rough: 0.6, emissive: 0x36d1ff, emissiveIntensity: 0.25 }),
  emberLight: () => mat({ color: 0xffd98a, rough: 0.4, emissive: 0xffcf6a, emissiveIntensity: 2.2 }),
  // --- characters ---
  skin:       () => mat({ color: 0xe3a877, rough: 0.7 }),
  clothBlue:  () => mat({ color: 0x2b4f8e, rough: 0.85 }),
  clothRed:   () => mat({ color: 0x8e2b3a, rough: 0.85 }),
  gear:       () => mat({ color: 0x2a2e36, rough: 0.7, metal: 0.2 }),
  // --- guns ---
  gunBody:    () => mat({ color: 0x23262c, rough: 0.5, metal: 0.6 }),
  gunPoly:    () => mat({ color: 0x3a3038, rough: 0.7, metal: 0.1 }),
  gunAccent:  () => mat({ color: 0xff7a2f, rough: 0.5, metal: 0.3 }),
};

// Quick box/cylinder/sphere mesh helpers that cast + receive shadows by default.
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cyl(rt, rb, h, material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
