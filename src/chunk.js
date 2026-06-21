// A single column-chunk of voxels (16 x 128 x 16). Stores block ids in a flat
// typed array plus a per-column sky-blocking heightmap used for cheap skylight.

import { CHUNK_SIZE, CHUNK_HEIGHT } from './constants.js';
import { isOpaque } from './blocks.js';

export const CHUNK_VOL = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;

// Memory layout: x fastest, then z, then y.
export function idx(x, y, z) {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOL);
    this.heightMap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(-1);

    this.generated = false;
    this.dirty = true;          // needs (re)meshing
    this.meshed = false;        // has been through buildMesh at least once
    this.mesh = null;           // opaque THREE.Mesh
    this.waterMesh = null;      // transparent THREE.Mesh
  }

  inRange(x, y, z) {
    return x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y >= 0 && y < CHUNK_HEIGHT;
  }

  getLocal(x, y, z) {
    if (!this.inRange(x, y, z)) return 0;
    return this.blocks[idx(x, y, z)];
  }

  setLocal(x, y, z, id) {
    if (!this.inRange(x, y, z)) return;
    this.blocks[idx(x, y, z)] = id;
  }

  // Used by world-gen tree stamping: only fill empty cells, ignore out of range.
  setLocalIfAir(x, y, z, id) {
    if (!this.inRange(x, y, z)) return;
    const i = idx(x, y, z);
    if (this.blocks[i] === 0) this.blocks[i] = id;
  }

  // Highest sky-blocking block in a column (or -1). Air above this y sees sky.
  recomputeColumn(x, z) {
    let top = -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (isOpaque(this.blocks[idx(x, y, z)])) { top = y; break; }
    }
    this.heightMap[z * CHUNK_SIZE + x] = top;
  }

  recomputeHeightMap() {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) this.recomputeColumn(x, z);
    }
  }

  getColumnHeight(x, z) {
    return this.heightMap[z * CHUNK_SIZE + x];
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }
  }
}
