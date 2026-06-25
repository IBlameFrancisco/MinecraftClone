// Destructible structures (the hybrid "Battlefield/Siege" layer). The static arena stays
// solid; these volumes are voxel grids you can blow apart. Each volume renders as one
// InstancedMesh of cubes and exposes a sphere `carve()`. Collision is derived by merging
// vertical runs of occupied voxels into a small set of AABBs (cheap for the controller),
// rebuilt only when something is destroyed. Debris is cosmetic and lives in fx.
import * as THREE from 'three';

export class Destructible {
  constructor(scene, vs = 0.7) {
    this.scene = scene; this.vs = vs; this.volumes = [];
    this.geo = new THREE.BoxGeometry(vs, vs, vs);
    this.colliderList = [];           // cached AABBs (static-style {min,max}); rebuilt on carve
    this.onDebris = null;             // (pos, color) => {}  cosmetic chunks
  }

  // Fill a box region (floor at baseY, centred on x/z) with voxels of one material.
  addWall(material, x, baseY, z, w, h, d) {
    const vs = this.vs;
    const nx = Math.max(1, Math.round(w / vs)), ny = Math.max(1, Math.round(h / vs)), nz = Math.max(1, Math.round(d / vs));
    const vol = {
      nx, ny, nz, vs,
      ox: x - (nx * vs) / 2, oy: baseY, oz: z - (nz * vs) / 2,
      occ: new Uint8Array(nx * ny * nz).fill(1),
      color: (material.color && material.color.getHex()) || 0x9a8d7a,
      mesh: new THREE.InstancedMesh(this.geo, material, nx * ny * nz),
    };
    vol.mesh.castShadow = vol.mesh.receiveShadow = true;
    vol.mesh.frustumCulled = false;
    this.volumes.push(vol); this.scene.add(vol.mesh);
    this._rebuildMesh(vol);
    return vol;
  }

  _i(vol, x, y, z) { return (x * vol.ny + y) * vol.nz + z; }
  _cx(vol, x) { return vol.ox + (x + 0.5) * vol.vs; }
  _cy(vol, y) { return vol.oy + (y + 0.5) * vol.vs; }
  _cz(vol, z) { return vol.oz + (z + 0.5) * vol.vs; }

  _rebuildMesh(vol) {
    const m = new THREE.Matrix4(); let i = 0;
    for (let x = 0; x < vol.nx; x++) for (let y = 0; y < vol.ny; y++) for (let z = 0; z < vol.nz; z++) {
      if (vol.occ[this._i(vol, x, y, z)]) { m.setPosition(this._cx(vol, x), this._cy(vol, y), this._cz(vol, z)); vol.mesh.setMatrixAt(i++, m); }
    }
    vol.mesh.count = i; vol.mesh.instanceMatrix.needsUpdate = true;
  }

  // merge contiguous vertical (y) runs of occupied voxels per (x,z) column into AABBs
  _rebuildColliders() {
    const out = []; const h = 0; // exact voxel bounds
    for (const vol of this.volumes) {
      for (let x = 0; x < vol.nx; x++) for (let z = 0; z < vol.nz; z++) {
        let y = 0;
        while (y < vol.ny) {
          if (!vol.occ[this._i(vol, x, y, z)]) { y++; continue; }
          let y2 = y; while (y2 < vol.ny && vol.occ[this._i(vol, x, y2, z)]) y2++;
          const minX = this._cx(vol, x) - vol.vs / 2, minZ = this._cz(vol, z) - vol.vs / 2;
          out.push({
            min: { x: minX, y: this._cy(vol, y) - vol.vs / 2, z: minZ },
            max: { x: minX + vol.vs, y: this._cy(vol, y2 - 1) + vol.vs / 2, z: minZ + vol.vs },
          });
          y = y2;
        }
      }
    }
    this.colliderList = out;
  }

  finalize() { this._rebuildColliders(); }   // call once after all walls added

  // remove all voxels within `radius` of `center`; returns true if anything was destroyed
  carve(center, radius) {
    const r2 = radius * radius; let destroyed = 0; const dirty = new Set();
    for (let vi = 0; vi < this.volumes.length; vi++) {
      const vol = this.volumes[vi];
      // quick reject: sphere vs volume AABB
      if (center.x + radius < vol.ox || center.x - radius > vol.ox + vol.nx * vol.vs ||
          center.y + radius < vol.oy || center.y - radius > vol.oy + vol.ny * vol.vs ||
          center.z + radius < vol.oz || center.z - radius > vol.oz + vol.nz * vol.vs) continue;
      const x0 = Math.max(0, Math.floor((center.x - radius - vol.ox) / vol.vs)), x1 = Math.min(vol.nx - 1, Math.ceil((center.x + radius - vol.ox) / vol.vs));
      const y0 = Math.max(0, Math.floor((center.y - radius - vol.oy) / vol.vs)), y1 = Math.min(vol.ny - 1, Math.ceil((center.y + radius - vol.oy) / vol.vs));
      const z0 = Math.max(0, Math.floor((center.z - radius - vol.oz) / vol.vs)), z1 = Math.min(vol.nz - 1, Math.ceil((center.z + radius - vol.oz) / vol.vs));
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const idx = this._i(vol, x, y, z); if (!vol.occ[idx]) continue;
        const dx = this._cx(vol, x) - center.x, dy = this._cy(vol, y) - center.y, dz = this._cz(vol, z) - center.z;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          vol.occ[idx] = 0; destroyed++; dirty.add(vi);
          if (this.onDebris && Math.random() < 0.16) this.onDebris(new THREE.Vector3(this._cx(vol, x), this._cy(vol, y), this._cz(vol, z)), vol.color);
        }
      }
    }
    if (destroyed) { for (const vi of dirty) this._rebuildMesh(this.volumes[vi]); this._rebuildColliders(); }
    return destroyed > 0;
  }

  clearAll() { for (const v of this.volumes) this.scene.remove(v.mesh); this.volumes = []; this.colliderList = []; }
}
