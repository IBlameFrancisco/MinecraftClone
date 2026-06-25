// A stylized low-poly humanoid soldier for GunGame. Fortnite-leaning proportions
// (slightly oversized head + hands), ~1.8 units tall, built entirely from box/cyl
// primitives sharing the project's PBR material language. The group ORIGIN SITS AT
// THE FEET, so `group.position.y = 0` plants the soldier on the ground.
//
// Limbs are grouped at their joints (hip / knee / shoulder) so they can be rotated
// for procedural animation. References to the rotatable joints are stored on
// `group.userData.parts`, and `group.userData.anim(st, dt, t)` drives a readable
// idle/run cycle.
import * as THREE from 'three';
import { PALETTE, box, cyl } from '../engine/materials.js';

export function makeCharacter(opts = {}) {
  const team = opts.team === 'red' ? 'red' : 'blue';
  const cloth = team === 'red' ? PALETTE.clothRed() : PALETTE.clothBlue();
  const accent = team === 'red' ? PALETTE.orange() : PALETTE.blue();
  const skin = PALETTE.skin();
  const gear = PALETTE.gear();
  const metal = PALETTE.metalDk();

  const group = new THREE.Group();

  // ----- vertical layout (measured from the feet, y = 0) -----
  const BOOT_H = 0.12;          // ankle/boot block
  const LOWER_LEG_H = 0.34;     // shin
  const UPPER_LEG_H = 0.34;     // thigh
  const HIP_Y = BOOT_H + LOWER_LEG_H + UPPER_LEG_H; // top of the legs ≈ 0.80
  const TORSO_H = 0.52;         // chest + abdomen
  const NECK_H = 0.04;
  const HEAD_H = 0.34;          // big stylized head incl. helmet
  // Total ≈ 0.80 + 0.52 + 0.04 + 0.34 = 1.80

  const LEG_X = 0.13;           // half-spacing of the legs
  const SHOULDER_X = 0.26;      // half-spacing of the arms
  const SHOULDER_Y = HIP_Y + TORSO_H - 0.06;

  // =====================================================================
  // LEGS  (hip group -> upper leg, then knee group -> lower leg + boot)
  // =====================================================================
  function makeLeg(side) {
    const sx = side * LEG_X;
    // Hip joint pivot sits at the top of the thigh.
    const leg = new THREE.Group();
    leg.position.set(sx, HIP_Y, 0);

    // Upper leg (thigh): hangs downward from the hip pivot.
    const thigh = box(0.18, UPPER_LEG_H, 0.20, cloth, 0, -UPPER_LEG_H / 2, 0);
    leg.add(thigh);

    // Knee joint pivot at the bottom of the thigh.
    const lower = new THREE.Group();
    lower.position.set(0, -UPPER_LEG_H, 0);

    // Lower leg (shin).
    const shin = box(0.16, LOWER_LEG_H, 0.18, gear, 0, -LOWER_LEG_H / 2, 0);
    lower.add(shin);

    // Boot at the bottom of the shin, pushed slightly forward (toe).
    const boot = box(0.18, BOOT_H, 0.26, metal, 0, -LOWER_LEG_H - BOOT_H / 2, 0.04);
    lower.add(boot);

    leg.add(lower);
    group.add(leg);
    return { leg, lower };
  }

  const left = makeLeg(1);
  const right = makeLeg(-1);
  const lLeg = left.leg, lLegLower = left.lower;
  const rLeg = right.leg, rLegLower = right.lower;

  // =====================================================================
  // TORSO  (chest/vest, belt accent, backpack)
  // =====================================================================
  const torso = new THREE.Group();
  torso.position.set(0, HIP_Y, 0);

  // Abdomen/hips (cloth) low on the torso.
  const pelvis = box(0.42, 0.16, 0.24, cloth, 0, 0.08, 0);
  torso.add(pelvis);

  // Chest / tactical vest (gear) — the bulk of the torso.
  const chest = box(0.46, TORSO_H - 0.16, 0.26, gear, 0, 0.16 + (TORSO_H - 0.16) / 2, 0);
  torso.add(chest);

  // Vest front plate accent.
  const plate = box(0.22, 0.18, 0.04, accent, 0, TORSO_H - 0.18, 0.15);
  torso.add(plate);

  // Belt accent line.
  const belt = box(0.44, 0.05, 0.26, metal, 0, 0.18, 0);
  torso.add(belt);

  // Shoulders (cloth) to soften the vest-to-arm transition.
  torso.add(box(0.16, 0.14, 0.22, cloth, SHOULDER_X - 0.04, SHOULDER_Y - HIP_Y + 0.06, 0));
  torso.add(box(0.16, 0.14, 0.22, cloth, -(SHOULDER_X - 0.04), SHOULDER_Y - HIP_Y + 0.06, 0));

  // Backpack mounted on the rear of the chest.
  const pack = box(0.30, 0.34, 0.16, gear, 0, TORSO_H * 0.55, -0.20);
  torso.add(pack);
  torso.add(box(0.10, 0.10, 0.04, accent, 0, TORSO_H * 0.55, -0.29)); // pack accent

  group.add(torso);

  // =====================================================================
  // HEAD  (neck, head, helmet, visor accent) — parented to the torso so it
  // bobs with breathing, but exposed for independent rotation.
  // =====================================================================
  const head = new THREE.Group();
  // Neck base sits just above the chest, expressed in torso-local space.
  head.position.set(0, TORSO_H + NECK_H, 0);

  // Neck.
  head.add(box(0.12, NECK_H + 0.04, 0.12, skin, 0, -0.02, 0));

  // Big stylized head (skin).
  const headBlock = box(0.32, HEAD_H * 0.70, 0.32, skin, 0, HEAD_H * 0.35, 0);
  head.add(headBlock);

  // Jaw / chin taper.
  head.add(box(0.24, 0.09, 0.26, skin, 0, 0.045, 0.02));

  // Helmet shell (gear) capping the head — sized so the crown lands at ~1.8 tall.
  const helmet = box(0.36, HEAD_H * 0.66, 0.36, gear, 0, HEAD_H * 0.90, 0);
  head.add(helmet);

  // Helmet brim / visor accent.
  head.add(box(0.32, 0.05, 0.06, accent, 0, HEAD_H * 0.62, 0.18));

  torso.add(head);

  // =====================================================================
  // ARMS  (shoulder group -> upper arm, then elbow group -> lower arm + hand)
  // Held slightly forward + inward as if cradling a weapon.
  // =====================================================================
  const UPPER_ARM_H = 0.26;
  const LOWER_ARM_H = 0.24;

  function makeArm(side) {
    const sx = side * SHOULDER_X;
    // Shoulder pivot.
    const arm = new THREE.Group();
    arm.position.set(sx, SHOULDER_Y, 0.02);
    // Base pose: rotate forward (X) so the arms reach toward a held weapon,
    // and slightly inward (Z) so the hands converge near the chest centerline.
    arm.rotation.x = -0.55;
    arm.rotation.z = side * 0.12;

    // Upper arm (cloth sleeve).
    const upper = box(0.13, UPPER_ARM_H, 0.14, cloth, 0, -UPPER_ARM_H / 2, 0);
    arm.add(upper);

    // Elbow pivot at the bottom of the upper arm.
    const lower = new THREE.Group();
    lower.position.set(0, -UPPER_ARM_H, 0);
    lower.rotation.x = -0.5; // forearm bent up toward the weapon

    // Forearm (skin).
    lower.add(box(0.115, LOWER_ARM_H, 0.12, skin, 0, -LOWER_ARM_H / 2, 0));

    // Glove / oversized hand (gear) at the end of the forearm.
    lower.add(box(0.15, 0.13, 0.15, gear, 0, -LOWER_ARM_H - 0.04, 0.01));

    arm.add(lower);
    group.add(arm);
    return arm;
  }

  const lArm = makeArm(1);
  const rArm = makeArm(-1);

  // Make sure every mesh casts + receives shadows (helpers already set this, but
  // enforce it across the whole hierarchy to be safe).
  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  // =====================================================================
  // EXPOSE PARTS + ANIMATION
  // =====================================================================
  group.userData.parts = {
    head, torso, lArm, rArm, lLeg, rLeg, lLegLower, rLegLower,
  };

  // Remember base transforms so animation is always relative (no drift).
  const base = {
    torsoY: torso.position.y,
    headRotX: head.rotation.x,
    lArmRotX: lArm.rotation.x,
    rArmRotX: rArm.rotation.x,
    lArmRotZ: lArm.rotation.z,
    rArmRotZ: rArm.rotation.z,
    lLegLowerRotX: lLegLower.rotation.x,
    rLegLowerRotX: rLegLower.rotation.x,
  };

  // Procedural animation. st = { moving, speed (0..1), t }.
  group.userData.anim = (st = {}, _dt = 0, t = 0) => {
    const time = (st.t != null) ? st.t : t;
    const speed = Math.min(Math.max(st.speed || 0, 0), 1);
    const moving = !!st.moving && speed > 0.01;

    if (moving) {
      // --- RUN CYCLE ---
      const k = 9.0;                       // stride frequency
      const phase = time * speed * k;
      const swing = 0.9 * speed;           // hip/shoulder swing amplitude
      const s = Math.sin(phase);
      const sOpp = Math.sin(phase + Math.PI);

      // Legs swing in opposition at the hips.
      lLeg.rotation.x = s * swing;
      rLeg.rotation.x = sOpp * swing;

      // Knees bend on the back half of each leg's swing (clamped to never
      // hyperextend forward).
      lLegLower.rotation.x = base.lLegLowerRotX - Math.max(0, -s) * 0.9 * speed;
      rLegLower.rotation.x = base.rLegLowerRotX - Math.max(0, -sOpp) * 0.9 * speed;

      // Arms swing opposite to their same-side leg (kept tighter since the arms
      // are also "holding" the weapon).
      lArm.rotation.x = base.lArmRotX + sOpp * swing * 0.5;
      rArm.rotation.x = base.rArmRotX + s * swing * 0.5;
      lArm.rotation.z = base.lArmRotZ;
      rArm.rotation.z = base.rArmRotZ;

      // Vertical bob at twice the stride frequency.
      torso.position.y = base.torsoY + Math.abs(Math.sin(phase)) * 0.05 * speed;

      // Tiny head counter-bob to keep the gaze steady.
      head.rotation.x = base.headRotX + Math.sin(phase * 2) * 0.02;
    } else {
      // --- IDLE ---
      const breathe = Math.sin(time * 1.6);
      const sway = Math.sin(time * 1.1);

      // Reset legs to neutral.
      lLeg.rotation.x = 0;
      rLeg.rotation.x = 0;
      lLegLower.rotation.x = base.lLegLowerRotX;
      rLegLower.rotation.x = base.rLegLowerRotX;

      // Breathing bob of the torso.
      torso.position.y = base.torsoY + breathe * 0.012;

      // Subtle arm sway around the held-weapon pose.
      lArm.rotation.x = base.lArmRotX + sway * 0.04;
      rArm.rotation.x = base.rArmRotX - sway * 0.04;
      lArm.rotation.z = base.lArmRotZ + breathe * 0.015;
      rArm.rotation.z = base.rArmRotZ - breathe * 0.015;

      // Gentle head idle.
      head.rotation.x = base.headRotX + breathe * 0.015;
    }
  };

  return group;
}
