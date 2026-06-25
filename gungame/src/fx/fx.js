// Combat visual FX: bullet tracers, muzzle flashes, impact sparks and blood puffs.
// All additive + self-managed (spawn, then update(dt) fades/cleans them up).
import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,240,200,0.7)');
  grd.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.tex = glowTexture();
    this.tracers = []; this.flashes = []; this.sparks = []; this.rings = []; this.lights = [];
    this._tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  }
  tracer(from, to, color = 0xffd27a) {
    const dir = to.clone().sub(from); const len = dir.length(); if (len < 0.1) return;
    const m = new THREE.Mesh(this._tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.scale.set(0.035, len, 0.035);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.group.add(m); this.tracers.push({ m, life: 0.06, max: 0.06 });
  }
  muzzle(pos, dir, color = 0xffe2a0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.copy(pos).addScaledVector(dir, 0.15); s.scale.setScalar(0.55 + Math.random() * 0.2);
    s.material.rotation = Math.random() * 6.28;
    this.group.add(s); this.flashes.push({ s, life: 0.05, max: 0.05 });
    // a couple of spark streaks
    for (let i = 0; i < 3; i++) this._spark(pos.clone().addScaledVector(dir, 0.2), dir.clone().multiplyScalar(6 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)), 0xffd27a, 0.12);
  }
  impact(pos, normal, color = 0xcfd6df) {
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.2, (Math.random() - 0.5)).normalize().multiplyScalar(3 + Math.random() * 4);
      if (normal) v.addScaledVector(normal, 2.5);
      this._spark(pos.clone(), v, color, 0.18 + Math.random() * 0.12);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xfff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.copy(pos); s.scale.setScalar(0.3); this.group.add(s); this.flashes.push({ s, life: 0.06, max: 0.06 });
  }
  blood(pos) {
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6, (Math.random() - 0.5)).normalize().multiplyScalar(2 + Math.random() * 4);
      this._spark(pos.clone(), v, 0xc8203a, 0.22 + Math.random() * 0.15);
    }
  }
  // an enemy marker that draws THROUGH walls (Sharingan wallhack); refreshed each frame
  marker(pos, color = 0xe01020) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    s.position.copy(pos); s.scale.setScalar(0.7); s.renderOrder = 31;
    this.group.add(s); this.flashes.push({ s, life: 0.16, max: 0.16 });
  }
  // a continuous energy beam segment (laser); short-lived, refreshed each frame while firing
  beam(from, to, color = 0xff2e54, width = 0.07) {
    const dir = to.clone().sub(from); const len = dir.length(); if (len < 0.1) return;
    const m = new THREE.Mesh(this._tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.position.copy(from).addScaledVector(dir, 0.5); m.scale.set(width, len, width);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.group.add(m); this.tracers.push({ m, life: 0.05, max: 0.05 });
  }
  // an explosion: core flash, expanding shockwave ring, debris sparks and a light pop
  blast(pos, color = 0xff7a2f, radius = 4) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.copy(pos); s.scale.setScalar(radius * 0.6); this.group.add(s); this.flashes.push({ s, life: 0.24, max: 0.24 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.45, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.position.copy(pos); ring.position.y += 0.1; ring.rotation.x = -Math.PI / 2; this.group.add(ring); this.rings.push({ m: ring, life: 0.42, max: 0.42, radius });
    for (let i = 0; i < 24; i++) { const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9 + 0.1, (Math.random() - 0.5)).normalize().multiplyScalar(6 + Math.random() * 11); this._spark(pos.clone(), v, i % 3 ? 0xffb066 : 0xfff0d0, 0.35 + Math.random() * 0.3); }
    const light = new THREE.PointLight(color, 7, radius * 4.5); light.position.copy(pos); this.group.add(light); this.lights.push({ l: light, life: 0.2, max: 0.2 });
  }
  _spark(pos, vel, color, life) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.copy(pos); s.scale.setScalar(0.12 + Math.random() * 0.08);
    this.group.add(s); this.sparks.push({ s, vel, life, max: life });
  }
  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) { const t = this.tracers[i]; t.life -= dt; if (t.life <= 0) { this.group.remove(t.m); t.m.material.dispose(); this.tracers.splice(i, 1); } else t.m.material.opacity = 0.9 * (t.life / t.max); }
    for (let i = this.flashes.length - 1; i >= 0; i--) { const f = this.flashes[i]; f.life -= dt; if (f.life <= 0) { this.group.remove(f.s); f.s.material.dispose(); this.flashes.splice(i, 1); } else { f.s.material.opacity = f.life / f.max; } }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i]; p.life -= dt;
      if (p.life <= 0) { this.group.remove(p.s); p.s.material.dispose(); this.sparks.splice(i, 1); continue; }
      p.vel.y -= 9 * dt; p.s.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max; p.s.material.opacity = k; p.s.scale.setScalar((0.12 + 0.08) * k);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.life -= dt;
      if (r.life <= 0) { this.group.remove(r.m); r.m.material.dispose(); r.m.geometry.dispose(); this.rings.splice(i, 1); continue; }
      const k = 1 - r.life / r.max; r.m.scale.setScalar(0.4 + k * r.radius * 2.4); r.m.material.opacity = 0.85 * (1 - k);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i]; l.life -= dt;
      if (l.life <= 0) { this.group.remove(l.l); this.lights.splice(i, 1); continue; }
      l.l.intensity = (l.l.intensity) * (l.life / l.max) + 0.0001;
    }
  }
}
