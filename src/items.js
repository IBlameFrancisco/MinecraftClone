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

export const GUNS = [HANDGUN, SNIPER, PLASMA_GUN, PORTAL_GUN];

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
  [HANDGUN]:    { name: 'Handgun',    gun: { kind: 'hitscan', rate: 0.16, damage: 6,  range: 64,  color: 0x3a3f47 } },
  [SNIPER]:     { name: 'Sniper',     gun: { kind: 'hitscan', rate: 1.1,  damage: 34, range: 240, zoom: true, color: 0x23262b } },
  [PLASMA_GUN]: { name: 'Plasma Gun', gun: { kind: 'plasma',  rate: 0.30, damage: 12, range: 90,  speed: 40, color: 0x2bd6c0 } },
  [PORTAL_GUN]: { name: 'Portal Gun', gun: { kind: 'portal',  rate: 0.40, range: 90,  speed: 55, color: 0xdadada } },
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
  } else if (id === SNIPER) {
    ctx.fillStyle = '#23262b';
    ctx.fillRect(1, 7, 14, 2.4);           // long barrel
    ctx.fillRect(3, 8.5, 3, 4);            // grip
    ctx.fillStyle = '#111'; ctx.fillRect(6, 4.5, 5, 2);  // scope
    ctx.fillStyle = '#4aa3ff'; ctx.fillRect(10, 5, 1.4, 1.4);
  } else if (id === PLASMA_GUN) {
    ctx.fillStyle = '#2a6f68'; ctx.fillRect(2, 6, 10, 4); ctx.fillRect(3, 9, 3, 4);
    const grad = ctx.createRadialGradient(12, 8, 0, 12, 8, 4);
    grad.addColorStop(0, '#bafff5'); grad.addColorStop(1, 'rgba(43,214,192,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(12, 8, 4, 0, Math.PI * 2); ctx.fill();
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
