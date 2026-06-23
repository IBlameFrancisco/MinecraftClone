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
  LEAVES, GLASS, GLOWSTONE, CRAFTING_TABLE, CHEST, SAND, LOG, PLANK, SNOW, GRAVEL, WOOL, CACTUS, LAVA,
  hardness, BLOCK_TOOL, BLOCK_REQUIRES, isHot,
} from './blocks.js';
import { isFood, foodValue, APPLE, COAL, toolOf, meleeDamage, gunOf,
  HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN, SMG, ASSAULT_RIFLE, SHOTGUN, ROCKET_LAUNCHER, RAILGUN, BLACK_HOLE_BOMB, HEAVY_MG, RASENGAN, RASENSHURIKEN, LASER_CANNON, HOLLOW_PURPLE, SHARINGAN, CLEAVE } from './items.js';
import { World } from './world.js';
import { ARENA, BEACH, BEACH_SPAWN_ALLIED, BEACH_SPAWN_AXIS, BEACH_NESTS, beachGroundY, ARENA_THEME_NAMES } from './worldgen.js';
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
import { Multiplayer, makeAvatar } from './net.js';
import { SKINS, DEFAULT_SKIN, getSkin } from './skins.js';
import { Tracers, Plasmas, Rockets, Grenades, BlackHoles, ChakraFx, LaserBeam, HollowPurple, SharinganFx, CleaveFx, Portals, makeViewModel, makeHeldWeapon, MuzzleFlash, DamageNumbers } from './guns.js';
import { BotManager } from './bots.js';
import { Pickups } from './pickups.js';

const SURVIVAL = 0, CREATIVE = 1, BATTLE = 2;
const MELEE_REACH = 4;

// Battle mode: full gun loadout (9 slots = 9 guns) + arena spawn points.
// Deathmatch arsenal (one per hotbar key, slot 10 = key 0), one of each weapon class.
const BATTLE_LOADOUT = [HANDGUN, ASSAULT_RIFLE, SHOTGUN, SNIPER, RAILGUN, ROCKET_LAUNCHER, BLACK_HOLE_BOMB, LASER_CANNON, HOLLOW_PURPLE, CLEAVE, SHARINGAN];
// D-Day kit: WWII-flavoured (no plasma/portal sci-fi), with the belt-fed MG and a bazooka.
const WAR_LOADOUT = [HANDGUN, SMG, ASSAULT_RIFLE, SHOTGUN, SNIPER, HEAVY_MG, ROCKET_LAUNCHER];
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
renderer.toneMappingExposure = 1.12;
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
      float vig = smoothstep(0.95, 0.35, length(d));   // soft, gentle vignette
      c.rgb *= mix(0.84, 1.0, vig);
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;              // gentle contrast
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.22);               // a touch more vibrance
      gl_FragColor = c;
    }`,
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.52, 0.55, 0.78);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
composer.addPass(new ShaderPass(GradeShader));
const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);

// ---- Gravitational lensing: warp the rendered scene around active black holes.
// A full-screen pass (inserted before bloom) that bends sample coordinates radially
// toward each singularity with a frame-dragging swirl — the signature space-warp. ----
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

// Lights — used only by mob/avatar (Lambert) materials; chunks bake their own lighting.
// A hemisphere fill (sky tint above, dark ground below) gives blocky mobs even,
// natural shading instead of a flat ambient.
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a2a30, 0.5);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(ambient, hemi, sun);
const _lightDir = new THREE.Vector3();

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
const grenades = new Grenades(scene);
const blackholes = new BlackHoles(scene);
const chakra = new ChakraFx(scene);
const laser = new LaserBeam(scene);
const hollowPurple = new HollowPurple(scene);
const cleaveFx = new CleaveFx(scene);
const sharinganFx = new SharinganFx(scene);
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
// True i-frames: blocks ALL damage including PvP (spawn protection, death-cam, blink).
// Distinct from `invuln`, which PvP deliberately ignores so firefights aren't throttled.
let protect = 0;
let arena = false;                 // is the current world a battle map (arena/beach)?
let battleMap = 'arena';           // which battle map: 'arena' or 'beach' (D-Day)
let arenaTheme = 'ruins';          // arena re-skin (ruins/jungle/frozen/desert), random per match
let _forceTheme = null;   // test hook: pin the next arena theme
const pickArenaTheme = () => _forceTheme || ARENA_THEME_NAMES[(Math.random() * ARENA_THEME_NAMES.length) | 0];
let lastHitBy = null, lastHitTime = -100;   // for PvP kill attribution
let shakeAmt = 0;                  // screen-shake magnitude
let combo = 0, comboTimer = 0, firstBlood = true;   // announcer multikill tracking
function addShake(a) { shakeAmt = Math.min(0.6, shakeAmt + a); }
// Screen shake from an explosion at a world point, falling off to 0 by `dist` metres.
function shockShake(pos, intensity, dist) {
  const d = Math.hypot(player.pos.x - pos.x, player.pos.y - pos.y, player.pos.z - pos.z);
  addShake(Math.max(0, intensity * (1 - d / dist)));
}
function announceKill(head) {
  comboTimer = 3.2; combo++; streak++;
  let txt = null, snd = 'first';
  if (firstBlood) { firstBlood = false; txt = 'FIRST BLOOD'; }
  else if (combo >= 4) { txt = `${combo}× MULTI KILL!`; snd = 'multi'; }
  else if (combo === 3) { txt = 'TRIPLE KILL'; snd = 'multi'; }
  else if (combo === 2) { txt = 'DOUBLE KILL'; snd = 'multi'; }
  else if (head) { txt = 'HEADSHOT'; }
  if (txt) { hud.announce(txt, combo >= 2 ? '#ff8f3a' : '#ffe27a'); sfx.announce(snd); }
  // Killstreak rewards (heal + a louder callout, no death in between).
  const streaks = { 3: 'KILLING SPREE', 5: 'RAMPAGE', 7: 'UNSTOPPABLE', 10: 'GODLIKE' };
  if (streaks[streak]) {
    hud.announce(streaks[streak], '#ff5b6e'); sfx.announce('multi');
    if (mode === BATTLE) { health = 20; hud.setHealth(20); grenadeCount = Math.min(3, grenadeCount + 1); hud.setGrenades(grenadeCount); }
  }
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
let chargeT = 0, chargeGunId = -1, vmCharge = 0;   // chakra jutsu charge-up (hold to gather)
// Chakra reserve (the Naruto power-up): hold C to channel chakra, which powers jutsu.
const CHAKRA_MAX = 100, CHAKRA_REGEN = 7, CHAKRA_CHANNEL = 52;   // per second
const RASENGAN_COST = 28, RASENSHURIKEN_COST = 55, HOLLOW_PURPLE_COST = 80;
let chakraEnergy = CHAKRA_MAX, chargingChakra = false, chakraAuraI = 0, chakraSnd = false, chakraBurstReady = true;
// Sharingan: gaze tracking, the Amaterasu black-flame burns, and Precognition state.
let gazeTargetId = null, gazeHold = 0, gazeBcCD = 0;
let precogT = 0, precogCD = 0, precogXray = false;
const amaBurn = new Map();     // id ('bot:x' / remote id) -> { t, acc, dps, src }
const _amaP = new THREE.Vector3();
let grenadeCount = 0, grenadeCD = 0, streak = 0;   // grenades + killstreaks
const ammo = {};
let reloadingGun = -1, reloadTimer = 0, reloadDur = 1, recoilPitch = 0, recoilYaw = 0, vmRecoil = 0;
// Viewmodel animation + aim-down-sights state.
let adsAmount = 0, vmEquip = 0, vmSwayX = 0, vmSwayY = 0, lastYaw = 0, lastPitch = 0;
function ammoFor(gun, id) { if (!gun.mag) return Infinity; if (ammo[id] === undefined) ammo[id] = gun.mag; return ammo[id]; }
function startReload(gun, id) {
  if (!gun.mag || reloadingGun === id || (ammo[id] ?? gun.mag) >= gun.mag) return;
  reloadingGun = id; reloadTimer = gun.reload; reloadDur = gun.reload;
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
let atMenu = true;    // on the home/start screen (before play or after Main Menu)
let paused = false;   // the in-game pause menu (Esc) is showing
const lobby = { active: false, host: false, players: new Map() };   // co-op pre-match team lobby (declared early so refreshOverlays can read it)
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
  if (viewModel) { camera.remove(viewModel); viewModel.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } else if (o.isSprite && o.material) o.material.dispose(); }); viewModel = null; viewGunId = -1; }
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
    if (sp.yaw !== undefined) player.yaw = sp.yaw;
  } else {
    player.pos.set(SPAWN.x, world.surfaceHeight(Math.floor(SPAWN.x), Math.floor(SPAWN.z)) + 2, SPAWN.z);
    SPAWN.y = player.pos.y;
  }
  player.vel.set(0, 0, 0);
  const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
  refreshOverlays();
}

// Regenerate from a seed (start-screen "New World" / Battle / joining a host).
function loadWorld(seedStr, mapKind, theme) {
  currentSeedStr = (seedStr && seedStr.trim()) ? seedStr.trim() : randomSeedStr();
  seedInput.value = currentSeedStr;
  arena = !!mapKind;
  battleMap = mapKind === 'beach' ? 'beach' : 'arena';
  // Pick a fresh random arena re-skin each time an arena map loads (the D-Day
  // beach has its own dedicated look) unless one was explicitly handed in.
  if (battleMap === 'arena' && arena) arenaTheme = theme || pickArenaTheme();
  world.regenerate(hashSeed(currentSeedStr), mapKind, arenaTheme);
  if (arena && battleMap === 'arena') sky.setArenaTheme(arenaTheme);
  edits.clear(); editsByChunk.clear(); chestStore.clear(); mobs.clearAll(); botMgr.clear();
  setupHill(false); setupZone(false);
  if (!mapKind && mode === SURVIVAL) { health = 20; hunger = 20; hud.setHealth(20); hud.setHunger(20); }
  dead = false; resetBreak(); startWorld();
}
function newWorld(seedStr) { loadWorld(seedStr, false); }

// ---------- Overlays (play / pause / death) ----------
const overlay = document.getElementById('overlay');
const pauseEl = document.getElementById('pause');
const deathEl = document.createElement('div');
deathEl.id = 'death';
deathEl.innerHTML = `<div class="card"><h1>YOU DIED</h1><p class="play" id="respawn">↺ Respawn</p><p id="hcnote" style="display:none;opacity:0.8;font-size:14px;margin-top:8px">Hardcore — reload the page to start a new world</p></div>`;
deathEl.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(60,0,0,0.55);backdrop-filter:blur(3px);pointer-events:auto;z-index:25;text-align:center;';
document.getElementById('ui').appendChild(deathEl);

function refreshOverlays() {
  const locked = document.pointerLockElement === renderer.domElement;
  const blocked = dead || inventory.open || hud.isChatOpen() || lobby.active;   // the team lobby covers everything
  const inWorld = loaded && !atMenu;                 // has entered a game
  // Home/start menu: only before entering a world (or after Main Menu).
  overlay.classList.toggle('hidden', !loaded || locked || blocked || inWorld || lobby.active);
  // Pause menu: after entering, whenever the pointer is released (Esc / focus loss).
  paused = inWorld && !locked && !blocked;
  pauseEl.classList.toggle('hidden', !paused);
  deathEl.style.display = dead ? 'flex' : 'none';
}
refreshOverlays();

// Resume from the pause menu; Main Menu drops back to the home/start screen.
function resumeGame() { if (loaded && !dead) renderer.domElement.requestPointerLock(); }
// Returning to the home menu means leaving the match — invalidate the live
// signature so the next Play re-applies the selected mode (rebuilding its HUD)
// rather than silently resuming a torn-down battle.
function quitToMenu() { atMenu = true; leaveBattleCleanup(); liveSig = ''; document.exitPointerLock(); refreshOverlays(); }
pauseEl.addEventListener('click', (e) => { if (e.target === pauseEl) resumeGame(); });
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('pauseMenuBtn').addEventListener('click', quitToMenu);
document.getElementById('pauseSettingsBtn').addEventListener('click', () => document.getElementById('settings').classList.remove('hidden'));
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
    // A chosen map pins the theme (no more random switching); 'random'/War leave it unset.
    const theme = battleCfg.mode === 'war' || battleCfg.map === 'random' ? undefined : battleCfg.map;
    loadWorld(seedStr, battleCfg.mode === 'war' ? 'beach' : 'arena', theme);
    setupMatch();
  } else {
    setGameMode(menuMode);
    setDifficultyDirect(menuDiff);
    if (forceNew || arena) loadWorld(seedStr, false);
  }
  liveSig = menuSig();
}

// Signature of the live game vs. the current menu selection, so the Play button
// can tell "resume what's loaded" from "the user changed mode/options, start that".
function menuSig() {
  const b = battleCfg;
  return menuMode === BATTLE
    ? `B:${b.mode}:${b.team}:${b.side}:${b.size}:${b.botDiff}:${b.scoreLimit}:${b.map}`
    : `${menuMode}:${menuDiff}`;
}
let liveSig = '';

document.getElementById('playBtn').addEventListener('click', () => {
  if (dead) return;
  // Hosting a battle online → gather everyone in the team lobby first (pick teams + ready up).
  if (menuMode === BATTLE && mp.online && mp.isHost && !lobby.active) {
    currentSeedStr = seedInput.value.trim() || currentSeedStr;
    openLobby(); sfx.ensure(); return;
  }
  // Honour a changed mode/options/seed on the home menu instead of silently
  // resuming the old world; otherwise just lock back in and resume.
  const seedChanged = !!seedInput.value.trim() && seedInput.value.trim() !== currentSeedStr;
  if (!everPlayed || menuSig() !== liveSig || seedChanged) startSelectedMode(seedInput.value, seedChanged);
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
  updateSkinVisibility();
}
// War uses fixed faction uniforms, so hide the character/skin picker for it.
function updateSkinVisibility() {
  const sr = document.querySelector('.skinrow');
  if (sr) sr.style.display = (menuMode === BATTLE && battleCfg.mode === 'war') ? 'none' : '';
}
modeSurvBtn.addEventListener('click', () => { menuMode = SURVIVAL; refreshModePicker(); });
modeCreaBtn.addEventListener('click', () => { menuMode = CREATIVE; refreshModePicker(); });
modeBattleBtn.addEventListener('click', () => { menuMode = BATTLE; refreshModePicker(); });
document.getElementById('diffSelect').addEventListener('change', (e) => { menuDiff = parseInt(e.target.value, 10); });

// ---------- Battle setup (game mode, FFA/Teams, size, bot difficulty, score) ----------
const battleCfg = { mode: 'dm', team: false, side: 'allied', size: 6, botDiff: 'normal', scoreLimit: 20, map: 'random' };
const bsGameMode = document.getElementById('bsGameMode');
const bsTeamRow = document.getElementById('bsTeamRow');
const bsFFA = document.getElementById('bsModeFFA');
const bsTeam = document.getElementById('bsModeTeam');
const bsSize = document.getElementById('bsSize');
const bsSizeLabel = document.getElementById('bsSizeLabel');
const bsBotDiff = document.getElementById('bsBotDiff');
const bsScore = document.getElementById('bsScore');
const bsScoreRow = bsScore.closest('.bsrow');
const bsMap = document.getElementById('bsMap');
const bsMapRow = document.getElementById('bsMapRow');
// Modes that force free-for-all / co-op rather than letting you pick teams.
const FORCES_FFA = { gungame: true, br: true };
const FORCES_COOP = { wave: true };
function fillSizeOptions() {
  const war = battleCfg.mode === 'war';
  const teamSel = battleCfg.team && !FORCES_FFA[battleCfg.mode] && !FORCES_COOP[battleCfg.mode] && !war;
  const wave = battleCfg.mode === 'wave';
  bsSizeLabel.textContent = war ? 'Defenders' : wave ? 'Wave size' : teamSel ? 'Team size' : 'Combatants';
  const lo = war ? 4 : teamSel ? 1 : 2, hi = war ? 12 : teamSel ? 4 : 8, def = war ? 8 : teamSel ? 2 : 6;
  bsSize.innerHTML = '';
  for (let n = lo; n <= hi; n++) { const o = document.createElement('option'); o.value = n; o.textContent = teamSel ? `${n} v ${n}` : n; bsSize.appendChild(o); }
  battleCfg.size = Math.min(hi, Math.max(lo, def));
  bsSize.value = battleCfg.size;
}
function refreshBattleSetup() {
  const m = battleCfg.mode, war = m === 'war';
  bsTeamRow.style.display = (FORCES_FFA[m] || FORCES_COOP[m]) ? 'none' : 'flex';
  bsScoreRow.style.display = (m === 'gungame' || m === 'br' || m === 'wave' || war) ? 'none' : 'flex';   // auto win conditions
  // For War the FFA/Teams chips become an Allied/Axis side picker.
  bsFFA.textContent = war ? '⚔ Storm (Allied)' : 'Free-for-all';
  bsTeam.textContent = war ? '🛡 Hold (Axis)' : 'Teams';
  bsFFA.classList.toggle('active', war ? battleCfg.side === 'allied' : !battleCfg.team);
  bsTeam.classList.toggle('active', war ? battleCfg.side === 'axis' : battleCfg.team);
  if (bsMapRow) bsMapRow.style.display = war ? 'none' : 'flex';   // War always plays the D-Day beach
  updateSkinVisibility();
}
bsGameMode.addEventListener('change', (e) => { battleCfg.mode = e.target.value; fillSizeOptions(); refreshBattleSetup(); });
bsFFA.addEventListener('click', () => { if (battleCfg.mode === 'war') battleCfg.side = 'allied'; else battleCfg.team = false; fillSizeOptions(); refreshBattleSetup(); });
bsTeam.addEventListener('click', () => { if (battleCfg.mode === 'war') battleCfg.side = 'axis'; else battleCfg.team = true; fillSizeOptions(); refreshBattleSetup(); });
bsSize.addEventListener('change', (e) => { battleCfg.size = parseInt(e.target.value, 10); });
bsBotDiff.addEventListener('change', (e) => { battleCfg.botDiff = e.target.value; });
bsScore.addEventListener('change', (e) => { battleCfg.scoreLimit = parseInt(e.target.value, 10); });
if (bsMap) bsMap.addEventListener('change', (e) => { battleCfg.map = e.target.value; });
fillSizeOptions(); refreshBattleSetup();
refreshModePicker();

// ---------- Settings (FOV / sensitivity / render distance, persisted) ----------
const SETTINGS_KEY = 'guncraft.settings';
let settings;
try { settings = Object.assign({ fov: 75, sens: 1.0, rd: 7, deathcam: 3 }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
catch { settings = { fov: 75, sens: 1.0, rd: 7, deathcam: 3 }; }
const fovRange = document.getElementById('fovRange');
const sensRange = document.getElementById('sensRange');
const rdRange = document.getElementById('rdRange');
const dcRange = document.getElementById('dcRange');
const dcLabel = (v) => (v <= 0 ? 'Off' : v + 's');
const setText = (id, v) => { document.getElementById(id).textContent = v; };
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
function applySettings() {
  player.setFov(settings.fov); player.setSensitivity(settings.sens); world.renderDistance = settings.rd; sky.setRenderDistance(settings.rd);
  fovRange.value = settings.fov; setText('fovVal', settings.fov);
  sensRange.value = Math.round(settings.sens * 100); setText('sensVal', settings.sens.toFixed(2));
  rdRange.value = settings.rd; setText('rdVal', settings.rd);
  if (dcRange) { dcRange.value = settings.deathcam; setText('dcVal', dcLabel(settings.deathcam)); }
}
applySettings();
fovRange.addEventListener('input', () => { settings.fov = +fovRange.value; setText('fovVal', settings.fov); player.setFov(settings.fov); saveSettings(); });
sensRange.addEventListener('input', () => { settings.sens = +sensRange.value / 100; setText('sensVal', settings.sens.toFixed(2)); player.setSensitivity(settings.sens); saveSettings(); });
rdRange.addEventListener('input', () => { settings.rd = +rdRange.value; setText('rdVal', settings.rd); world.renderDistance = settings.rd; sky.setRenderDistance(settings.rd); saveSettings(); });
if (dcRange) dcRange.addEventListener('input', () => { settings.deathcam = +dcRange.value; setText('dcVal', dcLabel(settings.deathcam)); saveSettings(); });
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
// Stable fallback so the name doesn't re-randomise every call — kill attribution,
// gun-game progression, killstreaks and the scoreboard all compare names.
const _nameFallback = 'Player' + Math.floor(Math.random() * 1000);
const playerName = () => (document.getElementById('nameInput').value.trim() || _nameFallback);
// ---------- Co-op pre-match team lobby ----------
// After Host/Join, players gather in a lobby, pick a team (any mode can have teams),
// and ready up; the host starts when ready. Host-authoritative: the host owns the
// roster/team state and broadcasts it; guests send their pick as a request.
// (the `lobby` object itself is declared earlier so refreshOverlays can read it)
const LOBBY_TEAM_META = {
  red:    { label: 'Red',          color: '#ff6a6a' },
  blue:   { label: 'Blue',         color: '#7ab8ff' },
  ffa:    { label: 'Free-for-all', color: '#cfd6e2' },
  allied: { label: '🪖 Allied',    color: '#cdd08a' },
  axis:   { label: '🛡 Axis',      color: '#a9b0b8' },
};
const LOBBY_MODE_LABELS = { dm: 'Deathmatch', gungame: 'Gun Game', koth: 'King of the Hill', br: 'Battle Royale', wave: 'Wave Survival', war: 'D-Day Assault' };
const lobbyEl = document.getElementById('lobby');
function lobbyTeamOptions() { return battleCfg.mode === 'war' ? ['allied', 'axis'] : ['red', 'blue', 'ffa']; }
function defaultLobbyTeam() { return battleCfg.mode === 'war' ? 'allied' : 'ffa'; }
function lobbyTeamCode(t) {   // resolved lazily so the TEAM_* consts (defined later) aren't read at module-eval
  if (t === 'red' || t === 'allied') return TEAM_RED;
  if (t === 'blue' || t === 'axis') return TEAM_BLUE;
  return TEAM_NONE;
}
const _escL = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
function lobbyStatePayload() {
  return { phase: 'lobby', mode: battleCfg.mode, map: battleCfg.map, code: mp.roomCode, hostId: mp.myId,
    players: [...lobby.players.entries()].map(([id, p]) => ({ id, name: p.name, team: p.team, ready: p.ready })) };
}
function hostBroadcastLobby() { if (mp.isHost) mp.sendLobby(lobbyStatePayload()); }
function openLobby() {
  lobby.active = true; lobby.host = mp.isHost; atMenu = false;
  if (!lobby.players.has(selfId())) lobby.players.set(selfId(), { name: myName(), team: defaultLobbyTeam(), ready: false });
  if (mp.isHost) for (const [id, name] of mp.roster) if (!lobby.players.has(id)) lobby.players.set(id, { name, team: defaultLobbyTeam(), ready: false });
  // Fresh ready states each time, and snap any team that isn't valid for this mode back to default.
  const valid = lobbyTeamOptions();
  for (const [id, p] of lobby.players) { p.ready = id === selfId() && mp.isHost; if (!valid.includes(p.team)) p.team = defaultLobbyTeam(); }
  document.exitPointerLock(); lobbyEl.classList.remove('hidden');
  if (mp.isHost) hostBroadcastLobby();
  renderLobby();
}
function closeLobby() { lobby.active = false; lobbyEl.classList.add('hidden'); }
function onLobbyState(d) {                 // guest: receive the host's lobby
  lobby.active = true; lobby.host = false;
  battleCfg.mode = d.mode || battleCfg.mode; battleCfg.map = d.map || battleCfg.map; mp.roomCode = d.code || mp.roomCode;
  lobby.players.clear();
  for (const p of d.players || []) lobby.players.set(p.id, { name: p.name, team: p.team, ready: p.ready });
  if (!lobby.players.has(selfId())) lobby.players.set(selfId(), { name: myName(), team: defaultLobbyTeam(), ready: false });
  atMenu = false; document.exitPointerLock(); lobbyEl.classList.remove('hidden');
  renderLobby();
}
function onLobbyReq(id, name, team, ready) {  // host: a guest picked a team / readied
  if (!mp.isHost || !lobby.active) return;
  lobby.players.set(id, { name: name || 'Player', team: lobbyTeamOptions().includes(team) ? team : defaultLobbyTeam(), ready: !!ready });
  hostBroadcastLobby(); renderLobby();
}
function lobbyPickTeam(t) {
  const p = lobby.players.get(selfId()); if (!p) return;
  p.team = t;
  if (mp.isHost) hostBroadcastLobby(); else mp.sendLobbyReq(t, p.ready);
  renderLobby();
}
function lobbyToggleReady() {
  const p = lobby.players.get(selfId()); if (!p) return;
  p.ready = !p.ready;
  if (mp.isHost) hostBroadcastLobby(); else mp.sendLobbyReq(p.team, p.ready);
  renderLobby();
}
function renderLobby() {
  if (!lobby.active) return;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  document.getElementById('lobbyMode').textContent = LOBBY_MODE_LABELS[battleCfg.mode] || battleCfg.mode;
  document.getElementById('lobbyMap').textContent = battleCfg.mode === 'war' ? 'D-Day Beach' : (battleCfg.map === 'random' ? '🎲 Random' : cap(battleCfg.map));
  document.getElementById('lobbyCode').textContent = mp.roomCode ? ('Room ' + mp.roomCode) : '';
  const wrap = document.getElementById('lobbyPlayers'); wrap.innerHTML = '';
  for (const [id, p] of lobby.players) {
    const meta = LOBBY_TEAM_META[p.team] || LOBBY_TEAM_META.ffa;
    const row = document.createElement('div'); row.className = 'lprow';
    row.innerHTML = `<span class="lname">${_escL(p.name)}${id === selfId() ? '<span class="lyou">(you)</span>' : ''}</span>`
      + `<span class="lteamchip" style="background:${_hexA(meta.color, 0.18)};color:${meta.color}">${meta.label}</span>`
      + `<span class="lready">${p.ready ? '✅' : '⬜'}</span>`;
    wrap.appendChild(row);
  }
  const tb = document.getElementById('lobbyTeams'); tb.innerHTML = '';
  const mine = lobby.players.get(selfId());
  for (const t of lobbyTeamOptions()) {
    const meta = LOBBY_TEAM_META[t];
    const b = document.createElement('button'); b.className = 'lteambtn' + (mine && mine.team === t ? ' active' : '');
    b.textContent = meta.label; b.style.color = meta.color;
    b.onclick = () => lobbyPickTeam(t);
    tb.appendChild(b);
  }
  const rb = document.getElementById('lobbyReadyBtn');
  rb.classList.toggle('ready', !!(mine && mine.ready));
  rb.textContent = (mine && mine.ready) ? '✓ Ready' : 'Ready up';
  const sb = document.getElementById('lobbyStartBtn');
  sb.style.display = mp.isHost ? '' : 'none';
  const allReady = [...lobby.players.values()].every((p) => p.ready) && lobby.players.size > 0;
  sb.disabled = !allReady;
  document.getElementById('lobbyHint').textContent = mp.isHost
    ? (allReady ? 'Everyone is ready — start the match!' : 'Waiting for all players to ready up…')
    : 'Waiting for the host to start…';
}
function lobbyStart() {
  if (!mp.isHost || !lobby.active) return;
  closeLobby();
  setGameMode(BATTLE);
  inventory.setLoadout(battleCfg.mode === 'war' ? WAR_LOADOUT : BATTLE_LOADOUT);
  health = 20; hud.setHealth(20);
  const theme = battleCfg.mode === 'war' || battleCfg.map === 'random' ? undefined : battleCfg.map;
  loadWorld(currentSeedStr, battleCfg.mode === 'war' ? 'beach' : 'arena', theme);
  setupMatch();
  liveSig = menuSig();
  mp.startBattle(matchInitPayload());     // push the match to lobby guests
  renderer.domElement.requestPointerLock(); sfx.ensure();
}
function matchInitPayload() {
  return { phase: 'match', seed: hashSeed(currentSeedStr),
    arena, battleMap, arenaTheme, battle: mode === BATTLE, team: teamMode, scoreLimit, gameMode,
    edits: [...edits.entries()].map(([k, v]) => { const [x, y, z] = k.split(',').map(Number); return [x, y, z, v]; }) };
}
if (lobbyEl) {
  document.getElementById('lobbyReadyBtn').addEventListener('click', lobbyToggleReady);
  document.getElementById('lobbyStartBtn').addEventListener('click', lobbyStart);
  document.getElementById('lobbyLeaveBtn').addEventListener('click', () => { closeLobby(); lobby.players.clear(); atMenu = true; refreshOverlays(); });
}

const mpHandlers = {
  // While the host is in the lobby, a joining guest gets the lobby state; otherwise
  // (a live match) they get the world init and drop straight in.
  getInit: () => (lobby.active && mp.isHost ? lobbyStatePayload() : matchInitPayload()),
  onLobby: (d) => onLobbyState(d),                           // guest: host's lobby roster/teams
  onLobbyReq: (id, name, team, ready) => onLobbyReq(id, name, team, ready),   // host: a guest's pick
  onInit: (d) => {
    if (d.phase === 'lobby') { onLobbyState(d); return; }    // joined while the host is still in the lobby
    closeLobby();                                            // host pressed Start — leave the lobby into the match
    currentSeedStr = String(d.seed);
    seedInput.value = currentSeedStr;
    arena = !!d.arena;
    battleMap = d.battleMap === 'beach' ? 'beach' : 'arena';
    arenaTheme = d.arenaTheme || 'ruins';
    botMgr.clear();
    world.regenerate(d.seed, arena ? battleMap : false, arenaTheme);
    if (arena && battleMap === 'arena') sky.setArenaTheme(arenaTheme);
    edits.clear(); editsByChunk.clear(); chestStore.clear(); mobs.clearAll();
    for (const e of d.edits) recordEdit(e[0], e[1], e[2], e[3]);
    if (d.battle) {
      gameMode = d.gameMode || 'dm';
      setGameMode(BATTLE); inventory.setLoadout(gameMode === 'war' ? WAR_LOADOUT : BATTLE_LOADOUT); health = 20; hud.setHealth(20);
      teamMode = !!d.team; scoreLimit = d.scoreLimit || 20; computeCoverPoints();
      sky.setArena(gameMode !== 'war'); sky.setWar(gameMode === 'war');
    }
    startWorld();
    setMpStatus(`Joined ${d.hostName || 'host'}'s ${d.battle ? 'battle arena' : 'world'}!`);
  },
  onEdit: (x, y, z, id) => recordEdit(x, y, z, id),
  onStatus: setMpStatus,
  onChat: (name, text) => hud.addChat(name, text, false),
  onSystem: (msg) => { hud.addChat(null, msg, true); hud.setPlayers(mp.playerList()); },
  onRoster: () => {
    // Drop score/team state for remote players who have disconnected (else their kills keep
    // counting toward the team win). Keep our own entry (selfId is never in the roster).
    for (const id of [...humanScore.keys()]) if (!mp.roster.has(id)) humanScore.delete(id);
    for (const id of [...teamAssign.keys()]) if (id !== selfId() && !mp.roster.has(id)) teamAssign.delete(id);
    // Keep the lobby roster in sync as people join/leave, then re-broadcast it.
    if (lobby.active && mp.isHost) {
      for (const [id, name] of mp.roster) if (!lobby.players.has(id)) lobby.players.set(id, { name, team: defaultLobbyTeam(), ready: false });
      for (const id of [...lobby.players.keys()]) if (id !== selfId() && !mp.roster.has(id)) lobby.players.delete(id);
      hostBroadcastLobby(); renderLobby();
    }
    hud.setPlayers(mp.playerList()); if (mode === BATTLE && isAuthority()) { rebuildBoard(); broadcastBoard(); }
  },
  // PvP: someone hit me — apply the damage locally and remember who, for the kill feed.
  onHit: (dmg, fromName) => { lastHitBy = fromName; lastHitTime = performance.now() / 1000; damagePlayer(dmg, undefined, undefined, true); },
  onKillFeed: (victim, killer) => { hud.addKill(victim, killer); if (killer === myName()) announceKill(false); },
  onBotHit: (botId, dmg, fromName, head) => botHurt(botId, dmg, fromName, head),
  onDeathAuthority: (by, id) => { const r = mp.remotes.get(id); if (r) noteKill(by, mp.roster.get(id), r.group.position.x, r.group.position.y + 1, r.group.position.z, id); registerKill(by, id); },
  onBotFire: (d) => { shotTracer(d.kind, new THREE.Vector3(d.x, d.y, d.z), new THREE.Vector3(d.dx, d.dy, d.dz), d.range, d.color); sfx.gunAt(d.kind === 'rail' ? 'rail' : d.kind === 'shotgun' ? 'shotgun' : 'handgun', d.x, d.y, d.z); },
  // Another player's shot — render it visually (no damage; their client resolves hits).
  onPlayerFire: (d) => spawnGhostShot(d, true),
  onBoard: (d) => {
    board = d.board; teamMode = d.team; scoreLimit = d.scoreLimit;
    const me = board.find((e) => e.id === selfId()); myTeam = me ? me.team : TEAM_NONE;
    hud.setScoreboard(board, teamMode, scoreLimit, myTeam, warTeamInfo()); mp.recolorBots(colorForBot);
  },
  onRoundOver: (winner) => { matchWinner = winner; if (!(gameMode === 'gungame' && startKillCam(winner))) { hud.showRoundOver(winner); hud.showScoreboard(); } },
  onRoundReset: () => { hud.hideRoundOver(); hud.hideScoreboard(); eliminated = false; player.flying = false; dead = false; const sp = teamSpawnPoint(myTeam); player.pos.set(sp.x, sp.y, sp.z); player.vel.set(0, 0, 0); health = 20; hud.setHealth(20); invuln = 1.5; protect = 1.5; },
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
  if (document.pointerLockElement === renderer.domElement) { everPlayed = true; atMenu = false; }
  else chargingChakra = false;   // releasing the lock can swallow the C keyup — don't latch channeling
  refreshOverlays();
});
// A blur/tab-away can swallow keyups; never let the chakra-channel key stay stuck on.
window.addEventListener('blur', () => { chargingChakra = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) chargingChakra = false; });
deathEl.querySelector('#respawn').addEventListener('click', () => respawn());

// Hold Tab for the battle scoreboard.
window.addEventListener('keydown', (e) => { if (e.code === 'Tab' && mode === BATTLE && !isTyping()) { e.preventDefault(); hud.showScoreboard(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Tab' && !matchWinner) hud.hideScoreboard(); });  // keep the round-over board up

// ---------- Modes / damage / death ----------
const myName = () => (mp.online ? mp.name : playerName());

// Apply a game mode (survival / creative / battle): player movement, inventory,
// and HUD all follow from it.
function setGameMode(m) {
  mode = m;
  player.setMode(m === CREATIVE ? 1 : 0);          // creative flies; survival/battle walk
  inventory.setMode(m === CREATIVE || m === BATTLE); // battle uses the infinite (creative) set
  if (m === BATTLE) { hud.setBattle(true); hud.showRadar(true); setupArenaPickups(); }  // atmosphere set in setupMatch
  else {
    sky.setArena(false); sky.setWar(false);
    leaveBattleCleanup();
    hud.setBattle(false); hud.setMode(m === SURVIVAL); hud.showRadar(false); pickups.clear(); hud.setGrenades(0);
    if (m === SURVIVAL) { hud.setHealth(health); hud.setHunger(hunger); }
  }
  // Chakra reserve is usable wherever jutsu are (battle + creative); start full.
  const chakraOn = (m === BATTLE || m === CREATIVE);
  hud.setChakraVisible(chakraOn);
  chakraEnergy = CHAKRA_MAX; chargingChakra = false; chakraAuraI = 0;
  if (chakraSnd) { sfx.chakraChannelStop(); chakraSnd = false; }
  resetBreak();
}
// Tear down any leftover battle state so it can't leak into survival/creative (or a
// resumed/quit match): spectate flags, god-mode i-frames, and battle-only HUD cards.
function leaveBattleCleanup() {
  eliminated = false; player.flying = false; invuln = 0; protect = 0;
  matchWinner = null; matchOverTimer = 0;
  abortDeathCam(); clearAfterImages();
  hud.hideRoundOver(); hud.hideScoreboard(); hud.setModeInfo(null);
  hud.setBattle(false); hud.showRadar(false); hud.setGrenades(0);   // battle chrome must not linger on the menu
  hud.setChakraVisible(false); hud.setChakraAura(0); hud.hideStatus();
  chargingChakra = false; if (chakraSnd) { sfx.chakraChannelStop(); chakraSnd = false; }
}
function toggleMode() {
  if (mode === BATTLE) return;                      // locked while in the arena
  setGameMode(mode === CREATIVE ? SURVIVAL : CREATIVE);
  hud.showName(mode === CREATIVE ? 'Creative Mode' : 'Survival Mode');
}

// `pvp` = incoming networked player/bot fire: every bullet should land, so it
// bypasses the 0.5s i-frames (which exist to throttle melee/mob/explosion contact)
// and doesn't grant them either — otherwise a shotgun's pellets all collapse to one.
function damagePlayer(dmg, srcX, srcZ, pvp) {
  if ((mode !== SURVIVAL && mode !== BATTLE) || dead || !player.locked) return;
  // True i-frames block everything (incl. PvP) so a persistent enemy AoE — a black hole
  // field or Hollow Purple beam relayed every frame — can't re-kill you during the
  // death-cam / respawn window and rack up phantom kills off a single death.
  if (protect > 0) return;
  if (health <= 0) return;        // already down and awaiting respawn — don't re-credit a death
  if (!pvp && invuln > 0) return;
  // Channelling chakra raises a protective shield: it soaks most of the hit, draining
  // chakra to do so (no chakra → no shield).
  if (chargingChakra && chakraEnergy > 0 && dmg > 0) {
    dmg = Math.max(0, Math.ceil(dmg * 0.35));
    chakraEnergy = Math.max(0, chakraEnergy - 12);
    particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, [120, 200, 255], 10);
  }
  if (precogT > 0 && dmg > 0) dmg = Math.max(0, Math.ceil(dmg * 0.4));   // Precognition: see it coming, take less
  health -= dmg; if (!pvp) invuln = 0.5;
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

// Battle: credit the kill. Most modes respawn; Battle Royale eliminates you.
function battleDeath() {
  const now = performance.now() / 1000;
  const killer = (now - lastHitTime < 10) ? lastHitBy : null;
  hud.addKill(myName(), killer);
  if (mp.online) mp.sendDeath(killer);
  noteKill(killer, myName(), player.pos.x, player.pos.y + 1, player.pos.z, 'me');
  if (isAuthority()) registerKill(killer, selfId(), myName());
  particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, [255, 80, 80], 30);
  sfx.gun('sniper'); lastHitBy = null; streak = 0;
  if (gameMode === 'br') {
    eliminated = true;
    player.flying = true;                 // free-fly spectator
    player.pos.set(0.5, ARENA.FLOOR + 24, 0.5); player.vel.set(0, 0, 0);
    health = 20; hud.setHealth(20); invuln = 999; protect = 999;
    hud.announce('Eliminated — spectating', '#ff5b5b'); hud.flashHurt();
    return;
  }
  hud.flashHurt();
  // A death cam (tap to skip; auto-skips after the setting) before respawning — unless
  // it's off, or the match is already ending (the win kill-cam takes over).
  const camSec = settings.deathcam || 0;
  if (camSec > 0 && !matchWinner) startDeathCam(killer, camSec);
  else respawnPlayer();
}
// War + the other respawning modes reinforce endlessly; just put the player back.
function respawnPlayer() {
  const sp = teamSpawnPoint(myTeam);
  player.pos.set(sp.x, sp.y, sp.z); player.vel.set(0, 0, 0);
  if (sp.yaw !== undefined) player.yaw = sp.yaw;
  health = 20; hud.setHealth(20); invuln = 1.6; protect = 1.6;   // spawn protection vs PvP too
  grenadeCount = 2; hud.setGrenades(2);
  flashCharges = FLASH_MAX; flashRegen = 0; flashCD = 0;   // fresh flash steps on respawn
  if (gameMode === 'gungame') gunLevelShown = -1;   // re-apply current ladder gun
}

// ---------- Battle match: teams, bots, scoreboard, rounds ----------
const TEAM_NONE = -1, TEAM_RED = 0, TEAM_BLUE = 1;
let teamMode = false, myTeam = TEAM_NONE, scoreLimit = 20;
// Game-mode state (dm / gungame / koth / br / wave).
let gameMode = 'dm';
let gunLevelShown = -1;          // gun game: which ladder weapon we're holding
let hillTimer = 0;               // koth scoring tick
let zoneRadius = 999, stormTimer = 0, eliminated = false;   // battle royale
let waveNum = 0, waveBreak = 0;  // wave survival
// War (D-Day): Allied attack from the sea, Axis defend the bunker line.
const WAR_ALLIED = TEAM_RED, WAR_AXIS = TEAM_BLUE;
let warSide = 'allied';          // the local player's faction
let warTickets = 0;              // Allied reinforcements left (respawns)
let warTimer = 0;                // countdown — Axis win if it runs out
let warCapture = 0;             // Allied capture progress on the objective (0..100)
let warFinalAnnounced = false;   // announced "reinforcements exhausted" yet
const WAR_TIME = 180, WAR_TICKETS = 18;
// Gun Game ladder — escalates weakest→strongest, finishing on the point-blank
// Rasengan (the "knife round": you must close to chakra range for the win).
const GUNGAME_LADDER = [
  HANDGUN, SMG, ASSAULT_RIFLE, SHOTGUN, HEAVY_MG, PLASMA_GUN, SNIPER, RAILGUN, LASER_CANNON,
  ROCKET_LAUNCHER, BLACK_HOLE_BOMB, RASENSHURIKEN, SHARINGAN, HOLLOW_PURPLE, CLEAVE, RASENGAN,
];
const HILL_R = 6.5;              // king-of-the-hill radius around arena centre
const WAVE_TARGET = 10;          // wave survival: survive this many waves to win
let hillMesh = null, zoneMesh = null;
let myKills = 0, myDeaths = 0;
const humanScore = new Map();   // remote human id -> { k, d }
const teamAssign = new Map();   // combatant id -> team
let board = [];                 // scoreboard snapshot
let matchWinner = null, matchOverTimer = 0;
// Gun Game final-kill cam: a cinematic multi-angle replay of the match-winning kill.
const killCam = { active: false, mode: 'orbit', t: 0, dur: 4.6, focus: new THREE.Vector3(), base: 0, sweep: 1.3, r0: 8, r1: 4.6, h0: 3.2, h1: 1.9 };
const lastKill = { killer: '', victim: '', killerKey: null, victimKey: null, vpos: new THREE.Vector3(), at: -1 };
let coverPoints = [];
const isAuthority = () => (!mp.online || mp.isHost);
const selfId = () => (mp.online ? mp.myId : 'me');
function teamOf(id) { const e = board.find((x) => x.id === id); return e ? e.team : (id === selfId() ? myTeam : TEAM_NONE); }
function colorForBot(team) { return (teamMode && team === myTeam) ? 0x57d977 : 0xff5b5b; }
function friendly(id) { return teamMode && myTeam !== TEAM_NONE && teamOf(id) === myTeam; }

function teamSpawnPoint(team) {
  if (gameMode === 'war') {
    const pool = team === WAR_AXIS ? BEACH_SPAWN_AXIS : BEACH_SPAWN_ALLIED;
    const [x, z] = pool[(Math.random() * pool.length) | 0];
    // Allied stand on the landing-craft decks (above the water); Axis on the bluff line.
    const y = (team === WAR_AXIS ? beachGroundY(z) : Math.max(beachGroundY(z), BEACH.BOAT_DECK)) + 1.2;
    return { x: x + 0.5, y, z: z + 0.5, yaw: team === WAR_AXIS ? Math.PI : 0 };
  }
  let pool = BATTLE_SPAWNS;
  if (team === TEAM_RED) pool = BATTLE_SPAWNS.filter(([x]) => x < 0);
  else if (team === TEAM_BLUE) pool = BATTLE_SPAWNS.filter(([x]) => x > 0);
  if (!pool.length) pool = BATTLE_SPAWNS;
  const [x, z] = pool[(Math.random() * pool.length) | 0];
  return { x: x + 0.5, y: ARENA.FLOOR + 1.2, z: z + 0.5 };
}

// Nearest MG-nest / bunker hold point for a defender to anchor on.
function nearestNest(x, z) {
  let best = BEACH_NESTS[0], bd = Infinity;
  for (const [nx, nz] of BEACH_NESTS) { const d = (nx - x) ** 2 + (nz - z) ** 2; if (d < bd) { bd = d; best = [nx, nz]; } }
  return new THREE.Vector3(best[0] + 0.5, beachGroundY(best[1]) + 1, best[1] + 0.5);
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
  gameMode = battleCfg.mode;
  teamMode = battleCfg.team;
  if (gameMode === 'gungame' || gameMode === 'br') teamMode = false;
  if (gameMode === 'wave' || gameMode === 'war') teamMode = true;
  scoreLimit = gameMode === 'gungame' ? GUNGAME_LADDER.length : battleCfg.scoreLimit;
  myKills = 0; myDeaths = 0; humanScore.clear(); teamAssign.clear();
  matchWinner = null; matchOverTimer = 0; endKillCam(false); resetReel(); resetSharingan(); hud.hideRoundOver();
  combo = 0; comboTimer = 0; firstBlood = true;
  gunLevelShown = -1; hillTimer = 0; stormTimer = 0; eliminated = false; waveNum = 0; waveBreak = 0;
  streak = 0; grenadeCount = 2; hud.setGrenades(2); player.flying = false;
  health = 20; hud.setHealth(20); invuln = 1.5; protect = 1.5; dead = false;   // clean slate (also clears 999 invuln left by a BR elimination)
  hud.hideScoreboard();
  zoneRadius = gameMode === 'br' ? ARENA.HALF - 2 : 999;
  botMgr.clear();
  computeCoverPoints();
  setupHill(gameMode === 'koth');
  setupZone(gameMode === 'br');
  sky.setArena(gameMode !== 'war'); sky.setWar(gameMode === 'war');
  if (gameMode === 'war') pickups.clear();

  const humans = [selfId()];
  if (mp.online) for (const id of mp.roster.keys()) humans.push(id);

  const useLobby = mp.online && lobby.players.size > 0;   // a co-op match started from the team lobby
  let botTeams = [];
  if (gameMode === 'war') {
    setupWar(humans, useLobby);                             // spawns its own faction bots
  } else if (gameMode === 'wave') {
    myTeam = TEAM_RED; for (const id of humans) teamAssign.set(id, TEAM_RED);   // bots arrive in waves
  } else if (useLobby) {
    // Honour each player's lobby team pick (Red / Blue / Free-for-all).
    let anyTeam = false, redH = 0, blueH = 0;
    for (const id of humans) {
      const lp = lobby.players.get(id), t = lp ? lobbyTeamCode(lp.team) : TEAM_NONE;
      teamAssign.set(id, t);
      if (t === TEAM_RED) { redH++; anyTeam = true; } else if (t === TEAM_BLUE) { blueH++; anyTeam = true; }
    }
    myTeam = teamAssign.get(selfId()) ?? TEAM_NONE; teamMode = anyTeam;
    if (anyTeam) {
      for (let i = 0; i < Math.max(0, battleCfg.size - redH); i++) botTeams.push(TEAM_RED);
      for (let i = 0; i < Math.max(0, battleCfg.size - blueH); i++) botTeams.push(TEAM_BLUE);
    } else botTeams = new Array(Math.max(0, battleCfg.size - humans.length)).fill(TEAM_NONE);
  } else if (teamMode) {
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
  if (gameMode === 'gungame') applyGunGameLevel(true);
  if (gameMode === 'wave' && isAuthority()) startWave(1);
  rebuildBoard(); broadcastBoard();
}

// D-Day uniforms: olive-drab for the Allies, feldgrau for the Axis. The team-colour
// override on avatars becomes the faction tunic colour (friend/foe read by uniform).
// Distinct faction uniforms so foe vs friend reads at a glance: Axis cold
// field-grey with a near-black Stahlhelm; Allied warm khaki with an olive M1.
function warColor(team) { return team === WAR_AXIS ? 0x5b6066 : 0x7a7038; }
function factionSkin(team) {
  const axis = team === WAR_AXIS;
  return { skin: 0xdcb38e, hair: axis ? 0x2e2a26 : 0x4a3320, hairStyle: 'short', eye: 0x2a2a2a,
    shirt: axis ? 0x5b6066 : 0x7a7038, pants: axis ? 0x2f3338 : 0x4f4420,
    hat: 'helmet', hatColor: axis ? 0x23262a : 0x5c5a2c };
}
const _pick = (a) => a[(Math.random() * a.length) | 0];

// War setup: Allied storm in from the sea, Axis hold the bunker line. Humans fight
// on the chosen side together; bots fill both. Axis defenders man the MG nests.
function setupWar(humans, useLobby) {
  // Each player picks Allied or Axis in the lobby (default = the host's chosen side).
  const hostSide = battleCfg.side === 'axis' ? WAR_AXIS : WAR_ALLIED;
  let alliedH = 0, axisH = 0;
  for (const id of humans) {
    let t = hostSide;
    if (useLobby) { const lp = lobby.players.get(id); if (lp) t = lp.team === 'axis' ? WAR_AXIS : WAR_ALLIED; }
    teamAssign.set(id, t); (t === WAR_AXIS ? axisH++ : alliedH++);
  }
  myTeam = teamAssign.get(selfId()) ?? hostSide;
  warSide = myTeam === WAR_AXIS ? 'axis' : 'allied';     // my own side drives spawns / UI / objective text
  warTickets = WAR_TICKETS; warTimer = WAR_TIME; warCapture = 0; warFinalAnnounced = false;
  inventory.setLoadout(WAR_LOADOUT);
  if (warSide === 'allied') hud.announce('Storm the beach — take the bunker!', '#9ad36b');
  else hud.announce('Hold the line — repel the assault!', '#ff9a6b');
  if (!isAuthority()) return;

  // A whole division storms the beach: far more Allied than Axis (~3:1), minus the humans on each side.
  const axisN = Math.max(4, battleCfg.size - axisH);
  const alliedN = Math.min(26, Math.max(12, battleCfg.size * 3 - alliedH));
  const teams = [];
  for (let i = 0; i < alliedN; i++) teams.push(WAR_ALLIED);
  for (let i = 0; i < axisN; i++) teams.push(WAR_AXIS);
  botMgr.spawn(teams.length, teams, battleCfg.botDiff, teamSpawnPoint, warColor, factionSkin);
  for (const b of botMgr.bots) {
    if (b.team === WAR_AXIS) {                              // defenders: hold the nest, brace the MG
      b.defend = true; b.anchor = nearestNest(b.pos.x, b.pos.z); b.yaw = Math.PI;
      b.gunId = HEAVY_MG;
      // Dug-in mounted gunners: a touch quicker to react and steadier than a roamer,
      // but still beatable (own copy of D so the shared difficulty preset isn't mutated).
      b.D = Object.assign({}, b.D, { aimErr: b.D.aimErr * 0.8, react: b.D.react * 0.7, fireGap: b.D.fireGap * 0.7 });
    } else {                                                // attackers: push up the beach to the objective
      b.defend = false; b.anchor = null; b.yaw = 0;
      b.advance = true; b._goalJitter = (Math.random() - 0.5) * 12;
      b.advanceGoal = new THREE.Vector3(b.pos.x, 0, 16);   // stage 1: straight ashore off the boat (warTick restages it)
      b.gunId = _pick([ASSAULT_RIFLE, SMG, ASSAULT_RIFLE, SHOTGUN]);
    }
    b.gun = gunOf(b.gunId); b.ammo = b.gun.mag || Infinity; b.reloadTimer = 0;
  }
}

// ---- Mode helpers ----
function setupHill(on) {
  if (hillMesh) { scene.remove(hillMesh); hillMesh.geometry.dispose(); hillMesh.material.dispose(); hillMesh = null; }
  if (on) {
    hillMesh = new THREE.Mesh(new THREE.CylinderGeometry(HILL_R, HILL_R, 0.25, 36),
      new THREE.MeshBasicMaterial({ color: 0xffd86b, transparent: true, opacity: 0.18, depthWrite: false }));
    hillMesh.position.set(0, ARENA.FLOOR + 1.15, 0);
    scene.add(hillMesh);
  }
}
function setupZone(on) {
  if (zoneMesh) { scene.remove(zoneMesh); zoneMesh.geometry.dispose(); zoneMesh.material.dispose(); zoneMesh = null; }
  if (on) {
    zoneMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 14, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    zoneMesh.position.set(0, ARENA.FLOOR + 7, 0);
    scene.add(zoneMesh);
  }
}
function applyGunGameLevel(force, killsOverride) {
  const kills = killsOverride != null ? killsOverride : myKills;
  const lvl = Math.min(kills, GUNGAME_LADDER.length - 1);
  const want = GUNGAME_LADDER[lvl];
  // Re-snap if the level changed OR the held gun drifted from the ladder weapon, so the
  // gun stays locked to your kill count (you can't keep a gun you didn't earn).
  if (force || lvl !== gunLevelShown || inventory.selectedId() !== want) { gunLevelShown = lvl; inventory.setLoadout([want]); }
}
function myBoardKills() { const e = board.find((x) => x.id === selfId()); return e ? e.kills : 0; }
// KOTH/objective: give one point to a combatant (frags double as the score).
function awardScore(id) {
  if (!id) return;
  if (id === selfId()) myKills++;
  else { const b = botMgr.get(id); if (b) b.kills++; else { const s = humanScore.get(id) || { k: 0, d: 0 }; s.k++; humanScore.set(id, s); } }
  checkWin(); rebuildBoard(); broadcastBoard();
}
function kothAward() {
  const inHill = (x, z) => (x * x + z * z) < HILL_R * HILL_R;
  if (teamMode) {
    let red = 0, blue = 0, repRed = null, repBlue = null;
    if (!eliminated && health > 0 && inHill(player.pos.x, player.pos.z)) { myTeam === TEAM_RED ? (red++, repRed = selfId()) : (blue++, repBlue = selfId()); }
    for (const b of botMgr.bots) if (b.alive && inHill(b.pos.x, b.pos.z)) { if (b.team === TEAM_RED) { red++; repRed = repRed || b.id; } else { blue++; repBlue = repBlue || b.id; } }
    if (mp.online) for (const [id, r] of mp.remotes) if (r.group.visible && inHill(r.group.position.x, r.group.position.z)) { if (teamOf(id) === TEAM_RED) { red++; repRed = repRed || id; } else { blue++; repBlue = repBlue || id; } }
    if (red > 0 && blue === 0) awardScore(repRed);
    else if (blue > 0 && red === 0) awardScore(repBlue);
  } else {
    let occ = null, count = 0;
    if (!eliminated && health > 0 && inHill(player.pos.x, player.pos.z)) { count++; occ = selfId(); }
    for (const b of botMgr.bots) if (b.alive && inHill(b.pos.x, b.pos.z)) { count++; occ = b.id; }
    if (mp.online) for (const [id, r] of mp.remotes) if (r.group.visible && inHill(r.group.position.x, r.group.position.z)) { count++; occ = id; }
    if (count === 1) awardScore(occ);
  }
}
function brTick(dt) {
  zoneRadius = Math.max(5, zoneRadius - 0.5 * dt);
  if (zoneMesh) zoneMesh.scale.set(zoneRadius, 1, zoneRadius);
  stormTimer -= dt;
  if (stormTimer <= 0) {
    stormTimer = 1.0;
    const out = (x, z) => (x * x + z * z) > zoneRadius * zoneRadius;
    if (!eliminated && health > 0 && out(player.pos.x, player.pos.z)) damagePlayer(6);
    for (const b of botMgr.bots) if (b.alive && out(b.pos.x, b.pos.z)) b.hurt(8);
    if (mp.online) for (const [id, r] of mp.remotes) if (r.group.visible && out(r.group.position.x, r.group.position.z)) mp.sendHit(id, 6);
  }
  const aliveBots = botMgr.bots.filter((b) => b.alive).length;
  const meAlive = (!eliminated && health > 0) ? 1 : 0;
  const aliveRemotes = mp.online ? [...mp.remotes].filter(([, r]) => !r.bot && r.group.visible) : [];
  if (aliveBots + meAlive + aliveRemotes.length <= 1 && !matchWinner) {
    const winner = meAlive ? myName()
      : (botMgr.bots.find((b) => b.alive)?.name
         || (aliveRemotes[0] && mp.roster.get(aliveRemotes[0][0]))
         || 'Nobody');
    endMatch(winner);
  }
}
function startWave(n) {
  waveNum = n; waveBreak = 0;
  botMgr.clear();
  const count = 3 + n * 2;
  botMgr.spawn(count, new Array(count).fill(TEAM_BLUE), battleCfg.botDiff, teamSpawnPoint, colorForBot);
  hud.announce(`Wave ${n}`, '#ff8f3a'); sfx.announce('multi');
  rebuildBoard(); broadcastBoard();
}
function waveTick(dt) {
  const aliveBots = botMgr.bots.filter((b) => b.alive).length;
  if (aliveBots > 0) return;
  if (waveBreak <= 0) { waveBreak = 4; hud.announce(`Wave ${waveNum} cleared`, '#57d977'); sfx.announce('win'); }
  else { waveBreak -= dt; if (waveBreak <= 0) { if (waveNum >= WAVE_TARGET) endMatch('Survivors'); else startWave(waveNum + 1); } }
}
// Per-frame mode logic (authority).
function modeTick(dt) {
  if (gameMode === 'gungame') {
    for (const b of botMgr.bots) {
      const want = GUNGAME_LADDER[Math.min(b.kills, GUNGAME_LADDER.length - 1)];
      if (b.gunId !== want) { b.gunId = want; b.gun = gunOf(want); b.ammo = b.gun.mag || Infinity; b.reloadTimer = 0; }
    }
  } else if (gameMode === 'koth') { hillTimer -= dt; if (hillTimer <= 0) { hillTimer = 1.0; kothAward(); } }
  else if (gameMode === 'br') brTick(dt);
  else if (gameMode === 'wave') waveTick(dt);
  else if (gameMode === 'war') warTick(dt);
}

// D-Day: Allied win by capturing the bunker objective; Axis win by running out the
// clock (holding the line) or repelling the assault (Allied reinforcements spent).
function warTick(dt) {
  warTimer -= dt;
  // Keep the attackers storming: while still at sea, drive each one STRAIGHT ashore
  // (no sideways pull that snags them on the boat walls); once on the beach, converge
  // on the bunker objective so they actually push past the Axis instead of milling.
  for (const b of botMgr.bots) {
    if (!b.alive || !b.advance) continue;
    if (b.pos.z > 20) b.advanceGoal.set(b.pos.x, 0, 14);
    else b.advanceGoal.set(BEACH.OBJ_X + (b._goalJitter || 0), 0, BEACH.OBJ_Z + 2);
  }
  const ox = BEACH.OBJ_X, oz = BEACH.OBJ_Z, r2 = BEACH.OBJ_R * BEACH.OBJ_R;
  const inObj = (x, z) => (x - ox) ** 2 + (z - oz) ** 2 < r2;
  let allied = 0, axis = 0;
  if (!eliminated && health > 0 && inObj(player.pos.x, player.pos.z)) (myTeam === WAR_ALLIED ? allied++ : axis++);
  for (const b of botMgr.bots) if (b.alive && inObj(b.pos.x, b.pos.z)) (b.team === WAR_ALLIED ? allied++ : axis++);
  if (mp.online) for (const [id, rr] of mp.remotes) if (rr.group.visible && inObj(rr.group.position.x, rr.group.position.z)) (teamOf(id) === WAR_ALLIED ? allied++ : axis++);
  if (allied > 0 && axis === 0) warCapture = Math.min(100, warCapture + dt * (100 / 14));      // ~14s uncontested to take it
  else if (axis > 0 && allied === 0) warCapture = Math.max(0, warCapture - dt * (100 / 22));   // Axis retake it slower
  if (matchWinner) return;
  // One-minute warning so the defenders know to dig in.
  if (warTimer <= 60 && !warFinalAnnounced) {
    warFinalAnnounced = true;
    hud.announce(myTeam === WAR_AXIS ? 'One minute — hold the line!' : 'One minute left — take the bunker!', '#ffd86b');
  }
  // The assault ends only when the beachhead is taken (Allied) or the clock runs out (Axis).
  if (warCapture >= 100) { endMatch('Allied — beachhead secured'); return; }
  if (warTimer <= 0) { endMatch('Axis — the line held'); return; }
}

function rebuildBoard() {
  board = [{ id: selfId(), name: myName(), team: myTeam, kills: myKills, deaths: myDeaths, bot: false, you: true }];
  if (mp.online) for (const [id, name] of mp.roster) {
    const s = humanScore.get(id) || { k: 0, d: 0 };
    board.push({ id, name, team: teamAssign.get(id) ?? TEAM_NONE, kills: s.k, deaths: s.d, bot: false });
  }
  for (const bt of botMgr.bots) board.push({ id: bt.id, name: bt.name, team: bt.team, kills: bt.kills, deaths: bt.deaths, bot: true });
  hud.setScoreboard(board, teamMode, scoreLimit, myTeam, warTeamInfo());
}
function warTeamInfo() {
  if (gameMode !== 'war') return undefined;
  return { red: '🪖 Allied', blue: '🛡 Axis', redColor: '#9ad36b', blueColor: '#cfcfb0',
    title: `D-Day · Beachhead ${Math.floor(warCapture)}% · ${Math.max(0, Math.ceil(warTimer))}s left` };
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
// Resolve a combatant name to its kill-reel key ('me' / bot id / remote id).
function reelKeyForName(name) {
  if (!name) return null;
  if (name === myName()) return 'me';
  for (const b of botMgr.bots) if (b.name === name) return b.id;
  if (mp.online) for (const [id, n] of mp.roster) if (n === name) return id;
  return null;
}
// Record the most recent kill (who, whom, where + reel keys) so that if it turns
// out to be the match-winning blow in Gun Game we can replay it from the reel.
function noteKill(killerName, victimName, vx, vy, vz, victimKey) {
  lastKill.killer = killerName || ''; lastKill.victim = victimName || '';
  lastKill.killerKey = reelKeyForName(killerName);
  lastKill.victimKey = victimKey != null ? victimKey : reelKeyForName(victimName);
  lastKill.vpos.set(vx, vy, vz); lastKill.at = performance.now() / 1000;
}
function registerKill(killerName, victimId) {
  if (!isAuthority() || matchWinner) { return; }
  addKillByName(killerName); addDeathById(victimId);
  checkWin(); rebuildBoard(); broadcastBoard();
}
function checkWin() {
  if (matchWinner || gameMode === 'br' || gameMode === 'wave' || gameMode === 'war') return;   // those have their own win logic
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
  matchWinner = winner;
  if (mp.isHost) mp.broadcast({ t: 'roundover', winner });
  // Gun Game gets a cinematic final-kill cam (a multi-angle replay) before standings.
  const cam = gameMode === 'gungame' && startKillCam(winner);
  matchOverTimer = cam ? killCamDur + 2.6 : 7;
  if (!cam) { hud.showRoundOver(winner); hud.showScoreboard(); }
  hud.announce(`${winner} wins!`, '#ffd86b'); sfx.announce('win');
}

// ---- Kill reel: a rolling ~2.4s buffer of every combatant's transform, so the
// final-kill cam can actually replay the kill (not just orbit a frozen pose). ----
const REEL_HZ = 20, REEL_SECS = 2.0;
const killReel = [];                 // [{ t, a: { key: [x,y,z,yaw,wep] } }] newest last
const fireReel = [];                 // [{ t, k, x,y,z, dx,dy,dz, ... }] shots fired during the window
let reelClock = 0, reelAcc = 0;
function recordReel(dt) {
  if (matchWinner) return;           // freeze the reel at the kill so it holds the lead-up
  reelAcc += dt; if (reelAcc < 1 / REEL_HZ) return;
  reelClock += reelAcc; reelAcc = 0;
  const a = {};
  const myWep = gunOf(inventory.selectedId()) ? inventory.selectedId() : 0;
  if (!dead && !eliminated) a['me'] = [player.pos.x, player.pos.y, player.pos.z, player.yaw, myWep];
  for (const b of botMgr.bots) if (b.alive && b.mesh) a[b.id] = [b.pos.x, b.pos.y, b.pos.z, b.yaw, b.gunId || 0];
  if (mp.online) for (const [id, r] of mp.remotes) if (r.group && r.group.visible) a[id] = [r.group.position.x, r.group.position.y, r.group.position.z, r.target ? r.target.yaw : r.group.rotation.y, r.wep || 0];
  killReel.push({ t: reelClock, a });
  const cut = reelClock - REEL_SECS;
  while (killReel.length > 2 && killReel[0].t < cut) killReel.shift();
  while (fireReel.length && fireReel[0].t < cut - 0.5) fireReel.shift();
}
// Record a shot into the fire reel so the kill cam can replay the actual bullet/attack.
function recordFire(kind, muzzle, dir, extra) {
  if (matchWinner || mode !== BATTLE) return;
  fireReel.push(Object.assign({ t: reelClock, k: kind, x: muzzle.x, y: muzzle.y, z: muzzle.z, dx: dir.x, dy: dir.y, dz: dir.z }, extra || {}));
  if (fireReel.length > 200) fireReel.shift();
}
function resetReel() { killReel.length = 0; fireReel.length = 0; reelClock = 0; reelAcc = 0; }
function reelHas(key) { let c = 0; for (const fr of killReel) if (fr.a[key]) { if (++c >= 2) return true; } return false; }
function shortAng(d) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
// Interpolate an actor's transform at reel-time qt into `out`; returns the yaw (or null).
function sampleReel(key, qt, out) {
  let prev = null, next = null;
  for (const fr of killReel) { if (!fr.a[key]) continue; if (fr.t <= qt) prev = fr; else { next = fr; break; } }
  if (!prev && !next) return null;
  if (!prev) prev = next; if (!next) next = prev;
  const A = prev.a[key], B = next.a[key], span = next.t - prev.t;
  const f = span > 0 ? Math.max(0, Math.min(1, (qt - prev.t) / span)) : 0;
  out.set(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
  return A[3] + shortAng(B[3] - A[3]) * f;
}

// ---- Final-kill cam ---- a true replay: stand-in avatars retrace the kill from
// the reel while the camera cuts between three angles, then a simple orbit fallback.
const REPLAY_PASSES = [{ cam: 'orbit', speed: 1.05 }, { cam: 'shoulder', speed: 0.82 }, { cam: 'low', speed: 0.55 }];
const REPLAY_HOLD = 2.0;             // slow-mo death hold after the final angle (so the kill isn't cut short)
const replay = { active: false, rStart: 0, rEnd: 0, pass: 0, clock: 0, killerKey: null, victimKey: null, avK: null, avV: null, orbitBase: 0, orbitDir: 1, holding: false, holdT: 0, holdEye: new THREE.Vector3() };
let killCamDur = 4.6;                 // how long the whole cam (replay or orbit) runs
const _kcWin = new THREE.Vector3(), _kcEye = new THREE.Vector3();
const _rK = new THREE.Vector3(), _rV = new THREE.Vector3(), _rMid = new THREE.Vector3(), _rTmp = new THREE.Vector3();

function findCombatantPos(name, out) {
  if (!name) return false;
  if (name === myName()) { out.copy(player.pos); return true; }
  for (const b of botMgr.bots) if (b.name === name) { out.copy(b.pos); return true; }
  if (mp.online) for (const [id, n] of mp.roster) if (n === name) { const r = mp.remotes.get(id); if (r) { out.copy(r.group.position); return true; } }
  return false;
}
function startKillCam(winner) {
  const fresh = (performance.now() / 1000 - lastKill.at < 1.5) && lastKill.killer === winner;
  if (fresh && lastKill.killerKey && lastKill.victimKey && reelHas(lastKill.killerKey) && reelHas(lastKill.victimKey)) {
    return startReplay(winner) || startOrbitCam(winner);
  }
  return startOrbitCam(winner);
}
function reelWep(key) {   // the most recent weapon this actor held in the reel
  for (let i = killReel.length - 1; i >= 0; i--) { const v = killReel[i].a[key]; if (v && v[4]) return v[4]; }
  return 0;
}
function buildReplayAvatar(key) {
  const bot = botMgr.get(key);
  let name = '?', skin;
  if (key === 'me') { name = myName(); skin = getSkin(mp.skin); }
  else if (bot) { name = bot.name; skin = getSkin(bot.skinId); }
  else { const r = mp.remotes.get(key); name = mp.roster.get(key) || '?'; skin = getSkin(r && r.skinId != null ? r.skinId : undefined); }
  const av = makeAvatar(name, skin);
  av.userData.yawOff = bot ? 0 : Math.PI;   // bots store avatar-yaw; players store look-yaw
  const wep = reelWep(key);                 // show the gun/jutsu they were holding
  if (wep) { try { av.add(makeHeldWeapon(wep)); } catch { /* ignore */ } }
  av.visible = false; scene.add(av);
  return av;
}
function disposeReplayAvatar(av) {
  if (!av) return;
  scene.remove(av);
  av.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } else if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
}
function hideLiveCombatants() {
  for (const b of botMgr.bots) if (b.mesh) b.mesh.visible = false;
  if (mp.online) for (const [, r] of mp.remotes) if (r.group) r.group.visible = false;
}
function restoreLiveCombatants() {
  for (const b of botMgr.bots) if (b.mesh) b.mesh.visible = b.alive;
  if (mp.online) for (const [, r] of mp.remotes) if (r.group) r.group.visible = true;
}
function startReplay(winner) {
  replay.rStart = killReel[0].t; replay.rEnd = killReel[killReel.length - 1].t;
  if (replay.rEnd - replay.rStart < 0.4) return false;             // not enough footage
  replay.killerKey = lastKill.killerKey; replay.victimKey = lastKill.victimKey;
  replay.avK = buildReplayAvatar(replay.killerKey);
  replay.avV = buildReplayAvatar(replay.victimKey);
  replay.pass = 0; replay.clock = 0; replay.holding = false; replay.holdT = 0;
  replay.fires = fireReel.filter((e) => e.t >= replay.rStart - 0.3 && e.t <= replay.rEnd + 0.4);  // shots to replay
  replay.fireIdx = 0;
  replay.orbitBase = Math.random() * Math.PI * 2; replay.orbitDir = Math.random() < 0.5 ? 1 : -1;
  const span = replay.rEnd - replay.rStart;
  killCamDur = REPLAY_PASSES.reduce((s, p) => s + span / p.speed, 0) + REPLAY_HOLD;   // total replay runtime (+ death hold)
  replay.active = true; killCam.active = true; killCam.mode = 'replay';
  hideLiveCombatants();
  hud.showKillCam(winner, lastKill.victim, 1, REPLAY_PASSES.length);
  return true;
}
function startOrbitCam(winner) {
  if (!findCombatantPos(winner, _kcWin)) return false;
  const fresh = (performance.now() / 1000 - lastKill.at < 1.5) && lastKill.killer === winner;
  const v = fresh ? lastKill.vpos : null;
  killCam.focus.copy(_kcWin); killCam.focus.y += 1.0;
  if (v) killCam.focus.set((_kcWin.x + v.x) / 2, (_kcWin.y + 1.0 + v.y) / 2, (_kcWin.z + v.z) / 2);
  let bx = v ? _kcWin.x - v.x : 1, bz = v ? _kcWin.z - v.z : 0;
  if (bx === 0 && bz === 0) bz = 1;
  killCam.base = Math.atan2(bz, bx);
  killCam.sweep = (Math.random() < 0.5 ? 1 : -1) * (1.0 + Math.random() * 0.5);
  killCam.t = 0; killCam.active = true; killCam.mode = 'orbit'; killCamDur = killCam.dur;
  hud.showKillCam(winner, fresh ? lastKill.victim : '', 0, 0);
  return true;
}
function updateKillCam(dt) {
  if (!killCam.active) return;
  if (killCam.mode === 'replay') updateReplay(dt); else updateOrbit(dt);
  if (viewModel) viewModel.visible = false;   // never show first-person hands during the cam
}
function updateReplay(dt) {
  hideLiveCombatants();                        // keep live avatars hidden even if one respawns
  if (replay.holding) { updateReplayHold(dt); return; }
  const pass = REPLAY_PASSES[replay.pass];
  replay.clock += Math.max(0, dt) * pass.speed;
  const qt = replay.rStart + replay.clock;
  const kyaw = sampleReel(replay.killerKey, qt, _rK);
  const vyaw = sampleReel(replay.victimKey, qt, _rV);
  if (kyaw != null) { replay.avK.visible = true; replay.avK.position.copy(_rK); replay.avK.rotation.y = kyaw + replay.avK.userData.yawOff; }
  if (vyaw != null) { replay.avV.visible = true; replay.avV.position.copy(_rV); replay.avV.rotation.y = vyaw + replay.avV.userData.yawOff; }
  // Replay the actual shots/attacks as they happened, in time with the action.
  while (replay.fires && replay.fireIdx < replay.fires.length && replay.fires[replay.fireIdx].t <= qt) {
    spawnGhostShot(replay.fires[replay.fireIdx], true); replay.fireIdx++;
  }
  _rMid.copy(_rK).add(_rV).multiplyScalar(0.5); _rMid.y += 1.1;
  const e = Math.min(1, replay.clock / Math.max(0.2, replay.rEnd - replay.rStart));
  let lookY = 0.2;
  if (pass.cam === 'orbit') {
    const ang = replay.orbitBase + replay.orbitDir * e * 1.7, rad = 8 - 2 * e, h = 3.4 - 1.0 * e;
    _kcEye.set(_rMid.x + Math.cos(ang) * rad, _rMid.y + h, _rMid.z + Math.sin(ang) * rad);
  } else if (pass.cam === 'shoulder') {
    _rTmp.copy(_rK).sub(_rV); _rTmp.y = 0; if (_rTmp.lengthSq() < 0.01) _rTmp.set(0, 0, 1); _rTmp.normalize();
    _kcEye.copy(_rK).addScaledVector(_rTmp, 2.7); _kcEye.y = _rK.y + 2.5;   // behind & above the killer
  } else {
    _rTmp.copy(_rV).sub(_rK); _rTmp.y = 0; if (_rTmp.lengthSq() < 0.01) _rTmp.set(1, 0, 0); _rTmp.normalize();
    _kcEye.set(_rMid.x - _rTmp.z * 4.6, _rMid.y - 0.5, _rMid.z + _rTmp.x * 4.6);   // low, side-on
    lookY = 1.0;
  }
  if (_kcEye.y < ARENA.FLOOR + 0.8) _kcEye.y = ARENA.FLOOR + 0.8;
  const look = pass.cam === 'shoulder' ? _rV : _rMid;
  camera.position.copy(_kcEye); camera.up.set(0, 1, 0);
  camera.lookAt(look.x, look.y + lookY, look.z);
  if (qt >= replay.rEnd) {
    if (replay.pass >= REPLAY_PASSES.length - 1) {   // final angle: hold on the kill in slow-mo
      replay.holding = true; replay.holdT = 0;
      let hx = _rV.x - _rK.x, hz = _rV.z - _rK.z;     // flung the way the killing blow drove them
      if (hx === 0 && hz === 0) hz = 1;
      startDeathAnim(replay.avV, hx, hz, { dur: REPLAY_HOLD * 0.9 });   // pierced & toppled; disposed with the cam
      particles.burst(_rV.x, _rV.y + 1, _rV.z, [220, 70, 70], 24);
      replay.holdEye.set(_kcEye.x, _kcEye.y, _kcEye.z);                 // ease in from the last camera spot
      return;
    }
    replay.pass++; replay.clock = 0; replay.fireIdx = 0;   // restart the shot timeline for the next angle
    hud.showKillCam(lastKill.killer, lastKill.victim, replay.pass + 1, REPLAY_PASSES.length);
  }
}
// Slow-mo hold on the felled victim once the angles are done, so the death plays out fully.
function updateReplayHold(dt) {
  replay.holdT += Math.max(0, dt);
  const v = replay.avV ? replay.avV.position : _rV;
  const e = Math.min(1, replay.holdT / REPLAY_HOLD);
  const ang = replay.orbitBase + replay.orbitDir * (1.7 + e * 0.55), rad = 4.8 - 1.5 * e, h = 1.7 - 0.5 * e;
  _kcEye.set(v.x + Math.cos(ang) * rad, v.y + h, v.z + Math.sin(ang) * rad);
  _kcEye.lerp(replay.holdEye, Math.max(0, 1 - e * 4));                  // brief ease-in from the last shot
  if (_kcEye.y < ARENA.FLOOR + 0.6) _kcEye.y = ARENA.FLOOR + 0.6;
  camera.position.copy(_kcEye); camera.up.set(0, 1, 0);
  camera.lookAt(v.x, v.y + 0.4, v.z);
  if (replay.holdT >= REPLAY_HOLD) endKillCam(true);
}
function updateOrbit(dt) {
  killCam.t += Math.max(0, dt);
  const p = Math.min(1, killCam.t / killCam.dur);
  const e = 1 - Math.pow(1 - p, 3);
  const ang = killCam.base + killCam.sweep * e;
  const rad = killCam.r0 + (killCam.r1 - killCam.r0) * e, h = killCam.h0 + (killCam.h1 - killCam.h0) * e;
  const f = killCam.focus;
  _kcEye.set(f.x + Math.cos(ang) * rad, f.y + h, f.z + Math.sin(ang) * rad);
  if (_kcEye.y < ARENA.FLOOR + 1.2) _kcEye.y = ARENA.FLOOR + 1.2;
  camera.position.copy(_kcEye); camera.up.set(0, 1, 0);
  camera.lookAt(f.x, f.y + 0.1, f.z);
  if (killCam.t >= killCam.dur) endKillCam(true);
}
function endKillCam(showRound) {
  if (!killCam.active) return;
  killCam.active = false; killCam.mode = 'orbit';
  if (replay.active) {
    replay.active = false; replay.holding = false;
    if (replay.avV) clearDeathAnim(replay.avV);   // drop the death-hold reference before disposing
    disposeReplayAvatar(replay.avK); disposeReplayAvatar(replay.avV);
    replay.avK = replay.avV = null;
    restoreLiveCombatants();
  }
  hud.hideKillCam();
  if (showRound && matchWinner) { hud.showRoundOver(matchWinner); hud.showScoreboard(); }
}

// ---- Death cam: when YOU die in battle, spawn a corpse, topple it, orbit it with a
// "tap to skip" prompt, and respawn on skip or after the auto-skip setting elapses. ----
const deathCam = { active: false, t: 0, dur: 3, focus: new THREE.Vector3(), base: 0, sweep: 1, killer: '', corpse: null };
function startDeathCam(killer, sec) {
  const corpse = makeAvatar(myName(), getSkin(mp.skin));
  corpse.position.copy(player.pos); corpse.rotation.y = player.yaw + Math.PI;
  scene.add(corpse);
  startDeathAnim(corpse, Math.sin(player.yaw), Math.cos(player.yaw), { temp: true, dur: Math.min(sec * 0.7, 1.4) });   // crumple backward
  deathCam.corpse = corpse;
  deathCam.focus.copy(player.pos); deathCam.focus.y += 1.0;
  deathCam.base = Math.random() * Math.PI * 2; deathCam.sweep = (Math.random() < 0.5 ? 1 : -1) * 1.1;
  deathCam.t = 0; deathCam.dur = sec; deathCam.active = true; deathCam.killer = killer || '';
  invuln = 999; protect = 999;          // can't be killed again mid-cam (PvP included)
  hud.showDeathCam(killer);
}
function skipDeathCam() { if (deathCam.active) endDeathCam(); }
function endDeathCam() {
  deathCam.active = false; deathCam.corpse = null;   // the corpse finishes its own topple via dyingAvatars
  hud.hideDeathCam();
  respawnPlayer();
}
// Tear the death cam down without respawning (match reset / leaving to menu).
function abortDeathCam() {
  if (deathCam.corpse) { clearDeathAnim(deathCam.corpse); scene.remove(deathCam.corpse); disposeAvatar(deathCam.corpse); }
  deathCam.active = false; deathCam.corpse = null;
  hud.hideDeathCam();
}
function updateDeathCam(dt) {
  if (!deathCam.active) return;
  deathCam.t += dt;
  hud.setDeathCamTime(Math.max(0, deathCam.dur - deathCam.t));
  const e = Math.min(1, deathCam.t / deathCam.dur);
  const ang = deathCam.base + deathCam.sweep * e, rad = 5.5 - 1.3 * e, h = 2.9 - 0.7 * e, f = deathCam.focus;
  _kcEye.set(f.x + Math.cos(ang) * rad, f.y + h, f.z + Math.sin(ang) * rad);
  if (_kcEye.y < ARENA.FLOOR + 0.8) _kcEye.y = ARENA.FLOOR + 0.8;
  camera.position.copy(_kcEye); camera.up.set(0, 1, 0);
  camera.lookAt(f.x, f.y - 0.25, f.z);
  if (viewModel) viewModel.visible = false;
  if (deathCam.t >= deathCam.dur) endDeathCam();
}
function resetMatch() {
  myKills = 0; myDeaths = 0; humanScore.clear();
  combo = 0; comboTimer = 0; firstBlood = true;
  gunLevelShown = -1; eliminated = false; stormTimer = 0; player.flying = false;
  zoneRadius = gameMode === 'br' ? ARENA.HALF - 2 : 999;
  matchWinner = null; endKillCam(false); abortDeathCam(); resetReel(); resetSharingan(); hud.hideRoundOver(); hud.hideScoreboard();
  if (gameMode === 'war') {   // fresh assault: reset the clock, reinforcements and objective
    warTickets = WAR_TICKETS; warTimer = WAR_TIME; warCapture = 0; warFinalAnnounced = false;
  }
  if (gameMode === 'wave') { if (isAuthority()) startWave(1); }
  else { for (const b of botMgr.bots) { b.kills = 0; b.deaths = 0; respawnBot(b); } }
  const sp = teamSpawnPoint(myTeam); player.pos.set(sp.x, sp.y, sp.z); player.vel.set(0, 0, 0);
  health = 20; hud.setHealth(20); invuln = 1.5; protect = 1.5; lastHitBy = null;
  streak = 0; grenadeCount = 2; hud.setGrenades(2);
  flashCharges = FLASH_MAX; flashRegen = 0; flashCD = 0;
  if (gameMode === 'gungame') applyGunGameLevel(true);
  if (mp.isHost) mp.broadcast({ t: 'roundreset' });
  rebuildBoard(); broadcastBoard();
}

// Damage a bot locally (authority); death is finalised in manageBots().
function botHurt(botId, dmg, fromName, head) {
  const b = botMgr.get(botId); if (!b || !b.alive) return;
  b.lastHitByName = fromName; b.lastHitTime = performance.now() / 1000; b.lastHeadshot = !!head;
  b.hurt(dmg);
}
// ---- Death animations: avatars topple, get flung along the killing blow, sink and
// fade instead of vanishing instantly. Drives bot meshes and temporary player corpses.
const dyingAvatars = [];   // { mesh, t, dur, dirX, dirZ, kb, tip, temp }
function startDeathAnim(mesh, dirX, dirZ, opts) {
  if (!mesh) return;
  const dl = Math.hypot(dirX || 0, dirZ || 0);
  const dx = dl > 0.1 ? dirX / dl : Math.random() - 0.5, dz = dl > 0.1 ? dirZ / dl : Math.random() - 0.5;
  mesh.traverse((o) => { if (o.material) o.material.transparent = true; });   // allow fade
  dyingAvatars.push({
    mesh, t: 0, dur: (opts && opts.dur) || 1.1,
    dirX: dx, dirZ: dz, kb: Math.min(9, 3 + dl * 0.4), tip: Math.random() < 0.5 ? 1 : -1, temp: !!(opts && opts.temp),
  });
}
function clearDeathAnim(mesh) {            // a respawning bot reclaims its mesh
  for (let i = dyingAvatars.length - 1; i >= 0; i--) if (dyingAvatars[i].mesh === mesh) dyingAvatars.splice(i, 1);
}
function disposeAvatar(m) {
  m.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } else if (o.isSprite && o.material) { o.material.map?.dispose(); o.material.dispose(); } });
}
function resetAvatarLook(mesh) {
  mesh.rotation.x = 0; mesh.rotation.z = 0;
  mesh.traverse((o) => { if (o.material) o.material.opacity = 1; });
}
function updateDyingAvatars(dt) {
  for (let i = dyingAvatars.length - 1; i >= 0; i--) {
    const d = dyingAvatars[i]; d.t += dt; const k = Math.min(1, d.t / d.dur), m = d.mesh;
    const tip = Math.min(1, k * 1.5);                                  // topples over in the first ~2/3
    m.rotation.x = d.tip * tip * Math.PI * 0.5;                        // fall flat
    const slide = d.kb * dt * (1 - k);                                 // flung back, decelerating
    m.position.x += d.dirX * slide; m.position.z += d.dirZ * slide;
    if (k > 0.45) m.position.y -= 0.9 * dt;                            // sink as it fades out
    const op = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
    m.traverse((o) => { if (o.material) o.material.opacity = op; });
    if (k >= 1) {
      if (d.temp) { scene.remove(m); disposeAvatar(m); }
      else m.visible = false;
      dyingAvatars.splice(i, 1);
    }
  }
}

// ---- Flash step: double-tap a movement direction to instantly blink that way,
// leaving fading after-images behind. Has charges that regenerate over time. ----
const FLASH_MAX = 3, FLASH_DIST = 12, FLASH_REGEN = 1.6;
let flashCharges = FLASH_MAX, flashRegen = 0, flashCD = 0;
const flashTap = { KeyW: -1, KeyA: -1, KeyS: -1, KeyD: -1 };
const afterImages = [];   // { mesh, t, dur } — translucent silhouettes left along the blink
function spawnAfterImages(start, end, name, skin, n) {
  const yaw = Math.atan2(end.x - start.x, end.z - start.z);   // face the travel direction
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const m = makeAvatar(name, skin);
    m.traverse((o) => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = 0.55; if (o.material.emissive) o.material.emissive.setHex(0x2a6cff); } });
    m.position.set(start.x + (end.x - start.x) * f, start.y + (end.y - start.y) * f, start.z + (end.z - start.z) * f);
    m.rotation.y = yaw;
    scene.add(m); afterImages.push({ mesh: m, t: 0, dur: 0.42 });
  }
  for (let s = 1; s <= 5; s++) { const f = s / 6; particles.burst(start.x + (end.x - start.x) * f, start.y + 0.9, start.z + (end.z - start.z) * f, [120, 170, 255], 4); }
  particles.burst(start.x, start.y + 0.9, start.z, [150, 200, 255], 14);
  particles.burst(end.x, end.y + 0.9, end.z, [200, 230, 255], 20);
}
function updateAfterImages(dt) {
  for (let i = afterImages.length - 1; i >= 0; i--) {
    const a = afterImages[i]; a.t += dt; const k = a.t / a.dur;
    if (k >= 1) { scene.remove(a.mesh); disposeAvatar(a.mesh); afterImages.splice(i, 1); continue; }
    const op = (1 - k) * 0.55;
    a.mesh.traverse((o) => { if (o.material) o.material.opacity = op; });
  }
}
function clearAfterImages() { for (const a of afterImages) { scene.remove(a.mesh); disposeAvatar(a.mesh); } afterImages.length = 0; }
function flashStep(code) {
  if (mode !== BATTLE && mode !== SURVIVAL) return;
  if (!player.locked || dead || eliminated || inventory.open || deathCam.active || killCam.active || player.flying) return;
  if (flashCharges <= 0 || flashCD > 0) return;
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  let dx = 0, dz = 0;                                          // match the player's WASD basis exactly
  if (code === 'KeyW') { dx = -sinY; dz = -cosY; }
  else if (code === 'KeyS') { dx = sinY; dz = cosY; }
  else if (code === 'KeyD') { dx = cosY; dz = -sinY; }
  else if (code === 'KeyA') { dx = -cosY; dz = sinY; }
  const start = player.pos.clone();
  const moved = player.flashTeleport(dx, dz, FLASH_DIST);
  if (moved < 0.3) return;                                     // blocked at the wall — don't burn a charge
  const end = player.pos.clone();
  flashCharges--; flashCD = 0.18; flashRegen = 0; invuln = Math.max(invuln, 0.4); protect = Math.max(protect, 0.4);   // brief i-frames through the blink (PvP too)
  spawnAfterImages(start, end, myName(), getSkin(mp.skin), 4);
  addShake(0.12); sfx.flashStep();
  broadcastFire('flash', start, _fdir.set(dx, 0, dz), { ex: end.x, ey: end.y, ez: end.z, skin: mp.skin });
}
const _fdir = new THREE.Vector3();
function onBotKilled(b) {
  particles.burst(b.pos.x, b.pos.y + 1, b.pos.z, [200, 60, 60], 18);
  const killer = (performance.now() / 1000 - (b.lastHitTime || 0) < 10) ? b.lastHitByName : null;
  hud.addKill(b.name, killer);
  if (killer === myName()) announceKill(b.lastHeadshot);
  if (mp.isHost) mp.broadcast({ t: 'death', id: b.id, name: b.name, by: killer });
  noteKill(killer, b.name, b.pos.x, b.pos.y + 1, b.pos.z, b.id);
  registerKill(killer, b.id);
  startDeathAnim(b.mesh, b.vel.x, b.vel.z);   // topple + get flung the way the hit knocked them
  b.respawnIn = 2.5;
}
function respawnBot(b) {
  b.alive = true; b.deathProcessed = false; b.health = 20;
  b.lastHitTime = -100; b.lastHitByName = null; b.lastHeadshot = false;   // clear stale damage so a fall-off next life isn't mis-credited
  const sp = teamSpawnPoint(b.team); b.pos.set(sp.x, sp.y, sp.z); b.vel.set(0, 0, 0);
  if (sp.yaw !== undefined) b.yaw = sp.yaw;
  // War: keep the bot's faction weapon (defenders stay on the MG) instead of re-rolling.
  if (gameMode === 'war' && (b.defend || b.advance) && b.gunId !== undefined) { b.gun = gunOf(b.gunId); b.ammo = b.gun.mag || Infinity; b.reloadTimer = 0; }
  else b._chooseGun();
  clearDeathAnim(b.mesh); resetAvatarLook(b.mesh);   // reclaim the mesh from any death animation
  b.mesh.position.copy(b.pos); b.mesh.visible = true;
}
function manageBots(dt) {
  const respawns = gameMode !== 'br' && gameMode !== 'wave';   // BR eliminates; waves replace
  for (const b of botMgr.bots) {
    if (!b.alive && !b.deathProcessed) { b.deathProcessed = true; onBotKilled(b); }
    else if (respawns && !b.alive && b.respawnIn > 0) {
      b.respawnIn -= dt;
      if (b.respawnIn <= 0) respawnBot(b);   // War: the assault is relentless — everyone respawns until the clock runs out
    }
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
  if (grenadeCount < 3) { grenadeCount = 3; hud.setGrenades(3); refilled = true; }
  if (refilled) {
    if (reloadingGun >= 0) reloadingGun = -1;
    sfx.place(); particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, [240, 200, 80], 16);
  }
  return refilled;
}

// Build the combatant target list bots reason about (players + bots).
function buildTargets() {
  const list = [{ id: selfId(), team: myTeam, pos: player.pos, vel: player.vel, alive: !eliminated && health > 0 }];
  if (mp.online) for (const [id, r] of mp.remotes) { if (botMgr.get(id)) continue; list.push({ id, team: teamOf(id), pos: r.group.position, alive: r.group.visible }); }
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
    else if (h.kind === 'remote') mp.sendHit(h.id, d, h.head, bot.name);   // credit the bot, not the host
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
// Bots resolve every gun as instant hitscan for clean damage attribution. Most
// weapons set gun.damage directly; projectile/AoE/jutsu kinds (rocket, plasma,
// blackhole, rasengan, rasenshuriken) either lean on splash or deal 0 on the
// direct hit, so derive an effective bot damage from splash — otherwise a bot
// forced onto e.g. the Rasenshuriken in Gun Game could never score and stall.
function botEffectiveDamage(gun) {
  if (gun.kind === 'hollowpurple') return 26;     // bots fire it as a strong bolt, not the player's one-shot corridor
  if (gun.damage > 0) return gun.damage;
  if (gun.splash) return Math.max(8, Math.round(gun.splash * 0.4));
  return 12;
}
function botFire(bot, dir) {
  const gun = bot.gun;
  bot.eye(_botEye);
  const muzzle = _botEye.clone().addScaledVector(dir, 0.6);
  const color = gun.kind === 'rail' ? 0xb98bff
    : gun.kind === 'rasengan' || gun.kind === 'rasenshuriken' ? 0x9fdcff
    : gun.kind === 'blackhole' ? 0xb98bff
    : gun.kind === 'plasma' ? 0x7af0e2
    : gun.kind === 'beam' ? 0xff5570
    : gun.kind === 'hollowpurple' ? 0xb060ff
    : gun.kind === 'sharingan' ? 0xff2838
    : (gun.zoom ? 0xbfe4ff : 0xffd27a);
  const dmg = botEffectiveDamage(gun);
  if (gun.kind === 'shotgun') {
    for (let i = 0; i < gun.pellets; i++) { const pd = spreadDir(dir, gun.spread); botBullet(bot, pd, gun.range, dmg, false); shotTracer('shotgun', muzzle, pd, gun.range, color); }
  } else if (gun.kind === 'rail') {
    botBullet(bot, dir, gun.range, dmg, true); shotTracer('rail', muzzle, dir, gun.range, color);
  } else {
    const pd = gun.spread ? spreadDir(dir, gun.spread) : dir;
    botBullet(bot, pd, gun.range, dmg, false); shotTracer('hitscan', muzzle, pd, gun.range, color);
  }
  if (botSoundBudget > 0) { botSoundBudget--; sfx.gunAt(gun.kind === 'rail' ? 'rail' : gun.kind === 'shotgun' ? 'shotgun' : gun.zoom ? 'sniper' : 'handgun', muzzle.x, muzzle.y, muzzle.z); }
  // Log the bot's shot for the kill-cam replay (render it as a simple tracer of its colour).
  recordFire(gun.kind === 'shotgun' ? 'shotgun' : gun.kind === 'rail' ? 'rail' : 'hitscan', muzzle, dir, { r: gun.range, c: color });
  if (mp.isHost) mp.broadcast({ t: 'bfire', kind: gun.kind, x: muzzle.x, y: muzzle.y, z: muzzle.z, dx: dir.x, dy: dir.y, dz: dir.z, range: gun.range, color });
}
let botBroadcastT = 0;
let botSoundBudget = 0;   // caps how many bot gunshots make sound per frame
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
  if (deathCam.active && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); skipDeathCam(); return; }
  // Flash step: a quick double-tap of a movement key blinks you that way.
  if (!e.repeat && (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD')) {
    const now = performance.now();
    if (now - flashTap[e.code] < 280) { flashTap[e.code] = -1; flashStep(e.code); }
    else flashTap[e.code] = now;
  }
  if (e.code === 'KeyE') {
    if (dead) return;
    // No creative inventory mid-battle: it would let you grab any gun from the palette
    // (e.g. an end-game weapon) and bypass your fixed loadout / Gun Game ladder level.
    if (inventory.open) closeInventory(); else if (player.locked && mode !== BATTLE) openInventory(2);  // not from pause/menu
  } else if (e.code === 'Escape' && inventory.open) {
    inventory.close(); refreshOverlays();
  } else if (e.code === 'KeyG') {
    if (mode === BATTLE) throwGrenade();                            // grenade in battle (self-guards on lock)
    else if (!dead && !inventory.open && player.locked) toggleMode();  // creative/survival toggle otherwise
  } else if (e.code === 'KeyV') {
    if (!dead && !inventory.open) quickMelee();                     // self-guards on lock
  } else if (e.code === 'KeyB') {
    if (!dead && !inventory.open && mode !== BATTLE && player.locked) applyDifficulty();
  } else if (e.code === 'KeyR') {
    const g2 = gunOf(inventory.selectedId());
    if (g2 && g2.mag && player.locked && !dead) startReload(g2, inventory.selectedId());
  } else if (e.code === 'KeyQ') {
    if (!dead && !inventory.open) { keyBreak = true; breakCD = 0; attackCD = 0; triggerConsumed = false; }   // break/attack without a mouse
  } else if (e.code === 'KeyF') {
    if (!dead && !inventory.open) { keyPlace = true; placeCD = 0; }                                          // place/use without a mouse
  } else if (e.code === 'KeyC') {
    if (!dead && !inventory.open && player.locked) chargingChakra = true;   // hold to channel chakra
  } else if (e.code === 'KeyT' || e.code === 'Enter') {
    if (player.locked && !inventory.open && !dead && !hud.isChatOpen()) { e.preventDefault(); player.keys.clear(); hud.openChat(); }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyC') chargingChakra = false;
  else if (e.code === 'KeyQ') { keyBreak = false; triggerConsumed = false; resetBreak(); }
  else if (e.code === 'KeyF') keyPlace = false;
});

// ---------- Mouse ----------
let mouseLeft = false, mouseRight = false, keyBreak = false, keyPlace = false;   // Q/F mirror the mouse buttons for mouseless play
renderer.domElement.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (deathCam.active) { skipDeathCam(); return; }   // tap to skip your death cam
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
  if (id !== WATER && y <= SEA_LEVEL) floodWater(x, y, z);   // water rushes into a hole opened below the sea
}

// Flood water into newly-opened air at/below sea level that's connected to an
// existing water source (down + sideways, never up), so destroying a wall lets
// the sea pour in. Bounded so a break can't fill an entire ocean of caverns.
function floodWater(sx, sy, sz) {
  const isWater = (x, y, z) => world.getBlock(x, y, z) === WATER;
  if (!(isWater(sx, sy + 1, sz) || isWater(sx + 1, sy, sz) || isWater(sx - 1, sy, sz) || isWater(sx, sy, sz + 1) || isWater(sx, sy, sz - 1))) return;
  const batch = [], q = [[sx, sy, sz]], seen = new Set([editKey(sx, sy, sz)]);
  while (q.length && batch.length < 320) {
    const [x, y, z] = q.shift();
    if (world.getBlock(x, y, z) !== AIR || y > SEA_LEVEL) continue;
    recordEdit(x, y, z, WATER); batch.push([x, y, z, WATER]);
    for (const [nx, ny, nz] of [[x, y - 1, z], [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1]]) {
      const key = editKey(nx, ny, nz);
      if (!seen.has(key) && ny <= SEA_LEVEL && world.getBlock(nx, ny, nz) === AIR) { seen.add(key); q.push([nx, ny, nz]); }
    }
  }
  if (batch.length) mp.sendEdits(batch);
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
  if (viewModel) { camera.remove(viewModel); viewModel.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } else if (o.isSprite && o.material) o.material.dispose(); }); viewModel = null; }
  if (gid !== -1) { viewModel = makeViewModel(gid); camera.add(viewModel); vmEquip = 1; }
}

// Procedural viewmodel animation: hip↔ADS, walk bob, idle breathing, look sway,
// recoil kick, reload dip/roll, and a raise-up on equip.
const VM_HIP = [0.42, -0.5, -0.85], VM_HIPR = [0.04, -0.13, 0.0];
const VM_ADS = [0.0, -0.31, -0.55], VM_ADSR = [0.0, 0.0, 0.0];
function animateViewModel(dt) {
  if (!viewModel) return;
  vmEquip *= Math.max(0, 1 - 6 * dt);
  const dyaw = player.yaw - lastYaw, dpitch = player.pitch - lastPitch;
  lastYaw = player.yaw; lastPitch = player.pitch;
  const k = Math.min(1, 9 * dt);
  vmSwayX += (Math.max(-0.05, Math.min(0.05, dyaw * 0.5)) - vmSwayX) * k;
  vmSwayY += (Math.max(-0.05, Math.min(0.05, dpitch * 0.5)) - vmSwayY) * k;

  const a = adsAmount, hip = 1 - a;
  let px = VM_HIP[0] + (VM_ADS[0] - VM_HIP[0]) * a;
  let py = VM_HIP[1] + (VM_ADS[1] - VM_HIP[1]) * a;
  let pz = VM_HIP[2] + (VM_ADS[2] - VM_HIP[2]) * a;
  let rx = VM_HIPR[0] + (VM_ADSR[0] - VM_HIPR[0]) * a;
  let ry = VM_HIPR[1] + (VM_ADSR[1] - VM_HIPR[1]) * a;
  let rz = VM_HIPR[2] + (VM_ADSR[2] - VM_HIPR[2]) * a;

  const bob = player.bobAmount || 0, bt = player.bobTime || 0;
  px += Math.cos(bt) * 0.016 * bob * hip;
  py -= Math.abs(Math.sin(bt)) * 0.02 * bob * hip;
  rz += Math.cos(bt) * 0.012 * bob * hip;
  const now = performance.now() * 0.001, idle = (1 - Math.min(1, bob)) * hip;
  py += Math.sin(now * 1.6) * 0.006 * idle;
  rx += Math.sin(now * 1.2) * 0.012 * idle;
  ry += Math.sin(now * 0.9) * 0.01 * idle;

  px += vmSwayX * hip; ry += vmSwayX * 0.7; py += vmSwayY * hip; rx -= vmSwayY * 0.7;
  pz += vmRecoil * 0.14; rx -= vmRecoil * 0.42; py += vmRecoil * 0.03;
  const rl = (reloadingGun >= 0 && reloadingGun === inventory.selectedId()) ? Math.sin(Math.min(1, 1 - reloadTimer / reloadDur) * Math.PI) : 0;
  py -= rl * 0.28; rx += rl * 0.95; rz += rl * 0.6; px += rl * 0.06;
  py -= vmEquip * 0.45; rx += vmEquip * 0.7;

  viewModel.position.set(px, py, pz);
  viewModel.rotation.set(rx, ry, rz);

  // Chakra charge-up: the Rasengan/Rasenshuriken orb self-animates by vmCharge
  // (0→1) — chakra streams spiral inward on tilted orbits and the orb grows,
  // brightens and spins up. "Channelling your chakra" before the release.
  if (viewModel.userData.chakraAnim) viewModel.userData.chakraAnim(vmCharge, dt, now);
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

// Broadcast a shot so other players see our tracers/projectiles (visual-only on their end).
function broadcastFire(kind, muzzle, dir, extra) {
  recordFire(kind, muzzle, dir, extra);   // also log it for the kill-cam replay
  if (mp.online) mp.broadcast(Object.assign({ t: 'pfire', k: kind, x: muzzle.x, y: muzzle.y, z: muzzle.z, dx: dir.x, dy: dir.y, dz: dir.z }, extra || {}));
}
// Render a shot as pure visuals (no damage) — shared by remote-player fire ('pfire')
// and the kill-cam shot replay.
function spawnGhostShot(d, withSound) {
  const muzzle = new THREE.Vector3(d.x, d.y, d.z), dir = new THREE.Vector3(d.dx, d.dy, d.dz);
  const snd = (name) => { if (withSound) sfx.gunAt(name, d.x, d.y, d.z); };
  const k = d.k;
  if (k === 'hitscan' || k === 'shotgun' || k === 'rail') {
    shotTracer(k, muzzle, dir.clone().normalize(), d.r || 60, d.c || 0xffd27a);
    snd(k === 'rail' ? 'rail' : k === 'shotgun' ? 'shotgun' : 'handgun');
  } else if (k === 'plasma') { plasmas.spawn(muzzle, dir.clone().normalize(), d.sp || 40, 0, d.r || 70, true); if (withSound) sfx.plasma(); }
  else if (k === 'rocket') { rockets.spawn(muzzle, dir.clone().normalize(), { speed: d.sp || 30, range: d.r || 70 }, 'remote', true); snd('shotgun'); }
  else if (k === 'grenade') { grenades.spawn(muzzle, dir, d.fuse || 1.6, null, true); if (withSound) sfx.place(); }
  else if (k === 'rasengan') { const nd = dir.clone().normalize(), cf = d.cf || 1; chakra.grind(muzzle.clone().addScaledVector(nd, 2.4), nd, 0x4aa3ff, 0.3 + 0.18 * cf, 0.8 + 0.6 * cf); if (withSound) sfx.rasengan(); }
  else if (k === 'rasenshuriken') { chakra.throw(muzzle, dir.clone().normalize(), { kind: 'rasenshuriken', speed: d.sp || 34, radius: d.rad || 10, splash: 0, range: d.r || 92 }, 'remote', null, false); if (withSound) sfx.rasenshuriken(); }
  else if (k === 'beam') { const end = muzzle.clone().addScaledVector(dir.clone().normalize(), d.r || 60); tracers.add(muzzle, end, d.c || 0xff2e54); tracers.add(muzzle, end, 0xffffff); snd('rail'); }
  else if (k === 'blackhole') { blackholes.spawn(muzzle, dir.clone().normalize(), { speed: d.sp || 24, range: d.r || 82, radius: d.rad || 16, duration: d.du || 4.4, splash: 0, damage: 0 }, 'remote', true); if (withSound) sfx.blackhole(); }
  else if (k === 'hollowpurple') { const end = muzzle.clone().addScaledVector(dir.clone().normalize(), d.r || 80); hollowPurple.spawn(muzzle, end, d.rad || 4); if (withSound) sfx.explosionAt(d.x, d.y, d.z); }
  else if (k === 'cleave') { cleaveFx.spawn(muzzle, dir.clone().normalize(), (d.r || 15) * 0.5, d.arc || 1.1); if (withSound) sfx.slash(); }
  else if (k === 'sharingan') { const end = muzzle.clone().addScaledVector(dir.clone().normalize(), d.r || 40); particles.burst(end.x, end.y, end.z, [200, 20, 40], d.lock ? 14 : 5); }
  else if (k === 'flash') { const end = new THREE.Vector3(d.ex ?? d.x, d.ey ?? d.y, d.ez ?? d.z); spawnAfterImages(muzzle, end, '', getSkin(d.skin), 3); if (withSound) sfx.flashStep(); }
}
function fireGun(gun, secondary) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const muzzle = _eye.clone().addScaledVector(_dir, 0.6);
  if (gun.kind === 'hitscan') { fireHitscan(gun, muzzle); broadcastFire('hitscan', muzzle, _dir, { r: gun.range, c: gun.zoom ? 0xbfe4ff : 0xfff1b0 }); }
  else if (gun.kind === 'shotgun') { fireShotgun(gun, muzzle); broadcastFire('shotgun', muzzle, _dir, { r: gun.range, c: 0xffd27a }); }
  else if (gun.kind === 'rail') { fireRail(gun, muzzle); broadcastFire('rail', muzzle, _dir, { r: gun.range, c: 0xb98bff }); }
  else if (gun.kind === 'plasma') { plasmas.spawn(muzzle, _dir, gun.speed, gun.damage, gun.range); sfx.plasma(); broadcastFire('plasma', muzzle, _dir, { sp: gun.speed, r: gun.range }); }
  else if (gun.kind === 'rocket') { rockets.spawn(muzzle, _dir.clone(), gun, mp.myId || 'me'); sfx.gun('shotgun'); broadcastFire('rocket', muzzle, _dir, { sp: gun.speed, r: gun.range }); }
  else if (gun.kind === 'blackhole') { blackholes.spawn(muzzle, _dir.clone(), gun, mp.myId || 'me'); sfx.blackhole(); broadcastFire('blackhole', muzzle, _dir, { sp: gun.speed, r: gun.range, du: gun.duration, rad: gun.radius }); }
  else if (gun.kind === 'rasengan') fireRasengan(gun);
  else if (gun.kind === 'rasenshuriken') { chakra.throw(muzzle, _dir.clone(), gun, mp.myId || 'me', rasenshurikenImpact); sfx.rasenshuriken(); addShake(0.18); }
  else if (gun.kind === 'cleave') fireCleave(gun, muzzle);
  else if (gun.kind === 'portal') firePortal(secondary ? 1 : 0, gun);
}

// Cleave & Dismantle (Sukuna): sweep a fan of cursed slashes that carve every enemy
// in a forward arc. Dismantle hits the whole cone; Cleave bites far harder the closer
// the target (the cut "adjusts" as it nears point-blank).
function fireCleave(gun, muzzle) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const aim = _dir.clone().normalize();
  const range = gun.range, cosHalf = Math.cos(gun.arc || 1.1);
  let struck = false;
  // Resolve one candidate: inside the cone + range + line-of-sight, then apply scaled damage.
  const tryHit = (tx, ty, tz, apply) => {
    const dx = tx - _eye.x, dy = ty - _eye.y, dz = tz - _eye.z, dist = Math.hypot(dx, dy, dz);
    if (dist > range || dist < 0.001) return;
    if ((dx * aim.x + dy * aim.y + dz * aim.z) / dist < cosHalf) return;     // outside the slash cone
    if (!losClear(_eye.x, _eye.y, _eye.z, tx, ty, tz)) return;
    const near = 1 - Math.min(1, dist / range);                              // 1 at point-blank -> 0 at the rim
    const dmg = Math.round(gun.damage + (gun.cleave || 0) * near * near);    // Cleave bites harder up close
    apply(dmg, dx / dist, dz / dist);
    struck = true;
    particles.burst(tx, ty, tz, [255, 30, 64], 14); particles.burst(tx, ty, tz, [255, 220, 228], 5);
  };
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    tryHit(b.pos.x, b.pos.y + 1, b.pos.z, (dmg, kx, kz) => {
      botHurt(b.id, dmg, myName(), false);
      b.vel.x += kx * gun.knockback; b.vel.z += kz * gun.knockback; b.vel.y += gun.knockback * 0.25;
      damageNumbers.spawn(new THREE.Vector3(b.pos.x, b.pos.y + 1.7, b.pos.z), dmg, false);
    });
  }
  if (mp.online) for (const [id, r] of mp.remotes) {
    if (friendly(id)) continue;
    tryHit(r.group.position.x, r.group.position.y + 1, r.group.position.z, (dmg) => mp.sendHit(id, dmg));
  }
  for (const m of mobs.list) tryHit(m.pos.x, m.pos.y + m.height * 0.5, m.pos.z, (dmg) => m.hurt(dmg, player.pos.x, player.pos.z));
  if (struck) hud.hitMarker(false);
  cleaveFx.spawn(_eye.clone(), aim, range * 0.5, gun.arc || 1.1);
  sfx.slash(); addShake(0.13);
  broadcastFire('cleave', muzzle, _dir, { r: range, arc: gun.arc || 1.1 });
}

// Nearest damageable enemy (remote humans + local bots) along a ray.
function raycastEnemies(origin, dir, maxDist) {
  let best = mp.online ? mp.raycast(origin, dir, maxDist) : null;
  if (isAuthority()) { const b = botMgr.raycast(origin, dir, best ? best.dist : maxDist, null); if (b && (!best || b.dist < best.dist)) best = b; }
  return best;
}
let _suppressDmgNum = false;
// One hitscan ray (already-perturbed `dir`) from `origin`, drawing its own tracer
// from `tracerStart`. Resolves against enemies, mobs, blocks — and passes through
// portals, continuing the shot out the paired one.
function castBullet(origin, dir, range, damage, tracerStart, color, depth = 0) {
  const start = tracerStart || origin;
  const portalHit = depth < 2 ? portals.rayPortal(origin, dir, range) : null;
  const enemy = raycastEnemies(origin, dir, range);
  const mobHit = mobs.raycast(origin, dir, range);
  const blockHit = voxelRaycast(origin, dir, range, (x, y, z) => world.getBlock(x, y, z));
  const blockDist = blockHit.hit ? Math.hypot(blockHit.x + 0.5 - origin.x, blockHit.y + 0.5 - origin.y, blockHit.z + 0.5 - origin.z) : Infinity;
  const enemyDist = enemy ? enemy.dist : Infinity;
  const mobDist = mobHit ? mobHit.dist : Infinity;
  const portalDist = portalHit ? portalHit.dist : Infinity;
  const nearest = Math.min(blockDist, enemyDist, mobDist, portalDist);

  if (portalHit && portalDist === nearest) {
    const pp = origin.clone().addScaledVector(dir, portalDist);
    if (color != null) tracers.add(start, pp, color);
    castBullet(portalHit.exitPos, portalHit.exitDir, range - portalDist, damage, portalHit.exitPos.clone(), color, depth + 1);
    return;
  }
  let end;
  if (enemy && enemyDist === nearest) {
    end = origin.clone().addScaledVector(dir, enemyDist);
    if (!friendly(enemy.id)) {
      const dmg = enemy.head ? Math.round(damage * 1.7) : damage;
      if (enemy.bot) botHurt(enemy.id, dmg, myName(), enemy.head); else mp.sendHit(enemy.id, dmg, enemy.head);
      particles.burst(end.x, end.y, end.z, enemy.head ? [255, 220, 60] : [255, 70, 70], enemy.head ? 16 : 10);
      if (!_suppressDmgNum) damageNumbers.spawn(end, dmg, enemy.head);
      hud.hitMarker(enemy.head);
    }
  } else if (mobHit && mobDist === nearest) {
    mobHit.mob.hurt(damage, player.pos.x, player.pos.z);
    end = origin.clone().addScaledVector(dir, mobDist);
    particles.burst(end.x, end.y, end.z, [220, 80, 80], 8);
    if (!_suppressDmgNum) damageNumbers.spawn(end, damage, false);
    hud.hitMarker(false);
  } else if (blockHit.hit) {
    end = new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
    particles.burst(end.x, end.y, end.z, blockTint(world.getBlock(blockHit.x, blockHit.y, blockHit.z)), 6);
  } else {
    end = origin.clone().addScaledVector(dir, range);
  }
  if (color != null) tracers.add(start, end, color);
}

function fireHitscan(gun, muzzle) {
  const dir = spreadDir(_dir, gun.spread * (1 - adsAmount * 0.85));
  castBullet(_eye.clone(), dir.clone(), gun.range, gun.damage, muzzle, gun.zoom ? 0xbfe4ff : 0xffe08a);
  sfx.gun(gun.zoom ? 'sniper' : 'handgun');
}

// Shotgun: a cone of pellets (no per-pellet damage numbers — markers suffice).
function fireShotgun(gun, muzzle) {
  _suppressDmgNum = true;
  const spread = gun.spread * (1 - adsAmount * 0.55);   // shotgun stays a cone even ADS
  for (let i = 0; i < gun.pellets; i++) {
    castBullet(_eye.clone(), spreadDir(_dir, spread).clone(), gun.range, gun.damage, muzzle, 0xffc46a);
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

// Laser cannon: a sustained beam. Resolves an endpoint each frame, paints the beam,
// and applies continuous damage on a fixed tick while draining the heat battery.
let beamTickCD = 0, beamDrainAcc = 0, beamSndCD = 0, beamBroadcastCD = 0, beamSnd = false;
function fireBeam(gun, id, dt) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const muzzle = _eye.clone().addScaledVector(_dir, 0.55);
  const block = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  const blockDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : gun.range;
  // A beam of destruction: it PIERCES every enemy along its length up to the wall.
  const end = _eye.clone().addScaledVector(_dir, blockDist);
  laser.set(true, muzzle, end, gun.color);
  beamTickCD -= dt;
  if (beamTickCD <= 0) {
    beamTickCD = gun.tick;
    const dmg = Math.max(1, Math.round(gun.dps * gun.tick));
    let any = false;
    for (const m of mobs.list) { const t = m.rayHit(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, blockDist); if (t < blockDist) { m.hurt(dmg, player.pos.x, player.pos.z); any = true; } }
    const enemies = [];
    if (mp.online) for (const ph of mp.raycastAll(_eye, _dir, blockDist)) enemies.push({ id: ph.id, head: ph.head, bot: false });
    if (isAuthority()) for (const bh of botMgr.raycastAll(_eye, _dir, blockDist, null)) enemies.push({ id: bh.id, head: bh.head, bot: true });
    for (const e of enemies) {
      if (friendly(e.id)) continue;
      const d = e.head ? Math.round(dmg * 1.4) : dmg;
      if (e.bot) botHurt(e.id, d, myName(), e.head); else mp.sendHit(e.id, d, e.head);
      any = true;
    }
    if (any) { hud.hitMarker(false); damageNumbers.spawn(end, dmg, false); }
    blastCover(end, 1);                                   // melt through soft cover the beam touches
  }
  // A steady stream of impact sparks every frame (not a pulse per tick) so the beam
  // reads as one continuous lance rather than repeated bursts.
  if (Math.random() < 0.9) particles.burst(end.x, end.y, end.z, [255, 90, 120], 2);
  beamDrainAcc += gun.drain * dt;
  if (beamDrainAcc >= 1) { const n = Math.floor(beamDrainAcc); beamDrainAcc -= n; ammo[id] = Math.max(0, ammoFor(gun, id) - n); if (ammoFor(gun, id) <= 0) { laser.set(false); startReload(gun, id); } }
  addShake(0.02); vmRecoil = Math.min(1, vmRecoil + 0.04); beamSnd = true;
  sfx.beamStart();                                        // one sustained beam tone (idempotent) — no repeated zaps
  beamBroadcastCD -= dt; if (beamBroadcastCD <= 0) { beamBroadcastCD = 0.1; broadcastFire('beam', muzzle, _dir, { r: blockDist, c: gun.color }); }
}

// Hollow Purple (Gojo): clap red + blue together and erase a wide corridor with an
// imaginary-mass purple beam. A fuller charge → wider/longer/deadlier blast.
function fireHollowPurple(gun, cf = 1) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const muzzle = _eye.clone().addScaledVector(_dir, 0.6);
  const range = gun.range * (0.55 + 0.45 * cf), radius = gun.radius * (0.6 + 0.4 * cf);
  const block = voxelRaycast(_eye, _dir, range, (x, y, z) => world.getBlock(x, y, z));
  const wallDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : range;
  const end = _eye.clone().addScaledVector(_dir, wallDist);
  const dmg = Math.max(1, Math.round(gun.damage * (0.4 + 0.6 * cf)));
  const KB = (gun.knockback || 24) * (0.5 + 0.5 * cf);
  // Everything within `radius` of the beam line (up to the wall) is annihilated.
  const distToLine = (px, py, pz) => {
    const vx = px - _eye.x, vy = py - _eye.y, vz = pz - _eye.z;
    const t = Math.max(0, Math.min(wallDist, vx * _dir.x + vy * _dir.y + vz * _dir.z));
    return Math.hypot(vx - _dir.x * t, vy - _dir.y * t, vz - _dir.z * t);
  };
  let struck = false;
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    if (distToLine(b.pos.x, b.pos.y + 1, b.pos.z) > radius) continue;
    botHurt(b.id, dmg, myName(), false);
    b.vel.x += _dir.x * KB; b.vel.z += _dir.z * KB; b.vel.y += KB * 0.3; struck = true;
  }
  for (const m of mobs.list) { if (distToLine(m.pos.x, m.pos.y + m.height * 0.5, m.pos.z) <= radius) { m.hurt(dmg, player.pos.x, player.pos.z); struck = true; } }
  if (mp.online) for (const [id, r] of mp.remotes) { if (friendly(id)) continue; if (distToLine(r.group.position.x, r.group.position.y + 1, r.group.position.z) <= radius) { mp.sendHit(id, dmg); struck = true; } }
  if (struck) hud.hitMarker(false);
  hollowPurple.spawn(muzzle, end, radius);
  particles.burst(end.x, end.y, end.z, [180, 90, 255], 50);
  particles.burst(muzzle.x, muzzle.y, muzzle.z, [120, 140, 255], 20);
  shockShake(end, 0.9, 30); addShake(0.25 + 0.2 * cf); vmRecoil = Math.min(1, vmRecoil + 0.8);
  sfx.explosionAt(end.x, end.y, end.z);
  broadcastFire('hollowpurple', muzzle, _dir, { r: wallDist, rad: radius });
}

// ---- Sharingan ----
// Mark a target for the Amaterasu black flames (a spreading damage-over-time).
function igniteTarget(id, dps, dur, src) {
  const e = amaBurn.get(id);
  if (e) { e.t = Math.max(e.t, dur); e.dps = dps; } else amaBurn.set(id, { t: dur, acc: 0, dps, src: src || myName() });
}
function amaTargetPos(id, out) {
  if (String(id).startsWith('bot:')) { const b = botMgr.get(id); if (b && b.alive) { out.set(b.pos.x, b.pos.y + 1, b.pos.z); return true; } return false; }
  const r = mp.remotes.get(id); if (r && r.group.visible) { out.set(r.group.position.x, r.group.position.y + 1, r.group.position.z); return true; } return false;
}
// Burn every marked target each frame: accumulate fractional DoT, throw black-flame
// particles, and occasionally spread the flames to a nearby enemy.
function tickAmaterasu(dt) {
  if (!amaBurn.size) return;
  for (const [id, e] of amaBurn) {
    if (!amaTargetPos(id, _amaP)) { amaBurn.delete(id); continue; }
    e.t -= dt; e.acc += e.dps * dt;
    let dmg = 0; while (e.acc >= 1) { e.acc -= 1; dmg++; }
    if (dmg > 0 && isAuthority()) { if (String(id).startsWith('bot:')) botHurt(id, dmg, e.src, false); }
    if (dmg > 0 && !String(id).startsWith('bot:')) mp.sendHit(id, dmg);
    if (Math.random() < 0.7) particles.burst(_amaP.x + (Math.random() - 0.5) * 0.7, _amaP.y + Math.random() * 0.7, _amaP.z + (Math.random() - 0.5) * 0.7, [26, 6, 36], 2);
    if (Math.random() < 0.3) particles.burst(_amaP.x, _amaP.y + 0.3, _amaP.z, [150, 40, 190], 1);
    if (e.t <= 0) { amaBurn.delete(id); continue; }
    if (isAuthority() && Math.random() < 0.25) {   // the black flames spread
      for (const b of botMgr.bots) {
        if (!b.alive || friendly(b.id) || amaBurn.has(b.id)) continue;
        if (Math.hypot(b.pos.x - _amaP.x, b.pos.y + 1 - _amaP.y, b.pos.z - _amaP.z) < 2.6) { igniteTarget(b.id, e.dps, e.t * 0.7, e.src); break; }
      }
    }
  }
}
let _mobBurnAcc = 0;
// The gaze: ignite whoever you look at, and hold it to lock them in genjutsu.
function sharinganGaze(gun, dt) {
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const muzzle = _eye.clone().addScaledVector(_dir, 0.3);
  const block = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  const blockDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : gun.range;
  const enemy = raycastEnemies(_eye, _dir, blockDist);
  const mobHit = mobs.raycast(_eye, _dir, blockDist);
  const enemyDist = enemy ? enemy.dist : Infinity, mobDist = mobHit ? mobHit.dist : Infinity;
  const hitDist = Math.min(blockDist, enemyDist, mobDist);
  const end = _eye.clone().addScaledVector(_dir, hitDist);
  let locked = false;
  if (enemy && enemyDist <= hitDist + 0.01 && !friendly(enemy.id)) {
    igniteTarget(enemy.id, gun.dot, gun.ignite, myName());
    if (gazeTargetId === enemy.id) gazeHold += dt; else { gazeTargetId = enemy.id; gazeHold = 0; }
    if (gazeHold >= gun.ensnare) {                 // genjutsu snaps shut
      gazeHold = 0; locked = true;
      if (enemy.bot) { const b = botMgr.get(enemy.id); if (b) { b.stunT = gun.stun; particles.burst(b.pos.x, b.pos.y + 1.5, b.pos.z, [255, 20, 44], 24); } }
      sfx.rasenshuriken();
    }
  } else if (mobHit && mobDist <= hitDist + 0.01) {
    mobHit.mob.burning = true; _mobBurnAcc += gun.dot * dt;
    while (_mobBurnAcc >= 1) { _mobBurnAcc -= 1; mobHit.mob.hurt(1, player.pos.x, player.pos.z); }
    gazeTargetId = null; gazeHold = 0;
  } else { gazeTargetId = null; gazeHold = 0; }
  sharinganFx.set(true, muzzle, end, locked);
  if (gameMode !== 'gungame') chakraEnergy = Math.max(0, chakraEnergy - gun.drain * dt);
  gazeBcCD -= dt; if (gazeBcCD <= 0) { gazeBcCD = 0.12; broadcastFire('sharingan', muzzle, _dir, { r: hitDist, lock: locked ? 1 : 0 }); }
}
// Precognition: enter bullet-time — enemies slow + glow through walls, you take less damage.
function activatePrecog(gun) {
  precogT = gun.precogDur; precogCD = gun.precogDur + gun.precogCD;
  if (gameMode !== 'gungame') chakraEnergy = Math.max(0, chakraEnergy - gun.precogCost);
  setEnemyXray(true); hud.setPrecog(true); sfx.chakraReady(); addShake(0.22);
  player.eyePosition(_eye); particles.burst(_eye.x, _eye.y, _eye.z, [255, 30, 50], 22);
}
function setEnemyXray(on) {
  precogXray = on;
  for (const b of botMgr.bots) {
    if (!b.mesh) continue;
    const enemy = !(teamMode && b.team === myTeam);
    b.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.material.depthTest = !(on && enemy);
      o.renderOrder = (on && enemy) ? 4000 : 0;
      if (o.material.emissive) o.material.emissive.setHex((on && enemy) ? 0x6a0010 : 0x000000);
    });
  }
}
function resetSharingan() {
  if (precogXray) setEnemyXray(false);
  precogT = 0; precogCD = 0; gazeTargetId = null; gazeHold = 0;
  amaBurn.clear(); sharinganFx.set(false); hud.setPrecog(false);
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

// Shared area-of-effect damage with falloff — hits mobs, bots, remote players and
// the local player (self-splash). Respects team friendly-fire. `self` scales the
// damage you take from your own blast.
function explodeDamage(pos, radius, maxDmg, self = 0.5) {
  let hit = false;
  for (const m of mobs.list) {
    const d = Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z);
    if (d < radius) { m.hurt(Math.round(maxDmg * (1 - d / radius)), pos.x, pos.z); hit = true; }
  }
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    const d = Math.hypot(b.pos.x - pos.x, b.pos.y + 1 - pos.y, b.pos.z - pos.z);
    if (d < radius) { botHurt(b.id, Math.round(maxDmg * (1 - d / radius)), myName(), false); hit = true; }
  }
  if (mp.online) for (const { id, dist } of mp.playersNear(pos, radius)) {
    if (friendly(id)) continue;
    mp.sendHit(id, Math.round(maxDmg * (1 - dist / radius))); hit = true;
  }
  const ds = Math.hypot(player.pos.x - pos.x, player.pos.y + 0.9 - pos.y, player.pos.z - pos.z);
  if (ds < radius && self > 0) damagePlayer(Math.round(maxDmg * (1 - ds / radius) * self), pos.x, pos.z);
  if (hit) hud.hitMarker(false);
}

// Destroy soft cover (wool/planks/glass/leaves) in a small radius — never floor/walls.
function blastCover(pos, r) {
  const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z), batch = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    if (dx * dx + dy * dy + dz * dz > r * r + 1) continue;
    const x = fx + dx, y = fy + dy, z = fz + dz, b = world.getBlock(x, y, z);
    if (b === WOOL || b === PLANK || b === GLASS || b === LEAVES) { recordEdit(x, y, z, AIR); batch.push([x, y, z, AIR]); }
  }
  mp.sendEdits(batch);
}

function rocketImpact(pos, gun) {
  particles.burst(pos.x, pos.y, pos.z, [255, 150, 60], 44);
  particles.burst(pos.x, pos.y, pos.z, [120, 120, 120], 22);
  sfx.explosionAt(pos.x, pos.y, pos.z);
  shockShake(pos, 0.5, 24);
  explodeDamage(pos, gun.radius, gun.splash, 0.45);
  blastCover(pos, 2);
}

// Unleash a charged jutsu (cf = 0..1 charge fraction). Jutsu draw from the chakra
// reserve — a weak tap costs less, a full charge costs the most. No chakra → fizzle.
function releaseCharge(gun, cf) {
  // Gun Game cycles you through every weapon — don't gate the jutsu tiers on the
  // chakra reserve, or a player could reach the Rasengan/Rasenshuriken and be
  // unable to fire (and unable to win). Every other mode pays the chakra cost.
  const freeJutsu = gameMode === 'gungame';
  const baseCost = gun.kind === 'hollowpurple' ? HOLLOW_PURPLE_COST : gun.kind === 'rasenshuriken' ? RASENSHURIKEN_COST : RASENGAN_COST;
  const cost = Math.round(baseCost * (0.5 + 0.5 * cf));
  if (!freeJutsu && chakraEnergy < cost) {          // not enough chakra — sputter out
    player.eyePosition(_eye); camera.getWorldDirection(_dir);
    const p = _eye.clone().addScaledVector(_dir, 0.5);
    particles.burst(p.x, p.y, p.z, [110, 150, 200], 8);
    hud.setChakra(chakraEnergy / CHAKRA_MAX, false);
    return false;
  }
  if (!freeJutsu) chakraEnergy -= cost;
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  if (gun.kind === 'rasengan') { fireRasengan(gun, cf); broadcastFire('rasengan', _eye, _dir, { cf }); }
  else if (gun.kind === 'rasenshuriken') {
    const muzzle = _eye.clone().addScaledVector(_dir, 0.6);
    // Longer charge → faster throw, a bigger dome and far more splash.
    const scaled = { ...gun, radius: gun.radius * (0.5 + 0.5 * cf), splash: Math.round(gun.splash * (0.35 + 0.65 * cf)), speed: gun.speed * (0.7 + 0.3 * cf) };
    chakra.throw(muzzle, _dir.clone(), scaled, mp.myId || 'me', rasenshurikenImpact);
    sfx.rasenshuriken(); addShake(0.06 + 0.2 * cf);
    broadcastFire('rasenshuriken', muzzle, _dir, { cf, sp: scaled.speed, rad: scaled.radius, r: gun.range });
  }
  else if (gun.kind === 'hollowpurple') fireHollowPurple(gun, cf);
  vmRecoil = Math.min(1, vmRecoil + 0.6);
  return true;
}

// Peak-chakra power-up: a chakra shockwave that flashes out and shoves nearby enemies
// back (the "explosion of chakra" when you max out, like the Naruto games).
function chakraPowerBurst() {
  const c = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z);
  chakra.burst(c.clone(), 4.5, 0x6fc8ff, false);
  particles.burst(c.x, c.y, c.z, [150, 210, 255], 64);
  sfx.chakraBurst(); addShake(0.4);
  const R = 6.5, KB = 17;
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    const dx = b.pos.x - player.pos.x, dz = b.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > R) continue;
    const f = 1 - d / R, dl = d || 1;
    b.vel.x += (dx / dl) * KB * f; b.vel.z += (dz / dl) * KB * f; b.vel.y += 7 * f;
  }
  for (const m of mobs.list) { const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z); if (d <= R) m.hurt(1, player.pos.x, player.pos.z); }
  if (mp.online) for (const { id } of mp.playersNear(c, R)) { if (!friendly(id)) mp.sendHit(id, 1); }
}

// ---- Rasengan: a point-blank chakra grind — heavy single burst + hard knockback. ----
function fireRasengan(gun, cf = 1) {
  const block = voxelRaycast(_eye, _dir, gun.range, (x, y, z) => world.getBlock(x, y, z));
  const enemy = raycastEnemies(_eye, _dir, gun.range);
  const mobHit = mobs.raycast(_eye, _dir, gun.range);
  const blockDist = block.hit ? Math.hypot(block.x + 0.5 - _eye.x, block.y + 0.5 - _eye.y, block.z + 0.5 - _eye.z) : gun.range;
  const dist = Math.min(blockDist, enemy ? enemy.dist : Infinity, mobHit ? mobHit.dist : Infinity, gun.range);
  const end = _eye.clone().addScaledVector(_dir, dist);
  // The orb drives INTO the foe — embed the grind a little past the contact point.
  const grindPos = end.clone().addScaledVector(_dir, 0.35);
  // Longer charge → much bigger hit, reach and knockback (a quick tap barely stings).
  const dmg = Math.max(1, Math.round(gun.damage * (0.25 + 0.75 * cf)));
  const R = 1.9 + 1.6 * cf, KB = (gun.knockback || 14) * (0.4 + 0.8 * cf);
  let struck = false;
  // Drill them straight back along the aim and launch them up — the Rasengan blast-off.
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    if (Math.hypot(b.pos.x - end.x, b.pos.y + 1 - end.y, b.pos.z - end.z) > R) continue;
    botHurt(b.id, dmg, myName(), false);
    b.vel.x += _dir.x * KB; b.vel.z += _dir.z * KB; b.vel.y += KB * 0.6;
    particles.burst(b.pos.x, b.pos.y + 1.0, b.pos.z, [255, 80, 80], 16);   // impact spray off the body
    struck = true;
  }
  for (const m of mobs.list) {
    if (Math.hypot(m.pos.x - end.x, m.pos.y + m.height * 0.5 - end.y, m.pos.z - end.z) > R) continue;
    m.hurt(dmg, player.pos.x, player.pos.z);
    m.vel && (m.vel.x += _dir.x * KB, m.vel.z += _dir.z * KB, m.vel.y += KB * 0.5);
    particles.burst(m.pos.x, m.pos.y + m.height * 0.5, m.pos.z, [255, 90, 90], 12);
    struck = true;
  }
  if (mp.online) for (const { id } of mp.playersNear(end, R)) { if (friendly(id)) continue; mp.sendHit(id, dmg); struck = true; }
  if (struck) hud.hitMarker(false);
  // The grind drills into them for a beat, then detonates in a chakra blast.
  chakra.grind(grindPos.clone(), _dir.clone(), 0x4aa3ff, 0.3 + 0.18 * cf, 0.8 + 0.6 * cf);
  particles.burst(grindPos.x, grindPos.y, grindPos.z, [150, 205, 255], 22 + Math.round(cf * 30));
  addShake(0.2 + 0.34 * cf); vmRecoil = Math.min(1, vmRecoil + 0.7); sfx.rasengan();
}
function rasenshurikenImpact(pos, gun) {
  // A blinding wind-blade dome: a big needle burst + layered particle shells.
  chakra.burst(pos.clone(), Math.max(3, gun.radius * 0.95), 0xeaffff, true);
  chakra.burst(pos.clone(), Math.max(2, gun.radius * 0.55), 0xffffff, false);
  particles.burst(pos.x, pos.y, pos.z, [230, 248, 255], 110);
  particles.burst(pos.x, pos.y, pos.z, [150, 210, 255], 60);
  particles.burst(pos.x, pos.y, pos.z, [255, 255, 255], 26);
  sfx.explosionAt(pos.x, pos.y, pos.z);
  shockShake(pos, 1.05, 34);
  explodeDamage(pos, gun.radius, gun.splash, 0.35);
  blastCover(pos, 4);
}
// The shuriken detonates on contact with any combatant (else on a block / its range).
const _guideDir = new THREE.Vector3();
const chakraHooks = {
  guideDir: null,           // set each frame to the thrower's aim so the Rasenshuriken can curve
  anchorAt: (pos) => {
    for (const m of mobs.list) if (Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z) < 1.8) return true;
    if (isAuthority()) for (const b of botMgr.bots) if (b.alive && Math.hypot(b.pos.x - pos.x, b.pos.y + 1 - pos.y, b.pos.z - pos.z) < 1.8) return true;
    if (mp.online && mp.playersNear(pos, 1.8).length) return true;
    return false;
  },
};

// ---- Black hole bomb ----
// The singularity's gravity well. Stability matters: the pull ramps to zero inside
// a capture radius (so nothing oscillates back and forth through the centre) and is
// speed-capped (so it can never fling an entity), and the local player is only ever
// lifted, never slammed down into the floor when the hole sits at ground level.
const BH_CAPTURE = 2.4, BH_MAXSPD = 13;
function blackHoleField(pos, dt, gun) {
  const R = gun.radius, R2 = R * R;
  const well = (cx, cy, cz) => {
    const dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2) return null;
    const d = Math.sqrt(d2) || 0.001, fall = 1 - d / R;
    const grip = Math.min(1, d / BH_CAPTURE);          // fade the pull to 0 at the centre (no oscillation)
    const spd = Math.min(BH_MAXSPD, gun.pull * (0.25 + fall * fall)) * grip;  // inward blocks/sec, capped
    return { d, ux: dx / d, uy: dy / d, uz: dz / d, spd };
  };
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    const w = well(b.pos.x, b.pos.y + 1, b.pos.z); if (!w) continue;
    b.pos.x += w.ux * w.spd * dt; b.pos.z += w.uz * w.spd * dt;
    if (w.uy > 0) b.pos.y += w.uy * w.spd * dt * 0.5;          // only lift, don't shove into the floor
    if (w.d < BH_CAPTURE) botHurt(b.id, Math.max(1, Math.round(gun.damage * dt * 4)), myName(), false);
  }
  for (const m of mobs.list) {
    const w = well(m.pos.x, m.pos.y + m.height * 0.5, m.pos.z); if (!w) continue;
    m.pos.x += w.ux * w.spd * dt; m.pos.z += w.uz * w.spd * dt;
    if (w.uy > 0) m.pos.y += w.uy * w.spd * dt * 0.5;
    if (w.d < BH_CAPTURE) m.hurt(Math.max(1, Math.round(gun.damage * dt * 4)), pos.x, pos.z);
  }
  // Local player: nudge velocity toward the (capped) inward pull, then hard-clamp the
  // resulting speed so the suck can never fling them. Vertical only ever lifts.
  if ((mode === BATTLE || mode === SURVIVAL) && !dead && !eliminated) {
    const w = well(player.pos.x, player.pos.y + 0.9, player.pos.z);
    if (w) {
      const a = w.spd * 6 * dt;                                 // inward acceleration the player can fight
      player.vel.x += w.ux * a; player.vel.z += w.uz * a;
      if (w.uy > 0.2) player.vel.y += w.uy * a * 0.5;           // gentle lift when the hole is overhead
      const hs = Math.hypot(player.vel.x, player.vel.z);        // safety clamp so it can never fling them
      if (hs > BH_MAXSPD) { const s = BH_MAXSPD / hs; player.vel.x *= s; player.vel.z *= s; }
      if (player.vel.y > 7) player.vel.y = 7;
      if (w.d < BH_CAPTURE && invuln <= 0) damagePlayer(Math.max(1, Math.round(gun.damage * dt * 2)), pos.x, pos.z);
    }
  }
  if (mp.online) for (const { id } of mp.playersNear(pos, R)) { if (friendly(id)) continue; mp.sendHit(id, Math.max(1, Math.round(gun.damage * dt * 2.5))); }
}
const blackHoleHooks = {
  // Detonate early if the singularity reaches a combatant (else it anchors on a block / its range).
  anchorAt: (pos) => {
    for (const m of mobs.list) if (Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z) < 1.5) return true;
    if (isAuthority()) for (const b of botMgr.bots) if (b.alive && Math.hypot(b.pos.x - pos.x, b.pos.y + 1 - pos.y, b.pos.z - pos.z) < 1.5) return true;
    return false;
  },
  onAnchor: (pos) => { sfx.blackhole(); shockShake(pos, 0.6, 34); particles.burst(pos.x, pos.y, pos.z, [180, 130, 255], 30); },
  onField: (pos, dt, gun) => blackHoleField(pos, dt, gun),
  onCollapse: (pos, gun) => {
    // A violent implosion-then-blast: a bright core flash + layered purple/gold debris.
    particles.burst(pos.x, pos.y, pos.z, [255, 255, 255], 46);
    particles.burst(pos.x, pos.y, pos.z, [180, 120, 255], 150);
    particles.burst(pos.x, pos.y, pos.z, [255, 230, 200], 70);
    particles.burst(pos.x, pos.y, pos.z, [120, 80, 220], 60);
    // An expanding ground shock ring of debris (the blast wave rolling outward).
    for (let i = 0; i < 30; i++) { const a = (i / 30) * 6.2832, r = 3.2; particles.burst(pos.x + Math.cos(a) * r, pos.y - 0.4, pos.z + Math.sin(a) * r, [160, 120, 255], 4); }
    sfx.explosionAt(pos.x, pos.y, pos.z);
    shockShake(pos, 1.5, 42);
    explodeDamage(pos, gun.radius * 0.62, gun.splash, 0.4);
    blackHoleBlast(pos, gun);     // fling survivors outward
    blastCover(pos, 5);
  },
};
// The collapse shockwave: everything the singularity didn't swallow gets flung
// violently outward (feeds the new ragdoll death-fling for a clean blow-away).
function blackHoleBlast(pos, gun) {
  const R = gun.radius * 0.95, KB = 26;
  const impulse = (ex, ey, ez, apply) => {
    const dx = ex - pos.x, dy = ey - pos.y, dz = ez - pos.z, d = Math.hypot(dx, dy, dz) || 0.001;
    if (d > R) return;
    const f = (0.35 + 0.65 * (1 - d / R)) * KB;
    apply((dx / d) * f, Math.abs(dy / d) * f * 0.5 + f * 0.45, (dz / d) * f);
  };
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    impulse(b.pos.x, b.pos.y + 1, b.pos.z, (vx, vy, vz) => { b.vel.x += vx; b.vel.y += Math.min(12, vy); b.vel.z += vz; });
  }
  for (const m of mobs.list) impulse(m.pos.x, m.pos.y + m.height * 0.5, m.pos.z, (vx, vy, vz) => { m.vel.x += vx; m.vel.y += Math.min(11, vy); m.vel.z += vz; });
  if ((mode === BATTLE || mode === SURVIVAL) && !dead && !eliminated) {
    impulse(player.pos.x, player.pos.y + 0.9, player.pos.z, (vx, vy, vz) => { player.vel.x += vx; player.vel.y += Math.min(8, vy); player.vel.z += vz; });
  }
}

// Thrown frag explosion.
function grenadeExplode(pos) {
  particles.burst(pos.x, pos.y, pos.z, [255, 170, 70], 40);
  particles.burst(pos.x, pos.y, pos.z, [120, 120, 120], 18);
  sfx.explosionAt(pos.x, pos.y, pos.z);
  shockShake(pos, 0.45, 20);
  explodeDamage(pos, 4.5, 46, 0.5);
  blastCover(pos, 2);
}
function throwGrenade() {
  if (grenadeCount <= 0 || grenadeCD > 0 || !player.locked) return;
  grenadeCount--; grenadeCD = 0.5; hud.setGrenades(grenadeCount);
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const vel = _dir.clone().multiplyScalar(17); vel.y += 3.5;
  const gpos = _eye.clone().addScaledVector(_dir, 0.5);
  grenades.spawn(gpos, vel, 1.6, grenadeExplode);
  broadcastFire('grenade', gpos, vel, { fuse: 1.6 });   // dx/dy/dz carry the throw velocity
  sfx.place();
}

// Quick melee: a fast knife strike with whatever you're holding.
function quickMelee() {
  if (!player.locked || attackCD > 0) return;
  player.eyePosition(_eye); camera.getWorldDirection(_dir);
  const enemy = raycastEnemies(_eye, _dir, MELEE_REACH);
  const mobHit = mobs.raycast(_eye, _dir, MELEE_REACH);
  if (enemy && (!mobHit || enemy.dist <= mobHit.dist) && !friendly(enemy.id)) {
    if (enemy.bot) botHurt(enemy.id, 20, myName(), false); else mp.sendHit(enemy.id, 20);
    const e = _eye.clone().addScaledVector(_dir, enemy.dist);
    particles.burst(e.x, e.y, e.z, [255, 60, 60], 8); hud.hitMarker(false);
  } else if (mobHit) {
    mobHit.mob.hurt(12, player.pos.x, player.pos.z); hud.hitMarker(false);
  }
  vmRecoil = Math.min(1, vmRecoil + 0.4); attackCD = 0.45; sfx.gun('handgun');
}

function plasmaImpact(pos, dmg, hitPlayer) {
  particles.burst(pos.x, pos.y, pos.z, [140, 255, 235], 26);
  let struck = false;
  for (const m of mobs.list) {
    if (Math.hypot(m.pos.x - pos.x, m.pos.y + m.height * 0.5 - pos.y, m.pos.z - pos.z) < 2.3) { m.hurt(dmg, pos.x, pos.z); struck = true; }
  }
  // Arena bots: a direct hit (the bolt detonates on them) plus light splash falloff.
  if (isAuthority()) for (const b of botMgr.bots) {
    if (!b.alive || friendly(b.id)) continue;
    const d = Math.hypot(b.pos.x - pos.x, b.pos.y + 1 - pos.y, b.pos.z - pos.z);
    if (d < 2.3) { botHurt(b.id, Math.max(1, Math.round(dmg * (1 - 0.45 * d / 2.3))), myName(), false); struck = true; }
  }
  if (struck) hud.hitMarker(false);
  if (mp.online) {
    if (hitPlayer && !friendly(hitPlayer)) { mp.sendHit(hitPlayer, dmg); hud.hitMarker(); }
    for (const { id } of mp.playersNear(pos, 2.6)) {       // splash damage (skip teammates)
      if (id === hitPlayer || friendly(id)) continue;
      mp.sendHit(id, Math.round(dmg * 0.6)); hud.hitMarker();
    }
  }
}

function onKill(mob) {
  particles.burst(mob.pos.x, mob.pos.y + mob.height * 0.5, mob.pos.z, [200, 150, 150], 16);
  if (mode === SURVIVAL) for (const d of mob.getDrops()) inventory.add(d.id, d.count);
}

// ---------- Survival tick (hunger / regen) ----------
let cactusCD = 0;
function cactusContact(dt) {
  cactusCD -= dt; if (cactusCD > 0) return;
  const x0 = Math.floor(player.pos.x - 0.34), x1 = Math.floor(player.pos.x + 0.34);
  const z0 = Math.floor(player.pos.z - 0.34), z1 = Math.floor(player.pos.z + 0.34);
  const y0 = Math.floor(player.pos.y + 0.1), y1 = Math.floor(player.pos.y + 1.7);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
    if (world.getBlock(x, y, z) === CACTUS) { damagePlayer(1); cactusCD = 0.5; return; }
  }
}
// Standing in lava (the ruins pit) burns fast — heavy damage-over-time + embers.
let lavaCD = 0;
function lavaContact(dt) {
  lavaCD -= dt;
  const feet = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.2), Math.floor(player.pos.z));
  const shin = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.9), Math.floor(player.pos.z));
  if (!isHot(feet) && !isHot(shin)) return;
  particles.burst(player.pos.x, player.pos.y + 0.6, player.pos.z, [255, 140, 40], 4);
  if (lavaCD > 0) return;
  damagePlayer(4); lavaCD = 0.45; hud.flashHurt();
}
// Authority: burn any bots/mobs caught in lava (knocked into the pit).
function lavaBurnEntities(dt) {
  const hot = (x, y, z) => isHot(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  for (const b of botMgr.bots) {
    if (!b.alive) continue;
    if (hot(b.pos.x, b.pos.y + 0.2, b.pos.z) || hot(b.pos.x, b.pos.y + 0.9, b.pos.z)) {
      b.lavaCD = (b.lavaCD || 0) - dt;
      particles.burst(b.pos.x, b.pos.y + 0.6, b.pos.z, [255, 140, 40], 2);
      if (b.lavaCD <= 0) { botHurt(b.id, 6, null, false); b.lavaCD = 0.4; }
    }
  }
  for (const mb of mobs.list) {
    if (hot(mb.pos.x, mb.pos.y + 0.2, mb.pos.z)) { mb.lavaCD = (mb.lavaCD || 0) - dt; if (mb.lavaCD <= 0) { mb.hurt(6, mb.pos.x, mb.pos.z); mb.lavaCD = 0.4; } }
  }
}
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
  const menuView = !loaded || (atMenu && !player.locked);
  world.update(menuView ? SPAWN.x : player.pos.x, menuView ? SPAWN.z : player.pos.z);
  // While the loading screen is up there's no gameplay to keep smooth, so spend a
  // big per-frame budget on generation/meshing — loads fast even on slow GPUs.
  world.processQueues(loaded ? 6 : 40);
  if (!loaded) updateLoading();

  const active = loaded && player.locked && !inventory.open && !dead && !hud.isChatOpen() && !eliminated && !killCam.active && !deathCam.active;
  // Pausing (Esc) freezes the single-player world; co-op keeps running (can't pause others).
  const frozen = paused && !mp.online;
  const sdt = frozen ? 0 : dt;

  if (loaded && player.locked && !dead) {
    player.update(deathCam.active ? 0 : dt);   // frozen while the death cam plays
    // Fell off the arena into the void → eliminate + respawn.
    if (mode === BATTLE && !deathCam.active && player.pos.y < ARENA.FLOOR - 25) battleDeath();
    if (player.fallImpact > 0) { damagePlayer(Math.ceil(player.fallImpact * 0.6)); player.fallImpact = 0; }
    if (active && player.onGround && Math.hypot(player.vel.x, player.vel.z) > 1.4) {
      const fb = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
      sfx.step(stepCategory(fb));
    }
    // Camera recoil (kick up + horizontal sway) + screen shake.
    recoilPitch *= Math.max(0, 1 - 14 * dt);
    recoilYaw *= Math.max(0, 1 - 10 * dt);
    vmRecoil *= Math.max(0, 1 - 9 * dt);
    camera.rotation.x -= recoilPitch;
    camera.rotation.y += recoilYaw;
    if (shakeAmt > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shakeAmt;
      camera.position.y += (Math.random() - 0.5) * shakeAmt;
      camera.position.z += (Math.random() - 0.5) * shakeAmt * 0.5;
      camera.rotation.z += (Math.random() - 0.5) * shakeAmt * 0.6;
    }
  } else if (menuView) {
    menuCamera(dt);
    hideViewModel();
  } else {
    player.update(0);   // paused (inventory / death) after playing
  }

  if (reloadingGun >= 0) { reloadTimer -= sdt; if (reloadTimer <= 0) { const rg = gunOf(reloadingGun); if (rg) ammo[reloadingGun] = rg.mag; reloadingGun = -1; sfx.place(); } }

  sky.update(sdt);
  hud.setClock(sky.clockString());
  waterTime.value += sdt;

  // Drive mob lighting from the sky. Keep the key light above the horizon so mobs
  // are never lit from below (which looked wrong at night), with a brightness floor.
  _lightDir.copy(sky.sunDir);
  if (_lightDir.y < 0.35) { _lightDir.y = 0.35; _lightDir.normalize(); }
  sun.position.copy(_lightDir).multiplyScalar(100);
  sun.color.copy(sky.dirColor); sun.intensity = Math.max(0.35, sky.dirIntensity);
  ambient.color.copy(sky.dirColor); ambient.intensity = Math.max(0.25, sky.ambIntensity * 0.6);
  hemi.color.copy(sky.uniforms.topColor.value); hemi.intensity = Math.max(0.4, sky.ambIntensity + 0.15);

  mobs.update(loaded && !dead && mode !== BATTLE && !frozen ? dt : 0, player, sky.isNight, {
    damagePlayer, onKill, explode, peaceful: difficulty === PEACEFUL, dmgMul: DMG_MUL[difficulty],
    fire: (x, y, z) => { particles.burst(x, y, z, [255, 150, 40], 2); if (Math.random() < 0.5) particles.burst(x, y, z, [90, 90, 90], 1); },
  });

  // Bots + match flow: the authority simulates; guests render via broadcasts.
  if (mode === BATTLE && loaded) {
    if (!frozen) recordReel(dt);     // roll the kill-cam motion buffer
    // Sharingan: tick the Amaterasu burns + Precognition bullet-time.
    if (!frozen) tickAmaterasu(dt);
    if (precogCD > 0) precogCD -= dt;
    if (precogT > 0) { precogT -= dt; setEnemyXray(true); if (precogT <= 0) { setEnemyXray(false); hud.setPrecog(false); } }
    const botDt = (matchWinner || frozen) ? 0 : (precogT > 0 ? dt * 0.4 : dt);   // enemies move in slow-mo during Precognition
    if (isAuthority()) {
      botSoundBudget = 4;     // cap concurrent bot gunshot sounds this frame
      botMgr.update(botDt, { world, los: losClear, targets: buildTargets(), fire: botFire, coverPoints, arenaFloorY: ARENA.FLOOR });
      if (!frozen) manageBots(dt);
      if (!frozen && arenaTheme === 'ruins' && gameMode !== 'war') lavaBurnEntities(dt);   // ruins pit ring-out
      if (!matchWinner && !frozen) modeTick(dt);
      if (mp.isHost) { botBroadcastT -= dt; if (botBroadcastT <= 0) { botBroadcastT = 0.066; broadcastBotPositions(); } }
    }
    // Gun Game weapon follows your level on every client (host kills are local,
    // guests read their kill count off the synced scoreboard).
    if (gameMode === 'gungame') applyGunGameLevel(false, isAuthority() ? myKills : myBoardKills());
    if (matchOverTimer > 0 && !frozen) { matchOverTimer -= dt; if (matchOverTimer <= 0 && isAuthority()) resetMatch(); }
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

    // Objective readout.
    let info;
    if (gameMode === 'gungame') info = `Gun Game · Level ${Math.min((isAuthority() ? myKills : myBoardKills()), GUNGAME_LADDER.length - 1) + 1}/${GUNGAME_LADDER.length}`;
    else if (gameMode === 'koth') info = `King of the Hill · ${scoreLimit} to win`;
    else if (gameMode === 'br') { const a = botMgr.bots.filter((b) => b.alive).length + (!eliminated && health > 0 ? 1 : 0); info = eliminated ? `Spectating · ${a} alive` : `Battle Royale · ${a} alive · zone ${Math.round(zoneRadius)}m`; }
    else if (gameMode === 'wave') info = `Wave ${waveNum}/${WAVE_TARGET} · ${botMgr.bots.filter((b) => b.alive).length} left`;
    else if (gameMode === 'war') {
      const role = myTeam === WAR_ALLIED ? '🪖 Allied' : '🛡 Axis';
      const t = Math.max(0, warTimer), mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      info = `D-Day · ${role} · Beachhead ${Math.floor(warCapture)}% · ${mm}:${String(ss).padStart(2, '0')} left`;
      hud.setScoreboard(board, teamMode, scoreLimit, myTeam, warTeamInfo());   // keep the scoreboard title's clock live while Tab is held
    }
    else info = `Deathmatch · first to ${scoreLimit}`;
    hud.setModeInfo(info);
  } else hud.setModeInfo(null);

  // Interaction
  invuln -= sdt; protect -= sdt; breakCD -= sdt; placeCD -= sdt; attackCD -= sdt; fireCD -= sdt; fire2CD -= sdt;  // sdt freezes these on a single-player pause
  const gun = gunOf(inventory.selectedId());
  const lmb = mouseLeft || keyBreak, rmb = mouseRight || keyPlace;   // Q/F are keyboard stand-ins for the mouse buttons
  // Chakra jutsu: hold to gather chakra (charge), release to unleash. Cancel the charge
  // whenever we're not actively holding a charge weapon.
  if (!(active && gun && gun.charge)) { chargeT = 0; vmCharge = 0; }
  if (!(active && gun && gun.kind === 'beam' && (mouseLeft || keyBreak))) { if (laser.group.visible) laser.set(false); if (beamSnd) { sfx.beamStop(); beamSnd = false; } }
  if (!(active && gun && gun.kind === 'sharingan' && (mouseLeft || keyBreak))) { if (sharinganFx.group.visible) sharinganFx.set(false); gazeTargetId = null; gazeHold = 0; }
  if (active && gun) {
    resetBreak();
    const id = inventory.selectedId();
    if (gun.charge) {
      if (chargeGunId !== id) { chargeT = 0; chargeGunId = id; }   // switched weapon mid-charge
      const reloading = gun.mag && reloadingGun === id;
      const empty = gun.mag && ammoFor(gun, id) <= 0;
      if (lmb && !reloading && !empty) {                            // can't gather while empty/reloading
        const was = chargeT;
        chargeT = Math.min(gun.charge, chargeT + dt);
        if (was === 0 && chargeT > 0) sfx.chakraCharge();           // rising hum on gather start
        if (was < gun.charge && chargeT >= gun.charge) sfx.chakraReady();  // ping at full charge
      } else if (!lmb && chargeT > 0.06) {
        const fired = releaseCharge(gun, Math.min(1, chargeT / gun.charge)); chargeT = 0;
        if (fired && gun.mag) { ammo[id]--; if (ammoFor(gun, id) <= 0) startReload(gun, id); }   // only spend ammo if it actually fired
      } else { chargeT = 0; if (empty && !reloading) startReload(gun, id); }
      vmCharge = chargeT / gun.charge;
    }
    // Laser cannon: pour a continuous beam while held (drains a heat battery).
    else if (gun.kind === 'beam') {
      const reloading = gun.mag && reloadingGun === id;
      if (lmb && !reloading && ammoFor(gun, id) > 0) fireBeam(gun, id, dt);
      else { laser.set(false); sfx.beamStop(); if (lmb && !reloading) startReload(gun, id); }
    }
    // Sharingan: RMB = Precognition (bullet-time); LMB = the gaze (Amaterasu + Genjutsu).
    else if (gun.kind === 'sharingan') {
      if (rmb && precogCD <= 0 && precogT <= 0 && (gameMode === 'gungame' || chakraEnergy >= gun.precogCost)) activatePrecog(gun);
      if (lmb && (gameMode === 'gungame' || chakraEnergy > 0)) sharinganGaze(gun, dt);
      else { gazeTargetId = null; gazeHold = 0; sharinganFx.set(false); }
    }
    // Auto guns fire while held; the rest fire once per click.
    else if (lmb && fireCD <= 0 && (gun.auto || !triggerConsumed)) {
      if (gun.mag && reloadingGun === id) { /* busy reloading */ }
      else if (gun.mag && ammoFor(gun, id) <= 0) { startReload(gun, id); fireCD = 0.25; triggerConsumed = true; }
      else {
        fireGun(gun, false);
        if (gun.mag) ammo[id]--;
        // Per-gun recoil: vertical kick, a little horizontal sway, viewmodel kickback.
        const rc = gun.recoil || 0.015;
        muzzle.flash();
        // ADS reduces vertical recoil; recoil also kicks the viewmodel.
        recoilPitch += rc * (1 - adsAmount * 0.45);
        recoilYaw += (Math.random() - 0.5) * rc * 0.9 * (1 - adsAmount * 0.6);
        vmRecoil = Math.min(1, vmRecoil + 0.5 + rc * 4);
        addShake(Math.min(0.1, rc * 0.9));
        fireCD = gun.rate;
        if (!gun.auto) triggerConsumed = true;
      }
    }
    if (gun.kind === 'portal' && rmb && fire2CD <= 0) { fireGun(gun, true); vmRecoil = Math.min(1, vmRecoil + 0.3); fire2CD = gun.rate; }
  } else if (active) {
    if (lmb) attackOrBreak(dt); else resetBreak();
    if (rmb && placeCD <= 0) { handleUse(); placeCD = 0.25; }
  }
  setScoped(active && !!gun && !!gun.zoom && rmb);

  // ---- Chakra reserve: hold C to channel (the Naruto power-up), else slow regen. ----
  const chakraOn = (mode === BATTLE || mode === CREATIVE);
  const channelling = active && chargingChakra && chakraOn;
  if (channelling && !chakraSnd) { sfx.chakraChannelStart(); chakraSnd = true; }
  if (!channelling && chakraSnd) { sfx.chakraChannelStop(); chakraSnd = false; }
  if (channelling) {
    chakraEnergy = Math.min(CHAKRA_MAX, chakraEnergy + CHAKRA_CHANNEL * sdt);
    chakraAuraI += (1 - chakraAuraI) * Math.min(1, 8 * sdt);
    sfx.chakraChannelRamp(chakraEnergy / CHAKRA_MAX);
    addShake(0.02 + 0.05 * chakraAuraI);
    if (Math.random() < 0.7) { const a = Math.random() * 6.2832, r = 0.6 + Math.random() * 0.5;
      particles.burst(player.pos.x + Math.cos(a) * r, player.pos.y + 0.15, player.pos.z + Math.sin(a) * r, [120, 200, 255], 2); }
    if (chakraEnergy >= CHAKRA_MAX && chakraBurstReady) { chakraPowerBurst(); chakraBurstReady = false; }
  } else {
    if (chakraOn) chakraEnergy = Math.min(CHAKRA_MAX, chakraEnergy + CHAKRA_REGEN * sdt);
    chakraAuraI += (0 - chakraAuraI) * Math.min(1, 8 * sdt);
  }
  if (chakraEnergy < CHAKRA_MAX - 1) chakraBurstReady = true;   // re-arm the peak shockwave
  chakra.updateAura(player.pos, chakraAuraI, sdt);
  if (chakraOn) { hud.setChakra(chakraEnergy / CHAKRA_MAX, chakraEnergy >= CHAKRA_MAX - 0.5); hud.setChakraAura(chakraAuraI * 0.85); }

  if (active) survivalTick(dt, Math.hypot(player.vel.x, player.vel.z) > 1.2);
  if (active && (mode === SURVIVAL || mode === BATTLE)) cactusContact(dt);   // brushing a cactus hurts (each client damages itself → co-op safe)
  if (active && (mode === SURVIVAL || mode === BATTLE) && invuln <= 0) lavaContact(dt);   // standing in lava burns

  // Aim-down-sights (every non-scope gun) + animated viewmodel.
  const adsActive = active && gun && !gun.zoom && gun.kind !== 'portal' && mouseRight;
  adsAmount += ((adsActive ? 1 : 0) - adsAmount) * Math.min(1, 13 * dt);
  if (adsAmount < 0.002) adsAmount = 0;
  if (!zoomed) { const f = player.fov * (1 - 0.17 * adsAmount); if (Math.abs(camera.fov - f) > 0.04) { camera.fov = f; camera.updateProjectionMatrix(); } }
  crosshairEl.classList.toggle('ads', adsAmount > 0.5);
  if (!menuView) { updateViewModel(); animateViewModel(dt); }

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
  const enemyBots = isAuthority() ? botMgr.bots : null;   // bolts/rockets collide with arena bots
  plasmas.update(sdt, world, mobs, enemyBots, mp, portals, plasmaImpact);
  rockets.update(sdt, world, mobs, enemyBots, mp, portals, rocketImpact);
  blackholes.update(sdt, world, blackHoleHooks);
  // Curve the player's in-flight Rasenshuriken toward where they're aiming (sweep your view to bend it).
  chakraHooks.guideDir = (active && !dead) ? camera.getWorldDirection(_guideDir) : null;
  chakra.update(sdt, world, chakraHooks);
  laser.update(dt); hollowPurple.update(sdt); cleaveFx.update(sdt); sharinganFx.update(dt);
  grenades.update(sdt, world);
  grenadeCD -= sdt;
  portals.update(dt, portalBodies());
  mp.update(dt);
  // Keep broadcasting in-game even while dead so peers can hide our avatar (alive flag);
  // only the home menu suppresses it.
  if (loaded && !atMenu) mp.sendPos({ x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, alive: !dead && !eliminated, wep: gunOf(inventory.selectedId()) ? inventory.selectedId() : 0, ch: +chakraAuraI.toFixed(2) });

  // Feel: decay shake + multikill window; update the 3D-audio listener (camera).
  shakeAmt *= Math.max(0, 1 - 9 * dt);
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }
  updateDyingAvatars(dt);   // topple/fade dying avatars
  updateAfterImages(dt);    // fade flash-step silhouettes
  if (flashCD > 0) flashCD -= dt;
  if (flashCharges < FLASH_MAX) { flashRegen += dt; if (flashRegen >= FLASH_REGEN) { flashRegen = 0; flashCharges++; } }
  updateDeathCam(dt);       // your-death cam (tap to skip)
  updateKillCam(dt);        // takes over the camera for the Gun Game final-kill cam
  camera.getWorldDirection(_camFwd);
  sfx.setListener(camera.position.x, camera.position.y, camera.position.z, _camFwd.x, _camFwd.z);

  particles.update(dt);
  damageNumbers.update(dt);
  updateLens();             // warp space around any active black holes
  composer.render();
  stats.end();
}
const TIPS = [
  'Press G for Creative to grab the guns', 'Right-click a stack to split it in half',
  'Build a Crafting Table for tools', 'Creepers explode — keep your distance',
  'Host a co-op game from the menu and share the code', 'Portal Gun: left-click + right-click two portals',
  'Right-click the sniper to look down the scope', 'Different ground makes different footstep sounds',
  '⚔ Battle mode drops you into an arena to fight other players', 'In co-op you can damage other players — watch the kill feed',
  'Hold C to charge your chakra — it powers the Rasengan & Rasenshuriken', 'Max your chakra to unleash a shockwave that blasts enemies back',
];
setInterval(() => { const el = document.getElementById('loadingTip'); if (el && !loaded) el.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 2200);

startWorld();
frame();

window.__game = {
  world, player, sky, scene, renderer, camera, mobs, inventory, mp, botMgr, tracers, plasmas, rockets, blackholes, blackHoleHooks, chakra, chakraHooks, rasenshurikenImpact, laser, hollowPurple, portals,
  crackMesh, crackMat, CRACK_TEXTURES, edits,
  toggleMode, applyDifficulty, openInventory, newWorld, loadWorld,
  enterBattle: () => { menuMode = BATTLE; startSelectedMode(currentSeedStr, true); },
  damagePlayer, hud, myName, plasmaImpact, rocketImpact, explodeDamage,
  get loaded() { return loaded; },
  get arena() { return arena; },
  get state() { return { mode, difficulty, diffName: DIFF_NAMES[difficulty], health, hunger, dead, arena }; },
  get battleState() { return { gameMode, matchWinner, myTeam, warSide, warTickets, warTimer, warCapture, matchOverTimer, eliminated, invuln, protect: +protect.toFixed(2), myKills, myDeaths, health, flying: player.flying, mode }; },
  __testFire: (id) => fireGun(gunOf(id)),
  __setWar: (o) => { if (o.timer !== undefined) warTimer = o.timer; if (o.tickets !== undefined) warTickets = o.tickets; if (o.capture !== undefined) warCapture = o.capture; },
  __trigger: (down) => { mouseLeft = !!down; triggerConsumed = false; },   // drive the charge-up loop in tests
  __trigger2: (down) => { mouseRight = !!down; },                          // drive secondary fire (precognition) in tests
  __channel: (on) => { chargingChakra = !!on; },                           // simulate holding C in tests
  __break: (x, y, z) => breakBlock(x, y, z, false),                        // test hook: break a block (runs water-fill)
  __cactusContact: (dt) => cactusContact(dt),
  __endMatch: (w) => endMatch(w),                       // test hook: force a round win
  __loadArena: (theme) => { menuMode = BATTLE; setGameMode(BATTLE); loadWorld(currentSeedStr || 'test', 'arena', theme); sky.setArena(true); sky.setWar(false); atMenu = false; everPlayed = true; refreshOverlays(); },
  get arenaTheme() { return arenaTheme; },
  get gunGameLadder() { return GUNGAME_LADDER.slice(); },
  get killCam() { return { active: killCam.active, mode: killCam.mode, t: killCam.t, dur: killCamDur, replay: replay.active, pass: replay.pass, holding: replay.holding, reel: killReel.length }; },
  get deathCamState() { return { active: deathCam.active, t: +deathCam.t.toFixed(2), dur: deathCam.dur, killer: deathCam.killer, hasCorpse: !!deathCam.corpse }; },
  get settings() { return settings; },
  __dyingCount: () => dyingAvatars.length,
  __spawnBlackHole: () => { player.eyePosition(_eye); _dir.set(0.15, -0.12, -1).normalize(); const gun = gunOf(BLACK_HOLE_BOMB); blackholes.spawn(_eye.clone(), _dir.clone(), gun, mp.myId || 'me'); return { radius: gun.radius, duration: gun.duration, pull: gun.pull, damage: gun.damage, splash: gun.splash }; },
  get lensState() { return { on: lensPass.enabled, count: lensPass.uniforms.uCount.value, r: +lensPass.uniforms.uParams.value[0].x.toFixed(3), s: +lensPass.uniforms.uParams.value[0].y.toFixed(2) }; },
  __forceTheme: (t) => { _forceTheme = t; },
  get lobbyInfo() { return { active: lobby.active, host: lobby.host, code: mp.roomCode, players: [...lobby.players.entries()].map(([id, p]) => ({ id, name: p.name, team: p.team, ready: p.ready })), myTeam, teamMode, teams: [...teamAssign.entries()] }; },
  __lobbyReq: (id, name, team, ready) => onLobbyReq(id, name, team, ready),
  __lobbyState: (d) => onLobbyState(d),
  __flashStep: (code) => { const before = player.pos.clone(); flashStep(code || 'KeyW'); return { moved: +player.pos.distanceTo(before).toFixed(2), charges: flashCharges, afterImages: afterImages.length }; },
  get flashState() { return { charges: flashCharges, max: FLASH_MAX, cd: +flashCD.toFixed(2), afterImages: afterImages.length }; },
  __warDebug: () => {
    const targets = buildTargets(); const out = [];
    for (const b of botMgr.bots) {
      if (b.team !== WAR_AXIS) continue;
      b.eye(_botEye);
      let nearest = Infinity, nT = null, anyLoS = false;
      for (const t of targets) {
        if (!t.alive || t.id === b.id || t.team === b.team) continue;
        const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
        if (losClear(_botEye.x, _botEye.y, _botEye.z, t.pos.x, t.pos.y + 1.62, t.pos.z)) anyLoS = true;
        if (d < nearest) { nearest = d; nT = t; }
      }
      let block = null, tpos = null;
      if (nT) {
        tpos = [+nT.pos.x.toFixed(1), +nT.pos.y.toFixed(1), +nT.pos.z.toFixed(1)];
        const tx = nT.pos.x, ty = nT.pos.y + 1.62, tz = nT.pos.z;
        const dx = tx - _botEye.x, dy = ty - _botEye.y, dz = tz - _botEye.z, len = Math.hypot(dx, dy, dz);
        const hit = voxelRaycast(_los.set(_botEye.x, _botEye.y, _botEye.z), _losDir.set(dx / len, dy / len, dz / len), len - 0.6, (x, y, z) => world.getBlock(x, y, z));
        if (hit.hit) block = [hit.x, hit.y, hit.z];
      }
      out.push({ pos: [+b.pos.x.toFixed(1), +b.pos.y.toFixed(1), +b.pos.z.toFixed(1)], eye: +_botEye.y.toFixed(1),
        anchor: b.anchor ? [+b.anchor.x.toFixed(1), +b.anchor.z.toFixed(1)] : null, ammo: b.ammo, alive: b.alive,
        nearestDist: +nearest.toFixed(1), nearestPos: tpos, blockedAt: block, anyLoS });
    }
    return out;
  },
  __killSelf: (killer) => { lastHitBy = killer || 'Tester'; lastHitTime = performance.now() / 1000; battleDeath(); },
  __skipDeathCam: () => skipDeathCam(),
  get sharingan() { return { precogT: +precogT.toFixed(2), precogCD: +precogCD.toFixed(2), burns: amaBurn.size, gazeHold: +gazeHold.toFixed(2), gazeId: gazeTargetId, fx: sharinganFx.group.visible }; },
  __reelLen: () => killReel.length,
  __reelKeys: () => { const s = new Set(); for (const fr of killReel) for (const k in fr.a) s.add(k); return [...s]; },
  __forceReplayKill: (killerName, killerKey, victimName, victimKey) => { lastKill.killer = killerName; lastKill.victim = victimName; lastKill.killerKey = killerKey; lastKill.victimKey = victimKey; lastKill.at = performance.now() / 1000; },
  get vmCharge() { return vmCharge; },
  get chakraEnergy() { return chakraEnergy; },
  set chakraEnergy(v) { chakraEnergy = v; },
  get viewModel() { return viewModel; },
};
