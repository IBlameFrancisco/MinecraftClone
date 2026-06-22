// Lightweight GPU particle pool for block-break bursts, impact sparks, blood,
// explosions, smoke and ability effects. A single THREE.Points object with
// recycled per-particle position / colour / size attributes. A small custom
// shader gives us round, soft-edged, per-particle-sized sprites with additive-
// friendly alpha falloff — all driven from pooled typed arrays so the hot
// update loop never allocates.

import * as THREE from 'three';

const MAX = 600;

// Approximate world-space ground height. Particles settle/slide here instead of
// raining forever or vanishing abruptly. Kept low so it's harmless if a burst
// happens above it; purely a cosmetic "things land on something" cue.
const GROUND_Y = 0.02;

export class Particles {
  constructor(scene) {
    this.geom = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.sizes = new Float32Array(MAX);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geom.setDrawRange(0, 0);

    // Custom point shader: per-particle size with distance attenuation, plus a
    // soft radial alpha falloff so points read as little glowing puffs rather
    // than hard squares. Falls back gracefully — it's just colour * smooth disc.
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 520.0 }, // pixels-per-world-unit-ish; tuned for size ~0.14
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float size;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Size attenuation by distance, clamped so near particles don't blow up.
          float s = size * (uScale / max(-mv.z, 0.1));
          gl_PointSize = clamp(s, 1.0, 64.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          // Radial distance from point centre (gl_PointCoord is 0..1).
          vec2 d = gl_PointCoord - vec2(0.5);
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;            // outside the disc
          // Soft edge + gentle core glow.
          float a = smoothstep(0.25, 0.02, r2);
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    // ShaderMaterial with vertexColors needs the color attribute enabled.
    mat.vertexColors = true;

    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Particle state (all pooled, indexed by slot).
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.baseColor = new Float32Array(MAX * 3);
    this.baseSize = new Float32Array(MAX); // per-particle base size for fade scaling
    this.drag = new Float32Array(MAX);     // per-particle air-drag coefficient
    this.count = 0; // high-water mark of active slots
    this.cursor = 0;
  }

  burst(x, y, z, rgb, n = 16) {
    // Normalise incoming colour once (callers pass [r,g,b] in 0..255).
    const cr = rgb[0] / 255, cg = rgb[1] / 255, cb = rgb[2] / 255;

    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      if (idx + 1 > this.count) this.count = idx + 1;

      const p3 = idx * 3;

      // Spawn within a small jittered sphere so the burst origin isn't a point.
      this.positions[p3] = x + (Math.random() - 0.5) * 0.6;
      this.positions[p3 + 1] = y + (Math.random() - 0.5) * 0.6;
      this.positions[p3 + 2] = z + (Math.random() - 0.5) * 0.6;

      // Velocity: outward scatter on the horizontal plane with a strong upward
      // pop, biased so most debris arcs up-and-out for a satisfying spray.
      const ang = Math.random() * Math.PI * 2;
      const spread = 1.4 + Math.random() * 2.4;
      this.vel[p3] = Math.cos(ang) * spread;
      this.vel[p3 + 1] = Math.random() * 3.6 + 1.0;
      this.vel[p3 + 2] = Math.sin(ang) * spread;

      // Per-particle air drag: lighter bits (smaller) float and slow more.
      this.drag[idx] = 1.0 + Math.random() * 1.6;

      // Colour: per-particle shade plus a touch of hue jitter so the burst
      // reads as organic instead of a flat block of one colour.
      const shade = 0.7 + Math.random() * 0.45;
      const jr = (Math.random() - 0.5) * 0.10;
      const jg = (Math.random() - 0.5) * 0.10;
      const jb = (Math.random() - 0.5) * 0.10;
      const r = clamp01((cr + jr) * shade);
      const g = clamp01((cg + jg) * shade);
      const b = clamp01((cb + jb) * shade);
      this.baseColor[p3] = r; this.baseColor[p3 + 1] = g; this.baseColor[p3 + 2] = b;
      this.colors[p3] = r; this.colors[p3 + 1] = g; this.colors[p3 + 2] = b;

      // Per-particle size variety; stored as a base so we can fade it over life.
      const bs = 0.10 + Math.random() * 0.10;
      this.baseSize[idx] = bs;
      this.sizes[idx] = bs;

      this.maxLife[idx] = this.life[idx] = 0.5 + Math.random() * 0.4;
    }
  }

  update(dt) {
    // Guard against huge frame steps (tab refocus) so particles don't teleport.
    if (dt > 0.1) dt = 0.1;

    let anyAlive = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      this.life[i] -= dt;
      const p3 = i * 3;

      if (this.life[i] <= 0) {
        // Park dead particles: zero them out so they fully vanish.
        this.colors[p3] = this.colors[p3 + 1] = this.colors[p3 + 2] = 0;
        this.sizes[i] = 0;
        this.positions[p3 + 1] = -9999;
        continue;
      }

      // Gravity.
      this.vel[p3 + 1] -= 11 * dt;

      // Air drag (exponential-ish velocity decay). Frame-rate aware via dt.
      const k = 1 - this.drag[i] * dt;
      const damp = k < 0 ? 0 : k;
      this.vel[p3] *= damp;
      this.vel[p3 + 1] *= damp;
      this.vel[p3 + 2] *= damp;

      // Integrate.
      this.positions[p3] += this.vel[p3] * dt;
      this.positions[p3 + 1] += this.vel[p3 + 1] * dt;
      this.positions[p3 + 2] += this.vel[p3 + 2] * dt;

      // Ground settle: bounce a little then slide, so particles don't sink
      // through the world or pop out of existence mid-air.
      if (this.positions[p3 + 1] < GROUND_Y) {
        this.positions[p3 + 1] = GROUND_Y;
        if (this.vel[p3 + 1] < 0) this.vel[p3 + 1] *= -0.28; // damped bounce
        // Friction on the ground.
        this.vel[p3] *= 0.7;
        this.vel[p3 + 2] *= 0.7;
      }

      // Life ratio 1 -> 0.
      const t = this.life[i] / this.maxLife[i];

      // Alpha-ish fade via colour: ease-out so particles hold their colour and
      // then fall off quickly near the end (t*t reads as a gentle fade-out).
      const fade = t * t;
      this.colors[p3] = this.baseColor[p3] * fade;
      this.colors[p3 + 1] = this.baseColor[p3 + 1] * fade;
      this.colors[p3 + 2] = this.baseColor[p3 + 2] * fade;

      // Size fade: a quick pop-in at birth then a smooth shrink, so particles
      // grow into view and taper out rather than blinking off.
      const grow = t > 0.85 ? (1.0 - t) / 0.15 : 1.0; // first ~15% of life pops in
      const shrink = 0.35 + 0.65 * t;                  // never fully zero until death
      this.sizes[i] = this.baseSize[i] * grow * shrink;
    }

    this.geom.setDrawRange(0, this.count);
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
    this.geom.attributes.size.needsUpdate = true;
    if (!anyAlive) this.count = 0;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
