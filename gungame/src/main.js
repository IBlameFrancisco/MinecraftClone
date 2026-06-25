// GunGame — entry point. Wires the renderer, world, player, weapons, bots, FX, HUD and
// the game loop together.
import * as THREE from 'three';
import { createRenderer, createComposer } from './engine/renderer.js';
import { loadAssets } from './engine/assets.js';
import { createSky } from './engine/sky.js';
import { Input } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { buildArena } from './world/arena.js';
import { Controller } from './player/controller.js';
import { Weapons } from './player/weapons.js';
import { Bots } from './ai/bots.js';
import { Fx } from './fx/fx.js';
import { Hud } from './ui/hud.js';

const container = document.getElementById('app');
const renderer = createRenderer(container);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 1000);
scene.add(camera);

// Real assets (HDRI + PBR textures) must be ready before we build any materials/scene.
const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.classList.remove('hidden');
await loadAssets(renderer);

createSky(scene, renderer);
const arena = buildArena(scene);
const post = createComposer(renderer, scene, camera, { ssao: false });

const input = new Input(renderer.domElement);
const audio = new Audio();
const fx = new Fx(scene);
const hud = new Hud();
const controller = new Controller();
const weapons = new Weapons(camera, scene, fx);
// You're on BLUE: 3 blue squadmates fight alongside you against 4 red enemies.
const bots = new Bots(scene, fx, arena, { red: 4, blue: 3 });
bots.targetMeshes = [arena.group];

// --- game state (team deathmatch: first to WIN_SCORE) ---
const WIN_SCORE = 25;
const game = { playing: false, health: 100, blue: 0, red: 0, respawnT: 0, fov: 78, baseFov: 78 };

function awardKill(team) {
  game[team]++;
  hud.setScore(game.blue, game.red);
  if (game[team] >= WIN_SCORE) {
    hud.toast((team === 'blue' ? 'BLUE' : 'RED') + ' TEAM WINS', team === 'blue' ? '#36d1ff' : '#ff5b5b');
    game.blue = 0; game.red = 0; hud.setScore(0, 0);
  }
}

function spawnPlayer() {
  // farthest spawn from any RED enemy
  let best = arena.spawns[0], bd = -1;
  for (const s of arena.spawns) {
    let m = 1e9; for (const b of bots.list) if (b.alive && b.team === 'red') m = Math.min(m, (b.pos.x - s.x) ** 2 + (b.pos.z - s.z) ** 2);
    if (m > bd) { bd = m; best = s; }
  }
  controller.spawn({ x: best.x, y: 0, z: best.z }, Math.atan2(-(0 - best.x), -(0 - best.z)));
  controller.alive = true; game.health = 100; hud.setHealth(100);
}

// the player (BLUE) takes damage from red bots
bots.onHitPlayer = (dmg) => {
  if (!controller.alive) return;
  game.health -= dmg; hud.hurt(); audio.hurt();
  if (game.health <= 0) { game.health = 0; controller.alive = false; game.respawnT = 2.2; hud.setHealth(0); hud.toast('YOU DIED', '#ff5b5b'); awardKill('red'); }
  else hud.setHealth(game.health);
};
// a bot killed another bot (ally or enemy) — credit the killer's team
bots.onUnitKilled = (killerTeam, victim) => {
  awardKill(killerTeam);
  const dead = killerTeam === 'red' ? 'blue' : 'red';
  if (dead === 'blue') hud.kill(victim.name + ' was eliminated', '#9fb6c8');   // an ally fell
};
// player bullets hit an enemy (red only — friendly fire off via target filtering)
weapons.onHit = (bot, dmg, head, point) => {
  hud.hit(head); audio.hit(head);
  const killed = bot.hurt(dmg, head, fx);
  if (killed) { awardKill('blue'); hud.kill('You eliminated ' + bot.name, '#36d1ff'); audio.kill(); }
};
weapons.onAmmo = (name, mag, reserve) => hud.setAmmo(name, mag, reserve);
weapons.onShoot = (kind) => audio.shoot(kind);

// --- menu / pointer lock ---
const menu = document.getElementById('menu');
const pause = document.getElementById('pause');
const loading = document.getElementById('loading');
document.getElementById('playBtn').addEventListener('click', () => { audio.ensure(); start(); });
renderer.domElement.addEventListener('click', () => { if (game.playing && !input.locked) input.lock(); });
input.onLockChange = (locked) => { pause.classList.toggle('show', game.playing && !locked); };

function start() {
  menu.classList.add('hidden');
  if (!game.started) { game.started = true; spawnPlayer(); game.playing = true; }
  game.playing = true;
  input.lock();
}

// --- resize ---
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); post.setSize(window.innerWidth, window.innerHeight);
});

// --- loop ---
let prev = performance.now();
loading.classList.add('hidden');
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (game.playing && input.locked) {
    // respawn timer
    if (!controller.alive) { game.respawnT -= dt; if (game.respawnT <= 0) spawnPlayer(); }
    if (controller.alive) controller.update(dt, input, arena);
    // ADS (right mouse): narrow FOV, recenter the gun a touch
    const targetFov = input.rightDown ? 58 : game.baseFov;
    game.fov += (targetFov - game.fov) * Math.min(1, 10 * dt);
    if (Math.abs(camera.fov - game.fov) > 0.01) { camera.fov = game.fov; camera.updateProjectionMatrix(); }

    weapons.setTargets([arena.group, ...bots.hitMeshes()]);
    weapons.update(dt, input, controller);
    bots.update(dt, controller);
    fx.update(dt);
    hud.update(dt);

    controller.applyCamera(camera);
    // apply recoil + weapon kick on top of the look
    camera.rotation.x += weapons.recoilPitch; camera.rotation.y += weapons.recoilYaw;
  }
  post.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose a tiny test harness
window.__gg = { scene, camera, controller, weapons, bots, arena, game, input,
  __start: () => { audio.ensure(); start(); },
  __aim: (yaw, pitch) => { controller.yaw = yaw; controller.pitch = pitch; },
  __shoot: () => { weapons.setTargets([arena.group, ...bots.hitMeshes()]); controller.applyCamera(camera); scene.updateMatrixWorld(true); weapons.testFire(controller); },
};
