# GunGame — Roadmap & Design

> A power-fantasy hero-shooter: grounded golden-hour arena + realistic gunplay as the base,
> over-the-top anime/sci-fi **ults** as the spectacle, **hero loadouts**, multiple modes,
> **multiplayer**, and a **destructible-structure** world you can blow apart.

## Pillars
- **Grounded base, absurd powers** — the contrast *is* the identity (milsim realism meets ZA WARUDO).
- **Loud, destructive, readable** fights.
- **Multiplayer-correct from the foundation**, not bolted on later.

## The two-codebase strategy (the key insight)
- **`gungame/`** (new, three.js) — polished render pipeline (golden-hour HDRI, ACES, bloom, SSAO,
  PBR, rigged arms, GLB props), FPS controller, TDM-vs-bots slice. *No destruction, no MP, 2 guns.*
- **`src/`** (original GunCraft) — a **working voxel world + sphere-carve destruction + multiplayer**
  (`net.js`, synced edits) + the **full arsenal** (11 guns + ~9 anime/sci-fi ults). Carries Minecraft
  cruft (crafting/hunger/worldgen) to be stripped.
- **Strategy: marry them.** Reuse GunCraft's destruction/MP/arsenal engine; layer GunGame's render
  pipeline + hero-shooter design on top. Reuse the hard tech — don't re-derive it. The render
  *pipeline* (lighting/post/materials/arms/props) ports onto voxels; only geometry representation changes.

## Architecture spine
- Authoritative, render-free **`sim/`** module: entities driven by plain input objects;
  `step(dt, inputs)` owns movement / firing / damage / scoring / mode-rules / carve-events.
  Local player, bots, and remote players all feed it inputs the same way.
- Runs **locally** (single-player/bots) and **server-side** (Colyseus) — identical code.
- **Collider source abstracted:** static arena + destructible-volume voxel occupancy.

## Destruction model — Hybrid (Battlefield/Siege)
- **Static photoreal base:** ground, boundaries, hero set-pieces — non-destructible. Keeps the look
  and a stable, ungriefable playspace.
- **Destructible structures:** Teardown-style **voxel volumes** (reuse GunCraft `chunk`/`mesher`/carve),
  PBR-textured + lit to blend with the realism. Carve via sphere / beam / slash shapes → re-mesh the
  volume → update its collider. Cosmetic physics debris + craters/scorch decals on top.
- **Multiplayer:** server owns each volume's voxel state; carve events validated + broadcast compactly
  (GunCraft's proven edit-sync pattern); per-volume diffs to late joiners; debris is client-cosmetic.

## Arsenal → hero loadout
- **Primaries (equip 1):** Handgun · SMG · Assault Rifle · Shotgun · Sniper · MG42 · Rocket Launcher ·
  Railgun · Plasma Gun · Laser Cannon · Homing Missile.
- **Abilities (slot 1–2, cooldown ults):** Rasengan · Rasenshuriken · Fūga · Cleave & Dismantle ·
  Hollow Purple · Black Hole Bomb · Portal Gun · Sharingan · **Stand ult** (Star Platinum / The World:
  barrage + time stop).
- **Gun Game** mode = primaries-only ladder (abilities off) for pure gun skill.

## Milestones
| # | Milestone | Delivers | Risk |
|---|---|---|---|
| **M1** | It's a real game | Match flow (warmup→live→end→rematch), **TDM + FFA**, smarter bots + difficulty (Easy/Normal/Hard), **audio/music pass**. Arena authored as static base + (inert) destructible volumes; sim/collider abstraction in place. | Low |
| **M2** | Destruction + primaries + Gun Game | Adapt GunCraft voxel engine into destructible structures + carve API; port the 11 guns; loadout screen; Gun-Game ladder. Explosives now carve. | Med |
| **M3** | Multiplayer (Colyseus) | Authoritative server, input/snapshots, prediction + reconciliation, lag-comp hits, **synced destruction**, bot backfill. (Evaluate reusing GunCraft net learnings.) Needs a Node host. | **High** |
| **M4** | Ability tier 1 (carving ults) | Hollow Purple (corridor carve), Rasengan, Rasenshuriken, Cleave (slash-carve), Fūga. The destruction showcase. | Med |
| **M5** | Ability tier 2 (reality-benders) | Black Hole (carve + pull), Portal, Sharingan, Stand/time-stop — **with MP adaptations**. | High |
| **M6** | Showcase polish | Killcam, scoreboard (TAB), minimap, settings, spectator. | Low |

## Known hard problems / adaptations
- **Time stop in MP** → short (~2.5s) range-limited *enemy freeze* + telegraph + long cooldown; full
  version stays single-player.
- **Sharingan precog** → enemy-highlight + self-haste (no true time dilation) so it nets cleanly.
- **Hybrid destruction** = two world systems (static + voxel volumes); collider reconciliation is the
  fiddly part.
- **IP names** (Hollow Purple / Stands / Rasengan) — fine for a personal/portfolio build; trivially
  reskinnable if ever published.
- **Hosting:** M3 needs a small Node host (Fly/Render free tier) — no longer a pure static site.

## Out of scope (for now)
Accounts / persistence / ranked MMR, voice chat, mobile/touch, cross-region matchmaking.

## First build batch (when greenlit)
M1: match flow + TDM/FFA + smarter bots/difficulty + audio/music — all on the authoritative `sim/`.
