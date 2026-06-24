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
export const SHARINGAN = 288;
export const CLEAVE = 289;
export const STAR_PLATINUM = 290;
export const THE_WORLD = 291;
export const FUGA = 292;

// Stands (JoJo): equip one and a manifested spirit floats at your side — it auto-blocks
// incoming attacks and barrages whatever enemy strays into its reach.
export const STANDS = [STAR_PLATINUM, THE_WORLD];

// Stands aren't held weapons — they're worn (see STANDS), so they stay out of GUNS
// (the selectable hotbar/creative-palette set).
export const GUNS = [HANDGUN, SMG, ASSAULT_RIFLE, SHOTGUN, SNIPER, RAILGUN, PLASMA_GUN, ROCKET_LAUNCHER, BLACK_HOLE_BOMB, HEAVY_MG, RASENGAN, RASENSHURIKEN, LASER_CANNON, HOLLOW_PURPLE, SHARINGAN, CLEAVE, FUGA, PORTAL_GUN];

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
  [BLACK_HOLE_BOMB]: { name: 'Black Hole Bomb', gun: { kind: 'blackhole', rate: 1.6, damage: 15, range: 82, speed: 24, radius: 16, pull: 38, duration: 4.4, splash: 100, mag: 2, reload: 3.4, recoil: 0.05, color: 0x7b3ff2 } },
  // Belt-fed LMG (MG42): a brutal sustained-fire weapon — the bunker nest gun.
  [HEAVY_MG]: { name: 'MG42', gun: { kind: 'hitscan', rate: 0.055, damage: 6, range: 82, auto: true, spread: 0.042, mag: 75, reload: 3.2, recoil: 0.022, color: 0x2b2b2f } },
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
  // Mangekyo Sharingan — an all-in-one dojutsu. LMB: the gaze, igniting whoever you
  // look at in spreading Amaterasu black flames (`dot`/s for `ignite`s) and, after
  // holding it `ensnare`s on one target, locking them in Genjutsu (`stun`s). RMB:
  // Precognition — bullet-time where enemies slow + glow through walls and you take
  // less damage. Draws the chakra reserve. Bots fire it as a weak hitscan bolt.
  [SHARINGAN]: { name: 'Sharingan', gun: { kind: 'sharingan', range: 80, drain: 9, dot: 7, ignite: 3.5, ensnare: 1.0, stun: 2.4, precogDur: 4.0, precogCost: 45, precogCD: 9, rate: 0.6, damage: 14, recoil: 0.008, color: 0xe01020 } },
  // Sukuna's cursed technique — Cleave & Dismantle. Sweep a fan of imaginary-edge
  // slashes that carve every enemy in a forward arc (Dismantle), biting far harder
  // the closer the target as the cut "adjusts" to point-blank range (Cleave). A fast
  // close/mid slasher: `arc` is the cone half-angle, `cleave` the point-blank bonus.
  [CLEAVE]: { name: 'Cleave & Dismantle', gun: { kind: 'cleave', rate: 0.42, damage: 15, range: 15, arc: 1.12, cleave: 17, knockback: 15, recoil: 0.03, color: 0xe0143c } },
  // Sukuna's RANGED Dismantle — Fūga (鵬撃). Fling fast crescent slashes of cursed
  // energy down a line: each cut pierces every enemy it passes through, all the way to
  // the wall. Auto-fire, fast cadence — the long-range counterpart to Cleave & Dismantle.
  [FUGA]: { name: 'Fūga', gun: { kind: 'fuga', rate: 0.13, damage: 11, range: 72, auto: true, pierce: true, spread: 0.022, mag: 16, reload: 1.5, recoil: 0.024, color: 0xff2d6a } },
  // Stands manifest a spirit at your side. Passive while equipped: `block` is the
  // fraction of an attacker's damage it deflects, and it auto-barrages the nearest
  // enemy within `reach` for `attackDamage` every `attackRate`s. No gun in hand.
  // `timeStop`/`tsCall`: press Z to freeze time for that many seconds — once per life.
  [STAR_PLATINUM]: { name: 'Star Platinum', gun: { kind: 'stand', block: 0.78, reach: 6.5, attackRate: 0.6, attackDamage: 13, knockback: 12, color: 0x7d5fff, accent: 0x35e6e0, callout: 'ORA ORA ORA!', timeStop: 4.0, tsCall: 'STAR PLATINUM — toki yo tomare!' } },
  [THE_WORLD]:     { name: 'The World',     gun: { kind: 'stand', block: 0.72, reach: 6.0, attackRate: 0.5, attackDamage: 15, knockback: 14, color: 0xf4c542, accent: 0xff4d6a, callout: 'MUDA MUDA MUDA!', timeStop: 6.0, tsCall: 'ZA WARUDO! Toki yo tomare!' } },
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

// Shared icon helper: soft dark outline pass for readability at ~40px. Call
// before filling a shape — strokes the same path slightly fattened underneath.
function outline(ctx, color = 'rgba(20,14,8,0.55)', w = 1.1) {
  ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
}

function stick(ctx) {
  // wood shaft with a darker core line and a top-left highlight, capped ends
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5e3a1a'; ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(4.5, 13); ctx.lineTo(11.5, 4); ctx.stroke();
  ctx.strokeStyle = HANDLE; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(4.5, 13); ctx.lineTo(11.5, 4); ctx.stroke();
  ctx.strokeStyle = '#b98b54'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(4.9, 12.4); ctx.lineTo(11.1, 4.6); ctx.stroke();
}
function apple(ctx) {
  // rounded body with a notch at the top, side shadow, stem, leaf and gloss
  ctx.beginPath();
  ctx.moveTo(8, 5.2);
  ctx.bezierCurveTo(5.5, 3.4, 2.6, 5.8, 3.2, 9);
  ctx.bezierCurveTo(3.6, 12, 6, 14, 8, 13);
  ctx.bezierCurveTo(10, 14, 12.4, 12, 12.8, 9);
  ctx.bezierCurveTo(13.4, 5.8, 10.5, 3.4, 8, 5.2);
  ctx.closePath();
  ctx.fillStyle = '#d8312a'; ctx.fill();
  outline(ctx, 'rgba(70,10,8,0.5)', 0.9);
  ctx.save(); ctx.clip();
  ctx.fillStyle = '#b3231d'; ctx.beginPath(); ctx.ellipse(10, 9.5, 3.2, 4.5, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,180,170,0.7)'; ctx.beginPath(); ctx.ellipse(5.6, 7, 1.5, 2.2, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(8, 5); ctx.lineTo(8.8, 2.6); ctx.stroke();
  ctx.fillStyle = '#5aa53a'; ctx.beginPath(); ctx.ellipse(10.6, 3.2, 2, 1.1, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7cc257'; ctx.beginPath(); ctx.ellipse(10.4, 2.9, 1, 0.5, -0.6, 0, Math.PI * 2); ctx.fill();
}
function meat(ctx, light, dark) {
  // fleshy lobe with a bone nub, marbling streak and top-left sheen
  ctx.beginPath(); ctx.ellipse(8, 9, 5.6, 4.2, 0.3, 0, Math.PI * 2);
  ctx.fillStyle = light; ctx.fill();
  outline(ctx, 'rgba(40,15,12,0.45)', 0.9);
  ctx.save(); ctx.beginPath(); ctx.ellipse(8, 9, 5.6, 4.2, 0.3, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(6.4, 10.4, 2.6, 2, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,245,235,0.45)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(5, 7.6); ctx.lineTo(9.5, 6.8); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(6.6, 7.4, 1.8, 0.9, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#efe6d0'; // bone nub
  ctx.beginPath(); ctx.ellipse(12.6, 5.6, 1.7, 1.2, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(120,100,70,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
}
function hide(ctx) {
  // tanned leather patch with soft edges, stitching dashes and a top sheen
  ctx.beginPath();
  ctx.moveTo(3.4, 5); ctx.lineTo(13, 3.8);
  ctx.quadraticCurveTo(13.6, 8, 12.2, 12.4);
  ctx.lineTo(4, 13.2); ctx.quadraticCurveTo(2.6, 8.5, 3.4, 5);
  ctx.closePath();
  ctx.fillStyle = '#9c6b3f'; ctx.fill();
  outline(ctx, 'rgba(50,30,12,0.5)', 0.9);
  ctx.fillStyle = 'rgba(196,150,100,0.6)'; // top sheen
  ctx.beginPath(); ctx.moveTo(4, 5.4); ctx.lineTo(12.4, 4.4); ctx.lineTo(11.8, 6.2); ctx.lineTo(4.4, 7); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#6f4a26'; ctx.lineWidth = 0.7; ctx.setLineDash([1, 1.2]);
  ctx.beginPath();
  ctx.moveTo(4.6, 6); ctx.lineTo(12, 5);
  ctx.moveTo(4.4, 11.4); ctx.lineTo(11.6, 10.8);
  ctx.stroke(); ctx.setLineDash([]);
}
function lump(ctx, dark, hi) {
  // faceted nugget: angular silhouette with a bright facet and dark crevices
  ctx.beginPath();
  ctx.moveTo(7, 3.6); ctx.lineTo(11.6, 5.4); ctx.lineTo(13, 9.6);
  ctx.lineTo(9.4, 13); ctx.lineTo(4.4, 11.6); ctx.lineTo(3.4, 7);
  ctx.closePath();
  ctx.fillStyle = dark; ctx.fill();
  outline(ctx, 'rgba(0,0,0,0.55)', 0.9);
  ctx.save(); ctx.clip();
  ctx.fillStyle = hi; // lit facet (top-left)
  ctx.beginPath(); ctx.moveTo(6, 4.6); ctx.lineTo(9.6, 5.8); ctx.lineTo(7.4, 8.4); ctx.lineTo(4.8, 7.4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; // shadow crevice (bottom-right)
  ctx.beginPath(); ctx.moveTo(13, 9.6); ctx.lineTo(9.4, 13); ctx.lineTo(8.6, 9.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(6.4, 5.4, 1.2, 1.2); // spark
  ctx.restore();
}
function arrow(ctx) {
  // wooden shaft, steel head and feathered fletching with depth
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(3.4, 12.6); ctx.lineTo(12, 4); ctx.stroke();
  ctx.strokeStyle = '#caa46a'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(3.6, 12.2); ctx.lineTo(11.8, 4.2); ctx.stroke();
  // arrowhead
  ctx.beginPath(); ctx.moveTo(12.6, 1.6); ctx.lineTo(14.6, 5.2); ctx.lineTo(10.4, 4.4); ctx.closePath();
  ctx.fillStyle = '#cfd3d6'; ctx.fill();
  ctx.strokeStyle = 'rgba(60,70,80,0.6)'; ctx.lineWidth = 0.7; ctx.stroke();
  ctx.fillStyle = '#eef1f3'; ctx.beginPath(); ctx.moveTo(12.6, 1.6); ctx.lineTo(13.5, 3.4); ctx.lineTo(12, 3.1); ctx.closePath(); ctx.fill();
  // fletching
  ctx.fillStyle = '#e6e6e6'; ctx.strokeStyle = '#b8b8b8'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(3.4, 12.6); ctx.lineTo(5.6, 11.4); ctx.lineTo(4.6, 13.4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3.4, 12.6); ctx.lineTo(2.4, 14.6); ctx.lineTo(4.4, 13.8); ctx.closePath(); ctx.fill(); ctx.stroke();
}
// A rounded metal body slab with a top-left sheen strip and a soft dark
// outline — the shared look for all the conventional firearms.
function gunBody(ctx, x, y, w, h, base, r = 1) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fillStyle = base; ctx.fill();
  ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(8,8,12,0.55)'; ctx.stroke();
  ctx.fillStyle = shade(base, 38); // top sheen
  ctx.fillRect(x + 0.6, y + 0.4, w - 1.2, Math.max(0.7, h * 0.22));
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; // bottom shade
  ctx.fillRect(x + 0.6, y + h - Math.max(0.6, h * 0.18), w - 1.2, Math.max(0.6, h * 0.18));
}

function drawGun(ctx, id) {
  if (id === HANDGUN) {
    gunBody(ctx, 2, 5, 9, 3.3, '#3a3f47');       // slide
    gunBody(ctx, 3, 7.6, 3.6, 5.6, '#33373e');   // grip
    ctx.fillStyle = '#1c1e22'; ctx.fillRect(6.2, 8.2, 1.4, 1.8); // trigger guard
    ctx.fillStyle = '#0e0f12'; ctx.fillRect(2, 5.6, 1, 1);       // muzzle
    ctx.fillStyle = '#7a8089'; ctx.fillRect(9.4, 4.6, 1, 0.9);   // rear sight
  } else if (id === SMG) {
    gunBody(ctx, 2, 6, 9, 3, '#44464f');
    gunBody(ctx, 4, 8.4, 2.6, 4.8, '#3b3d45');    // grip
    ctx.fillStyle = '#2c2e35'; ctx.fillRect(6.2, 9, 2, 5);       // magazine
    ctx.fillStyle = '#202228'; ctx.fillRect(6.2, 9, 2, 1);
    ctx.fillStyle = '#0e0f12'; ctx.fillRect(2, 6.6, 0.9, 1);     // muzzle
    ctx.fillStyle = '#7a8089'; ctx.fillRect(9, 5.4, 1.2, 0.8);   // sight
  } else if (id === ASSAULT_RIFLE) {
    gunBody(ctx, 1, 6, 12, 2.9, '#3a4a36');
    gunBody(ctx, 4, 8.4, 2.6, 4.8, '#33402f');    // grip
    ctx.fillStyle = '#26301f'; ctx.beginPath();   // curved mag
    ctx.moveTo(7, 9); ctx.lineTo(9.2, 9); ctx.quadraticCurveTo(9.6, 12, 8.4, 13.6); ctx.lineTo(6.6, 13.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5d6b4f'; ctx.fillRect(11.4, 5.2, 2.6, 1.3); // muzzle/sight
    ctx.fillStyle = '#0e120c'; ctx.fillRect(1, 6.6, 0.9, 1);      // muzzle hole
    ctx.fillStyle = '#6f7d61'; ctx.fillRect(3.4, 5.4, 1.4, 0.8);  // front sight
  } else if (id === SHOTGUN) {
    gunBody(ctx, 1.6, 7, 4.4, 3, '#5a3a26', 0.6); // wood stock
    ctx.fillStyle = '#7a4a2e'; ctx.fillRect(2.2, 7.4, 3.2, 0.8); // stock grain sheen
    gunBody(ctx, 5, 6.4, 9, 2.3, '#7a7d85');      // barrel
    ctx.fillStyle = '#3a3c42'; ctx.fillRect(5, 8.5, 8, 1.5);      // pump
    ctx.fillStyle = '#2a2c31'; ctx.fillRect(5.5, 8.7, 7, 0.5);
    ctx.fillStyle = '#0e0f12'; ctx.beginPath(); ctx.arc(13.6, 7.5, 0.8, 0, Math.PI * 2); ctx.fill(); // bore
  } else if (id === SNIPER) {
    gunBody(ctx, 1, 7, 14, 2.4, '#23262b');       // long barrel/receiver
    gunBody(ctx, 3, 8.6, 3, 4.4, '#1d2024');      // grip
    ctx.fillStyle = '#34464f'; ctx.fillRect(6, 9.4, 5.5, 1.6);    // thumbhole stock fill
    ctx.fillStyle = '#0e0f12'; ctx.fillRect(5.6, 4.3, 5.8, 2.2);  // scope tube
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(6, 4.0, 1.4, 0.6); ctx.fillRect(9.8, 4.0, 1.4, 0.6); // scope rings
    ctx.fillStyle = '#4aa3ff'; ctx.beginPath(); ctx.arc(10.6, 5.4, 0.9, 0, Math.PI * 2); ctx.fill(); // lens glint
    ctx.fillStyle = '#bfe0ff'; ctx.beginPath(); ctx.arc(10.3, 5.1, 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(1, 7.6, 0.9, 1);      // muzzle
  } else if (id === RAILGUN) {
    gunBody(ctx, 1, 6, 13, 3, '#342b4a');
    gunBody(ctx, 4, 9, 2.6, 4, '#2c2540');        // grip
    ctx.fillStyle = '#1a1428'; ctx.fillRect(2, 6.9, 11, 1.1);     // rail channel
    ctx.fillStyle = '#9b6bff'; ctx.fillRect(2, 7.1, 11, 0.7);     // energy rail
    ctx.fillStyle = '#e0d0ff'; ctx.fillRect(2, 7.1, 11, 0.25);    // rail glow line
    const grad = ctx.createRadialGradient(13, 7.5, 0, 13, 7.5, 3.2);
    grad.addColorStop(0, '#f0e6ff'); grad.addColorStop(0.4, '#d8c4ff'); grad.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(13, 7.5, 3.2, 0, Math.PI * 2); ctx.fill();
  } else if (id === PLASMA_GUN) {
    gunBody(ctx, 2, 6, 10, 4, '#2a6f68');
    gunBody(ctx, 3, 9.4, 3, 3.6, '#235c56');      // grip
    ctx.fillStyle = '#1b4a45'; ctx.beginPath(); ctx.arc(11.5, 8, 2.4, 0, Math.PI * 2); ctx.fill(); // emitter ring
    const grad = ctx.createRadialGradient(11.5, 8, 0, 11.5, 8, 4.2);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, '#bafff5'); grad.addColorStop(1, 'rgba(43,214,192,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(11.5, 8, 4.2, 0, Math.PI * 2); ctx.fill();
  } else if (id === ROCKET_LAUNCHER) {
    gunBody(ctx, 1, 6, 13, 3.6, '#556b2f');
    gunBody(ctx, 4, 9.4, 2.6, 3.4, '#49591f');    // grip
    ctx.fillStyle = '#2c3a16'; ctx.beginPath(); ctx.arc(2, 7.8, 1.9, Math.PI / 2, -Math.PI / 2); ctx.fill(); // rear vent
    ctx.fillStyle = '#7d7d4a'; ctx.fillRect(7.6, 4.6, 2.2, 1.2); // optic
    ctx.fillStyle = '#d23a2a'; ctx.beginPath(); ctx.moveTo(13.6, 5.6); ctx.lineTo(15.6, 7.8); ctx.lineTo(13.6, 10); ctx.closePath(); ctx.fill(); // warhead
    ctx.fillStyle = '#f2a23a'; ctx.beginPath(); ctx.moveTo(13.6, 5.6); ctx.lineTo(14.7, 6.8); ctx.lineTo(13.6, 7.6); ctx.closePath(); ctx.fill(); // warhead tip sheen
  } else if (id === HEAVY_MG) {
    gunBody(ctx, 1, 6, 12, 2.6, '#2b2b2f');                       // long receiver
    ctx.fillStyle = '#46484e'; ctx.fillRect(11, 5.6, 4, 3.2);     // perforated barrel shroud
    ctx.fillStyle = '#5a5c63'; ctx.fillRect(11, 5.6, 4, 0.7);     // shroud top sheen
    ctx.fillStyle = '#15151a'; ctx.fillRect(11.6, 6.2, 0.7, 2); ctx.fillRect(12.6, 6.2, 0.7, 2); ctx.fillRect(13.6, 6.2, 0.7, 2); // vent holes
    gunBody(ctx, 2, 8.2, 3.4, 2, '#6a4a2a', 0.6);                 // wooden stock
    ctx.fillStyle = '#3a3c2e'; ctx.fillRect(5.4, 8.6, 1.6, 2.4);  // belt feed box
    ctx.strokeStyle = '#c79a44'; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; // ammo belt
    ctx.setLineDash([0.6, 1]); ctx.beginPath();
    ctx.moveTo(6, 8.8); ctx.lineTo(7.4, 11); ctx.lineTo(9.6, 11.8); ctx.stroke(); ctx.setLineDash([]);
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
    gunBody(ctx, 2, 6, 9, 4, '#241a33');                                                // dark launcher
    gunBody(ctx, 3, 9.5, 3, 3.5, '#1d1429');                                            // grip
    ctx.fillStyle = '#140d1f'; ctx.fillRect(9.6, 5, 3.4, 6);                            // muzzle housing
    ctx.fillStyle = '#3a2a52'; ctx.fillRect(9.6, 5, 3.4, 0.7);                          // housing top sheen
    const grad = ctx.createRadialGradient(11.5, 8, 0, 11.5, 8, 3.4);                    // void orb + halo
    grad.addColorStop(0, '#000'); grad.addColorStop(0.42, '#000');
    grad.addColorStop(0.62, '#9b6bff'); grad.addColorStop(0.8, '#c9a8ff'); grad.addColorStop(1, 'rgba(123,63,242,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(11.5, 8, 3.4, 0, Math.PI * 2); ctx.fill();
  } else if (id === LASER_CANNON) {
    gunBody(ctx, 1, 6, 10, 4, '#2a2030');                                                 // emitter body
    gunBody(ctx, 3, 9.5, 3, 3.4, '#221926');                                              // grip
    ctx.fillStyle = '#140c1c'; ctx.fillRect(9.6, 5, 3.4, 6);                              // muzzle housing
    ctx.fillStyle = '#3a1422'; ctx.fillRect(2, 6.8, 9, 1.2);                              // rail channel
    ctx.fillStyle = '#ff2e54'; ctx.fillRect(2, 7.05, 9, 0.7);                             // energy rail
    ctx.fillStyle = '#ffd0da'; ctx.fillRect(2, 7.05, 9, 0.22);                            // rail glow line
    const grad = ctx.createRadialGradient(12.4, 8, 0, 12.4, 8, 4.2);                      // glowing red lens + beam
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.35, '#ff516e'); grad.addColorStop(1, 'rgba(255,46,84,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(12.4, 8, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,90,120,0.5)'; ctx.fillRect(13, 7.5, 3, 1);                  // beam streak
  } else if (id === HOLLOW_PURPLE) {
    const halo = ctx.createRadialGradient(8, 8, 0, 8, 8, 7);                               // purple imaginary-mass haze
    halo.addColorStop(0, 'rgba(176,96,255,0.9)'); halo.addColorStop(1, 'rgba(120,40,200,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(8, 8, 7, 0, Math.PI * 2); ctx.fill();
    const red = ctx.createRadialGradient(5.5, 8, 0, 5.5, 8, 3);                            // limitless red
    red.addColorStop(0, '#ff5a72'); red.addColorStop(1, 'rgba(255,42,68,0)');
    ctx.fillStyle = red; ctx.beginPath(); ctx.arc(5.5, 8, 3, 0, Math.PI * 2); ctx.fill();
    const blue = ctx.createRadialGradient(10.5, 8, 0, 10.5, 8, 3);                         // limitless blue
    blue.addColorStop(0, '#5a8bff'); blue.addColorStop(1, 'rgba(42,107,255,0)');
    ctx.fillStyle = blue; ctx.beginPath(); ctx.arc(10.5, 8, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8, 8, 1.6, 0, Math.PI * 2); ctx.fill();  // bright purple core
    ctx.fillStyle = '#e6c8ff'; ctx.beginPath(); ctx.arc(8, 8, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8, 8, 1.6, 0, Math.PI * 2); ctx.fill();
  } else if (id === SHARINGAN) {
    ctx.fillStyle = '#1a0608'; ctx.beginPath(); ctx.arc(8, 8, 6.6, 0, Math.PI * 2); ctx.fill();   // dark sclera rim
    const iris = ctx.createRadialGradient(6.4, 6.4, 0.5, 8, 8, 5.6);                              // shaded red iris
    iris.addColorStop(0, '#f0394a'); iris.addColorStop(0.6, '#d11020'); iris.addColorStop(1, '#9c0a16');
    ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(8, 8, 5.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a0408'; ctx.beginPath(); ctx.arc(8, 8, 1.8, 0, Math.PI * 2); ctx.fill();    // pupil
    ctx.fillStyle = '#1a0306';
    for (let i = 0; i < 3; i++) {                                                                   // three tomoe
      const a = i * 2.094 - 1.1, cx = 8 + Math.cos(a) * 3.3, cy = 8 + Math.sin(a) * 3.3;
      ctx.beginPath(); ctx.arc(cx, cy, 1.15, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#1a0306'; ctx.beginPath(); ctx.arc(cx, cy, 2.1, a + 0.5, a + 2.2); ctx.stroke();
    }
  } else if (id === CLEAVE) {
    // Two crossed crimson slash arcs — Sukuna's cleaving cut.
    const slash = (x0, y0, x1, y1, cx, cy, w, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
    };
    slash(2.5, 3, 13.5, 12.5, 9.5, 5, 3.4, 'rgba(140,4,18,0.85)');     // dark under-stroke
    slash(2.5, 3, 13.5, 12.5, 9.5, 5, 2.0, '#e0143c');                 // crimson slash
    slash(2.5, 3, 13.5, 12.5, 9.5, 5, 0.7, '#fff2f4');                 // hot white edge
    slash(13.5, 3, 2.5, 12.5, 6.5, 5, 3.0, 'rgba(140,4,18,0.7)');      // crossing slash (under)
    slash(13.5, 3, 2.5, 12.5, 6.5, 5, 1.6, '#ff3a5e');
    slash(13.5, 3, 2.5, 12.5, 6.5, 5, 0.6, '#fff2f4');
  } else if (id === STAR_PLATINUM || id === THE_WORLD) {
    // A menacing Stand bust: broad shoulders, a helmeted head, glowing eyes + aura.
    const sp = id === STAR_PLATINUM;
    const body = sp ? '#7d5fff' : '#f4c542', dark = sp ? '#4a32b0' : '#a87a18', eye = sp ? '#7af6f0' : '#ff5a74';
    const halo = ctx.createRadialGradient(8, 8, 1, 8, 8, 8);             // aura
    halo.addColorStop(0, sp ? 'rgba(150,120,255,0.55)' : 'rgba(255,210,80,0.55)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(8, 8, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(1.5, 15); ctx.quadraticCurveTo(8, 8.5, 14.5, 15); ctx.lineTo(14.5, 16); ctx.lineTo(1.5, 16); ctx.closePath(); ctx.fill();  // shoulders
    ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(2.5, 14.5); ctx.quadraticCurveTo(8, 9, 13.5, 14.5); ctx.lineTo(13.5, 16); ctx.lineTo(2.5, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(8, 6.5, 3.6, 0, Math.PI * 2); ctx.fill();   // head
    ctx.fillStyle = dark; ctx.fillRect(4.6, 5.8, 6.8, 1.5);                                     // brow visor
    ctx.fillStyle = eye; ctx.fillRect(5.4, 6.0, 1.8, 1.0); ctx.fillRect(8.8, 6.0, 1.8, 1.0);    // glowing eyes
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(5.6, 6.1, 0.7, 0.5); ctx.fillRect(9.0, 6.1, 0.7, 0.5);  // eye glints
  } else { // PORTAL_GUN
    gunBody(ctx, 2, 6, 9, 3.6, '#d6d6d6');
    gunBody(ctx, 3, 9.4, 3, 3.6, '#c4c4c4');     // grip
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(9.6, 5.4, 3, 5);     // muzzle prongs housing
    const og = ctx.createRadialGradient(11, 6.9, 0, 11, 6.9, 1.6); // orange portal glow
    og.addColorStop(0, '#ffd9a0'); og.addColorStop(0.5, '#ff8c2b'); og.addColorStop(1, 'rgba(255,140,43,0)');
    ctx.fillStyle = og; ctx.beginPath(); ctx.arc(11, 6.9, 1.6, 0, Math.PI * 2); ctx.fill();
    const bg = ctx.createRadialGradient(11, 9.1, 0, 11, 9.1, 1.6); // blue portal glow
    bg.addColorStop(0, '#bfe0ff'); bg.addColorStop(0.5, '#2b8cff'); bg.addColorStop(1, 'rgba(43,140,255,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(11, 9.1, 1.6, 0, Math.PI * 2); ctx.fill();
  }
}

// Derive a lighter sheen and darker shade from a base head color for a
// consistent top-left light direction across the whole tool set.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r|0},${g|0},${b|0})`;
}

function woodHandle(ctx, x0, y0, x1, y1) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5e3a1a'; ctx.lineWidth = 3; // dark edge
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = HANDLE; ctx.lineWidth = 2; // wood
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = '#b98b54'; ctx.lineWidth = 0.7; // highlight
  ctx.beginPath(); ctx.moveTo(x0 + 0.3, y0 - 0.3); ctx.lineTo(x1 + 0.3, y1 - 0.3); ctx.stroke();
}

function drawTool(ctx, type, headColor) {
  const hi = shade(headColor, 55), lo = shade(headColor, -45);
  const edge = 'rgba(20,14,8,0.5)';
  if (type === 'pickaxe') {
    woodHandle(ctx, 4.5, 13.5, 9.5, 6);
    ctx.lineCap = 'round';
    ctx.strokeStyle = lo; ctx.lineWidth = 2.6; // head underlay (shadow)
    ctx.beginPath(); ctx.moveTo(5.5, 3.4); ctx.quadraticCurveTo(10.5, 3.6, 14, 6.2); ctx.stroke();
    ctx.strokeStyle = headColor; ctx.lineWidth = 1.9;
    ctx.beginPath(); ctx.moveTo(5.5, 3.4); ctx.quadraticCurveTo(10.5, 3.6, 14, 6.2); ctx.stroke();
    ctx.strokeStyle = hi; ctx.lineWidth = 0.8; // top sheen
    ctx.beginPath(); ctx.moveTo(5.8, 2.8); ctx.quadraticCurveTo(10.4, 3, 13.6, 5.4); ctx.stroke();
  } else if (type === 'axe') {
    woodHandle(ctx, 4.5, 13.5, 9.5, 5);
    ctx.beginPath(); ctx.moveTo(9, 2.8); ctx.lineTo(14, 5); ctx.quadraticCurveTo(13.4, 7.6, 12, 9.4); ctx.lineTo(8, 6.4); ctx.closePath();
    ctx.fillStyle = headColor; ctx.fill();
    outline(ctx, edge, 0.9);
    ctx.fillStyle = hi; // bevel highlight along the back
    ctx.beginPath(); ctx.moveTo(9, 2.8); ctx.lineTo(14, 5); ctx.lineTo(12.4, 5.8); ctx.lineTo(9.2, 4.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lo; // shadowed edge near blade
    ctx.beginPath(); ctx.moveTo(8, 6.4); ctx.lineTo(12, 9.4); ctx.lineTo(10.4, 9.2); ctx.lineTo(8.2, 7.2); ctx.closePath(); ctx.fill();
  } else if (type === 'shovel') {
    woodHandle(ctx, 4.5, 13.5, 9.5, 5.5);
    ctx.beginPath(); ctx.moveTo(8.8, 2.8); ctx.lineTo(13, 4); ctx.quadraticCurveTo(12.4, 6.8, 10.6, 8.4); ctx.lineTo(7.4, 6.6); ctx.closePath();
    ctx.fillStyle = headColor; ctx.fill();
    outline(ctx, edge, 0.9);
    ctx.fillStyle = hi; // scoop highlight
    ctx.beginPath(); ctx.moveTo(8.8, 2.8); ctx.lineTo(13, 4); ctx.lineTo(11, 4.8); ctx.lineTo(8.4, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lo; // scoop hollow shadow
    ctx.beginPath(); ctx.ellipse(10.2, 6, 1.6, 1.2, -0.6, 0, Math.PI * 2); ctx.fill();
  } else { // sword
    woodHandle(ctx, 3, 13.5, 6, 10.2); // grip
    ctx.lineCap = 'round';
    ctx.strokeStyle = lo; ctx.lineWidth = 3; // blade edge (shadow)
    ctx.beginPath(); ctx.moveTo(5.4, 11.6); ctx.lineTo(13, 3); ctx.stroke();
    ctx.strokeStyle = headColor; ctx.lineWidth = 2; // blade
    ctx.beginPath(); ctx.moveTo(5.4, 11.6); ctx.lineTo(13, 3); ctx.stroke();
    ctx.strokeStyle = hi; ctx.lineWidth = 0.8; // central fuller / sheen
    ctx.beginPath(); ctx.moveTo(6, 11); ctx.lineTo(12.6, 3.4); ctx.stroke();
    ctx.strokeStyle = '#7a5020'; ctx.lineWidth = 2.4; // crossguard
    ctx.beginPath(); ctx.moveTo(4, 9.4); ctx.lineTo(7.4, 12.8); ctx.stroke();
    ctx.fillStyle = '#caa44a'; ctx.beginPath(); ctx.arc(3, 13.6, 1, 0, Math.PI * 2); ctx.fill(); // pommel
  }
}
