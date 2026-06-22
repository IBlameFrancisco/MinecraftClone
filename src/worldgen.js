// Procedural world generation: multi-octave terrain height, climate-driven
// biomes, 3D-noise caves, ore veins, water/beaches and trees. Every value is a
// deterministic function of world coordinates, so chunks tile seamlessly with
// no cross-chunk ordering dependencies.

import { SimplexNoise } from './noise.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL, WORLD_SEED } from './constants.js';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, SNOW,
  COAL_ORE, IRON_ORE, BEDROCK, GRAVEL, CACTUS, COBBLE, PLANK, WOOL, GLOWSTONE, TORCH, GLASS,
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

// Re-skinnable arena palettes. The layout is identical across every theme (the
// same balanced, mirrored map), but the materials, light sources and a little
// decoration change — so each map plays the same yet looks, and is lit, wholly
// different. Material roles: f1/f2 floor checker, node lit-grid, wall/band/cren
// perimeter, daisStep/beacon/sheath centre, pin/pout structure cover.
export const ARENA_THEME_NAMES = ['ruins', 'jungle', 'frozen', 'desert'];
export const ARENA_THEMES = {
  ruins:  { f1: STONE, f2: COBBLE, node: GLOWSTONE, wall: COBBLE, band: GLOWSTONE, cren: GLASS,  daisStep: COBBLE, beacon: GLOWSTONE, sheath: GLASS, pin: COBBLE, pout: PLANK, decor: 'none' },
  jungle: { f1: GRASS, f2: GRASS,  node: GLOWSTONE, wall: LOG,    band: LEAVES,    cren: LEAVES, daisStep: COBBLE, beacon: GLOWSTONE, sheath: GLASS, pin: LOG,    pout: LOG,   decor: 'jungle' },
  frozen: { f1: SNOW,  f2: GLASS,  node: GLOWSTONE, wall: SNOW,   band: GLASS,     cren: GLASS,  daisStep: SNOW,   beacon: GLOWSTONE, sheath: GLASS, pin: GLASS,  pout: SNOW,  decor: 'frozen' },
  desert: { f1: SAND,  f2: SAND,   node: GLOWSTONE, wall: SAND,   band: GLOWSTONE, cren: SAND,   daisStep: COBBLE, beacon: GLOWSTONE, sheath: GLASS, pin: COBBLE, pout: SAND,  decor: 'desert' },
};
// Mirrored decoration anchors in folded (|x|,|z|) coords — kept clear of the
// spawn ring (±34,0)/(0,±34)/(±24,±24), the corner towers and the central dais.
const ARENA_DECOR_CENTERS = [[12, 12], [20, 20], [16, 28], [28, 16], [10, 24], [24, 10], [8, 8]];

// ---- War / D-Day beach (an asymmetric assault map) ----
// Allied storm in from the sea (high +Z) across an open, obstacle-studded beach,
// breach a seawall, and assault a fortified bluff of bunkers, MG nests and a
// trench (low -Z) to capture the command bunker. Axis defend from the line.
export const BEACH = { FLOOR: 50, HALF: 46, WALL_H: 9, OBJ_X: 0, OBJ_Z: -26, OBJ_R: 6, BOAT_DECK: 50 };
// Landing-craft positions [x,z] — the Allied storm ashore from these. The fleet is
// spread wide across the surf; soldiers spawn on the decks (BOAT_DECK) so the camera
// clears the water, then pour down the ramps.
export const BEACH_BOATS = [-34, -22, -10, 2, 14, 26, 38];
export const BEACH_SPAWN_ALLIED = BEACH_BOATS.map((x) => [x, 33]);
export const BEACH_SPAWN_AXIS = [[-30, 2], [-18, 1], [-6, -4], [6, 1], [18, 2], [30, 1], [-24, -5], [24, -5], [0, 2], [0, -6]];
// Defender hold points: MG nests on the bluff front + the bunkers behind.
export const BEACH_NESTS = [[-30, 4], [-18, 4], [-6, 4], [6, 4], [18, 4], [30, 4], [-24, -4], [0, -4], [24, -4]];

// Ground (top solid y) along the assault axis: deep sea -> surf -> long beach ->
// seawall shelf -> fortified bluff.
export function beachGroundY(wz) {
  const F = BEACH.FLOOR;
  if (wz >= 36) return F - 6;                                 // deep sea (the fleet floats here)
  if (wz >= 26) return F - Math.round((wz - 26) * 6 / 10);    // surf ramp: F .. F-6
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
        for (const s of ARENA_STRUCT) {
          if (ax >= s.x0 && ax <= s.x1 && az >= s.z0 && az <= s.z1) {
            const mat = s.mat === PLANK ? T.pout : T.pin;
            for (let y = s.y0; y <= s.y1; y++) chunk.setLocal(lx, F + y, lz, mat);
            if (s.cap) chunk.setLocal(lx, F + s.y1 + 1, lz, T.beacon);
          }
        }

        // Themed decoration (jungle trees + puddles, frozen ice spikes, desert cacti).
        if (T.decor !== 'none' && m > 6 && m < HALF - 2) this.arenaDecor(chunk, lx, lz, F, ax, az, T.decor);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  // Stamp mirrored, theme-specific decoration around the arena decor anchors. Folded
  // (ax,az) coords mean every feature appears identically in all four quadrants.
  arenaDecor(chunk, lx, lz, F, ax, az, decor) {
    for (const [cx, cz] of ARENA_DECOR_CENTERS) {
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

    // ---- Landing craft (Higgins boats): a fleet across the surf, with a raised deck
    // the troops stand on and a ramp lowered toward the beach. ----
    for (const cx of BEACH_BOATS) {
      const dx = Math.abs(wx - cx);
      if (dx <= 2 && wz >= 31 && wz <= 36) {
        set(DECK, PLANK);                                          // deck floor
        if (dx === 2 || wz === 36) { set(DECK + 1, PLANK); set(DECK + 2, PLANK); }   // low hull walls (sides + stern) — open bow
        if (wz === 36 && dx === 0) set(DECK + 3, COAL_ORE);        // a small gun tub on the stern
      }
      if (dx <= 2 && wz >= 28 && wz <= 30) set(DECK - (31 - wz), PLANK);   // lowered bow ramp down to the surf
    }
    // A couple of wrecked, half-sunk craft for atmosphere.
    for (const [cx, cz] of [[-40, 30], [40, 28]]) {
      if (Math.abs(wx - cx) <= 2 && Math.abs(wz - cz) <= 1) { set(F - 4, PLANK); if (((wx + wz) & 1) === 0) set(F - 3, PLANK); }
    }

    // ---- Beach obstacles (denser, cinematic): hedgehogs, Belgian gates, wire,
    // sandbags, craters, fallen-soldier helmets. ----
    if (wz >= 8 && wz <= 25) {
      const h = hash2(wx, wz);
      if (h < 0.028) { set(gy + 1, IRON_ORE); set(gy + 2, LOG); set(gy + 3, IRON_ORE); }   // Czech hedgehog
      else if (h < 0.044) { set(gy + 1, LOG); set(gy + 2, LOG); }                          // Belgian-gate post
      else if (h < 0.060) set(gy + 1, GRAVEL);                                             // sandbag / debris
      else if (h < 0.072) set(gy, COAL_ORE);                                               // scorched crater
      else if (h < 0.080) set(gy + 1, IRON_ORE);                                           // dropped helmet / kit
    }
    // Barbed-wire stake lines strung across the beach.
    if ((wz === 9 || wz === 16) && (((wx % 3) + 3) % 3) === 0) set(F + 1, IRON_ORE);

    // ---- Seawall at the top of the beach: 3 high, with climb gaps ~every 15. ----
    if (wz === 6 && (((wx % 15) + 15) % 15) >= 3) { set(F + 1, COBBLE); set(F + 2, COBBLE); set(F + 3, GRAVEL); }

    // ---- MG nests on the shelf: sandbag horseshoe facing the beach, gun behind. ----
    for (const [nx] of BEACH_NESTS) {
      if (Math.abs(wx - nx) <= 2 && (wz === 4 || wz === 5)) {
        if (wz === 5 || Math.abs(wx - nx) === 2) set(F + 2, GRAVEL);
      }
      if (wx === nx && wz === 4) { set(F + 2, COBBLE); set(F + 3, COAL_ORE); }
    }

    // ---- Bunkers on the bluff: hollow cobble shell, beach-facing firing slit. ----
    for (const cx of [-30, -10, 10, 30]) {
      if (Math.abs(wx - cx) <= 3 && wz >= -6 && wz <= -2) {
        set(F + 5, COBBLE);                                        // roof
        const onWall = Math.abs(wx - cx) === 3 || wz === -6 || wz === -2;
        if (onWall) { for (let y = F + 3; y <= F + 4; y++) if (!(wz === -2 && y === F + 4)) set(y, COBBLE); }
        else { set(F + 3, AIR); set(F + 4, AIR); }
      }
    }

    // ---- Trench tying the line together: 1 deep, sandbag lip toward the beach. ----
    if (wz >= -1 && wz <= 1 && Math.abs(wx) <= 38) set(F + 2, AIR);
    if (wz === 2 && Math.abs(wx) <= 38 && (wx & 1) === 0) set(F + 3, GRAVEL);

    this.beachObjective(chunk, lx, lz, wx, wz);
  }

  // The Axis command bunker + flag — the Allied capture objective at the rear.
  beachObjective(chunk, lx, lz, wx, wz) {
    const F = BEACH.FLOOR, ox = BEACH.OBJ_X, oz = BEACH.OBJ_Z;
    const set = (y, b) => chunk.setLocal(lx, y, lz, b);
    if (Math.abs(wx - ox) <= 4 && wz >= oz - 3 && wz <= oz + 3) {
      set(F + 6, COBBLE);                                          // roof
      const onWall = Math.abs(wx - ox) === 4 || wz === oz - 3 || wz === oz + 3;
      if (onWall) { for (let y = F + 3; y <= F + 5; y++) if (!(wz === oz + 3 && y === F + 4)) set(y, COBBLE); }
      else for (let y = F + 3; y <= F + 5; y++) set(y, AIR);
    }
    if (wx === ox && wz === oz) for (let y = F + 3; y <= F + 8; y++) set(y, y < F + 7 ? COBBLE : GLOWSTONE); // flagpole + beacon
    if (wx === ox + 1 && wz === oz) { set(F + 6, WOOL); set(F + 7, WOOL); }   // flag cloth
  }
}
