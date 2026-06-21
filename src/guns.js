// Gun visuals + projectiles: hitscan tracers, plasma bolts, portal-gun portals,
// and simple first-person viewmodels. Firing logic itself lives in main (it has
// the world/mobs/player references); this module owns the effects and portals.

import * as THREE from 'three';
import { HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN, SMG, ASSAULT_RIFLE, SHOTGUN, RAILGUN, ROCKET_LAUNCHER } from './items.js';
import { isSolid } from './blocks.js';

// A soft white radial sprite texture, tinted per-use for additive glows.
function softGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW_TEX = softGlowTexture();

// ---------------- Tracers ----------------
// A bright additive bullet streak: a white-hot core inside a coloured glow shell,
// fading + thinning over ~0.16s so rounds are clearly readable and bloom-lit.
export class Tracers {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }
  add(start, end, color = 0xffe08a) {
    const dir = end.clone().sub(start);
    const len = Math.max(0.02, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, len, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, len, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, glow);
    g.position.copy(start).add(end).multiplyScalar(0.5);
    g.quaternion.copy(q);
    g.renderOrder = 998;
    this.group.add(g);
    // A travelling spark at the leading edge sells the "bullet".
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    spark.scale.setScalar(0.5); spark.position.copy(end);
    this.group.add(spark);
    this.list.push({ g, core, glow, spark, start: start.clone(), end: end.clone(), life: 0.16, max: 0.16 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i]; t.life -= dt;
      if (t.life <= 0) {
        this.group.remove(t.g); this.group.remove(t.spark);
        t.g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        t.spark.material.dispose();
        this.list.splice(i, 1);
      } else {
        const k = t.life / t.max;
        t.core.material.opacity = k;
        t.glow.material.opacity = 0.55 * k;
        const s = 0.5 + 0.5 * k; t.g.scale.set(s, 1, s);
        t.spark.material.opacity = k;
        t.spark.scale.setScalar(0.5 * k + 0.1);
      }
    }
  }
}

// ---------------- Plasma bolts ----------------
// A glowing energy ball: solid core + pulsing additive halo, leaving a brief
// fading trail. Damages mobs and (in co-op) remote players, directly or by splash.
export class Plasmas {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; this.trail = []; }
  spawn(pos, dir, speed, damage, range) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xeafffb, fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x52ffd8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.setScalar(1.2);
    g.add(core, halo);
    g.position.copy(pos);
    this.group.add(g);
    this.list.push({ m: g, halo, vel: dir.clone().multiplyScalar(speed), pos: pos.clone(), damage, range, travelled: 0, t: 0 });
  }
  _spawnTrail(pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x44e8c8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(0.5); s.position.copy(pos);
    this.group.add(s); this.trail.push({ s, life: 0.25, max: 0.25 });
  }
  update(dt, world, mobs, mp, portals, onImpact) {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const tr = this.trail[i]; tr.life -= dt;
      if (tr.life <= 0) { this.group.remove(tr.s); tr.s.material.dispose(); this.trail.splice(i, 1); }
      else { const k = tr.life / tr.max; tr.s.material.opacity = 0.6 * k; tr.s.scale.setScalar(0.5 * k); }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.halo.scale.setScalar(1.1 + Math.sin(p.t * 34) * 0.2);
      const step = p.vel.clone().multiplyScalar(dt);
      p.pos.add(step); p.travelled += step.length();
      if (portals) portals.redirect(p);          // fly through portals
      p.m.position.copy(p.pos);
      this._spawnTrail(p.pos);
      let hit = p.travelled > p.range || isSolid(world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)));
      let hitPlayer = null;
      if (!hit) {
        for (const mob of mobs.list) {
          if (Math.hypot(mob.pos.x - p.pos.x, mob.pos.y + mob.height * 0.5 - p.pos.y, mob.pos.z - p.pos.z) < 0.9) { hit = true; break; }
        }
      }
      if (!hit && mp && mp.online) {
        for (const [id, r] of mp.remotes) {
          const gp = r.group.position;
          if (Math.hypot(gp.x - p.pos.x, gp.y + 1.05 - p.pos.y, gp.z - p.pos.z) < 0.85) { hit = true; hitPlayer = id; break; }
        }
      }
      if (hit) {
        onImpact(p.pos.clone(), p.damage, hitPlayer);
        this.group.remove(p.m); p.m.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        this.list.splice(i, 1);
      }
    }
  }
}

// ---------------- Rockets ----------------
// A travelling missile with a smoke/fire trail; on contact it calls back to do an
// AoE explosion (damage + knockback + block destruction) in main.
export class Rockets {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; this.trail = []; }
  spawn(pos, dir, gun, ownerId) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8),
      new THREE.MeshBasicMaterial({ color: 0x3a3a3a, fog: false }));
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 8),
      new THREE.MeshBasicMaterial({ color: 0xd23a2a, fog: false }));
    head.position.copy(dir).multiplyScalar(0.22);
    head.quaternion.copy(body.quaternion);
    g.add(body, head);
    g.position.copy(pos);
    this.group.add(g);
    this.list.push({ m: g, vel: dir.clone().multiplyScalar(gun.speed), pos: pos.clone(), gun, ownerId, travelled: 0 });
  }
  _puff(pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffa84a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(0.4); s.position.copy(pos);
    this.group.add(s); this.trail.push({ s, life: 0.3, max: 0.3 });
  }
  update(dt, world, mobs, mp, portals, onImpact) {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const tr = this.trail[i]; tr.life -= dt;
      if (tr.life <= 0) { this.group.remove(tr.s); tr.s.material.dispose(); this.trail.splice(i, 1); }
      else { const k = tr.life / tr.max; tr.s.material.opacity = 0.7 * k; tr.s.scale.setScalar(0.4 + (1 - k) * 0.5); }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const step = p.vel.clone().multiplyScalar(dt);
      p.pos.add(step); p.travelled += step.length();
      if (portals) portals.redirect(p);          // fly through portals
      p.m.position.copy(p.pos);
      this._puff(p.pos);
      let hit = p.travelled > p.gun.range || isSolid(world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)));
      if (!hit) {
        for (const mob of mobs.list) {
          if (Math.hypot(mob.pos.x - p.pos.x, mob.pos.y + mob.height * 0.5 - p.pos.y, mob.pos.z - p.pos.z) < 0.9) { hit = true; break; }
        }
      }
      if (!hit && mp && mp.online) {
        for (const [id, r] of mp.remotes) {
          const gp = r.group.position;
          if (Math.hypot(gp.x - p.pos.x, gp.y + 1.05 - p.pos.y, gp.z - p.pos.z) < 0.85) { hit = true; break; }
        }
      }
      if (hit) {
        onImpact(p.pos.clone(), p.gun, p.ownerId);
        this.group.remove(p.m); p.m.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        this.list.splice(i, 1);
      }
    }
  }
}

// ---------------- Grenades ----------------
// A thrown, bouncing frag that detonates on a fuse.
export class Grenades {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }
  spawn(pos, vel, fuse, onExplode) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshLambertMaterial({ color: 0x39402c }));
    m.position.copy(pos);
    this.group.add(m);
    this.list.push({ m, pos: pos.clone(), vel: vel.clone(), fuse, onExplode, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
  }
  update(dt, world) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      g.vel.y -= 24 * dt;
      for (const axis of ['x', 'y', 'z']) {
        const test = g.pos.clone(); test[axis] += g.vel[axis] * dt;
        if (isSolid(world.getBlock(Math.floor(test.x), Math.floor(test.y), Math.floor(test.z)))) {
          g.vel[axis] *= -0.4;
          if (axis === 'y' && Math.abs(g.vel.y) < 1.5) { g.vel.x *= 0.7; g.vel.z *= 0.7; }   // settle
        } else g.pos[axis] = test[axis];
      }
      g.m.position.copy(g.pos);
      g.m.rotation.x += g.spin.x * dt; g.m.rotation.y += g.spin.y * dt;
      if (g.fuse <= 0) {
        g.onExplode(g.pos.clone());
        this.group.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); this.list.splice(i, 1);
      }
    }
  }
}

// ---------------- Portals ----------------
export class Portals {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.slots = [null, null];        // A (blue), B (orange)
    this.meshes = [null, null];
    this.cooldown = 0;
  }
  _mesh(color) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 12, 28), new THREE.MeshBasicMaterial({ color, fog: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.58, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
    g.add(ring, disc);
    return g;
  }
  set(slot, pos, normal) {
    if (this.meshes[slot]) this.group.remove(this.meshes[slot]);
    const m = this._mesh(slot === 0 ? 0x33aaff : 0xff8c2b);
    m.position.copy(pos).addScaledVector(normal, 0.06);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.quaternion.copy(q);
    this.group.add(m);
    this.meshes[slot] = m;
    this.slots[slot] = { pos: pos.clone(), normal: normal.clone() };
  }
  // Teleport any body (player / mob / bot) whose midsection enters a portal.
  update(dt, bodies) {
    for (const m of this.meshes) if (m) m.rotation.z += dt * 1.5;
    if (!this.slots[0] || !this.slots[1]) return;
    for (const body of bodies) {
      if (!body) continue;
      if (body._portalCD > 0) { body._portalCD -= dt; continue; }
      const fx = body.pos.x, fy = body.pos.y + 0.9, fz = body.pos.z;
      for (let s = 0; s < 2; s++) {
        const p = this.slots[s].pos;
        if ((fx - p.x) ** 2 + (fy - p.y) ** 2 + (fz - p.z) ** 2 < 1.21) {
          const dest = this.slots[1 - s];
          body.pos.set(dest.pos.x + dest.normal.x * 1.2, dest.pos.y - 0.6, dest.pos.z + dest.normal.z * 1.2);
          body._portalCD = 0.7;
          break;
        }
      }
    }
  }

  // Ray vs the portal discs → { dist, exitPos, exitDir } for the nearest one a
  // hitscan shot would pass through, or null. Lets bullets travel through portals.
  rayPortal(origin, dir, maxDist) {
    if (!this.slots[0] || !this.slots[1]) return null;
    let best = null;
    for (let s = 0; s < 2; s++) {
      const P = this.slots[s].pos, N = this.slots[s].normal;
      const denom = dir.dot(N);
      if (Math.abs(denom) < 1e-4) continue;
      const t = (P.x - origin.x) * N.x + (P.y - origin.y) * N.y + (P.z - origin.z) * N.z;
      const tt = t / denom;
      if (tt <= 0.06 || tt >= maxDist) continue;
      const hx = origin.x + dir.x * tt, hy = origin.y + dir.y * tt, hz = origin.z + dir.z * tt;
      if ((hx - P.x) ** 2 + (hy - P.y) ** 2 + (hz - P.z) ** 2 > 0.36) continue;   // within ~0.6 radius
      if (!best || tt < best.dist) best = { dist: tt, s };
    }
    if (!best) return null;
    const dest = this.slots[1 - best.s];
    return { dist: best.dist, exitPos: dest.pos.clone().addScaledVector(dest.normal, 0.35), exitDir: dest.normal.clone() };
  }

  // Redirect a projectile that flies into a portal out of the paired one (keeps
  // speed, reorients along the exit normal). Returns true if teleported.
  redirect(proj) {
    if (!this.slots[0] || !this.slots[1]) return false;
    if (proj._portalCD > 0) { proj._portalCD -= 0.016; return false; }
    for (let s = 0; s < 2; s++) {
      if (proj.pos.distanceToSquared(this.slots[s].pos) < 0.64) {
        const dest = this.slots[1 - s];
        const speed = proj.vel.length();
        proj.pos.copy(dest.pos).addScaledVector(dest.normal, 0.6);
        proj.vel.copy(dest.normal).multiplyScalar(speed);
        proj._portalCD = 0.4;
        return true;
      }
    }
    return false;
  }
}

// ---------------- Muzzle flash ----------------
function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,210,1)');
  grad.addColorStop(0.4, 'rgba(255,200,90,0.7)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class MuzzleFlash {
  constructor(camera) {
    this.spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture(), transparent: true, depthTest: false, opacity: 0, fog: false, blending: THREE.AdditiveBlending,
    }));
    this.spr.scale.setScalar(1.0);
    this.spr.position.set(0.42, -0.42, -1.5);
    this.spr.renderOrder = 1000;
    camera.add(this.spr);
    this.life = 0; this.max = 0.06;
  }
  flash() {
    this.life = this.max;
    this.spr.material.opacity = 1;
    this.spr.material.rotation = Math.random() * 6.28;
    this._base = 1.0 + Math.random() * 0.5;     // size varies per shot
  }
  update(dt) {
    if (this.life > 0) {
      this.life -= dt;
      const k = Math.max(0, this.life / this.max);
      this.spr.material.opacity = k;
      this.spr.scale.setScalar((this._base || 1) * (0.7 + 0.5 * k));
    }
  }
}

// ---------------- Floating damage numbers ----------------
export class DamageNumbers {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; this.cache = new Map(); }
  _tex(text, color) {
    const key = color + text;
    if (this.cache.has(key)) return this.cache.get(key);
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(text, 64, 32);
    g.fillStyle = color; g.fillText(text, 64, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, t); return t;
  }
  spawn(pos, amount, head) {
    const tex = this._tex(head ? `${amount}!` : `${amount}`, head ? '#ffd23a' : '#ffffff');
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    spr.scale.set(head ? 0.9 : 0.7, head ? 0.45 : 0.35, 1);
    spr.position.copy(pos); spr.position.y += 0.4 + Math.random() * 0.3;
    spr.renderOrder = 1001;
    this.group.add(spr);
    this.list.push({ spr, life: 0.9, max: 0.9, vx: (Math.random() - 0.5) * 0.5 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i]; d.life -= dt;
      if (d.life <= 0) { this.group.remove(d.spr); d.spr.material.dispose(); this.list.splice(i, 1); }
      else { d.spr.position.y += dt * 1.1; d.spr.position.x += d.vx * dt; d.spr.material.opacity = Math.min(1, d.life / d.max * 1.5); }
    }
  }
}

// ---------------- First-person viewmodels ----------------
export function makeViewModel(id) {
  const g = new THREE.Group();
  const box = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c, fog: false })); m.position.set(x, y, z); g.add(m); return m; };
  if (id === HANDGUN) {
    box(0.12, 0.12, 0.5, 0x3a3f47, 0, 0, -0.2);
    box(0.1, 0.22, 0.14, 0x2b2f36, 0, -0.16, 0.0);
  } else if (id === SMG) {
    box(0.13, 0.14, 0.55, 0x44464f, 0, 0, -0.22);
    box(0.1, 0.26, 0.12, 0x2c2e35, 0, -0.2, -0.02);   // magazine
    box(0.1, 0.2, 0.14, 0x23252b, 0, -0.15, 0.06);
  } else if (id === ASSAULT_RIFLE) {
    box(0.12, 0.13, 0.8, 0x3a4a36, 0, 0, -0.34);
    box(0.1, 0.3, 0.12, 0x26301f, 0.0, -0.22, -0.08);  // curved mag
    box(0.1, 0.2, 0.14, 0x1f2719, 0, -0.15, 0.06);
    box(0.05, 0.09, 0.12, 0x12160e, 0, 0.11, -0.36);   // sight
  } else if (id === SHOTGUN) {
    box(0.14, 0.14, 0.78, 0x7a7d85, 0, 0.02, -0.32);
    box(0.13, 0.1, 0.34, 0x3a3c42, 0, -0.06, -0.18);   // pump
    box(0.1, 0.18, 0.26, 0x5a3a26, 0, -0.12, 0.12);    // wood stock
  } else if (id === SNIPER) {
    box(0.1, 0.1, 1.1, 0x23262b, 0, 0, -0.5);
    box(0.1, 0.2, 0.16, 0x17191d, 0, -0.15, 0.02);
    box(0.06, 0.06, 0.35, 0x0c0d10, 0, 0, -0.95);    // muzzle/barrel tip
    box(0.13, 0.13, 0.4, 0x111317, 0, 0.16, -0.28);  // scope body
    box(0.04, 0.04, 0.06, 0x2b8cff, 0, 0.16, -0.49); // front lens (blue)
    box(0.16, 0.06, 0.06, 0x17191d, 0, 0.27, -0.28); // scope mount
  } else if (id === RAILGUN) {
    box(0.14, 0.16, 0.95, 0x342b4a, 0, 0, -0.4);
    const rail = box(0.04, 0.04, 0.8, 0x9b6bff, 0, 0.1, -0.34);
    rail.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });
    box(0.1, 0.2, 0.14, 0x231d33, 0, -0.16, 0.04);
    box(0.1, 0.1, 0.16, 0x141021, 0, 0.13, -0.18);    // scope nub
  } else if (id === PLASMA_GUN) {
    box(0.18, 0.18, 0.55, 0x2a6f68, 0, 0, -0.22);
    const tip = box(0.12, 0.12, 0.12, 0x9bfff2, 0, 0, -0.52);
    tip.material = new THREE.MeshBasicMaterial({ color: 0xbafff5, fog: false });
    box(0.1, 0.2, 0.14, 0x1f524d, 0, -0.16, 0.02);
  } else if (id === ROCKET_LAUNCHER) {
    box(0.22, 0.22, 0.95, 0x556b2f, 0, 0, -0.38);
    const warhead = box(0.16, 0.16, 0.18, 0xd23a2a, 0, 0, -0.86);
    warhead.material = new THREE.MeshBasicMaterial({ color: 0xe04a36, fog: false });
    box(0.1, 0.2, 0.14, 0x3f5022, 0, -0.16, 0.06);
  } else { // PORTAL_GUN
    box(0.16, 0.16, 0.5, 0xd6d6d6, 0, 0, -0.2);
    box(0.06, 0.06, 0.12, 0xff8c2b, 0.05, 0, -0.48);
    box(0.06, 0.06, 0.12, 0x2b8cff, -0.05, 0, -0.48);
    box(0.1, 0.2, 0.14, 0xb8b8b8, 0, -0.16, 0.02);
  }
  g.scale.setScalar(1.7);
  g.position.set(0.42, -0.5, -0.85);
  g.rotation.set(0.04, -0.13, 0.0);
  g.traverse((o) => { if (o.isMesh) { o.material.depthTest = false; o.renderOrder = 999; } });
  return g;
}
