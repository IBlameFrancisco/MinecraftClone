// Gun visuals + projectiles: hitscan tracers, plasma bolts, portal-gun portals,
// and simple first-person viewmodels. Firing logic itself lives in main (it has
// the world/mobs/player references); this module owns the effects and portals.

import * as THREE from 'three';
import { HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN, SMG, ASSAULT_RIFLE, SHOTGUN, RAILGUN, ROCKET_LAUNCHER, BLACK_HOLE_BOMB, HEAVY_MG } from './items.js';
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
  update(dt, world, mobs, bots, mp, portals, onImpact) {
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
      if (!hit && bots) {                          // arena bots
        for (const b of bots) {
          if (!b.alive) continue;
          if (Math.hypot(b.pos.x - p.pos.x, b.pos.y + 1 - p.pos.y, b.pos.z - p.pos.z) < 0.9) { hit = true; break; }
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
  update(dt, world, mobs, bots, mp, portals, onImpact) {
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
      if (!hit && bots) {                          // arena bots — detonate on contact
        for (const b of bots) {
          if (!b.alive) continue;
          if (Math.hypot(b.pos.x - p.pos.x, b.pos.y + 1 - p.pos.y, b.pos.z - p.pos.z) < 0.95) { hit = true; break; }
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

// ---------------- Black hole bomb ----------------
// A banded, swirling accretion disk: hot white/orange near the event horizon,
// cooling to violet at the rim. Spinning the mesh makes the bands churn.
function accretionTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S); const d = img.data;
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / cx, th = Math.atan2(dy, dx);
    let a = 0;
    if (r > 0.28 && r < 1.0) {
      const inner = Math.min(1, (r - 0.28) / 0.10);
      const outer = Math.min(1, (1.0 - r) / 0.55);
      const band = 0.45 + 0.55 * Math.pow(Math.max(0, Math.sin(th * 6 + r * 26)), 1.5);  // spiral streaks
      a = inner * outer * band;
    }
    const t = Math.min(1, Math.max(0, (r - 0.28) / 0.72));   // hot -> cool
    const idx = (y * S + x) * 4;
    d[idx] = 255 * (1 - 0.25 * t);
    d[idx + 1] = 220 * (1 - t) + 50 * t;
    d[idx + 2] = 110 * (1 - t) + 255 * t;
    d[idx + 3] = Math.min(255, a * 340);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
// A thin bright ring (the lensed photon ring / Einstein ring) framing the core.
function einsteinRingTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S); const d = img.data;
  const cx = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - cx, y - cx) / cx;
    const a = Math.exp(-((r - 0.84) * (r - 0.84)) / 0.004);   // sharp ring at r~0.84
    const idx = (y * S + x) * 4;
    d[idx] = 255; d[idx + 1] = 226; d[idx + 2] = 180; d[idx + 3] = Math.min(255, a * 255);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

// Lobs a singularity that flies until it hits a block / enemy / its range, then
// anchors and runs an open -> hold -> collapse lifecycle. Damage + the gravity
// pull live in main (it owns the entities); this class owns the animation and
// drives main via hooks (anchorAt / onAnchor / onField / onCollapse).
export class BlackHoles {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group); this.list = [];
    this._diskTex = accretionTexture();
    this._ringTex = einsteinRingTexture();
  }
  spawn(pos, dir, gun, ownerId) {
    const g = new THREE.Group(); g.position.copy(pos); g.scale.setScalar(0.45);
    const add = (m) => { g.add(m); return m; };
    const core = add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    const glow = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x7b3ff2, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    glow.scale.setScalar(7);
    const disk = add(new THREE.Mesh(new THREE.CircleGeometry(4.6, 64), new THREE.MeshBasicMaterial({ map: this._diskTex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    disk.rotation.x = -1.18;
    const disk2 = add(new THREE.Mesh(new THREE.CircleGeometry(3.3, 56), new THREE.MeshBasicMaterial({ map: this._diskTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    disk2.rotation.set(-1.18, 0.6, 0.4);
    const ring = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: this._ringTex, color: 0xffe2b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false })));
    ring.scale.setScalar(4.3); ring.renderOrder = 1000;
    const shock = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: this._ringTex, color: 0xb98bff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false })));
    shock.renderOrder = 1001;
    const parts = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffd0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      g.add(s); parts.push({ s, ang: Math.random() * 6.28, rad: 2 + Math.random() * 2.6, y: (Math.random() - 0.5) * 1.4, spd: 1.6 + Math.random() * 1.8, fall: 0.6 + Math.random() * 0.9 });
    }
    for (const o of [disk, disk2, ring, shock, ...parts.map((p) => p.s)]) o.visible = false;  // fly = just the orb
    this.group.add(g);
    this.list.push({ phase: 'fly', pos: pos.clone(), vel: dir.clone().normalize().multiplyScalar(gun.speed),
      gun, ownerId, t: 0, travelled: 0, c: 0, g, core, glow, disk, disk2, ring, shock, parts });
  }
  _dispose(h) { this.group.remove(h.g); h.g.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); }); }
  update(dt, world, hooks) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i], gun = h.gun;
      if (h.phase === 'fly') {
        const step = h.vel.clone().multiplyScalar(dt); h.pos.add(step); h.travelled += step.length();
        h.g.position.copy(h.pos);
        h.g.rotation.y += dt * 6; h.glow.material.opacity = 0.7 + 0.3 * Math.sin(h.t * 20); h.t += dt;
        const solid = isSolid(world.getBlock(Math.floor(h.pos.x), Math.floor(h.pos.y), Math.floor(h.pos.z)));
        if (solid || h.travelled > gun.range || (hooks.anchorAt && hooks.anchorAt(h.pos))) {
          h.phase = 'open'; h.t = 0; h.g.rotation.set(0, 0, 0);
          for (const o of [h.disk, h.disk2, h.ring, h.shock, ...h.parts.map((p) => p.s)]) o.visible = true;
          if (hooks.onAnchor) hooks.onAnchor(h.pos.clone());
        }
        continue;
      }
      h.t += dt;
      let s = 1;
      if (h.phase === 'open') { s = easeOutBack(Math.min(1, h.t / 0.45)) * 1.0; if (h.t >= 0.45) h.phase = 'hold'; }
      else if (h.phase === 'hold') { s = 1 + 0.04 * Math.sin(h.t * 8); if (h.t >= gun.duration - 0.5) { h.phase = 'collapse'; h.c = 0; } }
      else { h.c += dt; const k = Math.min(1, h.c / 0.5); s = (1 - k) * (1 - k) * (1 + 0.6 * Math.sin(k * 30));
        if (h.c >= 0.5) { if (hooks.onCollapse) hooks.onCollapse(h.pos.clone(), gun); this._dispose(h); this.list.splice(i, 1); continue; } }
      h.g.scale.setScalar(Math.max(0.001, s));
      h.disk.rotation.z += dt * 2.6; h.disk2.rotation.z -= dt * 3.4;
      h.ring.material.rotation += dt * 0.6;
      const pulse = 0.9 + 0.1 * Math.sin(h.t * 7);
      h.ring.material.opacity = pulse; h.glow.material.opacity = 0.85 * pulse;
      if (h.t < 0.6 && h.phase !== 'collapse') { const k = Math.min(1, h.t / 0.55); h.shock.scale.setScalar(2 + k * 11); h.shock.material.opacity = (1 - k) * 0.7; }
      else h.shock.material.opacity = 0;
      for (const p of h.parts) {
        p.ang += p.spd * dt; p.rad -= p.fall * dt;
        if (p.rad < 0.25) { p.rad = 2.4 + Math.random() * 2.4; p.y = (Math.random() - 0.5) * 1.6; }
        p.s.position.set(Math.cos(p.ang) * p.rad, p.y * Math.min(1, p.rad / 1.6), Math.sin(p.ang) * p.rad);
        const cl = Math.min(1, p.rad / 4);
        p.s.material.color.setRGB(1, 0.45 + 0.45 * cl, 0.3 + 0.6 * cl);
        p.s.scale.setScalar(0.22 + (1 - cl) * 0.4);
        p.s.material.opacity = 0.75;
      }
      if (hooks.onField) hooks.onField(h.pos, dt, gun, h.phase);
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
  } else if (id === HEAVY_MG) {
    box(0.14, 0.14, 0.95, 0x2b2b2f, 0, 0, -0.4);           // long receiver
    box(0.17, 0.17, 0.3, 0x46484e, 0, 0, -0.82);           // barrel shroud
    box(0.1, 0.22, 0.14, 0x23252b, 0, -0.16, 0.04);        // grip
    box(0.16, 0.1, 0.18, 0x6a4a2a, 0, -0.04, 0.18);        // wooden stock
    box(0.05, 0.05, 0.5, 0x1c1c20, 0.12, 0.06, -0.4); box(0.05, 0.05, 0.5, 0x1c1c20, -0.12, 0.06, -0.4);  // bipod-ish rails
  } else if (id === BLACK_HOLE_BOMB) {
    box(0.22, 0.22, 0.62, 0x241a33, 0, 0, -0.26);          // dark body
    box(0.27, 0.27, 0.16, 0x140d1f, 0, 0, -0.54);          // muzzle housing
    const orb = box(0.16, 0.16, 0.16, 0x000000, 0, 0, -0.6); orb.material = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }); // void orb
    const e1 = box(0.04, 0.04, 0.5, 0x9b6bff, 0.12, 0.07, -0.26); e1.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });
    const e2 = box(0.04, 0.04, 0.5, 0x9b6bff, -0.12, 0.07, -0.26); e2.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });
    box(0.1, 0.2, 0.14, 0x1c1430, 0, -0.16, 0.04);         // grip
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
