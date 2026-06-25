// Team bots for GunGame's team-deathmatch. Two teams — RED (enemies) and BLUE (the
// player's squad). Each bot roams, hunts the nearest visible enemy *unit* (an enemy bot
// OR, for red bots, the player), and shoots. Bot-vs-bot damage is probabilistic; hits on
// the player are reported via onHitPlayer; kills are reported via onUnitKilled so the
// game can keep team scores. Each bot carries an invisible hitbox; only the ENEMY (red)
// hitboxes are handed to the player's weapon raycast.
import * as THREE from 'three';
import { makeCharacter } from '../models/character.js';
import { makeWorldWeapon } from '../models/guns.js';

const NAMES = ['Razor', 'Vex', 'Cobra', 'Ghost', 'Echo', 'Riot', 'Nova', 'Slate', 'Drift', 'Pike'];
// Per-team uniform tints (multiplied over the soldier texture) — varied within the team
// hue so allies/enemies are instantly readable but not identical clones.
const UNIFORMS = {
  red:  [0xc25b4f, 0xb24a42, 0xd06a55, 0xa84038],
  blue: [0x4a6fb0, 0x3f5fa0, 0x5a7fc0, 0x4660a0],
};

class Bot {
  constructor(scene, fx, name, team, uniform) {
    this.scene = scene; this.fx = fx; this.name = name; this.team = team;
    this.group = makeCharacter({ team, uniform });
    scene.add(this.group);
    this.parts = this.group.userData.parts;
    // weapon held at the ready (chest height, pointing forward -Z)
    this.gun = makeWorldWeapon('rifle');
    this.gun.position.set(0.2, 1.18, -0.22);
    this.group.add(this.gun);
    // invisible hitbox for bullets / target queries
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
    this.target.set(near.x + Math.cos(a) * r, 0, near.z + Math.sin(a) * r);
    this.target.x = Math.max(-62, Math.min(62, this.target.x));
    this.target.z = Math.max(-62, Math.min(62, this.target.z));
    this.repathT = 2 + Math.random() * 3;
  }
  hurt(dmg, head) {
    if (!this.alive) return false;
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
  constructor(scene, fx, world, opts = {}) {
    // accept a number (legacy: red count) or { red, blue }
    const red = typeof opts === 'number' ? opts : (opts.red ?? 4);
    const blue = typeof opts === 'number' ? 0 : (opts.blue ?? 3);
    this.scene = scene; this.fx = fx; this.world = world;
    this.list = []; this.ray = new THREE.Raycaster();
    this.onHitPlayer = null;    // (dmg) => {}            red bot hit the player
    this.onUnitKilled = null;   // (killerTeam, victim) => {}  a bot killed another bot
    this.targetMeshes = [];     // arena meshes (for LoS)
    let n = 0;
    const make = (team, i) => {
      const pool = UNIFORMS[team];
      const b = new Bot(scene, fx, NAMES[n % NAMES.length], team, pool[i % pool.length]);
      // separate the teams at spawn: reds ring one half, blues the other
      const base = team === 'red' ? 0 : Math.ceil(world.spawns.length / 2);
      const sp = world.spawns[(base + i) % world.spawns.length];
      b.spawn(new THREE.Vector3(sp.x, 0, sp.z));
      this.list.push(b); n++;
    };
    for (let i = 0; i < red; i++) make('red', i);
    for (let i = 0; i < blue; i++) make('blue', i);
  }
  // enemy hitboxes the PLAYER may shoot (red team only — no friendly fire)
  redHitMeshes() { return this.list.filter((b) => b.alive && b.team === 'red').map((b) => b.hit); }
  hitMeshes() { return this.redHitMeshes(); }   // back-compat alias

  _blocked(x, z) {
    for (const c of this.world.colliders) {
      if (c.max.y < 0.4) continue;
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
    // build the unit list for targeting: every alive bot + the player (blue team)
    const peye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
    const units = [{ team: 'blue', alive: player.alive, eye: peye, isPlayer: true }];
    for (const b of this.list) {
      if (b.alive) units.push({ team: b.team, alive: true, eye: new THREE.Vector3(b.pos.x, b.pos.y + 1.5, b.pos.z), bot: b });
    }

    for (const b of this.list) {
      if (!b.alive) {
        b.deathT += dt; b.respawnT -= dt;
        b.group.position.y = -Math.min(2, b.deathT * 1.5);
        b.group.rotation.z = Math.min(1.3, b.deathT * 2);
        if (b.respawnT <= 0) { const sp = this.world.spawns[(Math.random() * this.world.spawns.length) | 0]; b.spawn(new THREE.Vector3(sp.x, 0, sp.z)); }
        continue;
      }
      b.t += dt; b.fireCD -= dt; b.repathT -= dt; b.lastHitT += dt;
      const beye = new THREE.Vector3(b.pos.x, b.pos.y + 1.5, b.pos.z);

      // nearest visible enemy unit
      let best = null, bestD = Infinity;
      for (const u of units) {
        if (!u.alive || u.team === b.team || u.bot === b) continue;
        const d = u.eye.distanceTo(beye);
        if (d < bestD && d < 70 && this._los(beye, u.eye)) { bestD = d; best = u; }
      }

      let moving = false, speed = 0;
      if (best) {
        b.yaw = Math.atan2(-(best.eye.x - b.pos.x), -(best.eye.z - b.pos.z));
        if (bestD > 22 || b.lastHitT < 0.6) {
          const step = (bestD > 22 ? 1 : -0.4);
          this._step(b, b.pos.x - Math.sin(b.yaw) * step, b.pos.z - Math.cos(b.yaw) * step, dt, 3.2);
          moving = true; speed = 0.7;
        }
        if (b.fireCD <= 0) { b.fireCD = 0.12 + Math.random() * 0.16; this._botShoot(b, best, bestD); }
      } else {
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
    const dx = nx - b.pos.x, dz = nz - b.pos.z; const dl = Math.hypot(dx, dz) || 1;
    const mx = Math.min(dl, spd * dt) * dx / dl, mz = Math.min(dl, spd * dt) * dz / dl;
    const tx = b.pos.x + mx, tz = b.pos.z + mz;
    if (!this._blocked(tx, b.pos.z)) b.pos.x = Math.max(-63, Math.min(63, tx)); else b.repathT = 0;
    if (!this._blocked(b.pos.x, tz)) b.pos.z = Math.max(-63, Math.min(63, tz)); else b.repathT = 0;
  }
  _botShoot(b, target, dist) {
    const muzzle = b.gun.userData.muzzleLocal ? b.gun.localToWorld(b.gun.userData.muzzleLocal.clone()) : new THREE.Vector3(b.pos.x, b.pos.y + 1.4, b.pos.z);
    const aim = target.eye;
    const dir = aim.clone().sub(muzzle).normalize();
    const col = b.team === 'red' ? 0xff8a4a : 0x6ab8ff;   // tracer/muzzle colour by team
    this.fx.muzzle(muzzle, dir, col);
    const hitChance = Math.max(0.12, 0.6 - dist * 0.006);
    if (Math.random() < hitChance) {
      this.fx.tracer(muzzle, aim, col);
      if (target.isPlayer) { this.onHitPlayer && this.onHitPlayer(8 + (Math.random() * 6 | 0)); }
      else {
        const victim = target.bot;
        const died = victim.hurt(10 + (Math.random() * 8 | 0), false);
        if (died) this.onUnitKilled && this.onUnitKilled(b.team, victim);
      }
    } else {
      const miss = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
      this.fx.tracer(muzzle, miss, col);
    }
  }
}
