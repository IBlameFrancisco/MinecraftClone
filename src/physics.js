// Shared AABB-vs-voxel movement, used by mobs (and mirrors the player's own
// collision). Moves an entity one axis at a time and resolves penetration
// against solid blocks. Returns whether the entity is standing on ground.

import { isSolid } from './blocks.js';

// `stepUp` (blocks) enables auto-stepping: when a horizontal move bumps a low ledge,
// the entity is lifted onto it (preserving momentum) instead of stopping dead. Lets
// bots/mobs walk over 1-block rubble without relying on a perfectly-timed jump.
export function moveEntity(world, pos, vel, half, height, dt, stepUp = 0) {
  dt = Math.min(dt, 0.05);
  const grounded = stepUp > 0 && onGroundNow(world, pos, half);   // only step from the ground, never mid-air
  moveAxis(world, pos, vel, half, height, 'x', vel.x * dt, grounded ? stepUp : 0);
  moveAxis(world, pos, vel, half, height, 'z', vel.z * dt, grounded ? stepUp : 0);
  return moveAxis(world, pos, vel, half, height, 'y', vel.y * dt, 0);
}

function boxCollides(world, pos, half, height) {
  const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half);
  const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height);
  const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++)
        if (isSolid(world.getBlock(x, y, z))) return true;
  return false;
}
function onGroundNow(world, pos, half) {
  const y = Math.floor(pos.y - 0.05);
  const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half);
  const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half);
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++)
    if (isSolid(world.getBlock(x, y, z))) return true;
  return false;
}

function moveAxis(world, pos, vel, half, height, axis, amount, stepUp) {
  if (amount === 0) return false;
  pos[axis] += amount;

  const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half);
  const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height);
  const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half);

  let bx = 0, by = 0, bz = 0, hit = false;
  for (let y = minY; y <= maxY && !hit; y++)
    for (let x = minX; x <= maxX && !hit; x++)
      for (let z = minZ; z <= maxZ && !hit; z++)
        if (isSolid(world.getBlock(x, y, z))) { hit = true; bx = x; by = y; bz = z; }
  if (!hit) return false;

  // Auto-step: lift onto a low ledge if the entity fits at the stepped height.
  if (stepUp > 0 && (axis === 'x' || axis === 'z')) {
    const savedY = pos.y, stepTo = by + 1 + 1e-3;
    if (stepTo - savedY <= stepUp) {
      pos.y = stepTo;
      if (!boxCollides(world, pos, half, height)) return false;   // stepped up — keep advance + momentum
      pos.y = savedY;
    }
  }

  if (axis === 'x') { if (amount > 0) pos.x = bx - half - 1e-4; else pos.x = bx + 1 + half + 1e-4; vel.x = 0; return false; }
  if (axis === 'z') { if (amount > 0) pos.z = bz - half - 1e-4; else pos.z = bz + 1 + half + 1e-4; vel.z = 0; return false; }
  if (amount > 0) { pos.y = by - height - 1e-4; vel.y = 0; return false; }
  pos.y = by + 1 + 1e-4; vel.y = 0; return true; // landed
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
