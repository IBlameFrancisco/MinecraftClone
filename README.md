# GunCraft

A voxel sandbox built from scratch with [Vite](https://vitejs.dev/) and
[three.js](https://threejs.org/) — procedural world, chunked per-face meshing
with per-vertex ambient occlusion, a runtime texture atlas, biomes, caves,
day/night, cinematic post-processing, **guns**, and **peer-to-peer co-op**. No
art or audio assets: every texture and sound is generated at runtime.

**Live:** https://iblamefrancisco.github.io/MinecraftClone/ — the Pages URL follows
the repository name. (Rename the repo to `GunCraft` and it moves to
`/GunCraft/`; builds use relative asset paths so Pages works at either path.)

## Highlights

- **Cinematic rendering:** ACES tone-mapping, bloom, vignette/grade, FXAA, drifting clouds, shader water.
- **A dozen+ weapons:** handgun, SMG, assault rifle, shotgun, sniper (real scope), railgun (piercing), plasma gun, rocket launcher (AoE), belt-fed MG42, a **laser cannon** (a sustained searing beam with a heat battery), **black hole bomb** (an animated singularity that drags enemies into its core then implodes), **Hollow Purple** (Gojo's clap of limitless red + blue, erasing a wide corridor with an imaginary-mass purple beam), the **Sharingan** (an all-in-one dōjutsu — left-click gazes to set foes ablaze in spreading **Amaterasu** black flames and, held, locks them in **Genjutsu**; right-click triggers **Precognition** bullet-time where enemies slow, glow through walls, and your damage taken drops), and two chakra jutsu — the **Rasengan** (a spinning orb ground into a foe for a huge point-blank hit + knockback) and the **Rasenshuriken** (a thrown chakra shuriken that detonates into a vast dome of wind blades) — plus the portal gun. **Charge your chakra** (hold `C`) — a rising blue aura that fills a chakra gauge, powers the jutsu, and bursts into an enemy-repelling shockwave when it peaks. Bloom-lit tracers, per-gun recoil, headshots + floating damage numbers, full/semi-auto fire, ammo/reload.
- **Battle mode (PvP + bots):** six sub-modes — Deathmatch, Gun Game, King of the Hill, Battle Royale, Wave Survival, and **War (D-Day)**. **Free-for-all or Teams**, with **AI bots** (Easy→Insane) filling empty slots so you can play solo or 2v2. Hold-**Tab** scoreboard, score-limit rounds, kill feed, radar, and health/ammo pickups. Bots are host-authoritative so co-op stays in sync. **Gun Game** runs a 12-rung weapon ladder that climbs every weapon and finishes on the point-blank **Rasengan** — and the match-winning frag triggers a cinematic **final-kill cam**.
- **Randomised arenas:** the battle map is randomised each match into one of four cinematic worlds, each with its own palette, lighting, sky **and a distinct structure tuned for a different weapon style** — a balanced golden-hour **Ruins** (rifles), a dense close-quarters **Jungle** maze (shotgun/SMG/jutsu), a wide-open frozen **Tundra** with sniper perches (sniper/railgun/laser), or a scorched **Desert** of low cover + platforms (rockets/black hole/AoE). A different place — and a different game — every time.
- **War — D-Day:** an asymmetric beach assault on a dedicated map — sea + landing craft, an open obstacle-strewn beach, a seawall, and a fortified bluff of bunkers, MG nests and a trench guarding a command bunker. Pick a side: **storm (Allied)** from the surf or **hold (Axis)** the line. Faction-accurate uniforms, a belt-fed **MG42**, defender AI that mans the nests, attacker AI that charges the objective, reinforcement tickets + a capture objective + a countdown, all under a bleak overcast sky.
- **Co-op (P2P / WebRTC):** host a room, share the code; world seed + block edits + player avatars sync — and players can damage each other. No server needed.
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
| Break / attack       | Left click (hold to repeat) or `Q` |
| Place / eat / use    | Right click or `F`                 |
| Inventory + crafting | `E`                                |
| Creative ↔ Survival  | `G`                                |
| Difficulty cycle     | `B`                                |
| Select hotbar slot   | `1`–`9` or mouse wheel             |
| Charge chakra        | `C` (hold) — powers the jutsu      |
| Pause menu           | `Esc`                              |

## Gameplay

- **Modes:** Survival (health + hunger, timed mining, drops, death/respawn),
  Creative (fly, instant break, infinite block palette), and **Battle** — pick
  one on the start menu. Toggle Survival↔Creative in-world with `G`.
- **Battle arena:** choose ⚔ Battle on the menu to load the PvP arena. You spawn
  with all four guns; damage other players (co-op), respawn at a spawn point on
  death, and the kill feed tracks frags. Right-click the sniper to scope in.
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

## Skipped / partial stretch goals
- Full BFS block-light **propagation** for emissive blocks is not implemented;
  glowstone instead self-illuminates its own faces (placeable, glows). The
  skylight model is heightmap-based rather than a full flood fill.
