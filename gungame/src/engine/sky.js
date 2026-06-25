// Lighting + atmosphere. A REAL HDRI sky drives image-based lighting + the visible
// background (loaded by assets.js). On top of that: a warm directional key sun casting
// soft real-time shadows, a cool rim/back light so silhouettes separate from the sky,
// horizon-keyed haze, and a faint field of drifting dust motes for depth.
import * as THREE from 'three';
import { ENV } from './assets.js';

export function createSky(scene, renderer) {
  // --- real HDRI environment: IBL (reflections/fill) + visible sky ---
  if (ENV.map) scene.environment = ENV.map;
  if (ENV.background) {
    scene.background = ENV.background;
    scene.backgroundBlurriness = 0.0;
    scene.backgroundIntensity = 1.0;
  }
  // atmospheric haze so far geometry melts into the sky (background is unaffected)
  scene.fog = new THREE.Fog(0xbcc8d6, 90, 320);

  // --- key sun (warm, the main shadow caster) ---
  const sun = new THREE.DirectionalLight(0xfff0cf, 3.1);
  sun.position.set(72, 96, 38);            // roughly matches the HDRI's bright quadrant
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  const S = 110;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;                    // softer PCF penumbra
  scene.add(sun);
  scene.add(sun.target);

  // --- cool rim / back light: rakes the far side so shapes pop off the sky ---
  const rim = new THREE.DirectionalLight(0x9fc2ff, 0.7);
  rim.position.set(-64, 44, -72);
  scene.add(rim);

  // --- gentle sky/ground fill (HDRI does most of the ambient work) ---
  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x584a38, 0.32);
  scene.add(hemi);

  // --- drifting dust motes (subtle atmosphere + parallax depth) ---
  const motes = makeMotes();
  scene.add(motes);

  return { sun, hemi, rim, motes };
}

// A faint volume of additive specks that slowly drifts — reads as airborne dust catching
// the light, especially against the shadowed geometry. Cheap and purely decorative.
function makeMotes() {
  const N = 650, R = 92, H = 26;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * R;
    pos[i * 3 + 1] = Math.random() * H + 1.0;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * R;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color: 0xfff0d8, size: 0.07, sizeAttenuation: true,
    transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  let t = 0;
  pts.onBeforeRender = () => { t += 0.016; pts.rotation.y = t * 0.008; pts.position.y = Math.sin(t * 0.15) * 0.4; };
  return pts;
}
