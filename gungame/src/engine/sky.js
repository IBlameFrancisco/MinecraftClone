// Sky, sun and ambient lighting. A stylized gradient sky dome + matching fog, a warm
// directional sun that casts soft shadows over the arena, a hemisphere fill, and a
// neutral PMREM environment so PBR metals/plastics catch nice reflections.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createSky(scene, renderer) {
  // --- gradient sky dome ---
  const skyGeo = new THREE.SphereGeometry(600, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3d72b8) },
      mid: { value: new THREE.Color(0x9fc0e0) },
      bot: { value: new THREE.Color(0xe8d6b8) },
    },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vp; uniform vec3 top, mid, bot;
      void main(){
        float h = normalize(vp).y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bot, pow(-h, 0.5));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xb9cbdc, 70, 330);

  // --- neutral PBR environment (reflections) ---
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // --- sun (key light + shadows) ---
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.6);
  sun.position.set(60, 95, 40);
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

  // --- fills ---
  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x6b5a44, 0.7);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(amb);

  return { sun, hemi, sky };
}
