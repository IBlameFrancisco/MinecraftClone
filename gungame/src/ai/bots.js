// Enemy bots: stylized soldier models that roam the arena, take cover-ish wander paths,
// and shoot at the player on line-of-sight. Each carries an invisible hitbox (added to the
// weapon raycast set) and reports player damage via onHitPlayer.
import * as THREE from 'three';
import { makeCharacter } from '../models/character.js';
import { makeWorldWeapon } from '../models/guns.js';

const NAMES = ['Razor', 'Vex', 'Cobra', 'Ghost', 'Echo', 'Riot', 'Nova', 'Slate', 'Drift', 'Pike'];

class Bot {
  constructor(scene, fx, name) {
    this.scene = scene; this.fx = fx; this.name = name;
    this.group = makeCharacter({ team: 'red' });
    scene.add(this.group);
    this.parts = this.group.userData.parts;
    // weapon held at the ready: parented to the group (feet origin) at right-hand/chest
    // height, pointing forward (-Z). Group-level placement keeps it at a predictable size
    // and orientation regardless of the rig's internal scale.
    this.gun = makeWorldWeapon('rifle');
    this.gun.position.set(0.2, 1.18, -0.22);
    this.gun.rotation.set(0, 0, 0);
    this.group.add(this.gun);
    // invisible hitbox for the player's bullets
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.7, 0.55), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 0.9; this.hit.userData.bot = this; this.group.add(this.hit);
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.health = 100; this.alive = true; this.respawnT = 0; this.deathT = 0;
    this.target = new THREE.Vector3(); this.fireCD = 0; this.repathT = 0; this.t = Math.random() * 10;
    this.lastHitT = 0;
  }
  headY() { return this.pos.y + 1.45; }
  spawn(p) {
    this.pos.copy(p); this.health = 100; this.alive = true; this.deathT = 0; this.respawnT = 0;
    this.group.visible = true; this.group.position.copy(this.pos); this.group.rotation.set(0, 0, 0);
    this.hit.userData.bot = this;
    this._pick(p);
  }
  _pick(near) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 30;
    this.target.set((near.x) + Math.cos(a) * r, 0, (near.z) + Math.sin(a) * r);
    this.target.x = Math.max(-62, Math.min(62, this.target.x));
    this.target.z = Math.max(-62, Math.min(62, this.target.z));
    this.repathT = 2 + Math.random() * 3;
  }
  hurt(dmg, head, fx) {
    if (!this.alive) return;
    this.health -= dmg; this.lastHitT = 0;
    if (this.health <= 0) { this.die(); return true; }
    return false;
  }
  die() {
    this.alive = false; this.deathT = 0; this.respawnT = 2.5 + Math.random();
    this.fx.blood(new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z));
  }
}

export class Bots {
  constructor(scene, fx, world, count = 5) {
    this.scene = scene; this.fx = fx; this.world = world;
    this.list = []; this.ray = new THREE.Raycaster();
    this.onHitPlayer = null;   // (dmg) => {}
    this.onKilled = null;      // (bot) => {}
    this.targetMeshes = [];    // arena meshes (for LoS)
    for (let i = 0; i < count; i++) {
      const b = new Bot(scene, fx, NAMES[i % NAMES.length]);
      const sp = world.spawns[i % world.spawns.length];
      b.spawn(new THREE.Vector3(sp.x, 0, sp.z));
      this.list.push(b);
    }
  }
  hitMeshes() { return this.list.filter((b) => b.alive).map((b) => b.hit); }

  _blocked(x, z) {
    for (const c of this.world.colliders) {
      if (c.max.y < 0.4) continue;   // can step over very low cover
      if (x > c.min.x - 0.4 && x < c.max.x + 0.4 && z > c.min.z - 0.4 && z < c.max.z + 0.4) return true;
    }
    return false;
  }
  _los(from, to) {
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    this.ray.set(from, dir); this.ray.far = dist - 0.6;
    return this.ray.intersectObjects(this.targetMeshes, true).length === 0;
  }

  update(dt, player) {
    const peye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
    for (const b of this.list) {
      if (!b.alive) {
        b.deathT += dt; b.respawnT -= dt;
        // sink + spin into the ground as a quick "death"
        b.group.position.y = -Math.min(2, b.deathT * 1.5);
        b.group.rotation.z = Math.min(1.3, b.deathT * 2);
        if (b.respawnT <= 0) { const sp = this.world.spawns[(Math.random() * this.world.spawns.length) | 0]; b.spawn(new THREE.Vector3(sp.x, 0, sp.z)); }
        continue;
      }
      b.t += dt; b.fireCD -= dt; b.repathT -= dt; b.lastHitT += dt;
      const beye = new THREE.Vector3(b.pos.x, b.pos.y + 1.5, b.pos.z);
      const toP = peye.clone().sub(beye); const distP = toP.length();
      const canSee = player.alive && distP < 70 && this._los(beye, peye);

      // --- aim / move ---
      let moving = false, speed = 0;
      if (canSee) {
        // face + hold ground, occasionally strafe
        b.yaw = Math.atan2(-toP.x, -toP.z);
        if (distP > 22 || b.lastHitT < 0.6) {   // close the gap or reposition when shot
          const step = (distP > 22 ? 1 : -0.4);
          this._step(b, b.pos.x - Math.sin(b.yaw) * step, b.pos.z - Math.cos(b.yaw) * step, dt, 3.2);
          moving = true; speed = 0.7;
        }
        // shoot
        if (b.fireCD <= 0) {
          b.fireCD = 0.12 + Math.random() * 0.16;
          this._botShoot(b, peye, distP, player);
        }
      } else {
        // roam toward the wander target
        if (b.repathT <= 0 || b.pos.distanceTo(b.target) < 2) b._pick(b.pos);
        const d = b.target.clone().sub(b.pos); const dl = Math.hypot(d.x, d.z);
        if (dl > 0.5) { b.yaw = Math.atan2(-d.x, -d.z); this._step(b, b.pos.x + (d.x / dl) * 3.6 * dt * 60 * dt, b.pos.z + (d.z / dl) * 3.6 * dt * 60 * dt, dt, 3.6); moving = true; speed = 0.6; }
      }

      b.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      b.group.rotation.y = b.yaw;
      if (b.group.userData.anim) b.group.userData.anim({ moving, speed, t: b.t }, dt, b.t);
    }
  }
  _step(b, nx, nz, dt, spd) {
    // clamp speed
    const dx = nx - b.pos.x, dz = nz - b.pos.z; const dl = Math.hypot(dx, dz) || 1;
    const mx = Math.min(dl, spd * dt) * dx / dl, mz = Math.min(dl, spd * dt) * dz / dl;
    const tx = b.pos.x + mx, tz = b.pos.z + mz;
    if (!this._blocked(tx, b.pos.z)) b.pos.x = Math.max(-63, Math.min(63, tx)); else b.repathT = 0;
    if (!this._blocked(b.pos.x, tz)) b.pos.z = Math.max(-63, Math.min(63, tz)); else b.repathT = 0;
  }
  _botShoot(b, peye, dist, player) {
    const muzzle = b.gun.userData.muzzleLocal ? b.gun.localToWorld(b.gun.userData.muzzleLocal.clone()) : new THREE.Vector3(b.pos.x, b.pos.y + 1.4, b.pos.z);
    const dir = peye.clone().sub(muzzle).normalize();
    this.fx.muzzle(muzzle, dir, 0xff9a5a);
    // accuracy falls off with distance
    const hitChance = Math.max(0.12, 0.62 - dist * 0.006);
    if (Math.random() < hitChance) { this.onHitPlayer && this.onHitPlayer(8 + (Math.random() * 6 | 0)); this.fx.tracer(muzzle, peye, 0xff8a4a); }
    else { const miss = peye.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3)); this.fx.tracer(muzzle, miss, 0xff8a4a); }
  }
}
