// Shared material language for GunGame. Environment surfaces use REAL CC0 PBR texture
// sets (albedo + normal + roughness) loaded by assets.js, so concrete/metal/wood/rust
// read like actual materials under the HDRI-lit, ACES-tonemapped scene. Characters and
// guns stay flat PBR (tiny meshes, no good UVs) but still pick up the real lighting.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEX } from './assets.js';

const _cache = new Map();

// Flat (untextured) stylized PBR material. `o` = { color, rough, metal, emissive,
// emissiveIntensity, flatShading, env }.
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
  m.envMapIntensity = o.env ?? 1.15;   // let the HDRI reflect a touch more for life
  _cache.set(key, m);
  return m;
}

// Textured PBR material built from a loaded TEX set (ground/wood/metal/rust).
// `o` = { color (tint), rough, metal, normal, tile, env }. roughness/metalness modulate
// the maps. `tile` is the world-units-per-texture-repeat used by box() for UV scaling so
// the texel density is consistent no matter how big the box is.
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
  m.envMapIntensity = o.env ?? 1.15;
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
  concrete:   () => texMat('ground',   { color: 0xb7bcc4, rough: 0.98, tile: 3.4 }),
  concreteDk: () => texMat('ground',   { color: 0x6b7078, rough: 0.98, tile: 3.4 }),
  plaster:    () => texMat('ground',   { color: 0xd2d6dc, rough: 1.0, normal: 0.7, tile: 3.6 }),
  // darker, slightly damp asphalt — kills the bright flat-plane look and reflects the sky
  asphalt:    () => texMat('ground',   { color: 0x44474d, rough: 0.78, metal: 0.08, normal: 1.1, tile: 4.4, env: 1.3 }),
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
  // --- first-person hands ---
  glove:      () => mat({ color: 0x32373f, rough: 0.5, metal: 0.15 }),
  sleeve:     () => mat({ color: 0x5b6675, rough: 0.85 }),
  // --- guns (flat PBR) ---
  gunBody:    () => mat({ color: 0x23262c, rough: 0.5, metal: 0.6 }),
  gunPoly:    () => mat({ color: 0x3a3038, rough: 0.7, metal: 0.1 }),
  gunAccent:  () => mat({ color: 0xff7a2f, rough: 0.5, metal: 0.3 }),
};

// World-projected (triplanar-style) UVs that tile a texture at a consistent real-world
// density on ANY geometry — including RoundedBoxGeometry, whose vertices don't follow the
// simple 6-face layout. Each vertex is projected onto the plane its normal points along.
function boxProjectUV(geo, tile) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  if (!pos || !nor || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz) { u = pos.getZ(i); v = pos.getY(i); }
    else if (ny >= nx && ny >= nz) { u = pos.getX(i); v = pos.getZ(i); }
    else { u = pos.getX(i); v = pos.getY(i); }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

// Box helper — now a *rounded* box so edges catch light instead of reading as razor-sharp
// CG cubes. Casts + receives shadows, and world-projects UVs for textured materials so the
// texture tiles at a uniform real-world density.
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const r = Math.min(0.09, Math.min(w, h, d) * 0.06);  // gentle edge bevel, scaled to size
  const geo = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.006, r));
  if (material && material.map) boxProjectUV(geo, material.userData.tile || 2.6);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cyl(rt, rb, h, material, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
