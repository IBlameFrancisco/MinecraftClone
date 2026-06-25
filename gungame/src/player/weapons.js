// The player's weapons: viewmodel (parented to the camera), hitscan firing with spread,
// ammo + reload, recoil, and procedural sway/bob/kick. Raycasts against the arena meshes
// + bot hitboxes handed in each frame; reports bot hits to the game via onHit.
import * as THREE from 'three';
import { makeViewModel, WEAPONS } from '../models/guns.js';

const ORDER = ['rifle', 'pistol'];

export class Weapons {
  constructor(camera, scene, fx) {
    this.camera = camera; this.fx = fx;
    this.ray = new THREE.Raycaster(); this.ray.far = 250;
    this.holder = new THREE.Group(); camera.add(this.holder);
    this.models = {};
    this.state = {};
    for (const id of ORDER) {
      const w = WEAPONS[id];
      this.state[id] = { mag: w.mag, reserve: w.reserve };
      const vm = makeViewModel(id); vm.visible = false;
      vm.position.set(0.16, -0.17, -0.42);
      this.holder.add(vm); this.models[id] = vm;
    }
    this.cur = 'rifle';
    this.fireCD = 0; this.reloadT = 0; this.triggerHeld = false;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.kick = 0; this.bob = 0; this.sway = new THREE.Vector2();
    this.targets = []; this.bots = [];
    this.onHit = null;       // (bot, dmg, headshot, point) => {}
    this.onAmmo = null;      // (name, mag, reserve) => {}
    this.onShoot = null;     // () => {} (for sound)
    this._select(this.cur);
  }
  _select(id) {
    this.cur = id;
    for (const k of ORDER) this.models[k].visible = (k === id);
    this.reloadT = 0;
    const s = this.state[id], w = WEAPONS[id];
    this.onAmmo && this.onAmmo(w.name, s.mag, s.reserve);
  }
  switch(id) { if (this.models[id] && id !== this.cur) this._select(id); }
  cycle(d) { const i = (ORDER.indexOf(this.cur) + d + ORDER.length) % ORDER.length; this._select(ORDER[i]); }

  setTargets(meshes, bots) { this.targets = meshes; this.bots = bots; }

  reload() {
    const s = this.state[this.cur], w = WEAPONS[this.cur];
    if (this.reloadT > 0 || s.mag >= w.mag || s.reserve <= 0) return;
    this.reloadT = w.reloadTime;
  }

  update(dt, input, controller) {
    const w = WEAPONS[this.cur], s = this.state[this.cur];
    this.fireCD -= dt;
    // reload finish
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const need = w.mag - s.mag, take = Math.min(need, s.reserve); s.mag += take; s.reserve -= take; this.onAmmo && this.onAmmo(w.name, s.mag, s.reserve); } }

    // weapon switch
    const wl = input.wheel(); if (wl) this.cycle(wl > 0 ? 1 : -1);
    if (input.down('Digit1')) this.switch('rifle');
    if (input.down('Digit2')) this.switch('pistol');
    if (input.down('KeyR')) this.reload();

    // fire
    const wantFire = input.mouseDown && (w.auto || !this.triggerHeld);
    if (wantFire && this.fireCD <= 0 && this.reloadT <= 0 && controller.alive) {
      if (s.mag > 0) { this._fire(w, controller); s.mag--; this.fireCD = 60 / w.rpm; this.onAmmo && this.onAmmo(w.name, s.mag, s.reserve); if (s.mag === 0) this.reload(); }
      else { this.fireCD = 0.2; this.reload(); }
    }
    this.triggerHeld = input.mouseDown;

    // recoil recovery
    this.recoilPitch += (0 - this.recoilPitch) * Math.min(1, 9 * dt);
    this.recoilYaw += (0 - this.recoilYaw) * Math.min(1, 9 * dt);
    this.kick += (0 - this.kick) * Math.min(1, 12 * dt);

    // viewmodel sway/bob
    const moving = Math.hypot(controller.vel.x, controller.vel.z);
    this.bob += dt * (6 + moving * 0.8);
    const lk = { dx: input.dx, dy: input.dy };   // residual look (already consumed by controller, small)
    this.sway.x += (THREE.MathUtils.clamp(-lk.dx * 0.02, -0.05, 0.05) - this.sway.x) * Math.min(1, 8 * dt);
    this.sway.y += (THREE.MathUtils.clamp(-lk.dy * 0.02, -0.05, 0.05) - this.sway.y) * Math.min(1, 8 * dt);
    const vm = this.models[this.cur];
    const bobx = Math.cos(this.bob) * 0.006 * Math.min(1, moving / 5);
    const boby = Math.abs(Math.sin(this.bob)) * 0.008 * Math.min(1, moving / 5);
    vm.position.set(0.16 + this.sway.x + bobx, -0.17 + this.sway.y + boby, -0.42 + this.kick * 0.12);
    vm.rotation.set(this.sway.y * 0.5 + this.kick * 0.5, this.sway.x * 0.5, 0);
  }

  testFire(controller) { this._fire(WEAPONS[this.cur], controller); }   // test hook
  _fire(w, controller) {
    const cam = this.camera;
    const origin = new THREE.Vector3(); cam.getWorldPosition(origin);
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    // spread (wider while moving / hipfire)
    const movePenalty = Math.min(1.6, 1 + Math.hypot(controller.vel.x, controller.vel.z) * 0.08);
    const sp = w.spread * movePenalty;
    dir.x += (Math.random() - 0.5) * sp; dir.y += (Math.random() - 0.5) * sp; dir.z += (Math.random() - 0.5) * sp;
    dir.normalize();

    this.ray.set(origin, dir); this.ray.far = w.range;
    const hits = this.ray.intersectObjects(this.targets, true);
    let end = origin.clone().addScaledVector(dir, w.range);
    if (hits.length) {
      const h = hits[0]; end = h.point.clone();
      let o = h.object; while (o && o.userData.bot === undefined && o.parent) o = o.parent;
      const bot = o && o.userData.bot;
      if (bot) {
        const head = h.point.y > bot.headY();
        const dmg = head ? Math.round(w.damage * 1.8) : w.damage;
        this.fx.blood(h.point);
        this.onHit && this.onHit(bot, dmg, head, h.point);
      } else {
        this.fx.impact(h.point, h.face ? h.face.normal : null);
      }
    }
    // muzzle flash + tracer from the gun barrel
    const vm = this.models[this.cur];
    const muzzle = vm.userData.muzzleLocal ? vm.localToWorld(vm.userData.muzzleLocal.clone()) : origin.clone().addScaledVector(dir, 0.4);
    this.fx.muzzle(muzzle, dir);
    this.fx.tracer(muzzle, end, 0xffe08a);
    // recoil
    this.recoilPitch += (this.cur === 'rifle' ? 0.012 : 0.02);
    this.recoilYaw += (Math.random() - 0.5) * 0.008;
    this.kick = 1;
    this.onShoot && this.onShoot(this.cur);
  }
}
