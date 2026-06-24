// Cinematic post-processing: an EffectComposer chain of colour grade (with the
// ZA WARUDO time-stop monochrome), gravitational lensing around black holes, bloom
// and FXAA. Self-contained — `createPostFX` takes the renderer/scene/camera and the
// black-hole manager (for lens fields) and returns the render + control surface.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTimeStop: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTimeStop; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.95, 0.35, length(d));   // soft, gentle vignette
      c.rgb *= mix(0.84, 1.0, vig);
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;              // gentle contrast
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.22);               // a touch more vibrance
      // ZA WARUDO: time stops — drain colour to a cold monochrome + deepen the vignette.
      if (uTimeStop > 0.001) {
        float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        vec3 mono = vec3(g) * vec3(0.82, 0.86, 1.1);
        c.rgb = mix(c.rgb, mono, uTimeStop);
        c.rgb *= mix(1.0, mix(0.42, 1.06, vig), uTimeStop);
      }
      gl_FragColor = c;
    }`,
};

// Gravitational lensing: a full-screen pass (before bloom) that bends sample
// coordinates radially toward each singularity with a frame-dragging swirl.
const MAX_LENS = 3;
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenters: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uParams: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },   // x = radius (aspect-uv), y = strength
    uCount: { value: 0 },
    uAspect: { value: 1.0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    #define MAX_LENS ${MAX_LENS}
    uniform sampler2D tDiffuse;
    uniform vec2 uCenters[MAX_LENS];
    uniform vec2 uParams[MAX_LENS];
    uniform int uCount;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      float dark = 1.0;
      for (int i = 0; i < MAX_LENS; i++) {
        if (i >= uCount) break;
        vec2 c = uCenters[i]; float r = uParams[i].x, s = uParams[i].y;
        if (r <= 0.0) continue;
        vec2 d = (uv - c) * vec2(uAspect, 1.0);
        float dist = length(d);
        if (dist < r) {
          float t = dist / r;                       // 0 centre .. 1 rim
          float f = pow(1.0 - t, 2.2);              // falloff toward the rim
          float ang = s * f * 1.05;                 // frame-dragging swirl
          float ca = cos(ang), sa = sin(ang);
          vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
          rd *= 1.0 - s * f * 0.88;                 // pull inward (magnify the lensed ring)
          uv = c + rd / vec2(uAspect, 1.0);
          dark *= mix(1.0, 0.22, smoothstep(0.2 * r, 0.0, dist) * min(1.0, s));  // event-horizon shadow
        }
      }
      gl_FragColor = vec4(texture2D(tDiffuse, uv).rgb * dark, 1.0);
    }`,
};

export function createPostFX({ renderer, scene, camera, blackholes }) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.52, 0.55, 0.78);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  const fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);

  const lensPass = new ShaderPass(LensShader);
  lensPass.enabled = false;
  composer.insertPass(lensPass, 1);   // after RenderPass, before bloom

  const _lensFields = [];
  const _lensC = new THREE.Vector3(), _lensE = new THREE.Vector3(), _camRight = new THREE.Vector3();
  function updateLens() {
    const holes = blackholes.lensFields(_lensFields);
    const u = lensPass.uniforms;
    if (holes.length) { camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); }   // camera moved this frame; project from fresh matrices
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0);   // camera right axis (world)
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    let n = 0;
    for (const h of holes) {
      if (n >= MAX_LENS) break;
      _lensC.set(h.x, h.y, h.z).project(camera);
      if (_lensC.z > 1) continue;                            // behind the camera
      _lensE.set(h.x, h.y, h.z).addScaledVector(_camRight, h.rad).project(camera);
      const r = Math.abs((_lensE.x - _lensC.x) * 0.5) * aspect;   // world radius → aspect-corrected uv
      u.uCenters.value[n].set(_lensC.x * 0.5 + 0.5, _lensC.y * 0.5 + 0.5);
      u.uParams.value[n].set(r, h.str);
      n++;
    }
    u.uCount.value = n; u.uAspect.value = aspect;
    lensPass.enabled = n > 0;
  }
  function sizePost() {
    const w = window.innerWidth, h = window.innerHeight, pr = renderer.getPixelRatio();
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
    fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }
  sizePost();

  return {
    render: () => composer.render(),
    sizePost,
    updateLens,
    setTimeStop: (v) => { gradePass.uniforms.uTimeStop.value = v; },
    get lensState() { return { on: lensPass.enabled, count: lensPass.uniforms.uCount.value, r: +lensPass.uniforms.uParams.value[0].x.toFixed(3), s: +lensPass.uniforms.uParams.value[0].y.toFixed(2) }; },
  };
}
