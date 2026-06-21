// Minimal crafting: shapeless recipes matched by exact ingredient counts, so the
// same recipes work in the 2x2 inventory grid and the 3x3 crafting table.

import { LOG, PLANK, CRAFTING_TABLE } from './blocks.js';
import { STICK } from './items.js';

// Each recipe: ingredients = { id: count }, result = { id, count }.
const RECIPES = [
  { ingredients: { [LOG]: 1 }, result: { id: PLANK, count: 4 } },
  { ingredients: { [PLANK]: 2 }, result: { id: STICK, count: 4 } },
  { ingredients: { [PLANK]: 4 }, result: { id: CRAFTING_TABLE, count: 1 } },
];

// Count non-empty ingredients in the grid and find a matching recipe.
export function matchRecipe(slots) {
  const counts = {};
  let total = 0;
  for (const s of slots) {
    if (s && s.id !== 0) { counts[s.id] = (counts[s.id] || 0) + 1; total++; }
  }
  if (total === 0) return null;
  for (const r of RECIPES) {
    const keys = Object.keys(r.ingredients);
    if (keys.length !== Object.keys(counts).length) continue;
    let ok = true;
    for (const k of keys) { if (counts[k] !== r.ingredients[k]) { ok = false; break; } }
    if (ok) return r.result;
  }
  return null;
}
