// Entry point: renderer + scene wiring, spawn pre-warm, input → break/place,
// block highlight, and the main render loop.

import * as THREE from 'three';
import Stats from 'stats.js';

import { REACH, SEA_LEVEL, WORLD_SEED } from './constants.js';
import { AIR, WATER, BEDROCK } from './blocks.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { SFX } from './audio.js';
import { HUD } from './ui.js';
import { voxelRaycast } from './raycast.js';
import { waterTime } from './materials.js';
import { blockTint } from './textures.js';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.sortObjects = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// ---------- Systems ----------
const world = new World(scene, WORLD_SEED);
const player = new Player(camera, renderer.domElement, world);
const sky = new Sky(scene, camera);
const particles = new Particles(scene);
const sfx = new SFX();
const hud = new HUD();

const stats = new Stats();
stats.showPanel(0);
const statsWrap = document.createElement('div');
statsWrap.id = 'stats-wrap';
statsWrap.appendChild(stats.dom);
stats.dom.style.position = 'relative';
document.getElementById('ui').appendChild(statsWrap);

// ---------- Block highlight ----------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: true }),
);
highlight.visible = false;
scene.add(highlight);

// ---------- Spawn: find land near origin, pre-warm chunks ----------
function pickSpawn() {
  for (let r = 0; r < 40; r++) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a) * r) + 8;
      const z = Math.round(Math.sin(a) * r) + 8;
      if (world.gen.heightAt(x, z) > SEA_LEVEL + 1) return [x + 0.5, z + 0.5];
    }
  }
  return [8.5, 8.5];
}
const [spawnX, spawnZ] = pickSpawn();
player.pos.set(spawnX, 100, spawnZ);

// Generate/mesh the immediate area before play (bounded time).
world.update(spawnX, spawnZ);
{
  const t0 = performance.now();
  while (performance.now() - t0 < 500 && !world.isReady(spawnX, spawnZ)) {
    world.processQueues(40);
  }
  // a few more passes so the spawn neighbourhood is meshed
  for (let i = 0; i < 8; i++) world.processQueues(25);
}
player.pos.y = world.surfaceHeight(Math.floor(spawnX), Math.floor(spawnZ)) + 2;
let spawnReady = true;

// ---------- Pointer lock / overlay ----------
const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
  sfx.ensure();
});
document.addEventListener('pointerlockchange', () => {
  overlay.classList.toggle('hidden', document.pointerLockElement === renderer.domElement);
});

// ---------- Mouse interaction ----------
let mouseLeft = false, mouseRight = false;
let breakCD = 0, placeCD = 0;
renderer.domElement.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) { mouseLeft = true; breakCD = 0; }
  if (e.button === 2) { mouseRight = true; placeCD = 0; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseLeft = false;
  if (e.button === 2) mouseRight = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
function castFromEye() {
  player.eyePosition(_eye);
  camera.getWorldDirection(_dir);
  return voxelRaycast(_eye, _dir, REACH, (x, y, z) => world.getBlock(x, y, z));
}

function aabbHitsPlayer(cx, cy, cz) {
  const p = player.pos;
  return (
    cx + 1 > p.x - 0.3 && cx < p.x + 0.3 &&
    cy + 1 > p.y && cy < p.y + 1.8 &&
    cz + 1 > p.z - 0.3 && cz < p.z + 0.3
  );
}

function doBreak() {
  const hit = castFromEye();
  if (!hit.hit) return;
  const id = world.getBlock(hit.x, hit.y, hit.z);
  if (id === BEDROCK) return; // keep the world floor
  if (world.setBlock(hit.x, hit.y, hit.z, AIR)) {
    particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, blockTint(id));
    sfx.break();
  }
}

function doPlace() {
  const hit = castFromEye();
  if (!hit.hit) return;
  const { px, py, pz } = hit;
  const target = world.getBlock(px, py, pz);
  if (target !== AIR && target !== WATER) return;
  if (aabbHitsPlayer(px, py, pz)) return;
  if (world.setBlock(px, py, pz, hud.selectedBlock())) sfx.place();
}

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  stats.begin();
  const dt = Math.min(clock.getDelta(), 0.1);

  if (spawnReady && player.locked) {
    player.update(dt);
    // footstep audio
    if (player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1.4) sfx.step();
  } else if (spawnReady) {
    // keep camera positioned even when unlocked
    player.update(0);
  }

  world.update(player.pos.x, player.pos.z);
  world.processQueues(6);

  sky.update(dt);
  hud.setClock(sky.clockString());
  waterTime.value += dt;

  // interaction cooldowns
  breakCD -= dt; placeCD -= dt;
  if (player.locked) {
    if (mouseLeft && breakCD <= 0) { doBreak(); breakCD = 0.22; }
    if (mouseRight && placeCD <= 0) { doPlace(); placeCD = 0.25; }
  }

  // targeting highlight
  const hit = castFromEye();
  if (hit.hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else {
    highlight.visible = false;
  }

  particles.update(dt);
  renderer.render(scene, camera);
  stats.end();
}
frame();

// Expose a few internals for debugging in the console.
window.__game = { world, player, sky, scene, renderer };
