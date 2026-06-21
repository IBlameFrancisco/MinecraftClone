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
import { isFood, foodValue, APPLE, COAL, toolOf, meleeDamage, gunOf,
  HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN, SMG, ASSAULT_RIFLE, SHOTGUN, ROCKET_LAUNCHER, RAILGUN } from './items.js';
import { World } from './world.js';
import { ARENA } from './worldgen.js';
import { Player } from './player.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { SFX } from './audio.js';
import { HUD } from './ui.js';
import { Inventory } from './inventory.js';
import { Mobs } from './entities.js';
import { voxelRaycast } from './raycast.js';
import { rayAABB } from './physics.js';
import { waterTime } from './materials.js';
import { blockTint, CRACK_TEXTURES } from './textures.js';
import { Multiplayer } from './net.js';
import { SKINS, DEFAULT_SKIN, getSkin } from './skins.js';
import { Tracers, Plasmas, Rockets, Portals, makeViewModel, MuzzleFlash, DamageNumbers } from './guns.js';
import { BotManager } from './bots.js';
import { Pickups } from './pickups.js';

const SURVIVAL = 0, CREATIVE = 1, BATTLE = 2;
const MELEE_REACH = 4;

// Battle mode: full gun loadout (9 slots = 9 guns) + arena spawn points.
const BATTLE_LOADOUT = [HANDGUN, SMG, ASSAULT_RIFLE, SHOTGUN, SNIPER, RAILGUN, PLASMA_GUN, ROCKET_LAUNCHER, PORTAL_GUN];
const BATTLE_SPAWNS = [[34, 0], [-34, 0], [0, 34], [0, -34], [24, 24], [-24, 24], [24, -24], [-24, -24]];

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
const rockets = new Rockets(scene);
const portals = new Portals(scene);
const botMgr = new BotManager(scene);
const damageNumbers = new DamageNumbers(scene);
const pickups = new Pickups(scene);
scene.add(camera); // so first-person gun viewmodels (camera children) render
const muzzle = new MuzzleFlash(camera);
const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };

// Re-apply player edits to a (re)generated chunk so builds survive unload/reload
// and reach late-joining peers.
world.applyEditsToChunk = (c) => {
  const arr = editsByChunk.get(c.cx + ',' + c.cz);
  if (!arr) return;
  for (const [lx, ly, lz, id] of arr) { c.setLocal(lx, ly, lz, id); c.recomputeColumn(lx, lz); }
};

let mode = SURVIVAL;            // start in survival with an empty inventory
let difficulty = NORMAL;
let menuMode = SURVIVAL, menuDiff = NORMAL;   // chosen on the start screen
let health = 20, hunger = 20, dead = false;
let invuln = 0, regenTimer = 0, hungerTimer = 0, starveTimer = 0;
let arena = false;                 // is the current world the battle arena?
let lastHitBy = null, lastHitTime = -100;   // for PvP kill attribution
let shakeAmt = 0;                  // screen-shake magnitude
let combo = 0, comboTimer = 0, firstBlood = true;   // announcer multikill tracking
function addShake(a) { shakeAmt = Math.min(0.6, shakeAmt + a); }
function announceKill(head) {
  comboTimer = 3.2; combo++;
  let txt = null, snd = 'first';
  if (firstBlood) { firstBlood = false; txt = 'FIRST BLOOD'; }
  else if (combo >= 4) { txt = `${combo}× MULTI KILL!`; snd = 'multi'; }
  else if (combo === 3) { txt = 'TRIPLE KILL'; snd = 'multi'; }
  else if (combo === 2) { txt = 'DOUBLE KILL'; snd = 'multi'; }
  else if (head) { txt = 'HEADSHOT'; }
  if (txt) { hud.announce(txt, combo >= 2 ? '#ff8f3a' : '#ffe27a'); sfx.announce(snd); }
}

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
let triggerConsumed = false;   // for semi-auto guns: one shot per click
const ammo = {};
let reloadingGun = -1, reloadTimer = 0, recoilPitch = 0, recoilYaw = 0, recoilKick = 0;
function ammoFor(gun, id) { if (!gun.mag) return Infinity; if (ammo[id] === undefined) ammo[id] = gun.mag; return ammo[id]; }
function startReload(gun, id) {
  if (!gun.mag || reloadingGun === id || (ammo[id] ?? gun.mag) >= gun.mag) return;
  reloadingGun = id; reloadTimer = gun.reload;
}
function resetBreak() { breakKey = null; breakProgress = 0; crackMesh.visible = false; }

// ---------- Spawn ----------
function pickSpawn() {
  if (arena) return [0.5, 0.5];   // orbit the arena centre on the menu
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
let everPlayed = false;
let menuAngle = Math.random() * Math.PI * 2;

// Cinematic orbit used as the live menu / loading background.
function menuCamera(dt) {
  menuAngle += dt * 0.06;
  const t = performance.now() * 0.001;
  const ty = world.surfaceHeight(Math.floor(SPAWN.x), Math.floor(SPAWN.z));
  const r = 24 + Math.sin(t * 0.13) * 5;          // slow dolly in/out
  const h = 13 + Math.sin(t * 0.09) * 3.5;        // gentle rise/fall
  const cx = SPAWN.x, cz = SPAWN.z;
  camera.position.set(cx + Math.cos(menuAngle) * r, ty + h, cz + Math.sin(menuAngle) * r);
  camera.up.set(0, 1, 0);
  camera.lookAt(cx, ty + 1 + Math.sin(t * 0.07) * 1.5, cz);
}
function hideViewModel() {
  if (viewModel) { camera.remove(viewModel); viewModel.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); viewModel = null; viewGunId = -1; }
}

function startWorld() {
  const [sx, sz] = pickSpawn();
  SPAWN.set(sx, arena ? ARENA.FLOOR + 2 : 130, sz);
  player.pos.copy(SPAWN); player.vel.set(0, 0, 0);
  loaded = false;
  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'flex';
  refreshOverlays();
}
function updateLoading() {
  let meshed = 0;
  for (const c of world.chunks.values()) if (c.mesh || c.waterMesh) meshed++;
  const target = arena ? 14 : 45;            // the arena is small + bounded
  const bar = document.getElementById('loadingBar');
  if (bar) bar.style.width = Math.min(100, Math.round((meshed / (target + 10)) * 100)) + '%';
  if (world.isReady(SPAWN.x, SPAWN.z) && meshed >= target) finishLoading();
}
function finishLoading() {
  loaded = true;
  if (arena) {
    const sp = teamSpawnPoint(myTeam);
    player.pos.set(sp.x, sp.y, sp.z);
  } else {
    player.pos.set(SPAWN.x, world.surfaceHeight(Math.floor(SPAWN.x), Math.floor(SPAWN.z)) + 2, SPAWN.z);
    SPAWN.y = player.pos.y;
  }
  player.vel.set(0, 0, 0);
  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
  refreshOverlays();
}

// Regenerate from a seed (start-screen "New World" / Battle / joining a host).
function loadWorld(seedStr, asArena) {
  currentSeedStr = (seedStr && seedStr.trim()) ? seedStr.trim() : randomSeedStr();
  seedInput.value = currentSeedStr;
  arena = asArena;
  world.regenerate(hashSeed(currentSeedStr), asArena);
  edits.clear(); editsByChunk.clear(); chestStore.clear(); mobs.clearAll(); botMgr.clear();
  if (!asArena && mode === SURVIVAL) { health = 20; hunger = 20; hud.setHealth(20); hud.setHunger(20); }
  dead = false; resetBreak(); startWorld();
}
function newWorld(seedStr) { loadWorld(seedStr, false); }

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

// Start the chosen game mode. forceNew always regenerates; otherwise the live
// menu-background world is kept (survival/creative drop straight in), but Battle
// always (re)builds the arena.
function startSelectedMode(seedStr, forceNew) {
  if (menuMode === BATTLE) {
    setGameMode(BATTLE);
    inventory.setLoadout(BATTLE_LOADOUT);
    health = 20; hud.setHealth(20);
    loadWorld(seedStr, true);
    setupMatch();
  } else {
    setGameMode(menuMode);
    setDifficultyDirect(menuDiff);
    if (forceNew || arena) loadWorld(seedStr, false);
  }
}

document.getElementById('playBtn').addEventListener('click', () => {
  if (dead) return;
  if (!everPlayed) startSelectedMode(currentSeedStr, false);
  renderer.domElement.requestPointerLock(); sfx.ensure();
});
document.getElementById('diceBtn').addEventListener('click', () => { seedInput.value = randomSeedStr(); });
document.getElementById('newWorldBtn').addEventListener('click', () => {
  startSelectedMode(seedInput.value, true);
  renderer.domElement.requestPointerLock(); sfx.ensure();
});

// Mode + difficulty pickers
const modeSurvBtn = document.getElementById('modeSurvival');
const modeCreaBtn = document.getElementById('modeCreative');
const modeBattleBtn = document.getElementById('modeBattle');
const diffRow = document.getElementById('diffrow');
const battleSetupEl = document.getElementById('battlesetup');
function refreshModePicker() {
  modeSurvBtn.classList.toggle('active', menuMode === SURVIVAL);
  modeCreaBtn.classList.toggle('active', menuMode === CREATIVE);
  modeBattleBtn.classList.toggle('active', menuMode === BATTLE);
  diffRow.style.visibility = menuMode === SURVIVAL ? 'visible' : 'hidden';
  battleSetupEl.classList.toggle('show', menuMode === BATTLE);
}
modeSurvBtn.addEventListener('click', () => { menuMode = SURVIVAL; refreshModePicker(); });
modeCreaBtn.addEventListener('click', () => { menuMode = CREATIVE; refreshModePicker(); });
modeBattleBtn.addEventListener('click', () => { menuMode = BATTLE; refreshModePicker(); });
document.getElementById('diffSelect').addEventListener('change', (e) => { menuDiff = parseInt(e.target.value, 10); });

// ---------- Battle setup (FFA/Teams, size, bot difficulty, score limit) ----------
const battleCfg = { team: false, size: 6, botDiff: 'normal', scoreLimit: 20 };
const bsFFA = document.getElementById('bsModeFFA');
const bsTeam = document.getElementById('bsModeTeam');
const bsSize = document.getElementById('bsSize');
const bsSizeLabel = document.getElementById('bsSizeLabel');
const bsBotDiff = document.getElementById('bsBotDiff');
const bsScore = document.getElementById('bsScore');
function fillSizeOptions() {
  const team = battleCfg.team;
  bsSizeLabel.textContent = team ? 'Team size' : 'Combatants';
  const lo = team ? 1 : 2, hi = team ? 4 : 8, def = team ? 2 : 6;
  bsSize.innerHTML = '';
  for (let n = lo; n <= hi; n++) { const o = document.createElement('option'); o.value = n; o.textContent = team ? `${n} v ${n}` : n; bsSize.appendChild(o); }
  battleCfg.size = Math.min(hi, Math.max(lo, def));
  bsSize.value = battleCfg.size;
}
function refreshBattleSetup() {
  bsFFA.classList.toggle('active', !battleCfg.team);
  bsTeam.classList.toggle('active', battleCfg.team);
}
bsFFA.addEventListener('click', () => { battleCfg.team = false; fillSizeOptions(); refreshBattleSetup(); });
bsTeam.addEventListener('click', () => { battleCfg.team = true; fillSizeOptions(); refreshBattleSetup(); });
bsSize.addEventListener('change', (e) => { battleCfg.size = parseInt(e.target.value, 10); });
bsBotDiff.addEventListener('change', (e) => { battleCfg.botDiff = e.target.value; });
bsScore.addEventListener('change', (e) => { battleCfg.scoreLimit = parseInt(e.target.value, 10); });
fillSizeOptions(); refreshBattleSetup();
refreshModePicker();

// ---------- Settings (FOV / sensitivity / render distance, persisted) ----------
const SETTINGS_KEY = 'guncraft.settings';
let settings;
try { settings = Object.assign({ fov: 75, sens: 1.0, rd: 7 }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
catch { settings = { fov: 75, sens: 1.0, rd: 7 }; }
const fovRange = document.getElementById('fovRange');
const sensRange = document.getElementById('sensRange');
const rdRange = document.getElementById('rdRange');
const setText = (id, v) => { document.getElementById(id).textContent = v; };
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
function applySettings() {
  player.setFov(settings.fov); player.setSensitivity(settings.sens); world.renderDistance = settings.rd;
  fovRange.value = settings.fov; setText('fovVal', settings.fov);
  sensRange.value = Math.round(settings.sens * 100); setText('sensVal', settings.sens.toFixed(2));
  rdRange.value = settings.rd; setText('rdVal', settings.rd);
}
applySettings();
fovRange.addEventListener('input', () => { settings.fov = +fovRange.value; setText('fovVal', settings.fov); player.setFov(settings.fov); saveSettings(); });
sensRange.addEventListener('input', () => { settings.sens = +sensRange.value / 100; setText('sensVal', settings.sens.toFixed(2)); player.setSensitivity(settings.sens); saveSettings(); });
rdRange.addEventListener('input', () => { settings.rd = +rdRange.value; setText('rdVal', settings.rd); world.renderDistance = settings.rd; saveSettings(); });
const settingsEl = document.getElementById('settings');
document.getElementById('settingsBtn').addEventListener('click', () => settingsEl.classList.remove('hidden'));
document.getElementById('settingsDone').addEventListener('click', () => settingsEl.classList.add('hidden'));

// ---------- Character skin picker ----------
const SKIN_KEY = 'guncraft.skin';
let currentSkin = localStorage.getItem(SKIN_KEY) || DEFAULT_SKIN;
function hx(n) { return '#' + n.toString(16).padStart(6, '0'); }
// A small 2D portrait of a skin for the menu chips.
function drawFace(ctx, s, S) {
  ctx.clearRect(0, 0, S, S);
  const u = S / 16;
  ctx.fillStyle = hx(s.skin); ctx.fillRect(3 * u, 3 * u, 10 * u, 11 * u);     // face
  ctx.fillStyle = hx(s.eye);
  ctx.fillRect(5 * u, 7 * u, 2 * u, 2 * u); ctx.fillRect(9 * u, 7 * u, 2 * u, 2 * u); // eyes
  if (s.mustache) { ctx.fillStyle = '#241a10'; ctx.fillRect(5 * u, 11 * u, 6 * u, 1.4 * u); }
  // hair
  ctx.fillStyle = hx(s.hair);
  if (s.hairStyle === 'long') { ctx.fillRect(2 * u, 2 * u, 12 * u, 4 * u); ctx.fillRect(2 * u, 2 * u, 2 * u, 11 * u); ctx.fillRect(12 * u, 2 * u, 2 * u, 11 * u); }
  else if (s.hairStyle === 'short') ctx.fillRect(3 * u, 2 * u, 10 * u, 3 * u);
  // hat
  if (s.hat === 'sombrero') { ctx.fillStyle = '#d9b25a'; ctx.fillRect(0, 2.5 * u, 16 * u, 2 * u); ctx.fillStyle = '#c99a3e'; ctx.fillRect(5 * u, 0, 6 * u, 3 * u); }
  else if (s.hat === 'cap') { ctx.fillStyle = hx(s.hatColor || 0x303030); ctx.fillRect(3 * u, 2 * u, 10 * u, 2.4 * u); ctx.fillRect(2 * u, 3.6 * u, 6 * u, 1.2 * u); }
  else if (s.hat === 'beanie') { ctx.fillStyle = hx(s.hatColor || 0x884444); ctx.fillRect(3 * u, 1.5 * u, 10 * u, 3.2 * u); }
}
function buildSkinPicker() {
  const wrap = document.getElementById('skinpicker');
  wrap.innerHTML = '';
  for (const s of SKINS) {
    const chip = document.createElement('button');
    chip.className = 'skinchip' + (s.id === currentSkin ? ' active' : '');
    chip.dataset.id = s.id;
    const c = document.createElement('canvas'); c.width = c.height = 40;
    drawFace(c.getContext('2d'), s, 40);
    const label = document.createElement('span'); label.textContent = s.name;
    chip.appendChild(c); chip.appendChild(label);
    chip.addEventListener('click', () => {
      currentSkin = s.id; mp.setSkin(s.id);
      try { localStorage.setItem(SKIN_KEY, s.id); } catch {}
      [...wrap.children].forEach((el) => el.classList.toggle('active', el.dataset.id === s.id));
    });
    wrap.appendChild(chip);
  }
}
mp.setSkin(currentSkin);
buildSkinPicker();

// ---------- Multiplayer (P2P co-op) ----------
const mpStatusEl = document.getElementById('mpStatus');
const setMpStatus = (s) => { if (mpStatusEl) mpStatusEl.textContent = s; };
const randomRoom = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const playerName = () => (document.getElementById('nameInput').value.trim() || 'Player' + Math.floor(Math.random() * 1000));
const mpHandlers = {
  getInit: () => ({
    seed: hashSeed(currentSeedStr),
    arena, battle: mode === BATTLE, team: teamMode, scoreLimit,
    edits: [...edits.entries()].map(([k, v]) => { const [x, y, z] = k.split(',').map(Number); return [x, y, z, v]; }),
  }),
  onInit: (d) => {
    currentSeedStr = String(d.seed);
    seedInput.value = currentSeedStr;
    arena = !!d.arena;
    botMgr.clear();
    world.regenerate(d.seed, arena);
    edits.clear(); editsByChunk.clear(); chestStore.clear(); mobs.clearAll();
    for (const e of d.edits) recordEdit(e[0], e[1], e[2], e[3]);
    if (d.battle) {
      setGameMode(BATTLE); inventory.setLoadout(BATTLE_LOADOUT); health = 20; hud.setHealth(20);
      teamMode = !!d.team; scoreLimit = d.scoreLimit || 20; computeCoverPoints();
    }
    startWorld();
    setMpStatus(`Joined ${d.hostName || 'host'}'s ${d.battle ? 'battle arena' : 'world'}!`);
  },
  onEdit: (x, y, z, id) => recordEdit(x, y, z, id),
  onStatus: setMpStatus,
  onChat: (name, text) => hud.addChat(name, text, false),
  onSystem: (msg) => { hud.addChat(null, msg, true); hud.setPlayers(mp.playerList()); },
  onRoster: () => { hud.setPlayers(mp.playerList()); if (mode === BATTLE && isAuthority()) { rebuildBoard(); broadcastBoard(); } },
  // PvP: someone hit me — apply the damage locally and remember who, for the kill feed.
  onHit: (dmg, fromName) => { lastHitBy = fromName; lastHitTime = performance.now() / 1000; damagePlayer(dmg); },
  onKillFeed: (victim, killer) => { hud.addKill(victim, killer); if (killer === myName()) announceKill(false); },
  onBotHit: (botId, dmg, fromName, head) => botHurt(botId, dmg, fromName, head),
  onDeathAuthority: (by, id) => registerKill(by, id),
  onBotFire: (d) => { shotTracer(d.kind, new THREE.Vector3(d.x, d.y, d.z), new THREE.Vector3(d.dx, d.dy, d.dz), d.range, d.color); sfx.gunAt(d.kind === 'rail' ? 'rail' : d.kind === 'shotgun' ? 'shotgun' : 'handgun', d.x, d.y, d.z); },
  onBoard: (d) => {
    board = d.board; teamMode = d.team; scoreLimit = d.scoreLimit;
    const me = board.find((e) => e.id === selfId()); myTeam = me ? me.team : TEAM_NONE;
    hud.setScoreboard(board, teamMode, scoreLimit, myTeam); mp.recolorBots(colorForBot);
  },
  onRoundOver: (winner) => hud.showRoundOver(winner),
  onRoundReset: () => { hud.hideRoundOver(); const sp = teamSpawnPoint(myTeam); player.pos.set(sp.x, sp.y, sp.z); player.vel.set(0, 0, 0); health = 20; hud.setHealth(20); invuln = 1.5; },
  botColor: (team) => colorForBot(team),
};
hud.onChatSend = (t) => { if (mp.online) mp.sendChat(t); else hud.addChat(playerName(), t, false); };
hud.onHitSound = (head) => sfx.hitmark(head);
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
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) everPlayed = true;
  refreshOverlays();
});
deathEl.querySelector('#respawn').addEventListener('click', () => respawn());

// Hold Tab for the battle scoreboard.
window.addEventListener('keydown', (e) => { if (e.code === 'Tab' && mode === BATTLE && !isTyping()) { e.preventDefault(); hud.showScoreboard(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Tab') hud.hideScoreboard(); });

// ---------- Modes / damage / death ----------
const myName = () => (mp.online ? mp.name : playerName());

// Apply a game mode (survival / creative / battle): player movement, inventory,
// and HUD all follow from it.
function setGameMode(m) {
  mode = m;
  player.setMode(m === CREATIVE ? 1 : 0);          // creative flies; survival/battle walk
  inventory.setMode(m === CREATIVE || m === BATTLE); // battle uses the infinite (creative) set
  if (m === BATTLE) { hud.setBattle(true); hud.showRadar(true); setupArenaPickups(); }
  else {
    hud.setBattle(false); hud.setMode(m === SURVIVAL); hud.showRadar(false); pickups.clear();
    if (m === SURVIVAL) { hud.setHealth(health); hud.setHunger(hunger); }
  }
  resetBreak();
}
function toggleMode() {
  if (mode === BATTLE) return;                      // locked while in the arena
  setGameMode(mode === CREATIVE ? SURVIVAL : CREATIVE);
  hud.showName(mode === CREATIVE ? 'Creative Mode' : 'Survival Mode');
}

function damagePlayer(dmg, srcX, srcZ) {
  if ((mode !== SURVIVAL && mode !== BATTLE) || dead || invuln > 0 || !player.locked) return;
  health -= dmg; invuln = 0.5;
  hud.setHealth(Math.max(0, health)); hud.flashHurt(); sfx.hurt(); addShake(0.12 + dmg * 0.004);
  if (srcX !== undefined) {
    const dx = srcX - player.pos.x, dz = srcZ - player.pos.z, d = Math.hypot(dx, dz) || 1;
    player.vel.x -= (dx / d) * 6; player.vel.z -= (dz / d) * 6; player.vel.y = 5;
    // Directional damage indicator (angle relative to where we're facing).
    const fX = -Math.sin(player.yaw), fZ = -Math.cos(player.yaw), rX = Math.cos(player.yaw), rZ = -Math.sin(player.yaw);
    hud.showDamageDir(Math.atan2((dx / d) * rX + (dz / d) * rZ, (dx / d) * fX + (dz / d) * fZ));
  }
  if (health <= 0) die();
}
function die() {
  if (mode === BATTLE) { battleDeath(); return; }
  dead = true; document.exitPointerLock(); resetBreak();
  const hardcore = difficulty === HARDCORE;
  deathEl.querySelector('h1').textContent = hardcore ? 'GAME OVER' : 'YOU DIED';
  deathEl.querySelector('#respawn').style.display = hardcore ? 'none' : 'block';
  deathEl.querySelector('#hcnote').style.display = hardcore ? 'block' : 'none';
  refreshOverlays();
}

// Battle: no permadeath — credit the kill, then respawn at a (team) spawn point.
function battleDeath() {
  const now = performance.now() / 1000;
  const killer = (now - lastHitTime < 10) ? lastHitBy : null;
  hud.addKill(myName(), killer);
  if (mp.online) mp.sendDeath(killer);
  if (isAuthority()) registerKill(killer, selfId(), myName());
  particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, [255, 80, 80], 30);
  sfx.gun('sniper');
  const sp = teamSpawnPoint(myTeam);
  player.pos.set(sp.x, sp.y, sp.z); player.vel.set(0, 0, 0);
  health = 20; hud.setHealth(20); invuln = 1.6; lastHitBy = null;
  hud.flashHurt();
}

// ---------- Battle match: teams, bots, scoreboard, rounds ----------
const TEAM_NONE = -1, TEAM_RED = 0, TEAM_BLUE = 1;
let teamMode = false, myTeam = TEAM_NONE, scoreLimit = 20;
let myKills = 0, myDeaths = 0;
const humanScore = new Map();   // remote human id -> { k, d }
const teamAssign = new Map();   // combatant id -> team
let board = [];                 // scoreboard snapshot
let matchWinner = null, matchOverTimer = 0;
let coverPoints = [];
const isAuthority = () => (!mp.online || mp.isHost);
const selfId = () => (mp.online ? mp.myId : 'me');
function teamOf(id) { const e = board.find((x) => x.id === id); return e ? e.team : (id === selfId() ? myTeam : TEAM_NONE); }
function colorForBot(team) { return (teamMode && team === myTeam) ? 0x57d977 : 0xff5b5b; }
function friendly(id) { return teamMode && myTeam !== TEAM_NONE && teamOf(id) === myTeam; }

function teamSpawnPoint(team) {
  let pool = BATTLE_SPAWNS;
  if (team === TEAM_RED) pool = BATTLE_SPAWNS.filter(([x]) => x < 0);
  else if (team === TEAM_BLUE) pool = BATTLE_SPAWNS.filter(([x]) => x > 0);
  if (!pool.length) pool = BATTLE_SPAWNS;
  const [x, z] = pool[(Math.random() * pool.length) | 0];
  return { x: x + 0.5, y: ARENA.FLOOR + 1.2, z: z + 0.5 };
}

// Bot retreat/cover points, mirrored from the arena layout.
function computeCoverPoints() {
  coverPoints = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    coverPoints.push(new THREE.Vector3(sx * 11.5, ARENA.FLOOR + 1, sz * 11.5));
    coverPoints.push(new THREE.Vector3(sx * 20.5, ARENA.FLOOR + 1, sz * 20.5));
    coverPoints.push(new THREE.Vector3(sx * 28, ARENA.FLOOR + 1, sz * 28));
  }
}

// Build the match (authority spawns bots; everyone rebuilds the board).
function setupMatch() {
  teamMode = battleCfg.team; scoreLimit = battleCfg.scoreLimit;
  myKills = 0; myDeaths = 0; humanScore.clear(); teamAssign.clear();
  matchWinner = null; matchOverTimer = 0; hud.hideRoundOver();
  combo = 0; comboTimer = 0; firstBlood = true;
  botMgr.clear();
  computeCoverPoints();

  const humans = [selfId()];
  if (mp.online) for (const id of mp.roster.keys()) humans.push(id);

  let botTeams = [];
  if (teamMode) {
    myTeam = TEAM_RED; teamAssign.set(selfId(), TEAM_RED);
    let r = 1, b = 0;
    for (const id of humans) { if (id === selfId()) continue; if (r <= b) { teamAssign.set(id, TEAM_RED); r++; } else { teamAssign.set(id, TEAM_BLUE); b++; } }
    let redH = 0, blueH = 0; for (const t of teamAssign.values()) t === TEAM_RED ? redH++ : blueH++;
    for (let i = 0; i < battleCfg.size - redH; i++) botTeams.push(TEAM_RED);
    for (let i = 0; i < battleCfg.size - blueH; i++) botTeams.push(TEAM_BLUE);
  } else {
    myTeam = TEAM_NONE;
    for (const id of humans) teamAssign.set(id, TEAM_NONE);
    botTeams = new Array(Math.max(0, battleCfg.size - humans.length)).fill(TEAM_NONE);
  }
  if (isAuthority() && botTeams.length) botMgr.spawn(botTeams.length, botTeams, battleCfg.botDiff, teamSpawnPoint, colorForBot);
  rebuildBoard(); broadcastBoard();
}

function rebuildBoard() {
  board = [{ id: selfId(), name: myName(), team: myTeam, kills: myKills, deaths: myDeaths, bot: false, you: true }];
  if (mp.online) for (const [id, name] of mp.roster) {
    const s = humanScore.get(id) || { k: 0, d: 0 };
    board.push({ id, name, team: teamAssign.get(id) ?? TEAM_NONE, kills: s.k, deaths: s.d, bot: false });
  }
  for (const bt of botMgr.bots) board.push({ id: bt.id, name: bt.name, team: bt.team, kills: bt.kills, deaths: bt.deaths, bot: true });
  hud.setScoreboard(board, teamMode, scoreLimit, myTeam);
}
function broadcastBoard() { if (mp.isHost) mp.broadcast({ t: 'board', board, team: teamMode, scoreLimit }); }

function addKillByName(name) {
  if (!name) return;
  if (name === myName()) { myKills++; return; }
  const bt = botMgr.bots.find((b) => b.name === name); if (bt) { bt.kills++; return; }
  if (mp.online) for (const [id, n] of mp.roster) if (n === name) { const s = humanScore.get(id) || { k: 0, d: 0 }; s.k++; humanScore.set(id, s); return; }
}
function addDeathById(id) {
  if (id === selfId()) { myDeaths++; return; }
  const bt = botMgr.get(id); if (bt) { bt.deaths++; return; }
  const s = humanScore.get(id) || { k: 0, d: 0 }; s.d++; humanScore.set(id, s);
}
function registerKill(killerName, victimId) {
  if (!isAuthority() || matchWinner) { return; }
  addKillByName(killerName); addDeathById(victimId);
  checkWin(); rebuildBoard(); broadcastBoard();
}
function checkWin() {
  if (matchWinner) return;
  if (teamMode) {
    let red = 0, blue = 0;
    (myTeam === TEAM_RED ? red += myKills : blue += myKills);
    for (const [id, s] of humanScore) (teamAssign.get(id) === TEAM_RED ? red += s.k : blue += s.k);
    for (const b of botMgr.bots) (b.team === TEAM_RED ? red += b.kills : blue += b.kills);
    if (red >= scoreLimit) endMatch('Red Team');
    else if (blue >= scoreLimit) endMatch('Blue Team');
  } else {
    let top = -1, who = null;
    const consider = (n, k) => { if (k > top) { top = k; who = n; } };
    consider(myName(), myKills);
    if (mp.online) for (const [id, n] of mp.roster) consider(n, (humanScore.get(id) || { k: 0 }).k);
    for (const b of botMgr.bots) consider(b.name, b.kills);
    if (top >= scoreLimit) endMatch(who);
  }
}
function endMatch(winner) {
  matchWinner = winner; matchOverTimer = 7;
  if (mp.isHost) mp.broadcast({ t: 'roundover', winner });
  hud.showRoundOver(winner); hud.announce(`${winner} wins!`, '#ffd86b'); sfx.announce('win');
}
function resetMatch() {
  myKills = 0; myDeaths = 0; humanScore.clear();
  combo = 0; comboTimer = 0; firstBlood = true;
  for (const b of botMgr.bots) { b.kills = 0; b.deaths = 0; respawnBot(b); }
  matchWinner = null; hud.hideRoundOver();
  const sp = teamSpawnPoint(myTeam); player.pos.set(sp.x, sp.y, sp.z); player.vel.set(0, 0, 0);
  health = 20; hud.setHealth(20); invuln = 1.5; lastHitBy = null;
  if (mp.isHost) mp.broadcast({ t: 'roundreset' });
  rebuildBoard(); broadcastBoard();
}

// Damage a bot locally (authority); death is finalised in manageBots().
function botHurt(botId, dmg, fromName, head) {
  const b = botMgr.get(botId); if (!b || !b.alive) return;
  b.lastHitByName = fromName; b.lastHitTime = performance.now() / 1000; b.lastHeadshot = !!head;
  b.hurt(dmg);
}
function onBotKilled(b) {
  particles.burst(b.pos.x, b.pos.y + 1, b.pos.z, [255, 120, 120], 24);
  const killer = (performance.now() / 1000 - (b.lastHitTime || 0) < 10) ? b.lastHitByName : null;
  hud.addKill(b.name, killer);
  if (killer === myName()) announceKill(b.lastHeadshot);
  if (mp.isHost) mp.broadcast({ t: 'death', id: b.id, name: b.name, by: killer });
  registerKill(killer, b.id);
  b.mesh.visible = false; b.respawnIn = 2.5;
}
function respawnBot(b) {
  b.alive = true; b.deathProcessed = false; b.health = 20;
  const sp = teamSpawnPoint(b.team); b.pos.set(sp.x, sp.y, sp.z); b.vel.set(0, 0, 0);
  b._chooseGun(); b.mesh.visible = true;
}
function manageBots(dt) {
  for (const b of botMgr.bots) {
    if (!b.alive && !b.deathProcessed) { b.deathProcessed = true; onBotKilled(b); }
    else if (!b.alive && b.respawnIn > 0) { b.respawnIn -= dt; if (b.respawnIn <= 0) respawnBot(b); }
  }
}

// Arena pickups (health + ammo) — purely local; each player grabs their own.
function setupArenaPickups() {
  const F = ARENA.FLOOR + 1.4, spots = [];
  for (const [x, z] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) spots.push({ x, y: F, z, kind: 'health' });
  for (const [x, z] of [[16, 16], [-16, 16], [16, -16], [-16, -16]]) spots.push({ x, y: F, z, kind: 'ammo' });
  pickups.setup(spots);
}
function applyPickup(kind) {
  if (kind === 'health') {
    if (health >= 20) return false;
    health = Math.min(20, health + 8); hud.setHealth(health);
    sfx.place(); particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, [80, 230, 120], 16);
    return true;
  }
  let refilled = false;
  for (const id of BATTLE_LOADOUT) { const g = gunOf(id); if (g && g.mag && (ammo[id] === undefined || ammo[id] < g.mag)) { ammo[id] = g.mag; refilled = true; } }
  if (refilled) {
    if (reloadingGun >= 0) reloadingGun = -1;
    sfx.place(); particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, [240, 200, 80], 16);
  }
  return refilled;
}

// Build the combatant target list bots reason about (players + bots).
function buildTargets() {
  const list = [{ id: selfId(), team: myTeam, pos: player.pos, vel: player.vel, alive: health > 0 }];
  if (mp.online) for (const [id, r] of mp.remotes) { if (botMgr.get(id)) continue; list.push({ id, team: teamOf(id), pos: r.group.position, alive: true }); }
  for (const b of botMgr.bots) list.push({ id: b.id, team: b.team, pos: b.pos, vel: b.vel, alive: b.alive });
  return list;
}
const _los = new THREE.Vector3(), _losDir = new THREE.Vector3(), _botEye = new THREE.Vector3();
function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const hit = voxelRaycast(_los.set(ax, ay, az), _losDir.set(dx / len, dy / len, dz / len), len - 0.6, (x, y, z) => world.getBlock(x, y, z));
  return !hit.hit;
}

// Resolve a bot's bullet against every combatant + the world (authority only).
function localPlayerRayHit(origin, dir, maxDist) {
  const t = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
    player.pos.x - 0.3, player.pos.y, player.pos.z - 0.3, player.pos.x + 0.3, player.pos.y + 1.8, player.pos.z + 0.3);
  if (t > maxDist) return null;
  return { dist: t, head: (origin.y + dir.y * t) >= player.pos.y + 1.5 };
}
function botBullet(bot, dir, range, dmg, pierce) {
  bot.eye(_botEye);
  const block = voxelRaycast(_botEye, dir, range, (x, y, z) => world.getBlock(x, y, z));
  const wallDist = block.hit ? Math.hypot(block.x + 0.5 - _botEye.x, block.y + 0.5 - _botEye.y, block.z + 0.5 - _botEye.z) : range;
  // Gather candidate combatant hits within the wall distance.
  const hits = [];
  const lp = (bot.team < 0 || bot.team !== myTeam) ? localPlayerRayHit(_botEye, dir, wallDist) : null;
  if (lp) hits.push({ kind: 'local', dist: lp.dist, head: lp.head });
  const bh = botMgr.raycast(_botEye, dir, wallDist, bot.id);
  if (bh && (bot.team < 0 || botMgr.get(bh.id).team !== bot.team)) hits.push({ kind: 'bot', id: bh.id, dist: bh.dist, head: bh.head });
  if (mp.online) for (const ph of mp.raycastAll(_botEye, dir, wallDist)) {
    if (bot.team >= 0 && teamOf(ph.id) === bot.team) continue;
    hits.push({ kind: 'remote', id: ph.id, dist: ph.dist, head: ph.head });
  }
  const mh = mobs.raycast(_botEye, dir, wallDist);
  if (mh) hits.push({ kind: 'mob', mob: mh.mob, dist: mh.dist });
  hits.sort((a, b) => a.dist - b.dist);
  for (const h of hits) {
    const d = h.head ? Math.round(dmg * 1.5) : dmg;
    if (h.kind === 'local') { lastHitBy = bot.name; lastHitTime = performance.now() / 1000; damagePlayer(d, bot.pos.x, bot.pos.z); }
    else if (h.kind === 'bot') botHurt(h.id, d, bot.name, h.head);
    else if (h.kind === 'remote') mp.sendHit(h.id, d, h.head);
    else if (h.kind === 'mob') h.mob.hurt(d, bot.pos.x, bot.pos.z);
    if (!pierce) break;
  }
}
// Visual-only tracer for a shot (used locally and replayed from 'bfire').
function shotTracer(kind, muzzle, dir, range, color) {
  const block = voxelRaycast(muzzle, dir, range, (x, y, z) => world.getBlock(x, y, z));
  const d = block.hit ? Math.hypot(block.x + 0.5 - muzzle.x, block.y + 0.5 - muzzle.y, block.z + 0.5 - muzzle.z) : Math.min(range, 60);
  const end = muzzle.clone().addScaledVector(dir, d);
  tracers.add(muzzle, end, color);
  if (kind === 'rail') tracers.add(muzzle, end, 0xe6d4ff);
}
// A bot fires its current gun (authority): resolve damage + spawn/broadcast visuals.
function botFire(bot, dir) {
  const gun = bot.gun;
  bot.eye(_botEye);
  const muzzle = _botEye.clone().addScaledVector(dir, 0.6);
  const color = gun.kind === 'rail' ? 0xb98bff : (gun.zoom ? 0xbfe4ff : 0xffd27a);
  if (gun.kind === 'shotgun') {
    for (let i = 0; i < gun.pellets; i++) { const pd = spreadDir(dir, gun.spread); botBullet(bot, pd, gun.range, gun.damage, false); shotTracer('shotgun', muzzle, pd, gun.range, color); }
  } else if (gun.kind === 'rail') {
    botBullet(bot, dir, gun.range, gun.damage, true); shotTracer('rail', muzzle, dir, gun.range, color);
  } else {
    const pd = gun.spread ? spreadDir(dir, gun.spread) : dir;
    botBullet(bot, pd, gun.range, gun.damage, false); shotTracer('hitscan', muzzle, pd, gun.range, color);
  }
  sfx.gunAt(gun.kind === 'rail' ? 'rail' : gun.kind === 'shotgun' ? 'shotgun' : gun.zoom ? 'sniper' : 'handgun', muzzle.x, muzzle.y, muzzle.z);
  if (mp.isHost) mp.broadcast({ t: 'bfire', kind: gun.kind, x: muzzle.x, y: muzzle.y, z: muzzle.z, dx: dir.x, dy: dir.y, dz: dir.z, range: gun.range, color });
}
let botBroadcastT = 0;
function broadcastBotPositions() {
  mp.broadcast({ t: 'bpos', bots: botMgr.bots.map((b) => ({ id: b.id, name: b.name, skin: b.skinId, team: b.team, x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, alive: b.alive })) });
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
function setDifficultyDirect(d) { difficulty = d; hud.setDifficulty(DIFF_NAMES[d]); }

// ---------- Keyboard (E inventory, G mode, B difficulty) ----------
window.addEventListener('keydown', (e) => {
  if (isTyping()) return; // don't trigger game keys while typing in chat/menu
  if (e.code === 'KeyE') {
    if (dead) return;
    if (inventory.open) closeInventory(); else openInventory(2);
  } else if (e.code === 'Escape' && inventory.open) {
    inventory.close(); refreshOverlays();
  } else if (e.code === 'KeyG') {
    if (!dead && !inventory.open) toggleMode();
  } else if (e.code === 'KeyB') {
    if (!dead && !inventory.open && mode !== BATTLE) applyDifficulty();
  } else if (e.code === 'KeyR') {
    const g2 = gunOf(inventory.selectedId());
    if (g2 && g2.mag && player.locked && !dead) startReload(g2, inventory.selectedId());
  } else if (e.code === 'KeyT' || e.code === 'Enter') {
    if (player.locked && !inventory.open && !dead && !hud.isChatOpen()) { e.preventDefault(); player.keys.clear(); hud.openChat(); }
  }
});

// ---------- Mouse ----------
let mouseLeft = false, mouseRight = false;
renderer.domElement.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) { mouseLeft = true; breakCD = 0; attackCD = 0; triggerConsumed = false; }
  if (e.button === 2) { mouseRight = true; placeCD = 0; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseLeft = false; triggerConsumed = false; resetBreak(); }
  if (e.button === 2) mouseRight = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

const _dir = new THREE.Vector3(), _eye = new THREE.Vector3(), _camFwd = new THREE.Vector3();
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
  sfx.explosionAt(cx, cy, cz);
  const d = Math.hypot(player.pos.x - cx, player.pos.y + 0.9 - cy, player.pos.z - cz);
  addShake(Math.max(0, 0.45 * (1 - d / 16)));
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
  const playerHit = mp.online ? mp.raycast(_eye, _dir, MELEE_REACH) : null;
  const blockDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : Infinity;
  const mobDist = mobHit ? mobHit.dist : Infinity;
  const playerDist = playerHit ? playerHit.dist : Infinity;

  // Melee a player or a mob if either is closer than the targeted block.
  if (playerHit && playerDist <= mobDist && playerDist < blockDist) {
    resetBreak();
    if (attackCD <= 0) {
      mp.sendHit(playerHit.id, meleeDamage(inventory.selectedId()));
      const e = _eye.clone().addScaledVector(_dir, playerDist);
      particles.burst(e.x, e.y, e.z, [255, 60, 60], 6);
      sfx.break(); hud.hitMarker(); attackCD = 0.4;
    }
    return;
  }
  if (mobHit && mobDist < blockDist) {
    resetBreak();
    if (attackCD <= 0) {
      mobHit.mob.hurt(mode === CREATIVE ? 20 : meleeDamage(inventory.selectedId()), player.pos.x, player.pos.z);
      particles.burst(mobHit.mob.pos.x, mobHit.mob.pos.y + mobHit.mob.height * 0.6, mobHit.mob.pos.z, [200, 60, 60], 6);
      sfx.break(); hud.hitMarker(); attackCD = 0.4;
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

// Sniper scope: narrow the FOV, swap the crosshair for the scope overlay, and
// hide the viewmodel (you're looking down the optic).
const scopeEl = document.getElementById('scope');
const crosshairEl = document.getElementById('crosshair');
function setScoped(on) {
  if (on === zoomed) return;
  zoomed = on;
  camera.fov = on ? 19 : player.fov;
  camera.updateProjectionMatrix();
  scopeEl.style.display = on ? 'block' : 'none';
  crosshairEl.style.display = on ? 'none' : 'block';
  if (viewModel) viewModel.visible = !on;
}

// Perturb an aim direction within a cone of `spread` radians (returns a shared
// temp vector — use it before the next call).
const _rt = new THREE.Vector3(), _up2 = new THREE.Vector3(), _sd = new THREE.Vector3();
const _WORLD_UP = new THREE.Vector3(0, 1, 0);
function spreadDir(dir, spread) {
  if (!spread) return dir;
  _rt.crossVectors(dir, _WORLD_UP);
  if (_rt.lengthSq() < 1e-6) _rt.set(1, 0, 0);
  _rt.normalize();
  _up2.crossVectors(_rt, dir).normalize();
  const ox = (Math.random() + Math.random() - 1) * spread;
  const oy = (Math.random() + Math.random() - 1) * spread;
  return _sd.copy(dir).addScaledVector(_rt, ox).addScaledVector(_up2, oy).normalize();
}

function fireGun(gun, secondary) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const muzzle = _eye.clone().addScaledVector(_dir, 0.6);
  if (gun.kind === 'hitscan') fireHitscan(gun, muzzle);
  else if (gun.kind === 'shotgun') fireShotgun(gun, muzzle);
  else if (gun.kind === 'rail') fireRail(gun, muzzle);
  else if (gun.kind === 'plasma') { plasmas.spawn(muzzle, _dir, gun.speed, gun.damage, gun.range); sfx.plasma(); }
  else if (gun.kind === 'rocket') { rockets.spawn(muzzle, _dir.clone(), gun, mp.myId || 'me'); sfx.gun('shotgun'); }
  else if (gun.kind === 'portal') firePortal(secondary ? 1 : 0, gun);
}

// Nearest damageable enemy (remote humans + local bots) along a ray.
function raycastEnemies(origin, dir, maxDist) {
  let best = mp.online ? mp.raycast(origin, dir, maxDist) : null;
  if (isAuthority()) { const b = botMgr.raycast(origin, dir, best ? best.dist : maxDist, null); if (b && (!best || b.dist < best.dist)) best = b; }
  return best;
}
let _suppressDmgNum = false;
// One hitscan ray (already-perturbed `dir`) resolved against enemies, mobs and
// blocks. Returns the world-space endpoint, applying damage to whatever it hits.
function castBullet(dir, range, damage) {
  const enemy = raycastEnemies(_eye, dir, range);
  const mobHit = mobs.raycast(_eye, dir, range);
  const blockHit = voxelRaycast(_eye, dir, range, (x, y, z) => world.getBlock(x, y, z));
  const blockDist = blockHit.hit ? Math.hypot(blockHit.x + 0.5 - _eye.x, blockHit.y + 0.5 - _eye.y, blockHit.z + 0.5 - _eye.z) : Infinity;
  const enemyDist = enemy ? enemy.dist : Infinity;
  const mobDist = mobHit ? mobHit.dist : Infinity;
  const nearest = Math.min(blockDist, enemyDist, mobDist);
  if (enemy && enemyDist === nearest) {
    const end = _eye.clone().addScaledVector(dir, enemyDist);
    if (!friendly(enemy.id)) {
      const dmg = enemy.head ? Math.round(damage * 1.7) : damage;
      if (enemy.bot) botHurt(enemy.id, dmg, myName(), enemy.head); else mp.sendHit(enemy.id, dmg, enemy.head);
      particles.burst(end.x, end.y, end.z, enemy.head ? [255, 220, 60] : [255, 70, 70], enemy.head ? 16 : 10);
      if (!_suppressDmgNum) damageNumbers.spawn(end, dmg, enemy.head);
      hud.hitMarker(enemy.head);
    }
    return end;
  }
  if (mobHit && mobDist === nearest) {
    mobHit.mob.hurt(damage, player.pos.x, player.pos.z);
    const end = _eye.clone().addScaledVector(dir, mobDist);
    particles.burst(end.x, end.y, end.z, [220, 80, 80], 8);
    if (!_suppressDmgNum) damageNumbers.spawn(end, damage, false);
    hud.hitMarker(false);
    return end;
  }
  if (blockHit.hit) {
    const end = new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
    particles.burst(end.x, end.y, end.z, blockTint(world.getBlock(blockHit.x, blockHit.y, blockHit.z)), 6);
    return end;
  }
  return _eye.clone().addScaledVector(dir, range);
}

function fireHitscan(gun, muzzle) {
  const dir = spreadDir(_dir, gun.spread);
  const end = castBullet(dir, gun.range, gun.damage);
  tracers.add(muzzle, end, gun.zoom ? 0xbfe4ff : 0xffe08a);
  sfx.gun(gun.zoom ? 'sniper' : 'handgun');
}

// Shotgun: a cone of pellets (no per-pellet damage numbers — markers suffice).
function fireShotgun(gun, muzzle) {
  _suppressDmgNum = true;
  for (let i = 0; i < gun.pellets; i++) {
    const dir = spreadDir(_dir, gun.spread);
    const end = castBullet(dir, gun.range, gun.damage);
    tracers.add(muzzle, end, 0xffc46a);
  }
  _suppressDmgNum = false;
  sfx.gun('shotgun');
}

// Railgun: a piercing beam that damages every enemy along the ray up to the wall.
function fireRail(gun, muzzle) {
  const blockHit = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  const wallDist = blockHit.hit ? Math.hypot(blockHit.x + 0.5 - _eye.x, blockHit.y + 0.5 - _eye.y, blockHit.z + 0.5 - _eye.z) : gun.range;
  for (const m of mobs.list) {
    const t = m.rayHit(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, wallDist);
    if (t < wallDist) m.hurt(gun.damage, player.pos.x, player.pos.z);
  }
  const enemies = [];
  if (mp.online) for (const ph of mp.raycastAll(_eye, _dir, wallDist)) enemies.push({ id: ph.id, head: ph.head, bot: false });
  if (isAuthority()) for (const bh of botMgr.raycastAll(_eye, _dir, wallDist, null)) enemies.push({ id: bh.id, head: bh.head, bot: true });
  for (const e of enemies) {
    if (friendly(e.id)) continue;
    const dmg = e.head ? Math.round(gun.damage * 1.4) : gun.damage;
    if (e.bot) botHurt(e.id, dmg, myName(), e.head); else mp.sendHit(e.id, dmg, e.head);
    hud.hitMarker(e.head);
  }
  const end = _eye.clone().addScaledVector(_dir, wallDist);
  tracers.add(muzzle, end, 0xb98bff);
  tracers.add(muzzle, end, 0xe6d4ff);   // doubled for a thick beam
  sfx.gun('rail');
}

// Everything portals can teleport: the player, mobs and bots.
function portalBodies() {
  const list = [player];
  for (const m of mobs.list) list.push(m);
  for (const b of botMgr.bots) if (b.alive) list.push(b);
  return list;
}

function firePortal(slot, gun) {
  const hit = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  if (!hit.hit) return;
  portals.set(slot,
    new THREE.Vector3(hit.x + 0.5 + hit.nx * 0.5, hit.y + 0.5 + hit.ny * 0.5, hit.z + 0.5 + hit.nz * 0.5),
    new THREE.Vector3(hit.nx, hit.ny, hit.nz));
  sfx.portal();
}

// Rocket explosion: AoE damage (mobs / remote players / self with knockback) plus
// destruction of soft cover (wool/planks/glass/leaves) — never the floor or walls.
function rocketImpact(pos, gun) {
  particles.burst(pos.x, pos.y, pos.z, [255, 150, 60], 44);
  particles.burst(pos.x, pos.y, pos.z, [120, 120, 120], 22);
  sfx.explosionAt(pos.x, pos.y, pos.z);
  const pd = Math.hypot(player.pos.x - pos.x, player.pos.y - pos.y, player.pos.z - pos.z);
  addShake(Math.max(0, 0.5 * (1 - pd / 24)));
  const R = gun.radius;
  for (const m of mobs.list) {
    const d = Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z);
    if (d < R) m.hurt(Math.round(gun.splash * (1 - d / R)), pos.x, pos.z);
  }
  if (mp.online) for (const { id, dist } of mp.playersNear(pos, R)) {
    mp.sendHit(id, Math.round(gun.splash * (1 - dist / R))); hud.hitMarker(false);
  }
  // Self splash (rocket-jump): less damage, full knockback via damagePlayer.
  const ds = Math.hypot(player.pos.x - pos.x, player.pos.y + 0.9 - pos.y, player.pos.z - pos.z);
  if (ds < R) damagePlayer(Math.round(gun.splash * (1 - ds / R) * 0.45), pos.x, pos.z);
  // Blow apart soft cover only.
  const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
  const batch = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    if (dx * dx + dy * dy + dz * dz > 5) continue;
    const x = fx + dx, y = fy + dy, z = fz + dz, b = world.getBlock(x, y, z);
    if (b === WOOL || b === PLANK || b === GLASS || b === LEAVES) { recordEdit(x, y, z, AIR); batch.push([x, y, z, AIR]); }
  }
  mp.sendEdits(batch);
}

function plasmaImpact(pos, dmg, hitPlayer) {
  particles.burst(pos.x, pos.y, pos.z, [140, 255, 235], 26);
  for (const m of mobs.list) {
    if (Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z) < 2.3) m.hurt(dmg, pos.x, pos.z);
  }
  if (mp.online) {
    if (hitPlayer) { mp.sendHit(hitPlayer, dmg); hud.hitMarker(); }
    for (const { id } of mp.playersNear(pos, 2.6)) {       // splash damage
      if (id === hitPlayer) continue;
      mp.sendHit(id, Math.round(dmg * 0.6)); hud.hitMarker();
    }
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

  // In the menu / loading screen the camera slowly orbits the spawn as a live
  // cinematic background; while playing it follows the player.
  const menuView = !loaded || (!everPlayed && !player.locked);
  world.update(menuView ? SPAWN.x : player.pos.x, menuView ? SPAWN.z : player.pos.z);
  world.processQueues(loaded ? 6 : 16);
  if (!loaded) updateLoading();

  const active = loaded && player.locked && !inventory.open && !dead && !hud.isChatOpen();

  if (loaded && player.locked && !dead) {
    player.update(dt);
    // Fell off the arena into the void → eliminate + respawn.
    if (mode === BATTLE && player.pos.y < ARENA.FLOOR - 25) battleDeath();
    if (player.fallImpact > 0) { damagePlayer(Math.ceil(player.fallImpact * 0.6)); player.fallImpact = 0; }
    if (active && player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1.4) {
      const fb = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
      sfx.step(stepCategory(fb));
    }
    // Recoil (player camera only): vertical kick + horizontal sway, recovering.
    recoilPitch *= Math.max(0, 1 - 14 * dt);
    recoilYaw *= Math.max(0, 1 - 10 * dt);
    recoilKick *= Math.max(0, 1 - 12 * dt);
    camera.rotation.x -= recoilPitch;
    camera.rotation.y += recoilYaw;
    if (shakeAmt > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shakeAmt;
      camera.position.y += (Math.random() - 0.5) * shakeAmt;
      camera.position.z += (Math.random() - 0.5) * shakeAmt * 0.5;
      camera.rotation.z += (Math.random() - 0.5) * shakeAmt * 0.6;
    }
    if (viewModel) viewModel.position.z = -0.85 + recoilKick;
    updateViewModel();
  } else if (menuView) {
    menuCamera(dt);
    hideViewModel();
  } else {
    player.update(0);   // paused (inventory / death) after playing
    updateViewModel();
  }

  if (reloadingGun >= 0) { reloadTimer -= dt; if (reloadTimer <= 0) { const rg = gunOf(reloadingGun); if (rg) ammo[reloadingGun] = rg.mag; reloadingGun = -1; sfx.place(); } }

  sky.update(dt);
  hud.setClock(sky.clockString());
  waterTime.value += dt;

  // Drive mob lighting from the sun.
  sun.position.copy(sky.sunDir).multiplyScalar(100);
  sun.color.copy(sky.dirColor); sun.intensity = sky.dirIntensity;
  ambient.color.copy(sky.dirColor); ambient.intensity = sky.ambIntensity;

  mobs.update(loaded && !dead && mode !== BATTLE ? dt : 0, player, sky.isNight, {
    damagePlayer, onKill, explode, peaceful: difficulty === PEACEFUL, dmgMul: DMG_MUL[difficulty],
  });

  // Bots + match flow: the authority simulates; guests render via broadcasts.
  if (mode === BATTLE && loaded) {
    if (isAuthority()) {
      botMgr.update(matchWinner ? 0 : dt, { world, los: losClear, targets: buildTargets(), fire: botFire, coverPoints, arenaFloorY: ARENA.FLOOR });
      manageBots(dt);
      if (mp.isHost) { botBroadcastT -= dt; if (botBroadcastT <= 0) { botBroadcastT = 0.066; broadcastBotPositions(); } }
    }
    if (matchOverTimer > 0) { matchOverTimer -= dt; if (matchOverTimer <= 0 && isAuthority()) resetMatch(); }
    pickups.update(dt, player.pos, active ? applyPickup : () => false);

    // Radar: teammates green, enemies red, rotated so you face up.
    const RANGE = 64, blips = [], sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
    const addBlip = (pos, team, alive) => {
      if (!alive) return;
      const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z;
      if (dx * dx + dz * dz > RANGE * RANGE) return;
      blips.push({ rx: (dx * cosY - dz * sinY) / RANGE, ry: -(dx * sinY + dz * cosY) / RANGE,
        color: (teamMode && team === myTeam) ? '#57d977' : '#ff5b5b' });
    };
    for (const [id, r] of mp.remotes) addBlip(r.group.position, teamOf(id), r.group.visible);
    if (isAuthority()) for (const b of botMgr.bots) addBlip(b.pos, b.team, b.alive);
    hud.drawRadar(blips);
  }

  // Interaction
  invuln -= dt; breakCD -= dt; placeCD -= dt; attackCD -= dt; fireCD -= dt; fire2CD -= dt;
  const gun = gunOf(inventory.selectedId());
  if (active && gun) {
    resetBreak();
    const id = inventory.selectedId();
    // Auto guns fire while held; the rest fire once per click.
    if (mouseLeft && fireCD <= 0 && (gun.auto || !triggerConsumed)) {
      if (gun.mag && reloadingGun === id) { /* busy reloading */ }
      else if (gun.mag && ammoFor(gun, id) <= 0) { startReload(gun, id); fireCD = 0.25; triggerConsumed = true; }
      else {
        fireGun(gun, false);
        if (gun.mag) ammo[id]--;
        // Per-gun recoil: vertical kick, a little horizontal sway, viewmodel kickback.
        const rc = gun.recoil || 0.015;
        muzzle.flash();
        recoilPitch += rc;
        recoilYaw += (Math.random() - 0.5) * rc * 0.9;
        recoilKick += Math.min(0.16, rc * 1.6 + 0.03);
        addShake(Math.min(0.1, rc * 0.9));
        fireCD = gun.rate;
        if (!gun.auto) triggerConsumed = true;
      }
    }
    if (gun.kind === 'portal' && mouseRight && fire2CD <= 0) { fireGun(gun, true); recoilKick += 0.05; fire2CD = gun.rate; }
  } else if (active) {
    if (mouseLeft) attackOrBreak(dt); else resetBreak();
    if (mouseRight && placeCD <= 0) { handleUse(); placeCD = 0.25; }
  }
  setScoped(active && !!gun && !!gun.zoom && mouseRight);
  if (active) survivalTick(dt, Math.hypot(player.vel.x, player.vel.z) > 1.2);

  // Block highlight (hidden while aiming a gun)
  const hit = castFromEye();
  highlight.visible = active && !gun && hit.hit;
  if (hit.hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

  // Ammo readout
  if (gun) {
    const id = inventory.selectedId();
    if (!gun.mag) hud.setAmmo('<span class="inf">∞</span>');
    else if (reloadingGun === id) hud.setAmmo('<span class="rl">RELOADING…</span>');
    else hud.setAmmo(`${ammoFor(gun, id)}<span style="opacity:.5">/${gun.mag}</span>`);
  } else hud.setAmmo(null);

  // Guns / projectiles / portals / co-op
  muzzle.update(dt);
  tracers.update(dt);
  plasmas.update(dt, world, mobs, mp, portals, plasmaImpact);
  rockets.update(dt, world, mobs, mp, portals, rocketImpact);
  portals.update(dt, portalBodies());
  mp.update(dt);
  if (active) mp.sendPos({ x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw });

  // Feel: decay shake + multikill window; update the 3D-audio listener (camera).
  shakeAmt *= Math.max(0, 1 - 9 * dt);
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }
  camera.getWorldDirection(_camFwd);
  sfx.setListener(camera.position.x, camera.position.y, camera.position.z, _camFwd.x, _camFwd.z);

  particles.update(dt);
  damageNumbers.update(dt);
  composer.render();
  stats.end();
}
const TIPS = [
  'Press G for Creative to grab the guns', 'Right-click a stack to split it in half',
  'Build a Crafting Table for tools', 'Creepers explode — keep your distance',
  'Host a co-op game from the menu and share the code', 'Portal Gun: left-click + right-click two portals',
  'Right-click the sniper to look down the scope', 'Different ground makes different footstep sounds',
  '⚔ Battle mode drops you into an arena to fight other players', 'In co-op you can damage other players — watch the kill feed',
];
setInterval(() => { const el = document.getElementById('loadingTip'); if (el && !loaded) el.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 2200);

startWorld();
frame();

window.__game = {
  world, player, sky, scene, renderer, mobs, inventory, mp, tracers, plasmas, rockets, portals,
  crackMesh, crackMat, CRACK_TEXTURES, edits,
  toggleMode, applyDifficulty, openInventory, newWorld, loadWorld,
  enterBattle: () => { menuMode = BATTLE; startSelectedMode(currentSeedStr, true); },
  damagePlayer, hud,
  get loaded() { return loaded; },
  get arena() { return arena; },
  get state() { return { mode, difficulty, diffName: DIFF_NAMES[difficulty], health, hunger, dead, arena }; },
};
