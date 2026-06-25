// The renderer + post-processing chain that gives GunGame its modern, filmic look: PBR
// with ACES-filmic tonemapping, soft real-time shadows, optional SSAO, bloom, a cinematic
// colour-grade (contrast / saturation / vignette / film grain) and SMAA antialiasing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

// Cinematic grade applied AFTER tonemap+sRGB (OutputPass): subtle contrast S-curve, a
// saturation lift, a soft vignette and animated film grain. Keeps the image from looking
// flat/CGI without crushing detail.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    contrast: { value: 1.12 },
    saturation: { value: 1.1 },
    vignette: { value: 0.36 },
    grain: { value: 0.04 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse;
    uniform float time, contrast, saturation, vignette, grain;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // contrast S-curve around mid grey
      c = (c - 0.5) * contrast + 0.5;
      // saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      // vignette
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(q) * (1.0 + vignette));
      c *= mix(1.0 - vignette, 1.0, v);
      // animated film grain
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(time)) - 0.5;
      c += g * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

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
    ssao.output = SSAOPass.OUTPUT.Default;
    composer.addPass(ssao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.7, 0.82);   // strength, radius, threshold
  composer.addPass(bloom);
  composer.addPass(new OutputPass());            // ACES tonemap + sRGB

  const grade = new ShaderPass(GradeShader);     // cinematic grade (post-tonemap)
  composer.addPass(grade);

  const smaa = new SMAAPass(w, h);
  composer.addPass(smaa);

  let t = 0;
  function render() { t += 1; grade.uniforms.time.value = t * 0.137; composer.render(); }
  function setSize(width, height) {
    composer.setSize(width, height);
    bloom.setSize(width, height);
    if (ssao) ssao.setSize(width, height);
  }
  return { composer, bloom, ssao, grade, render, setSize };
}
