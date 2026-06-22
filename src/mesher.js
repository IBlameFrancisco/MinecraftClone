// Face-culled, per-face meshing with per-vertex ambient occlusion. Builds one
// merged BufferGeometry for opaque blocks and one for transparent water/glass.
// Lighting (directional face shade * AO * skylight) is baked into vertex colors.

import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT } from './constants.js';
import {
  AIR, WATER, BLOCKS, isOpaque, isTransparent, lightEmission,
} from './blocks.js';
import { tileForFace } from './textures.js';

const AREA = CHUNK_SIZE * CHUNK_SIZE; // y-stride within a chunk's block array

const PW = CHUNK_SIZE + 2;       // padded width/depth (one block of neighbours)
const PHH = CHUNK_HEIGHT + 2;    // padded height
const pIndex = (px, py, pz) => (py * PW + pz) * PW + px;

// Per-direction face shading (Minecraft-style): top brightest, bottom darkest.
// Softened so vertical faces keep clear directional definition without reading
// as flat-grey or near-black — the +X/-X and +Z/-Z pairs are lifted slightly and
// the bottom is no longer punishingly dark.
const FACE_SHADE = [0.66, 0.66, 1.0, 0.58, 0.83, 0.83]; // +X -X +Y -Y +Z -Z
// Ambient occlusion ramp. Raised, perceptually-eased floor so creases read as a
// soft shadow rather than a hard black gradient; the step from full-light (1.0)
// to one-occluder is gentler so flat ground doesn't look noisy.
const AO_LEVEL = [0.55, 0.72, 0.88, 1.0];
const SKY_DARK = 0.46;           // ambient floor for sky-occluded cells (softer caves/overhangs)

// Face table. For each direction: normal, tile selector dir, and 4 corners with
// position offset, tile-space uv (v=0 is the canvas-top so side textures stand
// upright), and three AO sample offsets relative to the block origin.
const FACES = [
  { // +X (east)
    n: [1, 0, 0], dir: 0,
    corners: [
      { pos: [1, 0, 0], uv: [0, 1], ao: [[1, -1, 0], [1, 0, -1], [1, -1, -1]] },
      { pos: [1, 1, 0], uv: [0, 0], ao: [[1, 1, 0], [1, 0, -1], [1, 1, -1]] },
      { pos: [1, 1, 1], uv: [1, 0], ao: [[1, 1, 0], [1, 0, 1], [1, 1, 1]] },
      { pos: [1, 0, 1], uv: [1, 1], ao: [[1, -1, 0], [1, 0, 1], [1, -1, 1]] },
    ],
  },
  { // -X (west)
    n: [-1, 0, 0], dir: 1,
    corners: [
      { pos: [0, 0, 0], uv: [0, 1], ao: [[-1, -1, 0], [-1, 0, -1], [-1, -1, -1]] },
      { pos: [0, 0, 1], uv: [1, 1], ao: [[-1, -1, 0], [-1, 0, 1], [-1, -1, 1]] },
      { pos: [0, 1, 1], uv: [1, 0], ao: [[-1, 1, 0], [-1, 0, 1], [-1, 1, 1]] },
      { pos: [0, 1, 0], uv: [0, 0], ao: [[-1, 1, 0], [-1, 0, -1], [-1, 1, -1]] },
    ],
  },
  { // +Y (top)
    n: [0, 1, 0], dir: 2,
    corners: [
      { pos: [0, 1, 0], uv: [0, 0], ao: [[-1, 1, 0], [0, 1, -1], [-1, 1, -1]] },
      { pos: [0, 1, 1], uv: [0, 1], ao: [[-1, 1, 0], [0, 1, 1], [-1, 1, 1]] },
      { pos: [1, 1, 1], uv: [1, 1], ao: [[1, 1, 0], [0, 1, 1], [1, 1, 1]] },
      { pos: [1, 1, 0], uv: [1, 0], ao: [[1, 1, 0], [0, 1, -1], [1, 1, -1]] },
    ],
  },
  { // -Y (bottom)
    n: [0, -1, 0], dir: 3,
    corners: [
      { pos: [0, 0, 0], uv: [0, 0], ao: [[-1, -1, 0], [0, -1, -1], [-1, -1, -1]] },
      { pos: [1, 0, 0], uv: [1, 0], ao: [[1, -1, 0], [0, -1, -1], [1, -1, -1]] },
      { pos: [1, 0, 1], uv: [1, 1], ao: [[1, -1, 0], [0, -1, 1], [1, -1, 1]] },
      { pos: [0, 0, 1], uv: [0, 1], ao: [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]] },
    ],
  },
  { // +Z (south)
    n: [0, 0, 1], dir: 4,
    corners: [
      { pos: [0, 0, 1], uv: [0, 1], ao: [[-1, 0, 1], [0, -1, 1], [-1, -1, 1]] },
      { pos: [1, 0, 1], uv: [1, 1], ao: [[1, 0, 1], [0, -1, 1], [1, -1, 1]] },
      { pos: [1, 1, 1], uv: [1, 0], ao: [[1, 0, 1], [0, 1, 1], [1, 1, 1]] },
      { pos: [0, 1, 1], uv: [0, 0], ao: [[-1, 0, 1], [0, 1, 1], [-1, 1, 1]] },
    ],
  },
  { // -Z (north)
    n: [0, 0, -1], dir: 5,
    corners: [
      { pos: [1, 0, 0], uv: [1, 1], ao: [[1, 0, -1], [0, -1, -1], [1, -1, -1]] },
      { pos: [0, 0, 0], uv: [0, 1], ao: [[-1, 0, -1], [0, -1, -1], [-1, -1, -1]] },
      { pos: [0, 1, 0], uv: [0, 0], ao: [[-1, 0, -1], [0, 1, -1], [-1, 1, -1]] },
      { pos: [1, 1, 0], uv: [1, 0], ao: [[1, 0, -1], [0, 1, -1], [1, 1, -1]] },
    ],
  },
];

// Should the face between `cur` and neighbour `nb` be drawn?
function shouldRenderFace(cur, nb) {
  if (nb === AIR) return true;
  const pc = BLOCKS[cur], pn = BLOCKS[nb];
  if (pc.opaque) return !pn.opaque;          // opaque hidden by opaque
  if (cur === nb) return false;              // identical transparent: cull interior
  return !pn.opaque;                         // transparent shown unless backed by opaque
}

// Reusable scratch volumes (avoids per-chunk allocation churn).
const idVol = new Uint8Array(PW * PW * PHH);
const opVol = new Uint8Array(PW * PW * PHH);

export function buildChunkGeometry(world, cx, cz) {
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;

  // Populate padded id + opacity volumes. Resolve the source chunk once per
  // column (324 map lookups) then index its block array directly per cell.
  idVol.fill(0);
  opVol.fill(0);
  let maxFillY = 0;
  for (let pz = 0; pz < PW; pz++) {
    const wz = oz + pz - 1;
    const ncz = wz >> 4;
    const lz = wz - ncz * CHUNK_SIZE;
    for (let px = 0; px < PW; px++) {
      const wx = ox + px - 1;
      const ncx = wx >> 4;
      const lx = wx - ncx * CHUNK_SIZE;
      const chunk = world.getChunk(ncx, ncz);
      if (!chunk || !chunk.generated) continue; // leave as air
      const blocks = chunk.blocks;
      const base = lz * CHUNK_SIZE + lx;
      for (let wy = 0; wy < CHUNK_HEIGHT; wy++) {
        const id = blocks[wy * AREA + base];
        if (id === 0) continue;
        const i = pIndex(px, wy + 1, pz);
        idVol[i] = id;
        opVol[i] = isOpaque(id) ? 1 : 0;
        if (wy > maxFillY) maxFillY = wy;
      }
    }
  }

  // Padded heightmap for skylight (highest opaque y per column).
  const heights = new Int16Array(PW * PW);
  for (let pz = 0; pz < PW; pz++) {
    for (let px = 0; px < PW; px++) {
      heights[pz * PW + px] = world.getHeight(ox + px - 1, oz + pz - 1);
    }
  }

  resetBuf(solidBuf);
  resetBuf(waterBuf);
  const solid = solidBuf;
  const water = waterBuf;

  const topY = Math.min(CHUNK_HEIGHT - 1, maxFillY + 1);
  for (let ly = 0; ly <= topY; ly++) {
    const py = ly + 1;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const pz = lz + 1;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const px = lx + 1;
        const id = idVol[pIndex(px, py, pz)];
        if (id === AIR) continue;

        const transparent = isTransparent(id);
        const buf = transparent ? water : solid;
        const emissive = lightEmission(id) > 0;
        const isWater = id === WATER;
        const waterSurface = isWater && idVol[pIndex(px, py + 1, pz)] !== WATER;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = face.n[0], ny = face.n[1], nz = face.n[2];
          const nb = idVol[pIndex(px + nx, py + ny, pz + nz)];
          if (!shouldRenderFace(id, nb)) continue;

          // Skylight: is the adjacent air cell open to the sky?
          const airY = ly + ny;
          const colH = heights[(pz + nz) * PW + (px + nx)];
          const skyFactor = airY > colH ? 1.0 : SKY_DARK;

          const tile = tileForFace(id, face.dir);
          const du = tile.u1 - tile.u0;
          const dv = tile.v1 - tile.v0;
          const shade = FACE_SHADE[face.dir];

          const base = buf.pos.length / 3;
          const aoOut = [0, 0, 0, 0];

          for (let k = 0; k < 4; k++) {
            const c = face.corners[k];
            // Ambient occlusion from the three neighbours around this corner.
            const s1 = opVol[pIndex(px + c.ao[0][0], py + c.ao[0][1], pz + c.ao[0][2])];
            const s2 = opVol[pIndex(px + c.ao[1][0], py + c.ao[1][1], pz + c.ao[1][2])];
            const cc = opVol[pIndex(px + c.ao[2][0], py + c.ao[2][1], pz + c.ao[2][2])];
            const aoLvl = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            const aoF = AO_LEVEL[aoLvl];
            aoOut[k] = aoF;

            // Soften how AO bites into the directional shade: a sky-occluded face
            // keeps a little more of its base tone so caves/overhangs read as dim
            // rather than crushed, while open faces are unaffected.
            const ao = aoF * (0.86 + 0.14 * skyFactor);
            let bright = shade * ao * skyFactor;
            if (emissive) bright = Math.max(bright, 0.92);
            if (bright < 0.08) bright = 0.08;

            const vy = ly + c.pos[1] - (waterSurface && c.pos[1] === 1 ? 0.12 : 0);
            buf.pos.push(lx + c.pos[0], vy, lz + c.pos[2]);
            buf.uv.push(tile.u0 + c.uv[0] * du, tile.v0 + c.uv[1] * dv);
            if (emissive) buf.col.push(bright, bright * 0.95, bright * 0.78);
            else buf.col.push(bright, bright, bright);
          }

          // Flip the quad's split to avoid AO interpolation artifacts.
          if (aoOut[0] + aoOut[2] > aoOut[1] + aoOut[3]) {
            buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }

  return {
    solid: finishGeometry(solid),
    water: finishGeometry(water),
  };
}

// Persistent scratch buffers reused across builds to avoid GC churn.
const solidBuf = { pos: [], uv: [], col: [], idx: [] };
const waterBuf = { pos: [], uv: [], col: [], idx: [] };
function resetBuf(b) { b.pos.length = 0; b.uv.length = 0; b.col.length = 0; b.idx.length = 0; }

function finishGeometry(buf) {
  if (buf.idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  g.setIndex(buf.idx);
  g.computeBoundingSphere();
  return g;
}
