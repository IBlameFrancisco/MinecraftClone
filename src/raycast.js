// Voxel raycast via the Amanatides & Woo DDA grid traversal. Returns the first
// hit block, the face normal, and the adjacent (placement) cell.

import { AIR, WATER } from './blocks.js';

const defaultHittable = (id) => id !== AIR && id !== WATER;

export function voxelRaycast(origin, dir, maxDist, getBlock, hittable = defaultHittable) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);

  const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
  const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
  const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);

  const fracX = origin.x - x, fracY = origin.y - y, fracZ = origin.z - z;
  let tMaxX = dir.x === 0 ? Infinity : (stepX > 0 ? (1 - fracX) : fracX) * tDeltaX;
  let tMaxY = dir.y === 0 ? Infinity : (stepY > 0 ? (1 - fracY) : fracY) * tDeltaY;
  let tMaxZ = dir.z === 0 ? Infinity : (stepZ > 0 ? (1 - fracZ) : fracZ) * tDeltaZ;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  // Check the starting cell first (camera could be inside a block).
  if (hittable(getBlock(x, y, z))) {
    return { hit: true, x, y, z, nx: 0, ny: 1, nz: 0, px: x, py: y + 1, pz: z };
  }

  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) break;
    if (hittable(getBlock(x, y, z))) {
      return { hit: true, x, y, z, nx, ny, nz, px: x + nx, py: y + ny, pz: z + nz };
    }
  }
  return { hit: false };
}
