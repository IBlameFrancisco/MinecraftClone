// Arena pickups: floating, spinning health / ammo / weapon crates. Purely local
// (health, ammo and which guns YOU have are per-client, so no netcode needed) —
// each player grabs their own. Health/ammo respawn after a delay; `once` loot
// (Hunger Games weapons) is gone for good once taken.

import * as THREE from 'three';

const RESPAWN = 12;        // seconds to come back after being grabbed
const GRAB_DIST2 = 1.7 * 1.7;

function crateMesh(kind, color) {
  const g = new THREE.Group();
  const c = kind === 'health' ? 0x3ad06a : kind === 'ammo' ? 0xffc23a : (color || 0xe0b84a);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: kind === 'weapon' ? 0.75 : 0.5 }));
  g.add(box);
  // a contrasting symbol on top faces
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  g.add(mark);
  if (kind === 'health') { const v = mark.clone(); v.geometry = new THREE.BoxGeometry(0.16, 0.16, 0.52); g.add(v); }
  if (kind === 'weapon') {
    box.scale.setScalar(1.12);                                          // a touch bigger so loot reads at range
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.66, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    blade.position.y = 0.36; g.add(blade);                             // a "weapon" upright mark
  }
  return g;
}

export class Pickups {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }

  clear() {
    for (const p of this.list) { this.group.remove(p.mesh); p.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    this.list.length = 0;
  }

  // spots: [{ x, y, z, kind, gun?, color?, once? }]
  setup(spots) {
    this.clear();
    for (const s of spots) {
      const mesh = crateMesh(s.kind, s.color);
      mesh.position.set(s.x, s.y, s.z);
      this.group.add(mesh);
      this.list.push({ kind: s.kind, gun: s.gun, once: !!s.once, mesh, base: s.y, active: true, gone: false, timer: 0, spin: Math.random() * 6.28 });
    }
  }

  // onPickup(kind, gun) -> true if the pickup was consumed (else it stays).
  update(dt, playerPos, onPickup) {
    for (const p of this.list) {
      if (p.gone) continue;                              // one-time loot, already taken
      if (p.active) {
        p.spin += dt * 1.8;
        p.mesh.rotation.y = p.spin;
        p.mesh.position.y = p.base + Math.sin(p.spin * 1.5) * 0.12;
        const dx = playerPos.x - p.mesh.position.x, dz = playerPos.z - p.mesh.position.z, dy = (playerPos.y + 0.9) - p.base;
        if (dx * dx + dz * dz + dy * dy * 0.4 < GRAB_DIST2 && onPickup(p.kind, p.gun)) {
          p.active = false; p.mesh.visible = false;
          if (p.once) p.gone = true;                     // looted for good
          else p.timer = RESPAWN;
        }
      } else {
        p.timer -= dt;
        if (p.timer <= 0) { p.active = true; p.mesh.visible = true; }
      }
    }
  }
}
