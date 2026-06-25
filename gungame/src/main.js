// GunGame — entry point. Wires the renderer, world, player, weapons, bots, FX, HUD and
// the game loop together.
import * as THREE from 'three';
import { createRenderer, createComposer } from './engine/renderer.js';
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

createSky(scene, renderer);
const arena = buildArena(scene);
const post = createComposer(renderer, scene, camera, { ssao: false });

const input = new Input(renderer.domElement);
const audio = new Audio();
const fx = new Fx(scene);
const hud = new Hud();
const controller = new Controller();
const weapons = new Weapons(camera, scene, fx);
const bots = new Bots(scene, fx, arena, 6);
bots.targetMeshes = [arena.group];

// --- game state ---
const game = { playing: false, health: 100, score: 0, foeScore: 0, respawnT: 0, fov: 78, baseFov: 78 };

function spawnPlayer() {
  // farthest spawn from any bot
  let best = arena.spawns[0], bd = -1;
  for (const s of arena.spawns) {
    let m = 1e9; for (const b of bots.list) if (b.alive) m = Math.min(m, (b.pos.x - s.x) ** 2 + (b.pos.z - s.z) ** 2);
    if (m > bd) { bd = m; best = s; }
  }
  controller.spawn({ x: best.x, y: 0, z: best.z }, Math.atan2(-(0 - best.x), -(0 - best.z)));
  controller.alive = true; game.health = 100; hud.setHealth(100);
}

// player takes damage from bots
bots.onHitPlayer = (dmg) => {
  if (!controller.alive) return;
  game.health -= dmg; hud.hurt(); audio.hurt();
  if (game.health <= 0) { game.health = 0; controller.alive = false; game.respawnT = 2.2; hud.setHealth(0); hud.toast('YOU DIED', '#ff5b5b'); game.foeScore++; hud.setScore(game.score, game.foeScore); }
  else hud.setHealth(game.health);
};
// player bullets hit a bot
weapons.onHit = (bot, dmg, head, point) => {
  hud.hit(head); audio.hit(head);
  const killed = bot.hurt(dmg, head, fx);
  if (killed) { game.score++; hud.setScore(game.score, game.foeScore); hud.kill('You eliminated ' + bot.name, '#36d1ff'); audio.kill(); }
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
