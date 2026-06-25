// Lighting: a REAL HDRI sky for image-based lighting + the visible background (loaded by
// assets.js), plus a warm directional sun that casts crisp real-time shadows the HDRI
// alone can't. A touch of distance fog keyed to the horizon ties the geometry into the sky.
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
  // horizon-keyed haze so far geometry melts into the sky (background is unaffected)
  scene.fog = new THREE.Fog(0xc6d2dc, 120, 360);

  // --- sun (key light + the only real shadow caster) ---
  const sun = new THREE.DirectionalLight(0xfff1d4, 2.4);
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
  scene.add(sun);
  scene.add(sun.target);

  // --- gentle fills (the HDRI already does most of the ambient work) ---
  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x6b5a44, 0.25);
  scene.add(hemi);

  return { sun, hemi };
}
