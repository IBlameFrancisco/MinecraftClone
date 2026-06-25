// Shared material language for GunGame. Environment surfaces use REAL CC0 PBR texture
// sets (albedo + normal + roughness) loaded by assets.js, so concrete/metal/wood/rust
// read like actual materials under the HDRI-lit, ACES-tonemapped scene. Characters and
// guns stay flat PBR (tiny meshes, no good UVs) but still pick up the real lighting.
import * as THREE from 'three';
import { TEX } from './assets.js';

const _cache = new Map();

// Flat (untextured) stylized PBR material. `o` = { color, rough, metal, emissive,
// emissiveIntensity, flatShading }.
export function mat(o = {}) {
  const key = 'flat:' + JSON.stringify(o);
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

// Textured PBR material built from a loaded TEX set (ground/concrete/wood/metal/rust).
// `o` = { color (tint), rough, metal, normal, tile }. roughness/metalness modulate the
// maps. `tile` is the world-units-per-texture-repeat used by box() for UV scaling, so the
// texel density is consistent no matter how big the box is.
export function texMat(setName, o = {}) {
  const key = 'tex:' + setName + ':' + JSON.stringify(o);
  if (_cache.has(key)) return _cache.get(key);
  const set = TEX[setName] || {};
  const m = new THREE.MeshStandardMaterial({
    map: set.map || null,
    normalMap: set.normalMap || null,
    roughnessMap: set.roughnessMap || null,
    color: o.color ?? 0xffffff,
    roughness: o.rough ?? 1.0,
    metalness: o.metal ?? 0.0,
  });
  if (set.normalMap) m.normalScale.set(o.normal ?? 0.9, o.normal ?? 0.9);
  m.userData.tile = o.tile ?? 2.6;   // box() reads this to scale UVs per-face
  _cache.set(key, m);
  return m;
}

// A named palette — call PALETTE.x() to get the shared material. Environment entries are
// textured; character/gun entries are flat PBR.
export const PALETTE = {
  // --- environment (REAL textures) ---
  // Walls/platform use the worn-concrete set (neutral grey); the floor uses the same set
  // darker + a bigger tile so it reads distinct from the walls.
  concrete:   () => texMat('ground',   { color: 0xcdd1d6, rough: 1.0, tile: 3.4 }),
  concreteDk: () => texMat('ground',   { color: 0x7c818a, rough: 1.0, tile: 3.4 }),
  plaster:    () => texMat('ground',   { color: 0xdee1e6, rough: 1.0, normal: 0.7, tile: 3.6 }),
  asphalt:    () => texMat('ground',   { color: 0x73777e, rough: 1.0, tile: 4.4 }),
  metal:      () => texMat('metal',    { color: 0xc4cbd3, rough: 0.85, metal: 0.9, normal: 0.8, tile: 2.6 }),
  metalDk:    () => texMat('metal',    { color: 0x6a7079, rough: 0.9, metal: 0.85, normal: 0.8, tile: 2.4 }),
  rust:       () => texMat('rust',     { color: 0xc98f6e, rough: 0.95, metal: 0.35, tile: 2.4 }),
  wood:       () => texMat('wood',     { color: 0xcb9c5a, rough: 0.95, normal: 1.2, tile: 1.05 }),
  woodDk:     () => texMat('wood',     { color: 0x8a6536, rough: 0.95, normal: 1.2, tile: 1.05 }),
  sand:       () => texMat('ground',   { color: 0xd9c08a, rough: 1.0, tile: 3.0 }),
  grass:      () => mat({ color: 0x6fae47, rough: 1.0 }),
  glass:      () => new THREE.MeshStandardMaterial({ color: 0x9fd4e6, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.32, envMapIntensity: 1.4 }),
  // --- accents / team colours (painted metal so they catch the HDRI) ---
  orange:     () => texMat('metal',    { color: 0xff6a1f, rough: 0.55, metal: 0.5, normal: 0.5, tile: 2.6 }),
  blue:       () => texMat('metal',    { color: 0x26b6ff, rough: 0.55, metal: 0.5, normal: 0.5, tile: 2.6 }),
  emberLight: () => mat({ color: 0xffd98a, rough: 0.4, emissive: 0xffcf6a, emissiveIntensity: 2.2 }),
  // --- characters (flat PBR) ---
  skin:       () => mat({ color: 0xe3a877, rough: 0.7 }),
  clothBlue:  () => mat({ color: 0x2b4f8e, rough: 0.85 }),
  clothRed:   () => mat({ color: 0x8e2b3a, rough: 0.85 }),
  gear:       () => mat({ color: 0x2a2e36, rough: 0.7, metal: 0.2 }),
  // --- guns (flat PBR) ---
  gunBody:    () => mat({ color: 0x23262c, rough: 0.5, metal: 0.6 }),
  gunPoly:    () => mat({ color: 0x3a3038, rough: 0.7, metal: 0.1 }),
  gunAccent:  () => mat({ color: 0xff7a2f, rough: 0.5, metal: 0.3 }),
};

// Scale a BoxGeometry's per-face UVs so a textured material tiles at a consistent
// world-space density (`tile` = world units per repeat) regardless of box dimensions.
// BoxGeometry lays out 6 faces x 4 verts; each face's in-plane size depends on which
// axis-pair it spans.
function scaleBoxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +X,-X,+Y,-Y,+Z,-Z
  for (let f = 0; f < 6; f++) {
    const us = dims[f][0] / tile, vs = dims[f][1] / tile;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * us, uv.getY(idx) * vs);
    }
  }
  uv.needsUpdate = true;
}

// Box helper — casts + receives shadows, and auto-scales UVs for textured materials so
// the texture tiles at a uniform real-world density.
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (material && material.map) scaleBoxUV(geo, w, h, d, material.userData.tile || 2.6);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cyl(rt, rb, h, material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
