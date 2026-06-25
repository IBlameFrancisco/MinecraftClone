// GunGame — entry point. Wires the renderer, world, player, weapons, bots, FX, HUD, the
// Match framework (modes + flow + scoring) and the game loop together.
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
import { Match, MODES, DIFFICULTY } from './game/match.js';

const container = document.getElementById('app');
const renderer = createRenderer(container);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 1000);
scene.add(camera);

const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.classList.remove('hidden');
await loadAssets(renderer);

createSky(scene, renderer);
const arena = buildArena(scene);
const post = createComposer(renderer, scene, camera, { ao: true });

const input = new Input(renderer.domElement);
const audio = new Audio();
const fx = new Fx(scene);
const hud = new Hud();
const controller = new Controller();
const weapons = new Weapons(camera, scene, fx);
const bots = new Bots(scene, fx, arena);
bots.targetMeshes = [arena.group];

// --- player/game state ---
const game = { playing: false, started: false, health: 100, respawnT: 0, fov: 78, baseFov: 78 };

// --- match framework ---
const match = new Match({
  hud,
  onStart: (mode, diff) => {
    bots.setup(mode, diff, match);
    weapons.reset();
    game.health = diff.id === 'hard' ? 100 : 100;
    spawnPlayer(true);
  },
  onEnd: (m, winner) => showEndScreen(m, winner),
});

function playerObj() { return { pos: controller.pos, eye: controller.eye, alive: controller.alive, team: match.playerTeam }; }

function spawnPlayer(fresh) {
  // farthest spawn from the nearest hostile bot
  let best = arena.spawns[0], bd = -1;
  for (const s of arena.spawns) {
    let m = 1e9;
    for (const b of bots.list) if (b.alive && b.team !== match.playerTeam) m = Math.min(m, (b.pos.x - s.x) ** 2 + (b.pos.z - s.z) ** 2);
    if (m > bd) { bd = m; best = s; }
  }
  controller.spawn({ x: best.x, y: 0, z: best.z }, Math.atan2(-(0 - best.x), -(0 - best.z)));
  controller.alive = true; game.health = 100; hud.setHealth(100);
}

// --- damage / scoring callbacks ---
bots.onHitPlayer = (dmg, dir, killer) => {
  if (!controller.alive || match.state !== 'live') return;
  game.health -= dmg; hud.hurt(); audio.hurt();
  if (game.health <= 0) {
    game.health = 0; controller.alive = false; game.respawnT = 2.2; hud.setHealth(0);
    hud.toast('YOU DIED', '#ff5b5b'); audio.announce('death');
    match.award(killer ? killer.team : 'red');
  } else hud.setHealth(game.health);
};
bots.onUnitKilled = (killerTeam, victim) => {
  match.award(killerTeam);
  const label = match.names.get(killerTeam) || killerTeam;
  hud.kill(`${victim.name} fell`, '#9fb6c8');
};
bots.onBotShoot = (muzzle, b) => audio.shootAt(muzzle, 'rifle');

weapons.onHit = (bot, dmg, head, point) => {
  hud.hit(head); audio.hit(head);
  const killed = bot.hurt(dmg, head, fx);
  if (killed) {
    match.award(match.playerTeam);
    hud.kill('You eliminated ' + bot.name, '#36d1ff'); audio.kill();
    if (head) audio.announce('headshot');
  }
};
weapons.onAmmo = (name, mag, reserve) => hud.setAmmo(name, mag, reserve);
weapons.onShoot = (kind) => audio.shoot(kind);

// --- menu: mode + difficulty selection ---
const menu = document.getElementById('menu');
const pause = document.getElementById('pause');
const loading = document.getElementById('loading');
const endscreen = document.getElementById('endscreen');
let pickedMode = 'tdm', pickedDiff = 'normal';

function wireChips(containerId, attr, onPick) {
  const el = document.getElementById(containerId);
  el.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    el.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
    chip.classList.add('sel'); onPick(chip.getAttribute(attr)); audio.ensure(); audio.ui();
  }));
}
wireChips('modeChips', 'data-mode', (m) => { pickedMode = m; });
wireChips('diffChips', 'data-diff', (d) => { pickedDiff = d; });

document.getElementById('playBtn').addEventListener('click', () => { audio.ensure(); startMatch(); });
document.getElementById('rematchBtn').addEventListener('click', () => { endscreen.classList.remove('show'); startMatch(); });
document.getElementById('menuBtn').addEventListener('click', () => { endscreen.classList.remove('show'); menu.classList.remove('hidden'); game.playing = false; });
renderer.domElement.addEventListener('click', () => { if (game.playing && !input.locked) input.lock(); });
input.onLockChange = (locked) => { pause.classList.toggle('show', game.playing && match.state !== 'ended' && !locked); };

function startMatch() {
  menu.classList.add('hidden'); endscreen.classList.remove('show');
  match.configure(pickedMode, pickedDiff);
  audio.matchStart(match.mode);
  match.begin();
  game.started = true; game.playing = true;
  input.lock();
}

function showEndScreen(m, winner) {
  game.playing = false;
  const won = m.playerWon(winner);
  document.getElementById('endRes').textContent = won ? 'VICTORY' : 'DEFEAT';
  document.getElementById('endRes').className = 'res ' + (won ? 'win' : 'lose');
  document.getElementById('endSub').textContent = m.mode.name;
  const st = document.getElementById('standings');
  st.innerHTML = m.standings().map((r, i) =>
    `<div class="row${r.you ? ' me' : ''}"><span><span class="rk">${i + 1}</span>${r.label}</span><span>${r.score}</span></div>`).join('');
  endscreen.classList.add('show');
  audio.announce(won ? 'victory' : 'defeat');
  if (input.locked) document.exitPointerLock();
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); post.setSize(window.innerWidth, window.innerHeight);
});

// --- loop ---
let prev = performance.now();
loading.classList.add('hidden');
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  const live = game.playing && match.state === 'live';
  if (game.playing && input.locked) {
    match.update(dt);
    if (!controller.alive) { game.respawnT -= dt; if (game.respawnT <= 0) spawnPlayer(); }
    if (controller.alive) controller.update(dt, input, arena);

    const targetFov = input.rightDown ? 58 : game.baseFov;
    game.fov += (targetFov - game.fov) * Math.min(1, 10 * dt);
    if (Math.abs(camera.fov - game.fov) > 0.01) { camera.fov = game.fov; camera.updateProjectionMatrix(); }

    if (live) {
      weapons.setTargets([arena.group, ...bots.hitMeshesHostileTo(match.playerTeam)]);
      weapons.update(dt, input, controller);
      bots.update(dt, playerObj());
    }
    fx.update(dt);
    hud.update(dt);
    audio.setListener(camera);

    controller.applyCamera(camera);
    camera.rotation.x += weapons.recoilPitch; camera.rotation.y += weapons.recoilYaw;
  }
  post.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// test harness
window.__gg = {
  scene, camera, controller, weapons, bots, arena, game, input, post, match,
  __start: (mode = 'tdm', diff = 'normal') => { audio.ensure(); pickedMode = mode; pickedDiff = diff; startMatch(); },
  __aim: (yaw, pitch) => { controller.yaw = yaw; controller.pitch = pitch; },
  __shoot: () => { weapons.setTargets([arena.group, ...bots.hitMeshesHostileTo(match.playerTeam)]); controller.applyCamera(camera); scene.updateMatrixWorld(true); weapons.testFire(controller); },
};
