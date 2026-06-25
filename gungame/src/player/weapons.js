// The player's weapons. Builds first-person viewmodels lazily, dispatches firing by weapon
// `kind` (hitscan / shotgun / rail-pierce / projectile / beam), tracks ammo + reload, recoil
// and procedural sway/bob/kick. Supports a hero loadout (primary + pistol sidearm) and a
// Gun-Game single-weapon mode. Hits route to onHit; projectiles go through the Projectiles
// system; the laser applies continuous beam damage each frame.
import * as THREE from 'three';
import { makeViewModel, WEAPONS } from '../models/guns.js';

export class Weapons {
  constructor(camera, scene, fx, projectiles) {
    this.camera = camera; this.scene = scene; this.fx = fx; this.projectiles = projectiles;
    this.ray = new THREE.Raycaster(); this.ray.far = 320;
    this.holder = new THREE.Group(); camera.add(this.holder);
    this.models = {}; this.state = {};
    this.order = ['rifle', 'pistol']; this.cur = 'rifle'; this.gunGame = false;
    this.fireCD = 0; this.reloadT = 0; this.triggerHeld = false; this.beaming = false;
    this.recoilPitch = 0; this.recoilYaw = 0; this.kick = 0; this.bob = 0; this.sway = new THREE.Vector2();
    this.targets = []; this.ownerTeam = 'blue';
    this.onHit = null;      // (bot, dmg, headshot, point) => {}
    this.onAmmo = null;     // (name, mag, reserve) => {}
    this.onShoot = null;    // (kind) => {}
    this.onReload = null;   // () => {}
    this._ensure('rifle'); this._ensure('pistol'); this._select('rifle');
  }

  _ensure(id) {
    if (this.models[id]) return;
    const w = WEAPONS[id]; this.state[id] = { mag: w.mag, reserve: w.reserve || 0 };
    const vm = makeViewModel(id); vm.visible = false; vm.position.set(0.16, -0.17, -0.42);
    this.holder.add(vm); this.models[id] = vm;
  }
  _refill(ids) { for (const id of ids) { const w = WEAPONS[id]; this.state[id] = { mag: w.mag, reserve: w.reserve || 0 }; } }

  // hero loadout: chosen primary + pistol sidearm
  setLoadout(primaryId) {
    this.gunGame = false; this.order = primaryId === 'pistol' ? ['pistol'] : [primaryId, 'pistol'];
    for (const id of this.order) this._ensure(id);
    this._refill(this.order); this._select(this.order[0]);
  }
  // Gun Game: a single weapon dictated by the ladder rung
  setGunGame(id) { this.gunGame = true; this.order = [id]; this._ensure(id); this._refill([id]); this._select(id); }
  reset() { this._refill(this.order); this._select(this.order[0]); }

  _select(id) {
    this.cur = id; this.reloadT = 0; this.beaming = false;
    for (const k in this.models) this.models[k].visible = (k === id);
    const w = WEAPONS[id], s = this.state[id];
    this.onAmmo && this.onAmmo(w.name, w.kind === 'beam' ? Math.round(s.mag) : s.mag, w.kind === 'beam' ? null : s.reserve);
  }
  switch(id) { if (this.order.includes(id) && id !== this.cur) this._select(id); }
  cycle(d) { const i = (this.order.indexOf(this.cur) + d + this.order.length) % this.order.length; this._select(this.order[i]); }

  setTargets(meshes) { this.targets = meshes; }

  reload() {
    const s = this.state[this.cur], w = WEAPONS[this.cur];
    if (this.reloadT > 0 || s.mag >= w.mag || (w.kind !== 'beam' && s.reserve <= 0)) return;
    this.reloadT = w.reloadTime; this.onReload && this.onReload();
  }

  update(dt, input, controller) {
    const w = WEAPONS[this.cur], s = this.state[this.cur];
    this.fireCD -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (w.kind === 'beam') { s.mag = w.mag; }
        else { const need = w.mag - s.mag, take = Math.min(need, s.reserve); s.mag += take; s.reserve -= take; }
        this.onAmmo && this.onAmmo(w.name, w.kind === 'beam' ? Math.round(s.mag) : s.mag, w.kind === 'beam' ? null : s.reserve);
      }
    }

    // weapon switch (loadout only)
    if (!this.gunGame) {
      const wl = input.wheel(); if (wl) this.cycle(wl > 0 ? 1 : -1);
      if (input.down('Digit1') && this.order[0]) this.switch(this.order[0]);
      if (input.down('Digit2') && this.order[1]) this.switch(this.order[1]);
    }
    if (input.down('KeyR')) this.reload();

    // --- firing ---
    if (w.kind === 'beam') this._beam(dt, w, s, input, controller);
    else {
      this.beaming = false;
      const wantFire = input.mouseDown && (w.auto || !this.triggerHeld);
      if (wantFire && this.fireCD <= 0 && this.reloadT <= 0 && controller.alive) {
        if (s.mag > 0) { this._fire(w, controller); s.mag--; this.fireCD = 60 / (w.rpm || 120); this.onAmmo && this.onAmmo(w.name, s.mag, s.reserve); if (s.mag === 0) this.reload(); }
        else { this.fireCD = 0.2; this.reload(); }
      }
    }
    this.triggerHeld = input.mouseDown;

    // recoil recovery + viewmodel motion
    this.recoilPitch += (0 - this.recoilPitch) * Math.min(1, 9 * dt);
    this.recoilYaw += (0 - this.recoilYaw) * Math.min(1, 9 * dt);
    this.kick += (0 - this.kick) * Math.min(1, 12 * dt);
    const moving = Math.hypot(controller.vel.x, controller.vel.z);
    this.bob += dt * (6 + moving * 0.8);
    this.sway.x += (THREE.MathUtils.clamp(-input.dx * 0.02, -0.05, 0.05) - this.sway.x) * Math.min(1, 8 * dt);
    this.sway.y += (THREE.MathUtils.clamp(-input.dy * 0.02, -0.05, 0.05) - this.sway.y) * Math.min(1, 8 * dt);
    const vm = this.models[this.cur];
    if (vm) {
      const bobx = Math.cos(this.bob) * 0.006 * Math.min(1, moving / 5);
      const boby = Math.abs(Math.sin(this.bob)) * 0.008 * Math.min(1, moving / 5);
      vm.position.set(0.16 + this.sway.x + bobx, -0.17 + this.sway.y + boby, -0.42 + this.kick * 0.12);
      vm.rotation.set(this.sway.y * 0.5 + this.kick * 0.5, this.sway.x * 0.5, 0);
    }
  }

  testFire(controller) { this._fire(WEAPONS[this.cur], controller); }

  _muzzle(dir, origin) {
    const vm = this.models[this.cur];
    return vm && vm.userData.muzzleLocal ? vm.localToWorld(vm.userData.muzzleLocal.clone()) : origin.clone().addScaledVector(dir, 0.4);
  }
  _recoilFor(w) {
    if (w.kind === 'projectile' || w.kind === 'rail') return 0.03;
    if (w.kind === 'shotgun') return 0.045;
    return THREE.MathUtils.clamp(w.damage * 0.0006 + 0.006, 0.006, 0.03);
  }

  _fire(w, controller) {
    const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin);
    const baseDir = new THREE.Vector3(); this.camera.getWorldDirection(baseDir);
    const movePenalty = Math.min(1.6, 1 + Math.hypot(controller.vel.x, controller.vel.z) * 0.08);
    const muzzle = this._muzzle(baseDir, origin);

    if (w.kind === 'projectile') {
      const dir = this._spread(baseDir, w.spread || 0.004, movePenalty);
      this.projectiles.spawn(muzzle, dir, w, this.ownerTeam);
      this.fx.muzzle(muzzle, dir, w.color || 0xffd27a);
    } else if (w.kind === 'shotgun') {
      for (let i = 0; i < (w.pellets || 8); i++) { const dir = this._spread(baseDir, w.spread, movePenalty); this._hitscan(origin, dir, w, false); }
      this.fx.muzzle(muzzle, baseDir, 0xffd27a);
    } else if (w.kind === 'rail') {
      const dir = this._spread(baseDir, w.spread, movePenalty);
      this._hitscan(origin, dir, w, true);
      this.fx.beam(muzzle, origin.clone().addScaledVector(dir, w.range), w.color || 0x9a3cff, 0.05);
      this.fx.muzzle(muzzle, dir, w.color || 0x9a3cff);
    } else {
      const dir = this._spread(baseDir, w.spread, movePenalty);
      this._hitscan(origin, dir, w, false);
      this.fx.muzzle(muzzle, dir);
    }
    this.recoilPitch += this._recoilFor(w); this.recoilYaw += (Math.random() - 0.5) * 0.008; this.kick = 1;
    this.onShoot && this.onShoot(this.cur);
  }

  _spread(dir, sp, mul = 1) {
    const d = dir.clone(); const s = (sp || 0) * mul;
    if (s > 0) { d.x += (Math.random() - 0.5) * s; d.y += (Math.random() - 0.5) * s; d.z += (Math.random() - 0.5) * s; }
    return d.normalize();
  }

  // single or piercing hitscan. Returns the endpoint.
  _hitscan(origin, dir, w, pierce) {
    this.ray.set(origin, dir); this.ray.far = w.range;
    const hits = this.ray.intersectObjects(this.targets, true);
    let end = origin.clone().addScaledVector(dir, w.range);
    if (hits.length) {
      let hitWall = false;
      for (const h of hits) {
        let o = h.object, bot = null;
        while (o) { if (o.userData && o.userData.bot !== undefined) { bot = o.userData.bot; break; } o = o.parent; }
        if (bot) {
          const head = h.point.y > bot.headY();
          const dmg = head ? Math.round(w.damage * 1.8) : w.damage;
          this.fx.blood(h.point); this.onHit && this.onHit(bot, dmg, head, h.point);
          if (!pierce) { end = h.point.clone(); break; }
        } else {
          end = h.point.clone(); this.fx.impact(h.point, h.face ? h.face.normal : null); hitWall = true; break;
        }
      }
      if (pierce && !hitWall) end = origin.clone().addScaledVector(dir, w.range);
    }
    if (w.kind !== 'rail') this.fx.tracer(this._muzzle(dir, origin), end, w.color || 0xffe08a);
    return end;
  }

  // continuous beam (laser): drains energy, applies dps each frame, redraws the beam
  _beam(dt, w, s, input, controller) {
    const firing = input.mouseDown && this.reloadT <= 0 && controller.alive && s.mag > 0;
    this.beaming = firing;
    if (!firing) { if (s.mag <= 0) this.reload(); return; }
    s.mag = Math.max(0, s.mag - w.drain * dt);
    const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    this.ray.set(origin, dir); this.ray.far = w.range;
    const hits = this.ray.intersectObjects(this.targets, true);
    let end = origin.clone().addScaledVector(dir, w.range);
    if (hits.length) {
      const h = hits[0]; end = h.point.clone();
      let o = h.object, bot = null; while (o) { if (o.userData && o.userData.bot !== undefined) { bot = o.userData.bot; break; } o = o.parent; }
      if (bot) { const head = h.point.y > bot.headY(); this.onHit && this.onHit(bot, w.dps * dt, head, h.point); if (Math.random() < 0.3) this.fx.blood(h.point); }
      else if (Math.random() < 0.4) this.fx.impact(h.point, h.face ? h.face.normal : null, w.color);
    }
    const muzzle = this._muzzle(dir, origin);
    this.fx.beam(muzzle, end, w.color || 0xff2e54, 0.06);
    this.kick = 0.3;
    if ((this._beamSnd = (this._beamSnd || 0) + dt) > 0.08) { this._beamSnd = 0; this.onShoot && this.onShoot('laser'); }
    this.onAmmo && this.onAmmo(w.name, Math.round(s.mag), null);
    if (s.mag <= 0) this.reload();
  }
}
