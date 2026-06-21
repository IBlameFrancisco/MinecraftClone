// Gun visuals + projectiles: hitscan tracers, plasma bolts, portal-gun portals,
// and simple first-person viewmodels. Firing logic itself lives in main (it has
// the world/mobs/player references); this module owns the effects and portals.

import * as THREE from 'three';
import { HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN } from './items.js';
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
  update(dt, world, mobs, mp, onImpact) {
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
  update(dt, player) {
    this.cooldown -= dt;
    for (const m of this.meshes) if (m) m.rotation.z += dt * 1.5;
    if (this.cooldown > 0 || !this.slots[0] || !this.slots[1]) return;
    const feet = new THREE.Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z);
    for (let s = 0; s < 2; s++) {
      if (feet.distanceTo(this.slots[s].pos) < 1.1) {
        const dest = this.slots[1 - s];
        player.pos.set(dest.pos.x + dest.normal.x * 1.2, dest.pos.y - 0.6, dest.pos.z + dest.normal.z * 1.2);
        this.cooldown = 0.7;
        return;
      }
    }
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

// ---------------- First-person viewmodels ----------------
export function makeViewModel(id) {
  const g = new THREE.Group();
  const box = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c, fog: false })); m.position.set(x, y, z); g.add(m); return m; };
  if (id === HANDGUN) {
    box(0.12, 0.12, 0.5, 0x3a3f47, 0, 0, -0.2);
    box(0.1, 0.22, 0.14, 0x2b2f36, 0, -0.16, 0.0);
  } else if (id === SNIPER) {
    box(0.1, 0.1, 1.1, 0x23262b, 0, 0, -0.5);
    box(0.1, 0.2, 0.16, 0x17191d, 0, -0.15, 0.02);
    box(0.06, 0.06, 0.35, 0x0c0d10, 0, 0, -0.95);    // muzzle/barrel tip
    box(0.13, 0.13, 0.4, 0x111317, 0, 0.16, -0.28);  // scope body
    box(0.04, 0.04, 0.06, 0x2b8cff, 0, 0.16, -0.49); // front lens (blue)
    box(0.16, 0.06, 0.06, 0x17191d, 0, 0.27, -0.28); // scope mount
  } else if (id === PLASMA_GUN) {
    box(0.18, 0.18, 0.55, 0x2a6f68, 0, 0, -0.22);
    const tip = box(0.12, 0.12, 0.12, 0x9bfff2, 0, 0, -0.52);
    tip.material = new THREE.MeshBasicMaterial({ color: 0xbafff5, fog: false });
    box(0.1, 0.2, 0.14, 0x1f524d, 0, -0.16, 0.02);
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
