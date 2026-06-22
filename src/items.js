// Non-block items (food, materials, tools). Item ids start at ITEM_BASE so one
// integer id flows through inventory/crafting/hotbar whether it's a block
// (id < ITEM_BASE) or an item. Tools carry mining/damage metadata.

import { BLOCKS, AIR } from './blocks.js';

export const ITEM_BASE = 256;
export const STICK = 256;
export const APPLE = 257;
export const PORKCHOP = 258;
export const BEEF = 259;
export const MUTTON = 260;
export const ROTTEN_FLESH = 261;
export const LEATHER = 262;
export const COAL = 263;
export const WOOD_PICKAXE = 264;
export const WOOD_AXE = 265;
export const WOOD_SHOVEL = 266;
export const WOOD_SWORD = 267;
export const STONE_PICKAXE = 268;
export const STONE_AXE = 269;
export const STONE_SHOVEL = 270;
export const STONE_SWORD = 271;
export const ARROW = 272;
export const HANDGUN = 273;
export const SNIPER = 274;
export const PLASMA_GUN = 275;
export const PORTAL_GUN = 276;
export const SMG = 277;
export const ASSAULT_RIFLE = 278;
export const SHOTGUN = 279;
export const ROCKET_LAUNCHER = 280;
export const RAILGUN = 281;
export const BLACK_HOLE_BOMB = 282;
export const HEAVY_MG = 283;
export const RASENGAN = 284;
export const RASENSHURIKEN = 285;
export const LASER_CANNON = 286;
export const HOLLOW_PURPLE = 287;

export const GUNS = [HANDGUN, SMG, ASSAULT_RIFLE, SHOTGUN, SNIPER, RAILGUN, PLASMA_GUN, ROCKET_LAUNCHER, BLACK_HOLE_BOMB, HEAVY_MG, RASENGAN, RASENSHURIKEN, LASER_CANNON, HOLLOW_PURPLE, PORTAL_GUN];

// Tool metadata. speed = mining-time divisor on matching blocks; damage = melee.
function tool(type, tier) {
  const speed = tier === 1 ? 4 : 6;
  const dmg = { sword: [0, 5, 7], axe: [0, 4, 6], pickaxe: [0, 3, 4], shovel: [0, 2, 3] };
  return { tool: type, tier, speed, damage: dmg[type][tier] };
}

export const ITEMS = {
  [STICK]:        { name: 'Stick' },
  [APPLE]:        { name: 'Apple', food: 4 },
  [PORKCHOP]:     { name: 'Porkchop', food: 4 },
  [BEEF]:         { name: 'Raw Beef', food: 3 },
  [MUTTON]:       { name: 'Raw Mutton', food: 3 },
  [ROTTEN_FLESH]: { name: 'Rotten Flesh', food: 2 },
  [LEATHER]:      { name: 'Leather' },
  [COAL]:         { name: 'Coal' },
  [ARROW]:        { name: 'Arrow' },
  [WOOD_PICKAXE]: { name: 'Wooden Pickaxe', ...tool('pickaxe', 1) },
  [WOOD_AXE]:     { name: 'Wooden Axe', ...tool('axe', 1) },
  [WOOD_SHOVEL]:  { name: 'Wooden Shovel', ...tool('shovel', 1) },
  [WOOD_SWORD]:   { name: 'Wooden Sword', ...tool('sword', 1) },
  [STONE_PICKAXE]:{ name: 'Stone Pickaxe', ...tool('pickaxe', 2) },
  [STONE_AXE]:    { name: 'Stone Axe', ...tool('axe', 2) },
  [STONE_SHOVEL]: { name: 'Stone Shovel', ...tool('shovel', 2) },
  [STONE_SWORD]:  { name: 'Stone Sword', ...tool('sword', 2) },
  [HANDGUN]:    { name: 'Handgun',    gun: { kind: 'hitscan', rate: 0.16, damage: 6,  range: 64,  mag: 12, reload: 1.0, recoil: 0.018, color: 0x3a3f47 } },
  [SMG]:        { name: 'SMG',        gun: { kind: 'hitscan', rate: 0.075, damage: 4, range: 48, auto: true, spread: 0.030, mag: 30, reload: 1.3, recoil: 0.010, color: 0x44464f } },
  [ASSAULT_RIFLE]: { name: 'Assault Rifle', gun: { kind: 'hitscan', rate: 0.10, damage: 6, range: 74, auto: true, spread: 0.016, mag: 30, reload: 1.6, recoil: 0.018, color: 0x3a4a36 } },
  [SHOTGUN]:    { name: 'Shotgun',    gun: { kind: 'shotgun', rate: 0.85, damage: 4, pellets: 9, range: 26, spread: 0.12, mag: 6, reload: 0.95, recoil: 0.06, color: 0x5a3a26 } },
  [SNIPER]:     { name: 'Sniper',     gun: { kind: 'hitscan', rate: 1.1,  damage: 34, range: 240, zoom: true, mag: 5, reload: 1.7, recoil: 0.06, color: 0x23262b } },
  [RAILGUN]:    { name: 'Railgun',    gun: { kind: 'rail',    rate: 1.4, damage: 42, range: 260, pierce: true, mag: 4, reload: 2.1, recoil: 0.07, color: 0x342b4a } },
  [PLASMA_GUN]: { name: 'Plasma Gun', gun: { kind: 'plasma',  rate: 0.30, damage: 12, range: 90,  speed: 40, mag: 20, reload: 1.4, recoil: 0.03, color: 0x2bd6c0 } },
  [ROCKET_LAUNCHER]: { name: 'Rocket Launcher', gun: { kind: 'rocket', rate: 1.0, damage: 18, splash: 48, radius: 4.0, speed: 34, range: 96, mag: 3, reload: 2.0, recoil: 0.08, color: 0x556b2f } },
  [PORTAL_GUN]: { name: 'Portal Gun', gun: { kind: 'portal',  rate: 0.40, range: 90,  speed: 55, recoil: 0.01, color: 0xdadada } },
  // Lobs a singularity that anchors, drags every nearby combatant into its core
  // (shredding DOT), then collapses in a final implosion blast.
  [BLACK_HOLE_BOMB]: { name: 'Black Hole Bomb', gun: { kind: 'blackhole', rate: 1.6, damage: 8, range: 70, speed: 24, radius: 12, pull: 26, duration: 3.6, splash: 70, mag: 2, reload: 3.0, recoil: 0.05, color: 0x7b3ff2 } },
  // Belt-fed LMG (MG42): a brutal sustained-fire weapon — the bunker nest gun.
  [HEAVY_MG]: { name: 'MG42', gun: { kind: 'hitscan', rate: 0.055, damage: 5, range: 82, auto: true, spread: 0.05, mag: 75, reload: 3.2, recoil: 0.022, color: 0x2b2b2f } },
  // Ninjutsu: channel the chakra (hold to gather), then grind the spinning sphere
  // into a foe at point-blank. The longer the charge, the bigger the orb and the
  // more devastating the hit + knockback.
  [RASENGAN]: { name: 'Rasengan', gun: { kind: 'rasengan', charge: 1.15, rate: 0.3, damage: 40, range: 4.8, recoil: 0.04, knockback: 19, color: 0x4aa3ff } },
  // Channel the wind nature, then hurl a chakra shuriken that detonates into a vast
  // dome of microscopic wind blades (AoE). A fuller charge throws a faster, bigger,
  // far deadlier dome.
  [RASENSHURIKEN]: { name: 'Rasenshuriken', gun: { kind: 'rasenshuriken', charge: 1.7, rate: 0.3, damage: 0, splash: 105, radius: 10, speed: 34, range: 92, mag: 1, reload: 2.3, recoil: 0.05, color: 0xbfe9ff } },
  // Continuous laser cannon: hold to pour a searing beam down a line. `dps` is the
  // sustained damage (applied every `tick`s); `drain` is the per-second heat cost of
  // the `mag` battery. Bots fire it as a slower `rate`/`damage` bolt.
  [LASER_CANNON]: { name: 'Laser Cannon', gun: { kind: 'beam', dps: 78, tick: 0.06, range: 120, mag: 100, drain: 17, reload: 2.6, recoil: 0.012, rate: 0.5, damage: 16, color: 0xff2e54 } },
  // Cursed technique — Hollow Purple: clap the limitless red and blue together and
  // erase a wide corridor with an imaginary-mass purple beam. A charged jutsu (draws
  // chakra); a fuller charge means a wider, longer, more annihilating blast.
  [HOLLOW_PURPLE]: { name: 'Hollow Purple', gun: { kind: 'hollowpurple', charge: 1.9, rate: 0.4, damage: 120, radius: 4.2, range: 110, knockback: 30, recoil: 0.06, color: 0x9a3cff } },
};
export function gunOf(id) { return isItem(id) && ITEMS[id].gun ? ITEMS[id].gun : null; }

export const isItem = (id) => id >= ITEM_BASE;
export const isBlockId = (id) => id > AIR && id < ITEM_BASE && BLOCKS[id] !== undefined;
export function itemName(id) {
  if (isItem(id)) return ITEMS[id]?.name || 'Item';
  return BLOCKS[id] ? BLOCKS[id].name : '?';
}
export function foodValue(id) { return isItem(id) && ITEMS[id].food ? ITEMS[id].food : 0; }
export function isFood(id) { return foodValue(id) > 0; }
export function toolOf(id) { return isItem(id) && ITEMS[id].tool ? ITEMS[id] : null; }
export function meleeDamage(id) { const t = toolOf(id); return t ? t.damage : 2; }
export const maxStack = (id) => (toolOf(id) || gunOf(id) ? 1 : 64);

// ---- 2D item icons ----
const HANDLE = '#8a5a2b';
export function drawItemIcon(ctx, id, S) {
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.scale(S / 16, S / 16);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const t = toolOf(id);
  if (t) { drawTool(ctx, t.tool, t.tier === 1 ? '#a9742f' : '#9aa0a6'); ctx.restore(); return; }
  if (gunOf(id)) { drawGun(ctx, id); ctx.restore(); return; }
  switch (id) {
    case STICK: stick(ctx); break;
    case APPLE: apple(ctx); break;
    case PORKCHOP: meat(ctx, '#e89a96', '#c66b66'); break;
    case BEEF: meat(ctx, '#b34a3f', '#8f3a31'); break;
    case MUTTON: meat(ctx, '#d98f86', '#b9685f'); break;
    case ROTTEN_FLESH: meat(ctx, '#7d8a4e', '#5e6a39'); break;
    case LEATHER: hide(ctx); break;
    case COAL: lump(ctx, '#2b2b30', '#454550'); break;
    case ARROW: arrow(ctx); break;
    default: ctx.fillStyle = '#c060d0'; ctx.fillRect(4, 4, 8, 8);
  }
  ctx.restore();
}

function stick(ctx) {
  ctx.strokeStyle = HANDLE; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(4, 13); ctx.lineTo(12, 4); ctx.stroke();
}
function apple(ctx) {
  ctx.fillStyle = '#d8312a';
  ctx.beginPath(); ctx.ellipse(8, 9, 5, 5.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b3231d'; ctx.beginPath(); ctx.ellipse(6.5, 9, 2, 4.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, 4); ctx.lineTo(9, 2); ctx.stroke();
  ctx.fillStyle = '#5aa53a'; ctx.beginPath(); ctx.ellipse(10.5, 3, 1.8, 1, -0.6, 0, Math.PI * 2); ctx.fill();
}
function meat(ctx, light, dark) {
  ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(8, 9, 5.5, 4, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(6, 10, 2.4, 2, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#efe6d0'; ctx.fillRect(11, 5, 3, 1.6);
}
function hide(ctx) {
  ctx.fillStyle = '#9c6b3f';
  ctx.beginPath(); ctx.moveTo(3, 5); ctx.lineTo(13, 4); ctx.lineTo(12, 12); ctx.lineTo(4, 13); ctx.closePath(); ctx.fill();
}
function lump(ctx, dark, hi) {
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(8, 9, 5, 4.5, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hi; ctx.fillRect(6, 6, 2, 2);
}
function arrow(ctx) {
  ctx.strokeStyle = '#caa46a'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(12, 4); ctx.stroke();
  ctx.fillStyle = '#cfd3d6'; ctx.beginPath(); ctx.moveTo(12, 2); ctx.lineTo(14, 5); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(5, 11); ctx.moveTo(3, 13); ctx.lineTo(5, 14); ctx.stroke();
}
function drawGun(ctx, id) {
  if (id === HANDGUN) {
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(2, 5, 9, 3.2);            // barrel
    ctx.fillRect(3, 7, 3.5, 6);            // grip
    ctx.fillStyle = '#6b7079'; ctx.fillRect(2, 5, 3, 1.2);
  } else if (id === SMG) {
    ctx.fillStyle = '#44464f'; ctx.fillRect(2, 6, 9, 3); ctx.fillRect(4, 8.5, 2.6, 4.5);
    ctx.fillStyle = '#2c2e35'; ctx.fillRect(6, 9, 2, 5);   // magazine
    ctx.fillStyle = '#73767f'; ctx.fillRect(2, 6, 2.4, 1);
  } else if (id === ASSAULT_RIFLE) {
    ctx.fillStyle = '#3a4a36'; ctx.fillRect(1, 6, 12, 2.8); ctx.fillRect(4, 8.5, 2.6, 4.5);
    ctx.fillStyle = '#26301f'; ctx.fillRect(7, 9, 2.2, 4.6); // curved mag
    ctx.fillStyle = '#5d6b4f'; ctx.fillRect(11, 5.4, 3, 1.4); // muzzle/sight
  } else if (id === SHOTGUN) {
    ctx.fillStyle = '#5a3a26'; ctx.fillRect(2, 7, 4, 3);   // stock
    ctx.fillStyle = '#7a7d85'; ctx.fillRect(5, 6.5, 9, 2.2); // barrel
    ctx.fillStyle = '#3a3c42'; ctx.fillRect(5, 8.4, 8, 1.4); // pump
  } else if (id === SNIPER) {
    ctx.fillStyle = '#23262b';
    ctx.fillRect(1, 7, 14, 2.4);           // long barrel
    ctx.fillRect(3, 8.5, 3, 4);            // grip
    ctx.fillStyle = '#111'; ctx.fillRect(6, 4.5, 5, 2);  // scope
    ctx.fillStyle = '#4aa3ff'; ctx.fillRect(10, 5, 1.4, 1.4);
  } else if (id === RAILGUN) {
    ctx.fillStyle = '#342b4a'; ctx.fillRect(1, 6, 13, 3); ctx.fillRect(4, 9, 2.6, 4);
    ctx.fillStyle = '#9b6bff'; ctx.fillRect(2, 7, 11, 0.9); // energy rail
    const grad = ctx.createRadialGradient(13, 7.5, 0, 13, 7.5, 3);
    grad.addColorStop(0, '#d8c4ff'); grad.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(13, 7.5, 3, 0, Math.PI * 2); ctx.fill();
  } else if (id === PLASMA_GUN) {
    ctx.fillStyle = '#2a6f68'; ctx.fillRect(2, 6, 10, 4); ctx.fillRect(3, 9, 3, 4);
    const grad = ctx.createRadialGradient(12, 8, 0, 12, 8, 4);
    grad.addColorStop(0, '#bafff5'); grad.addColorStop(1, 'rgba(43,214,192,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(12, 8, 4, 0, Math.PI * 2); ctx.fill();
  } else if (id === ROCKET_LAUNCHER) {
    ctx.fillStyle = '#556b2f'; ctx.fillRect(1, 6, 13, 3.6); ctx.fillRect(4, 9.4, 2.6, 3.4);
    ctx.fillStyle = '#3f5022'; ctx.beginPath(); ctx.arc(2, 7.8, 1.9, Math.PI / 2, -Math.PI / 2); ctx.fill();
    ctx.fillStyle = '#d23a2a'; ctx.beginPath(); ctx.moveTo(14, 6); ctx.lineTo(15.5, 7.8); ctx.lineTo(14, 9.6); ctx.closePath(); ctx.fill(); // warhead
  } else if (id === HEAVY_MG) {
    ctx.fillStyle = '#2b2b2f'; ctx.fillRect(1, 6, 12, 2.6);                 // long receiver
    ctx.fillStyle = '#46484e'; ctx.fillRect(11, 5.6, 4, 3.2);              // perforated barrel shroud
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(11.5, 6.2, 0.7, 2); ctx.fillRect(13, 6.2, 0.7, 2);
    ctx.fillStyle = '#6a4a2a'; ctx.fillRect(2, 8.4, 3.2, 1.8);             // wooden stock
    ctx.strokeStyle = '#b08a3a'; ctx.lineWidth = 1; ctx.beginPath();      // ammo belt
    ctx.moveTo(6, 8.6); ctx.lineTo(7, 11); ctx.lineTo(9, 11.5); ctx.stroke();
  } else if (id === RASENGAN) {
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 6.5);          // swirling chakra orb
    grad.addColorStop(0, '#eaf6ff'); grad.addColorStop(0.45, '#7ec8ff'); grad.addColorStop(0.8, '#3a86e0'); grad.addColorStop(1, 'rgba(40,110,200,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(8, 8, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(235,250,255,0.85)'; ctx.lineWidth = 1; ctx.beginPath();   // spiral
    for (let a = 0; a < 6.4; a += 0.3) { const r = a * 0.9; const px = 8 + Math.cos(a * 1.6) * r, py = 8 + Math.sin(a * 1.6) * r; a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
    ctx.stroke();
  } else if (id === RASENSHURIKEN) {
    ctx.save(); ctx.translate(8, 8); ctx.rotate(0.5);
    ctx.fillStyle = '#dff2ff';
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(7, -1.6); ctx.lineTo(6, 0); ctx.lineTo(7, 1.6); ctx.closePath(); ctx.fill(); }  // 4 curved blades
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, 3.5); cg.addColorStop(0, '#fff'); cg.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (id === BLACK_HOLE_BOMB) {
    ctx.fillStyle = '#241a33'; ctx.fillRect(2, 6, 9, 4); ctx.fillRect(3, 9.5, 3, 3.5);  // dark launcher
    ctx.fillStyle = '#140d1f'; ctx.fillRect(10, 5, 3, 6);                               // muzzle housing
    const grad = ctx.createRadialGradient(11.5, 8, 0, 11.5, 8, 3.2);                    // void orb + halo
    grad.addColorStop(0, '#000'); grad.addColorStop(0.45, '#000');
    grad.addColorStop(0.7, '#9b6bff'); grad.addColorStop(1, 'rgba(123,63,242,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(11.5, 8, 3.2, 0, Math.PI * 2); ctx.fill();
  } else { // PORTAL_GUN
    ctx.fillStyle = '#d6d6d6'; ctx.fillRect(2, 6, 9, 3.6); ctx.fillRect(3, 9, 3, 4);
    ctx.fillStyle = '#ff8c2b'; ctx.fillRect(10, 6, 2, 1.8);
    ctx.fillStyle = '#2b8cff'; ctx.fillRect(10, 7.8, 2, 1.8);
  }
}

function drawTool(ctx, type, headColor) {
  // common wooden handle
  ctx.strokeStyle = HANDLE; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(4, 13); ctx.lineTo(11, 5); ctx.stroke();
  ctx.fillStyle = headColor;
  if (type === 'pickaxe') {
    ctx.lineWidth = 2; ctx.strokeStyle = headColor;
    ctx.beginPath(); ctx.moveTo(6, 3); ctx.quadraticCurveTo(11, 4, 14, 6); ctx.stroke();
  } else if (type === 'axe') {
    ctx.beginPath(); ctx.moveTo(9, 3); ctx.lineTo(14, 5); ctx.lineTo(12, 9); ctx.lineTo(8, 6); ctx.closePath(); ctx.fill();
  } else if (type === 'shovel') {
    ctx.beginPath(); ctx.moveTo(9, 3); ctx.lineTo(13, 4); ctx.lineTo(11.5, 8); ctx.lineTo(8, 6.5); ctx.closePath(); ctx.fill();
  } else { // sword
    ctx.strokeStyle = headColor; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(5, 12); ctx.lineTo(13, 3); ctx.stroke();
    ctx.strokeStyle = '#6a4520'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(6, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 9); ctx.lineTo(7, 12); ctx.stroke();
  }
}
