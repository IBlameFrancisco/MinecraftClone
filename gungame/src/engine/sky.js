// Lighting + atmosphere. A REAL HDRI sky drives image-based lighting + the visible
// background (loaded by assets.js). On top of that: a warm directional key sun casting
// soft real-time shadows, a cool rim/back light so silhouettes separate from the sky,
// horizon-keyed haze, and a faint field of drifting dust motes for depth.
import * as THREE from 'three';
import { ENV } from './assets.js';

// Sky/sun tuning for the golden-hour look. ENV_ROT spins the HDRI so its bright sun lines
// up with SUN_DIR (the direction the key light comes FROM); tuned by eye against renders.
const ENV_ROT = 2.1;                                  // radians, Y rotation of the sky
const SUN_DIR = new THREE.Vector3(80, 34, 52);        // low, warm afternoon sun

export function createSky(scene, renderer) {
  // --- real HDRI environment: IBL (reflections/fill) + visible sky ---
  if (ENV.map) scene.environment = ENV.map;
  if (ENV.background) {
    scene.background = ENV.background;
    scene.backgroundBlurriness = 0.0;
    scene.backgroundIntensity = 0.62;   // dim the blinding low-sun disc
  }
  // rotate both the visible sky and the lighting it casts together
  scene.backgroundRotation = new THREE.Euler(0, ENV_ROT, 0);
  scene.environmentRotation = new THREE.Euler(0, ENV_ROT, 0);
  // warm low-sun haze so far geometry melts into the golden sky
  scene.fog = new THREE.Fog(0xcdb89a, 95, 330);

  // --- key sun (warm golden, the main shadow caster) ---
  const sun = new THREE.DirectionalLight(0xffdca6, 3.4);
  sun.position.copy(SUN_DIR);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 340;
  const S = 110;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;                    // softer PCF penumbra
  scene.add(sun);
  scene.add(sun.target);

  // --- cool rim / back light: rakes the shadowed side so shapes pop (golden vs teal) ---
  const rim = new THREE.DirectionalLight(0x88a8e0, 0.8);
  rim.position.set(-70, 36, -64);
  scene.add(rim);

  // --- gentle sky/ground fill (HDRI does most of the ambient work) ---
  const hemi = new THREE.HemisphereLight(0xcdd2e0, 0x5a4632, 0.3);
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
