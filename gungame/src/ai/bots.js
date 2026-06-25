// Team-generic combat bots. Each bot has a `team` string; it hunts the nearest visible
// hostile unit (any unit whose team differs — another bot OR the player) and engages with
// reaction-time gating, strafing, and cover-seeking tuned by difficulty. Works for both
// Team Deathmatch (red/blue) and Free-for-All (every bot its own team). Kills route through
// onUnitKilled(killerTeam, victim); hits on the player through onHitPlayer(dmg, dir).
import * as THREE from 'three';
import { makeCharacter } from '../models/character.js';
import { makeWorldWeapon } from '../models/guns.js';
import { DIFFICULTY } from '../game/match.js';

const NAMES = ['Razor', 'Vex', 'Cobra', 'Ghost', 'Echo', 'Riot', 'Nova', 'Slate', 'Drift', 'Pike', 'Wraith', 'Talon'];
const TEAM_TINTS = {
  red:  [0x9a4a42, 0x8a3f39, 0xa85a4a, 0x933b34],
  blue: [0x42588e, 0x39507e, 0x4d6498, 0x3c5288],
};
// distinct hues for FFA so every combatant reads as its own faction
const FFA_TINTS = [0xb0563a, 0x3f7e54, 0x8e6bc0, 0xc0a23a, 0x3a86b0, 0xb04270, 0x6f9a3a, 0xc06a3a];

class Bot {
  constructor(scene, fx, name, team, uniform) {
    this.scene = scene; this.fx = fx; this.name = name; this.team = team;
    this.group = makeCharacter({ team: team === 'red' || team === 'blue' ? team : 'red', uniform });
    scene.add(this.group);
    this.parts = this.group.userData.parts;
    this.gun = makeWorldWeapon('rifle');
    this.gun.position.set(0.2, 1.18, -0.22);
    this.group.add(this.gun);
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.7, 0.55), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 0.9; this.hit.userData.bot = this; this.group.add(this.hit);
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.maxHp = 100; this.health = 100; this.alive = true; this.respawnT = 0; this.deathT = 0;
    this.target = new THREE.Vector3(); this.fireCD = 0; this.repathT = 0; this.t = Math.random() * 10;
    this.lastHitT = 9; this.aimT = 0; this.strafeDir = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.cover = null; this.coverT = 0;
  }
  headY() { return this.pos.y + 1.45; }
  spawn(p, hp) {
    this.pos.copy(p); this.maxHp = hp; this.health = hp; this.alive = true; this.deathT = 0; this.respawnT = 0;
    this.group.visible = true; this.group.position.copy(this.pos); this.group.rotation.set(0, 0, 0);
    this.hit.userData.bot = this; this.aimT = 0; this.cover = null; this.lastHitT = 9;
    this._roam(p);
  }
  _roam(near) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 30;
    this.target.set(
      Math.max(-62, Math.min(62, near.x + Math.cos(a) * r)), 0,
      Math.max(-62, Math.min(62, near.z + Math.sin(a) * r)),
    );
    this.repathT = 2 + Math.random() * 3;
  }
  hurt(dmg) {
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
  constructor(scene, fx, world) {
    this.scene = scene; this.fx = fx; this.world = world;
    this.list = []; this.ray = new THREE.Raycaster();
    this.onHitPlayer = null; this.onUnitKilled = null; this.onBotShoot = null;
    this.targetMeshes = []; this.diff = DIFFICULTY.normal; this.mode = null;
  }

  clear() { for (const b of this.list) this.scene.remove(b.group); this.list = []; }

  // (re)build the roster for a mode + difficulty. Registers FFA teams on the match.
  setup(mode, diff, match) {
    this.clear(); this.diff = diff; this.mode = mode;
    let n = 0;
    const spawnAt = (i) => { const s = this.world.spawns[i % this.world.spawns.length]; return new THREE.Vector3(s.x, 0, s.z); };
    const make = (team, name, uniform, spawnIdx) => {
      const b = new Bot(this.scene, this.fx, name, team, uniform);
      b.spawn(spawnAt(spawnIdx), diff.hp);
      this.list.push(b); return b;
    };
    if (mode.teams) {
      const base = Math.ceil(this.world.spawns.length / 2);
      for (let i = 0; i < mode.roster.red; i++) make('red', NAMES[n++ % NAMES.length], TEAM_TINTS.red[i % 4], i);
      for (let i = 0; i < mode.roster.blue; i++) make('blue', NAMES[n++ % NAMES.length], TEAM_TINTS.blue[i % 4], base + i);
    } else {
      const count = mode.bots || 6;
      for (let i = 0; i < count; i++) {
        const team = 'b' + i, name = NAMES[i % NAMES.length];
        make(team, name, FFA_TINTS[i % FFA_TINTS.length], i * 2);
        match && match.registerTeam(team, name);
      }
    }
  }

  // hitboxes the player (on `team`) is allowed to shoot — everyone not on their team
  hitMeshesHostileTo(team) { return this.list.filter((b) => b.alive && b.team !== team).map((b) => b.hit); }
  hitMeshes() { return this.list.filter((b) => b.alive).map((b) => b.hit); }
  aliveCount(team) { return this.list.filter((b) => b.alive && b.team === team).length; }

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
  // a spot on the far side of nearby cover relative to a threat (or null)
  _findCover(bot, threat) {
    let best = null, bd = 1e9;
    for (const c of this.world.colliders) {
      if (c.max.y - c.min.y < 1.3) continue;
      const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
      const d = Math.hypot(cx - bot.pos.x, cz - bot.pos.z);
      if (d < bd && d < 20) { bd = d; best = { cx, cz, w: (c.max.x - c.min.x + c.max.z - c.min.z) / 4 }; }
    }
    if (!best) return null;
    const dx = best.cx - threat.x, dz = best.cz - threat.z, dl = Math.hypot(dx, dz) || 1;
    const off = best.w + 1.1;
    return new THREE.Vector3(best.cx + (dx / dl) * off, 0, best.cz + (dz / dl) * off);
  }

  update(dt, player) {
    const pTeam = (player && player.team) || 'you';
    const peye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
    const units = [{ team: pTeam, alive: player.alive, eye: peye, isPlayer: true }];
    for (const b of this.list) if (b.alive) units.push({ team: b.team, alive: true, eye: new THREE.Vector3(b.pos.x, b.pos.y + 1.5, b.pos.z), bot: b });

    for (const b of this.list) {
      if (!b.alive) {
        b.deathT += dt; b.respawnT -= dt;
        b.group.position.y = -Math.min(2, b.deathT * 1.5);
        b.group.rotation.z = Math.min(1.3, b.deathT * 2);
        if (b.respawnT <= 0) { const s = this.world.spawns[(Math.random() * this.world.spawns.length) | 0]; b.spawn(new THREE.Vector3(s.x, 0, s.z), this.diff.hp); }
        continue;
      }
      b.t += dt; b.fireCD -= dt; b.repathT -= dt; b.lastHitT += dt; b.strafeT -= dt; b.coverT -= dt;
      const beye = new THREE.Vector3(b.pos.x, b.pos.y + 1.5, b.pos.z);

      // acquire nearest visible hostile
      let best = null, bestD = Infinity;
      for (const u of units) {
        if (!u.alive || u.team === b.team || u.bot === b) continue;
        const d = u.eye.distanceTo(beye);
        if (d < bestD && d < 72 && this._los(beye, u.eye)) { bestD = d; best = u; }
      }

      let moving = false, speed = 0;
      if (best) {
        b.aimT += dt;                                    // reaction-time gate
        b.yaw = Math.atan2(-(best.eye.x - b.pos.x), -(best.eye.z - b.pos.z));
        const threatened = b.health < b.maxHp * 0.4 || b.lastHitT < 1.4;

        if (threatened && Math.random() < this.diff.cover * dt * 2.2 && !b.cover) {
          b.cover = this._findCover(b, best.eye); b.coverT = 1.6 + Math.random();
        }
        if (b.cover && b.coverT > 0) {
          const d = b.cover.clone().sub(b.pos); const dl = Math.hypot(d.x, d.z);
          if (dl > 0.6) { this._step(b, b.pos.x + (d.x / dl) * 4.2 * dt, b.pos.z + (d.z / dl) * 4.2 * dt, 4.2); moving = true; speed = 0.8; }
          else b.cover = null;
        } else {
          b.cover = null;
          // hold a preferred range; strafe to be a harder target
          if (b.strafeT <= 0) { b.strafeDir *= -1; b.strafeT = 0.7 + Math.random() * 0.9; }
          const toward = bestD > 26 ? 1 : bestD < 12 ? -0.7 : 0;
          const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);          // toward target
          const sx = -Math.cos(b.yaw) * b.strafeDir, sz = Math.sin(b.yaw) * b.strafeDir; // perpendicular
          const mvx = fx * toward * 3.0 + sx * 2.4, mvz = fz * toward * 3.0 + sz * 2.4;
          if (Math.abs(mvx) + Math.abs(mvz) > 0.01) { this._step(b, b.pos.x + mvx * dt, b.pos.z + mvz * dt, 3.4); moving = true; speed = 0.7; }
          // fire once the reaction delay has elapsed
          const react = this.diff.react[0] + Math.random() * (this.diff.react[1] - this.diff.react[0]);
          if (b.aimT >= react && b.fireCD <= 0) { b.fireCD = 0.13 + Math.random() * 0.16; this._shoot(b, best, bestD); }
        }
      } else {
        b.aimT = 0; b.cover = null;
        if (b.repathT <= 0 || b.pos.distanceTo(b.target) < 2) b._roam(b.pos);
        const d = b.target.clone().sub(b.pos); const dl = Math.hypot(d.x, d.z);
        if (dl > 0.5) { b.yaw = Math.atan2(-d.x, -d.z); this._step(b, b.pos.x + (d.x / dl) * 3.4 * dt, b.pos.z + (d.z / dl) * 3.4 * dt, 3.4); moving = true; speed = 0.55; }
      }

      b.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      b.group.rotation.y = b.yaw;
      if (b.group.userData.anim) b.group.userData.anim({ moving, speed, t: b.t }, dt, b.t);
    }
  }

  _step(b, nx, nz, spd) {
    const dx = nx - b.pos.x, dz = nz - b.pos.z;
    if (!this._blocked(b.pos.x + dx, b.pos.z)) b.pos.x = Math.max(-63, Math.min(63, b.pos.x + dx)); else b.repathT = 0;
    if (!this._blocked(b.pos.x, b.pos.z + dz)) b.pos.z = Math.max(-63, Math.min(63, b.pos.z + dz)); else b.repathT = 0;
  }
  _shoot(b, target, dist) {
    const muzzle = b.gun.userData.muzzleLocal ? b.gun.localToWorld(b.gun.userData.muzzleLocal.clone()) : new THREE.Vector3(b.pos.x, b.pos.y + 1.4, b.pos.z);
    const aim = target.eye;
    const dir = aim.clone().sub(muzzle).normalize();
    const col = b.team === 'red' ? 0xff8a4a : b.team === 'blue' ? 0x6ab8ff : 0xffd24a;
    this.fx.muzzle(muzzle, dir, col);
    this.onBotShoot && this.onBotShoot(muzzle, b);
    const hitChance = Math.max(0.1, this.diff.accuracy - dist * 0.006);
    if (Math.random() < hitChance) {
      this.fx.tracer(muzzle, aim, col);
      if (target.isPlayer) { this.onHitPlayer && this.onHitPlayer(Math.round((7 + (Math.random() * 6 | 0)) * this.diff.dmgMul), dir, b); }
      else { const died = target.bot.hurt(Math.round((10 + (Math.random() * 8 | 0)) * this.diff.dmgMul)); if (died) this.onUnitKilled && this.onUnitKilled(b.team, target.bot); }
    } else {
      const e = this.diff.aimErr * 18;
      const miss = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * e, (Math.random() - 0.5) * e * 0.6, (Math.random() - 0.5) * e));
      this.fx.tracer(muzzle, miss, col);
    }
  }
}
