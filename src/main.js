// Entry point: renderer + scene wiring, spawn pre-warm, game modes, survival
// (health/hunger/damage/death), inventory, mobs, breaking, and the render loop.

import * as THREE from 'three';
import Stats from 'stats.js';

import { REACH, SEA_LEVEL, WORLD_SEED } from './constants.js';
import {
  AIR, WATER, BEDROCK, GRASS, DIRT, STONE, COBBLE, COAL_ORE, IRON_ORE,
  LEAVES, GLASS, GLOWSTONE, hardness,
} from './blocks.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { SFX } from './audio.js';
import { HUD } from './ui.js';
import { Inventory } from './inventory.js';
import { Mobs } from './entities.js';
import { voxelRaycast } from './raycast.js';
import { waterTime } from './materials.js';
import { blockTint, CRACK_TEXTURES } from './textures.js';

const SURVIVAL = 0, CREATIVE = 1;
const MELEE_REACH = 4;

// What a broken block drops in survival.
const DROPS = { [GRASS]: DIRT, [STONE]: COBBLE, [LEAVES]: AIR, [GLASS]: AIR };
const dropFor = (id) => (DROPS[id] !== undefined ? DROPS[id] : id);

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

// Lights — used only by mob (Lambert) materials; chunks bake their own lighting.
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(ambient, sun);

// ---------- Systems ----------
const world = new World(scene, WORLD_SEED);
const player = new Player(camera, renderer.domElement, world);
const sky = new Sky(scene, camera);
const particles = new Particles(scene);
const sfx = new SFX();
const hud = new HUD();
const inventory = new Inventory((name) => hud.showName(name));
const mobs = new Mobs(scene, world);

let mode = CREATIVE;
let health = 20, hunger = 20, dead = false;
let invuln = 0, regenTimer = 0, hungerTimer = 0, starveTimer = 0;

player.setMode(CREATIVE);
inventory.setMode(true);
hud.setMode(false);
hud.setHealth(20); hud.setHunger(20);

const stats = new Stats();
stats.showPanel(0);
const statsWrap = document.createElement('div');
statsWrap.id = 'stats-wrap';
statsWrap.appendChild(stats.dom);
stats.dom.style.position = 'relative';
document.getElementById('ui').appendChild(statsWrap);

// ---------- Block highlight + breaking crack overlay ----------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }),
);
highlight.visible = false;
scene.add(highlight);

const crackMat = new THREE.MeshBasicMaterial({
  map: CRACK_TEXTURES[0], transparent: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.003, 1.003, 1.003), crackMat);
crackMesh.visible = false;
scene.add(crackMesh);

let breakKey = null, breakProgress = 0, breakCD = 0, placeCD = 0, attackCD = 0;
function resetBreak() { breakKey = null; breakProgress = 0; crackMesh.visible = false; }

// ---------- Spawn ----------
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
const SPAWN = new THREE.Vector3(spawnX, 100, spawnZ);
player.pos.copy(SPAWN);

world.update(spawnX, spawnZ);
{
  const t0 = performance.now();
  while (performance.now() - t0 < 500 && !world.isReady(spawnX, spawnZ)) world.processQueues(40);
  for (let i = 0; i < 8; i++) world.processQueues(25);
}
player.pos.y = world.surfaceHeight(Math.floor(spawnX), Math.floor(spawnZ)) + 2;
SPAWN.y = player.pos.y;

// ---------- Overlays (play / death) ----------
const overlay = document.getElementById('overlay');
const deathEl = document.createElement('div');
deathEl.id = 'death';
deathEl.innerHTML = `<div class="card"><h1>YOU DIED</h1><p class="play" id="respawn">↺ Respawn</p></div>`;
deathEl.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(60,0,0,0.55);backdrop-filter:blur(3px);pointer-events:auto;z-index:25;text-align:center;';
document.getElementById('ui').appendChild(deathEl);

function refreshOverlays() {
  const locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle('hidden', locked || inventory.open || dead);
  deathEl.style.display = dead ? 'flex' : 'none';
}
refreshOverlays();
overlay.addEventListener('click', () => { if (!dead && !inventory.open) { renderer.domElement.requestPointerLock(); sfx.ensure(); } });
document.addEventListener('pointerlockchange', refreshOverlays);
deathEl.querySelector('#respawn').addEventListener('click', () => respawn());

// ---------- Modes / damage / death ----------
function toggleMode() {
  mode = mode === CREATIVE ? SURVIVAL : CREATIVE;
  player.setMode(mode);
  inventory.setMode(mode === CREATIVE);
  hud.setMode(mode === SURVIVAL);
  if (mode === SURVIVAL) { health = 20; hunger = 20; hud.setHealth(20); hud.setHunger(20); }
  resetBreak();
}

function damagePlayer(dmg, srcX, srcZ) {
  if (mode !== SURVIVAL || dead || invuln > 0) return;
  health -= dmg; invuln = 0.5;
  hud.setHealth(Math.max(0, health)); hud.flashHurt(); sfx.break();
  if (srcX !== undefined) {
    const dx = player.pos.x - srcX, dz = player.pos.z - srcZ, d = Math.hypot(dx, dz) || 1;
    player.vel.x += (dx / d) * 6; player.vel.z += (dz / d) * 6; player.vel.y = 5;
  }
  if (health <= 0) die();
}
function die() { dead = true; document.exitPointerLock(); resetBreak(); refreshOverlays(); }
function respawn() {
  dead = false; health = 20; hunger = 20; hud.setHealth(20); hud.setHunger(20);
  player.pos.copy(SPAWN); player.vel.set(0, 0, 0);
  refreshOverlays(); renderer.domElement.requestPointerLock();
}

// ---------- Keyboard (E inventory, G mode) ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') {
    if (dead) return;
    if (inventory.open) { inventory.close(); refreshOverlays(); renderer.domElement.requestPointerLock(); }
    else { inventory.openScreen(); document.exitPointerLock(); refreshOverlays(); }
  } else if (e.code === 'Escape' && inventory.open) {
    inventory.close(); refreshOverlays();
  } else if (e.code === 'KeyG') {
    if (!dead && !inventory.open) toggleMode();
  }
});

// ---------- Mouse ----------
let mouseLeft = false, mouseRight = false;
renderer.domElement.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) { mouseLeft = true; breakCD = 0; attackCD = 0; }
  if (e.button === 2) { mouseRight = true; placeCD = 0; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseLeft = false; resetBreak(); }
  if (e.button === 2) mouseRight = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

const _dir = new THREE.Vector3(), _eye = new THREE.Vector3();
function castFromEye() {
  player.eyePosition(_eye);
  camera.getWorldDirection(_dir);
  return voxelRaycast(_eye, _dir, REACH, (x, y, z) => world.getBlock(x, y, z));
}
function aabbHitsPlayer(cx, cy, cz) {
  const p = player.pos;
  return cx + 1 > p.x - 0.3 && cx < p.x + 0.3 && cy + 1 > p.y && cy < p.y + 1.8 && cz + 1 > p.z - 0.3 && cz < p.z + 0.3;
}

function breakBlock(x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === BEDROCK || id === AIR) return;
  if (world.setBlock(x, y, z, AIR)) {
    particles.burst(x + 0.5, y + 0.5, z + 0.5, blockTint(id));
    sfx.break();
    if (mode === SURVIVAL) { const d = dropFor(id); if (d !== AIR) inventory.add(d, 1); }
  }
}

function handleBreak(hit, dt) {
  if (mode === CREATIVE) {
    if (breakCD <= 0) { breakBlock(hit.x, hit.y, hit.z); breakCD = 0.2; }
    return;
  }
  const id = world.getBlock(hit.x, hit.y, hit.z);
  const hard = hardness(id);
  if (!isFinite(hard)) { resetBreak(); return; }
  const key = `${hit.x},${hit.y},${hit.z}`;
  if (key !== breakKey) { breakKey = key; breakProgress = 0; }
  breakProgress += dt / hard;
  const stage = Math.min(9, Math.floor(breakProgress * 10));
  crackMat.map = CRACK_TEXTURES[stage]; crackMat.needsUpdate = true;
  crackMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  crackMesh.visible = true;
  if (Math.random() < 0.25) particles.burst(hit.x + 0.5, hit.y + 0.6, hit.z + 0.5, blockTint(id), 2);
  if (breakProgress >= 1) { breakBlock(hit.x, hit.y, hit.z); resetBreak(); }
}

function doPlace() {
  if (!inventory.canPlace()) return;
  const hit = castFromEye();
  if (!hit.hit) return;
  const { px, py, pz } = hit;
  const target = world.getBlock(px, py, pz);
  if (target !== AIR && target !== WATER) return;
  if (aabbHitsPlayer(px, py, pz)) return;
  if (world.setBlock(px, py, pz, inventory.selectedBlock())) {
    inventory.consumeSelected(); sfx.place();
  }
}

function attackOrBreak(dt) {
  const block = castFromEye();
  const mobHit = mobs.raycast(_eye, _dir, MELEE_REACH);
  const blockDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : Infinity;

  if (mobHit && mobHit.dist < blockDist) {
    resetBreak();
    if (attackCD <= 0) {
      mobHit.mob.hurt(mode === CREATIVE ? 20 : 5, player.pos.x, player.pos.z);
      particles.burst(mobHit.mob.pos.x, mobHit.mob.pos.y + mobHit.mob.height * 0.6, mobHit.mob.pos.z, [200, 60, 60], 6);
      sfx.break(); attackCD = 0.4;
    }
    return;
  }
  if (block.hit) handleBreak(block, dt); else resetBreak();
}

function onKill(mob) {
  particles.burst(mob.pos.x, mob.pos.y + mob.height * 0.5, mob.pos.z, [200, 150, 150], 16);
  if (mode === SURVIVAL && mob.def.drop) inventory.add(mob.def.drop, 1 + ((Math.random() * 2) | 0));
}

// ---------- Survival tick (hunger / regen) ----------
function survivalTick(dt, moving) {
  if (mode !== SURVIVAL || dead) return;
  hungerTimer += dt * (moving ? 1.4 : 0.4);
  if (hungerTimer > 8 && hunger > 0) { hunger--; hungerTimer = 0; hud.setHunger(hunger); }
  if (hunger >= 18 && health < 20) {
    regenTimer += dt;
    if (regenTimer > 3) { health = Math.min(20, health + 1); regenTimer = 0; hud.setHealth(health); }
  } else regenTimer = 0;
  if (hunger <= 0) {
    starveTimer += dt;
    if (starveTimer > 4 && health > 2) { health--; starveTimer = 0; hud.setHealth(health); hud.flashHurt(); }
  } else starveTimer = 0;
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
  const active = player.locked && !inventory.open && !dead;

  if (active) {
    player.update(dt);
    if (player.fallImpact > 0) { damagePlayer(Math.ceil(player.fallImpact * 0.6)); player.fallImpact = 0; }
    if (player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1.4) sfx.step();
  } else {
    player.update(0);
  }

  world.update(player.pos.x, player.pos.z);
  world.processQueues(6);

  sky.update(dt);
  hud.setClock(sky.clockString());
  waterTime.value += dt;

  // Drive mob lighting from the sun.
  sun.position.copy(sky.sunDir).multiplyScalar(100);
  sun.color.copy(sky.dirColor); sun.intensity = sky.dirIntensity;
  ambient.color.copy(sky.dirColor); ambient.intensity = sky.ambIntensity;

  mobs.update(dead ? 0 : dt, player, sky.isNight, { damagePlayer, onKill });

  // Interaction
  invuln -= dt; breakCD -= dt; placeCD -= dt; attackCD -= dt;
  if (active) {
    if (mouseLeft) attackOrBreak(dt); else resetBreak();
    if (mouseRight && placeCD <= 0) { doPlace(); placeCD = 0.25; }
    survivalTick(dt, Math.hypot(player.vel.x, player.vel.z) > 1.2);
  }

  const hit = castFromEye();
  highlight.visible = active && hit.hit;
  if (hit.hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

  particles.update(dt);
  renderer.render(scene, camera);
  stats.end();
}
frame();

window.__game = { world, player, sky, scene, renderer, mobs, inventory, crackMesh, crackMat, CRACK_TEXTURES, toggleMode, get state() { return { mode, health, hunger, dead }; } };
