// Mobs: blocky passive animals (pig / cow / sheep) and hostile zombies. Each is
// a THREE.Group of boxes with animated limbs, simple wander/chase AI, gravity +
// AABB voxel collision, and day/night spawning around the player.

import * as THREE from 'three';
import { moveEntity, rayAABB } from './physics.js';
import { WOOL } from './blocks.js';

const TWO_PI = Math.PI * 2;
const GRAVITY = 26;

const KINDS = {
  pig:   { hostile: false, half: 0.45, height: 0.85, hp: 10, speed: 1.3, drop: null },
  cow:   { hostile: false, half: 0.5,  height: 0.95, hp: 12, speed: 1.2, drop: null },
  sheep: { hostile: false, half: 0.45, height: 0.9,  hp: 10, speed: 1.3, drop: WOOL },
  zombie:{ hostile: true,  half: 0.3,  height: 1.9,  hp: 20, speed: 3.1, drop: null },
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
  if (kind === 'zombie') {
    const skin = 0x4f7a3a, shirt = 0x35656b, pants = 0x2c2c5a;
    g.add(at(box(0.6, 0.7, 0.35, shirt), 0, 1.15, 0));
    g.add(at(box(0.5, 0.5, 0.5, skin), 0, 1.75, 0));
    limbs.push(limb(g, 0.22, 0.75, 0.25, -0.3, 1.5, 0, skin));  // arms (forward)
    limbs.push(limb(g, 0.22, 0.75, 0.25, 0.3, 1.5, 0, skin));
    limbs[0].rotation.x = limbs[1].rotation.x = -1.4;
    limbs.push(limb(g, 0.26, 0.8, 0.28, -0.16, 0.8, 0, pants)); // legs
    limbs.push(limb(g, 0.26, 0.8, 0.28, 0.16, 0.8, 0, pants));
    g.userData.legs = [limbs[2], limbs[3]];
    g.userData.arms = [limbs[0], limbs[1]];
  } else {
    const c = kind === 'pig' ? 0xe78f9b : kind === 'cow' ? 0x564434 : 0xeeede8;
    const headC = kind === 'pig' ? 0xe07e8b : kind === 'cow' ? 0x4a3a2c : 0xd8d4cc;
    const legC = kind === 'sheep' ? 0x8a8580 : c;
    const bodyH = kind === 'cow' ? 0.55 : 0.5;
    const bodyY = KINDS[kind].height - bodyH / 2 - 0.32;
    g.add(at(box(0.7, bodyH, 1.05, c), 0, bodyY, 0));
    g.add(at(box(0.55, 0.55, 0.5, headC), 0, bodyY + 0.12, 0.72));
    if (kind === 'pig') g.add(at(box(0.28, 0.2, 0.1, 0x9c5560), 0, bodyY + 0.04, 0.98));
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
    this.onGround = false;
    this.walk = 0;
    this.wanderTimer = 0;
    this.wx = 0; this.wz = 0;        // wander direction
    this.fleeTimer = 0;
    this.attackCD = 0;
    this.hurtFlash = 0;
    this.dead = false;
    const built = buildModel(kind);
    this.mesh = built.group;
    this.legs = built.group.userData.legs;
    this.arms = built.group.userData.arms;
    this.mesh.position.copy(this.pos);
  }

  hurt(dmg, fromX, fromZ) {
    this.health -= dmg;
    this.hurtFlash = 0.2;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 6; this.vel.z += (dz / d) * 6; this.vel.y = 5;
    if (!this.hostile) this.fleeTimer = 4;
    else { this.aggro = true; }
    if (this.health <= 0) this.dead = true;
  }

  update(dt, world, ctx) {
    // --- AI: pick desired horizontal direction ---
    let desiredX = 0, desiredZ = 0, speed = this.speed;
    const toPx = ctx.player.pos.x - this.pos.x;
    const toPz = ctx.player.pos.z - this.pos.z;
    const distP = Math.hypot(toPx, toPz);

    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      desiredX = -toPx; desiredZ = -toPz; speed = this.speed * 2.2;
    } else if (this.hostile && (ctx.isNight || this.aggro) && distP < 22) {
      desiredX = toPx; desiredZ = toPz; speed = this.speed;
      if (distP < 1.5 && this.attackCD <= 0) { ctx.damagePlayer(3, this.pos.x, this.pos.z); this.attackCD = 1.0; }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 3;
        if (Math.random() < 0.3) { this.wx = 0; this.wz = 0; }
        else { const a = Math.random() * TWO_PI; this.wx = Math.cos(a); this.wz = Math.sin(a); }
      }
      desiredX = this.wx; desiredZ = this.wz; speed = this.speed * 0.5;
    }
    this.attackCD -= dt;

    const dl = Math.hypot(desiredX, desiredZ);
    const moving = dl > 0.01;
    if (moving) {
      desiredX /= dl; desiredZ /= dl;
      this.yaw = Math.atan2(desiredX, desiredZ);
      this.vel.x += (desiredX * speed - this.vel.x) * Math.min(1, 8 * dt);
      this.vel.z += (desiredZ * speed - this.vel.z) * Math.min(1, 8 * dt);
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
      this.vel.x *= 0.8; this.vel.z *= 0.8;
    }

    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -30) this.vel.y = -30;
    this.onGround = moveEntity(world, this.pos, this.vel, this.half, this.height, dt);

    // Daylight burning for sky-exposed zombies keeps the night population in check.
    if (this.hostile && !ctx.isNight) {
      const exposed = this.pos.y >= world.getHeight(Math.floor(this.pos.x), Math.floor(this.pos.z));
      if (exposed) { this.health -= dt * 3; if (this.health <= 0) this.dead = true; }
    }

    // --- Animation ---
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.1) this.walk += dt * (6 + sp);
    const swing = Math.sin(this.walk) * Math.min(0.9, 0.3 + sp * 0.15);
    if (this.kind === 'zombie') {
      if (this.legs[0]) { this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing; }
    } else {
      // diagonal gait for quadrupeds
      if (this.legs.length === 4) {
        this.legs[0].rotation.x = swing; this.legs[3].rotation.x = swing;
        this.legs[1].rotation.x = -swing; this.legs[2].rotation.x = -swing;
      }
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      this.mesh.traverse((o) => { if (o.isMesh) o.material.emissive && o.material.emissive.setRGB(0.5, 0, 0); });
    } else {
      this.mesh.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(0, 0, 0); });
    }
  }

  // Ray vs this mob's AABB.
  rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz,
      this.pos.x - this.half, this.pos.y, this.pos.z - this.half,
      this.pos.x + this.half, this.pos.y + this.height, this.pos.z + this.half);
    return t <= maxDist ? t : Infinity;
  }
}

export class Mobs {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.spawnTimer = 1;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  countKind(hostile) { return this.list.filter((m) => m.hostile === hostile).length; }

  spawn(kind, x, y, z) {
    const m = new Mob(kind, x, y, z);
    this.list.push(m);
    this.group.add(m.mesh);
    return m;
  }

  trySpawnAround(player, isNight) {
    const animals = this.countKind(false);
    const hostiles = this.countKind(true);
    const wantAnimal = animals < 14;
    const wantZombie = isNight && hostiles < 12;
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
        this.spawn('zombie', x + 0.5, surf + 1, z + 0.5);
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
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1.5; this.trySpawnAround(player, isNight); }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.update(dt, this.world, { player, isNight, damagePlayer: ctx.damagePlayer });
      const far = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) > 72;
      if (m.dead || far || m.pos.y < -30) {
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
