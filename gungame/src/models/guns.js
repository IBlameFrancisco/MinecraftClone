// GunGame weapon models. Everything is built from the shared stylized-modern
// primitive language in ../engine/materials.js so the guns read as part of the
// same world (clean, slightly saturated, PBR-lit). Two flavours are exported:
//
//   makeViewModel(id)   — the first-person hands weapon. Drawn on top of the
//                         world (renderOrder 20, no shadows) so it never clips
//                         into geometry.
//   makeWorldWeapon(id) — a slightly simpler version held by bots / dropped in
//                         the world, with real shadows.
//
// CONVENTION: the barrel points along -Z (forward, away from the shooter). The
// muzzle tip therefore sits at the most-negative Z, and each group records that
// point in `userData.muzzleLocal` (group-local space) so the shooting code can
// transform it to world space for the muzzle flash + bullet origin.
import * as THREE from 'three';
import { PALETTE, box, cyl } from '../engine/materials.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// A barrel-aligned cylinder: CylinderGeometry is built around +Y, so rotate it
// onto the Z axis and drop it at (x, y, z). `len` runs along Z.
function barrel(rt, rb, len, material, x = 0, y = 0, z = 0, seg = 14) {
  const m = cyl(rt, rb, len, material, seg);
  m.rotation.x = Math.PI / 2; // +Y -> +Z
  m.position.set(x, y, z);
  return m;
}

// Tag every mesh in the group as a viewmodel: no shadow casting, draw last.
function asViewModel(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = 20;
      if (o.material && 'depthTest' in o.material) {
        // keep depthTest on so the gun self-sorts; renderOrder handles world clipping
      }
    }
  });
  return group;
}

// Force every mesh in the group to cast/receive shadows (world weapon).
function asWorldModel(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

// ---------------------------------------------------------------------------
// RIFLE
// ---------------------------------------------------------------------------
// Long receiver, handguard + free-floated barrel up front, box magazine, a
// pistol grip and a collapsing-style stock at the back. Iron sights on top and
// a small orange accent on the body. Overall ~0.78 long.
function buildRifle(detailed) {
  const g = new THREE.Group();
  const body = PALETTE.gunBody();
  const poly = PALETTE.gunPoly();
  const accent = PALETTE.gunAccent();
  const metal = PALETTE.metal();
  const metalDk = PALETTE.metalDk();

  // Receiver / main body block. Centre roughly at origin, extends fore & aft.
  g.add(box(0.07, 0.075, 0.34, body, 0, 0, -0.03));
  // Upper rail housing sitting on the receiver.
  g.add(box(0.055, 0.03, 0.3, poly, 0, 0.052, -0.02));

  // Handguard ahead of the receiver (polymer), wrapping the front barrel run.
  g.add(box(0.05, 0.05, 0.2, poly, 0, 0.005, -0.27));

  // Barrel running forward out of the handguard.
  g.add(barrel(0.014, 0.014, 0.26, metal, 0, 0.005, -0.4));
  // Muzzle device / flash hider at the very tip.
  const muzzleZ = -0.56;
  g.add(barrel(0.022, 0.02, 0.05, metalDk, 0, 0.005, muzzleZ + 0.025));

  // Box magazine, angled slightly forward, dropping from the receiver.
  const magz = new THREE.Group();
  magz.add(box(0.035, 0.13, 0.06, poly, 0, -0.095, 0.0));
  magz.rotation.x = 0.12;
  magz.position.set(0, 0, 0.02);
  g.add(magz);

  // Pistol grip, raked back behind the magazine.
  const grip = new THREE.Group();
  grip.add(box(0.035, 0.11, 0.05, poly, 0, -0.06, 0));
  grip.rotation.x = -0.32;
  grip.position.set(0, -0.02, 0.11);
  g.add(grip);

  // Trigger guard hint.
  g.add(box(0.02, 0.015, 0.05, metalDk, 0, -0.05, 0.05));

  // Stock at the rear: a thin tube + a buttplate.
  g.add(barrel(0.012, 0.012, 0.12, metalDk, 0, 0.0, 0.2));
  g.add(box(0.05, 0.085, 0.04, poly, 0, -0.005, 0.27));

  // Iron sights on top: rear aperture + front post.
  g.add(box(0.012, 0.03, 0.012, metal, 0, 0.082, 0.08));   // rear sight
  g.add(box(0.012, 0.035, 0.012, metal, 0, 0.085, -0.34));  // front sight post

  // Small orange accent — a stripe on the side of the receiver.
  g.add(box(0.072, 0.014, 0.07, accent, 0, 0.0, 0.05));

  if (detailed) {
    // Charging handle nub + ejection port lip for a touch more read.
    g.add(box(0.018, 0.02, 0.02, metal, 0.038, 0.02, 0.02));
    g.add(box(0.012, 0.04, 0.05, metalDk, 0, 0.05, -0.16)); // optic riser front
  }

  g.userData.muzzleLocal = new THREE.Vector3(0, 0.005, muzzleZ);
  return g;
}

// ---------------------------------------------------------------------------
// PISTOL
// ---------------------------------------------------------------------------
// Compact slide + frame, single box magazine in the grip, short barrel. Iron
// sights on the slide and an orange accent on the frame. Overall ~0.34 long.
function buildPistol(detailed) {
  const g = new THREE.Group();
  const body = PALETTE.gunBody();
  const poly = PALETTE.gunPoly();
  const accent = PALETTE.gunAccent();
  const metal = PALETTE.metal();
  const metalDk = PALETTE.metalDk();

  // Slide (upper) running forward.
  g.add(box(0.05, 0.055, 0.26, body, 0, 0.02, -0.04));
  // Frame / receiver under the slide.
  g.add(box(0.045, 0.04, 0.18, poly, 0, -0.02, 0.0));

  // Short barrel poking out the front of the slide.
  const muzzleZ = -0.2;
  g.add(barrel(0.013, 0.013, 0.05, metalDk, 0, 0.02, muzzleZ + 0.025));

  // Grip with magazine, raked back.
  const grip = new THREE.Group();
  grip.add(box(0.04, 0.12, 0.05, poly, 0, -0.07, 0));
  // Magazine baseplate accent line.
  grip.add(box(0.045, 0.012, 0.055, metalDk, 0, -0.13, 0));
  grip.rotation.x = -0.28;
  grip.position.set(0, -0.03, 0.07);
  g.add(grip);

  // Trigger guard hint.
  g.add(box(0.018, 0.013, 0.045, metalDk, 0, -0.03, 0.04));

  // Iron sights: rear notch block + front post on the slide.
  g.add(box(0.014, 0.018, 0.012, metal, 0, 0.052, 0.06));   // rear sight
  g.add(box(0.012, 0.018, 0.012, metal, 0, 0.052, -0.15));  // front sight

  // Orange accent stripe on the frame.
  g.add(box(0.047, 0.012, 0.05, accent, 0, -0.02, 0.05));

  if (detailed) {
    // Slide serrations hint + ejection port.
    g.add(box(0.052, 0.025, 0.02, metalDk, 0, 0.03, 0.07));
  }

  g.userData.muzzleLocal = new THREE.Vector3(0, 0.02, muzzleZ);
  return g;
}

// ---------------------------------------------------------------------------
// FIRST-PERSON HANDS
// ---------------------------------------------------------------------------
// A small rounded mesh helper (for the gloved fist / knuckles).
function ball(r, material, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), material);
  m.scale.set(sx, sy, sz);
  return m;
}

// A gloved fist + forearm, built from rounded primitives (no stacked boxes) so it reads
// as an actual hand. Local frame: the fist grips at the origin, the forearm tapers back
// toward the shooter (+Z). Positioned + rotated per weapon by addHands().
function buildArm() {
  const glove = PALETTE.glove();
  const sleeve = PALETTE.sleeve();
  const arm = new THREE.Group();
  // gloved fist — an elongated, slightly squashed sphere wrapping the grip
  const fist = ball(0.05, glove, 1.05, 1.2, 1.45);
  fist.position.set(0, 0, -0.008);
  arm.add(fist);
  // knuckle row across the top-front of the fist
  for (let i = 0; i < 4; i++) {
    const k = ball(0.013, glove, 1, 1, 1.2);
    k.position.set(-0.021 + i * 0.014, 0.03, -0.038);
    arm.add(k);
  }
  // thumb — a short rounded cylinder along the inner side, angled over the grip
  const thumb = cyl(0.012, 0.015, 0.05, glove, 10);
  thumb.rotation.set(0.5, 0, 0.7);
  thumb.position.set(-0.032, 0.006, -0.004);
  arm.add(thumb);
  // wrist — a rounded cuff ring (sleeve)
  const cuff = cyl(0.041, 0.044, 0.05, sleeve, 16);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.008, 0.05);
  arm.add(cuff);
  // forearm — a tapered cylinder running back toward the camera, capped at the elbow
  const fore = cyl(0.036, 0.054, 0.3, sleeve, 16);
  fore.rotation.x = Math.PI / 2;
  fore.position.set(0, -0.014, 0.2);
  arm.add(fore);
  const elbow = ball(0.05, sleeve, 1, 1, 0.7); // elbow cap
  elbow.position.set(0, -0.016, 0.34);
  arm.add(elbow);
  return arm;
}

// Attach the gripping hands to a gun group (viewmodel only).
function addHands(g, id) {
  if (id === 'pistol') {
    const r = buildArm();
    r.position.set(0.005, -0.085, 0.075);
    r.rotation.set(0.52, 0.12, 0.0);
    g.add(r);
    const l = buildArm();                 // support hand cupping under the grip
    l.position.set(-0.03, -0.105, 0.045);
    l.rotation.set(0.72, -0.32, 0.22);
    l.scale.setScalar(0.95);
    g.add(l);
  } else {
    const r = buildArm();                 // firing hand on the pistol grip
    r.position.set(0.004, -0.085, 0.125);
    r.rotation.set(0.6, 0.12, 0.0);
    g.add(r);
    const l = buildArm();                 // support hand on the handguard up front
    l.position.set(0.0, -0.04, -0.235);
    l.rotation.set(0.78, 0.05, 0.0);
    g.add(l);
  }
}

// ---------------------------------------------------------------------------
// weapon variants — decorate the rifle/pistol bases, or build fresh tubes/sci bodies
// ---------------------------------------------------------------------------
function emi(hex, i = 1.1) { return new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: i, metalness: 0.3, roughness: 0.4 }); }
function metalTint(hex, rough = 0.45) { return new THREE.MeshStandardMaterial({ color: hex, metalness: 0.75, roughness: rough }); }
function ring(z, r, hex, i = 1.0) { const m = cyl(r, r, 0.02, emi(hex, i), 18); m.rotation.x = Math.PI / 2; m.position.set(0, 0.005, z); return m; }

function buildSMG() { const g = buildRifle(true); g.scale.setScalar(0.82); if (g.userData.muzzleLocal) g.userData.muzzleLocal.multiplyScalar(0.82); return g; }
function buildMG() {
  const g = buildRifle(true);
  const drum = cyl(0.072, 0.072, 0.05, PALETTE.metalDk(), 18); drum.rotation.z = Math.PI / 2; drum.position.set(0, -0.11, 0.02); g.add(drum);
  g.add(barrel(0.014, 0.014, 0.2, PALETTE.metal(), 0, 0.005, -0.46)); g.userData.muzzleLocal = new THREE.Vector3(0, 0.005, -0.64); return g;
}
function buildShotgunM() {
  const g = buildRifle(true);
  g.add(barrel(0.03, 0.03, 0.24, PALETTE.metalDk(), 0, 0.0, -0.42, 16));
  g.add(box(0.052, 0.04, 0.12, PALETTE.gunPoly(), 0, -0.05, -0.28)); g.userData.muzzleLocal = new THREE.Vector3(0, 0.0, -0.56); return g;
}
function buildSniper() {
  const g = buildRifle(true);
  g.add(barrel(0.012, 0.012, 0.26, PALETTE.metal(), 0, 0.005, -0.52, 14));
  const scope = cyl(0.022, 0.022, 0.17, PALETTE.metalDk(), 18); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.088, -0.04); g.add(scope);
  const lens = cyl(0.024, 0.024, 0.015, emi(0x36d1ff, 0.8), 18); lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.088, -0.13); g.add(lens);
  g.userData.muzzleLocal = new THREE.Vector3(0, 0.005, -0.68); return g;
}
function buildLauncher(hex) {
  const g = new THREE.Group();
  const tube = cyl(0.052, 0.056, 0.5, metalTint(0x4a5040), 20); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.01, -0.12); g.add(tube);
  g.add(ring(-0.34, 0.06, hex)); g.add(ring(-0.2, 0.06, hex));
  const grip = new THREE.Group(); grip.add(box(0.04, 0.12, 0.05, PALETTE.gunPoly(), 0, -0.06, 0)); grip.rotation.x = -0.3; grip.position.set(0, -0.04, 0.05); g.add(grip);
  g.add(box(0.05, 0.05, 0.16, PALETTE.gunBody(), 0, -0.02, 0.1));
  const mouth = cyl(0.05, 0.05, 0.015, emi(hex, 0.7), 20); mouth.rotation.x = Math.PI / 2; mouth.position.set(0, 0.01, -0.37); g.add(mouth);
  g.userData.muzzleLocal = new THREE.Vector3(0, 0.01, -0.39); return g;
}
function buildSci(hex) {
  const g = new THREE.Group();
  g.add(box(0.06, 0.06, 0.36, metalTint(0x2a2e3a), 0, 0, -0.04));
  g.add(box(0.05, 0.03, 0.3, metalTint(0x363b4a), 0, 0.05, -0.02));
  g.add(box(0.04, 0.02, 0.26, emi(hex, 1.2), 0, 0.0, -0.04));
  const bar = cyl(0.02, 0.025, 0.2, metalTint(0x20242e), 16); bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.005, -0.34); g.add(bar);
  g.add(ring(-0.3, 0.032, hex, 1.4)); g.add(ring(-0.22, 0.032, hex, 1.4));
  const lens = cyl(0.026, 0.026, 0.018, emi(hex, 1.7), 18); lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.005, -0.45); g.add(lens);
  const grip = new THREE.Group(); grip.add(box(0.035, 0.11, 0.05, PALETTE.gunPoly(), 0, -0.06, 0)); grip.rotation.x = -0.32; grip.position.set(0, -0.02, 0.1); g.add(grip);
  g.add(box(0.05, 0.07, 0.04, PALETTE.gunPoly(), 0, -0.005, 0.22));
  g.userData.muzzleLocal = new THREE.Vector3(0, 0.005, -0.46); return g;
}

function buildByModel(model) {
  switch (model) {
    case 'pistol': return buildPistol(true);
    case 'smg': return buildSMG();
    case 'mg': return buildMG();
    case 'shotgun': return buildShotgunM();
    case 'sniper': return buildSniper();
    case 'launcher-rocket': return buildLauncher(0xff7a2f);
    case 'launcher-homing': return buildLauncher(0x3aa0c0);
    case 'sci-rail': return buildSci(0x9a3cff);
    case 'sci-plasma': return buildSci(0x2bd6c0);
    case 'sci-laser': return buildSci(0xff2e54);
    default: return buildRifle(true);
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
export function makeViewModel(id) {
  const w = WEAPONS[id] || WEAPONS.rifle;
  const g = buildByModel(w.model);
  addHands(g, w.model === 'pistol' ? 'pistol' : 'rifle');
  g.name = `viewmodel_${id}`;
  return asViewModel(g);
}

export function makeWorldWeapon(id) {
  const w = WEAPONS[id] || WEAPONS.rifle;
  const g = buildByModel(w.model);
  g.name = `worldweapon_${id}`;
  asWorldModel(g);
  if (w.model !== 'pistol') { g.scale.setScalar(0.78); if (g.userData.muzzleLocal) g.userData.muzzleLocal.multiplyScalar(0.78); }
  return g;
}

// Tunable gameplay stats per weapon. `kind` selects the firing logic in weapons.js:
//   hitscan | shotgun | rail (piercing hitscan) | projectile (proj: plasma|rocket|homing) | beam
export const WEAPONS = {
  pistol:  { name: 'Pistol',          model: 'pistol',         kind: 'hitscan', mag: 12, reserve: 60,  rpm: 360,  damage: 30, spread: 0.016, reloadTime: 1.2, auto: false, range: 120 },
  smg:     { name: 'SMG',             model: 'smg',            kind: 'hitscan', mag: 30, reserve: 150, rpm: 900,  damage: 14, spread: 0.030, reloadTime: 1.4, auto: true,  range: 90 },
  rifle:   { name: 'Assault Rifle',   model: 'ar',             kind: 'hitscan', mag: 30, reserve: 120, rpm: 600,  damage: 22, spread: 0.013, reloadTime: 1.8, auto: true,  range: 170 },
  shotgun: { name: 'Shotgun',         model: 'shotgun',        kind: 'shotgun', mag: 6,  reserve: 42,  rpm: 80,   damage: 11, pellets: 9, spread: 0.10, reloadTime: 0.95, auto: false, range: 42 },
  sniper:  { name: 'Sniper',          model: 'sniper',         kind: 'hitscan', mag: 5,  reserve: 30,  rpm: 50,   damage: 88, spread: 0.0,   reloadTime: 2.4, auto: false, range: 320, zoom: true },
  mg42:    { name: 'MG42',            model: 'mg',             kind: 'hitscan', mag: 75, reserve: 225, rpm: 1100, damage: 16, spread: 0.048, reloadTime: 3.3, auto: true,  range: 130 },
  railgun: { name: 'Railgun',         model: 'sci-rail',       kind: 'rail',    mag: 4,  reserve: 20,  rpm: 45,   damage: 75, spread: 0.0,   reloadTime: 2.2, auto: false, range: 320, pierce: true, color: 0x9a3cff },
  plasma:  { name: 'Plasma Gun',      model: 'sci-plasma',     kind: 'projectile', proj: 'plasma', mag: 20, reserve: 80, rpm: 220, damage: 26, speed: 62, splash: 16, radius: 2.6, reloadTime: 1.5, auto: true, range: 130, color: 0x2bd6c0 },
  laser:   { name: 'Laser Cannon',    model: 'sci-laser',      kind: 'beam',    mag: 100, reserve: 0,  dps: 120, drain: 18, reloadTime: 2.6, range: 140, range2: 140, auto: true, color: 0xff2e54 },
  rocket:  { name: 'Rocket Launcher', model: 'launcher-rocket', kind: 'projectile', proj: 'rocket', mag: 3, reserve: 12, rpm: 60, damage: 55, speed: 44, splash: 58, radius: 5.2, reloadTime: 2.4, auto: false, range: 170, color: 0xff7a2f },
  homing:  { name: 'Homing Missile',  model: 'launcher-homing', kind: 'projectile', proj: 'homing', mag: 4, reserve: 12, rpm: 55, damage: 42, speed: 32, turn: 4.4, splash: 40, radius: 4.4, reloadTime: 2.6, auto: false, range: 220, color: 0x3aa0c0 },
};

// Gun Game weapon ladder (easy → spectacle); finishing it wins the round.
export const GUN_LADDER = ['pistol', 'smg', 'rifle', 'shotgun', 'mg42', 'sniper', 'plasma', 'railgun', 'laser', 'rocket'];
