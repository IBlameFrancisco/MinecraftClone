// Procedural world generation: multi-octave terrain height, climate-driven
// biomes, 3D-noise caves, ore veins, water/beaches and trees. Every value is a
// deterministic function of world coordinates, so chunks tile seamlessly with
// no cross-chunk ordering dependencies.

import { SimplexNoise } from './noise.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL, WORLD_SEED } from './constants.js';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, SNOW,
  COAL_ORE, IRON_ORE, BEDROCK, GRAVEL, CACTUS, COBBLE, PLANK, WOOL, GLOWSTONE, TORCH,
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
  { x0: 10, x1: 11, z0: 10, z1: 11, y0: 1, y1: 6, mat: COBBLE,   cap: GLOWSTONE }, // inner lit pillars
  { x0: 22, x1: 23, z0: 22, z1: 23, y0: 1, y1: 5, mat: COAL_ORE, cap: GLOWSTONE }, // outer lit pillars
  { x0: 18, x1: 19, z0: 7,  z1: 8,  y0: 1, y1: 4, mat: COAL_ORE },                 // broken dark pillars
  { x0: 7,  x1: 8,  z0: 18, z1: 19, y0: 1, y1: 4, mat: COAL_ORE },
  { x0: 14, x1: 20, z0: 14, z1: 15, y0: 1, y1: 2, mat: COBBLE },                   // L-shaped low cover
  { x0: 14, x1: 15, z0: 14, z1: 20, y0: 1, y1: 2, mat: COBBLE },
  { x0: 24, x1: 30, z0: 2,  z1: 6,  y0: 1, y1: 2, mat: COBBLE },                   // raised stage
  { x0: 23, x1: 23, z0: 2,  z1: 6,  y0: 1, y1: 1, mat: COBBLE },                   // step onto the stage
  { x0: 2,  x1: 6,  z0: 24, z1: 30, y0: 1, y1: 2, mat: COBBLE },
  { x0: 2,  x1: 6,  z0: 23, z1: 23, y0: 1, y1: 1, mat: COBBLE },
  { x0: 29, x1: 31, z0: 29, z1: 31, y0: 1, y1: 7, mat: COBBLE,   cap: TORCH },     // corner watchtowers
  { x0: 30, x1: 30, z0: 5,  z1: 5,  y0: 1, y1: 1, mat: COBBLE,   cap: GLOWSTONE }, // floor braziers
  { x0: 5,  x1: 5,  z0: 30, z1: 30, y0: 1, y1: 1, mat: COBBLE,   cap: GLOWSTONE },
  { x0: 16, x1: 16, z0: 28, z1: 28, y0: 1, y1: 1, mat: COBBLE,   cap: TORCH },
  { x0: 28, x1: 28, z0: 16, z1: 16, y0: 1, y1: 1, mat: COBBLE,   cap: TORCH },
];

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
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const ax = Math.abs(wx), az = Math.abs(wz), m = Math.max(ax, az), inr = Math.min(ax, az);
        if (m > HALF) continue;                         // void beyond the arena

        // Foundation + grim, stained stone floor.
        chunk.setLocal(lx, F - 2, lz, BEDROCK);
        chunk.setLocal(lx, F - 1, lz, BEDROCK);
        let floor = (((wx >> 2) + (wz >> 2)) & 1) ? STONE : COBBLE;
        if (hash2(wx * 3 + 1, wz * 3 + 7) < 0.05) floor = COAL_ORE;   // dark stains
        chunk.setLocal(lx, F, lz, floor);

        // Tall banded perimeter wall, torch sconces on the inner face, crenellations.
        if (m >= HALF - 1) {
          for (let y = 1; y <= WH; y++) {
            let wmat = (y % 4 === 0) ? COAL_ORE : COBBLE;
            if (m === HALF - 1 && y === 5 && inr % 6 === 2) wmat = TORCH;  // sconces
            chunk.setLocal(lx, F + y, lz, wmat);
          }
          if (((ax + az) & 1) === 0) chunk.setLocal(lx, F + WH + 1, lz, COBBLE);  // crenellations
          continue;
        }

        // Central ritual altar: stepped dais + dark obelisk crowned with a beacon.
        if (m <= 6) {
          const h = m <= 2 ? 3 : m <= 4 ? 2 : 1;
          for (let y = 1; y <= h; y++) chunk.setLocal(lx, F + y, lz, y === h ? COBBLE : BEDROCK);
          if (m === 4 && ax === az) chunk.setLocal(lx, F + h + 1, lz, GLOWSTONE);     // corner lamps
          if (m <= 1) for (let y = 4; y <= 8; y++) chunk.setLocal(lx, F + y, lz, m === 0 ? COAL_ORE : BEDROCK); // obelisk
          if (ax === 0 && az === 0) chunk.setLocal(lx, F + 9, lz, GLOWSTONE);         // cursed beacon
          continue;
        }

        // Mirrored structures (pillars, cover, stages, towers, braziers).
        for (const s of ARENA_STRUCT) {
          if (ax >= s.x0 && ax <= s.x1 && az >= s.z0 && az <= s.z1) {
            for (let y = s.y0; y <= s.y1; y++) chunk.setLocal(lx, F + y, lz, s.mat);
            if (s.cap) chunk.setLocal(lx, F + s.y1 + 1, lz, s.cap);
          }
        }
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }
}
