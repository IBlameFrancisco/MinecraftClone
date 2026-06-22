// AI combatants for Battle mode. A bot is essentially a player-shaped entity that
// uses the real gun system. It is simulated only on the authority (the co-op host,
// or you in single-player); guests just render bots as remote avatars driven by
// broadcast positions. Steering navigation + cover points (no heavy pathfinding,
// since the arena is a bounded flat plane), with difficulty-tuned aim/aggression.

import * as THREE from 'three';
import { moveEntity } from './physics.js';
import { makeAvatar } from './net.js';
import { getSkin, randomBotSkin } from './skins.js';
import {
  HANDGUN, SMG, ASSAULT_RIFLE, SHOTGUN, SNIPER, RAILGUN, PLASMA_GUN, ROCKET_LAUNCHER, gunOf,
} from './items.js';

const GRAVITY = 28;
const TWO_PI = Math.PI * 2;
const HALF = 0.3, HEIGHT = 1.8, EYE = 1.6;

// Difficulty presets: reaction time, aim error (rad), turn rate, preferred engage
// range, fire micro-gap, projectile lead factor, and cover-seeking tendency.
export const BOT_DIFF = {
  easy:   { react: 0.55, aimErr: 0.095, turn: 3.5,  range: 26, fireGap: 0.22, lead: 0.0,  cover: 0.25, speed: 3.6 },
  normal: { react: 0.32, aimErr: 0.045, turn: 6.0,  range: 42, fireGap: 0.10, lead: 0.55, cover: 0.5,  speed: 4.2 },
  hard:   { react: 0.16, aimErr: 0.020, turn: 9.0,  range: 64, fireGap: 0.05, lead: 0.85, cover: 0.7,  speed: 4.5 },
  insane: { react: 0.07, aimErr: 0.008, turn: 13.0, range: 110, fireGap: 0.02, lead: 1.0, cover: 0.85, speed: 4.8 },
};

const NAMES = ['Vortex', 'Blaze', 'Specter', 'Rogue', 'Talon', 'Cipher', 'Nova', 'Onyx',
  'Razor', 'Echo', 'Ghost', 'Striker', 'Havoc', 'Saber', 'Vandal', 'Wraith'];

// Weapon pools by difficulty. Bots use hitscan-class guns only (instant, clean
// damage attribution); projectile guns stay player-exclusive.
const LOADOUT = {
  easy:   [HANDGUN, SMG, SHOTGUN],
  normal: [SMG, ASSAULT_RIFLE, SHOTGUN, HANDGUN],
  hard:   [ASSAULT_RIFLE, SHOTGUN, SNIPER, SMG],
  insane: [ASSAULT_RIFLE, RAILGUN, SNIPER, SHOTGUN],
};
const pick = (a) => a[(Math.random() * a.length) | 0];

let _botSeq = 0;

class Bot {
  constructor(name, team, diffName) {
    this.id = 'bot:' + (_botSeq++);
    this.name = name;
    this.team = team;
    this.bot = true;
    this.diffName = diffName;
    this.D = BOT_DIFF[diffName] || BOT_DIFF.normal;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * TWO_PI;
    this.pitch = 0;
    this.health = 20;
    this.alive = true;
    this.onGround = false;
    this.target = null;
    this.reactTimer = 0;
    this.fireCD = 0;
    this.reloadTimer = 0;
    this.ammo = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.jumpCD = 0;
    this.coverGoal = null;
    this.coverTimer = 0;
    this.defend = false;         // war: hold a position (MG nest) instead of advancing
    this.anchor = null;          // the point to hold
    this.advance = false;        // war: push toward an objective even while engaging
    this.advanceGoal = null;     // the point to push toward
    this.kills = 0; this.deaths = 0;
    this.skinId = randomBotSkin();
    this.mesh = null;            // avatar group, created by the manager
    this._chooseGun();
  }

  _chooseGun() {
    this.gunId = pick(LOADOUT[this.diffName] || LOADOUT.normal);
    this.gun = gunOf(this.gunId);
    this.ammo = this.gun.mag || Infinity;
    this.reloadTimer = 0;
  }

  eye(out) { return out.set(this.pos.x, this.pos.y + EYE, this.pos.z); }

  hurt(dmg, fromX, fromZ) {
    this.health -= dmg;
    if (fromX !== undefined) {
      const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 4; this.vel.z += (dz / d) * 4;
    }
    if (this.health <= 0) this.alive = false;
  }
}

export class BotManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bots = [];
    this._eyeA = new THREE.Vector3();
    this._eyeB = new THREE.Vector3();
  }

  clear() {
    for (const b of this.bots) {
      this.group.remove(b.mesh);
      b.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); } });
    }
    this.bots.length = 0;
  }

  // Spawn `count` bots, assigned the given teams (array, cycled) at `difficulty`.
  // `skinFor(team)` optionally overrides the avatar skin (e.g. faction uniforms).
  spawn(count, teams, difficulty, spawnFor, colorFor, skinFor) {
    const used = new Set(this.bots.map((b) => b.name));
    for (let i = 0; i < count; i++) {
      let nm = pick(NAMES); let guard = 0;
      while (used.has(nm) && guard++ < 30) nm = pick(NAMES);
      used.add(nm);
      const team = teams[i % teams.length];
      const b = new Bot(nm, team, difficulty);
      const sp = spawnFor(team);
      b.pos.set(sp.x, sp.y, sp.z);
      if (sp.yaw !== undefined) b.yaw = sp.yaw;
      b.mesh = makeAvatar(b.name, skinFor ? skinFor(team) : getSkin(b.skinId), colorFor(team));
      b.mesh.position.copy(b.pos);
      this.group.add(b.mesh);
      this.bots.push(b);
    }
  }

  get(id) { return this.bots.find((b) => b.id === id); }

  // Ray vs all bot avatars → nearest { id, dist, head, bot:true }, excluding `exclude`.
  raycast(origin, dir, maxDist, exclude) {
    let best = null, bestT = maxDist;
    for (const b of this.bots) {
      if (!b.alive || b.id === exclude) continue;
      const t = rayBox(origin, dir, b.pos.x - HALF, b.pos.y, b.pos.z - HALF, b.pos.x + HALF, b.pos.y + HEIGHT, b.pos.z + HALF);
      if (t < bestT) { bestT = t; best = b; }
    }
    if (!best) return null;
    const head = (origin.y + dir.y * bestT) >= best.pos.y + 1.45;
    return { id: best.id, dist: bestT, head, bot: true };
  }

  // Every living bot a (piercing) ray passes through → [{ id, dist, head, team }].
  raycastAll(origin, dir, maxDist, exclude) {
    const out = [];
    for (const b of this.bots) {
      if (!b.alive || b.id === exclude) continue;
      const t = rayBox(origin, dir, b.pos.x - HALF, b.pos.y, b.pos.z - HALF, b.pos.x + HALF, b.pos.y + HEIGHT, b.pos.z + HALF);
      if (t <= maxDist) out.push({ id: b.id, dist: t, head: (origin.y + dir.y * t) >= b.pos.y + 1.45, team: b.team });
    }
    return out;
  }

  // ctx: { world, los(ax,ay,az,bx,by,bz)->bool, targets:[{id,team,pos,vel?,alive,head}],
  //        fire(bot, dir), arenaFloorY, onDeath(bot) }
  update(dt, ctx) {
    for (const b of this.bots) {
      if (b.alive) this._updateBot(b, dt, ctx);
    }
  }

  _updateBot(b, dt, ctx) {
    b.fireCD -= dt; b.reactTimer -= dt; b.strafeTimer -= dt; b.jumpCD -= dt; b.coverTimer -= dt;
    if (b.reloadTimer > 0) { b.reloadTimer -= dt; if (b.reloadTimer <= 0) b.ammo = b.gun.mag || Infinity; }

    // --- Target selection: nearest living enemy (different team / FFA). Human
    // players are weighted as "closer" so bots prefer hunting people over bots,
    // which keeps the action centred on the player even from across the map. ---
    const all = ctx.targets;
    let best = null, bestVis = null, bestD = Infinity, bestVisD = Infinity;
    b.eye(this._eyeA);
    for (const t of all) {
      if (!t.alive || t.id === b.id) continue;
      if (b.team >= 0 && t.team === b.team) continue;      // teammate
      const human = !String(t.id).startsWith('bot:');
      const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z) * (human ? 0.55 : 1);
      if (d < bestD) { bestD = d; best = t; }
      const tex = t.pos.x, tey = t.pos.y + EYE, tez = t.pos.z;
      if (ctx.los(this._eyeA.x, this._eyeA.y, this._eyeA.z, tex, tey, tez) && d < bestVisD) { bestVisD = d; bestVis = t; }
    }
    const target = bestVis || best;
    b.target = target ? target.id : null;
    const hasLoS = !!bestVis;

    let desiredX = 0, desiredZ = 0, speed = b.D.speed;
    if (target) {
      const tx = target.pos.x, tz = target.pos.z, dist = Math.hypot(tx - b.pos.x, tz - b.pos.z) || 1;
      // Face the target (aim), with projectile lead.
      let aimX = target.pos.x, aimY = target.pos.y + EYE * 0.92, aimZ = target.pos.z;
      if (b.gun.speed && target.vel) {
        const lead = b.D.lead * (dist / b.gun.speed);
        aimX += target.vel.x * lead; aimZ += target.vel.z * lead;
      }
      const wantYaw = Math.atan2(aimX - b.pos.x, aimZ - b.pos.z);
      const wantPitch = Math.atan2(aimY - (b.pos.y + EYE), Math.hypot(aimX - b.pos.x, aimZ - b.pos.z));
      b.yaw = turnToward(b.yaw, wantYaw, b.D.turn * dt);
      b.pitch += (wantPitch - b.pitch) * Math.min(1, b.D.turn * dt);

      // Movement: keep preferred range, strafe, seek cover when reloading / low.
      const seekCover = (b.reloadTimer > 0 || b.health < 7) && Math.random() < b.D.cover && !b.defend;
      const toX = (tx - b.pos.x) / dist, toZ = (tz - b.pos.z) / dist;
      if (seekCover && ctx.coverPoints && ctx.coverPoints.length) {
        if (!b.coverGoal || b.coverTimer <= 0) { b.coverGoal = nearestCover(ctx.coverPoints, b.pos); b.coverTimer = 2.5; }
        desiredX = b.coverGoal.x - b.pos.x; desiredZ = b.coverGoal.z - b.pos.z;
      } else if (b.defend && b.anchor) {
        // Defender: hold the nest. Return to it if pushed off; otherwise shuffle and fire.
        const ax = b.anchor.x - b.pos.x, az = b.anchor.z - b.pos.z, ad = Math.hypot(ax, az);
        if (ad > 4.5) { desiredX = ax; desiredZ = az; }
        else { if (b.strafeTimer <= 0) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeTimer = 1.2 + Math.random(); }
          // Gentle nest shuffle — apply as a slower speed, not a smaller vector (which the
          // unit-normalisation below would cancel out, making defenders strafe at full tilt).
          desiredX = -toZ * b.strafe; desiredZ = toX * b.strafe; speed = b.D.speed * 0.35; }
      } else if (b.advance && b.advanceGoal && Math.hypot(b.advanceGoal.x - b.pos.x, b.advanceGoal.z - b.pos.z) > 7) {
        // Attacker: charge the objective, weaving a little, firing on the move.
        if (b.strafeTimer <= 0) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeTimer = 0.6 + Math.random() * 0.6; }
        desiredX = (b.advanceGoal.x - b.pos.x) - toZ * b.strafe * 3; desiredZ = b.advanceGoal.z - b.pos.z;
      } else {
        b.coverGoal = null;
        const pref = b.D.range;
        if (dist > pref * 1.15) { desiredX = toX; desiredZ = toZ; }
        else if (dist < pref * 0.55) { desiredX = -toX; desiredZ = -toZ; }
        else { if (b.strafeTimer <= 0) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeTimer = 0.8 + Math.random(); }
          desiredX = -toZ * b.strafe; desiredZ = toX * b.strafe; }
      }

      // Fire when roughly on-target, in LoS, off cooldown, has ammo and reaction met.
      const aimErrAngle = Math.abs(angleDiff(b.yaw, wantYaw));
      if (hasLoS && b.reloadTimer <= 0 && b.fireCD <= 0 && aimErrAngle < 0.16 && dist < b.gun.range) {
        if (b.reactTimer <= 0) {
          ctx.fire(b, this._aimDir(b, aimX, aimY, aimZ));
          if (b.gun.mag) { b.ammo--; if (b.ammo <= 0) b.reloadTimer = b.gun.reload; }
          b.fireCD = b.gun.rate + b.D.fireGap;
          b.reactTimer = 0;
        }
      } else if (!hasLoS || dist >= b.gun.range) {
        b.reactTimer = b.D.react;          // reset reaction when target breaks
      }
    } else if (b.defend && b.anchor) {
      // Defender with no target: stay on the nest, keep facing the beach.
      b.reactTimer = b.D.react;
      const ax = b.anchor.x - b.pos.x, az = b.anchor.z - b.pos.z, ad = Math.hypot(ax, az);
      if (ad > 1.5) { desiredX = ax; desiredZ = az; speed = b.D.speed * 0.5; }
      else { b.yaw = turnToward(b.yaw, Math.PI, b.D.turn * dt); }   // face +Z (the incoming Allies)
    } else if (b.advance && b.advanceGoal && Math.hypot(b.advanceGoal.x - b.pos.x, b.advanceGoal.z - b.pos.z) > 5) {
      // Attacker with no target: push toward the objective at speed.
      b.reactTimer = b.D.react;
      desiredX = b.advanceGoal.x - b.pos.x; desiredZ = b.advanceGoal.z - b.pos.z; speed = b.D.speed;
      b.yaw = turnToward(b.yaw, Math.atan2(desiredX, desiredZ), b.D.turn * dt);
    } else {
      // No target: drift toward arena centre / wander. Keep the reaction delay primed so
      // the next time we spot an enemy we don't fire on the very first frame (difficulty react).
      b.reactTimer = b.D.react;
      if (b.strafeTimer <= 0) { b.strafeTimer = 1.5 + Math.random() * 2; const a = Math.random() * TWO_PI; b.wx = Math.cos(a); b.wz = Math.sin(a); }
      desiredX = (b.wx || 0) - b.pos.x * 0.002; desiredZ = (b.wz || 0) - b.pos.z * 0.002;
      speed = b.D.speed * 0.5;
    }

    // --- Locomotion (shared AABB voxel collision + 1-block hop) ---
    const dl = Math.hypot(desiredX, desiredZ);
    if (dl > 0.001) {
      desiredX /= dl; desiredZ /= dl;
      b.vel.x += (desiredX * speed - b.vel.x) * Math.min(1, 9 * dt);
      b.vel.z += (desiredZ * speed - b.vel.z) * Math.min(1, 9 * dt);
      if (b.onGround && b.jumpCD <= 0) {
        const fx = b.pos.x + desiredX * (HALF + 0.3), fz = b.pos.z + desiredZ * (HALF + 0.3);
        const footY = Math.floor(b.pos.y + 0.1);
        if (ctx.world.getBlock(Math.floor(fx), footY, Math.floor(fz)) !== 0 &&
            ctx.world.getBlock(Math.floor(fx), footY + 1, Math.floor(fz)) === 0) { b.vel.y = 7.4; b.jumpCD = 0.6; }
      }
    } else { b.vel.x *= 0.8; b.vel.z *= 0.8; }

    b.vel.y -= GRAVITY * dt;
    if (b.vel.y < -34) b.vel.y = -34;
    b.onGround = moveEntity(ctx.world, b.pos, b.vel, HALF, HEIGHT, dt);

    // Fell off the map → eliminate (counts as a death, no killer — clear any recent
    // hit so it isn't credited to whoever last tagged it).
    if (b.pos.y < ctx.arenaFloorY - 25) { b.alive = false; b.lastHitTime = -1e9; }

    b.mesh.position.copy(b.pos);
    b.mesh.rotation.y = b.yaw;
  }

  // Build the actual (error-applied) fire direction from the bot's eye toward aim.
  _aimDir(b, ax, ay, az) {
    b.eye(this._eyeA);
    const dir = new THREE.Vector3(ax - this._eyeA.x, ay - this._eyeA.y, az - this._eyeA.z).normalize();
    const err = b.D.aimErr * (1 + Math.hypot(b.vel.x, b.vel.z) * 0.06);
    dir.x += (Math.random() + Math.random() - 1) * err;
    dir.y += (Math.random() + Math.random() - 1) * err * 0.6;
    dir.z += (Math.random() + Math.random() - 1) * err;
    return dir.normalize();
  }
}

function nearestCover(points, pos) {
  let best = points[0], bd = Infinity;
  for (const p of points) { const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}

function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; return d; }
function turnToward(cur, want, maxStep) { const d = angleDiff(want, cur); return cur + Math.max(-maxStep, Math.min(maxStep, d)); }

// Slab ray vs AABB (entry distance or Infinity).
function rayBox(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  const axes = [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-8) { if (oo < lo || oo > hi) return Infinity; }
    else { let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd; if (t1 > t2) { const x = t1; t1 = t2; t2 = x; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity; }
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : Infinity);
}
