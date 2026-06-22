// Gun visuals + projectiles: hitscan tracers, plasma bolts, portal-gun portals,
// and simple first-person viewmodels. Firing logic itself lives in main (it has
// the world/mobs/player references); this module owns the effects and portals.

import * as THREE from 'three';
import { HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN, SMG, ASSAULT_RIFLE, SHOTGUN, RAILGUN, ROCKET_LAUNCHER, BLACK_HOLE_BOMB, HEAVY_MG, RASENGAN, RASENSHURIKEN, LASER_CANNON, HOLLOW_PURPLE, SHARINGAN } from './items.js';
import { isSolid } from './blocks.js';

// A soft white radial sprite texture, tinted per-use for additive glows. A tight,
// bright center falling to a smooth wide skirt reads cleanly under bloom without
// a hard edge.
function softGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW_TEX = softGlowTexture();

// A quick visual-only burst (no damage) — used when replaying another player's
// projectiles in co-op. Self-animates via rAF so it needs no manager update loop.
function ghostBurst(group, pos, color = 0xffd27a) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.position.copy(pos); s.scale.setScalar(0.5); group.add(s);
  const t0 = performance.now();
  const tick = () => {
    const k = (performance.now() - t0) / 350;
    if (k >= 1) { group.remove(s); s.material.dispose(); return; }
    const ease = 1 - (1 - k) * (1 - k);                 // ease-out expansion
    s.scale.setScalar(0.5 + ease * 2.6); s.material.opacity = (1 - k) * (1 - k);
    s.material.rotation += 0.12;
    requestAnimationFrame(tick);
  };
  tick();
}

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
      new THREE.CylinderGeometry(0.028, 0.028, len, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, len, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, glow);
    g.position.copy(start).add(end).multiplyScalar(0.5);
    g.quaternion.copy(q);
    g.renderOrder = 998;
    this.group.add(g);
    // A travelling spark at the leading edge sells the "bullet".
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    spark.scale.setScalar(0.55); spark.position.copy(end);
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
        const k2 = k * k;                         // sharper fall-off so streaks snap out
        t.core.material.opacity = k;
        t.glow.material.opacity = 0.5 * k2;
        const s = 0.35 + 0.65 * k; t.g.scale.set(s, 1, s);   // thin out as it fades
        t.spark.material.opacity = k;
        t.spark.scale.setScalar(0.55 * k + 0.08);
      }
    }
  }
}

// ---------------- Plasma bolts ----------------
// A glowing energy ball: solid core + pulsing additive halo, leaving a brief
// fading trail. Damages mobs and (in co-op) remote players, directly or by splash.
export class Plasmas {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; this.trail = []; }
  spawn(pos, dir, speed, damage, range, ghost) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xf2fffd, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x3affd0, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x52ffd8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.setScalar(1.3);
    g.add(shell, core, halo);
    g.position.copy(pos);
    this.group.add(g);
    this.list.push({ m: g, halo, vel: dir.clone().multiplyScalar(speed), pos: pos.clone(), damage, range, travelled: 0, t: 0, ghost });
  }
  _spawnTrail(pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x44e8c8, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(0.55); s.position.copy(pos);
    this.group.add(s); this.trail.push({ s, life: 0.28, max: 0.28 });
  }
  update(dt, world, mobs, bots, mp, portals, onImpact) {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const tr = this.trail[i]; tr.life -= dt;
      if (tr.life <= 0) { this.group.remove(tr.s); tr.s.material.dispose(); this.trail.splice(i, 1); }
      else {
        const k = tr.life / tr.max;
        tr.s.material.opacity = 0.55 * k * k;            // fade fast so the trail stays a tight wake
        tr.s.scale.setScalar(0.55 * k + 0.06);
        tr.s.material.color.setRGB(0.27 * k, 0.91, 0.78 + 0.12 * (1 - k));  // cool toward white as it fades
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.halo.scale.setScalar(1.2 + Math.sin(p.t * 34) * 0.22);
      const step = p.vel.clone().multiplyScalar(dt);
      p.pos.add(step); p.travelled += step.length();
      if (portals) portals.redirect(p, dt);      // fly through portals
      p.m.position.copy(p.pos);
      this._spawnTrail(p.pos);
      let hit = p.travelled > p.range || isSolid(world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)));
      let hitPlayer = null;
      if (!hit && !p.ghost) {                      // ghosts (replicated remote shots) hit only blocks/range — never damage
        for (const mob of mobs.list) {
          if (Math.hypot(mob.pos.x - p.pos.x, mob.pos.y + mob.height * 0.5 - p.pos.y, mob.pos.z - p.pos.z) < 0.9) { hit = true; break; }
        }
        if (!hit && bots) {                        // arena bots
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
      }
      if (hit) {
        if (p.ghost) ghostBurst(this.group, p.pos, 0x52ffd8); else onImpact(p.pos.clone(), p.damage, hitPlayer);
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
  spawn(pos, dir, gun, ownerId, ghost) {
    const g = new THREE.Group();
    const nd = dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nd);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.32, 10),
      new THREE.MeshBasicMaterial({ color: 0x46474c, fog: false }));
    body.quaternion.copy(q);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 10),
      new THREE.MeshBasicMaterial({ color: 0xd23a2a, fog: false }));
    head.position.copy(nd).multiplyScalar(0.24);
    head.quaternion.copy(q);
    // Exhaust glow at the tail so the missile reads as thrusting.
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    flame.scale.setScalar(0.5); flame.position.copy(nd).multiplyScalar(-0.22);
    g.add(body, head, flame);
    g.position.copy(pos);
    this.group.add(g);
    this.list.push({ m: g, flame, vel: dir.clone().multiplyScalar(gun.speed), pos: pos.clone(), gun, ownerId, travelled: 0, t: 0, ghost });
  }
  _puff(pos, hot) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: hot ? 0xffb05a : 0x9a9088, transparent: true, opacity: hot ? 0.7 : 0.4, blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(hot ? 0.34 : 0.46); s.position.copy(pos);
    s.material.rotation = Math.random() * 6.28;
    this.group.add(s); this.trail.push({ s, life: 0.34, max: 0.34, hot });
  }
  update(dt, world, mobs, bots, mp, portals, onImpact) {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const tr = this.trail[i]; tr.life -= dt;
      if (tr.life <= 0) { this.group.remove(tr.s); tr.s.material.dispose(); this.trail.splice(i, 1); }
      else {
        const k = tr.life / tr.max;
        if (tr.hot) { tr.s.material.opacity = 0.7 * k; tr.s.scale.setScalar(0.34 + (1 - k) * 0.2); }
        else { tr.s.material.opacity = 0.4 * k; tr.s.scale.setScalar(0.46 + (1 - k) * 0.7); tr.s.material.rotation += dt * 0.8; }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t = (p.t || 0) + dt;
      if (p.flame) p.flame.scale.setScalar(0.42 + Math.abs(Math.sin(p.t * 60)) * 0.22);
      const step = p.vel.clone().multiplyScalar(dt);
      p.pos.add(step); p.travelled += step.length();
      if (portals) portals.redirect(p, dt);      // fly through portals
      p.m.position.copy(p.pos);
      this._puff(p.pos, true);                    // bright fire core...
      this._puff(p.pos, false);                   // ...wrapped in lingering smoke
      let hit = p.travelled > p.gun.range || isSolid(world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)));
      if (!hit && !p.ghost) {                      // ghosts (replicated remote shots) hit only blocks/range
        for (const mob of mobs.list) {
          if (Math.hypot(mob.pos.x - p.pos.x, mob.pos.y + mob.height * 0.5 - p.pos.y, mob.pos.z - p.pos.z) < 0.9) { hit = true; break; }
        }
        if (!hit && bots) {                        // arena bots — detonate on contact
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
      }
      if (hit) {
        if (p.ghost) ghostBurst(this.group, p.pos, 0xffa84a); else onImpact(p.pos.clone(), p.gun, p.ownerId);
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
  spawn(pos, vel, fuse, onExplode, ghost) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0x39402c, emissive: 0x0a0c06 }));
    m.position.copy(pos);
    // A little metal cap + spoon so the frag reads as ordnance, and a blinking fuse
    // glow that quickens as the timer runs down (parented to the body so it tumbles).
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8), new THREE.MeshLambertMaterial({ color: 0x6a6f5a }));
    cap.position.y = 0.12; m.add(cap);
    const fuseGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff5a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    fuseGlow.scale.setScalar(0.22); fuseGlow.position.y = 0.16; m.add(fuseGlow);
    this.group.add(m);
    this.list.push({ m, cap, fuseGlow, pos: pos.clone(), vel: vel.clone(), fuse, fuse0: Math.max(0.01, fuse), onExplode, ghost, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
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
      g.m.rotation.x += g.spin.x * dt; g.m.rotation.y += g.spin.y * dt; g.m.rotation.z += g.spin.z * dt;  // tumble on all axes
      if (g.fuseGlow) {                       // blink faster and hotter as the fuse runs out
        const left = Math.max(0, g.fuse / g.fuse0);
        const rate = 6 + (1 - left) * 26;
        g.fuseGlow.material.opacity = (0.4 + 0.6 * (1 - left)) * (0.5 + 0.5 * Math.sin(performance.now() * 0.001 * rate));
        g.fuseGlow.scale.setScalar(0.2 + (1 - left) * 0.16);
      }
      if (g.fuse <= 0) {
        if (g.ghost) ghostBurst(this.group, g.pos, 0xffa84a); else g.onExplode(g.pos.clone());
        this.group.remove(g.m);
        g.m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.list.splice(i, 1);
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
      const inner = Math.min(1, (r - 0.28) / 0.08);
      const outer = Math.min(1, (1.0 - r) / 0.5);
      // Two interleaved spiral arms at different pitches give a denser, churned disk.
      const s1 = Math.pow(Math.max(0, Math.sin(th * 7 + r * 30)), 1.6);
      const s2 = Math.pow(Math.max(0, Math.sin(th * 4 - r * 18 + 1.0)), 2.0);
      const band = 0.35 + 0.5 * s1 + 0.25 * s2;
      a = inner * outer * band;
    }
    const t = Math.min(1, Math.max(0, (r - 0.28) / 0.72));   // hot -> cool
    const t2 = t * t;
    const idx = (y * S + x) * 4;
    d[idx] = 255 * (1 - 0.18 * t);
    d[idx + 1] = 230 * (1 - t2) + 60 * t2;
    d[idx + 2] = 90 * (1 - t) + 255 * t;
    d[idx + 3] = Math.min(255, a * 360);
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
  spawn(pos, dir, gun, ownerId, ghost) {
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
      gun, ownerId, ghost, t: 0, travelled: 0, c: 0, g, core, glow, disk, disk2, ring, shock, parts });
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
        if (solid || h.travelled > gun.range || (!h.ghost && hooks.anchorAt && hooks.anchorAt(h.pos))) {
          h.phase = 'open'; h.t = 0; h.g.rotation.set(0, 0, 0);
          for (const o of [h.disk, h.disk2, h.ring, h.shock, ...h.parts.map((p) => p.s)]) o.visible = true;
          if (!h.ghost && hooks.onAnchor) hooks.onAnchor(h.pos.clone());
        }
        continue;
      }
      h.t += dt;
      let s = 1;
      if (h.phase === 'open') { s = easeOutBack(Math.min(1, h.t / 0.45)) * 1.0; if (h.t >= 0.45) h.phase = 'hold'; }
      else if (h.phase === 'hold') { s = 1 + 0.04 * Math.sin(h.t * 8); if (h.t >= gun.duration - 0.5) { h.phase = 'collapse'; h.c = 0; } }
      else { h.c += dt; const k = Math.min(1, h.c / 0.5); s = (1 - k) * (1 - k) * (1 + 0.6 * Math.sin(k * 30));
        if (h.c >= 0.5) { if (!h.ghost && hooks.onCollapse) hooks.onCollapse(h.pos.clone(), gun); this._dispose(h); this.list.splice(i, 1); continue; } }
      h.g.scale.setScalar(Math.max(0.001, s));
      h.disk.rotation.z += dt * 2.6; h.disk2.rotation.z -= dt * 3.4;
      h.disk2.rotation.x = -1.18 + 0.08 * Math.sin(h.t * 3);   // slight precession for depth
      h.ring.material.rotation += dt * 0.6;
      const pulse = 0.9 + 0.1 * Math.sin(h.t * 7);
      h.ring.material.opacity = pulse;
      h.glow.material.opacity = 0.85 * pulse;
      h.glow.scale.setScalar(7 * (0.96 + 0.04 * Math.sin(h.t * 5)));   // breathing event-horizon halo
      if (h.t < 0.6 && h.phase !== 'collapse') { const k = Math.min(1, h.t / 0.55); h.shock.scale.setScalar(2 + k * 11); h.shock.material.opacity = (1 - k) * 0.7; }
      else h.shock.material.opacity = 0;
      for (const p of h.parts) {
        p.ang += p.spd * dt * (1 + (1 - Math.min(1, p.rad / 4)) * 1.5);   // speed up as they spiral in
        p.rad -= p.fall * dt;
        if (p.rad < 0.25) { p.rad = 2.4 + Math.random() * 2.4; p.y = (Math.random() - 0.5) * 1.6; }
        p.s.position.set(Math.cos(p.ang) * p.rad, p.y * Math.min(1, p.rad / 1.6), Math.sin(p.ang) * p.rad);
        const cl = Math.min(1, p.rad / 4);                                // hot (white) near core -> cool (violet) at rim
        p.s.material.color.setRGB(1, 0.4 + 0.5 * cl, 0.28 + 0.62 * cl);
        p.s.scale.setScalar(0.18 + (1 - cl) * 0.5);                       // brighter + larger as they fall in
        p.s.material.opacity = 0.55 + 0.35 * (1 - cl);
      }
      if (!h.ghost && hooks.onField) hooks.onField(h.pos, dt, gun, h.phase);
    }
  }
}

// ---------------- Chakra jutsu (Rasengan / Rasenshuriken) ----------------
// A 4-bladed pinwheel shuriken on transparent — the spinning chakra disc.
function shurikenTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.translate(S / 2, S / 2);
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    const grad = g.createLinearGradient(0, 0, S * 0.5, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.98)'); grad.addColorStop(0.5, 'rgba(170,225,255,0.9)'); grad.addColorStop(0.85, 'rgba(120,205,255,0.35)'); grad.addColorStop(1, 'rgba(110,200,255,0)');
    g.fillStyle = grad;
    // Swept, hooked blade with a keen trailing edge — reads as a fan blade in spin.
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(S * 0.28, -S * 0.2, S * 0.5, -S * 0.02); g.quadraticCurveTo(S * 0.32, S * 0.07, 0, 0); g.fill();
  }
  const cg = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.2); cg.addColorStop(0, '#fff'); cg.addColorStop(0.55, 'rgba(200,235,255,0.85)'); cg.addColorStop(1, 'rgba(140,210,255,0)');
  g.fillStyle = cg; g.beginPath(); g.arc(0, 0, S * 0.2, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const SHURIKEN_TEX = shurikenTexture();

// Rasengan + Rasenshuriken effects: the flying shuriken projectile, plus transient
// chakra bursts (the Rasengan grind-flash and the Rasenshuriken wind-blade dome).
export class ChakraFx {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group); this.proj = []; this.fx = []; this.grinds = [];
    // Scratch vectors for the projectile steering/physics (avoid per-frame allocation).
    this._cur = new THREE.Vector3(); this._sub = new THREE.Vector3();
    this._vh = new THREE.Vector3(); this._axle = new THREE.Vector3(); this._UP = new THREE.Vector3(0, 1, 0);
  }

  // Throw a spinning Rasenshuriken; on impact it detonates the dome and calls onImpact.
  // It flies as the charged buzzsaw — a flat saw blade on a (near-)vertical axle,
  // banked back toward the thrower so the spinning face stays readable in flight.
  throw(pos, dir, gun, ownerId, onImpact, guided = true) {
    const g = new THREE.Group(); g.position.copy(pos);
    const d = dir.clone().normalize();
    const dirH = new THREE.Vector3(d.x, 0, d.z); if (dirH.lengthSq() < 1e-4) dirH.set(0, 0, -1); dirH.normalize();
    const axle = new THREE.Vector3(0, 0.82, 0).addScaledVector(dirH, -0.5).normalize();   // up, tilted back at the thrower
    const pivot = new THREE.Group(); pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axle); g.add(pivot);
    const spinner = new THREE.Group(); pivot.add(spinner);                                // spins about the vertical axle
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: SHURIKEN_TEX, color: 0xbfe9ff, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const rim2 = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.018, 6, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    disc.rotation.x = -Math.PI / 2; rim.rotation.x = -Math.PI / 2; rim2.rotation.x = -Math.PI / 2;   // lay the saw flat under the axle
    spinner.add(disc, rim, rim2);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x8fd6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); glow.scale.setScalar(2.8);
    g.add(core, glow);
    this.group.add(g);
    const speed = gun.speed;
    this.proj.push({ g, pivot, spinner, pos: pos.clone(), vel: d.multiplyScalar(speed), gun, ownerId, onImpact, travelled: 0,
      guided, turn: 3.6, gravity: 4, cruise: speed, maxSpeed: speed * 1.25 });
  }

  // ---- Chakra charge aura (the Naruto power-up) ----
  // A ring of chakra streaking upward around the channeler, with rising rings and
  // a pulsing ground ring. Built lazily; driven each frame by updateAura().
  _ensureAura() {
    if (this.aura) return this.aura;
    const g = new THREE.Group(); g.visible = false; this.group.add(g);
    const ground = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    ground.rotation.x = -Math.PI / 2; g.add(ground);
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.045, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0x9ad8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      r.rotation.x = -Math.PI / 2; g.add(r); rings.push({ mesh: r, p: i / 3 });
    }
    const streaks = []; const N = 18;
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x8fd0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      g.add(s); streaks.push({ spr: s, ang: (i / N) * 6.2832, p: Math.random(), rad: 0.7 + Math.random() * 0.5, speed: 0.8 + Math.random() * 0.7 });
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.55, 2.7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    col.position.y = 1.35; g.add(col);
    this.aura = { g, ground, rings, streaks, col, t: 0 };
    return this.aura;
  }

  // Position + animate the aura at `pos` (feet) scaled by `intensity` (0 hides it).
  updateAura(pos, intensity, dt) {
    if (intensity <= 0.001) { if (this.aura) this.aura.g.visible = false; return; }
    const a = this._ensureAura(); a.g.visible = true; a.t += dt;
    a.g.position.set(pos.x, pos.y, pos.z);
    const I = Math.min(1, intensity);
    a.ground.scale.setScalar((1.0 + 0.15 * Math.sin(a.t * 10)) * (0.7 + 0.5 * I));
    a.ground.material.opacity = 0.3 + 0.5 * I; a.ground.rotation.z += dt * 2;
    for (const r of a.rings) {
      r.p += dt * (0.5 + 0.9 * I); if (r.p >= 1) r.p -= 1;
      r.mesh.position.y = r.p * 2.7;
      r.mesh.scale.setScalar((0.6 + 0.8 * r.p) * (0.7 + 0.4 * I));
      r.mesh.material.opacity = 0.5 * I * Math.sin(r.p * Math.PI);
    }
    for (const s of a.streaks) {
      s.p += dt * s.speed * (0.6 + 1.3 * I); if (s.p >= 1) s.p -= 1;
      const rad = s.rad * (1 - 0.4 * s.p);
      s.spr.position.set(Math.cos(s.ang) * rad, s.p * 2.85, Math.sin(s.ang) * rad);
      s.spr.scale.setScalar(0.12 + 0.13 * I);
      s.spr.material.opacity = (0.2 + 0.75 * I) * Math.sin(s.p * Math.PI);
    }
    a.col.material.opacity = 0.1 * I;
    a.col.scale.set(1 + 0.1 * Math.sin(a.t * 8), 1, 1 + 0.1 * Math.cos(a.t * 8));
  }

  // The Rasengan GRIND: a fast-spinning orb that drills into the foe at `pos` along
  // `dir` for `dur` seconds (buzzsaw blades + a sparking spiral boring in), then blasts
  // them with a final burst. This is the "ground into them at point-blank" moment.
  grind(pos, dir, color, dur, scale) {
    const sc = scale || 1;
    const g = new THREE.Group(); g.position.copy(pos);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());   // local +z = drill axis
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.4 * sc, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.64 * sc, 18, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const blades = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05 * sc, 1.6 * sc, 0.02),
        new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      b.rotation.z = (i / 7) * Math.PI * 2; blades.add(b);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(2.4 * sc);
    const sparks = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xdff2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.scale.setScalar(0.32 * sc); g.add(s);
      sparks.push({ s, ang: Math.random() * 6.2832, rad: (0.55 + Math.random() * 0.25) * sc, spd: 14 + Math.random() * 12 });
    }
    g.add(shell, blades, core, glow);
    this.group.add(g);
    this.grinds.push({ g, core, shell, blades, glow, sparks, t: 0, dur: dur || 0.34, color, sc, dir: dir.clone().normalize() });
  }

  // A chakra burst: an expanding additive sphere; `needles` adds the radiating
  // wind-blade urchin of the Rasenshuriken dome.
  burst(pos, radius, color, needles) {
    const g = new THREE.Group(); g.position.copy(pos);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); flash.scale.setScalar(radius * 0.7);
    g.add(dome, flash);
    let lines = null;
    if (needles) {
      // Razor wind-blades radiating from a thin inner shell to varied lengths — the
      // Rasenshuriken's countless cutting needles.
      const N = 120, arr = new Float32Array(N * 6);
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        const len = 0.85 + Math.random() * 0.4;
        arr.set([v.x * 0.2, v.y * 0.2, v.z * 0.2, v.x * len, v.y * len, v.z * len], i * 6);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xeafaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      g.add(lines);
    }
    this.group.add(g);
    this.fx.push({ g, dome, flash, lines, t: 0, max: needles ? 0.75 : 0.35, radius });
  }

  update(dt, world, hooks) {
    const guide = hooks && hooks.guideDir;            // unit dir to steer toward (the thrower's aim), or null
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      // ---- Projectile physics: steer toward the thrower's aim (limited turn rate,
      // so you curve it by sweeping your view), then fall under gravity, speed-capped. ----
      if (p.guided && guide) {
        const speed = p.vel.length() || 0.001;
        this._cur.copy(p.vel).multiplyScalar(1 / speed);
        const dot = Math.max(-1, Math.min(1, this._cur.dot(guide)));
        const ang = Math.acos(dot);
        if (ang > 1e-3) {
          const tt = Math.min(1, (p.turn * dt) / ang);
          this._cur.lerp(guide, tt).normalize();        // rotate heading toward the aim (approx slerp)
          p.vel.copy(this._cur).multiplyScalar(speed);
        }
      }
      p.vel.y -= p.gravity * dt;
      const sp = p.vel.length();
      if (sp > p.maxSpeed) p.vel.multiplyScalar(p.maxSpeed / sp);

      // Sub-stepped march so a fast, curving blade can't tunnel through a wall.
      const moveLen = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(moveLen / 0.4));
      this._sub.copy(p.vel).multiplyScalar(dt / steps);
      let hit = false;
      for (let s = 0; s < steps; s++) {
        p.pos.add(this._sub); p.travelled += this._sub.length();
        if (isSolid(world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)))
            || p.travelled > p.gun.range
            || (hooks && hooks.anchorAt && hooks.anchorAt(p.pos))) { hit = true; break; }
      }
      if (hit) {
        this.burst(p.pos.clone(), p.gun.radius, 0xbfe9ff, true);
        if (p.onImpact) p.onImpact(p.pos.clone(), p.gun);
        this._dispose(this.group, p.g); this.proj.splice(i, 1);
        continue;
      }
      p.g.position.copy(p.pos);
      // Re-bank the buzzsaw toward its current heading so it stays readable as it curves.
      this._vh.set(p.vel.x, 0, p.vel.z);
      if (this._vh.lengthSq() > 1e-4) {
        this._vh.normalize();
        this._axle.set(0, 0.82, 0).addScaledVector(this._vh, -0.5).normalize();
        p.pivot.quaternion.setFromUnitVectors(this._UP, this._axle);
      }
      p.spinner.rotation.y -= dt * 34;                  // clockwise buzzsaw about the vertical axle
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t += dt; const k = Math.min(1, f.t / f.max);
      const ex = 1 - Math.pow(1 - Math.min(1, k * 1.7), 3);      // expand fast, ease out
      f.g.scale.setScalar(Math.max(0.01, f.radius * ex));
      f.dome.material.opacity = 0.5 * (1 - k);
      f.flash.material.opacity = Math.max(0, 1 - k * 3);
      if (f.lines) f.lines.material.opacity = 0.9 * (1 - k * k);
      f.g.rotation.y += dt * 2.2; f.g.rotation.x += dt * 1.4;
      if (f.t >= f.max) { this._dispose(this.group, f.g); this.fx.splice(i, 1); }
    }
    for (let i = this.grinds.length - 1; i >= 0; i--) {
      const gr = this.grinds[i]; gr.t += dt; const k = Math.min(1, gr.t / gr.dur);
      gr.blades.rotation.z -= dt * 70;                                  // screaming buzzsaw spin
      const pulse = 1 + 0.14 * Math.sin(gr.t * 55);
      gr.core.scale.setScalar(pulse);
      gr.shell.scale.setScalar(pulse * (1 + 0.18 * Math.sin(gr.t * 37)));
      gr.glow.material.opacity = 0.55 + 0.35 * Math.abs(Math.sin(gr.t * 44));
      gr.g.position.addScaledVector(gr.dir, dt * 1.4);                  // bore forward into them
      for (const sp of gr.sparks) {                                    // sparks spiralling off the drill
        sp.ang += sp.spd * dt;
        sp.s.position.set(Math.cos(sp.ang) * sp.rad, Math.sin(sp.ang) * sp.rad, -gr.t * 2.2);
        sp.s.material.opacity = 0.85 * (1 - k);
      }
      if (gr.t >= gr.dur) {                                            // final blast
        this.burst(gr.g.getWorldPosition(this._gw || (this._gw = new THREE.Vector3())).clone(), 1.5 * gr.sc, gr.color, false);
        this._dispose(this.group, gr.g); this.grinds.splice(i, 1);
      }
    }
  }
  _dispose(parent, g) { parent.remove(g); g.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); }); }
}

// ---------------- Laser cannon (continuous beam) ----------------
// One persistent beam the holder sustains while firing: a white-hot core inside a
// coloured glow + soft outer shell, with a pulsing muzzle flare and impact burst.
export class LaserBeam {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    const cyl = (r, c, o) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam = new THREE.Group();
    this.core = cyl(0.06, 0xffffff, 1);
    this.glow = cyl(0.2, 0xff2e54, 0.75);
    this.outer = cyl(0.46, 0xff5570, 0.24);
    this.beam.add(this.outer, this.glow, this.core);
    this.beam.renderOrder = 999;
    const sprite = (c) => new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.impact = sprite(0xff5570);
    this.flare = sprite(0xffd0d8);
    this.group.add(this.beam, this.impact, this.flare);
    this.group.visible = false; this.t = 0;
    this._up = new THREE.Vector3(0, 1, 0); this._q = new THREE.Quaternion();
  }
  set(active, start, end, color) {
    this.group.visible = !!active;
    if (!active) return;
    const dir = end.clone().sub(start), len = Math.max(0.1, dir.length());
    this._q.setFromUnitVectors(this._up, dir.normalize());
    this.beam.position.copy(start).add(end).multiplyScalar(0.5);
    this.beam.quaternion.copy(this._q);
    this.beam.scale.y = len;
    this.impact.position.copy(end);
    this.flare.position.copy(start);
    if (color != null) { this.glow.material.color.setHex(color); this.outer.material.color.setHex(color); this.impact.material.color.setHex(color); }
  }
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const p = 1 + Math.sin(this.t * 55) * 0.22;
    this.core.scale.set(p, 1, p);
    const gp = 1 + Math.sin(this.t * 33) * 0.3; this.glow.scale.set(gp, 1, gp);
    this.outer.material.opacity = 0.14 + Math.abs(Math.sin(this.t * 20)) * 0.14;
    this.outer.scale.set(1 + 0.08 * Math.sin(this.t * 12), 1, 1 + 0.08 * Math.sin(this.t * 12));
    this.impact.scale.setScalar(1.4 + Math.sin(this.t * 46) * 0.4);
    this.impact.material.rotation += dt * 4;          // shimmer at the burn point
    this.flare.scale.setScalar(0.9 + Math.sin(this.t * 70) * 0.25);
    this.flare.material.rotation -= dt * 6;
  }
}

// ---------------- Hollow Purple (Gojo) ----------------
// The clap of limitless red + blue: a wide imaginary-mass corridor erased in a
// single purple blast. A transient expanding beam with red/blue fringes, a muzzle
// flash and an impact shockwave.
export class HollowPurple {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }
  spawn(start, end, radius) {
    const g = new THREE.Group();
    const dir = end.clone().sub(start), len = Math.max(0.5, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const beam = new THREE.Group(); beam.quaternion.copy(q); beam.position.copy(start).add(end).multiplyScalar(0.5);
    const cyl = (r, c, o) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const core = cyl(radius * 0.26, 0xffffff, 1);
    const mid = cyl(radius * 0.6, 0x9a3cff, 0.9);
    const outer = cyl(radius * 1.0, 0xb060ff, 0.42);
    const red = cyl(radius * 1.14, 0xff2a44, 0.28);     // the limitless-red fringe
    const blue = cyl(radius * 1.24, 0x2a6bff, 0.24);    // the limitless-blue fringe
    beam.add(outer, blue, red, mid, core);
    g.add(beam);
    const sprite = (c, s, pos) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); sp.scale.setScalar(s); sp.position.copy(pos); g.add(sp); return sp; };
    const flash = sprite(0xdcb0ff, radius * 2.6, start);
    const shock = sprite(0xc070ff, radius * 1.2, end);
    this.group.add(g);
    this.list.push({ g, beam, core, mid, outer, red, blue, flash, shock, t: 0, max: 0.62, radius });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t += dt; const k = Math.min(1, f.t / f.max), fade = 1 - k;
      const punch = Math.min(1, f.t / 0.12);                    // snap to full width almost instantly
      const grow = 0.3 + 0.7 * (1 - Math.pow(1 - punch, 3));
      f.beam.scale.set(grow, 1, grow);
      f.core.material.opacity = fade; f.mid.material.opacity = 0.9 * fade; f.outer.material.opacity = 0.42 * fade;
      // The red/blue fringes flicker against each other as the corridor erases.
      f.red.material.opacity = (0.28 + 0.06 * Math.sin(f.t * 40)) * fade;
      f.blue.material.opacity = (0.24 + 0.06 * Math.sin(f.t * 40 + 2)) * fade;
      f.beam.rotation.y += dt * 4.5;
      f.flash.material.opacity = Math.max(0, 1 - k * 2.2); f.flash.scale.setScalar(f.radius * (2.6 + k * 2.4));
      f.shock.material.opacity = Math.max(0, (1 - k * 1.5) * 0.9); f.shock.scale.setScalar(f.radius * (1.2 + k * 8));
      f.shock.material.rotation += dt * 2;
      if (f.t >= f.max) { this._dispose(f.g); this.list.splice(i, 1); }
    }
  }
  _dispose(g) { this.group.remove(g); g.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); }); }
}

// ---------------- Sharingan (gaze) ----------------
// A red tomoe ring + commas, drawn on transparent for the genjutsu/gaze marker.
function tomoeRingTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.translate(S / 2, S / 2); g.lineCap = 'round';
  // Bright outer rim + a thin inner pupil ring for the Sharingan iris.
  g.strokeStyle = 'rgba(245,30,42,0.98)'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, S * 0.36, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(18,2,4,0.98)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, S * 0.13, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(120,6,12,0.9)'; g.beginPath(); g.arc(0, 0, S * 0.12, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 3; i++) {
    g.rotate(Math.PI * 2 / 3);
    // Comma-shaped tomoe: a teardrop head with a curved tail hooking toward the pupil.
    g.fillStyle = 'rgba(20,2,5,0.97)'; g.beginPath(); g.arc(0, -S * 0.34, S * 0.085, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,2,5,0.97)'; g.lineWidth = 7; g.beginPath(); g.arc(0, -S * 0.27, S * 0.13, -0.4, 1.9); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TOMOE_TEX = tomoeRingTexture();

// The gaze tether + a spinning tomoe ring on the looked-at target (red when igniting,
// brighter/locked when the genjutsu snaps shut).
export class SharinganFx {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: TOMOE_TEX, color: 0xff2838, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.ring.renderOrder = 1000;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff3040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.group.add(this.beam, this.ring, this.flash);
    this.group.visible = false; this.t = 0;
    this._up = new THREE.Vector3(0, 1, 0); this._q = new THREE.Quaternion();
  }
  set(active, start, end, lock) {
    this.group.visible = !!active; if (!active) return;
    const dir = end.clone().sub(start), len = Math.max(0.1, dir.length());
    this._q.setFromUnitVectors(this._up, dir.normalize());
    this.beam.position.copy(start).add(end).multiplyScalar(0.5); this.beam.quaternion.copy(this._q); this.beam.scale.y = len;
    this.ring.position.copy(end); this.flash.position.copy(end);
    this.ring.material.color.setHex(lock ? 0xff0018 : 0xff2838);
    this.ring.scale.setScalar(lock ? 1.8 : 1.1);
    this.flash.scale.setScalar(lock ? 1.2 : 0.7);
  }
  update(dt) {
    if (!this.group.visible) return; this.t += dt;
    this.ring.material.rotation += dt * 3.2;
    this.beam.material.opacity = 0.35 + Math.abs(Math.sin(this.t * 24)) * 0.4;
    this.flash.material.opacity = 0.5 + 0.35 * Math.abs(Math.sin(this.t * 9));   // pulsing gaze glow
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
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 14, 40), new THREE.MeshBasicMaterial({ color, fog: false }));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.16, 12, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.56, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, fog: false }));
    const swirl = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    swirl.scale.setScalar(1.0); swirl.position.z = 0.02;
    g.add(disc, halo, ring, swirl);
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
  redirect(proj, dt = 0.016) {
    if (!this.slots[0] || !this.slots[1]) return false;
    if (proj._portalCD > 0) { proj._portalCD -= dt; return false; }   // real dt so the cooldown is frame-rate independent
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
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const cx = S / 2;
  // Radiating spikes give the flash a sharp, photographic star-burst...
  g.translate(cx, cx);
  g.strokeStyle = 'rgba(255,235,170,0.85)'; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    const len = i % 2 === 0 ? cx * 0.92 : cx * 0.6;
    g.lineWidth = i % 2 === 0 ? 5 : 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // ...over a hot radial core.
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, 'rgba(255,252,225,1)');
  grad.addColorStop(0.28, 'rgba(255,210,110,0.85)');
  grad.addColorStop(0.6, 'rgba(255,160,50,0.3)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
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
    g.lineJoin = 'round';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, 64, 33);   // fat dark outline for legibility on any background
    g.fillStyle = color; g.fillText(text, 64, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, t); return t;
  }
  spawn(pos, amount, head) {
    const tex = this._tex(head ? `${amount}!` : `${amount}`, head ? '#ffd23a' : '#ffffff');
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    const base = head ? 0.9 : 0.7;
    spr.scale.set(base, base * 0.5, 1);
    spr.position.copy(pos); spr.position.y += 0.4 + Math.random() * 0.3;
    spr.renderOrder = 1001;
    this.group.add(spr);
    this.list.push({ spr, life: 0.9, max: 0.9, vx: (Math.random() - 0.5) * 0.5, vy: 1.7, base, head });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i]; d.life -= dt;
      if (d.life <= 0) { this.group.remove(d.spr); d.spr.material.dispose(); this.list.splice(i, 1); }
      else {
        d.vy -= 3.2 * dt;                                   // arc up then settle
        d.spr.position.y += d.vy * dt; d.spr.position.x += d.vx * dt;
        const k = d.life / d.max;
        // Quick pop on spawn (overshoot), then linger; crits punch a touch bigger.
        const age = 1 - k;
        const pop = age < 0.16 ? 1 + (1 - age / 0.16) * (d.head ? 0.7 : 0.45) : 1;
        d.spr.scale.set(d.base * pop, d.base * 0.5 * pop, 1);
        d.spr.material.opacity = Math.min(1, k * 1.8);
      }
    }
  }
}

// A spinning 3D chakra orb (the Rasengan body) built into group `g` at local
// point `P`. Returns a per-frame animator(charge, dt, t). Everything spins about
// the VERTICAL axis — like a buzzsaw around a vertical pole, clockwise from the
// player's view:
//  - a bright core inside a translucent containment sphere;
//  - a flat equatorial "saw" disc (the 4-bladed pinwheel) spinning about vertical;
//  - a cage of longitude rings (great circles through the poles) sweeping round;
//  - `wisps` of chakra that continuously stream inward, circling the vertical axis
//    and spiralling onto the orb — the "energy charging in, in a circle".
// `charge` (0→1) grows, brightens and spins everything up: a faint forming orb
// when uncharged, a dense fast vortex at full charge.
function buildChakraOrb(g, P, opts = {}) {
  const wispN = opts.wisps ?? 16;
  const haloColor = opts.haloColor ?? 0x4aa3ff;
  const sawSize = opts.saw ?? 0.38;
  const add = (m) => { m.position.copy(P); g.add(m); return m; };

  const core = add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 22, 22),
    new THREE.MeshBasicMaterial({ color: 0x3f9bff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));

  // The buzzsaw: a flat pinwheel disc whose axle is (near-)vertical, tilted a touch
  // toward the player so the spinning blades read. Spins about the vertical.
  const sawPivot = new THREE.Group(); sawPivot.position.copy(P); sawPivot.rotation.x = -Math.PI / 2 + 0.5; g.add(sawPivot);
  const saw = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: SHURIKEN_TEX, color: 0xcdeeff, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  sawPivot.add(saw);

  // Longitude-ring cage: great circles through the poles, offset around vertical.
  const bands = [];
  for (let i = 0; i < 4; i++) {
    const band = add(new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.01, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xddf3ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    band.rotation.y = i * (Math.PI / 4); bands.push(band);
  }

  // Inward-spiralling chakra streams that circle the vertical axis (near-horizontal,
  // slightly tilted orbits) as the orb gathers.
  const _u = new THREE.Vector3(), _w = new THREE.Vector3();
  const wisps = [];
  for (let i = 0; i < wispN; i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xaadcff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    g.add(spr);
    const n = new THREE.Vector3((Math.random() * 2 - 1) * 0.5, 1, (Math.random() * 2 - 1) * 0.5).normalize();  // near-vertical orbit normal
    const tmp = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(n, tmp).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    wisps.push({ spr, u, v, prog: Math.random(), turns: 2.5 + (i % 3), speed: 0.6 + Math.random() * 0.5, ph: Math.random() * 6.28 });
  }

  const halo = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: haloColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));

  const ROUT = 0.62;
  return (charge, dt, t) => {
    const c = Math.max(0, Math.min(1, charge));
    const grow = 0.34 + 0.66 * c;
    const pulse = 1 + 0.05 * Math.sin(t * 22) * c;
    const spin = (1.4 + 7.0 * c) * dt;                   // fast saw; ramps hard with charge

    core.scale.setScalar((0.55 + 0.6 * c) * pulse); core.material.opacity = 0.4 + 0.38 * c;
    body.scale.setScalar(grow * pulse); body.material.opacity = 0.12 + 0.22 * c;
    body.rotation.y += spin * 0.8;                       // gentle counter-drift for depth

    saw.scale.setScalar(sawSize * grow * 2.0); saw.material.opacity = 0.35 + 0.6 * c;   // the blade should read, not the glow
    saw.rotation.z -= spin * 1.5;                        // clockwise about the (near-vertical) axle

    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      b.scale.setScalar(grow * (0.97 + 0.03 * Math.sin(t * 7 + i)));
      b.material.opacity = 0.1 + 0.55 * c;
      b.rotation.y -= spin;                              // sweep the longitude cage about vertical
    }

    const surf = 0.22 * grow;
    for (const wi of wisps) {
      wi.prog += dt * (0.4 + 1.7 * c) * wi.speed;
      if (wi.prog >= 1) wi.prog -= 1;
      const p = wi.prog;
      const ang = wi.ph - p * wi.turns * 6.2832;         // clockwise spiral inward
      const rad = ROUT * (1 - p) + surf * p;
      const ca = Math.cos(ang) * rad, sa = Math.sin(ang) * rad;
      _u.copy(wi.u).multiplyScalar(ca); _w.copy(wi.v).multiplyScalar(sa);
      wi.spr.position.copy(P).add(_u).add(_w);
      wi.spr.scale.setScalar(0.045 + 0.05 * c);
      wi.spr.material.opacity = (0.12 + 0.8 * c) * Math.sin(p * Math.PI);
    }

    halo.scale.setScalar((0.5 + 0.5 * c) * grow * 1.55);
    halo.material.opacity = 0.13 + 0.3 * c;
  };
}

// ---------------- First-person viewmodels ----------------
export function makeViewModel(id) {
  const g = new THREE.Group();
  const box = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c, fog: false })); m.position.set(x, y, z); g.add(m); return m; };
  if (id === HANDGUN) {
    box(0.11, 0.13, 0.5, 0x3a3f47, 0, 0, -0.2);          // slide
    box(0.06, 0.05, 0.14, 0x23262c, 0, 0.05, -0.42);     // front sight rib
    box(0.1, 0.22, 0.13, 0x2b2f36, 0, -0.16, 0.02);      // grip
    box(0.05, 0.07, 0.1, 0x1a1d22, 0, -0.05, 0.02);      // trigger guard nub
  } else if (id === SMG) {
    box(0.12, 0.14, 0.55, 0x44464f, 0, 0, -0.22);        // receiver
    box(0.05, 0.05, 0.2, 0x23252b, 0, 0.06, -0.42);      // barrel shroud
    box(0.09, 0.28, 0.11, 0x2c2e35, 0, -0.21, -0.02);    // magazine
    box(0.1, 0.2, 0.14, 0x23252b, 0, -0.15, 0.08);       // grip
  } else if (id === ASSAULT_RIFLE) {
    box(0.11, 0.13, 0.82, 0x3a4a36, 0, 0, -0.34);        // receiver/barrel
    box(0.06, 0.06, 0.22, 0x1f2719, 0, 0.04, -0.62);     // handguard
    box(0.1, 0.3, 0.11, 0x26301f, 0.0, -0.23, -0.08);    // curved mag
    box(0.1, 0.2, 0.14, 0x1f2719, 0, -0.15, 0.08);       // grip
    box(0.05, 0.09, 0.12, 0x12160e, 0, 0.12, -0.34);     // rear sight
    box(0.04, 0.08, 0.05, 0x12160e, 0, 0.1, -0.66);      // front sight post
  } else if (id === SHOTGUN) {
    box(0.13, 0.14, 0.8, 0x7a7d85, 0, 0.03, -0.32);      // barrel
    box(0.1, 0.1, 0.74, 0x5d6068, 0, -0.07, -0.3);       // tube magazine
    box(0.13, 0.11, 0.32, 0x3a3c42, 0, -0.04, -0.16);    // pump
    box(0.11, 0.18, 0.26, 0x6b4427, 0, -0.13, 0.14);     // wood stock
  } else if (id === SNIPER) {
    box(0.1, 0.1, 1.1, 0x23262b, 0, 0, -0.5);        // long barrel/receiver
    box(0.1, 0.2, 0.16, 0x17191d, 0, -0.15, 0.04);   // grip
    box(0.11, 0.1, 0.22, 0x2b2e33, 0, -0.02, 0.16);  // cheek riser stock
    box(0.06, 0.06, 0.35, 0x0c0d10, 0, 0, -0.95);    // muzzle/barrel tip
    box(0.13, 0.13, 0.42, 0x111317, 0, 0.17, -0.28); // scope body
    box(0.14, 0.14, 0.04, 0x05060a, 0, 0.17, -0.07); // scope rear bell
    box(0.05, 0.05, 0.06, 0x2b8cff, 0, 0.17, -0.5);  // front lens (blue)
    box(0.16, 0.06, 0.06, 0x17191d, 0, 0.27, -0.28); // scope mount
  } else if (id === RAILGUN) {
    box(0.14, 0.16, 0.95, 0x342b4a, 0, 0, -0.4);     // body
    const rail = box(0.035, 0.035, 0.84, 0x9b6bff, 0, 0.1, -0.34);
    rail.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });   // glowing accelerator rail (top)
    const rail2 = box(0.035, 0.035, 0.84, 0x9b6bff, 0, -0.02, -0.34);
    rail2.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });  // lower rail
    box(0.1, 0.2, 0.14, 0x231d33, 0, -0.18, 0.04);   // grip
    box(0.1, 0.1, 0.16, 0x141021, 0, 0.15, -0.16);   // scope nub
  } else if (id === PLASMA_GUN) {
    box(0.18, 0.18, 0.55, 0x2a6f68, 0, 0, -0.22);    // emitter body
    box(0.2, 0.2, 0.1, 0x18403c, 0, 0, -0.46);       // muzzle collar
    const tip = box(0.12, 0.12, 0.12, 0x9bfff2, 0, 0, -0.53);
    tip.material = new THREE.MeshBasicMaterial({ color: 0xbafff5, fog: false });    // glowing plasma lens
    const cell = box(0.06, 0.1, 0.3, 0x46ffe0, 0.0, 0.13, -0.2);
    cell.material = new THREE.MeshBasicMaterial({ color: 0x7afff0, fog: false });   // energy cell
    box(0.1, 0.2, 0.14, 0x1f524d, 0, -0.17, 0.02);   // grip
  } else if (id === ROCKET_LAUNCHER) {
    box(0.22, 0.22, 0.95, 0x556b2f, 0, 0, -0.38);    // tube
    box(0.26, 0.26, 0.1, 0x3f5022, 0, 0, 0.06);      // rear blast collar
    const warhead = box(0.16, 0.16, 0.18, 0xd23a2a, 0, 0, -0.86);
    warhead.material = new THREE.MeshBasicMaterial({ color: 0xe04a36, fog: false });  // warhead tip
    box(0.08, 0.16, 0.2, 0x2f3d1a, 0, 0.18, -0.5);   // top sight rail
    box(0.1, 0.2, 0.14, 0x3f5022, 0, -0.17, 0.06);   // grip
  } else if (id === HEAVY_MG) {
    box(0.15, 0.15, 0.95, 0x2b2b2f, 0, 0, -0.4);           // long receiver
    box(0.18, 0.18, 0.32, 0x46484e, 0, 0, -0.82);          // barrel shroud
    box(0.08, 0.08, 0.18, 0x141416, 0, 0, -1.02);          // muzzle
    box(0.1, 0.22, 0.14, 0x23252b, 0, -0.18, 0.04);        // grip
    box(0.16, 0.1, 0.18, 0x6a4a2a, 0, -0.04, 0.18);        // wooden stock
    box(0.07, 0.16, 0.2, 0x33342f, 0, 0.16, -0.04);        // ammo box / feed
    box(0.05, 0.05, 0.5, 0x1c1c20, 0.13, 0.07, -0.4); box(0.05, 0.05, 0.5, 0x1c1c20, -0.13, 0.07, -0.4);  // bipod-ish rails
  } else if (id === BLACK_HOLE_BOMB) {
    box(0.22, 0.22, 0.62, 0x241a33, 0, 0, -0.26);          // dark body
    box(0.28, 0.28, 0.16, 0x140d1f, 0, 0, -0.54);          // muzzle housing
    const orb = box(0.16, 0.16, 0.16, 0x000000, 0, 0, -0.6); orb.material = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }); // void orb
    const e1 = box(0.035, 0.035, 0.52, 0x9b6bff, 0.13, 0.08, -0.26); e1.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });  // containment coils
    const e2 = box(0.035, 0.035, 0.52, 0x9b6bff, -0.13, 0.08, -0.26); e2.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });
    const e3 = box(0.035, 0.035, 0.52, 0x9b6bff, 0, 0.14, -0.26); e3.material = new THREE.MeshBasicMaterial({ color: 0xb98bff, fog: false });
    box(0.1, 0.2, 0.14, 0x1c1430, 0, -0.17, 0.04);         // grip
  } else if (id === RASENGAN) {
    // The spinning chakra sphere cupped in the hand — a self-animating 3D orb
    // (see buildChakraOrb), driven by vmCharge via g.userData.chakraAnim.
    box(0.18, 0.07, 0.16, 0xe8b89a, 0, -0.18, -0.34);        // cupped palm
    for (const fx of [-0.07, 0, 0.07]) box(0.045, 0.16, 0.05, 0xe8b89a, fx, -0.1, -0.42);  // cupping fingers
    g.userData.chakraAnim = buildChakraOrb(g, new THREE.Vector3(0, 0.0, -0.42), { haloColor: 0x4aa3ff, wisps: 16 });
  } else if (id === RASENSHURIKEN) {
    // A chakra orb wrapped in the four-bladed wind shuriken — a big buzzsaw blade
    // spinning about the vertical axis, framed by a glowing wind-rim, gathering and
    // accelerating with charge.
    box(0.18, 0.07, 0.16, 0xe8b89a, 0, -0.2, -0.36);         // cupped palm
    for (const fx of [-0.07, 0, 0.07]) box(0.045, 0.16, 0.05, 0xe8b89a, fx, -0.12, -0.44);  // cupping fingers
    const P = new THREE.Vector3(0, 0.02, -0.52);
    const orbAnim = buildChakraOrb(g, P, { haloColor: 0xbfe9ff, wisps: 14, saw: 0.66 });
    const pivot = new THREE.Group(); pivot.position.copy(P); pivot.rotation.x = -Math.PI / 2 + 0.5; g.add(pivot);  // same tilted vertical axle as the saw
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.018, 8, 44),
      new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    pivot.add(rim);
    g.userData.chakraAnim = (charge, dt, t) => {
      orbAnim(charge, dt, t);
      const c = Math.max(0, Math.min(1, charge));
      rim.scale.setScalar(0.7 + 0.75 * c); rim.material.opacity = 0.18 + 0.6 * c;
    };
  } else if (id === LASER_CANNON) {
    box(0.2, 0.2, 0.7, 0x2a2030, 0, 0, -0.3);              // heavy emitter body
    box(0.24, 0.24, 0.16, 0x140c1c, 0, 0, -0.62);          // muzzle housing
    const lens = box(0.12, 0.12, 0.1, 0xff2e54, 0, 0, -0.7); lens.material = new THREE.MeshBasicMaterial({ color: 0xff516e, fog: false });
    const r1 = box(0.04, 0.04, 0.6, 0xff2e54, 0.12, 0.08, -0.3); r1.material = new THREE.MeshBasicMaterial({ color: 0xff5570, fog: false });
    const r2 = box(0.04, 0.04, 0.6, 0xff2e54, -0.12, 0.08, -0.3); r2.material = new THREE.MeshBasicMaterial({ color: 0xff5570, fog: false });
    box(0.12, 0.16, 0.18, 0x3a2a1a, 0, -0.05, 0.16);       // coolant drum
    box(0.1, 0.2, 0.14, 0x201828, 0, -0.16, 0.04);         // grip
  } else if (id === HOLLOW_PURPLE) {
    // A cursed-energy gauntlet cupping the red + blue spheres that clap into purple.
    box(0.17, 0.15, 0.2, 0xe8b89a, 0, -0.13, -0.32);        // hand
    box(0.21, 0.13, 0.18, 0x2a1f3d, 0, -0.2, -0.18);        // dark gauntlet
    box(0.23, 0.04, 0.04, 0x7b3ff2, 0, -0.14, -0.26);       // cursed-energy seam (purple)
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 12), new THREE.MeshBasicMaterial({ color: 0xff3a54, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    red.position.set(0.1, 0.0, -0.42); g.add(red);          // limitless red
    const blue = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 12), new THREE.MeshBasicMaterial({ color: 0x3a7bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    blue.position.set(-0.1, 0.0, -0.42); g.add(blue);       // limitless blue
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xb060ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    haze.scale.setScalar(0.5); haze.position.set(0, 0.0, -0.42); g.add(haze);
    g.userData.chakraAnim = (charge, dt, t) => {
      const c = Math.max(0, Math.min(1, charge)), conv = 0.1 * (1 - c);   // red+blue converge as it charges
      red.position.x = conv; blue.position.x = -conv;
      const s = 0.7 + 0.7 * c; red.scale.setScalar(s); blue.scale.setScalar(s);
      haze.material.opacity = 0.2 + 0.6 * c; haze.scale.setScalar(0.4 + 0.8 * c);
    };
  } else if (id === SHARINGAN) {
    // An open hand held up in a seal, a glowing red tomoe eye hovering in the palm.
    box(0.26, 0.06, 0.2, 0xe8b89a, 0, -0.16, -0.32);          // palm
    for (const hx of [-0.11, -0.04, 0.04, 0.11]) box(0.05, 0.22, 0.06, 0xe8b89a, hx, 0.0, -0.34);  // fingers
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 14), new THREE.MeshBasicMaterial({ color: 0xe01020, fog: false }));
    eye.position.set(0, 0.02, -0.42); g.add(eye);
    const tomoe = new THREE.Sprite(new THREE.SpriteMaterial({ map: TOMOE_TEX, color: 0xff3040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    tomoe.scale.setScalar(0.3); tomoe.position.set(0, 0.02, -0.41); g.add(tomoe);   // spinning tomoe iris over the eye
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff2838, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.setScalar(0.5); halo.position.set(0, 0.02, -0.43); g.add(halo);
    g.userData.chakraAnim = (charge, dt, t) => {
      const p = 1 + Math.sin(t * 6) * 0.12; eye.scale.setScalar(p);
      tomoe.material.rotation += dt * 2.4;
      halo.material.opacity = 0.5 + 0.3 * Math.abs(Math.sin(t * 4));
    };
  } else { // PORTAL_GUN
    box(0.16, 0.16, 0.5, 0xe2e2e6, 0, 0, -0.2);            // white chassis
    box(0.18, 0.18, 0.1, 0xbcbcc2, 0, 0, -0.42);           // emitter ring
    const o1 = box(0.06, 0.06, 0.14, 0xff8c2b, 0.05, 0, -0.5); o1.material = new THREE.MeshBasicMaterial({ color: 0xffa64a, fog: false });  // orange prong
    const o2 = box(0.06, 0.06, 0.14, 0x2b8cff, -0.05, 0, -0.5); o2.material = new THREE.MeshBasicMaterial({ color: 0x57a8ff, fog: false }); // blue prong
    box(0.1, 0.2, 0.14, 0xc4c4c8, 0, -0.16, 0.02);         // grip
  }
  g.scale.setScalar(1.7);
  g.position.set(0.42, -0.5, -0.85);
  g.rotation.set(0.04, -0.13, 0.0);
  g.traverse((o) => { if (o.isMesh) { o.material.depthTest = false; o.renderOrder = 999; } });
  return g;
}

// A world-space weapon prop for a remote avatar's hand. Reuses the first-person
// viewmodel shapes but with normal depth testing and a hand-scale transform so it
// reads correctly in third person. Carries chakraAnim for the spinning jutsu orbs.
export function makeHeldWeapon(id) {
  const g = makeViewModel(id);
  g.traverse((o) => { if (o.material) o.material.depthTest = true; if (o.isMesh || o.isSprite) o.renderOrder = 0; });
  g.scale.setScalar(0.85);
  g.position.set(0.34, 1.12, 0.18);
  g.rotation.set(0, Math.PI, 0);    // viewmodel points -Z; flip to point along the avatar's forward (+Z)
  return g;
}
