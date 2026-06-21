# GunCraft

A voxel sandbox built from scratch with [Vite](https://vitejs.dev/) and
[three.js](https://threejs.org/) — procedural world, chunked per-face meshing
with per-vertex ambient occlusion, a runtime texture atlas, biomes, caves,
day/night, cinematic post-processing, **guns**, and **peer-to-peer co-op**. No
art or audio assets: every texture and sound is generated at runtime.

**Live:** https://iblamefrancisco.github.io/GunCraft/ (after the repo rename; the
old `/MinecraftClone/` URL redirects). Builds use relative asset paths so Pages
works regardless of the repository name.

## Highlights

- **Cinematic rendering:** ACES tone-mapping, bloom, vignette/grade, FXAA, drifting clouds, shader water.
- **Guns:** handgun + sniper (hitscan, sniper zooms), plasma gun (AoE bolts), portal gun (two portals, teleport). First-person viewmodels.
- **Co-op (P2P / WebRTC):** host a room, share the code; world seed + block edits + player avatars sync. No server needed.
- **Seeds:** enter a seed (or 🎲) and generate a fresh world; `?seed=` URL param.
- **Survival/Creative + difficulties** (Peaceful→Hardcore), tools, crafting (2×2 + crafting table), chests, mobs (pig/cow/sheep, zombie/skeleton/creeper), surface-aware footsteps, and a dynamic loading screen.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Click the screen to lock the mouse and play. `npm run build` produces a static
bundle in `dist/`.

## Controls

| Action               | Input                              |
| -------------------- | ---------------------------------- |
| Move                 | `W` `A` `S` `D` (relative to look) |
| Look                 | Mouse (pointer lock)               |
| Jump / swim up       | `Space`                            |
| Sprint               | `Shift` (hold) or double-tap `W`   |
| Sneak                | `Ctrl`                             |
| Fly (creative)       | double-tap `Space`                 |
| Break / attack       | Left click (hold to repeat)        |
| Place / eat / use    | Right click                        |
| Inventory + crafting | `E`                                |
| Creative ↔ Survival  | `G`                                |
| Difficulty cycle     | `B`                                |
| Select hotbar slot   | `1`–`9` or mouse wheel             |
| Release mouse        | `Esc`                              |

## Gameplay

- **Modes:** Survival (health + hunger, timed mining, drops, death/respawn) and
  Creative (fly, instant break, infinite block palette). Toggle with `G`.
- **Difficulty** (`B`): Peaceful · Easy · Normal · Hard · Hardcore (permanent death).
- **Mobs:** passive pig/cow/sheep and hostile zombie / skeleton (shoots arrows) /
  creeper (explodes). Mobs drop loot; leaves drop apples; all blocks drop on break.
- **Tools:** wood + stone pickaxe/axe/shovel/sword — faster mining of the matching
  block type (and some blocks need the right tool to drop); swords hit harder.
- **Crafting:** 2×2 grid in the inventory, 3×3 at a placed **crafting table**.
  Recipes include planks, sticks, table, chest, torches, and all eight tools.
- **Chests** store items per position; **torches** are placeable light blocks;
  **eat** food (right-click) to refill hunger.

## What's implemented

**Rendering / meshing**
- Chunked world (16 × 128 × 16), one merged `BufferGeometry` per chunk (a second
  for transparent water/glass).
- Face culling — only faces adjacent to air/transparent neighbours are emitted.
- **Per-vertex ambient occlusion** at every block corner, with the quad-split
  flipped to avoid AO interpolation artifacts.
- Cross-chunk borders sampled when meshing, so AO and culling are seamless. An
  edit remeshes the chunk **and** every neighbour touching the edited border.

**Procedural textures** (`textures.js`)
- All tiles drawn on a `<canvas>` with per-pixel noise: grass (top/side/bottom),
  dirt, stone, sand, log (rings + bark), leaves, water, snow, coal/iron ore,
  cobblestone, planks, glass, bedrock, gravel, glowstone, cactus.
- Packed into a 256×256 power-of-two atlas with a 1px extruded gutter to stop
  bleeding; sampled with `NearestFilter`, mipmaps off.
- Hotbar slots are real faux-3D block icons rendered from the same atlas tiles.

**World generation** (`worldgen.js`)
- Multi-octave 2D simplex terrain (continents + hills + mountains).
- 3D-simplex **caves**, depth-banded **ore veins**, gravel pockets.
- Two climate noise maps → **three biomes** (plains / desert / snow) driving the
  surface block and tree/cactus density.
- Trees (trunk + canopy, stamped across chunk borders), desert cacti, sea-level
  water with sandy **beaches**. Fully deterministic per world coordinate, so
  chunks tile with no ordering dependencies.

**Lighting & sky** (`sky.js`, `mesher.js`, `materials.js`)
- Heightmap **skylight** (sky-exposed cells bright, caves/overhangs dark),
  combined with AO and per-face directional shading, baked into vertex colours.
- Gradient sky **dome**, distance **fog** matched to the horizon colour.
- **Day/night cycle**: rotating sun + moon, smoothly lerped sky gradient, fog,
  and a global world light tint (day → dusk → night).
- Glowstone is self-illuminating (placeable light source).

**Player & feel** (`player.js`)
- First-person controller with pointer lock, AABB-vs-voxel collision (no
  clipping / fall-through), gravity, jump, sprint, sneak, light water buoyancy.
- Subtle head bob while walking and a FOV bump while sprinting; pitch clamped.

**Interaction** (`raycast.js`, `main.js`)
- DDA (Amanatides–Woo) voxel raycast, ~6 block reach.
- Break / place with a wireframe highlight on the targeted block; placement never
  intersects the player.
- Tinted particle burst on break; synthesized WebAudio break/place/step sounds.

**Performance**
- Streamed generation + meshing around the player on a per-frame time budget
  (only dirty chunks remesh); chunks unload as you move away. View distance of
  7 chunks with fog hiding the edge.

## Source layout

```
src/
  main.js       loop, input, interaction, highlight
  world.js      chunk store, streaming, edits, neighbour remesh
  chunk.js      voxel storage + per-column sky heightmap
  mesher.js     face-culled meshing + per-vertex AO
  worldgen.js   terrain, biomes, caves, ores, trees
  noise.js      seeded 2D/3D simplex + fBm
  blocks.js     block registry / properties
  textures.js   procedural atlas + block icons
  materials.js  shared materials, water wave, day/night tint
  player.js     first-person controller + collision
  raycast.js    DDA voxel raycast
  sky.js        sky dome, fog, sun/moon, day/night
  particles.js  break-particle pool
  audio.js      synthesized SFX
  ui.js         hotbar, selection, clock
  constants.js  shared tuning
```

## Dev verification

`verify.mjs` is a Playwright smoke test that loads the running dev server,
asserts zero console errors, reports draw calls / chunk counts, and saves a
screenshot:

```bash
npm run dev &           # in one shell
node verify.mjs http://localhost:5173/ shot.png
```

## Skipped / partial stretch goals
- Full BFS block-light **propagation** for emissive blocks is not implemented;
  glowstone instead self-illuminates its own faces (placeable, glows). The
  skylight model is heightmap-based rather than a full flood fill.
