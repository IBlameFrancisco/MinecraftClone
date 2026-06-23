// Procedural texture atlas. Every tile is drawn on a <canvas> at runtime with
// subtle per-pixel noise, packed into a power-of-two atlas with a 1px extruded
// gutter to prevent bleeding. Also renders faux-3D block icons for the hotbar.

import * as THREE from 'three';
import { BLOCKS, AIR } from './blocks.js';

const TILE = 16;            // content pixels per tile
const PAD = 1;              // gutter around each tile
const CELL = TILE + PAD * 2; // 18
const ATLAS = 256;          // power-of-two atlas dimension
const COLS = Math.floor(ATLAS / CELL); // 14 tiles per row

// Deterministic PRNG so the world looks identical across reloads.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0xC0FFEE);
const rand = () => rng();
const vary = (c, amt) => clamp255(c + (rand() * 2 - 1) * amt);
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const mix = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
// Seamless trig over the 16px tile: period evenly divides TILE so the pattern
// wraps with no edge discontinuity. `k` is the integer number of wave cycles.
const wsin = (p, k) => Math.sin((p / TILE) * TAU * k);
const wcos = (p, k) => Math.cos((p / TILE) * TAU * k);
const smooth = (t) => t * t * (3 - 2 * t);
const fract = (v) => v - Math.floor(v);

// Hashed value noise on an integer lattice; the lattice wraps modulo `period`
// (which divides TILE) so the field is perfectly tileable. Returns 0..1.
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tileNoise(x, y, period, seed = 0) {
  const sx = x / (TILE / period), sy = y / (TILE / period);
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = smooth(sx - x0), fy = smooth(sy - y0);
  const wrap = (n) => ((n % period) + period) % period;
  const x0w = wrap(x0), x1w = wrap(x0 + 1), y0w = wrap(y0), y1w = wrap(y0 + 1);
  const a = hash2(x0w, y0w, seed), b = hash2(x1w, y0w, seed);
  const c = hash2(x0w, y1w, seed), d = hash2(x1w, y1w, seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
// Two octaves of tileable noise, centered around 0 (-amp..+amp).
function fbm2(x, y, p1, p2, seed) {
  return (tileNoise(x, y, p1, seed) - 0.5) +
         (tileNoise(x, y, p2, seed + 17) - 0.5) * 0.5;
}

// ---- Per-tile pixel generators. Each returns [r,g,b,a] for pixel (x,y). ----
const generators = {
  grass_top(x, y) {
    // Tileable clumpy noise gives a soft patchy lawn; a few crisp blades on top.
    const n = fbm2(x, y, 4, 8, 11);       // -0.75..0.75 seamless
    let g = 150 + n * 34, r = 96 + n * 22, b = 58 + n * 12;
    const mottle = vary(0, 6); r += mottle; g += mottle; b += mottle * 0.5;
    if (rand() < 0.07) { g -= 30; r -= 20; b -= 8; }       // dark blade gaps
    else if (rand() < 0.06) { g += 24; r += 14; b += 6; }  // sunlit tips
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  grass_side(x, y) {
    // Ragged grass lip overhanging the dirt, with a couple of trailing blades.
    const edge = 3 + (wsin(x, 2) + wsin(x, 5) * 0.5 + 1.5) * 1.1;
    const blade = (x % 3 === 1) && rand() < 0.5 ? 1.6 : 0;
    if (y < edge + blade) {
      const n = fbm2(x, y, 4, 8, 11);
      let g = 148 + n * 30, r = 94 + n * 18, b = 56 + n * 10;
      if (y > edge - 1) { g -= 22; r -= 16; b -= 8; }       // shaded underside
      if (rand() < 0.09) g -= 26;
      return [clamp255(r), clamp255(g), clamp255(b), 255];
    }
    return generators.dirt(x, y);
  },
  dirt(x, y) {
    // Lumpy soil: low-frequency brightness drift plus scattered pebbles/specks.
    const n = fbm2(x, y, 4, 8, 3);
    let r = 122 + n * 22, g = 88 + n * 18, b = 58 + n * 12;
    const s = vary(0, 7); r += s; g += s; b += s * 0.6;
    if (rand() < 0.06) { r -= 30; g -= 26; b -= 18; }   // dark pebble
    else if (rand() < 0.05) { r += 16; g += 12; b += 6; } // light grit
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  stone(x, y) {
    // Mottled granite with faint blue cast and a couple of hairline cracks.
    const n = fbm2(x, y, 4, 8, 7);
    let v = 126 + n * 26 + vary(0, 5);
    if (rand() < 0.05) v -= 26;
    else if (rand() < 0.04) v += 18;
    // Seamless thin cracks following a wrapped wave.
    const crackA = Math.abs(y - (8 + wsin(x, 1) * 3 + wsin(x, 3) * 1.5));
    const crackB = Math.abs(x - (5 + wsin(y, 1) * 4));
    if (crackA < 0.6 || crackB < 0.55) v -= 30;
    return [clamp255(v - 1), clamp255(v + 1), clamp255(v + 6), 255];
  },
  sand(x, y) {
    // Fine wind-rippled grains: gentle horizontal banding plus tight speckle.
    const ripple = wsin(y * 1 + wsin(x, 1) * 1.5, 4) * 4;
    const n = fbm2(x, y, 8, 16, 9) * 10;
    let r = 223 + ripple + n, g = 208 + ripple + n, b = 150 + ripple * 0.6 + n;
    const s = vary(0, 5); r += s; g += s; b += s;
    if (rand() < 0.05) { r -= 16; g -= 16; b -= 14; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  log_top(x, y) {
    // Concentric growth rings around an off-center pith, with grain jitter.
    const dx = x - 8, dy = y - 8;
    const d = Math.sqrt(dx * dx + dy * dy) + fbm2(x, y, 4, 8, 21) * 1.4;
    const ring = wsin(d * 2.4, 1) * 0 + (Math.sin(d * 2.1) * 0.5 + 0.5);
    let base = mix(94, 140, ring) + vary(0, 8);
    if (d < 1.3) base -= 14;                       // dark pith center
    return [clamp255(base), clamp255(base * 0.72), clamp255(base * 0.45), 255];
  },
  log_side(x, y) {
    // Vertical bark fibers: wrapped streaks down the trunk plus deep furrows.
    const streak = wsin(x + wsin(y, 1) * 0.8, 4) * 0.5 + 0.5;
    const grain = fbm2(x, y, 4, 16, 13);
    let r = 108 + grain * 16, g = 80 + grain * 12, b = 48 + grain * 8;
    r = mix(r - 16, r + 12, streak); g = mix(g - 12, g + 8, streak); b = mix(b - 8, b + 6, streak);
    r += vary(0, 5); g += vary(0, 4); b += vary(0, 3);
    if ((x === 3 || x === 11) && (y % 4 !== 0)) { r -= 22; g -= 18; b -= 12; } // furrows
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  leaves(x, y) {
    // Clustered foliage: noise-driven leaf clumps with backlit gaps and highlights.
    const clump = tileNoise(x, y, 4, 31) + tileNoise(x, y, 8, 5) * 0.5;
    let g = 108 + clump * 40, r = 54 + clump * 24, b = 40 + clump * 14;
    g += vary(0, 14); r += vary(0, 8); b += vary(0, 6);
    if (rand() < 0.14) { g -= 44; r -= 20; b -= 12; }   // shadowed gaps between leaves
    else if (rand() < 0.09) { g += 28; r += 10; }       // sunlit leaf edge
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  water(x, y) {
    // Two crossing wrapped wave trains for a lively but seamless surface.
    // Coefficients chosen so each axis completes a whole number of cycles per
    // 16px tile (no seam): wave1 => 2 in x, 1 in y; wave2 => 1 in x, 3 in y.
    const wave = (wsin(x * 2 + y * 1, 1) + wsin(x * 1 - y * 3, 1) * 0.6) * 0.5 + 0.5;
    const spark = (wsin(x, 4) * wcos(y, 4)) > 0.85 ? 22 : 0;
    let r = 36 + wave * 10, g = mix(94, 124, wave) + spark, b = mix(168, 208, wave) + spark;
    r += vary(0, 5); g += vary(0, 5); b += vary(0, 6);
    return [clamp255(r), clamp255(g), clamp255(b), 200];
  },
  snow(x, y) {
    // Soft drifts: very low contrast with a faint cool sparkle.
    const n = fbm2(x, y, 4, 8, 41);
    let v = 240 + n * 10 + vary(0, 4);
    if (rand() < 0.04) v += 12;            // glints
    return [clamp255(v - 5), clamp255(v), clamp255(v + 7), 255];
  },
  snow_side(x, y) {
    const edge = 5 + (wsin(x, 2) + wsin(x, 4) * 0.5 + 1.5) * 1.2;
    if (y < edge) {
      const n = fbm2(x, y, 4, 8, 41);
      let v = 240 + n * 10 + vary(0, 4);
      if (y > edge - 1.2) v -= 16;          // shaded snow lip
      return [clamp255(v - 5), clamp255(v), clamp255(v + 7), 255];
    }
    return generators.dirt(x, y);
  },
  coal_ore(x, y) {
    const base = generators.stone(x, y);
    // Angular coal clusters: noise threshold around seed points reads as facets.
    const blobs = [[5, 4], [10, 9], [4, 11], [12, 3]];
    for (const [bx, by] of blobs) {
      const d = Math.hypot(x - bx, y - by) - tileNoise(x, y, 8, 71) * 1.2;
      if (d < 2.1) {
        let c = 30 + vary(0, 12);
        if (d < 1.0) c += 14;               // glassy highlight on the lump
        return [clamp255(c), clamp255(c), clamp255(c + 5), 255];
      }
    }
    return base;
  },
  iron_ore(x, y) {
    const base = generators.stone(x, y);
    const blobs = [[6, 5], [11, 10], [3, 10], [13, 4]];
    for (const [bx, by] of blobs) {
      const d = Math.hypot(x - bx, y - by) - tileNoise(x, y, 8, 53) * 1.1;
      if (d < 2.0) {
        let r = 204 + vary(0, 16), g = 150 + vary(0, 14), b = 108 + vary(0, 12);
        if (d < 0.9) { r += 18; g += 16; b += 12; } // metallic glint
        return [clamp255(r), clamp255(g), clamp255(b), 255];
      }
    }
    return base;
  },
  cobble(x, y) {
    // Rounded cobbles in dark mortar; each stone shaded with a top-lit gradient.
    const cellX = Math.floor(x / 4), cellY = Math.floor(y / 4);
    const offset = (cellY % 2) * 2;
    const ox = ((x + offset) % 16);
    const inX = ((x + offset) % 8) % 4, inY = y % 4;
    const isMortar = inX === 0 || inY === 0 || ox % 8 === 0;
    const tone = hash2(cellX + ((cellY % 2) ? 9 : 0), cellY, 2);
    let v = 118 + tone * 28;
    // Top-left lit, bottom-right shaded within each 4px stone.
    v += (1.5 - inY) * 5 + (1.5 - inX) * 3;
    v += vary(0, 6);
    if (isMortar) v -= 48;
    else if (inX === 3 || inY === 3) v -= 12;
    return [clamp255(v - 1), clamp255(v + 1), clamp255(v + 5), 255];
  },
  plank(x, y) {
    // Horizontal boards with lengthwise grain streaks and shaded grooves/seams.
    const plankH = 4;
    const row = Math.floor(y / plankH);
    const inRow = y % plankH;
    const grain = wsin(x + row * 3, 3) * 0.5 + fbm2(x, y, 8, 16, row * 7 + 1) * 1.2;
    let r = 160 + grain * 12 + vary(0, 5);
    let g = 120 + grain * 9 + vary(0, 4);
    let b = 72 + grain * 6 + vary(0, 3);
    if (inRow === 0) { r -= 42; g -= 34; b -= 24; }       // groove between planks
    else if (inRow === 1) { r += 8; g += 6; b += 4; }     // highlight under groove
    const seam = (row % 2) * 8;
    if ((x + seam) % 16 === 0 || (x + seam) % 16 === 15) { r -= 30; g -= 24; b -= 16; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  glass(x, y) {
    // Clean pane: bright frame, soft inner bevel, a couple of diagonal glints.
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const inner = x === 1 || y === 1 || x === 14 || y === 14;
    if (border) return [206, 228, 238, 240];
    if (inner) return [172, 202, 217, 110];
    // Two parallel diagonal highlight streaks; wraps via mod 16.
    const diag = (x - y + 32) % 16;
    if (diag < 2) return [222, 238, 246, 96];
    if (diag >= 8 && diag < 9) return [214, 232, 242, 60];
    return [210, 230, 240, 30];
  },
  ice(x, y) {
    // Pale frozen lake: cool blue with faint cracks and an occasional glint.
    const n = fbm2(x, y, 4, 8, 53);
    let v = 214 + n * 14 + vary(0, 4);
    let r = v - 20, g = v - 4, b = v + 12;
    const crack = tileNoise(x, y, 6, 23);
    if (crack > 0.74) { r -= 34; g -= 24; b -= 8; }    // crack vein
    if (rand() < 0.03) { r += 16; g += 16; b += 12; }  // sparkle
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  lava(x, y) {
    // Molten rock: glowing orange channels between dark cooled crust.
    const flow = fbm2(x, y * 0.6, 4, 8, 77);
    const crust = tileNoise(x, y, 5, 13);
    let r, g, b;
    if (crust > 0.6) { const c = 36 + flow * 34; r = c + 26; g = c * 0.5; b = c * 0.3; }   // crust
    else { r = 232 + flow * 23; g = 86 + flow * 86; b = 18 + flow * 22; }                   // molten
    if (rand() < 0.04) { r = 255; g = 212; b = 96; }   // bright spark
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  bedrock(x, y) {
    // Chaotic dark rock: blocky value patches from low-res noise, no tiling seam.
    const patch = tileNoise(x, y, 8, 91);
    const tones = [38, 54, 70, 46];
    const base = tones[Math.min(3, Math.floor(patch * 4))];
    let v = base + vary(0, 7);
    if (rand() < 0.06) v -= 14;
    else if (rand() < 0.05) v += 16;
    return [clamp255(v), clamp255(v), clamp255(v + 5), 255];
  },
  gravel(x, y) {
    // Loose pebble bed: noise picks pebble tone, dark crevices between stones.
    const peb = tileNoise(x, y, 8, 61);
    let v = mix(112, 156, peb) + vary(0, 8);
    // Crevice shadow where two pebble cells meet.
    const edge = tileNoise(x + 1, y, 8, 61) + tileNoise(x, y + 1, 8, 61);
    if (Math.abs(edge - peb * 2) > 0.42) v -= 26;
    let r = v, g = v - 5, b = v - 12;
    if (rand() < 0.08) { r -= 22; g -= 20; b -= 18; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  glowstone(x, y) {
    // Warm crystalline ore: dim matrix with bright glowing nodules.
    const n = fbm2(x, y, 4, 8, 33);
    let r = 192 + n * 22, g = 156 + n * 20, b = 76 + n * 12;
    const dots = [[4, 4], [11, 5], [7, 10], [3, 12], [12, 12], [8, 2]];
    for (const [bx, by] of dots) {
      const d = Math.hypot(x - bx, y - by);
      if (d < 2.3) {
        const t = 1 - d / 2.3;
        r = mix(r, 255, t); g = mix(g, 244, t); b = mix(b, 160, t * 0.8);
      }
    }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  cactus_top(x, y) {
    // Rounded fleshy top: bright raised center fading to a darker rim.
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    const lit = 1 - smooth(Math.min(1, d / 7));
    let g = mix(92, 126, lit) + vary(0, 10);
    let r = mix(46, 62, lit) + vary(0, 7);
    let b = 44 + vary(0, 5);
    if (d > 6.2) { g -= 14; r -= 8; }       // shaded outer edge
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  cactus_side(x, y) {
    // Vertical ribbed flesh with shaded grooves and bright spine rows.
    const rib = wsin(x, 4) * 0.5 + 0.5;     // 0 at grooves, 1 at ridges
    let g = mix(86, 116, rib) + vary(0, 9);
    let r = mix(42, 58, rib) + vary(0, 6);
    let b = 40 + vary(0, 4);
    if (x === 0 || x === 15) { g -= 24; r -= 12; }     // dark seam at block edge
    if ((x === 4 || x === 11) && y % 5 === 2) { g += 32; r += 30; b += 22; } // spines
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  wool(x, y) {
    // Fluffy weave: gentle clumpy shading with both fluffs and tufts.
    const n = fbm2(x, y, 4, 8, 77);
    let v = 232 + n * 12 + vary(0, 4);
    if (rand() < 0.10) v -= 16;       // shadowed tuft
    else if (rand() < 0.08) v += 8;   // raised fluff
    return [clamp255(v - 2), clamp255(v - 1), clamp255(v), 255];
  },
  craft_top(x, y) {
    const p = generators.plank(x, y);
    // Grid: cross through the middle + border, with a lighter inner bevel.
    if (x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8) {
      return [clamp255(p[0] - 46), clamp255(p[1] - 40), clamp255(p[2] - 30), 255];
    }
    if (x === 1 || y === 1 || x === 14 || y === 14 || x === 6 || x === 9 || y === 6 || y === 9) {
      return [clamp255(p[0] + 12), clamp255(p[1] + 10), clamp255(p[2] + 6), 255];
    }
    return p;
  },
  craft_side(x, y) {
    const p = generators.plank(x, y);
    // A darker recessed tool panel on the upper half.
    if (y >= 2 && y <= 7 && x >= 2 && x <= 13) {
      if (x === 2 || x === 13 || y === 2 || y === 7) return [clamp255(p[0] - 50), clamp255(p[1] - 44), clamp255(p[2] - 34), 255];
      if ((x + y) % 3 === 0) return [clamp255(p[0] - 24), clamp255(p[1] - 20), clamp255(p[2] - 14), 255];
    }
    return p;
  },
  torch(x, y) {
    // Wooden stem rising to a layered flame (white-hot core, orange, red halo).
    if (x >= 6 && x <= 9 && y >= 6) {
      const lit = x <= 7 ? 1 : 0;           // left side of stem catches the glow
      return [clamp255(vary(118 + lit * 24, 8)), clamp255(vary(80 + lit * 14, 6)), clamp255(vary(42, 5)), 255];
    }
    const d = Math.hypot(x - 7.5, y - 3.5);
    if (d < 1.4) return [255, clamp255(vary(244, 8)), clamp255(vary(180, 12)), 255]; // core
    if (d < 2.4) { const t = 1 - (d - 1.4) / 1.0; return [255, clamp255(180 + t * 60), clamp255(40 + t * 90), 255]; }
    if (d < 3.3) { const t = 1 - (d - 2.4) / 0.9; return [clamp255(200 + t * 55), clamp255(70 + t * 60), 30, clamp255(120 + t * 135)]; }
    return [clamp255(vary(24, 6)), clamp255(vary(19, 5)), clamp255(vary(14, 4)), 255];
  },
  chest_top(x, y) {
    let r = vary(150, 7), g = vary(104, 6), b = vary(60, 5);
    const grain = wsin(x, 3) * 4; r += grain; g += grain * 0.7; b += grain * 0.5;
    if (x === 0 || y === 0 || x === 15 || y === 15) { r -= 40; g -= 34; b -= 24; }
    if (x === 2 || x === 13) { r -= 30; g -= 26; b -= 18; } // metal bands
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  chest_side(x, y) {
    let r = vary(146, 7), g = vary(100, 6), b = vary(56, 5);
    const grain = wsin(y, 3) * 4; r += grain; g += grain * 0.7; b += grain * 0.5;
    if (x === 0 || y === 0 || x === 15 || y === 15) { r -= 42; g -= 36; b -= 26; }
    if (x === 2 || x === 13) { r -= 28; g -= 24; b -= 16; }    // bands
    if (y === 7 || y === 8) { r -= 24; g -= 20; b -= 14; }     // lid seam
    if (x >= 7 && x <= 8 && y >= 7 && y <= 10) {
      // Brass latch with a small highlight.
      if (x === 7 && y === 7) return [150, 138, 96, 255];
      return [78, 72, 60, 255];
    }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
};

// ---- Build the atlas ----
const tileNames = Object.keys(generators);
export const TILES = {};       // name -> { u0, v0, u1, v1, col, row }
const tileCanvases = {};       // name -> 16x16 HTMLCanvas (for icons/particles)
const tileColors = {};         // name -> [r,g,b] average

const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = atlasCanvas.height = ATLAS;
const actx = atlasCanvas.getContext('2d');
const atlasImg = actx.createImageData(ATLAS, ATLAS);
const A = atlasImg.data;

function setPixel(px, py, rgba) {
  const i = (py * ATLAS + px) * 4;
  A[i] = rgba[0]; A[i + 1] = rgba[1]; A[i + 2] = rgba[2]; A[i + 3] = rgba[3];
}

tileNames.forEach((name, t) => {
  const col = t % COLS, row = Math.floor(t / COLS);
  const bx = col * CELL, by = row * CELL;
  const gen = generators[name];

  // Render the 16x16 content (also into a standalone canvas for icons).
  const tc = document.createElement('canvas');
  tc.width = tc.height = TILE;
  const tctx = tc.getContext('2d');
  const tImg = tctx.createImageData(TILE, TILE);
  let ar = 0, ag = 0, ab = 0;
  const grid = [];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const rgba = gen(x, y);
      grid.push(rgba);
      const ti = (y * TILE + x) * 4;
      tImg.data[ti] = rgba[0]; tImg.data[ti + 1] = rgba[1]; tImg.data[ti + 2] = rgba[2]; tImg.data[ti + 3] = rgba[3];
      ar += rgba[0]; ag += rgba[1]; ab += rgba[2];
    }
  }
  tctx.putImageData(tImg, 0, 0);
  tileCanvases[name] = tc;
  tileColors[name] = [ar / 256, ag / 256, ab / 256];

  // Blit into the atlas with a 1px extruded gutter (clamp sampling).
  for (let oy = -PAD; oy < TILE + PAD; oy++) {
    for (let ox = -PAD; ox < TILE + PAD; ox++) {
      const sx = ox < 0 ? 0 : ox >= TILE ? TILE - 1 : ox;
      const sy = oy < 0 ? 0 : oy >= TILE ? TILE - 1 : oy;
      setPixel(bx + PAD + ox, by + PAD + oy, grid[sy * TILE + sx]);
    }
  }

  const u0 = (bx + PAD) / ATLAS, v0 = (by + PAD) / ATLAS;
  TILES[name] = {
    u0, v0,
    u1: (bx + PAD + TILE) / ATLAS,
    v1: (by + PAD + TILE) / ATLAS,
  };
});

actx.putImageData(atlasImg, 0, 0);

export const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.flipY = false;            // canvas-top == v0 (see mesher UVs)
atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
atlasTexture.colorSpace = THREE.SRGBColorSpace;
atlasTexture.needsUpdate = true;

// Resolve the tile UV rect for a block face direction.
// dir: 2 = top (+Y), 3 = bottom (-Y), others = side.
export function tileForFace(blockId, dir) {
  const b = BLOCKS[blockId];
  const name = dir === 2 ? b.tiles.top : dir === 3 ? b.tiles.bottom : b.tiles.side;
  return TILES[name];
}

export function blockTint(blockId) {
  if (blockId === AIR) return [255, 255, 255];
  return tileColors[BLOCKS[blockId].tiles.top] || [200, 200, 200];
}

// ---- Faux-3D block icon, drawn into a 2D context (hotbar / inventory) ----
export function drawBlockIcon(ctx, blockId, S) {
  ctx.clearRect(0, 0, S, S);
  if (blockId === AIR) return;
  const b = BLOCKS[blockId];
  const top = tileCanvases[b.tiles.top];
  const side = tileCanvases[b.tiles.side];

  const cx = S / 2;
  const T = [cx, S * 0.12];
  const R = [S * 0.90, S * 0.34];
  const M = [cx, S * 0.56];
  const L = [S * 0.10, S * 0.34];
  const down = S * 0.34;
  const Lb = [L[0], L[1] + down];
  const Mb = [M[0], M[1] + down];
  const Rb = [R[0], R[1] + down];

  ctx.imageSmoothingEnabled = false;

  // affine map: source square (0,0)-(16,0)-(0,16) -> d0,d1,d2
  const face = (img, d0, d1, d2, shade) => {
    ctx.save();
    ctx.setTransform(
      (d1[0] - d0[0]) / TILE, (d1[1] - d0[1]) / TILE,
      (d2[0] - d0[0]) / TILE, (d2[1] - d0[1]) / TILE,
      d0[0], d0[1],
    );
    ctx.drawImage(img, 0, 0);
    if (shade > 0) { ctx.globalAlpha = shade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TILE, TILE); ctx.globalAlpha = 1; }
    ctx.restore();
  };

  face(top, L, T, M, 0.0);     // top face (brightest)
  face(side, L, M, Lb, 0.30);  // left face (medium)
  face(side, M, R, Mb, 0.46);  // right face (darkest)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---- Block-breaking crack overlay (10 progressive stages) ----
export const CRACK_TEXTURES = (() => {
  const crackRng = mulberry32(0x5EED);
  const stages = [];
  // Pre-generate a pool of crack segments; reveal more of them each stage.
  const segs = [];
  for (let i = 0; i < 26; i++) {
    segs.push({ x: crackRng() * 16, y: crackRng() * 16, len: 2 + crackRng() * 5, ang: crackRng() * Math.PI * 2 });
  }
  for (let s = 0; s < 10; s++) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 16, 16);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 1;
    const reveal = Math.ceil(((s + 1) / 10) * segs.length);
    for (let i = 0; i < reveal; i++) {
      const seg = segs[i];
      const grow = Math.min(1, (s + 1) / 10 + 0.3);
      g.beginPath();
      g.moveTo(seg.x, seg.y);
      g.lineTo(seg.x + Math.cos(seg.ang) * seg.len * grow, seg.y + Math.sin(seg.ang) * seg.len * grow);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    stages.push(tex);
  }
  return stages;
})();
