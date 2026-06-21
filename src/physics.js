// Shared AABB-vs-voxel movement, used by mobs (and mirrors the player's own
// collision). Moves an entity one axis at a time and resolves penetration
// against solid blocks. Returns whether the entity is standing on ground.

import { isSolid } from './blocks.js';

export function moveEntity(world, pos, vel, half, height, dt) {
  dt = Math.min(dt, 0.05);
  let onGround = false;

  moveAxis(world, pos, vel, half, height, 'x', vel.x * dt);
  moveAxis(world, pos, vel, half, height, 'z', vel.z * dt);
  onGround = moveAxis(world, pos, vel, half, height, 'y', vel.y * dt);
  return onGround;
}

function moveAxis(world, pos, vel, half, height, axis, amount) {
  if (amount === 0) return false;
  pos[axis] += amount;

  const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half);
  const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height);
  const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (!isSolid(world.getBlock(x, y, z))) continue;
        if (axis === 'x') {
          if (amount > 0) pos.x = x - half - 1e-4; else pos.x = x + 1 + half + 1e-4;
          vel.x = 0;
        } else if (axis === 'z') {
          if (amount > 0) pos.z = z - half - 1e-4; else pos.z = z + 1 + half + 1e-4;
          vel.z = 0;
        } else {
          if (amount > 0) { pos.y = y - height - 1e-4; vel.y = 0; return false; }
          pos.y = y + 1 + 1e-4; vel.y = 0; return true; // landed
        }
        return false;
      }
    }
  }
  return false;
}

// Ray vs axis-aligned box (slab method). Returns hit distance or Infinity.
export function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : Infinity);
}
