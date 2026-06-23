// Procedural world generation: multi-octave terrain height, climate-driven
// biomes, 3D-noise caves, ore veins, water/beaches and trees. Every value is a
// deterministic function of world coordinates, so chunks tile seamlessly with
// no cross-chunk ordering dependencies.

import { SimplexNoise } from './noise.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL, WORLD_SEED } from './constants.js';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, SNOW,
  COAL_ORE, IRON_ORE, BEDROCK, GRAVEL, CACTUS, COBBLE, PLANK, WOOL, GLOWSTONE, TORCH, GLASS, ICE, LAVA,
} from './blocks.js';

export const BIOME_PLAINS = 0;
export const BIOME_DESERT = 1;
export const BIOME_SNOW = 2;
export const BIOME_FOREST = 3;

// ---- Battle arena (a fixed, symmetric PvP map) ----
// A dark ritual dungeon: a stepped central altar with a glowing obelisk, a tall
// banded perimeter wall with torch sconces + crenellations, broken pillars,
// braziers and raised stages. Generated deterministically (no edit sync needed).
export const ARENA = { FLOOR: 50, HALF: 38, WALL_H: 10 };

// Structures in folded (|x|,|z|) quadrant coords — mirrored into all four
// quadrants (fair for FFA). `cap` is a single block placed one above the top.
const ARENA_STRUCT = [
  { x0: 10, x1: 11, z0: 10, z1: 11, y0: 1, y1: 6, mat: COBBLE, cap: GLOWSTONE }, // inner lit pillars
  { x0: 22, x1: 23, z0: 22, z1: 23, y0: 1, y1: 5, mat: PLANK,  cap: GLOWSTONE }, // outer warm-wood pillars
  { x0: 18, x1: 19, z0: 7,  z1: 8,  y0: 1, y1: 4, mat: COBBLE, cap: GLOWSTONE }, // mid pillars (lit)
  { x0: 7,  x1: 8,  z0: 18, z1: 19, y0: 1, y1: 4, mat: COBBLE, cap: GLOWSTONE },
  { x0: 14, x1: 20, z0: 14, z1: 15, y0: 1, y1: 2, mat: PLANK },                  // L-shaped low cover (warm)
  { x0: 14, x1: 15, z0: 14, z1: 20, y0: 1, y1: 2, mat: PLANK },
  { x0: 24, x1: 30, z0: 2,  z1: 6,  y0: 1, y1: 2, mat: COBBLE },                 // raised stage
  { x0: 23, x1: 23, z0: 2,  z1: 6,  y0: 1, y1: 1, mat: COBBLE },                 // step onto the stage
  { x0: 2,  x1: 6,  z0: 24, z1: 30, y0: 1, y1: 2, mat: COBBLE },
  { x0: 2,  x1: 6,  z0: 23, z1: 23, y0: 1, y1: 1, mat: COBBLE },
  { x0: 29, x1: 31, z0: 29, z1: 31, y0: 1, y1: 7, mat: COBBLE, cap: GLOWSTONE }, // corner watchtower beacons
  { x0: 30, x1: 30, z0: 5,  z1: 5,  y0: 1, y1: 2, mat: COBBLE, cap: GLOWSTONE }, // floor braziers
  { x0: 5,  x1: 5,  z0: 30, z1: 30, y0: 1, y1: 2, mat: COBBLE, cap: GLOWSTONE },
  { x0: 16, x1: 16, z0: 28, z1: 28, y0: 1, y1: 2, mat: COBBLE, cap: GLOWSTONE },
  { x0: 28, x1: 28, z0: 16, z1: 16, y0: 1, y1: 2, mat: COBBLE, cap: GLOWSTONE },
];

// Per-theme arena LAYOUTS — each map has its own structure tuned for a different
// style of weapon, authored in folded (|x|,|z|) quadrant coords (mirrored into all
// four quadrants). `mat` is a role marker: COBBLE → the theme's `pin` cover, PLANK
// → `pout`; `cap` → a `beacon` light one above the top.
//
// JUNGLE — close-quarters: a maze of head-high walls + (with the trees) dense
// cover and short sightlines. Rewards shotgun / SMG / point-blank jutsu.
const JUNGLE_STRUCT = [
  { x0: 9, x1: 10, z0: 9, z1: 15, y0: 1, y1: 3, mat: COBBLE },
  { x0: 9, x1: 15, z0: 9, z1: 10, y0: 1, y1: 3, mat: COBBLE },
  { x0: 16, x1: 22, z0: 14, z1: 15, y0: 1, y1: 3, mat: PLANK },
  { x0: 14, x1: 15, z0: 16, z1: 22, y0: 1, y1: 3, mat: PLANK },
  { x0: 24, x1: 25, z0: 8, z1: 16, y0: 1, y1: 3, mat: COBBLE },
  { x0: 8, x1: 16, z0: 24, z1: 25, y0: 1, y1: 3, mat: COBBLE },
  { x0: 20, x1: 21, z0: 26, z1: 31, y0: 1, y1: 3, mat: PLANK },
  { x0: 26, x1: 31, z0: 20, z1: 21, y0: 1, y1: 3, mat: PLANK },
  { x0: 29, x1: 31, z0: 29, z1: 31, y0: 1, y1: 4, mat: COBBLE, cap: GLOWSTONE },
  { x0: 12, x1: 13, z0: 30, z1: 32, y0: 1, y1: 3, mat: COBBLE },
  { x0: 30, x1: 32, z0: 12, z1: 13, y0: 1, y1: 3, mat: COBBLE },
];
// FROZEN — long-range: a wide-open ice field with only tall sniper perches and a
// few low blocks. Sweeping sightlines reward the sniper / railgun / laser.
const FROZEN_STRUCT = [
  // Corner sniper perch — 1-high steps you can walk up to a raised platform + spire.
  { x0: 27, x1: 31, z0: 27, z1: 31, y0: 1, y1: 1, mat: COBBLE },
  { x0: 28, x1: 31, z0: 28, z1: 31, y0: 1, y1: 2, mat: COBBLE },
  { x0: 29, x1: 31, z0: 29, z1: 31, y0: 1, y1: 3, mat: PLANK },
  { x0: 31, x1: 31, z0: 31, z1: 31, y0: 1, y1: 5, mat: COBBLE, cap: GLOWSTONE },
  // Two stepped mid perches.
  { x0: 11, x1: 13, z0: 27, z1: 29, y0: 1, y1: 1, mat: COBBLE },
  { x0: 12, x1: 13, z0: 28, z1: 29, y0: 1, y1: 2, mat: PLANK, cap: GLOWSTONE },
  { x0: 27, x1: 29, z0: 11, z1: 13, y0: 1, y1: 1, mat: COBBLE },
  { x0: 28, x1: 29, z0: 12, z1: 13, y0: 1, y1: 2, mat: PLANK, cap: GLOWSTONE },
  // One sliver of central low cover — otherwise wide open.
  { x0: 17, x1: 19, z0: 17, z1: 17, y0: 1, y1: 2, mat: COBBLE },
];
// DESERT — explosives / verticality: open ground with raised plateaus, ramps and
// low walls to bank rockets and the black hole around. Splash + zoning rule.
const DESERT_STRUCT = [
  { x0: 8, x1: 14, z0: 8, z1: 14, y0: 1, y1: 2, mat: COBBLE },                      // raised plateau
  { x0: 15, x1: 16, z0: 9, z1: 13, y0: 1, y1: 1, mat: COBBLE },                     // ramp step up
  { x0: 9, x1: 13, z0: 15, z1: 16, y0: 1, y1: 1, mat: COBBLE },
  { x0: 22, x1: 30, z0: 26, z1: 27, y0: 1, y1: 2, mat: PLANK },                     // long low walls (rocket banks)
  { x0: 26, x1: 27, z0: 22, z1: 30, y0: 1, y1: 2, mat: PLANK },
  { x0: 28, x1: 30, z0: 6, z1: 12, y0: 1, y1: 3, mat: COBBLE, cap: GLOWSTONE },     // pillars
  { x0: 6, x1: 12, z0: 28, z1: 30, y0: 1, y1: 3, mat: COBBLE, cap: GLOWSTONE },
  { x0: 16, x1: 20, z0: 16, z1: 18, y0: 1, y1: 2, mat: COBBLE },                    // mid cover
];

// Re-skinnable arena themes. Each has its own palette (materials + light sources),
// decoration, and structural `layout` tuned for a different weapon style — so every
// map looks, is lit, AND plays differently. Material roles: f1/f2 floor checker,
// node lit-grid, wall/band/cren perimeter, daisStep/beacon/sheath centre, pin/pout
// structure cover.
export const ARENA_THEME_NAMES = ['ruins', 'jungle', 'frozen', 'desert'];
export const ARENA_THEMES = {
  ruins:  { f1: STONE, f2: COBBLE, node: GLOWSTONE, wall: COBBLE, band: GLOWSTONE, cren: GLASS,  daisStep: COBBLE, beacon: GLOWSTONE, sheath: GLASS, pin: COBBLE, pout: PLANK, decor: 'none',   layout: ARENA_STRUCT,  decorCenters: [] },
  jungle: { f1: GRASS, f2: GRASS,  node: GLOWSTONE, wall: LOG,    band: LEAVES,    cren: LEAVES, daisStep: COBBLE, beacon: GLOWSTONE, sheath: GLASS, pin: LOG,    pout: LOG,   decor: 'jungle', layout: JUNGLE_STRUCT, decorCenters: [[12, 12], [20, 20], [16, 28], [28, 16], [10, 24], [24, 10], [8, 8], [18, 8], [8, 18]] },
  frozen: { f1: SNOW,  f2: GLASS,  node: GLOWSTONE, wall: SNOW,   band: GLASS,     cren: GLASS,  daisStep: SNOW,   beacon: GLOWSTONE, sheath: GLASS, pin: GLASS,  pout: SNOW,  decor: 'frozen', layout: FROZEN_STRUCT, decorCenters: [[20, 20], [24, 10], [10, 24]] },
  desert: { f1: SAND,  f2: SAND,   node: GLOWSTONE, wall: SAND,   band: GLOWSTONE, cren: SAND,   daisStep: COBBLE, beacon: GLOWSTONE, sheath: GLASS, pin: COBBLE, pout: SAND,  decor: 'desert', layout: DESERT_STRUCT, decorCenters: [[12, 12], [20, 20], [30, 16], [16, 30]] },
};

// ---- War / D-Day beach (an asymmetric assault map) ----
// Allied storm in from the sea (high +Z) across an open, obstacle-studded beach,
// breach a seawall, and assault a fortified bluff of bunkers, MG nests and a
// trench (low -Z) to capture the command bunker. Axis defend from the line.
export const BEACH = { FLOOR: 50, HALF: 46, WALL_H: 9, OBJ_X: 0, OBJ_Z: -26, OBJ_R: 6, BOAT_DECK: 50 };
// Landing-craft positions [x,z] — the Allied storm ashore from these. The fleet is
// spread wide across the surf; soldiers spawn on the decks (BOAT_DECK) so the camera
// clears the water, then pour down the ramps.
export const BEACH_BOATS = [-40, -30, -20, -10, 0, 10, 20, 30, 40];
export const BEACH_SPAWN_ALLIED = BEACH_BOATS.map((x) => [x, 33]);
export const BEACH_SPAWN_AXIS = [[-30, 2], [-18, 1], [-6, -4], [6, 1], [18, 2], [30, 1], [-24, -5], [24, -5], [0, 2], [0, -6]];
// Defender hold points: MG nests on the bluff front + the bunkers behind.
export const BEACH_NESTS = [[-30, 4], [-18, 4], [-6, 4], [6, 4], [18, 4], [30, 4], [-24, -4], [0, -4], [24, -4]];

// Ground (top solid y) along the assault axis: deep sea -> surf -> long beach ->
// seawall shelf -> fortified bluff.
export function beachGroundY(wz) {
  const F = BEACH.FLOOR;
  if (wz >= 40) return F - 5;                                 // deep-water backdrop (behind the fleet, where the capital ship sits)
  if (wz >= 26) return F - Math.min(2, Math.round((wz - 26) * 0.22));  // gentle wadeable surf (0..2 deep) — you can always walk out, never stuck
  if (wz >= 6) return F;                                      // open killing beach
  if (wz >= 4) return F + 1;                                  // seawall shelf (MG nests)
  return F + 2;                                               // fortified bluff (bunkers, trench)
}

function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class WorldGen {
  constructor(seed = WORLD_SEED) {
    this.seed = seed;
    this.terrain = new SimplexNoise(seed);
    this.detail = new SimplexNoise(seed + 1);
    this.temp = new SimplexNoise(seed + 7);
    this.humid = new SimplexNoise(seed + 13);
    this.cave = new SimplexNoise(seed + 23);
    this.ore = new SimplexNoise(seed + 31);
    this._hCache = new Map();
    this.arena = false;          // when true, generate() builds the PvP arena
    this.beach = false;          // when true, generate() builds the D-Day beach
    this.arenaThemeName = 'ruins';
    this.T = ARENA_THEMES.ruins; // active arena re-skin palette
  }

  climate(wx, wz) {
    // Higher frequency => smaller biomes you can actually walk between.
    const t = this.temp.fbm2D(wx * 0.0042, wz * 0.0042, 3);
    const h = this.humid.fbm2D(wx * 0.0042 + 41.7, wz * 0.0042 - 19.3, 3);
    return [t, h];
  }

  biomeAt(wx, wz) {
    const [t, h] = this.climate(wx, wz);
    if (t > 0.35 && h < 0.0) return BIOME_DESERT;
    if (t < -0.3) return BIOME_SNOW;
    if (h > 0.25) return BIOME_FOREST;
    return BIOME_PLAINS;
  }

  // Terrain surface height (top solid y), cached per column.
  heightAt(wx, wz) {
    if (this.arena) {
      const m = Math.max(Math.abs(wx), Math.abs(wz));
      if (m > ARENA.HALF) return 0;
      if (m >= ARENA.HALF - 1) return ARENA.FLOOR + ARENA.WALL_H;
      return ARENA.FLOOR + 2;
    }
    if (this.beach) {
      const m = Math.max(Math.abs(wx), Math.abs(wz));
      if (m > BEACH.HALF) return 0;
      if (m >= BEACH.HALF - 2) return BEACH.FLOOR + BEACH.WALL_H + 3;
      return Math.max(BEACH.FLOOR, beachGroundY(wz)) + 2;     // approx (structures add a little)
    }
    const key = wx + ',' + wz;
    const cached = this._hCache.get(key);
    if (cached !== undefined) return cached;

    const cont = this.terrain.fbm2D(wx * 0.0034, wz * 0.0034, 4);   // continents
    const hills = this.detail.fbm2D(wx * 0.011, wz * 0.011, 3);     // rolling hills
    const mountain = Math.max(0, cont);
    let h = SEA_LEVEL + 2 + cont * 20 + hills * 9 + mountain * mountain * 34;
    h = Math.round(h);
    if (h < 4) h = 4;
    if (h > CHUNK_HEIGHT - 12) h = CHUNK_HEIGHT - 12;

    if (this._hCache.size > 200000) this._hCache.clear();
    this._hCache.set(key, h);
    return h;
  }

  surfaceBlock(wx, wz, surfaceY, biome) {
    // Beaches / sea floor.
    if (surfaceY <= SEA_LEVEL + 1) {
      if (surfaceY >= SEA_LEVEL - 4) return SAND;
      return biome === BIOME_DESERT ? SAND : DIRT;
    }
    if (biome === BIOME_DESERT) return SAND;
    if (biome === BIOME_SNOW || surfaceY > SEA_LEVEL + 34) return SNOW;
    return GRASS;
  }

  subSurfaceBlock(biome) {
    return biome === BIOME_DESERT ? SAND : DIRT;
  }

  // Fill one chunk: terrain, caves, ores, water, then decorations (trees/cacti).
  generate(chunk) {
    if (this.arena) return this.generateArena(chunk);
    if (this.beach) return this.generateBeach(chunk);
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const surfaceY = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz);
        const surfBlock = this.surfaceBlock(wx, wz, surfaceY, biome);
        const subBlock = this.subSurfaceBlock(biome);

        for (let y = 0; y <= surfaceY; y++) {
          let block;
          if (y === 0) block = BEDROCK;
          else if (y <= 2 && hash2(wx * 7 + y, wz * 7) < 0.5) block = BEDROCK;
          else if (y === surfaceY) block = surfBlock;
          else if (y > surfaceY - 4) block = subBlock;
          else block = STONE;

          // Caves: carve a 3D-noise cheese below the surface skin.
          if (block === STONE || (block === subBlock && y < surfaceY - 1)) {
            const cn = this.cave.noise3D(wx * 0.05, y * 0.07, wz * 0.05);
            const cn2 = this.cave.noise3D(wx * 0.025 + 13, y * 0.03, wz * 0.025 + 7);
            if (cn > 0.62 || (cn + cn2) > 1.15) {
              if (y > 1) { chunk.setLocal(lx, y, lz, AIR); continue; }
            }
          }

          // Ore veins in stone (depth-banded).
          if (block === STONE) {
            const depth = surfaceY - y;
            const on = this.ore.noise3D(wx * 0.11, y * 0.11, wz * 0.11);
            if (depth > 4 && on > 0.78) block = COAL_ORE;
            else if (depth > 12 && y < SEA_LEVEL && this.ore.noise3D(wx * 0.13 + 50, y * 0.13, wz * 0.13) > 0.82) block = IRON_ORE;
            else if (depth > 3 && hash2(wx + y * 31, wz - y * 17) < 0.012) block = GRAVEL;
          }

          chunk.setLocal(lx, y, lz, block);
        }

        // Water fills carved/empty cells up to sea level.
        for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
          if (chunk.getLocal(lx, y, lz) === AIR) chunk.setLocal(lx, y, lz, WATER);
        }
      }
    }

    this.decorate(chunk, ox, oz);
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  // Trees / cacti — iterate a margin of neighbouring columns so canopies that
  // overhang into this chunk get stamped (each chunk stamps only its own cells).
  decorate(chunk, ox, oz) {
    const M = 3;
    for (let lz = -M; lz < CHUNK_SIZE + M; lz++) {
      for (let lx = -M; lx < CHUNK_SIZE + M; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const r = hash2(wx * 911 + 5, wz * 733 + 17);
        const biome = this.biomeAt(wx, wz);
        const surfaceY = this.heightAt(wx, wz);
        if (surfaceY <= SEA_LEVEL) continue; // no trees in water

        if (biome === BIOME_FOREST && r < 0.055) {
          this.stampTree(chunk, lx, lz, surfaceY, false);
        } else if (biome === BIOME_PLAINS && r < 0.016) {
          this.stampTree(chunk, lx, lz, surfaceY, false);
        } else if (biome === BIOME_SNOW && r < 0.02) {
          this.stampTree(chunk, lx, lz, surfaceY, true);
        } else if (biome === BIOME_DESERT && r < 0.010) {
          this.stampCactus(chunk, lx, lz, surfaceY);
        }
      }
    }
  }

  stampTree(chunk, lx, lz, surfaceY, spruce) {
    const wx = chunk.cx * CHUNK_SIZE + lx, wz = chunk.cz * CHUNK_SIZE + lz;
    const trunkH = (spruce ? 5 : 4) + Math.floor(hash2(wx + 3, wz - 9) * 3);
    const top = surfaceY + trunkH;
    if (top + 2 >= CHUNK_HEIGHT) return;

    // Canopy (stamp before trunk so trunk stays visible at the very top).
    for (let oy = -2; oy <= 2; oy++) {
      const yy = top + oy;
      let rad;
      if (spruce) rad = oy <= -1 ? 2 : oy === 0 ? 1 : oy === 1 ? 1 : 0;
      else rad = oy <= 0 ? 2 : 1;
      if (rad === 0) { chunk.setLocalIfAir(lx, yy, lz, LEAVES); continue; }
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx === 0 && dz === 0 && yy < top) continue; // leave trunk core
          if (rad === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 &&
              hash2(wx + dx * 13 + yy, wz + dz * 7) < 0.55) continue; // trim corners
          chunk.setLocalIfAir(lx + dx, yy, lz + dz, LEAVES);
        }
      }
    }
    // Trunk.
    for (let y = 1; y <= trunkH; y++) chunk.setLocal(lx, surfaceY + y, lz, LOG);
  }

  stampCactus(chunk, lx, lz, surfaceY) {
    const wx = chunk.cx * CHUNK_SIZE + lx, wz = chunk.cz * CHUNK_SIZE + lz;
    const h = 2 + Math.floor(hash2(wx - 1, wz + 4) * 3);
    for (let y = 1; y <= h; y++) chunk.setLocal(lx, surfaceY + y, lz, CACTUS);
  }

  // The PvP arena: a bounded, four-fold-symmetric map — checkered floor, a lit
  // perimeter wall, a raised central beacon, pillars and cover. Outside the
  // bounds is void, so the wall keeps everyone in the fight.
  generateArena(chunk) {
    // Each theme supplies its own unique topology builder; ruins falls back to the
    // classic re-skinnable arena layout.
    if (this.arenaThemeName === 'jungle') return this._buildJungleArena(chunk);
    if (this.arenaThemeName === 'frozen') return this._buildFrozenArena(chunk);
    if (this.arenaThemeName === 'desert') return this._buildDesertArena(chunk);
    if (this.arenaThemeName === 'ruins') return this._buildRuinsArena(chunk);
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const F = ARENA.FLOOR, HALF = ARENA.HALF, WH = ARENA.WALL_H;
    const T = this.T || ARENA_THEMES.ruins;       // active theme palette
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const ax = Math.abs(wx), az = Math.abs(wz), m = Math.max(ax, az), inr = Math.min(ax, az);
        if (m > HALF) continue;                         // void beyond the arena

        // Foundation + themed floor with a glowing inlay grid.
        chunk.setLocal(lx, F - 2, lz, BEDROCK);
        chunk.setLocal(lx, F - 1, lz, BEDROCK);
        let floor = (((wx >> 2) + (wz >> 2)) & 1) ? T.f1 : T.f2;
        if (m < HALF - 1 && wx % 12 === 0 && wz % 12 === 0) floor = T.node;     // lit grid nodes
        chunk.setLocal(lx, F, lz, floor);

        // Perimeter wall: themed material with glowing bands + sconces on the inner
        // face, accented crenellations.
        if (m >= HALF - 1) {
          for (let y = 1; y <= WH; y++) {
            let wmat = T.wall;
            if (m === HALF - 1 && (y === 4 || y === 8)) wmat = T.band;             // glowing bands
            if (m === HALF - 1 && y === 6 && inr % 6 === 2) wmat = T.band;         // sconces
            chunk.setLocal(lx, F + y, lz, wmat);
          }
          chunk.setLocal(lx, F + WH + 1, lz, ((ax + az) & 1) === 0 ? T.cren : T.wall);  // crenellations
          continue;
        }

        // Central luminous dais: a stepped platform crowned with a beacon in a sheath.
        if (m <= 6) {
          const h = m <= 2 ? 3 : m <= 4 ? 2 : 1;
          for (let y = 1; y <= h; y++) chunk.setLocal(lx, F + y, lz, (y === h && m <= 2) ? T.beacon : T.daisStep);
          if (m === 4 && ax === az) chunk.setLocal(lx, F + h + 1, lz, T.beacon);       // corner lamps
          if (m <= 1) for (let y = 4; y <= 8; y++) chunk.setLocal(lx, F + y, lz, m === 0 ? T.beacon : T.sheath); // glowing beacon
          if (ax === 0 && az === 0) chunk.setLocal(lx, F + 9, lz, T.beacon);            // crowning beacon
          continue;
        }

        // Mirrored structures (pillars, cover, stages, towers, braziers) — remapped
        // to the theme: cool cover → pin, warm cover → pout, glow caps → beacon.
        for (const s of (T.layout || ARENA_STRUCT)) {
          if (ax >= s.x0 && ax <= s.x1 && az >= s.z0 && az <= s.z1) {
            const mat = s.mat === PLANK ? T.pout : T.pin;
            for (let y = s.y0; y <= s.y1; y++) chunk.setLocal(lx, F + y, lz, mat);
            if (s.cap) chunk.setLocal(lx, F + s.y1 + 1, lz, T.beacon);
          }
        }

        // Themed decoration (jungle trees + puddles, frozen ice spikes, desert cacti).
        if (T.decor !== 'none' && m > 6 && m < HALF - 2) this.arenaDecor(chunk, lx, lz, F, ax, az, T.decor, T.decorCenters);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  // Stamp mirrored, theme-specific decoration around the arena decor anchors. Folded
  // (ax,az) coords mean every feature appears identically in all four quadrants.
  arenaDecor(chunk, lx, lz, F, ax, az, decor, centers) {
    for (const [cx, cz] of (centers || [])) {
      const dx = Math.abs(ax - cx), dz = Math.abs(az - cz), cheb = Math.max(dx, dz);
      if (cheb > 2) continue;
      if (decor === 'jungle') {
        if (cheb === 0) for (let y = 1; y <= 5; y++) chunk.setLocal(lx, F + y, lz, LOG);   // trunk
        if (cheb <= 2) { chunk.setLocal(lx, F + 4, lz, LEAVES); chunk.setLocal(lx, F + 5, lz, LEAVES); }
        if (cheb <= 1) chunk.setLocal(lx, F + 6, lz, LEAVES);                               // canopy crown
      } else if (decor === 'frozen') {
        if (cheb === 0) for (let y = 1; y <= 5; y++) chunk.setLocal(lx, F + y, lz, GLASS);  // tall ice spike
        else if (cheb === 1 && dx + dz === 1) for (let y = 1; y <= 2; y++) chunk.setLocal(lx, F + y, lz, GLASS);
      } else if (decor === 'desert') {
        if (cheb === 0) for (let y = 1; y <= 3; y++) chunk.setLocal(lx, F + y, lz, CACTUS); // cactus
        else if (cheb === 1 && dx + dz === 1) chunk.setLocal(lx, F + 1, lz, SAND);          // sand mound
      }
    }
    // Jungle: shallow water puddles in a couple of clearings (1 deep — wade-through).
    if (decor === 'jungle') {
      for (const [cx, cz] of [[30, 8], [8, 30]]) {
        if (Math.max(Math.abs(ax - cx), Math.abs(az - cz)) <= 2) chunk.setLocal(lx, F, lz, WATER);
      }
    }
  }

  // ---- JUNGLE arena (unique topology) ----
  // A climbable stepped temple ziggurat crowned with a glowing idol, ringed by a
  // wade-through moat crossed by four cardinal bridges, all sunk in dense jungle:
  // short sightlines, vertical fights up the temple, water that slows you, leaf
  // cover that blocks fire. Four-fold symmetric (fair for FFA), fully deterministic.
  _buildJungleArena(chunk) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const F = ARENA.FLOOR, HALF = ARENA.HALF, WH = ARENA.WALL_H;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const ax = Math.abs(wx), az = Math.abs(wz), m = Math.max(ax, az), inr = Math.min(ax, az);
        if (m > HALF) continue;                          // void beyond the arena
        chunk.setLocal(lx, F - 2, lz, BEDROCK);
        chunk.setLocal(lx, F - 1, lz, BEDROCK);

        // Overgrown stone rampart with draping vines + a leafy parapet (keeps you in).
        if (m >= HALF - 1) {
          for (let y = 1; y <= WH; y++) {
            const vine = m === HALF - 1 && y >= WH - 3 && (inr + y) % 3 === 0;
            chunk.setLocal(lx, F + y, lz, vine ? LEAVES : COBBLE);
          }
          chunk.setLocal(lx, F + WH + 1, lz, ((ax + az) & 1) === 0 ? LEAVES : LOG);
          continue;
        }

        // Jungle floor (grass with scattered dirt) — structures below overwrite it.
        chunk.setLocal(lx, F, lz, hash2(wx, wz) < 0.16 ? DIRT : GRASS);

        // Central stepped ziggurat: 1-high steps two wide (walkable), mossy stone with
        // a grassy tread, crowned by a glowing idol shrine.
        if (m <= 12) {
          const h = Math.max(0, 6 - (m >> 1));
          for (let y = 1; y <= h; y++) chunk.setLocal(lx, F + y, lz, y === h ? GRASS : COBBLE);
          if (m === 0) { for (let y = 7; y <= 9; y++) chunk.setLocal(lx, F + y, lz, GLOWSTONE); }   // idol
          else if (m === 1 && (ax === 0 || az === 0)) { chunk.setLocal(lx, F + 7, lz, LOG); chunk.setLocal(lx, F + 8, lz, LEAVES); }  // shrine posts
          continue;
        }

        // Temple moat: a 1-deep wade-through ring (slows you), crossed by four 3-wide
        // plank bridges on the cardinal axes (run across dry, or drop in for cover).
        if (m >= 13 && m <= 16) {
          if (inr <= 1) chunk.setLocal(lx, F, lz, PLANK);   // bridge deck (level with the banks)
          else chunk.setLocal(lx, F, lz, WATER);
          continue;
        }

        // Outer jungle: big trees + low root/bush cover.
        this._jungleForest(chunk, lx, lz, F, ax, az);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  // Stamp the outer-ring jungle: tall trees at mirrored anchors (kept clear of the
  // eight spawn pads) plus a little deterministic low cover.
  _jungleForest(chunk, lx, lz, F, ax, az) {
    const TREES = [[20, 20], [30, 30], [28, 13], [13, 28], [22, 34], [34, 22], [18, 33], [33, 18]];
    for (const [cx, cz] of TREES) {
      const d = Math.max(Math.abs(ax - cx), Math.abs(az - cz));
      if (d > 2) continue;
      if (d === 0) for (let y = 1; y <= 6; y++) chunk.setLocal(lx, F + y, lz, LOG);   // trunk
      if (d <= 2) { chunk.setLocal(lx, F + 5, lz, LEAVES); chunk.setLocal(lx, F + 6, lz, LEAVES); }
      if (d <= 1) chunk.setLocal(lx, F + 7, lz, LEAVES);                              // crown
    }
    // Keep a 3×3 clear pad at each (mirrored) spawn anchor so nobody spawns in cover.
    for (const [sx, sz] of [[34, 0], [0, 34], [24, 24]]) if (Math.max(Math.abs(ax - sx), Math.abs(az - sz)) <= 1) return;
    const h = hash2(ax * 7 + 3, az * 7 + 3);
    if (h > 0.94) chunk.setLocal(lx, F + 1, lz, LEAVES);        // shrub
    else if (h < 0.035) for (let y = 1; y <= 2; y++) chunk.setLocal(lx, F + y, lz, LOG);  // fallen-log cover
  }

  // ---- FROZEN arena (unique topology) ----
  // A wide, open frozen lake — slippery ice underfoot, sweeping sightlines for snipers,
  // ringed by snowy mountain ramparts. Stepped ice perches give the high ground; the
  // centre is thin ice over a freezing pool you crash through if you linger there.
  _buildFrozenArena(chunk) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const F = ARENA.FLOOR, HALF = ARENA.HALF, WH = ARENA.WALL_H;
    const PERCHES = [[30, 30], [12, 30], [30, 12]];
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const ax = Math.abs(wx), az = Math.abs(wz), m = Math.max(ax, az), inr = Math.min(ax, az);
        if (m > HALF) continue;
        chunk.setLocal(lx, F - 2, lz, BEDROCK);
        chunk.setLocal(lx, F - 1, lz, BEDROCK);

        // Snowy mountain rampart with an icy parapet.
        if (m >= HALF - 1) {
          for (let y = 1; y <= WH; y++) chunk.setLocal(lx, F + y, lz, m === HALF - 1 && (y === 4 || y === 8) ? GLASS : SNOW);
          chunk.setLocal(lx, F + WH + 1, lz, ((ax + az) & 1) === 0 ? GLASS : SNOW);
          continue;
        }

        // Frozen lake floor (slippery ice everywhere; structures overwrite).
        chunk.setLocal(lx, F, lz, ICE);

        // Central thin ice → a freezing pool you fall into in the open (1 deep, so you
        // can still wade/scramble out — it slows you in the exposed middle).
        if (m <= 6) {
          if (m <= 5) chunk.setLocal(lx, F, lz, WATER);
          else if (((ax + az) & 1) === 0) chunk.setLocal(lx, F, lz, GLASS);   // cracked-ice lip ring
          continue;
        }

        // Stepped ice perches (the sniper high ground) + a glowing cap.
        let onPerch = false;
        for (const [cx, cz] of PERCHES) {
          const d = Math.max(Math.abs(ax - cx), Math.abs(az - cz));
          if (d > 3) continue;
          onPerch = true;
          const h = 4 - d;                                  // stepped pyramid, 1-high treads
          for (let y = 1; y <= h; y++) chunk.setLocal(lx, F + y, lz, y === h ? GLASS : COBBLE);
          if (d === 0) chunk.setLocal(lx, F + h + 1, lz, GLOWSTONE);
        }
        if (onPerch) continue;

        // Sparse low snow drifts for a sliver of cover (kept off the spawn pads).
        if ([[34, 0], [0, 34], [24, 24]].some(([sx, sz]) => Math.max(Math.abs(ax - sx), Math.abs(az - sz)) <= 1)) continue;
        const hs = hash2(ax * 5 + 9, az * 5 + 9);
        if (hs > 0.965) chunk.setLocal(lx, F + 1, lz, SNOW);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  // ---- DESERT arena (unique topology) ----
  // A mesa canyon: a tall central butte you fight up to, four raised corner plateaus
  // with stepped ramp skirts, and plank catwalks bridging them over the sand floor.
  // Strong verticality — high ground and banked rockets / black-holes rule.
  _buildDesertArena(chunk) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const F = ARENA.FLOOR, HALF = ARENA.HALF, WH = ARENA.WALL_H;
    const MESA = [[31, 31, 6, 4], [11, 30, 6, 3], [30, 11, 6, 3]];   // [cx, cz, radius, height] (clear of the corner spawn pads)
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const ax = Math.abs(wx), az = Math.abs(wz), m = Math.max(ax, az), inr = Math.min(ax, az);
        if (m > HALF) continue;
        chunk.setLocal(lx, F - 2, lz, BEDROCK);
        chunk.setLocal(lx, F - 1, lz, BEDROCK);
        chunk.setLocal(lx, F, lz, SAND);                  // flat canyon floor (structures rise above)

        // Banded sandstone canyon wall ringing the arena.
        if (m >= HALF - 1) {
          for (let y = 1; y <= WH; y++) chunk.setLocal(lx, F + y, lz, (y === 3 || y === 7) ? COBBLE : SAND);
          chunk.setLocal(lx, F + WH + 1, lz, SAND);
          continue;
        }

        // Central butte: a tall stepped mesa with a glowing top (the prize / KOTH).
        if (m <= 9) {
          const h = m <= 1 ? 7 : m <= 3 ? 6 : m <= 5 ? 5 : m <= 7 ? 4 : 2;   // 2-wide treads, climbable
          for (let y = 1; y <= h; y++) chunk.setLocal(lx, F + y, lz, y === h ? COBBLE : SAND);
          if (m === 0) for (let y = 8; y <= 9; y++) chunk.setLocal(lx, F + y, lz, GLOWSTONE);
          else if (m <= 1) chunk.setLocal(lx, F + 8, lz, COBBLE);
          continue;
        }

        // Corner plateaus with a stepped ramp skirt so they're walkable up.
        let built = false;
        for (const [cx, cz, r, ph] of MESA) {
          const d = Math.max(Math.abs(ax - cx), Math.abs(az - cz));
          if (d > r) continue;
          built = true;
          const top = d <= r - ph ? ph : Math.max(1, ph - (d - (r - ph)));   // flat top, stepped rim
          for (let y = 1; y <= top; y++) chunk.setLocal(lx, F + y, lz, y === top ? COBBLE : SAND);
        }
        if (built) continue;

        // Plank catwalks along the axes linking the butte to the corner plateaus.
        if (inr <= 1 && m >= 9 && m <= 21) { chunk.setLocal(lx, F + 3, lz, PLANK); continue; }

        // A little low cover on the open sand (off the spawn pads).
        if ([[34, 0], [0, 34], [24, 24]].some(([sx, sz]) => Math.max(Math.abs(ax - sx), Math.abs(az - sz)) <= 1)) continue;
        if (hash2(ax * 5 + 2, az * 5 + 2) > 0.955) chunk.setLocal(lx, F + 1, lz, SAND);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  // ---- RUINS arena (unique topology) ----
  // An inverted map: a sunken central LAVA pit (a ring-out hazard you knock foes into)
  // crowned by a glowing broken obelisk, framed by a low rim, and ringed by a raised
  // colonnade of broken pillars for mid-range cover. The pit's rim lip keeps bots from
  // wandering in — only knockback (rockets / black hole / melee) dunks them.
  _buildRuinsArena(chunk) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const F = ARENA.FLOOR, HALF = ARENA.HALF, WH = ARENA.WALL_H;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const ax = Math.abs(wx), az = Math.abs(wz), m = Math.max(ax, az), inr = Math.min(ax, az);
        if (m > HALF) continue;
        chunk.setLocal(lx, F - 2, lz, BEDROCK);
        chunk.setLocal(lx, F - 1, lz, BEDROCK);

        // Dark ritual perimeter wall with glowing bands + crenellations.
        if (m >= HALF - 1) {
          for (let y = 1; y <= WH; y++) {
            let wmat = COBBLE;
            if (m === HALF - 1 && (y === 4 || y === 8)) wmat = GLOWSTONE;
            if (m === HALF - 1 && y === 6 && inr % 6 === 2) wmat = GLOWSTONE;
            chunk.setLocal(lx, F + y, lz, wmat);
          }
          chunk.setLocal(lx, F + WH + 1, lz, ((ax + az) & 1) === 0 ? GLASS : COBBLE);
          continue;
        }

        // Checkered stone floor everywhere (the colonnade ring surface).
        chunk.setLocal(lx, F, lz, (((wx >> 2) + (wz >> 2)) & 1) ? STONE : COBBLE);

        // Sunken lava pit + a 2-high rim lip that protects roamers (only knockback dunks you).
        if (m <= 10) {
          if (m >= 9) { chunk.setLocal(lx, F + 1, lz, COBBLE); chunk.setLocal(lx, F + 2, lz, COBBLE); }   // rim lip
          else {
            chunk.setLocal(lx, F, lz, AIR); chunk.setLocal(lx, F - 1, lz, AIR);
            chunk.setLocal(lx, F - 4, lz, BEDROCK);
            for (let y = F - 3; y <= F - 1; y++) chunk.setLocal(lx, y, lz, LAVA);   // 3-deep lava
          }
          // Broken obelisk rising from the lava through the pit (glowing crown).
          if (m === 0) { for (let y = F - 3; y <= F + 5; y++) chunk.setLocal(lx, y, lz, y >= F + 4 ? GLOWSTONE : COBBLE); }
          else if (m <= 1) { for (let y = F - 3; y <= F + 2; y++) chunk.setLocal(lx, y, lz, COBBLE); }
          continue;
        }

        // Raised colonnade: broken stone pillars for cover, mirrored to all quadrants.
        this._ruinsColonnade(chunk, lx, lz, F, ax, az);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }
  _ruinsColonnade(chunk, lx, lz, F, ax, az) {
    const PILL = [[14, 14, 5], [22, 14, 4], [14, 22, 4], [26, 26, 6], [32, 16, 3], [16, 32, 3], [33, 33, 5]];
    for (const [cx, cz, ph] of PILL) {
      if (ax === cx && az === cz) { for (let y = 1; y <= ph; y++) chunk.setLocal(lx, F + y, lz, y === ph ? GLOWSTONE : COBBLE); return; }
      // A broken stub beside some pillars (rubble cover).
      if (Math.abs(ax - cx) + Math.abs(az - cz) === 1 && ph >= 4) { chunk.setLocal(lx, F + 1, lz, COBBLE); return; }
    }
    // Low broken walls linking pillar pairs for waist-high cover.
    if ((ax === 18 && az >= 14 && az <= 22) || (az === 18 && ax >= 14 && ax <= 22)) { chunk.setLocal(lx, F + 1, lz, COBBLE); }
  }

  // Select the arena re-skin (materials + decoration) used by generateArena.
  setArenaTheme(name) {
    this.arenaThemeName = ARENA_THEMES[name] ? name : 'ruins';
    this.T = ARENA_THEMES[this.arenaThemeName];
  }

  // The D-Day beach: sea + landing craft (high +Z) -> open obstacle-strewn beach
  // -> seawall -> a fortified bluff of bunkers / MG nests / trench -> the Axis
  // command bunker (low -Z). Bounded by a containing cliff so nobody falls out.
  generateBeach(chunk) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const F = BEACH.FLOOR, HALF = BEACH.HALF, WH = BEACH.WALL_H;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const m = Math.max(Math.abs(wx), Math.abs(wz));
        if (m > HALF) continue;                                    // void beyond the map
        const gy = beachGroundY(wz);
        // Containing bluff — a THICK, tall natural cliff on the map edges, kept far
        // from the action (no thin boxes to snag on, like the old wall).
        if (m >= HALF - 2) {
          for (let y = F - 8; y <= F + WH + 3; y++) chunk.setLocal(lx, y, lz, y <= F - 7 ? BEDROCK : (y >= F + WH + 1 ? GRAVEL : STONE));
          continue;
        }
        const topMat = wz < 6 ? GRAVEL : SAND;                     // shingle bluff / sandy beach
        for (let y = F - 7; y <= gy; y++) chunk.setLocal(lx, y, lz, y <= F - 7 ? BEDROCK : y >= gy - 2 ? topMat : STONE);
        for (let y = gy + 1; y <= F; y++) if (chunk.getLocal(lx, y, lz) === AIR) chunk.setLocal(lx, y, lz, WATER);
        this.beachProps(chunk, lx, lz, wx, wz, gy);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  beachProps(chunk, lx, lz, wx, wz, gy) {
    const F = BEACH.FLOOR, DECK = BEACH.BOAT_DECK;
    const set = (y, b) => chunk.setLocal(lx, y, lz, b);
    const h = hash2(wx, wz);

    // ---- The fleet: a grand capital ship offshore + a wide line of landing craft. ----
    this.beachBattleship(chunk, lx, lz, wx, wz, set);
    for (const cx of BEACH_BOATS) {
      const dx = Math.abs(wx - cx);
      if (dx <= 2 && wz >= 31 && wz <= 37) {
        for (let y = DECK - 2; y <= DECK; y++) set(y, y === DECK ? PLANK : COBBLE);   // hull + deck
        if (dx === 2 || wz === 37) { set(DECK + 1, PLANK); set(DECK + 2, PLANK); }    // side/stern walls — open bow
        if (wz === 37 && dx === 0) { set(DECK + 3, IRON_ORE); set(DECK + 4, COAL_ORE); }  // stern gun tub
      }
      // Flat bow ramp / gangway STRAIGHT to the beach at deck level so troops storm
      // ashore over the (now shallow) surf instead of getting stuck in deep water.
      if (dx <= 1 && wz >= 24 && wz <= 30) set(DECK, PLANK);
    }
    // Burning, half-sunk wrecks listing in the surf.
    for (const [cx, cz] of [[-45, 31], [45, 29], [-15, 30], [21, 32]]) {
      if (Math.abs(wx - cx) <= 2 && Math.abs(wz - cz) <= 1) {
        set(F - 1, COBBLE); if (((wx + wz) & 1) === 0) set(F, IRON_ORE);
        if (wx === cx && wz === cz) { set(F + 1, COAL_ORE); set(F + 2, GLOWSTONE); }  // fire glow
      }
    }

    // ---- The killing beach: hedgehogs, dragon's teeth, gates, wire, craters, wrecks. ----
    if (wz >= 8 && wz <= 25) {
      if (h < 0.030) { set(gy + 1, IRON_ORE); set(gy + 2, LOG); set(gy + 3, IRON_ORE); }    // Czech hedgehog
      else if (h < 0.048) { set(gy + 1, COBBLE); set(gy + 2, COBBLE); }                     // dragon's tooth (concrete)
      else if (h < 0.062) { set(gy + 1, LOG); set(gy + 2, LOG); }                           // Belgian-gate post
      else if (h < 0.080) set(gy + 1, GRAVEL);                                              // sandbag / debris
      else if (h < 0.094) { set(gy, AIR); set(gy - 1, COAL_ORE); }                          // scorched shell crater
      else if (h < 0.102) set(gy + 1, IRON_ORE);                                            // dropped helmet / kit
    }
    // Barbed-wire stake lines strung across the beach.
    if ((wz === 9 || wz === 15 || wz === 21) && (((wx % 3) + 3) % 3) === 0) set(F + 1, IRON_ORE);
    // Knocked-out tanks burning on the sand.
    for (const [cx, cz] of [[-26, 18], [12, 13], [34, 20]]) {
      if (Math.abs(wx - cx) <= 2 && Math.abs(wz - cz) <= 1) {
        set(F + 1, COAL_ORE); if (Math.abs(wx - cx) <= 1 && wz === cz) set(F + 2, IRON_ORE);
        if (wx === cx && wz === cz) set(F + 3, GLOWSTONE);                                  // turret fire
      }
    }

    // ---- Seawall: a substantial concrete wall (3 high) with frequent wide breaches
    // (6-wide gap every 12) so the assault can pour through onto the bluff. A low
    // firing embrasure is notched in front of every MG nest, otherwise the wall
    // masks the whole defensive line and the guns can't see the beach to fire. ----
    if (wz === 6 && (((wx % 12) + 12) % 12) >= 6) {
      if (BEACH_NESTS.some(([nx]) => Math.abs(wx - nx) <= 1)) set(F + 1, COBBLE);   // embrasure: low lip only — clear field of fire
      else { set(F + 1, COBBLE); set(F + 2, COBBLE); set(F + 3, GRAVEL); }
    }

    // ---- MG nests on the shelf: a 1-high sandbag lip + gun across the FRONT (z=5,
    // toward the beach) with the gunner's slot (z=4) kept clear behind it, so the
    // defender can actually stand on the nest and fire over the lip. The old layout
    // put solid blocks where the defender needed to stand, shoving them off the line. ----
    for (const [nx] of BEACH_NESTS) {
      const dxn = Math.abs(wx - nx);
      if (dxn <= 2 && wz === 5) set(F + 2, GRAVEL);      // front sandbag lip (toward the beach)
      if (dxn === 2 && wz === 4) set(F + 2, GRAVEL);     // side sandbags
      if (wx === nx && wz === 5) set(F + 2, COAL_ORE);   // the MG on the lip — same height, never masks the gunner
    }

    // ---- Bunkers on the bluff: taller hollow cobble shells with a beach-facing slit. ----
    for (const cx of [-34, -18, 18, 34]) {
      if (Math.abs(wx - cx) <= 3 && wz >= -7 && wz <= -2) {
        set(F + 6, COBBLE);                                        // roof
        const onWall = Math.abs(wx - cx) === 3 || wz === -7 || wz === -2;
        if (onWall) { for (let y = F + 3; y <= F + 5; y++) if (!(wz === -2 && y === F + 4)) set(y, COBBLE); }  // wall + firing slit
        else for (let y = F + 3; y <= F + 5; y++) set(y, AIR);     // hollow interior
        if (wx === cx && wz === -7) set(F + 7, GLOWSTONE);         // lamp
      }
    }
    // AA gun emplacements ringing the bluff (raised pit, angled barrel, tracer glow).
    for (const cx of [-26, 8, 26]) {
      if (Math.abs(wx - cx) <= 1 && wz >= -5 && wz <= -4) set(F + 3, COBBLE);
      if (wx === cx && wz === -4) { set(F + 3, IRON_ORE); set(F + 4, COAL_ORE); set(F + 5, GLOWSTONE); }
    }

    // ---- Trench tying the line together: 1 deep. (No raised lip — it sat at eye
    // height and masked the whole second line's field of fire onto the beach.) ----
    if (wz >= -1 && wz <= 1 && Math.abs(wx) <= 40) set(F + 2, AIR);

    this.beachObjective(chunk, lx, lz, wx, wz);
  }

  // Offshore capital ship — a grand naval backdrop bombarding the beach (sits in the
  // deep-water band behind the fleet, against the containing cliff).
  beachBattleship(chunk, lx, lz, wx, wz, set) {
    const F = BEACH.FLOOR;
    if (wz < 39 || wz > 43) return;
    const cz = 41, dz = Math.abs(wz - cz), ax = Math.abs(wx), halfLen = 34;
    if (ax > halfLen) return;
    const taper = halfLen - ax;                       // hull narrows to bow/stern points
    const beamW = taper > 8 ? 2 : (taper > 3 ? 1 : 0);
    if (dz <= beamW) for (let y = F - 4; y <= F + 1; y++) set(y, y <= F - 3 ? STONE : (y === F + 1 ? GRAVEL : COBBLE));  // hull + deck
    if (ax <= 5 && dz <= 1) for (let y = F + 2; y <= F + 8; y++) set(y, COBBLE);                                         // bridge
    if (ax <= 1 && dz === 0) for (let y = F + 9; y <= F + 13; y++) set(y, y < F + 13 ? COBBLE : GLOWSTONE);             // mast + signal beacon
    for (const tx of [-20, 20]) if (Math.abs(wx - tx) <= 2 && dz <= 1) { set(F + 2, IRON_ORE); set(F + 3, COAL_ORE); }  // main turrets
    for (const tx of [-9, 9]) if (Math.abs(wx - tx) <= 1 && dz === 0) { set(F + 3, COBBLE); set(F + 4, COAL_ORE); }     // funnels
  }

  // The Axis command bunker + flag — the Allied capture objective at the rear. A
  // roofed emplacement, OPEN on the beach-facing side so the assault can storm in.
  beachObjective(chunk, lx, lz, wx, wz) {
    const F = BEACH.FLOOR, ox = BEACH.OBJ_X, oz = BEACH.OBJ_Z;
    const set = (y, b) => chunk.setLocal(lx, y, lz, b);
    const ddx = Math.abs(wx - ox);
    if (ddx <= 5 && wz >= oz - 4 && wz <= oz + 4) {
      set(F + 7, COBBLE);                                          // roof overhead
      const backOrSide = (wz === oz - 4) || (ddx === 5 && wz < oz + 4);
      if (backOrSide) for (let y = F + 3; y <= F + 6; y++) set(y, COBBLE);       // back + side walls
      else if (wz !== oz + 4) for (let y = F + 3; y <= F + 6; y++) set(y, AIR);  // hollow interior
      if (ddx === 5 && wz === oz + 4) for (let y = F + 3; y <= F + 6; y++) set(y, COBBLE);  // front corner pillars hold the roof
    }
    if (wx === ox && wz === oz) for (let y = F + 3; y <= F + 10; y++) set(y, y < F + 9 ? COBBLE : GLOWSTONE);  // flagpole + beacon
    if (wx === ox + 1 && wz === oz) for (let y = F + 7; y <= F + 9; y++) set(y, WOOL);   // flag cloth
  }
}
