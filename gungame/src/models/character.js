// A real rigged, animated humanoid for GunGame's enemies. We clone the loaded Soldier
// glTF (skeleton + skinned meshes) per bot, drive it with an AnimationMixer (Idle / Walk
// / Run blended by movement speed), and keep the SAME interface the old box-man exposed:
//   - group ORIGIN AT THE FEET (group.position.y = 0 plants it on the ground)
//   - group faces -Z (so setting group.rotation.y = yaw aims it correctly)
//   - group.userData.anim(st, dt, t) advances the animation, st = { moving, speed, t }
//   - group.userData.rightHand = the right-hand bone (for parenting a weapon), if found
//
// Falls back to nothing if the model failed to load (callers null-check userData.anim).
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MODELS } from '../engine/assets.js';

const TARGET_H = 1.8;     // stand the soldier at ~1.8 units tall, feet at y = 0

export function makeCharacter(opts = {}) {
  const team = opts.team === 'red' ? 'red' : 'blue';
  const group = new THREE.Group();

  const src = MODELS.soldier;
  if (!src) return group;   // assets not ready — empty group, callers guard userData.anim

  // --- clone the rig (deep clone incl. skeleton so each bot animates independently) ---
  const model = cloneSkeleton(src.scene);

  // normalise scale so the model is TARGET_H tall, then drop it so the feet sit at y = 0.
  // Update world matrices BEFORE measuring (the fresh clone's matrices are stale) and
  // MULTIPLY the scale so any scale already baked into the glTF root is preserved.
  model.updateMatrixWorld(true);
  const preBox = new THREE.Box3().setFromObject(model);
  const preH = Math.max(0.0001, preBox.max.y - preBox.min.y);
  const s = THREE.MathUtils.clamp(TARGET_H / preH, 0.001, 1000);
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);

  // Uniform tint: read as a coloured uniform, not a glow. `opts.uniform` (a hex) lets the
  // caller vary each soldier so a squad doesn't look like identical clones; otherwise fall
  // back to a team colour. A faint emissive keeps the team legible in the heat of a fight.
  // Clone materials first so per-bot tinting doesn't bleed across clones.
  const diffuse = opts.uniform != null
    ? new THREE.Color(opts.uniform)
    : (team === 'red' ? new THREE.Color(1.0, 0.62, 0.6) : new THREE.Color(0.62, 0.72, 1.0));
  const glow = team === 'red' ? new THREE.Color(0x2a0808) : new THREE.Color(0x081026);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;            // skinned bounds can be wrong at extreme poses
      if (o.material) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.multiply(diffuse);
        o.material.emissive = glow;
        o.material.emissiveIntensity = 0.06;   // faint team rim, not neon
        o.material.envMapIntensity = 1.15;
      }
    }
  });

  group.add(model);

  // find the right-hand bone so the weapon can be gripped (Mixamo naming)
  let rightHand = null;
  model.traverse((o) => {
    if (!rightHand && o.isBone && /right.*hand|hand.*r$|mixamorig.*RightHand/i.test(o.name)) rightHand = o;
  });
  group.userData.rightHand = rightHand;
  group.userData.modelScale = model.scale.x;

  // --- animation ---
  const mixer = new THREE.AnimationMixer(model);
  const byName = {};
  for (const clip of src.animations) byName[clip.name.toLowerCase()] = clip;
  const idleClip = byName['idle'] || src.animations[0];
  const walkClip = byName['walk'] || idleClip;
  const runClip = byName['run'] || walkClip;

  const idle = mixer.clipAction(idleClip);
  const walk = mixer.clipAction(walkClip);
  const run = mixer.clipAction(runClip);
  for (const a of [idle, walk, run]) { a.enabled = true; a.setEffectiveWeight(0); a.play(); }
  idle.setEffectiveWeight(1);
  const w = { idle: 1, walk: 0, run: 0 };

  group.userData.mixer = mixer;

  // st = { moving, speed (0..1), t }. We lerp the three clip weights toward a target mix
  // (idle when still, walk at low speed, run at high speed) and advance the mixer by dt.
  group.userData.anim = (st = {}, dt = 0) => {
    const speed = Math.min(Math.max(st.speed || 0, 0), 1);
    const moving = !!st.moving && speed > 0.02;
    let tIdle, tWalk, tRun;
    if (!moving) { tIdle = 1; tWalk = 0; tRun = 0; }
    else if (speed < 0.65) { const k = speed / 0.65; tIdle = 0; tWalk = 1 - k * 0.4; tRun = k * 0.4; }
    else { const k = (speed - 0.65) / 0.35; tIdle = 0; tWalk = 1 - k; tRun = k; }
    const lerp = Math.min(1, dt * 10);
    w.idle += (tIdle - w.idle) * lerp;
    w.walk += (tWalk - w.walk) * lerp;
    w.run += (tRun - w.run) * lerp;
    idle.setEffectiveWeight(w.idle);
    walk.setEffectiveWeight(w.walk);
    run.setEffectiveWeight(w.run);
    mixer.update(dt);
  };

  // kept for interface compatibility (old code read group.userData.parts)
  group.userData.parts = { head: model, torso: model };

  return group;
}
