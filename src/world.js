// World manager: owns chunks, streams generation + meshing around the player with
// a per-frame time budget, and handles edits with correct neighbour remeshing.

import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT, RENDER_DISTANCE } from './constants.js';
import { AIR } from './blocks.js';
import { Chunk } from './chunk.js';
import { WorldGen } from './worldgen.js';
import { buildChunkGeometry } from './mesher.js';
import { opaqueMaterial, waterMaterial } from './materials.js';

export class World {
  constructor(scene, seed) {
    this.gen = new WorldGen(seed);
    this.chunks = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.genQueue = [];          // chunks awaiting terrain generation
    this.pcx = 0;
    this.pcz = 0;
    this.renderDistance = RENDER_DISTANCE;  // runtime-adjustable (settings)
  }

  key(cx, cz) { return cx + ',' + cz; }
  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  // Wipe all chunks and reseed (used by the seed / "new world" / battle UI). `map`
  // selects the battle map: 'arena' (or true), 'beach', or false for normal terrain.
  regenerate(seed, map = false) {
    for (const c of this.chunks.values()) {
      if (c.mesh) this.group.remove(c.mesh);
      if (c.waterMesh) this.group.remove(c.waterMesh);
      c.dispose();
    }
    this.chunks.clear();
    this.genQueue.length = 0;
    this.gen = new WorldGen(seed);
    this.gen.arena = (map === 'arena' || map === true);
    this.gen.beach = (map === 'beach');
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return AIR;
    const cx = wx >> 4, cz = wz >> 4;
    const c = this.chunks.get(this.key(cx, cz));
    if (!c || !c.generated) return AIR;
    return c.getLocal(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  }

  // Highest sky-blocking y in a column (for skylight). Falls back to raw terrain
  // height for not-yet-generated neighbour columns.
  getHeight(wx, wz) {
    const cx = wx >> 4, cz = wz >> 4;
    const c = this.chunks.get(this.key(cx, cz));
    if (c && c.generated) return c.getColumnHeight(wx - cx * CHUNK_SIZE, wz - cz * CHUNK_SIZE);
    return this.gen.heightAt(wx, wz);
  }

  surfaceHeight(wx, wz) {
    // Scan down from a generated column if present, else terrain height.
    const cx = wx >> 4, cz = wz >> 4;
    const c = this.chunks.get(this.key(cx, cz));
    if (c && c.generated) {
      const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        if (c.getLocal(lx, y, lz) !== AIR) return y;
      }
      return 0;
    }
    return this.gen.heightAt(wx, wz);
  }

  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const cx = wx >> 4, cz = wz >> 4;
    const c = this.chunks.get(this.key(cx, cz));
    if (!c || !c.generated) return false;
    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
    if (c.getLocal(lx, wy, lz) === id) return false;
    c.setLocal(lx, wy, lz, id);
    c.recomputeColumn(lx, lz);

    // Dirty this chunk and any neighbour whose faces/AO touch the edit.
    this.markDirty(cx, cz);
    if (lx === 0) { this.markDirty(cx - 1, cz); if (lz === 0) this.markDirty(cx - 1, cz - 1); if (lz === 15) this.markDirty(cx - 1, cz + 1); }
    if (lx === 15) { this.markDirty(cx + 1, cz); if (lz === 0) this.markDirty(cx + 1, cz - 1); if (lz === 15) this.markDirty(cx + 1, cz + 1); }
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === 15) this.markDirty(cx, cz + 1);
    return true;
  }

  markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  neighboursGenerated(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.getChunk(cx + dx, cz + dz);
        if (!c || !c.generated) return false;
      }
    }
    return true;
  }

  // Called each frame: schedule generation/unload around the player position.
  update(playerX, playerZ) {
    this.pcx = Math.floor(playerX / CHUNK_SIZE);
    this.pcz = Math.floor(playerZ / CHUNK_SIZE);
    // Generate two rings past the render distance: meshing a chunk needs all 8
    // neighbours generated, and a chunk at the meshing edge has diagonal neighbours
    // beyond renderDistance+1 — so +1 left a ring that could never mesh.
    const genR = this.renderDistance + 2;

    // Schedule any missing chunk in range for generation.
    for (let dz = -genR; dz <= genR; dz++) {
      for (let dx = -genR; dx <= genR; dx++) {
        if (dx * dx + dz * dz > genR * genR) continue;
        const cx = this.pcx + dx, cz = this.pcz + dz;
        if (!this.chunks.has(this.key(cx, cz))) {
          const c = new Chunk(cx, cz);
          this.chunks.set(this.key(cx, cz), c);
          this.genQueue.push(c);
        }
      }
    }

    // Unload chunks well outside the view radius.
    const unloadR = genR + 2;
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - this.pcx) > unloadR || Math.abs(c.cz - this.pcz) > unloadR) {
        if (c.mesh) this.group.remove(c.mesh);
        if (c.waterMesh) this.group.remove(c.waterMesh);
        c.dispose();
        this.chunks.delete(k);
      }
    }
  }

  dist2(c) {
    const dx = c.cx - this.pcx, dz = c.cz - this.pcz;
    return dx * dx + dz * dz;
  }

  // Spend up to `budgetMs` generating + meshing the nearest pending chunks.
  processQueues(budgetMs) {
    const t0 = performance.now();

    // --- Generation (nearest first) ---
    if (this.genQueue.length) {
      this.genQueue.sort((a, b) => this.dist2(b) - this.dist2(a)); // nearest at end
      while (this.genQueue.length && performance.now() - t0 < budgetMs) {
        const c = this.genQueue.pop();
        if (this.getChunk(c.cx, c.cz) !== c) continue;   // unloaded/replaced while queued — drop it
        if (!c.generated) {
          this.gen.generate(c);
          if (this.applyEditsToChunk) this.applyEditsToChunk(c);
          c.dirty = true;
        }
      }
    }

    // --- Meshing (nearest dirty chunk whose neighbours are ready) ---
    while (performance.now() - t0 < budgetMs) {
      let best = null, bestD = Infinity;
      for (const c of this.chunks.values()) {
        if (!c.dirty || !c.generated) continue;
        if (this.dist2(c) > (this.renderDistance + 0.5) ** 2) continue;
        if (!this.neighboursGenerated(c.cx, c.cz)) continue;
        const d = this.dist2(c);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      this.buildMesh(best);
    }
  }

  buildMesh(c) {
    c.dirty = false;
    c.meshed = true;
    const { solid, water } = buildChunkGeometry(this, c.cx, c.cz);
    const px = c.cx * CHUNK_SIZE, pz = c.cz * CHUNK_SIZE;

    // Opaque mesh
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
    if (solid) {
      const m = new THREE.Mesh(solid, opaqueMaterial);
      m.position.set(px, 0, pz);
      m.frustumCulled = true;
      this.group.add(m);
      c.mesh = m;
    }

    // Water/transparent mesh
    if (c.waterMesh) { this.group.remove(c.waterMesh); c.waterMesh.geometry.dispose(); c.waterMesh = null; }
    if (water) {
      const m = new THREE.Mesh(water, waterMaterial);
      m.position.set(px, 0, pz);
      m.renderOrder = 1;
      this.group.add(m);
      c.waterMesh = m;
    }
  }

  // True once the chunk the player stands in is meshed (used to gate spawn so the
  // player/mobs don't drop in before the floor geometry exists).
  isReady(wx, wz) {
    const c = this.getChunk(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE));
    return !!(c && c.meshed);
  }
}
