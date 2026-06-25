// The renderer + post-processing chain that gives GunGame its modern look: PBR with
// ACES-filmic tonemapping, soft real-time shadows, ambient occlusion, bloom and SMAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

// Build the composer chain. `opts.ssao` toggles ambient occlusion (off on weak GPUs).
export function createComposer(renderer, scene, camera, opts = {}) {
  const w = window.innerWidth, h = window.innerHeight;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  let ssao = null;
  if (opts.ssao !== false) {
    ssao = new SSAOPass(scene, camera, w, h);
    ssao.kernelRadius = 0.6;
    ssao.minDistance = 0.0008;
    ssao.maxDistance = 0.06;
    ssao.output = SSAOPass.OUTPUT.Default;   // AO blended into the beauty pass
    composer.addPass(ssao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.7, 0.85);   // strength, radius, threshold
  composer.addPass(bloom);
  composer.addPass(new OutputPass());            // tonemap + sRGB
  const smaa = new SMAAPass(w, h);
  composer.addPass(smaa);

  function setSize(width, height) {
    composer.setSize(width, height);
    bloom.setSize(width, height);
    if (ssao) ssao.setSize(width, height);
  }
  return { composer, bloom, ssao, render: () => composer.render(), setSize };
}
