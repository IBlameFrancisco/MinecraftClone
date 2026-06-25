// Loads the real assets (HDRI environment + PBR texture sets + a rigged, animated
// character model) at boot. Everything the renderer/materials/characters need is exposed
// here once `loadAssets()` resolves.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = import.meta.env.BASE_URL || '/';
export const TEX = {};      // TEX.ground = { map, normalMap, roughnessMap }, etc.
export const ENV = { map: null, background: null };
export const MODELS = { soldier: null, crate: null, barrel: null, crateStrong: null, container: null, barrier: null };

const SETS = ['ground', 'wood', 'metal', 'rust'];

function loadTex(loader, url, srgb) {
  return new Promise((res, rej) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, rej));
}

export async function loadAssets(renderer) {
  const tl = new THREE.TextureLoader();
  await Promise.all(SETS.map(async (s) => {
    const [map, normalMap, roughnessMap] = await Promise.all([
      loadTex(tl, `${BASE}tex/${s}_albedo.jpg`, true),
      loadTex(tl, `${BASE}tex/${s}_normal.jpg`, false),
      loadTex(tl, `${BASE}tex/${s}_rough.jpg`, false),
    ]);
    TEX[s] = { map, normalMap, roughnessMap };
  }));

  const hdr = await new RGBELoader().loadAsync(`${BASE}hdri/sky.hdr`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  ENV.map = pmrem.fromEquirectangular(hdr).texture;   // image-based lighting + reflections
  ENV.background = hdr;                                // the visible sky

  // rigged + animated character (Idle / Walk / Run / TPose clips) + static CC0 props
  const loader = new GLTFLoader();
  const [soldier, crate, barrel, crateStrong, container, barrier] = await Promise.all([
    loader.loadAsync(`${BASE}models/soldier.glb`),
    loader.loadAsync(`${BASE}models/crate.glb`),
    loader.loadAsync(`${BASE}models/barrel.glb`),
    loader.loadAsync(`${BASE}models/crateStrong.glb`),
    loader.loadAsync(`${BASE}models/container.glb`),
    loader.loadAsync(`${BASE}models/barrier.glb`),
  ]);
  MODELS.soldier = { scene: soldier.scene, animations: soldier.animations };
  MODELS.crate = { scene: crate.scene };
  MODELS.barrel = { scene: barrel.scene };
  MODELS.crateStrong = { scene: crateStrong.scene };
  MODELS.container = { scene: container.scene };
  MODELS.barrier = { scene: barrier.scene };
}
