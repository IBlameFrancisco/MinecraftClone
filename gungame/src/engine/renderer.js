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
  renderer.toneMappingExposure = 1.0;
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
    contrast: { value: 1.16 },
    saturation: { value: 1.14 },
    vignette: { value: 0.38 },
    grain: { value: 0.035 },
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
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // cinematic split-tone: cool shadows, warm highlights
      vec3 shadowTint = vec3(0.96, 0.985, 1.07);
      vec3 highTint   = vec3(1.07, 1.015, 0.93);
      c *= mix(shadowTint, highTint, smoothstep(0.0, 0.85, l));
      // saturation
      c = mix(vec3(l), c, saturation);
      // vignette
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.9, 0.22, length(q) * (1.0 + vignette));
      c *= mix(1.0 - vignette, 1.0, v);
      // animated film grain (a touch stronger in shadows)
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(time)) - 0.5;
      c += g * grain * (1.2 - l);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// Build the composer chain. `opts.ao` toggles GTAO ambient occlusion (off on weak GPUs).
export function createComposer(renderer, scene, camera, opts = {}) {
  const w = window.innerWidth, h = window.innerHeight;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // SSAO — ambient occlusion that grounds every object with soft contact shadows the
  // HDRI/sun can't produce. (Widely GPU-compatible; GTAO silently no-ops on some drivers.)
  let gtao = null;   // kept name for the returned handle / A-B toggling
  if (opts.ao !== false) {
    gtao = new SSAOPass(scene, camera, w, h);
    gtao.kernelRadius = 4.0;
    gtao.minDistance = 0.002;
    gtao.maxDistance = 0.12;
    gtao.output = SSAOPass.OUTPUT.Default;
    composer.addPass(gtao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.75, 0.85);   // strength, radius, threshold
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
    if (gtao) gtao.setSize(width, height);
  }
  return { composer, bloom, gtao, grade, render, setSize };
}
