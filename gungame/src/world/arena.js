// The combat arena: a stylized-modern (Fortnite-leaning) urban/industrial battleground.
// ~140x140 units with a perimeter wall, stacked shipping containers, crates, low walls,
// walkable ramps, a central raised platform with stairs, pillars, barrels and a catwalk.
//
// Everything that should block the player gets an axis-aligned bounding box pushed into
// `colliders` (the gameplay layer does AABB collision). Cylinders and ramps are
// approximated with boxes. The whole layout is fixed/deterministic so the map is
// identical every load.
import * as THREE from 'three';
import { PALETTE, box, cyl } from '../engine/materials.js';

const HALF = 70;          // arena half-extent -> 140x140 playfield
const GROUND_Y = 0;       // top surface of the ground sits at y = 0
const WALL_H = 8;         // perimeter wall height
const WALL_T = 2;         // perimeter wall thickness

export function buildArena(scene) {
  const group = new THREE.Group();
  group.name = 'arena';
  const colliders = [];

  // --- helpers -------------------------------------------------------------
  // Add a solid box centred at (x, baseY + h/2, z) so `baseY` is its FLOOR, push a
  // matching collider, and parent the mesh under the arena group.
  function solid(w, h, d, material, x, baseY, z) {
    const cy = baseY + h / 2;
    const m = box(w, h, d, material, x, cy, z);
    group.add(m);
    colliders.push({
      min: { x: x - w / 2, y: baseY,     z: z - d / 2 },
      max: { x: x + w / 2, y: baseY + h, z: z + d / 2 },
    });
    return m;
  }

  // Decorative box (mesh only, no collider) — used for things you should not snag on,
  // e.g. railings rendered separately while the catwalk deck carries the real collider.
  function deco(w, h, d, material, x, baseY, z) {
    const m = box(w, h, d, material, x, baseY + h / 2, z);
    group.add(m);
    return m;
  }

  // A barrel: a rust cylinder (visual) approximated by a square collider box.
  function barrel(x, z, r = 0.9, h = 2.1) {
    const c = cyl(r, r, h, PALETTE.rust(), 14);
    c.position.set(x, GROUND_Y + h / 2, z);
    group.add(c);
    const s = r * 0.92; // slightly inset square so it feels round-ish to the player
    colliders.push({
      min: { x: x - s, y: GROUND_Y,     z: z - s },
      max: { x: x + s, y: GROUND_Y + h, z: z + s },
    });
  }

  // A walkable ramp approximated as a short stair of solid steps spanning `length`
  // along an axis, rising to `topY`. dir = +1/-1 sets which end is the low end.
  // axis 'x' means the ramp climbs along X (steps stacked along X), width spans Z.
  function ramp(x, z, length, width, topY, axis = 'x', dir = 1, material = PALETTE.metalDk()) {
    const steps = 6;
    const stepLen = length / steps;
    for (let i = 0; i < steps; i++) {
      const h = (topY * (i + 1)) / steps;          // each step's full floor-to-top height
      const along = (-length / 2 + stepLen / 2 + i * stepLen) * dir;
      if (axis === 'x') {
        solid(stepLen, h, width, material, x + along, GROUND_Y, z);
      } else {
        solid(width, h, stepLen, material, x, GROUND_Y, z + along);
      }
    }
  }

  // A stack of shipping containers. `tints` is an array of materials, bottom-to-top.
  function containerStack(x, z, tints, rot = 0) {
    const W = 12, H = 3.0, D = 5; // a chunky stylized container
    let baseY = GROUND_Y;
    for (const tint of tints) {
      // rotate footprint for the collider when laid the "other" way
      const w = rot ? D : W;
      const d = rot ? W : D;
      const m = box(w, H, d, tint, x, baseY + H / 2, z);
      group.add(m);
      colliders.push({
        min: { x: x - w / 2, y: baseY,     z: z - d / 2 },
        max: { x: x + w / 2, y: baseY + H, z: z + d / 2 },
      });
      // corrugation ridges (decorative, no collider) along the top edge
      const ridge = box(w * 0.98, 0.18, d * 0.98, PALETTE.metalDk(), x, baseY + H - 0.09, z);
      group.add(ridge);
      baseY += H;
    }
  }

  // --- ground --------------------------------------------------------------
  // Thick slab whose TOP surface is at y = 0.
  const groundT = 4;
  const ground = box(HALF * 2, groundT, HALF * 2, PALETTE.asphalt(), 0, GROUND_Y - groundT / 2, 0);
  ground.receiveShadow = true;
  ground.castShadow = false; // a giant floor casting shadows just wastes the shadow map
  group.add(ground);
  // ground is intentionally NOT a collider (the player walks on groundY)

  // Subtle concrete pads / road markings for visual interest (no colliders, flat decals).
  const padMat = PALETTE.concreteDk();
  [[0, 0, 26, 26], [-40, 38, 18, 18], [42, -36, 20, 14], [38, 40, 14, 22]].forEach(([px, pz, pw, pd]) => {
    const pad = box(pw, 0.1, pd, padMat, px, GROUND_Y + 0.05, pz);
    group.add(pad);
  });

  // --- perimeter wall ------------------------------------------------------
  const wallMat = PALETTE.concrete();
  const trimMat = PALETTE.metalDk();
  const wallSpan = HALF * 2 + WALL_T;
  // four walls (centre of each on the boundary line)
  solid(wallSpan, WALL_H, WALL_T, wallMat, 0, GROUND_Y, -HALF); // north (-z)
  solid(wallSpan, WALL_H, WALL_T, wallMat, 0, GROUND_Y, HALF);  // south (+z)
  solid(WALL_T, WALL_H, wallSpan, wallMat, -HALF, GROUND_Y, 0); // west (-x)
  solid(WALL_T, WALL_H, wallSpan, wallMat, HALF, GROUND_Y, 0);  // east (+x)
  // metal trim caps along the wall tops (decorative)
  deco(wallSpan, 0.5, WALL_T + 0.3, trimMat, 0, WALL_H, -HALF);
  deco(wallSpan, 0.5, WALL_T + 0.3, trimMat, 0, WALL_H, HALF);
  deco(WALL_T + 0.3, 0.5, wallSpan, trimMat, -HALF, WALL_H, 0);
  deco(WALL_T + 0.3, 0.5, wallSpan, trimMat, HALF, WALL_H, 0);

  // --- central raised platform with stairs --------------------------------
  // A square plinth in the middle for hero verticality, ringed by step risers.
  const platSize = 18, platH = 3.0;
  solid(platSize, platH, platSize, PALETTE.concrete(), 0, GROUND_Y, 0);
  // accent lip around the top edge
  deco(platSize + 0.6, 0.4, platSize + 0.6, PALETTE.orange(), 0, platH - 0.4, 0);
  // a second, smaller raised tier in one corner of the platform for a sniper nook
  solid(6, 1.6, 6, PALETTE.concreteDk(), -platSize / 2 + 3, platH, -platSize / 2 + 3);
  // four sets of approach steps (one per side) leading up to platH
  const stepRun = 6, stepW = 8;
  ramp(0, platSize / 2 + stepRun / 2, stepRun, stepW, platH, 'z', -1, PALETTE.concreteDk()); // south steps
  ramp(0, -platSize / 2 - stepRun / 2, stepRun, stepW, platH, 'z', 1, PALETTE.concreteDk()); // north steps
  // central pillars on the platform (cover up top)
  solid(1.4, 2.4, 1.4, PALETTE.metalDk(), platSize / 2 - 2, platH, platSize / 2 - 2);
  solid(1.4, 2.4, 1.4, PALETTE.metalDk(), -platSize / 2 + 2, platH, platSize / 2 - 2);

  // --- shipping container clusters (verticality + sightline breaks) --------
  // Use orange/blue accents on a few so the field looks designed, not random.
  containerStack(-44, -30, [PALETTE.orange(), PALETTE.rust()]);                 // 2-high
  containerStack(-44, -22, [PALETTE.metal()]);                                  // single, offset
  containerStack(40, 30, [PALETTE.blue(), PALETTE.metal(), PALETTE.rust()], 1); // 3-high tower, rotated
  containerStack(48, 22, [PALETTE.rust()], 1);                                  // single
  containerStack(-38, 44, [PALETTE.blue(), PALETTE.orange()]);                  // 2-high accent pair
  containerStack(34, -44, [PALETTE.metal(), PALETTE.blue()]);                   // 2-high
  containerStack(-52, 6, [PALETTE.orange()], 1);                                // single accent

  // --- catwalk / bridge ----------------------------------------------------
  // A raised metal deck spanning between the tall container tower and a support pillar,
  // reachable from the 3-high container stack near (40,30). Deck top at y = 6.
  const deckY = 6, deckLen = 26, deckW = 4;
  // support pillars at each end
  solid(1.6, deckY, 1.6, PALETTE.metalDk(), 22, GROUND_Y, 30);
  solid(1.6, deckY, 1.6, PALETTE.metalDk(), 40 - 7, GROUND_Y, 30); // near the tower
  // the walkable deck (collider is the slab; railings are decorative)
  solid(deckLen, 0.6, deckW, PALETTE.metal(), 22, deckY, 30);
  deco(deckLen, 1.0, 0.2, trimMat, 22, deckY + 0.6, 30 - deckW / 2 + 0.1); // rail
  deco(deckLen, 1.0, 0.2, trimMat, 22, deckY + 0.6, 30 + deckW / 2 - 0.1); // rail
  // a ramp climbing up to the catwalk deck so it's reachable on foot
  ramp(22 - deckLen / 2 - 4, 30, 8, deckW, deckY, 'x', -1, PALETTE.metalDk());

  // --- standalone ramps elsewhere (verticality across the field) ----------
  ramp(-20, -48, 12, 6, 4.0, 'x', 1, PALETTE.metalDk());  // ramp #1, climbs along +x
  ramp(52, -8, 10, 6, 3.0, 'z', -1, PALETTE.metalDk());   // ramp #2, climbs along z

  // --- low cover walls -----------------------------------------------------
  const lowMat = PALETTE.concrete();
  const lows = [
    [-12, 1.2, -18, 14, 1, 'x'], [16, 1.2, 18, 12, 1, 'x'],
    [-30, 1.2, 14, 10, 1, 'z'], [28, 1.2, -16, 10, 1, 'z'],
    [8, 1.4, -30, 12, 1, 'x'], [-18, 1.4, 30, 12, 1, 'x'],
  ];
  for (const [lx, lh, lz, len, th, ax] of lows) {
    if (ax === 'x') solid(len, lh, th, lowMat, lx, GROUND_Y, lz);
    else solid(th, lh, len, lowMat, lx, GROUND_Y, lz);
  }
  // a couple of accent-topped low walls
  deco(14, 0.2, 1.2, PALETTE.blue(), -12, 1.2, -18);
  deco(12, 0.2, 1.2, PALETTE.orange(), 16, 1.2, 18);

  // --- wooden crates (small cover, deterministic scatter) -----------------
  // Fixed positions + a few small stacks. wood / woodDk alternating.
  const crateSpots = [
    [-26, -8, 2.2, 0], [-23, -8, 2.2, 1], [-26, -11, 2.2, 0],     // a little cluster
    [30, 6, 2.4, 0], [30, 6, 1.6, 'stack'],                        // stacked
    [12, 34, 2.2, 1], [10, 36, 2.2, 0],
    [-8, 8, 2.0, 0], [-50, -50, 2.4, 0], [50, 50, 2.4, 1],
    [-46, 28, 2.2, 0], [6, -52, 2.2, 1], [-2, 52, 2.0, 0],
    [56, -28, 2.2, 0], [-56, 40, 2.2, 1],
  ];
  for (const [cx, cz, s, kind] of crateSpots) {
    const mat = kind === 1 ? PALETTE.wood() : PALETTE.wood();
    if (kind === 'stack') {
      // a crate sitting on top of the previous one at the same x/z
      solid(s, s, s, PALETTE.woodDk ? PALETTE.woodDk() : PALETTE.wood(), cx, 2.4, cz);
    } else {
      solid(s, s, s, mat, cx, GROUND_Y, cz);
    }
  }

  // --- pillars (thin vertical cover / landmarks) --------------------------
  const pillarMat = PALETTE.metalDk();
  const pillars = [
    [-15, 15, 5], [15, -15, 5], [0, 40, 6], [0, -40, 6],
    [40, 0, 5], [-40, 0, 5], [22, 22, 4], [-22, -22, 4],
  ];
  for (const [px, pz, ph] of pillars) {
    solid(1.3, ph, 1.3, pillarMat, px, GROUND_Y, pz);
    deco(1.6, 0.3, 1.6, PALETTE.metal(), px, ph, pz); // cap
  }

  // --- barrels (cylinders approximated as boxes) --------------------------
  const barrelSpots = [
    [-34, -2], [-32, -3], [-33, 0],          // a small drum cluster
    [33, -33], [35, -32],
    [18, 12], [-10, -34], [44, 10], [-44, 16],
    [10, 22], [-20, 0], [26, 38], [-36, -38],
  ];
  for (const [bx, bz] of barrelSpots) barrel(bx, bz);

  // --- spawns --------------------------------------------------------------
  // Eight points on open ground, ringed around the arena, clear of the cover above.
  const spawns = [
    { x: 0,   y: GROUND_Y, z: 58 },
    { x: 0,   y: GROUND_Y, z: -58 },
    { x: 58,  y: GROUND_Y, z: 0 },
    { x: -58, y: GROUND_Y, z: 0 },
    { x: 40,  y: GROUND_Y, z: 40 },
    { x: -40, y: GROUND_Y, z: -40 },
    { x: 40,  y: GROUND_Y, z: -40 },
    { x: -40, y: GROUND_Y, z: 40 },
  ];

  scene.add(group);
  return { group, colliders, spawns, groundY: GROUND_Y, half: HALF };
}
