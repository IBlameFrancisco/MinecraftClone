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

// ---- Per-tile pixel generators. Each returns [r,g,b,a] for pixel (x,y). ----
const generators = {
  grass_top(x, y) {
    let g = vary(150, 18), r = vary(96, 14), b = vary(58, 12);
    if (rand() < 0.08) { g -= 30; r -= 20; }       // darker blades
    else if (rand() < 0.05) { g += 22; r += 14; }  // lighter highlights
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  grass_side(x, y) {
    const edge = 3 + ((Math.sin(x * 1.3) + 1) * 1.3) + (rand() < 0.4 ? 1 : 0);
    if (y < edge) {
      let g = vary(150, 18), r = vary(96, 14), b = vary(58, 12);
      if (rand() < 0.1) g -= 28;
      return [clamp255(r), clamp255(g), clamp255(b), 255];
    }
    return generators.dirt(x, y);
  },
  dirt(x, y) {
    let r = vary(124, 16), g = vary(88, 14), b = vary(58, 12);
    if (rand() < 0.07) { r -= 26; g -= 22; b -= 16; } // pebbles
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  stone(x, y) {
    let v = vary(126, 16);
    if (rand() < 0.06) v -= 30;
    else if (rand() < 0.04) v += 22;
    // faint diagonal crack
    if (((x + y) % 13 === 0) && rand() < 0.5) v -= 24;
    return [clamp255(v), clamp255(v + 2), clamp255(v + 6), 255];
  },
  sand(x, y) {
    let r = vary(223, 12), g = vary(208, 12), b = vary(150, 12);
    if (rand() < 0.06) { r -= 18; g -= 18; b -= 14; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  log_top(x, y) {
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ring = Math.sin(d * 2.1) * 0.5 + 0.5;
    let base = mix(96, 138, ring);
    base = vary(base, 10);
    return [clamp255(base), clamp255(base * 0.72), clamp255(base * 0.45), 255];
  },
  log_side(x, y) {
    let r = vary(112, 10), g = vary(82, 9), b = vary(50, 8);
    const streak = Math.sin(x * 1.7 + Math.sin(x) * 2) * 0.5 + 0.5;
    r = mix(r - 16, r + 12, streak); g = mix(g - 12, g + 8, streak); b = mix(b - 8, b + 6, streak);
    if ((x === 4 || x === 11) && rand() < 0.3) { r -= 24; g -= 20; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  leaves(x, y) {
    let g = vary(116, 26), r = vary(58, 18), b = vary(42, 14);
    if (rand() < 0.16) { g -= 40; r -= 18; b -= 12; } // shadowed gaps
    else if (rand() < 0.1) { g += 26; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  water(x, y) {
    const wave = Math.sin((y + x * 0.4) * 0.9) * 0.5 + 0.5;
    let r = vary(38, 8), g = vary(mix(96, 120, wave), 8), b = vary(mix(170, 205, wave), 10);
    return [clamp255(r), clamp255(g), clamp255(b), 200];
  },
  snow(x, y) {
    let v = vary(240, 8);
    return [clamp255(v - 4), clamp255(v), clamp255(v + 6), 255];
  },
  snow_side(x, y) {
    const edge = 5 + ((Math.sin(x * 1.1) + 1) * 1.4);
    if (y < edge) { let v = vary(240, 8); return [clamp255(v - 4), clamp255(v), clamp255(v + 6), 255]; }
    return generators.dirt(x, y);
  },
  coal_ore(x, y) {
    const base = generators.stone(x, y);
    const blobs = [[5, 4], [10, 9], [4, 11]];
    for (const [bx, by] of blobs) {
      if (Math.hypot(x - bx, y - by) < 2.2 + rand() * 0.6) {
        const c = vary(34, 14);
        return [clamp255(c), clamp255(c), clamp255(c + 4), 255];
      }
    }
    return base;
  },
  iron_ore(x, y) {
    const base = generators.stone(x, y);
    const blobs = [[6, 5], [11, 10], [3, 10]];
    for (const [bx, by] of blobs) {
      if (Math.hypot(x - bx, y - by) < 2.0 + rand() * 0.6) {
        return [clamp255(vary(206, 18)), clamp255(vary(150, 16)), clamp255(vary(108, 14)), 255];
      }
    }
    return base;
  },
  cobble(x, y) {
    // Irregular cobbles separated by dark mortar.
    const cellX = Math.floor(x / 4), cellY = Math.floor(y / 4);
    const inX = x % 4, inY = y % 4;
    const offset = (cellY % 2) * 2;
    const isMortar = inX === 0 || inY === 0 || ((x + offset) % 8 === 0);
    let v = vary(132, 16);
    if (isMortar) v -= 46;
    if (inX === 3 || inY === 3) v -= 14;
    return [clamp255(v), clamp255(v + 2), clamp255(v + 5), 255];
  },
  plank(x, y) {
    const plankH = 4;
    const row = Math.floor(y / plankH);
    const inRow = y % plankH;
    let r = vary(160, 10), g = vary(120, 9), b = vary(72, 8);
    if (inRow === 0) { r -= 40; g -= 32; b -= 22; }       // groove between planks
    const seam = (row % 2) * 8;
    if ((x + seam) % 16 === 0 || (x + seam) % 16 === 15) { r -= 30; g -= 24; b -= 16; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  glass(x, y) {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const inner = x === 1 || y === 1 || x === 14 || y === 14;
    if (border) return [200, 224, 235, 235];
    if (inner) return [170, 200, 215, 120];
    // diagonal streak highlight
    const hi = (x - y + 16) % 16 < 2;
    return [210, 230, 240, hi ? 80 : 36];
  },
  bedrock(x, y) {
    const v = [40, 56, 72, 48][Math.floor(rand() * 4)];
    return [clamp255(vary(v, 8)), clamp255(vary(v, 8)), clamp255(vary(v + 4, 8)), 255];
  },
  gravel(x, y) {
    const tone = rand();
    let v = tone < 0.5 ? vary(120, 18) : vary(150, 18);
    let r = v, g = v - 4, b = v - 10;
    if (rand() < 0.12) { r -= 30; g -= 28; b -= 24; }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  glowstone(x, y) {
    let r = vary(196, 18), g = vary(160, 18), b = vary(78, 14);
    const dots = [[4, 4], [11, 5], [7, 10], [3, 12], [12, 12]];
    for (const [bx, by] of dots) {
      if (Math.hypot(x - bx, y - by) < 1.7) { r = 255; g = vary(236, 12); b = vary(150, 16); }
    }
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  cactus_top(x, y) {
    const inner = x >= 3 && x <= 12 && y >= 3 && y <= 12;
    let g = vary(inner ? 120 : 96, 14), r = vary(inner ? 60 : 48, 10), b = vary(46, 8);
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  cactus_side(x, y) {
    let g = vary(104, 14), r = vary(52, 10), b = vary(40, 8);
    if (x === 0 || x === 15) { g -= 26; r -= 12; }   // ribs
    if ((x === 3 || x === 12) && y % 5 === 2) { g += 30; r += 30; b += 20; } // spine
    return [clamp255(r), clamp255(g), clamp255(b), 255];
  },
  wool(x, y) {
    let v = vary(232, 10);
    if (rand() < 0.12) v -= 18;       // fluffy texture
    return [clamp255(v - 2), clamp255(v - 1), clamp255(v), 255];
  },
  craft_top(x, y) {
    const p = generators.plank(x, y);
    // grid: cross through the middle + border
    if (x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8) {
      return [clamp255(p[0] - 46), clamp255(p[1] - 40), clamp255(p[2] - 30), 255];
    }
    return p;
  },
  craft_side(x, y) {
    const p = generators.plank(x, y);
    // a darker tool panel on the upper half
    if (y >= 2 && y <= 7 && x >= 2 && x <= 13) {
      if (x === 2 || x === 13 || y === 2 || y === 7) return [clamp255(p[0] - 50), clamp255(p[1] - 44), clamp255(p[2] - 34), 255];
      if ((x + y) % 3 === 0) return [clamp255(p[0] - 24), clamp255(p[1] - 20), clamp255(p[2] - 14), 255];
    }
    return p;
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
