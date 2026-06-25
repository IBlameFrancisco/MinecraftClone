# GunGame

A modern, **stylized 3D arena FPS** built from scratch with [three.js](https://threejs.org) —
a graphics-forward reimagining of the voxel shooter, leaning toward a clean Fortnite-style
look rather than blocks.

> This is a standalone project (its own `package.json` / Vite build). It currently lives in
> a `gungame/` folder but shares no code with the voxel game and is ready to split into its
> own repository.

## What's in the vertical slice

- **Modern rendering** — PBR materials, ACES-filmic tonemapping, real-time soft shadows
  (PCF), a neutral PMREM environment for reflections, a gradient sky + fog, and a
  post-processing chain (bloom, SMAA; optional SSAO).
- **FPS controller** — pointer-lock mouse-look, accelerated WASD with sprint/crouch/jump,
  gravity, and swept-AABB collision against the map with auto step-up (ramps/steps).
- **Weapons** — animated first-person viewmodels (rifle + pistol), hitscan firing with
  spread, recoil, muzzle flash, tracers, impact sparks, ammo + reload, ADS, weapon swap.
- **Enemies** — stylized soldier bots that roam, take line-of-sight shots, react to being
  hit, die and respawn; headshots count.
- **A designed arena** — a ~140×140 urban/industrial map of shipping containers, crates,
  ramps, a central raised platform, a catwalk and cover, with proper collision.
- **HUD** — crosshair, hitmarkers, health bar, ammo, killfeed, score, damage feedback.

## Run it

```bash
cd gungame
npm install
npm run dev      # http://localhost:5173
# or: npm run build && npm run preview
```

Click **PLAY** to lock the mouse. **WASD** move · **Shift** sprint · **Ctrl** crouch ·
**Space** jump · **Mouse** aim · **LMB** fire · **RMB** ADS · **R** reload · **1/2** switch.

## Roadmap (next phases)

The slice nails the look + core loop. Planned ports from the original: more weapons, the
full set of game modes, multiple maps, and online multiplayer.

## Structure

```
src/
  engine/   renderer + post-fx, sky/lighting, input, audio, materials
  world/    arena geometry + collision
  player/   movement controller, weapons
  ai/       enemy bots
  models/   stylized character + gun builders
  fx/       tracers, muzzle flashes, impacts
  ui/       HUD
  main.js   wiring + game loop
```
