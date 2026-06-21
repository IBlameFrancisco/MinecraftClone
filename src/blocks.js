// Block registry. Each block has rendering + physics properties and references
// named texture tiles (resolved to atlas UVs in textures.js).

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const LOG = 5;
export const LEAVES = 6;
export const WATER = 7;
export const SNOW = 8;
export const COAL_ORE = 9;
export const IRON_ORE = 10;
export const COBBLE = 11;
export const PLANK = 12;
export const GLASS = 13;
export const BEDROCK = 14;
export const GRAVEL = 15;
export const GLOWSTONE = 16;
export const CACTUS = 17;

// A block is described by:
//  - solid:   participates in collision
//  - opaque:  fully blocks light + culls neighbour faces + occludes AO
//  - transparent: rendered in the separate (sorted) transparent pass
//  - light:   emitted block-light level (0..15) for BFS propagation
//  - tiles:   { top, side, bottom } tile names
export const BLOCKS = {
  [AIR]:      { name: 'Air',        solid: false, opaque: false, transparent: false, light: 0 },
  [GRASS]:    { name: 'Grass',      solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } },
  [DIRT]:     { name: 'Dirt',       solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'dirt', side: 'dirt', bottom: 'dirt' } },
  [STONE]:    { name: 'Stone',      solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'stone', side: 'stone', bottom: 'stone' } },
  [SAND]:     { name: 'Sand',       solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'sand', side: 'sand', bottom: 'sand' } },
  [LOG]:      { name: 'Wood Log',   solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'log_top', side: 'log_side', bottom: 'log_top' } },
  [LEAVES]:   { name: 'Leaves',     solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'leaves', side: 'leaves', bottom: 'leaves' } },
  [WATER]:    { name: 'Water',      solid: false, opaque: false, transparent: true,  light: 0, tiles: { top: 'water', side: 'water', bottom: 'water' } },
  [SNOW]:     { name: 'Snow',       solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'snow', side: 'snow_side', bottom: 'dirt' } },
  [COAL_ORE]: { name: 'Coal Ore',   solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'coal_ore', side: 'coal_ore', bottom: 'coal_ore' } },
  [IRON_ORE]: { name: 'Iron Ore',   solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'iron_ore', side: 'iron_ore', bottom: 'iron_ore' } },
  [COBBLE]:   { name: 'Cobblestone',solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'cobble', side: 'cobble', bottom: 'cobble' } },
  [PLANK]:    { name: 'Planks',     solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'plank', side: 'plank', bottom: 'plank' } },
  [GLASS]:    { name: 'Glass',      solid: true,  opaque: false, transparent: true,  light: 0, tiles: { top: 'glass', side: 'glass', bottom: 'glass' } },
  [BEDROCK]:  { name: 'Bedrock',    solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'bedrock', side: 'bedrock', bottom: 'bedrock' } },
  [GRAVEL]:   { name: 'Gravel',     solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'gravel', side: 'gravel', bottom: 'gravel' } },
  [GLOWSTONE]:{ name: 'Glowstone',  solid: true,  opaque: true,  transparent: false, light: 14, tiles: { top: 'glowstone', side: 'glowstone', bottom: 'glowstone' } },
  [CACTUS]:   { name: 'Cactus',     solid: true,  opaque: true,  transparent: false, light: 0, tiles: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' } },
};

export function isOpaque(id) {
  return id !== AIR && BLOCKS[id].opaque;
}
export function isSolid(id) {
  return id !== AIR && BLOCKS[id].solid;
}
export function isTransparent(id) {
  return id !== AIR && BLOCKS[id].transparent;
}
export function lightEmission(id) {
  return id === AIR ? 0 : BLOCKS[id].light;
}

// Blocks shown in the hotbar, in order. Keys 1..9 + scroll wheel.
export const HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANK, SAND, LOG, LEAVES, GLOWSTONE];
