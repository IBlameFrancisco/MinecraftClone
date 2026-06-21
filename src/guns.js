// Gun visuals + projectiles: hitscan tracers, plasma bolts, portal-gun portals,
// and simple first-person viewmodels. Firing logic itself lives in main (it has
// the world/mobs/player references); this module owns the effects and portals.

import * as THREE from 'three';
import { HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN } from './items.js';
import { isSolid } from './blocks.js';

// ---------------- Tracers ----------------
export class Tracers {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }
  add(start, end, color = 0xffe08a) {
    const dir = end.clone().sub(start);
    const len = Math.max(0.01, dir.length());
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, len, 5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, fog: false }),
    );
    m.position.copy(start).add(end).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.group.add(m);
    this.list.push({ m, life: 0.09, max: 0.09 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i]; t.life -= dt;
      if (t.life <= 0) { this.group.remove(t.m); t.m.geometry.dispose(); t.m.material.dispose(); this.list.splice(i, 1); }
      else t.m.material.opacity = 0.95 * (t.life / t.max);
    }
  }
}

// ---------------- Plasma bolts ----------------
export class Plasmas {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }
  spawn(pos, dir, speed, damage, range) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x9bfff2, fog: false }),
    );
    m.position.copy(pos);
    this.group.add(m);
    this.list.push({ m, vel: dir.clone().multiplyScalar(speed), pos: pos.clone(), damage, range, travelled: 0 });
  }
  update(dt, world, mobs, onImpact) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const step = p.vel.clone().multiplyScalar(dt);
      p.pos.add(step); p.travelled += step.length();
      p.m.position.copy(p.pos);
      let hit = p.travelled > p.range || isSolid(world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)));
      if (!hit) {
        for (const mob of mobs.list) {
          if (Math.hypot(mob.pos.x - p.pos.x, mob.pos.y + mob.height * 0.5 - p.pos.y, mob.pos.z - p.pos.z) < 0.9) { hit = true; break; }
        }
      }
      if (hit) {
        onImpact(p.pos.clone(), p.damage);
        this.group.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); this.list.splice(i, 1);
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

// ---------------- First-person viewmodels ----------------
export function makeViewModel(id) {
  const g = new THREE.Group();
  const box = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c, fog: false })); m.position.set(x, y, z); g.add(m); return m; };
  if (id === HANDGUN) {
    box(0.12, 0.12, 0.5, 0x3a3f47, 0, 0, -0.2);
    box(0.1, 0.22, 0.14, 0x2b2f36, 0, -0.16, 0.0);
  } else if (id === SNIPER) {
    box(0.1, 0.1, 1.0, 0x23262b, 0, 0, -0.45);
    box(0.1, 0.2, 0.16, 0x17191d, 0, -0.15, 0.02);
    box(0.08, 0.08, 0.3, 0x111317, 0, 0.12, -0.3);   // scope
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
