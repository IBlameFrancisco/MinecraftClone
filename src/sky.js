// Gradient sky dome, distance fog, sun/moon, and a smooth day/night cycle that
// drives sky colours, fog colour, and the global world light tint together.

import * as THREE from 'three';
import { DAY_LENGTH, RENDER_DISTANCE, CHUNK_SIZE } from './constants.js';
import { setWorldTint, setWaterEnv } from './materials.js';

// sRGB colour helper -> linear THREE.Color (matches renderer output pipeline).
function sc(r, g, b) {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

// Palettes (authored in sRGB 0..1): [skyTop, horizon].
const DAY = [sc(0.27, 0.52, 0.92), sc(0.66, 0.80, 0.95)];
const NIGHT = [sc(0.02, 0.03, 0.09), sc(0.05, 0.08, 0.18)];
const DUSK = [sc(0.21, 0.24, 0.46), sc(0.95, 0.49, 0.26)];

// Light tints applied to the world (already ~linear multipliers).
const LIGHT_DAY = new THREE.Color(1.0, 0.99, 0.96);
const LIGHT_NIGHT = new THREE.Color(0.17, 0.21, 0.34);
const LIGHT_DUSK = new THREE.Color(1.0, 0.66, 0.45);

// ---- Horror mode (battle arena): a perpetual blood-dark, fog-choked night. ----
const HORROR_TOP = sc(0.018, 0.006, 0.012);
const HORROR_HORIZON = sc(0.11, 0.018, 0.024);
const HORROR_FOG = sc(0.05, 0.015, 0.02);
const HORROR_TINT = new THREE.Color(0.30, 0.20, 0.22);
const _MOON_DIR = new THREE.Vector3(0.35, 0.78, 0.3).normalize();

function radialSprite(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0.30; // start mid-morning

    // Dome
    const geo = new THREE.SphereGeometry(600, 32, 16);
    this.uniforms = {
      topColor: { value: DAY[0].clone() },
      horizonColor: { value: DAY[1].clone() },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          float t = pow(clamp(h, 0.0, 1.0), 0.55);
          vec3 col = mix(horizonColor, topColor, t);
          // slight darkening below the horizon
          col = mix(col, horizonColor * 0.55, clamp(-h * 1.5, 0.0, 1.0));
          // colour is consumed by the post pipeline (OutputPass) in linear space
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // Fog matched to the horizon colour.
    const far = (RENDER_DISTANCE - 0.5) * CHUNK_SIZE;
    this.fog = new THREE.Fog(DAY[1].clone(), far * 0.45, far);
    scene.fog = this.fog;

    // Sun + moon billboards.
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite('rgba(255,250,230,1)', 'rgba(255,240,200,0)'),
      transparent: true, depthWrite: false, depthTest: false, fog: false,
    }));
    this.sun.scale.setScalar(60);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite('rgba(220,228,245,1)', 'rgba(180,195,230,0)'),
      transparent: true, depthWrite: false, depthTest: false, fog: false,
    }));
    this.moon.scale.setScalar(40);
    scene.add(this.sun, this.moon);

    // Drifting cloud layer.
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(3200, 3200),
      new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.8 }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 145;
    this.clouds.renderOrder = -1;
    scene.add(this.clouds);

    this._tmpTop = new THREE.Color();
    this._tmpHorizon = new THREE.Color();
    this._tmpLight = new THREE.Color();

    // Exposed for entity lighting / mob spawning / water.
    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.3);
    this.isNight = false;
    this.dirColor = new THREE.Color(1, 1, 1);
    this.dirIntensity = 1;
    this.ambIntensity = 0.6;
    this.horror = false;
    this._flick = 1;
    this._flickT = 0;
    this._normalFog = [this.fog.near, this.fog.far];
  }

  // Toggle the creepy battle-arena atmosphere.
  setHorror(on) {
    if (this.horror === on) return;
    this.horror = on;
    if (!on) {
      // restore the sun/moon/cloud look the day/night cycle expects
      this.fog.near = this._normalFog[0]; this.fog.far = this._normalFog[1];
      this.moon.material.color.setRGB(1, 1, 1); this.moon.scale.setScalar(40);
      this.sun.material.color.setRGB(1, 1, 1); this.clouds.material.opacity = 0.8;
    }
  }

  update(dt) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    if (this.horror) return this._updateHorror(dt);

    // Sun angle: noon at t=0.25, midnight at t=0.75.
    const ang = this.time * Math.PI * 2 - Math.PI / 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    const e = sunDir.y; // elevation -1..1

    // Blend weights between day / dusk / night.
    const dayW = smooth(0.04, 0.32, e);
    const nightW = smooth(0.04, 0.30, -e);
    let duskW = 1 - dayW - nightW;
    if (duskW < 0) duskW = 0;
    const sum = dayW + nightW + duskW || 1;

    blend3(this._tmpTop, DAY[0], NIGHT[0], DUSK[0], dayW / sum, nightW / sum, duskW / sum);
    blend3(this._tmpHorizon, DAY[1], NIGHT[1], DUSK[1], dayW / sum, nightW / sum, duskW / sum);
    blend3(this._tmpLight, LIGHT_DAY, LIGHT_NIGHT, LIGHT_DUSK, dayW / sum, nightW / sum, duskW / sum);

    this.uniforms.topColor.value.copy(this._tmpTop);
    this.uniforms.horizonColor.value.copy(this._tmpHorizon);
    this.fog.color.copy(this._tmpHorizon);
    setWorldTint(this._tmpLight.r, this._tmpLight.g, this._tmpLight.b);

    // Drive water + entity lighting from the same solar state.
    this.sunDir.copy(sunDir);
    this.isNight = e < -0.04;
    this.dirColor.copy(this._tmpLight);
    this.dirIntensity = THREE.MathUtils.clamp(e * 1.3 + 0.55, 0.12, 1.1);
    this.ambIntensity = THREE.MathUtils.clamp(0.45 + e * 0.3, 0.32, 0.78);
    setWaterEnv(sunDir, this._tmpHorizon, e < 0 ? 0.82 : 0.74);

    // Keep dome centred; place sun/moon on the celestial sphere.
    const cam = this.camera.position;
    this.dome.position.copy(cam);
    this.sun.position.copy(cam).addScaledVector(sunDir, 480);
    this.moon.position.copy(cam).addScaledVector(sunDir, -480);
    this.sun.material.opacity = THREE.MathUtils.clamp(e * 4 + 0.4, 0, 1);
    this.moon.material.opacity = THREE.MathUtils.clamp(-e * 4 + 0.2, 0, 1);

    // Clouds drift and follow the camera; tinted by the day/night light.
    this.clouds.position.x = cam.x;
    this.clouds.position.z = cam.z;
    this.clouds.material.map.offset.x += dt * 0.004;
    this.clouds.material.map.offset.y += dt * 0.0016;
    this.clouds.material.color.copy(this._tmpLight);
    this.clouds.material.opacity = 0.8 * THREE.MathUtils.clamp(e * 3 + 0.5, 0.25, 1);

    return this.time;
  }

  // Perpetual blood-dark night with heavy, close fog and a flickering dim tint
  // (like failing torches) — the battle arena's horror atmosphere.
  _updateHorror(dt) {
    this._flickT += dt;
    // mostly steady, with a slow breathe + occasional sharp dips (a guttering flame)
    const breathe = 0.92 + 0.08 * Math.sin(this._flickT * 2.7);
    const dip = (Math.random() < 0.035) ? 0.55 + Math.random() * 0.25 : 1.0;
    this._flick += (breathe * dip - this._flick) * Math.min(1, 11 * dt);
    const f = this._flick;

    this.uniforms.topColor.value.copy(HORROR_TOP).multiplyScalar(f);
    this.uniforms.horizonColor.value.copy(HORROR_HORIZON).multiplyScalar(f);
    this.fog.color.copy(HORROR_FOG).multiplyScalar(f);
    this.fog.near = 9; this.fog.far = 58;
    setWorldTint(HORROR_TINT.r * f, HORROR_TINT.g * f, HORROR_TINT.b * f);

    // Entity (bot/mob) lighting — dim and grim so figures read as shadows.
    this.isNight = true;
    this.sunDir.set(0.3, 0.55, 0.25).normalize();
    this.dirColor.copy(HORROR_TINT);
    this.dirIntensity = 0.4 * f;
    this.ambIntensity = 0.34 * f;
    setWaterEnv(this.sunDir, HORROR_HORIZON, 0.85);

    // Blood moon hangs overhead; no sun, only faint roiling clouds.
    const cam = this.camera.position;
    this.dome.position.copy(cam);
    this.sun.material.opacity = 0;
    this.moon.material.color.setRGB(0.75, 0.11, 0.09);
    this.moon.scale.setScalar(78);
    this.moon.material.opacity = 0.9 * f;
    this.moon.position.copy(cam).addScaledVector(_MOON_DIR, 470);
    this.clouds.position.x = cam.x; this.clouds.position.z = cam.z;
    this.clouds.material.map.offset.x += dt * 0.0026;
    this.clouds.material.map.offset.y += dt * 0.0012;
    this.clouds.material.color.setRGB(0.18 * f, 0.045 * f, 0.05 * f);
    this.clouds.material.opacity = 0.3;
    return this.time;
  }

  clockString() {
    if (this.horror) return '🩸 the witching hour';
    // Map t=0.25 -> 12:00, t=0 -> 06:00, t=0.5 -> 18:00.
    const hours = (this.time * 24 + 6) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    const isDay = this.time > 0.0 && this.time < 0.5;
    return `${isDay ? '☀' : '☾'} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 8 + Math.random() * 42;
    const a = 0.06 + Math.random() * 0.16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smooth(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function blend3(out, c1, c2, c3, w1, w2, w3) {
  out.setRGB(
    c1.r * w1 + c2.r * w2 + c3.r * w3,
    c1.g * w1 + c2.g * w2 + c3.g * w3,
    c1.b * w1 + c2.b * w2 + c3.b * w3,
    THREE.LinearSRGBColorSpace,
  );
}
