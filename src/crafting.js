// Crafting: shapeless recipes (matched by exact ingredient counts) and shaped
// recipes (matched against the trimmed bounding box of the grid, so they can sit
// anywhere). Works for the 2x2 inventory grid and the 3x3 crafting table.

import { LOG, PLANK, COBBLE, CRAFTING_TABLE, CHEST, TORCH } from './blocks.js';
import {
  STICK, COAL,
  WOOD_PICKAXE, WOOD_AXE, WOOD_SHOVEL, WOOD_SWORD,
  STONE_PICKAXE, STONE_AXE, STONE_SHOVEL, STONE_SWORD,
} from './items.js';

const SHAPELESS = [
  { ingredients: { [LOG]: 1 }, result: { id: PLANK, count: 4 } },
  { ingredients: { [PLANK]: 2 }, result: { id: STICK, count: 4 } },
  { ingredients: { [PLANK]: 4 }, result: { id: CRAFTING_TABLE, count: 1 } },
  { ingredients: { [PLANK]: 8 }, result: { id: CHEST, count: 1 } },
  { ingredients: { [COAL]: 1, [STICK]: 1 }, result: { id: TORCH, count: 4 } },
];

// Shaped tool recipes (0 = empty). Generated for wood (planks) and stone (cobble).
function toolSet(M, pick, axe, shovel, sword) {
  return [
    { grid: [[M, M, M], [0, STICK, 0], [0, STICK, 0]], result: { id: pick, count: 1 } },
    { grid: [[M, M], [M, STICK], [0, STICK]], result: { id: axe, count: 1 } },
    { grid: [[M], [STICK], [STICK]], result: { id: shovel, count: 1 } },
    { grid: [[M], [M], [STICK]], result: { id: sword, count: 1 } },
  ];
}
const SHAPED = [
  ...toolSet(PLANK, WOOD_PICKAXE, WOOD_AXE, WOOD_SHOVEL, WOOD_SWORD),
  ...toolSet(COBBLE, STONE_PICKAXE, STONE_AXE, STONE_SHOVEL, STONE_SWORD),
];

function trim(slots, size) {
  let minR = size, maxR = -1, minC = size, maxC = -1;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const s = slots[r * size + c];
    if (s && s.id !== 0) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  }
  if (maxR < 0) return null;
  const g = [];
  for (let r = minR; r <= maxR; r++) {
    const row = [];
    for (let c = minC; c <= maxC; c++) { const s = slots[r * size + c]; row.push(s ? s.id : 0); }
    g.push(row);
  }
  return g;
}

function gridEq(a, b) {
  if (a.length !== b.length || a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++) for (let c = 0; c < a[0].length; c++) if (a[r][c] !== b[r][c]) return false;
  return true;
}

export function matchRecipe(slots) {
  const size = Math.round(Math.sqrt(slots.length));

  // Shaped (tools) — only the trimmed shape must match.
  const t = trim(slots, size);
  if (t) {
    for (const r of SHAPED) if (gridEq(t, r.grid)) return r.result;
  }

  // Shapeless — exact multiset of ingredient counts.
  const counts = {};
  let total = 0;
  for (const s of slots) if (s && s.id !== 0) { counts[s.id] = (counts[s.id] || 0) + 1; total++; }
  if (total === 0) return null;
  for (const r of SHAPELESS) {
    const keys = Object.keys(r.ingredients);
    if (keys.length !== Object.keys(counts).length) continue;
    let ok = true;
    for (const k of keys) if (counts[k] !== r.ingredients[k]) { ok = false; break; }
    if (ok) return r.result;
  }
  return null;
}
