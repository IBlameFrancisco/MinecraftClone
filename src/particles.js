// Lightweight GPU particle pool for block-break bursts. A single THREE.Points
// object with recycled per-particle position/colour attributes.

import * as THREE from 'three';

const MAX = 600;

export class Particles {
  constructor(scene) {
    this.geom = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geom.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Particle state.
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.baseColor = new Float32Array(MAX * 3);
    this.count = 0; // high-water mark of active slots
    this.cursor = 0;
  }

  burst(x, y, z, rgb, n = 16) {
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      if (idx + 1 > this.count) this.count = idx + 1;

      const p3 = idx * 3;
      this.positions[p3] = x + (Math.random() - 0.5) * 0.6;
      this.positions[p3 + 1] = y + (Math.random() - 0.5) * 0.6;
      this.positions[p3 + 2] = z + (Math.random() - 0.5) * 0.6;

      this.vel[p3] = (Math.random() - 0.5) * 3.2;
      this.vel[p3 + 1] = Math.random() * 3.6 + 1.0;
      this.vel[p3 + 2] = (Math.random() - 0.5) * 3.2;

      const shade = 0.7 + Math.random() * 0.45;
      const r = (rgb[0] / 255) * shade, g = (rgb[1] / 255) * shade, b = (rgb[2] / 255) * shade;
      this.baseColor[p3] = r; this.baseColor[p3 + 1] = g; this.baseColor[p3 + 2] = b;
      this.colors[p3] = r; this.colors[p3 + 1] = g; this.colors[p3 + 2] = b;

      this.maxLife[idx] = this.life[idx] = 0.5 + Math.random() * 0.4;
    }
  }

  update(dt) {
    let anyAlive = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      this.life[i] -= dt;
      const p3 = i * 3;
      if (this.life[i] <= 0) {
        // Park dead particles far below; size handled by fade.
        this.colors[p3] = this.colors[p3 + 1] = this.colors[p3 + 2] = 0;
        this.positions[p3 + 1] = -9999;
        continue;
      }
      this.vel[p3 + 1] -= 11 * dt; // gravity
      this.positions[p3] += this.vel[p3] * dt;
      this.positions[p3 + 1] += this.vel[p3 + 1] * dt;
      this.positions[p3 + 2] += this.vel[p3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      this.colors[p3] = this.baseColor[p3] * t;
      this.colors[p3 + 1] = this.baseColor[p3 + 1] * t;
      this.colors[p3 + 2] = this.baseColor[p3 + 2] * t;
    }
    this.geom.setDrawRange(0, this.count);
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
    if (!anyAlive) this.count = 0;
  }
}
