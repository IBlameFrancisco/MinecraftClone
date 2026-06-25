// Hero abilities — the GunCraft "cool attacks" ported as cooldown ults. Each ability is
// data + a cast(ctx) that uses shared helpers (line/cone damage, tube carving) plus the
// projectiles, carve, fx and audio systems. The player slots two abilities (keys Q / E),
// chosen in the loadout. Tier 1 (M4) here are the carving ults; tier 2 (M5) reality-benders
// are appended below.
import * as THREE from 'three';

function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return new THREE.Vector3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); }

export const ABILITIES = {
  // ---- Tier 1: carving ults (M4) ----
  hollow: {
    name: 'Hollow Purple', cooldown: 10, color: 0x9a3cff,
    cast(ctx) {
      const { origin, dir, fx, audio } = ctx;
      const len = 95, start = origin.clone().addScaledVector(dir, 3);
      this._carveTube(ctx, start, dir, len, 2.7, 1.3);
      this._lineDamage(ctx, origin, dir, len, 3.4, 240);
      const end = origin.clone().addScaledVector(dir, len);
      fx.beam(start, end, 0x9a3cff, 0.55); fx.beam(start, end, 0xff45e0, 0.3); fx.beam(start, end, 0xffffff, 0.12);
      for (let t = 6; t < len; t += 9) fx.blast(origin.clone().addScaledVector(dir, t), 0x9a3cff, 3.2);
      audio.ability('hollow');
    },
  },
  rasengan: {
    name: 'Rasengan', cooldown: 5, color: 0x4aa3ff,
    cast(ctx) {
      const { origin, dir, fx, audio } = ctx;
      const p = origin.clone().addScaledVector(dir, 2.2);
      this._coneDamage(ctx, origin, dir, 5.5, 0.7, 85, 22);
      ctx.carve(p, 2.1);
      fx.blast(p, 0x4aa3ff, 2.6); fx.blast(p, 0xbfe0ff, 1.6);
      audio.ability('rasengan');
    },
  },
  rasenshuriken: {
    name: 'Rasenshuriken', cooldown: 8, color: 0xbfe9ff,
    cast(ctx) {
      const { origin, dir, projectiles, ownerTeam, fx, audio } = ctx;
      projectiles.spawn(origin.clone().addScaledVector(dir, 1.6), dir,
        { proj: 'rasenshuriken', color: 0xbfe9ff, speed: 42, range: 95, damage: 70, splash: 130, radius: 9.5, size: 0.5 }, ownerTeam);
      fx.muzzle(origin.clone().addScaledVector(dir, 1.4), dir, 0xbfe9ff);
      audio.ability('rasenshuriken');
    },
  },
  cleave: {
    name: 'Cleave & Dismantle', cooldown: 6, color: 0xe0143c,
    cast(ctx) {
      const { origin, dir, fx, audio } = ctx;
      this._coneDamage(ctx, origin, dir, 58, 0.55, 110, 12);   // long-range cursed fan
      for (const a of [-0.34, -0.12, 0.12, 0.34]) {
        const d2 = rotY(dir, a); const start = origin.clone().addScaledVector(d2, 3);
        this._carveTube(ctx, start, d2, 46, 0.9, 2.2);
        fx.beam(start, origin.clone().addScaledVector(d2, 46), 0xe0143c, 0.08);
      }
      audio.ability('cleave');
    },
  },
  fuga: {
    name: 'Fūga', cooldown: 8, color: 0xff6a1f,
    cast(ctx) {
      const { origin, dir, projectiles, ownerTeam, fx, audio } = ctx;
      projectiles.spawn(origin.clone().addScaledVector(dir, 1.6), dir,
        { proj: 'fuga', color: 0xff6a1f, speed: 78, range: 170, damage: 130, splash: 85, radius: 6.2, size: 0.24 }, ownerTeam);
      fx.muzzle(origin.clone().addScaledVector(dir, 1.4), dir, 0xff6a1f);
      audio.ability('fuga');
    },
  },
};

export class Abilities {
  constructor() { this.slots = ['hollow', 'cleave']; this.cd = {}; this.onTick = null; }
  setLoadout(a, b) { this.slots = [a, b].filter(Boolean); this.reset(); }
  reset() { this.cd = {}; for (const s of this.slots) this.cd[s] = 0; }

  update(dt, input, ctx) {
    for (const s of this.slots) if (this.cd[s] > 0) this.cd[s] = Math.max(0, this.cd[s] - dt);
    if (input.down('KeyQ')) this._tryCast(0, ctx);
    if (input.down('KeyE')) this._tryCast(1, ctx);
    this.onTick && this.onTick(this);
  }
  _tryCast(i, ctx) {
    const id = this.slots[i]; if (!id || this.cd[id] > 0) return;
    const ab = ABILITIES[id]; if (!ab) return;
    const o = new THREE.Vector3(); ctx.camera.getWorldPosition(o);
    const d = new THREE.Vector3(); ctx.camera.getWorldDirection(d);
    ab.cast.call(this, { ...ctx, origin: o, dir: d });
    this.cd[id] = ab.cooldown;
    ctx.hud && ctx.hud.toast(ab.name + '!', '#' + (ab.color.toString(16).padStart(6, '0')));
  }
  cdFrac(i) { const id = this.slots[i]; return id ? this.cd[id] / ABILITIES[id].cooldown : 0; }
  ready(i) { const id = this.slots[i]; return id && this.cd[id] <= 0; }
  slotName(i) { const id = this.slots[i]; return id ? ABILITIES[id].name : ''; }

  // ---- shared cast helpers ----
  _carveTube(ctx, start, dir, len, radius, step) { for (let t = 0; t <= len; t += step) ctx.carve(start.clone().addScaledVector(dir, t), radius); }
  _lineDamage(ctx, origin, dir, len, radius, dmg) {
    for (const b of ctx.bots) {
      if (!b.alive || b.team === ctx.ownerTeam) continue;
      const to = new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z).sub(origin);
      const t = to.dot(dir); if (t < 0 || t > len) continue;
      if (to.clone().addScaledVector(dir, -t).length() < radius) ctx.damageBot(b, dmg, false);
    }
  }
  _coneDamage(ctx, origin, dir, range, halfAngle, dmg, knock) {
    const cos = Math.cos(halfAngle);
    for (const b of ctx.bots) {
      if (!b.alive || b.team === ctx.ownerTeam) continue;
      const to = new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z).sub(origin); const d = to.length();
      if (d > range || d < 0.001) continue; to.multiplyScalar(1 / d);
      if (to.dot(dir) < cos) continue;
      ctx.damageBot(b, dmg, false);
      if (knock) { b.pos.x += to.x * knock * 0.12; b.pos.z += to.z * knock * 0.12; }
    }
  }
}
