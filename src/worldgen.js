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

// ---- War / D-Day beach (an asymmetric assault map) ----
// Allied storm in from the sea (high +Z) across an open, obstacle-studded beach,
// breach a seawall, and assault a fortified bluff of bunkers, MG nests and a
// trench (low -Z) to capture the command bunker. Axis defend from the line.
export const BEACH = { FLOOR: 50, HALF: 38, WALL_H: 9, OBJ_X: 0, OBJ_Z: -20, OBJ_R: 6 };
// Spawn pools [x, z]: Allied wade in at the surf; Axis hold the bunker line.
export const BEACH_SPAWN_ALLIED = [[-24, 26], [-16, 27], [-8, 26], [0, 27], [8, 26], [16, 27], [24, 26], [0, 24]];
export const BEACH_SPAWN_AXIS = [[-26, 2], [-13, 1], [0, -4], [13, 1], [26, 2], [-20, -5], [20, -5], [0, 2]];
// Defender hold points: MG nests on the bluff front + the bunkers behind.
export const BEACH_NESTS = [[-26, 4], [-13, 4], [0, 4], [13, 4], [26, 4], [-20, -4], [0, -4], [20, -4]];

// Ground (top solid y) along the assault axis: deep sea -> surf -> beach ->
// seawall shelf -> fortified bluff.
export function beachGroundY(wz) {
  const F = BEACH.FLOOR;
  if (wz >= 32) return F - 5;                                 // deep sea (landing craft float here)
  if (wz >= 24) return F - Math.round((wz - 24) * 5 / 8);     // surf ramp: F .. F-5
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
      if (m >= BEACH.HALF - 1) return BEACH.FLOOR + BEACH.WALL_H;
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
        if (m >= HALF - 1) {                                       // containing cliff/wall
          for (let y = F - 6; y <= F + WH; y++) chunk.setLocal(lx, y, lz, y <= F - 5 ? BEDROCK : COBBLE);
          continue;
        }
        const topMat = wz < 6 ? GRAVEL : SAND;                     // shingle bluff / sandy beach
        for (let y = F - 6; y <= gy; y++) chunk.setLocal(lx, y, lz, y <= F - 6 ? BEDROCK : y >= gy - 2 ? topMat : STONE);
        for (let y = gy + 1; y <= F; y++) if (chunk.getLocal(lx, y, lz) === AIR) chunk.setLocal(lx, y, lz, WATER);
        this.beachProps(chunk, lx, lz, wx, wz, gy);
      }
    }
    chunk.recomputeHeightMap();
    chunk.generated = true;
  }

  beachProps(chunk, lx, lz, wx, wz, gy) {
    const F = BEACH.FLOOR;
    const set = (y, b) => chunk.setLocal(lx, y, lz, b);

    // Landing craft (Higgins boats) in the surf, hull open toward the beach.
    for (const cx of [-16, 0, 16]) {
      if (Math.abs(wx - cx) <= 2 && wz >= 30 && wz <= 33) {
        set(F - 4, PLANK);
        if (Math.abs(wx - cx) === 2 || wz === 33) { set(F - 3, PLANK); set(F - 2, PLANK); }
      }
    }

    // Beach obstacles (sparse, deterministic): hedgehog stakes, sandbags, craters.
    if (wz >= 9 && wz <= 23) {
      const h = hash2(wx, wz);
      if (h < 0.020) { set(gy + 1, IRON_ORE); set(gy + 2, LOG); set(gy + 3, IRON_ORE); }   // anti-boat hedgehog
      else if (h < 0.034) set(gy + 1, GRAVEL);                                              // lone sandbag
      else if (h < 0.040) set(gy, COAL_ORE);                                                // scorched crater
    }
    if (wz === 8 && (wx & 1) === 0) set(F + 1, IRON_ORE);          // wire / stake line out on the sand

    // Seawall at the top of the beach: 2 high, with climb gaps ~every 14 blocks.
    if (wz === 6 && (((wx % 14) + 14) % 14) >= 3) { set(F + 1, COBBLE); set(F + 2, COBBLE); }

    // MG nests on the shelf: sandbag U facing the beach, with the gun behind it.
    for (const nx of [-26, -13, 0, 13, 26]) {
      if (Math.abs(wx - nx) <= 2 && (wz === 4 || wz === 5)) {
        if (wz === 5 || Math.abs(wx - nx) === 2) set(F + 2, GRAVEL);   // front (beach side) + sides
      }
      if (wx === nx && wz === 4) { set(F + 2, COBBLE); set(F + 3, COAL_ORE); }  // the gun
    }

    // Bunkers on the bluff: hollow cobble shell, beach-facing firing slit.
    for (const cx of [-20, 0, 20]) {
      if (Math.abs(wx - cx) <= 3 && wz >= -6 && wz <= -2) {
        set(F + 5, COBBLE);                                         // roof
        const onWall = Math.abs(wx - cx) === 3 || wz === -6 || wz === -2;
        if (onWall) { for (let y = F + 3; y <= F + 4; y++) if (!(wz === -2 && y === F + 4)) set(y, COBBLE); }
        else { set(F + 3, AIR); set(F + 4, AIR); }
      }
    }

    // Trench tying the line together: 1 deep, sandbag lip toward the beach.
    if (wz >= -1 && wz <= 1 && Math.abs(wx) <= 30) set(F + 2, AIR);
    if (wz === 2 && Math.abs(wx) <= 30 && (wx & 1) === 0) set(F + 3, GRAVEL);

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
