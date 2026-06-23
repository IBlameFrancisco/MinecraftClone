// Mobs: blocky passive animals (pig / cow / sheep) and hostile zombies. Each is
// a THREE.Group of boxes with animated limbs, simple wander/chase AI, gravity +
// AABB voxel collision, and day/night spawning around the player.

import * as THREE from 'three';
import { moveEntity, rayAABB } from './physics.js';
import { WOOL, isSolid } from './blocks.js';
import { PORKCHOP, BEEF, MUTTON, ROTTEN_FLESH, LEATHER, ARROW } from './items.js';

const TWO_PI = Math.PI * 2;
const GRAVITY = 26;
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1)); // inclusive int

const KINDS = {
  pig:     { hostile: false, half: 0.45, height: 0.85, hp: 10, speed: 1.3 },
  cow:     { hostile: false, half: 0.5,  height: 0.95, hp: 12, speed: 1.2 },
  sheep:   { hostile: false, half: 0.45, height: 0.9,  hp: 10, speed: 1.3 },
  zombie:  { hostile: true,  half: 0.3,  height: 1.9,  hp: 20, speed: 3.1, burns: true },
  skeleton:{ hostile: true,  half: 0.3,  height: 1.9,  hp: 18, speed: 2.8, burns: true, ranged: true },
  creeper: { hostile: true,  half: 0.32, height: 1.5,  hp: 18, speed: 2.9, burns: false, bomb: true },
};

// What each mob drops on death: list of [id, minCount, maxCount].
const DROPS = {
  pig: [[PORKCHOP, 1, 2]],
  cow: [[BEEF, 1, 2], [LEATHER, 0, 1]],
  sheep: [[WOOL, 1, 1], [MUTTON, 1, 1]],
  zombie: [[ROTTEN_FLESH, 0, 2]],
  skeleton: [[ARROW, 0, 2]],
  creeper: [],
};

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }
function box(w, h, d, color) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); }

// A limb hanging from a hip/shoulder pivot so it can swing while walking.
function limb(parent, w, h, d, px, py, pz, color) {
  const pivot = new THREE.Object3D();
  pivot.position.set(px, py, pz);
  const m = box(w, h, d, color);
  m.position.y = -h / 2;
  pivot.add(m);
  parent.add(pivot);
  return pivot;
}

function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

function buildModel(kind) {
  const g = new THREE.Group();
  const limbs = [];
  if (kind === 'zombie' || kind === 'skeleton') {
    const sk = kind === 'skeleton';
    const skin = sk ? 0xd8d4cc : 0x4f7a3a, shirt = sk ? 0xc9c5bd : 0x35656b, pants = sk ? 0xb7b3ab : 0x2c2c5a;
    g.add(at(box(0.6, 0.7, 0.35, shirt), 0, 1.15, 0));
    const head = at(box(0.5, 0.5, 0.5, skin), 0, 1.75, 0);
    g.add(head);
    g.userData.head = head;
    // Sunken glowing eyes give the undead a face that the head-look can carry around.
    const eyeC = sk ? 0x202020 : 0x141a10;
    const le = at(box(0.12, 0.08, 0.06, eyeC), -0.12, 0.02, 0.26);
    const re = at(box(0.12, 0.08, 0.06, eyeC), 0.12, 0.02, 0.26);
    head.add(le); head.add(re);
    g.userData.eyes = [le, re];
    if (sk) head.add(at(box(0.18, 0.04, 0.05, 0x6f6a62), 0, -0.14, 0.27)); // bony jaw line
    else head.add(at(box(0.34, 0.05, 0.04, 0x2c3a22), 0, -0.16, 0.26));    // zombie grimace
    limbs.push(limb(g, 0.2, 0.75, 0.22, -0.3, 1.5, 0, skin));  // arms (forward)
    limbs.push(limb(g, 0.2, 0.75, 0.22, 0.3, 1.5, 0, skin));
    limbs[0].rotation.x = limbs[1].rotation.x = -1.4;
    limbs.push(limb(g, 0.24, 0.8, 0.26, -0.16, 0.8, 0, pants)); // legs
    limbs.push(limb(g, 0.24, 0.8, 0.26, 0.16, 0.8, 0, pants));
    g.userData.legs = [limbs[2], limbs[3]];
    g.userData.arms = [limbs[0], limbs[1]];
  } else if (kind === 'creeper') {
    const green = 0x4f9a3f, dark = 0x3c7a31;
    g.add(at(box(0.55, 0.85, 0.45, green), 0, 1.05, 0));     // body
    const head = at(box(0.5, 0.5, 0.5, green), 0, 1.7, 0);
    g.add(head);
    g.userData.head = head;
    head.add(at(box(0.16, 0.16, 0.06, 0x101510), -0.12, 0.04, 0.27)); // eyes (parented so they track head look)
    head.add(at(box(0.16, 0.16, 0.06, 0x101510), 0.12, 0.04, 0.27));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      limbs.push(limb(g, 0.2, 0.4, 0.2, sx * 0.16, 0.4, sz * 0.18, dark));
    }
    g.userData.legs = limbs;
    g.userData.arms = [];
  } else {
    const c = kind === 'pig' ? 0xe78f9b : kind === 'cow' ? 0x564434 : 0xeeede8;
    const headC = kind === 'pig' ? 0xe07e8b : kind === 'cow' ? 0x4a3a2c : 0xd8d4cc;
    const legC = kind === 'sheep' ? 0x8a8580 : c;
    const bodyH = kind === 'cow' ? 0.55 : 0.5;
    const bodyY = KINDS[kind].height - bodyH / 2 - 0.32;
    g.add(at(box(0.7, bodyH, 1.05, c), 0, bodyY, 0));
    const head = at(box(0.55, 0.55, 0.5, headC), 0, bodyY + 0.12, 0.72);
    g.add(head);
    g.userData.head = head;
    // Little dark eyes so the head reads as a face when it turns to look at you.
    head.add(at(box(0.07, 0.09, 0.05, 0x1a1410), -0.16, 0.06, 0.24));
    head.add(at(box(0.07, 0.09, 0.05, 0x1a1410), 0.16, 0.06, 0.24));
    if (kind === 'pig') head.add(at(box(0.28, 0.2, 0.1, 0x9c5560), 0, -0.08, 0.26)); // snout follows the head
    // Ears flick on idle as a sign of life; kept as pivots so they can twitch.
    const ears = [];
    if (kind === 'pig') {
      ears.push(limb(head, 0.14, 0.12, 0.05, -0.18, 0.24, 0.04, headC));
      ears.push(limb(head, 0.14, 0.12, 0.05, 0.18, 0.24, 0.04, headC));
    } else if (kind === 'cow') {
      ears.push(limb(head, 0.16, 0.1, 0.06, -0.3, 0.12, 0.02, headC));
      ears.push(limb(head, 0.16, 0.1, 0.06, 0.3, 0.12, 0.02, headC));
      head.add(at(box(0.06, 0.16, 0.06, 0xe8e4dc), -0.12, 0.36, 0)); // stubby horns
      head.add(at(box(0.06, 0.16, 0.06, 0xe8e4dc), 0.12, 0.36, 0));
    } else { // sheep: woolly cap + floppy ears
      head.add(at(box(0.5, 0.28, 0.42, 0xeeede8), 0, 0.18, -0.06));
      ears.push(limb(head, 0.1, 0.16, 0.05, -0.26, 0.04, 0, 0xd8d4cc));
      ears.push(limb(head, 0.1, 0.16, 0.05, 0.26, 0.04, 0, 0xd8d4cc));
    }
    g.userData.ears = ears;
    const lx = 0.24, lz = 0.38, legLen = 0.34;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      limbs.push(limb(g, 0.2, legLen, 0.2, sx * lx, legLen, sz * lz, legC));
    }
    g.userData.legs = limbs;
    g.userData.arms = [];
  }
  return { group: g, limbs };
}

class Mob {
  constructor(kind, x, y, z) {
    this.kind = kind;
    const def = KINDS[kind];
    this.def = def;
    this.hostile = def.hostile;
    this.half = def.half;
    this.height = def.height;
    this.health = def.hp;
    this.speed = def.speed;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * TWO_PI;
    this.renderYaw = this.yaw;        // smoothed body yaw (visual only)
    this.headYaw = 0;                 // smoothed head turn relative to body
    this.headPitch = 0;               // smoothed head look up/down
    this.idlePhase = Math.random() * TWO_PI; // desync idle sway between mobs
    this.onGround = false;
    this.walk = 0;
    this.wanderTimer = 0;
    this.wx = 0; this.wz = 0;        // wander direction
    this.wanderYaw = this.yaw;       // wander aims drift smoothly toward this heading
    this.fleeTimer = 0;
    this.attackCD = 0;
    this.shootCD = 1 + Math.random();
    this.fuse = 0;
    this.hiss = 0;                   // creeper: 0..1 charge while armed and near
    this.startleCD = 0;             // passive: cooldown before it can startle again
    this.hurtFlash = 0;
    this.hurtKick = 0;              // brief recoil/squash impulse on being struck (visual)
    this.blink = 2 + Math.random() * 4; // countdown to next idle blink/ear-flick
    this.blinkT = 0;               // 0..1 progress through the current blink
    this.gait = 0;                 // eased walk-cycle strength (no snap when stopping)
    this.dead = false;
    // Per-individual temperament so a herd/horde doesn't move in lockstep.
    this.bias = 0.85 + Math.random() * 0.3;        // personal speed multiplier
    this.boldness = Math.random();                 // 0 timid .. 1 bold (flee distance, kite range)
    this.restless = 0.4 + Math.random() * 0.8;     // how often it changes its mind while wandering
    const built = buildModel(kind);
    this.mesh = built.group;
    this.legs = built.group.userData.legs;
    this.arms = built.group.userData.arms;
    this.head = built.group.userData.head || null;
    this.eyes = built.group.userData.eyes || null;   // undead: blink by squashing the eye boxes
    this.ears = built.group.userData.ears || null;   // passives: idle ear flicks
    this.earBaseRot = this.ears ? this.ears.map((e) => e.rotation.z) : null;
    this.legBaseY = this.legs.map((l) => l.position.y); // pivot heights to add the walk lift onto
    this.headBaseY = this.head ? this.head.position.y : 0;
    this.mesh.position.copy(this.pos);
  }

  getDrops() {
    const out = [];
    for (const [id, lo, hi] of (DROPS[this.kind] || [])) {
      const n = ri(lo, hi);
      if (n > 0) out.push({ id, count: n });
    }
    return out;
  }

  hurt(dmg, fromX, fromZ) {
    this.health -= dmg;
    this.hurtFlash = 0.22;
    this.hurtKick = 1;            // drives a quick flinch/squash that decays in update()
    this.blink = 0.05;           // a struck mob blinks/winces almost immediately
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 6; this.vel.z += (dz / d) * 6; this.vel.y = 5;
    if (!this.hostile) {
      // Timid animals bolt for longer; bold ones recover their nerve quicker.
      this.fleeTimer = 3 + (1 - this.boldness) * 2.5;
    } else {
      this.aggro = true;
      // A struck creeper is already committed — prime its fuse a little.
      if (this.def.bomb) this.hiss = Math.max(this.hiss, 0.35);
    }
    if (this.health <= 0) this.dead = true;
  }

  update(dt, world, ctx) {
    // --- AI: pick desired horizontal direction ---
    let desiredX = 0, desiredZ = 0, speed = this.speed;
    const toPx = ctx.player.pos.x - this.pos.x;
    const toPz = ctx.player.pos.z - this.pos.z;
    const distP = Math.hypot(toPx, toPz);

    this.startleCD -= dt;

    // Passive animals spook if the player closes in fast, even without a hit.
    if (!this.hostile && this.fleeTimer <= 0 && this.startleCD <= 0) {
      const startleAt = 2.6 + this.boldness * 2.0;  // bolder animals let you get closer
      if (distP < startleAt) { this.fleeTimer = 1.4 + Math.random() * 1.1; this.startleCD = 4; }
    }

    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      // Bolt away, but veer rather than running in a dead-straight line.
      const veer = Math.sin(this.idlePhase * 1.7 + this.bias * 5) * 0.5;
      desiredX = -toPx + -toPz * veer;
      desiredZ = -toPz + toPx * veer;
      speed = this.speed * (2.0 + this.boldness * 0.4);
    } else if (this.hostile && distP < 24 && (ctx.isNight || this.aggro || this.def.bomb)) {
      if (distP < 12) this.aggro = true;
      this.yaw = Math.atan2(toPx, toPz); // face the player
      if (this.def.ranged) {
        // Skeleton kiting: hold a stand-off band, backing off when crowded and
        // closing only when the player drifts out of range. Bolder ones press closer.
        const near = 4.5 - this.boldness, far = 9 + this.boldness * 3;
        if (distP < near) { desiredX = -toPx; desiredZ = -toPz; speed = this.speed * 1.15; }
        else if (distP > far) { desiredX = toPx; desiredZ = toPz; speed = this.speed; }
        else {
          // In the sweet spot: strafe sideways for a lively, hard-to-hit shuffle.
          const side = (this.bias > 1 ? 1 : -1);
          desiredX = -toPz * side; desiredZ = toPx * side; speed = this.speed * 0.6;
        }
        this.shootCD -= dt;
        if (this.shootCD <= 0 && distP < 16 && this._canSee(world, ctx.player)) {
          this._shoot(ctx);
          // Quick double-tap occasionally, otherwise a measured reload.
          this.shootCD = (Math.random() < 0.25 ? 0.5 : 1.6 + Math.random() * 0.8);
        }
      } else if (this.def.bomb) {
        // Creeper: rush in, then freeze and swell once point-blank. If the player
        // breaks contact mid-charge it eases off (visible relief) before re-arming.
        if (distP < 1.9) {
          desiredX = 0; desiredZ = 0; speed = 0;     // plant feet and detonate
          this.hiss = Math.min(1, this.hiss + dt / 1.4);
          this.fuse += dt;
          if (this.fuse >= 1.4) { ctx.explode(this.pos.x, this.pos.y + 0.6, this.pos.z); this.dead = true; }
        } else if (distP < 3.2 && this.hiss > 0.05) {
          // Within the danger ring while already charging — creep forward warily.
          desiredX = toPx; desiredZ = toPz; speed = this.speed * 0.45;
          this.hiss = Math.max(0, this.hiss - dt * 0.6);
          this.fuse = Math.max(0, this.fuse - dt * 1.5);
        } else {
          desiredX = toPx; desiredZ = toPz; speed = this.speed * 0.95;
          this.hiss = Math.max(0, this.hiss - dt * 1.5);
          this.fuse = Math.max(0, this.fuse - dt * 2);
        }
      } else {
        // Zombie pursuit: lunge in for a swing, recover a beat, then press again
        // so it reads as deliberate rather than a constant shove.
        if (distP < 1.5 && this.attackCD <= 0) {
          ctx.damagePlayer(3 * (ctx.dmgMul || 1), this.pos.x, this.pos.z);
          this.attackCD = 0.9 + Math.random() * 0.3;
        }
        desiredX = toPx; desiredZ = toPz;
        // Brief hesitation right after a swing reads as a wind-up between hits.
        speed = (this.attackCD > 0.55 && distP < 2.2) ? this.speed * 0.35 : this.speed;
      }
    } else {
      // Wandering: ease toward fresh headings and take real pauses, with the
      // cadence varying per individual so a herd doesn't move as one.
      this.hiss = Math.max(0, this.hiss - dt);
      this.fuse = Math.max(0, this.fuse - dt);
      // Hostiles that lost the player far away (out of the 24-block band) slowly
      // lose interest, so a daytime-aggroed mob doesn't chase forever.
      if (this.aggro && distP > 30) this.aggro = false;
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        if (Math.random() < 0.4) {                     // settle and graze/idle a while
          this.wx = 0; this.wz = 0;
          this.wanderTimer = (1.5 + Math.random() * 3.5) / this.restless;
        } else {
          // Nudge the heading rather than teleporting it, for gentle turns.
          this.wanderYaw += (Math.random() - 0.5) * 2.2;
          this.wx = Math.sin(this.wanderYaw); this.wz = Math.cos(this.wanderYaw);
          this.wanderTimer = (1.5 + Math.random() * 2.5) / this.restless;
        }
      }
      desiredX = this.wx; desiredZ = this.wz; speed = this.speed * 0.5;
    }
    this.attackCD -= dt;

    const dl = Math.hypot(desiredX, desiredZ);
    const moving = dl > 0.01 && speed > 0.01;
    if (moving) {
      desiredX /= dl; desiredZ /= dl;
      speed *= this.bias;                     // personal pace
      this.yaw = Math.atan2(desiredX, desiredZ);
      // Heavier mobs and calmer states accelerate a little more gently; fleeing
      // and charging snap to speed faster so reactions feel urgent.
      const accel = this.fleeTimer > 0 || this.aggro ? 11 : 7;
      this.vel.x += (desiredX * speed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (desiredZ * speed - this.vel.z) * Math.min(1, accel * dt);
      // Hop over a one-block step.
      if (this.onGround) {
        const fx = this.pos.x + desiredX * (this.half + 0.3);
        const fz = this.pos.z + desiredZ * (this.half + 0.3);
        const footY = Math.floor(this.pos.y + 0.1);
        const blocked = world.getBlock(Math.floor(fx), footY, Math.floor(fz)) !== 0;
        const headClear = world.getBlock(Math.floor(fx), footY + 1, Math.floor(fz)) === 0;
        if (blocked && headClear) this.vel.y = 7.2;
      }
    } else {
      // Ease to a stop instead of cutting motion abruptly.
      const damp = Math.max(0, 1 - 9 * dt);
      this.vel.x *= damp; this.vel.z *= damp;
    }

    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -30) this.vel.y = -30;
    this.onGround = moveEntity(world, this.pos, this.vel, this.half, this.height, dt);

    // Daylight burning for sky-exposed undead keeps the night population in check.
    this.burning = false;
    if (this.def.burns && !ctx.isNight && this.pos.y >= world.getHeight(Math.floor(this.pos.x), Math.floor(this.pos.z))) {
      this.burning = true;
      this.health -= dt * 3; if (this.health <= 0) this.dead = true;
      if (ctx.fire && Math.random() < dt * 30) {     // visible flames + smoke rising off them
        ctx.fire(this.pos.x + (Math.random() - 0.5) * this.half, this.pos.y + this.height * (0.2 + Math.random() * 0.8), this.pos.z + (Math.random() - 0.5) * this.half);
      }
    }

    // --- Animation ---
    const biped = this.kind === 'zombie' || this.kind === 'skeleton';
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // Cadence scales with pace; faster movers take quicker strides.
    if (sp > 0.1) this.walk += dt * (5 + sp * 1.4);
    // Target gait strength, then ease the actual value toward it so legs spin up
    // and settle smoothly instead of snapping between a walk pose and a hard stop.
    const gaitTarget = Math.min(0.95, 0.3 + sp * 0.15) * Math.min(1, sp / 0.6);
    this.gait += (gaitTarget - this.gait) * Math.min(1, 12 * dt);
    const swing = Math.sin(this.walk) * this.gait;
    // A slight knee-style lift (forward leg rises a touch) reads less like a metronome.
    const lift = Math.abs(Math.cos(this.walk)) * this.gait * 0.12;
    if (biped && this.legs.length >= 2) {
      this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing;
      this.legs[0].position.y = this.legBaseY[0] + (swing > 0 ? lift : 0);
      this.legs[1].position.y = this.legBaseY[1] + (swing < 0 ? lift : 0);
      // Zombies hold arms forward (set at build time); add a gentle counter-swing
      // and a slow menacing reach so they don't look frozen.
      if (this.arms.length >= 2) {
        const reach = -1.4 + Math.sin(this.walk * 0.5) * 0.12;
        this.arms[0].rotation.x = reach - swing * 0.5;
        this.arms[1].rotation.x = reach + swing * 0.5;
        // Faint sideways drift on the arms so the reach doesn't look perfectly rigid.
        this.arms[0].rotation.z = Math.sin(this.idlePhase * 0.7) * 0.05;
        this.arms[1].rotation.z = -Math.sin(this.idlePhase * 0.7) * 0.05;
      }
    } else if (this.legs.length === 4) {
      // Diagonal gait (front-left + back-right together), with a subtle vertical
      // lift so hooves look like they leave the ground rather than just rotate.
      this.legs[0].rotation.x = swing; this.legs[3].rotation.x = swing;
      this.legs[1].rotation.x = -swing; this.legs[2].rotation.x = -swing;
      const liftA = swing > 0 ? lift : 0, liftB = swing < 0 ? lift : 0;
      this.legs[0].position.y = this.legBaseY[0] + liftA;
      this.legs[3].position.y = this.legBaseY[3] + liftA;
      this.legs[1].position.y = this.legBaseY[1] + liftB;
      this.legs[2].position.y = this.legBaseY[2] + liftB;
    }

    // Idle breathing/sway: a subtle bob plus body lean, fading out while moving.
    this.idlePhase += dt * 2.2;
    const idle = 1 - Math.min(1, sp / 0.5);
    const breath = Math.sin(this.idlePhase) * 0.012 * idle;
    const sway = Math.sin(this.idlePhase * 0.6) * 0.03 * idle;

    // Hurt-kick: a quick flinch that squashes the whole mob, then springs back.
    if (this.hurtKick > 0) this.hurtKick = Math.max(0, this.hurtKick - dt * 5);
    const kick = this.hurtKick * this.hurtKick;   // ease-out so the snap lands early

    // Occasional blink / ear flick so a still mob still looks alive.
    this.blink -= dt;
    if (this.blink <= 0) { this.blinkT = 1; this.blink = 2.5 + Math.random() * 4; }
    if (this.blinkT > 0) this.blinkT = Math.max(0, this.blinkT - dt * 6);
    if (this.eyes) {
      const open = 1 - this.blinkT;          // squash eye boxes shut at the peak of a blink
      this.eyes[0].scale.y = this.eyes[1].scale.y = 0.15 + open * 0.85;
    }
    if (this.ears && this.earBaseRot) {
      // Ears twitch on the blink beat plus a slow idle waggle.
      const flick = this.blinkT * 0.5 + Math.sin(this.idlePhase * 0.9) * 0.06 * idle;
      this.ears[0].rotation.z = this.earBaseRot[0] + flick;
      this.ears[1].rotation.z = this.earBaseRot[1] - flick;
    }

    // --- Smooth body turning (shortest-arc toward AI yaw; visual only) ---
    // Calm wandering turns gently; an alarmed mob whips around to face its target.
    const alarmed = this.fleeTimer > 0 || this.aggro || (this.def.bomb && distP < 24);
    const turnRate = alarmed ? 16 : 9;
    let dyaw = this.yaw - this.renderYaw;
    dyaw = ((dyaw + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI; // wrap to [-PI,PI]
    this.renderYaw += dyaw * Math.min(1, turnRate * dt);

    // --- Head look toward the player when close (and a touch of idle scan). ---
    if (this.head) {
      const dx = ctx.player.pos.x - this.pos.x, dz = ctx.player.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      let tYaw = Math.sin(this.idlePhase * 0.5) * 0.18 * idle; // idle glance
      let tPitch = 0;
      if (dist < 10) {
        let rel = Math.atan2(dx, dz) - this.renderYaw;
        rel = ((rel + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
        const look = Math.max(0, 1 - dist / 10);
        tYaw = Math.max(-1.1, Math.min(1.1, rel)) * look;
        const dy = (ctx.player.pos.y + 1.4) - (this.pos.y + this.height * 0.85);
        tPitch = Math.max(-0.5, Math.min(0.5, Math.atan2(dy, Math.max(0.5, dist)))) * look;
      }
      // Snap the head around faster when alarmed (locks on), drift lazily otherwise.
      const headRate = alarmed ? 13 : 7;
      this.headYaw += (tYaw - this.headYaw) * Math.min(1, headRate * dt);
      this.headPitch += (tPitch - this.headPitch) * Math.min(1, headRate * dt);
      this.head.rotation.y = this.headYaw;
      // A tiny extra dip on the flinch sells the wince through the head too.
      this.head.rotation.x = -this.headPitch + breath * (biped ? 3 : 6) + kick * 0.25;
      this.head.position.y = this.headBaseY + breath * 1.5;
    }

    this.mesh.position.copy(this.pos);
    this.mesh.position.y += breath - kick * 0.12;          // flinch dips the body briefly
    this.mesh.rotation.y = this.renderYaw;
    this.mesh.rotation.z = sway;
    // Squash-and-stretch on the flinch: widen and shorten, then spring back to 1.
    const sq = 1 + kick * 0.18, st = 1 - kick * 0.22;
    this.mesh.scale.set(sq, st, sq);

    let er = 0, eg = 0, eb = 0;
    if (this.hurtFlash > 0) { this.hurtFlash -= dt; er = 0.5; }
    else if (this.def.bomb && (this.hiss > 0.05 || this.fuse > 0)) {
      // Pulse quickens as the creeper charges (hiss) and again on the live fuse.
      const charge = Math.max(this.hiss, this.fuse / 1.4);
      const rate = 6 + charge * 26 + this.fuse * 22;
      const f = (Math.sin(performance.now() * 0.001 * rate) * 0.5 + 0.5) * (0.4 + charge * 0.6);
      er = f * 0.95; eg = f * 0.95; eb = f * 0.2;
    }
    else if (this.fuse > 0) { const f = Math.sin(this.fuse * 22) * 0.5 + 0.5; er = f * 0.9; eg = f * 0.9; eb = f * 0.2; }
    else if (this.burning) { const f = Math.sin(performance.now() * 0.02) * 0.35 + 0.6; er = f; eg = f * 0.4; eb = 0; }   // smouldering glow
    this.mesh.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(er, eg, eb); });
  }

  // Coarse line-of-sight to the player so a skeleton doesn't shoot through walls.
  _canSee(world, player) {
    const ex = this.pos.x, ey = this.pos.y + this.height * 0.8, ez = this.pos.z;
    const p = player.pos;
    let dx = p.x - ex, dy = (p.y + 1.4) - ey, dz = p.z - ez;
    const dist = Math.hypot(dx, dy, dz); if (dist < 0.001) return true;
    dx /= dist; dy /= dist; dz /= dist;
    for (let t = 0.5; t < dist - 0.5; t += 0.5) {
      if (isSolid(world.getBlock(Math.floor(ex + dx * t), Math.floor(ey + dy * t), Math.floor(ez + dz * t)))) return false;
    }
    return true;
  }
  _shoot(ctx) {
    const ex = this.pos.x, ey = this.pos.y + this.height * 0.8, ez = this.pos.z;
    const p = ctx.player.pos;
    let dx = p.x - ex, dy = (p.y + 1.4) - ey, dz = p.z - ez;
    const d = Math.hypot(dx, dy, dz) || 1;
    const sp = 18;
    ctx.spawnArrow(ex, ey, ez, (dx / d) * sp, (dy / d + 0.12) * sp, (dz / d) * sp);
  }

  // Ray vs this mob's AABB.
  rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz,
      this.pos.x - this.half, this.pos.y, this.pos.z - this.half,
      this.pos.x + this.half, this.pos.y + this.height, this.pos.z + this.half);
    return t <= maxDist ? t : Infinity;
  }
}

// Skeleton arrow projectile.
class Arrow {
  constructor(x, y, z, vx, vy, vz) {
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3(vx, vy, vz);
    this.life = 4;
    this.dead = false;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.6), new THREE.MeshLambertMaterial({ color: 0x8a7a5a }));
  }
  update(dt, world, player, damagePlayer) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.vel.y -= 16 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(this.pos.x + this.vel.x, this.pos.y + this.vel.y, this.pos.z + this.vel.z);
    if (isSolid(world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)))) { this.dead = true; return; }
    const p = player.pos;
    if (this.pos.x > p.x - 0.35 && this.pos.x < p.x + 0.35 && this.pos.y > p.y && this.pos.y < p.y + 1.8 &&
        this.pos.z > p.z - 0.35 && this.pos.z < p.z + 0.35) {
      damagePlayer(2, this.pos.x, this.pos.z); this.dead = true;
    }
  }
}

export class Mobs {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.arrows = [];
    this.spawnTimer = 1;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  spawnArrow(x, y, z, vx, vy, vz) {
    const a = new Arrow(x, y, z, vx, vy, vz);
    this.arrows.push(a);
    this.group.add(a.mesh);
  }

  clearAll() {
    for (const m of this.list) { this.group.remove(m.mesh); m.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    this.list.length = 0;
    for (const a of this.arrows) { this.group.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose(); }
    this.arrows.length = 0;
  }

  countKind(hostile) { return this.list.filter((m) => m.hostile === hostile).length; }

  spawn(kind, x, y, z) {
    const m = new Mob(kind, x, y, z);
    this.list.push(m);
    this.group.add(m.mesh);
    return m;
  }

  trySpawnAround(player, isNight, peaceful) {
    const animals = this.countKind(false);
    const hostiles = this.countKind(true);
    const wantAnimal = animals < 14;
    const wantZombie = isNight && !peaceful && hostiles < 12;
    if (!wantAnimal && !wantZombie) return;

    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = Math.random() * TWO_PI;
      const dist = 24 + Math.random() * 22;
      const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
      const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
      if (!this.world.isReady(x, z)) continue;
      const surf = this.world.surfaceHeight(x, z);
      const ground = this.world.getBlock(x, surf, z);
      if (ground === 0 || ground === 7) continue; // need solid, non-water ground
      if (this.world.getBlock(x, surf + 1, z) !== 0 || this.world.getBlock(x, surf + 2, z) !== 0) continue;

      if (wantZombie && (!wantAnimal || Math.random() < 0.5)) {
        const hostiles = ['zombie', 'zombie', 'skeleton', 'creeper'];
        this.spawn(hostiles[(Math.random() * hostiles.length) | 0], x + 0.5, surf + 1, z + 0.5);
        return;
      }
      if (wantAnimal) {
        const kinds = ['pig', 'cow', 'sheep'];
        this.spawn(kinds[(Math.random() * 3) | 0], x + 0.5, surf + 1, z + 0.5);
        return;
      }
    }
  }

  update(dt, player, isNight, ctx) {
    const peaceful = ctx.peaceful;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1.5; this.trySpawnAround(player, isNight, peaceful); }

    const mobCtx = {
      player, isNight, damagePlayer: ctx.damagePlayer, dmgMul: ctx.dmgMul || 1,
      explode: ctx.explode || (() => {}),
      fire: ctx.fire,
      spawnArrow: (x, y, z, vx, vy, vz) => this.spawnArrow(x, y, z, vx, vy, vz),
    };

    // Arrows.
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.update(dt, this.world, player, ctx.damagePlayer);
      if (a.dead) { this.group.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose(); this.arrows.splice(i, 1); }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.update(dt, this.world, mobCtx);
      // Peaceful: hostile mobs vanish.
      const banished = peaceful && m.hostile;
      const far = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) > 72;
      if (m.dead || banished || far || m.pos.y < -30) {
        if (m.dead && ctx.onKill) ctx.onKill(m);
        this.group.remove(m.mesh);
        m.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        this.list.splice(i, 1);
      }
    }
  }

  // Nearest mob hit by a ray; returns { mob, dist } or null.
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const m of this.list) {
      const t = m.rayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestT);
      if (t < bestT) { bestT = t; best = m; }
    }
    return best ? { mob: best, dist: bestT } : null;
  }
}
