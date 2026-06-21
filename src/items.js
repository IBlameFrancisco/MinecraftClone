// Non-block items (food, materials). Item ids start at ITEM_BASE so a single
// integer id can flow through the inventory/crafting/hotbar whether it refers to
// a block (id < ITEM_BASE) or an item (id >= ITEM_BASE). Icons are drawn on a
// 2D canvas (blocks use the faux-3D atlas icon elsewhere).

import { BLOCKS, AIR } from './blocks.js';

export const ITEM_BASE = 256;
export const STICK = 256;
export const APPLE = 257;
export const PORKCHOP = 258;
export const BEEF = 259;
export const MUTTON = 260;
export const ROTTEN_FLESH = 261;
export const LEATHER = 262;

export const ITEMS = {
  [STICK]:        { name: 'Stick' },
  [APPLE]:        { name: 'Apple', food: 4 },
  [PORKCHOP]:     { name: 'Porkchop', food: 4 },
  [BEEF]:         { name: 'Raw Beef', food: 3 },
  [MUTTON]:       { name: 'Raw Mutton', food: 3 },
  [ROTTEN_FLESH]: { name: 'Rotten Flesh', food: 2 },
  [LEATHER]:      { name: 'Leather' },
};

export const isItem = (id) => id >= ITEM_BASE;
export const isBlockId = (id) => id > AIR && id < ITEM_BASE && BLOCKS[id] !== undefined;
export function itemName(id) {
  if (isItem(id)) return ITEMS[id]?.name || 'Item';
  return BLOCKS[id] ? BLOCKS[id].name : '?';
}
export function foodValue(id) { return isItem(id) && ITEMS[id].food ? ITEMS[id].food : 0; }
export function isFood(id) { return foodValue(id) > 0; }

// ---- 2D item icons ----
export function drawItemIcon(ctx, id, S) {
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.scale(S / 16, S / 16);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (id) {
    case STICK: {
      ctx.strokeStyle = '#7a5224'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(4, 13); ctx.lineTo(12, 4); ctx.stroke();
      ctx.strokeStyle = '#6a4520'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(4, 13); ctx.lineTo(12, 4); ctx.stroke();
      break;
    }
    case APPLE: {
      ctx.fillStyle = '#d8312a';
      ctx.beginPath(); ctx.ellipse(8, 9, 5, 5.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b3231d';
      ctx.beginPath(); ctx.ellipse(6.5, 9, 2, 4.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, 4); ctx.lineTo(9, 2); ctx.stroke();
      ctx.fillStyle = '#5aa53a'; ctx.beginPath(); ctx.ellipse(10.5, 3, 1.8, 1, -0.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case PORKCHOP: meat(ctx, '#e89a96', '#c66b66'); break;
    case BEEF: meat(ctx, '#b34a3f', '#8f3a31'); break;
    case MUTTON: meat(ctx, '#d98f86', '#b9685f'); break;
    case ROTTEN_FLESH: meat(ctx, '#7d8a4e', '#5e6a39'); break;
    case LEATHER: {
      ctx.fillStyle = '#9c6b3f';
      ctx.beginPath();
      ctx.moveTo(3, 5); ctx.lineTo(13, 4); ctx.lineTo(12, 12); ctx.lineTo(4, 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7d5430';
      for (let i = 0; i < 4; i++) ctx.fillRect(5 + i * 2, 6, 1, 1);
      break;
    }
    default: { ctx.fillStyle = '#c060d0'; ctx.fillRect(4, 4, 8, 8); }
  }
  ctx.restore();
}

function meat(ctx, light, dark) {
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.ellipse(8, 9, 5.5, 4, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(6, 10, 2.4, 2, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#efe6d0'; // bone
  ctx.fillRect(11, 5, 3, 1.6);
}
