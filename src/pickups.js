// Arena pickups: floating, spinning health and ammo crates. Purely local (health
// and ammo are per-client resources, so no netcode needed) — each player grabs
// their own; a grabbed pickup respawns after a delay.

import * as THREE from 'three';

const RESPAWN = 12;        // seconds to come back after being grabbed
const GRAB_DIST2 = 1.7 * 1.7;

function crateMesh(kind) {
  const g = new THREE.Group();
  const color = kind === 'health' ? 0x3ad06a : 0xffc23a;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
  g.add(box);
  // a contrasting symbol on top faces
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  g.add(mark);
  if (kind === 'health') { const v = mark.clone(); v.geometry = new THREE.BoxGeometry(0.16, 0.16, 0.52); g.add(v); }
  return g;
}

export class Pickups {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.list = []; }

  clear() {
    for (const p of this.list) { this.group.remove(p.mesh); p.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    this.list.length = 0;
  }

  // spots: [{ x, y, z, kind }]
  setup(spots) {
    this.clear();
    for (const s of spots) {
      const mesh = crateMesh(s.kind);
      mesh.position.set(s.x, s.y, s.z);
      this.group.add(mesh);
      this.list.push({ kind: s.kind, mesh, base: s.y, active: true, timer: 0, spin: Math.random() * 6.28 });
    }
  }

  // onPickup(kind) -> true if the pickup was consumed (else it stays).
  update(dt, playerPos, onPickup) {
    for (const p of this.list) {
      if (p.active) {
        p.spin += dt * 1.8;
        p.mesh.rotation.y = p.spin;
        p.mesh.position.y = p.base + Math.sin(p.spin * 1.5) * 0.12;
        const dx = playerPos.x - p.mesh.position.x, dz = playerPos.z - p.mesh.position.z, dy = (playerPos.y + 0.9) - p.base;
        if (dx * dx + dz * dz + dy * dy * 0.4 < GRAB_DIST2 && onPickup(p.kind)) {
          p.active = false; p.timer = RESPAWN; p.mesh.visible = false;
        }
      } else {
        p.timer -= dt;
        if (p.timer <= 0) { p.active = true; p.mesh.visible = true; }
      }
    }
  }
}
