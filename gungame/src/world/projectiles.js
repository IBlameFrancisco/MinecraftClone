// Projectile system for plasma bolts, rockets and homing missiles. Each projectile is a
// glowing sphere + point light that ray-marches forward, collides with the arena or a bot
// hitbox, applies a direct hit and/or splash, and detonates with a blast. Homing missiles
// steer toward the nearest enemy of their owner. Collision targets are refreshed each frame.
import * as THREE from 'three';

export class Projectiles {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx; this.list = []; this.ray = new THREE.Raycaster();
    this.arena = []; this.botMeshes = [];
    this.onDirectHit = null;  // (bot, dmg, ownerTeam) => {}
    this.onSplash = null;     // (pos, radius, dmg, ownerTeam) => {}  (also carves terrain later)
    this.getEnemies = null;   // (ownerTeam) => THREE.Vector3[]  (for homing)
  }
  setTargets(arena, botMeshes) { this.arena = arena; this.botMeshes = botMeshes; }

  spawn(pos, dir, spec, ownerTeam) {
    const col = spec.color || 0xffaa44;
    const r = spec.proj === 'rocket' ? 0.16 : spec.proj === 'homing' ? 0.14 : 0.1;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.7, metalness: 0.2, roughness: 0.4, fog: false }));
    mesh.add(new THREE.PointLight(col, 1.3, 7));
    mesh.position.copy(pos); this.scene.add(mesh);
    this.list.push({ pos: pos.clone(), dir: dir.clone().normalize(), spec, ownerTeam, mesh, dist: 0, dead: false });
  }

  update(dt) {
    for (const p of this.list) {
      if (p.dead) continue;
      if (p.spec.proj === 'homing' && this.getEnemies) {
        let best = null, bd = 1e9; for (const e of this.getEnemies(p.ownerTeam)) { const d = e.distanceToSquared(p.pos); if (d < bd) { bd = d; best = e; } }
        if (best) { const want = best.clone().sub(p.pos).normalize(); p.dir.lerp(want, Math.min(1, p.spec.turn * dt)).normalize(); }
      }
      const step = p.spec.speed * dt;
      const hit = this._cast(p.pos, p.dir, step + 0.25);
      if (hit) { p.pos.copy(hit.point); this._detonate(p, hit.bot); continue; }
      p.pos.addScaledVector(p.dir, step); p.dist += step;
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.dir);
      if (p.dist > p.spec.range) this._detonate(p, null);
    }
    this.list = this.list.filter((p) => { if (p.dead) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); return false; } return true; });
  }

  _cast(from, dir, dist) {
    this.ray.set(from, dir); this.ray.far = dist;
    const hits = this.ray.intersectObjects([...this.botMeshes, ...this.arena], true);
    if (!hits.length) return null;
    const h = hits[0]; let o = h.object, bot = null;
    while (o) { if (o.userData && o.userData.bot) { bot = o.userData.bot; break; } o = o.parent; }
    return { point: h.point, bot };
  }

  _detonate(p, bot) {
    p.dead = true;
    const c = p.spec.color || 0xffaa44;
    if (bot && this.onDirectHit) this.onDirectHit(bot, p.spec.damage, p.ownerTeam);
    if (p.spec.splash > 0) {
      this.fx.blast(p.pos.clone(), c, p.spec.radius);
      if (this.onSplash) this.onSplash(p.pos.clone(), p.spec.radius, p.spec.splash, p.ownerTeam, bot);
    } else {
      this.fx.impact(p.pos.clone(), null, c);
    }
  }

  clear() { for (const p of this.list) { this.scene.remove(p.mesh); } this.list = []; }
}
