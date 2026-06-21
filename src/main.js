// Entry point: renderer + scene wiring, spawn pre-warm, game modes, survival
// (health/hunger/damage/death), inventory, mobs, breaking, and the render loop.

import * as THREE from 'three';
import Stats from 'stats.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { REACH, SEA_LEVEL } from './constants.js';
import {
  AIR, WATER, BEDROCK, GRASS, DIRT, STONE, COBBLE, COAL_ORE, IRON_ORE,
  LEAVES, GLASS, GLOWSTONE, CRAFTING_TABLE, CHEST, SAND, LOG, PLANK, SNOW, GRAVEL, WOOL,
  hardness, BLOCK_TOOL, BLOCK_REQUIRES,
} from './blocks.js';
import { isFood, foodValue, APPLE, COAL, toolOf, meleeDamage, gunOf } from './items.js';
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
import { Multiplayer } from './net.js';
import { Tracers, Plasmas, Portals, makeViewModel } from './guns.js';

const SURVIVAL = 0, CREATIVE = 1;
const MELEE_REACH = 4;

// Difficulty (peaceful → hardcore) controls mob spawns, damage, and respawn.
const PEACEFUL = 0, EASY = 1, NORMAL = 2, HARD = 3, HARDCORE = 4;
const DIFF_NAMES = ['Peaceful', 'Easy', 'Normal', 'Hard', 'Hardcore'];
const DMG_MUL = [0, 0.5, 1, 1.5, 1.6];

// What a broken block drops in survival.
const DROPS = { [GRASS]: DIRT, [STONE]: COBBLE, [GLASS]: AIR, [COAL_ORE]: COAL };
const dropFor = (id) => (DROPS[id] !== undefined ? DROPS[id] : id);

// Per-position chest storage (27 slots each).
const chestStore = new Map();
const chestKey = (x, y, z) => `${x},${y},${z}`;

// Player block edits over the base terrain — synced in multiplayer and replayed
// to late-joining peers.
const edits = new Map();
const editsByChunk = new Map();
const editKey = (x, y, z) => `${x},${y},${z}`;
function indexEdit(x, y, z, id) {
  const ck = (x >> 4) + ',' + (z >> 4);
  let arr = editsByChunk.get(ck); if (!arr) { arr = []; editsByChunk.set(ck, arr); }
  arr.push([x - (x >> 4) * 16, y, z - (z >> 4) * 16, id]);
}
function recordEdit(x, y, z, id) { world.setBlock(x, y, z, id); edits.set(editKey(x, y, z), id); indexEdit(x, y, z, id); }
function applyEdit(x, y, z, id) { recordEdit(x, y, z, id); mp.sendEdit(x, y, z, id); }

// Footstep material per block, for surface-dependent step sounds.
const STEP = {
  [GRASS]: 'grass', [LEAVES]: 'grass', [DIRT]: 'dirt',
  [STONE]: 'stone', [COBBLE]: 'stone', [COAL_ORE]: 'stone', [IRON_ORE]: 'stone', [BEDROCK]: 'stone', [GLOWSTONE]: 'stone',
  [SAND]: 'sand', [GRAVEL]: 'gravel', [SNOW]: 'snow', [GLASS]: 'glass', [WOOL]: 'wool',
  [LOG]: 'wood', [PLANK]: 'wood', [CRAFTING_TABLE]: 'wood', [CHEST]: 'wood',
};
const stepCategory = (id) => STEP[id] || 'grass';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.sortObjects = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// ---------- Cinematic post-processing ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.92, 0.32, length(d));   // soft vignette
      c.rgb *= mix(0.7, 1.0, vig);
      c.rgb = (c.rgb - 0.5) * 1.07 + 0.5;              // gentle contrast
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.16);               // a touch more saturation
      gl_FragColor = c;
    }`,
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 0.8);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
composer.addPass(new ShaderPass(GradeShader));
const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);
function sizePost() {
  const w = window.innerWidth, h = window.innerHeight, pr = renderer.getPixelRatio();
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
  fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
}
sizePost();

// Lights — used only by mob (Lambert) materials; chunks bake their own lighting.
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(ambient, sun);

// ---------- Seeds ----------
function hashSeed(s) {
  s = String(s).trim() || 'voxelcraft';
  if (/^-?\d+$/.test(s)) return (parseInt(s, 10) >>> 0) || 1;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const randomSeedStr = () => String(Math.floor(Math.random() * 1e9));
let currentSeedStr = new URLSearchParams(location.search).get('seed') || randomSeedStr();

// ---------- Systems ----------
const world = new World(scene, hashSeed(currentSeedStr));
const player = new Player(camera, renderer.domElement, world);
const sky = new Sky(scene, camera);
const particles = new Particles(scene);
const sfx = new SFX();
const hud = new HUD();
const inventory = new Inventory((name) => hud.showName(name));
const mobs = new Mobs(scene, world);
const mp = new Multiplayer(scene);
const tracers = new Tracers(scene);
const plasmas = new Plasmas(scene);
const portals = new Portals(scene);
scene.add(camera); // so first-person gun viewmodels (camera children) render

// Re-apply player edits to a (re)generated chunk so builds survive unload/reload
// and reach late-joining peers.
world.applyEditsToChunk = (c) => {
  const arr = editsByChunk.get(c.cx + ',' + c.cz);
  if (!arr) return;
  for (const [lx, ly, lz, id] of arr) { c.setLocal(lx, ly, lz, id); c.recomputeColumn(lx, lz); }
};

let mode = SURVIVAL;            // start in survival with an empty inventory
let difficulty = NORMAL;
let health = 20, hunger = 20, dead = false;
let invuln = 0, regenTimer = 0, hungerTimer = 0, starveTimer = 0;

player.setMode(SURVIVAL);
inventory.setMode(false);
hud.setMode(true);
hud.setDifficulty(DIFF_NAMES[difficulty]);
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
let fireCD = 0, fire2CD = 0, zoomed = false, viewModel = null, viewGunId = -1;
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
const SPAWN = new THREE.Vector3();
let loaded = false;
function startWorld() {
  const [sx, sz] = pickSpawn();
  SPAWN.set(sx, 130, sz);
  player.pos.copy(SPAWN); player.vel.set(0, 0, 0);
  loaded = false;
  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'flex';
  refreshOverlays();
}
function updateLoading() {
  let meshed = 0;
  for (const c of world.chunks.values()) if (c.mesh || c.waterMesh) meshed++;
  const bar = document.getElementById('loadingBar');
  if (bar) bar.style.width = Math.min(100, Math.round((meshed / 55) * 100)) + '%';
  if (world.isReady(SPAWN.x, SPAWN.z) && meshed >= 45) finishLoading();
}
function finishLoading() {
  loaded = true;
  player.pos.set(SPAWN.x, world.surfaceHeight(Math.floor(SPAWN.x), Math.floor(SPAWN.z)) + 2, SPAWN.z);
  SPAWN.y = player.pos.y;
  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
  refreshOverlays();
}

// Regenerate from a seed (start-screen "New World" / joining a host's world).
function newWorld(seedStr) {
  currentSeedStr = (seedStr && seedStr.trim()) ? seedStr.trim() : randomSeedStr();
  world.regenerate(hashSeed(currentSeedStr));
  edits.clear(); editsByChunk.clear(); chestStore.clear(); mobs.clearAll();
  if (mode === SURVIVAL) { health = 20; hunger = 20; hud.setHealth(20); hud.setHunger(20); }
  dead = false; resetBreak(); startWorld();
}

// ---------- Overlays (play / death) ----------
const overlay = document.getElementById('overlay');
const deathEl = document.createElement('div');
deathEl.id = 'death';
deathEl.innerHTML = `<div class="card"><h1>YOU DIED</h1><p class="play" id="respawn">↺ Respawn</p><p id="hcnote" style="display:none;opacity:0.8;font-size:14px;margin-top:8px">Hardcore — reload the page to start a new world</p></div>`;
deathEl.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(60,0,0,0.55);backdrop-filter:blur(3px);pointer-events:auto;z-index:25;text-align:center;';
document.getElementById('ui').appendChild(deathEl);

function refreshOverlays() {
  const locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle('hidden', !loaded || locked || inventory.open || dead);
  deathEl.style.display = dead ? 'flex' : 'none';
}
refreshOverlays();
const seedInput = document.getElementById('seedInput');
seedInput.value = currentSeedStr;
document.getElementById('playBtn').addEventListener('click', () => { if (!dead) { renderer.domElement.requestPointerLock(); sfx.ensure(); } });
document.getElementById('diceBtn').addEventListener('click', () => { seedInput.value = randomSeedStr(); });
document.getElementById('newWorldBtn').addEventListener('click', () => { newWorld(seedInput.value); renderer.domElement.requestPointerLock(); sfx.ensure(); });

// ---------- Multiplayer (P2P co-op) ----------
const mpStatusEl = document.getElementById('mpStatus');
const setMpStatus = (s) => { if (mpStatusEl) mpStatusEl.textContent = s; };
const randomRoom = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const playerName = () => (document.getElementById('nameInput').value.trim() || 'Player' + Math.floor(Math.random() * 1000));
const mpHandlers = {
  getInit: () => ({
    seed: hashSeed(currentSeedStr),
    edits: [...edits.entries()].map(([k, v]) => { const [x, y, z] = k.split(',').map(Number); return [x, y, z, v]; }),
  }),
  onInit: (d) => {
    currentSeedStr = String(d.seed);
    seedInput.value = currentSeedStr;
    world.regenerate(d.seed);
    edits.clear(); editsByChunk.clear(); chestStore.clear(); mobs.clearAll();
    for (const e of d.edits) recordEdit(e[0], e[1], e[2], e[3]);
    startWorld();
    setMpStatus(`Joined ${d.hostName || 'host'}'s world!`);
  },
  onEdit: (x, y, z, id) => recordEdit(x, y, z, id),
  onStatus: setMpStatus,
};
document.getElementById('hostBtn').addEventListener('click', () => {
  const code = randomRoom();
  mp.host(code, playerName(), mpHandlers);
  setMpStatus(`Hosting — share room code: ${code}`);
});
document.getElementById('joinBtn').addEventListener('click', () => {
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  if (!code) { setMpStatus('Enter a room code to join'); return; }
  setMpStatus('Connecting…');
  mp.join(code, playerName(), mpHandlers);
});
document.addEventListener('pointerlockchange', refreshOverlays);
deathEl.querySelector('#respawn').addEventListener('click', () => respawn());

// ---------- Modes / damage / death ----------
function toggleMode() {
  mode = mode === CREATIVE ? SURVIVAL : CREATIVE;
  player.setMode(mode);
  inventory.setMode(mode === CREATIVE);
  hud.setMode(mode === SURVIVAL);
  if (mode === SURVIVAL) { hud.setHealth(health); hud.setHunger(hunger); }
  hud.showName(mode === CREATIVE ? 'Creative Mode' : 'Survival Mode');
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
function die() {
  dead = true; document.exitPointerLock(); resetBreak();
  const hardcore = difficulty === HARDCORE;
  deathEl.querySelector('h1').textContent = hardcore ? 'GAME OVER' : 'YOU DIED';
  deathEl.querySelector('#respawn').style.display = hardcore ? 'none' : 'block';
  deathEl.querySelector('#hcnote').style.display = hardcore ? 'block' : 'none';
  refreshOverlays();
}
function respawn() {
  if (difficulty === HARDCORE) return;
  dead = false; health = 20; hunger = 20; hud.setHealth(20); hud.setHunger(20);
  player.pos.copy(SPAWN); player.vel.set(0, 0, 0);
  refreshOverlays(); renderer.domElement.requestPointerLock();
}

function openInventory(size) { inventory.openScreen(size); document.exitPointerLock(); refreshOverlays(); }
function closeInventory() { inventory.close(); refreshOverlays(); if (!dead) renderer.domElement.requestPointerLock(); }

function applyDifficulty() {
  difficulty = (difficulty + 1) % 5;
  hud.setDifficulty(DIFF_NAMES[difficulty]);
  hud.showName('Difficulty: ' + DIFF_NAMES[difficulty]);
}

// ---------- Keyboard (E inventory, G mode, B difficulty) ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') {
    if (dead) return;
    if (inventory.open) closeInventory(); else openInventory(2);
  } else if (e.code === 'Escape' && inventory.open) {
    inventory.close(); refreshOverlays();
  } else if (e.code === 'KeyG') {
    if (!dead && !inventory.open) toggleMode();
  } else if (e.code === 'KeyB') {
    if (!dead && !inventory.open) applyDifficulty();
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

function breakBlock(x, y, z, dropOk = true) {
  const id = world.getBlock(x, y, z);
  if (id === BEDROCK || id === AIR) return;
  applyEdit(x, y, z, AIR);
  particles.burst(x + 0.5, y + 0.5, z + 0.5, blockTint(id));
  sfx.break();
  if (id === CHEST) chestStore.delete(chestKey(x, y, z));
  if (mode === SURVIVAL && dropOk) {
    if (id === LEAVES) { if (Math.random() < 0.06) inventory.add(APPLE, 1); }
    else { const d = dropFor(id); if (d !== AIR) inventory.add(d, 1); }
  }
}

// Mining effectiveness: matching tool speeds it up; some blocks need a tool to drop.
function miningInfo(id) {
  const t = toolOf(inventory.selectedId());
  const matches = t && BLOCK_TOOL[id] === t.tool;
  const need = BLOCK_REQUIRES[id];
  const canDrop = !need || (t && t.tool === need.type && t.tier >= need.tier);
  return { speed: matches ? t.speed : 1, canDrop };
}

function handleBreak(hit, dt) {
  if (mode === CREATIVE) {
    if (breakCD <= 0) { breakBlock(hit.x, hit.y, hit.z); breakCD = 0.2; }
    return;
  }
  const id = world.getBlock(hit.x, hit.y, hit.z);
  const hard = hardness(id);
  if (!isFinite(hard)) { resetBreak(); return; }
  const { speed, canDrop } = miningInfo(id);
  const key = `${hit.x},${hit.y},${hit.z}`;
  if (key !== breakKey) { breakKey = key; breakProgress = 0; }
  breakProgress += dt / (hard / speed);
  const stage = Math.min(9, Math.floor(breakProgress * 10));
  crackMat.map = CRACK_TEXTURES[stage]; crackMat.needsUpdate = true;
  crackMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  crackMesh.visible = true;
  if (Math.random() < 0.25) particles.burst(hit.x + 0.5, hit.y + 0.6, hit.z + 0.5, blockTint(id), 2);
  if (breakProgress >= 1) { breakBlock(hit.x, hit.y, hit.z, canDrop); resetBreak(); }
}

// Creeper explosion: destroy nearby blocks and damage the player by distance.
function explode(cx, cy, cz) {
  const r = 3;
  const fx = Math.floor(cx), fy = Math.floor(cy), fz = Math.floor(cz);
  const batch = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    if (dx * dx + dy * dy + dz * dz > r * r) continue;
    const x = fx + dx, y = fy + dy, z = fz + dz;
    const b = world.getBlock(x, y, z);
    if (b !== AIR && b !== BEDROCK && b !== WATER) {
      if (b === CHEST) chestStore.delete(chestKey(x, y, z));
      recordEdit(x, y, z, AIR);
      batch.push([x, y, z, AIR]);
      if (Math.random() < 0.12) particles.burst(x + 0.5, y + 0.5, z + 0.5, blockTint(b), 3);
    }
  }
  mp.sendEdits(batch);
  particles.burst(cx, cy, cz, [70, 64, 58], 50);
  sfx.break();
  const d = Math.hypot(player.pos.x - cx, player.pos.y + 0.9 - cy, player.pos.z - cz);
  if (d < r + 2) { const dmg = Math.round((1 - d / (r + 2)) * 16); if (dmg > 0) damagePlayer(dmg, cx, cz); }
}

function openChestAt(x, y, z) {
  const k = chestKey(x, y, z);
  let slots = chestStore.get(k);
  if (!slots) { slots = new Array(27).fill(null); chestStore.set(k, slots); }
  inventory.openChest(slots); document.exitPointerLock(); refreshOverlays();
}

// Right click: open a crafting table / chest, else eat held food, else place a block.
function handleUse() {
  const look = castFromEye();
  if (look.hit) {
    const b = world.getBlock(look.x, look.y, look.z);
    if (b === CRAFTING_TABLE) { openInventory(3); return; }
    if (b === CHEST) { openChestAt(look.x, look.y, look.z); return; }
  }

  const sel = inventory.selectedId();
  if (isFood(sel)) {
    if (mode === SURVIVAL && hunger >= 20) return;
    hunger = Math.min(20, hunger + foodValue(sel));
    hud.setHunger(hunger);
    inventory.consumeSelected();
    sfx.place();
    return;
  }
  doPlace();
}

function doPlace() {
  if (!inventory.canPlace()) return;
  const hit = castFromEye();
  if (!hit.hit) return;
  const { px, py, pz } = hit;
  const target = world.getBlock(px, py, pz);
  if (target !== AIR && target !== WATER) return;
  if (aabbHitsPlayer(px, py, pz)) return;
  applyEdit(px, py, pz, inventory.selectedBlock());
  inventory.consumeSelected(); sfx.place();
}

function attackOrBreak(dt) {
  const block = castFromEye();
  const mobHit = mobs.raycast(_eye, _dir, MELEE_REACH);
  const blockDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : Infinity;

  if (mobHit && mobHit.dist < blockDist) {
    resetBreak();
    if (attackCD <= 0) {
      mobHit.mob.hurt(mode === CREATIVE ? 20 : meleeDamage(inventory.selectedId()), player.pos.x, player.pos.z);
      particles.burst(mobHit.mob.pos.x, mobHit.mob.pos.y + mobHit.mob.height * 0.6, mobHit.mob.pos.z, [200, 60, 60], 6);
      sfx.break(); attackCD = 0.4;
    }
    return;
  }
  if (block.hit) handleBreak(block, dt); else resetBreak();
}

// ---------- Guns ----------
function updateViewModel() {
  const gid = gunOf(inventory.selectedId()) ? inventory.selectedId() : -1;
  if (gid === viewGunId) return;
  viewGunId = gid;
  if (viewModel) { camera.remove(viewModel); viewModel.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); viewModel = null; }
  if (gid !== -1) { viewModel = makeViewModel(gid); camera.add(viewModel); }
}

function fireGun(gun, secondary) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const muzzle = _eye.clone().addScaledVector(_dir, 0.6);
  if (gun.kind === 'hitscan') fireHitscan(gun, muzzle);
  else if (gun.kind === 'plasma') { plasmas.spawn(muzzle, _dir, gun.speed, gun.damage, gun.range); sfx.plasma(); }
  else if (gun.kind === 'portal') firePortal(secondary ? 1 : 0, gun);
}

function fireHitscan(gun, muzzle) {
  const mobHit = mobs.raycast(_eye, _dir, gun.range);
  const blockHit = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  const blockDist = blockHit.hit ? Math.hypot(blockHit.x + 0.5 - _eye.x, blockHit.y + 0.5 - _eye.y, blockHit.z + 0.5 - _eye.z) : Infinity;
  let end;
  if (mobHit && mobHit.dist < blockDist) {
    mobHit.mob.hurt(gun.damage, player.pos.x, player.pos.z);
    end = _eye.clone().addScaledVector(_dir, mobHit.dist);
    particles.burst(end.x, end.y, end.z, [220, 80, 80], 8);
  } else if (blockHit.hit) {
    end = new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
    particles.burst(end.x, end.y, end.z, blockTint(world.getBlock(blockHit.x, blockHit.y, blockHit.z)), 6);
  } else {
    end = _eye.clone().addScaledVector(_dir, gun.range);
  }
  tracers.add(muzzle, end, gun.zoom ? 0xaad4ff : 0xffe08a);
  sfx.gun(gun.zoom ? 'sniper' : 'handgun');
}

function firePortal(slot, gun) {
  const hit = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  if (!hit.hit) return;
  portals.set(slot,
    new THREE.Vector3(hit.x + 0.5 + hit.nx * 0.5, hit.y + 0.5 + hit.ny * 0.5, hit.z + 0.5 + hit.nz * 0.5),
    new THREE.Vector3(hit.nx, hit.ny, hit.nz));
  sfx.portal();
}

function plasmaImpact(pos, dmg) {
  particles.burst(pos.x, pos.y, pos.z, [140, 255, 235], 26);
  for (const m of mobs.list) {
    if (Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z) < 2.3) m.hurt(dmg, pos.x, pos.z);
  }
}

function onKill(mob) {
  particles.burst(mob.pos.x, mob.pos.y + mob.height * 0.5, mob.pos.z, [200, 150, 150], 16);
  if (mode === SURVIVAL) for (const d of mob.getDrops()) inventory.add(d.id, d.count);
}

// ---------- Survival tick (hunger / regen) ----------
function survivalTick(dt, moving) {
  if (mode !== SURVIVAL || dead) return;
  const peaceful = difficulty === PEACEFUL;
  if (!peaceful) {
    hungerTimer += dt * (moving ? 1.4 : 0.4);
    if (hungerTimer > 8 && hunger > 0) { hunger--; hungerTimer = 0; hud.setHunger(hunger); }
  }
  if ((peaceful || hunger >= 18) && health < 20) {
    regenTimer += dt;
    if (regenTimer > (peaceful ? 1.5 : 3)) { health = Math.min(20, health + 1); regenTimer = 0; hud.setHealth(health); }
  } else regenTimer = 0;
  if (!peaceful && hunger <= 0) {
    starveTimer += dt;
    if (starveTimer > 4 && health > 2) { health--; starveTimer = 0; hud.setHealth(health); hud.flashHurt(); }
  } else starveTimer = 0;
}

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizePost();
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  stats.begin();
  const dt = Math.min(clock.getDelta(), 0.1);

  world.update(player.pos.x, player.pos.z);
  world.processQueues(loaded ? 6 : 16);

  // Still loading: animate the loading screen, render the world behind it.
  if (!loaded) {
    updateLoading();
    sky.update(dt);
    waterTime.value += dt;
    composer.render();
    stats.end();
    return;
  }

  const active = player.locked && !inventory.open && !dead;

  if (active) {
    player.update(dt);
    if (player.fallImpact > 0) { damagePlayer(Math.ceil(player.fallImpact * 0.6)); player.fallImpact = 0; }
    if (player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1.4) {
      const fb = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
      sfx.step(stepCategory(fb));
    }
  } else {
    player.update(0);
  }

  sky.update(dt);
  hud.setClock(sky.clockString());
  waterTime.value += dt;

  // Drive mob lighting from the sun.
  sun.position.copy(sky.sunDir).multiplyScalar(100);
  sun.color.copy(sky.dirColor); sun.intensity = sky.dirIntensity;
  ambient.color.copy(sky.dirColor); ambient.intensity = sky.ambIntensity;

  mobs.update(dead ? 0 : dt, player, sky.isNight, {
    damagePlayer, onKill, explode, peaceful: difficulty === PEACEFUL, dmgMul: DMG_MUL[difficulty],
  });

  // Interaction
  invuln -= dt; breakCD -= dt; placeCD -= dt; attackCD -= dt; fireCD -= dt; fire2CD -= dt;
  const gun = gunOf(inventory.selectedId());
  if (active && gun) {
    resetBreak();
    if (mouseLeft && fireCD <= 0) { fireGun(gun, false); fireCD = gun.rate; }
    if (gun.kind === 'portal' && mouseRight && fire2CD <= 0) { fireGun(gun, true); fire2CD = gun.rate; }
    if (gun.zoom && mouseRight) { if (!zoomed) { camera.fov = 26; camera.updateProjectionMatrix(); zoomed = true; } }
    else if (zoomed) { camera.fov = player.fov; camera.updateProjectionMatrix(); zoomed = false; }
  } else if (active) {
    if (zoomed) { camera.fov = player.fov; camera.updateProjectionMatrix(); zoomed = false; }
    if (mouseLeft) attackOrBreak(dt); else resetBreak();
    if (mouseRight && placeCD <= 0) { handleUse(); placeCD = 0.25; }
  }
  if (active) survivalTick(dt, Math.hypot(player.vel.x, player.vel.z) > 1.2);

  // Block highlight (hidden while aiming a gun)
  const hit = castFromEye();
  highlight.visible = active && !gun && hit.hit;
  if (hit.hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

  // Guns / projectiles / portals / co-op
  updateViewModel();
  tracers.update(dt);
  plasmas.update(dt, world, mobs, plasmaImpact);
  portals.update(dt, player);
  mp.update(dt);
  if (active) mp.sendPos({ x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });

  particles.update(dt);
  composer.render();
  stats.end();
}
const TIPS = [
  'Press G for Creative to grab the guns', 'Right-click a stack to split it in half',
  'Build a Crafting Table for tools', 'Creepers explode — keep your distance',
  'Host a co-op game from the menu and share the code', 'Portal Gun: left-click + right-click two portals',
  'Snipers zoom with right-click', 'Different ground makes different footstep sounds',
];
setInterval(() => { const el = document.getElementById('loadingTip'); if (el && !loaded) el.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 2200);

startWorld();
frame();

window.__game = {
  world, player, sky, scene, renderer, mobs, inventory, mp, tracers, plasmas, portals,
  crackMesh, crackMat, CRACK_TEXTURES, edits,
  toggleMode, applyDifficulty, openInventory, newWorld,
  get loaded() { return loaded; },
  get state() { return { mode, difficulty, diffName: DIFF_NAMES[difficulty], health, hunger, dead }; },
};
