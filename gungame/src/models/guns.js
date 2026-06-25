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
// A gloved hand + forearm. Built in a local frame where the palm wraps the grip
// at the origin and the forearm tapers back toward the shooter (+Z). Positioned
// + rotated per weapon so the player reads as actually holding the gun.
function buildArm() {
  const glove = PALETTE.glove();
  const sleeve = PALETTE.sleeve();
  const arm = new THREE.Group();
  // back of the hand over the grip
  arm.add(box(0.052, 0.055, 0.078, glove, 0, 0, 0));
  // knuckle ridge
  arm.add(box(0.058, 0.022, 0.05, glove, 0, 0.033, -0.012));
  // curled fingers wrapping under/forward
  arm.add(box(0.06, 0.032, 0.045, glove, 0, -0.03, -0.016));
  // thumb on the inner side
  arm.add(box(0.022, 0.036, 0.032, glove, -0.033, 0.004, 0.006));
  // wrist cuff
  arm.add(box(0.064, 0.064, 0.045, sleeve, 0, -0.004, 0.052));
  // forearm tapering back toward the camera
  const fore = cyl(0.034, 0.052, 0.3, sleeve, 12);
  fore.rotation.x = Math.PI / 2; // +Y -> +Z
  fore.position.set(0, -0.014, 0.205);
  arm.add(fore);
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
// public API
// ---------------------------------------------------------------------------

// First-person viewmodel: full detail + gripping hands, no shadows, drawn over
// the world.
export function makeViewModel(id) {
  const g = id === 'pistol' ? buildPistol(true) : buildRifle(true);
  addHands(g, id);
  g.name = `viewmodel_${id}`;
  return asViewModel(g);
}

// Third-person / bot-hands weapon: same silhouette, simpler, casts shadows,
// scaled to ~0.6 long.
export function makeWorldWeapon(id) {
  const g = id === 'pistol' ? buildPistol(false) : buildRifle(false);
  g.name = `worldweapon_${id}`;
  asWorldModel(g);
  if (id !== 'pistol') {
    // Rifle is ~0.78 long; gently scale toward ~0.6 for the world version.
    g.scale.setScalar(0.78);
    if (g.userData.muzzleLocal) g.userData.muzzleLocal.multiplyScalar(0.78);
  }
  return g;
}

// Tunable gameplay stats per weapon.
export const WEAPONS = {
  rifle:  { name: 'Rifle',  mag: 30, reserve: 90, rpm: 600, damage: 24, spread: 0.012, reloadTime: 2.0, auto: true,  range: 200 },
  pistol: { name: 'Pistol', mag: 12, reserve: 48, rpm: 360, damage: 34, spread: 0.018, reloadTime: 1.3, auto: false, range: 120 },
};
