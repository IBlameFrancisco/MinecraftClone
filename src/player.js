// First-person controller: pointer-lock mouse look, WASD movement relative to
// view, jump/sprint/sneak, AABB-vs-voxel collision, head bob and sprint FOV.

import * as THREE from 'three';
import { isSolid, isSlippery, WATER } from './blocks.js';

const HALF = 0.3;          // player half-width
const HEIGHT = 1.8;        // player height
const EYE = 1.62;          // eye height above feet
const GRAVITY = 30;
const JUMP_SPEED = 9.0;
const WALK = 4.5;
const SPRINT = 6.7;
const SNEAK = 1.8;
const ACCEL = 14;          // ground acceleration
const AIR_ACCEL = 4;
const BASE_FOV = 75;
const SPRINT_FOV = 84;

export class Player {
  constructor(camera, domElement, world) {
    this.camera = camera;
    this.dom = domElement;
    this.world = world;

    this.pos = new THREE.Vector3(0, 80, 0); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;

    this.keys = new Set();
    this.bobTime = 0;
    this.bobAmount = 0;
    this.baseFov = BASE_FOV;
    this.sens = 0.0022;
    this.fov = BASE_FOV;

    // Camera-feel smoothing state (visual only; never feeds back into physics).
    this._eyeOff = 0;        // smoothed sneak crouch offset
    this._roll = 0;          // smoothed camera roll
    this._landDip = 0;       // transient downward dip on landing
    this._strafe = 0;        // smoothed strafe input for lean

    this.mode = 1;            // 0 survival, 1 creative (set by main)
    this.flying = false;
    this.sprintToggle = false;
    this._lastSpace = -1;
    this._lastW = -1;
    this.fallImpact = 0;     // consumed by main for fall damage

    camera.rotation.order = 'YXZ';
    this._bindInput();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 0) this.flying = false;
  }

  setFov(v) { this.baseFov = v; this.camera.fov = v; this.fov = v; this.camera.updateProjectionMatrix(); }
  setSensitivity(mult) { this.sens = 0.0022 * mult; }

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; // typing in chat/menu
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) {
        const now = performance.now();
        if (e.code === 'Space') {
          if (this.mode === 1 && now - this._lastSpace < 300) {
            this.flying = !this.flying;
            this.vel.y = 0;
          }
          this._lastSpace = now;
        } else if (e.code === 'KeyW') {
          if (now - this._lastW < 300) this.sprintToggle = true;
          this._lastW = now;
        }
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      const ae = document.activeElement;   // don't swing the view while typing in chat
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      const s = this.sens;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      const lim = Math.PI / 2 - 0.001;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
    // Release focus state when pointer lock drops.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.dom) this.keys.clear();
    });
  }

  get locked() { return document.pointerLockElement === this.dom; }

  forwardVector(out) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  update(dt) {
    dt = Math.min(dt, 0.05); // clamp to avoid tunnelling on lag spikes
    const world = this.world;

    // --- Determine wish direction (view-relative) ---
    const f = this.keys.has('KeyW') ? 1 : 0;
    const b = this.keys.has('KeyS') ? 1 : 0;
    const l = this.keys.has('KeyA') ? 1 : 0;
    const r = this.keys.has('KeyD') ? 1 : 0;
    const sneaking = (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) && !this.flying;
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (!f) this.sprintToggle = false;
    let sprinting = (shift || this.sprintToggle) && f && !sneaking;

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward = (-sinY, -cosY), right = (cosY, -sinY)
    let wx = (-sinY) * (f - b) + cosY * (r - l);
    let wz = (-cosY) * (f - b) + (-sinY) * (r - l);
    const wlen = Math.hypot(wx, wz);
    if (wlen > 0) { wx /= wlen; wz /= wlen; }

    // Strafe signal (right-minus-left) for a subtle camera lean; eased so it
    // also relaxes back to centre when input stops or during flight.
    this._strafe += ((r - l) - this._strafe) * Math.min(1, 9 * dt);

    if (this.flying) {
      // --- Creative flight ---
      let speed = sprinting ? 11 : 6;
      const accel = 12;
      this.vel.x += (wx * speed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wz * speed - this.vel.z) * Math.min(1, accel * dt);
      let vy = 0;
      if (this.keys.has('Space')) vy += 1;
      if (shift || this.keys.has('ControlLeft') || this.keys.has('ControlRight')) vy -= 1;
      this.vel.y += (vy * speed - this.vel.y) * Math.min(1, accel * dt);

      this.onGround = false;
      this._moveAxis('x', this.vel.x * dt);
      this._moveAxis('z', this.vel.z * dt);
      this._moveAxis('y', this.vel.y * dt);
      this._updateCamera(dt, false, sprinting, speed);
      return;
    }

    let speed = sprinting ? SPRINT : sneaking ? SNEAK : WALK;
    if (this.inWater) speed *= 0.6;

    // --- Horizontal velocity with acceleration/friction ---
    // Decelerate a touch faster than we accelerate so direction changes feel
    // crisp without the controller feeling twitchy. Air control stays low.
    // On ice, traction drops sharply — you accelerate slowly and glide a long way.
    const onIce = this.onGround && isSlippery(this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.06), Math.floor(this.pos.z)));
    const decel = wlen > 0; // accelerating toward a wish dir vs. coasting
    let accel = this.onGround ? ACCEL : AIR_ACCEL;
    if (this.onGround && !decel) accel = ACCEL * 1.3;
    if (onIce) accel *= 0.2;
    const targetX = wx * speed, targetZ = wz * speed;
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && wlen === 0) {
      const fr = Math.min(1, (onIce ? 1.8 : 13) * dt);
      this.vel.x -= this.vel.x * fr;
      this.vel.z -= this.vel.z * fr;
    }

    // --- Water / gravity / jump ---
    this.inWater = this._headOrFeetInWater();
    if (this.inWater) {
      this.vel.y -= GRAVITY * 0.32 * dt;
      this.vel.y *= 0.86;
      // Swim up: ease toward a steady ascent so surfacing feels buoyant rather
      // than a hard velocity snap. Clamp matches the previous ceiling.
      if (this.keys.has('Space')) this.vel.y += (4.2 - this.vel.y) * Math.min(1, 14 * dt);
      if (this.vel.y > 4.2) this.vel.y = 4.2;
      if (this.vel.y < -4) this.vel.y = -4;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.keys.has('Space') && this.onGround) {
        this.vel.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // --- Integrate with per-axis collision ---
    const wasGround = this.onGround;
    this.onGround = false;
    this._moveAxis('x', this.vel.x * dt);
    this._moveAxis('z', this.vel.z * dt);
    const vyPrev = this.vel.y;
    this._moveAxis('y', this.vel.y * dt);
    // Record a hard landing for fall-damage (survival, handled by main).
    if (this.onGround && !this.inWater && vyPrev < -16) this.fallImpact = -vyPrev - 16;
    // Visual landing punch: dip the camera (and a hair of FOV) on touchdown,
    // scaled by impact speed. Purely cosmetic — does not affect collision.
    // The FOV nudge eases away via the FOV smoothing in _updateCamera.
    if (this.onGround && !wasGround && !this.inWater && vyPrev < -6) {
      const f = Math.min(1, (-vyPrev - 6) / 14);
      this._landDip = Math.max(this._landDip, 0.06 + 0.12 * f);
      this.fov += 2.0 * f;
    }

    if (this.pos.y < -20) {
      this.pos.set(this.pos.x, 90, this.pos.z);
      this.vel.set(0, 0, 0);
    }

    this._updateCamera(dt, wlen > 0 && this.onGround, sprinting, speed);
  }

  _moveAxis(axis, amount) {
    if (amount === 0) return;
    this.pos[axis] += amount;
    const p = this.pos;
    const minX = Math.floor(p.x - HALF), maxX = Math.floor(p.x + HALF);
    const minY = Math.floor(p.y), maxY = Math.floor(p.y + HEIGHT);
    const minZ = Math.floor(p.z - HALF), maxZ = Math.floor(p.z + HALF);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          if (axis === 'x') {
            if (amount > 0) p.x = x - HALF - 1e-4; else p.x = x + 1 + HALF + 1e-4;
            this.vel.x = 0;
          } else if (axis === 'z') {
            if (amount > 0) p.z = z - HALF - 1e-4; else p.z = z + 1 + HALF + 1e-4;
            this.vel.z = 0;
          } else {
            if (amount > 0) { p.y = y - HEIGHT - 1e-4; }
            else { p.y = y + 1 + 1e-4; this.onGround = true; }
            this.vel.y = 0;
          }
          return; // resolved this axis
        }
      }
    }
  }

  _headOrFeetInWater() {
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    return this.world.getBlock(x, Math.floor(this.pos.y + 0.2), z) === WATER ||
           this.world.getBlock(x, Math.floor(this.pos.y + EYE), z) === WATER;
  }

  _updateCamera(dt, walking, sprinting, speed) {
    // --- Head bob ---
    // bobAmount stays in [0,1] and bobTime is a continuous phase: the viewmodel
    // in main.js reads both, so neither may snap or reset.
    const targetBob = walking ? Math.min(1, speed / WALK) : 0;
    // Settle to rest a little faster than it spins up, so stopping feels clean.
    const bobRate = targetBob > this.bobAmount ? 8 : 11;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, bobRate * dt);
    if (this.bobAmount < 1e-3) this.bobAmount = 0;
    if (walking) this.bobTime += dt * (sprinting ? 13 : 10);
    const bobY = Math.sin(this.bobTime * 2) * 0.055 * this.bobAmount;
    const bobX = Math.cos(this.bobTime) * 0.045 * this.bobAmount;

    // --- Landing dip (decays each frame; purely vertical, see eye below). ---
    this._landDip -= this._landDip * Math.min(1, 9 * dt);
    if (this._landDip < 1e-4) this._landDip = 0;

    // --- Sprint FOV (relative to the configurable base FOV). this.fov is the
    // steady FOV that main.js drives the camera from (ADS/scope multiply it),
    // so we only ease this.fov here; the landing FOV punch is injected as a
    // transient offset to this.fov at touchdown and eases back out naturally.
    const targetFov = (sprinting ? this.baseFov + (SPRINT_FOV - BASE_FOV) : this.baseFov)
      + (this.inWater ? -2 : 0);
    // Guard on internal state (not camera.fov): when this.fov has settled we must
    // NOT write camera.fov, or we'd stomp the scope/ADS value main.js owns.
    if (Math.abs(this.fov - targetFov) > 0.02) {
      this.fov += (targetFov - this.fov) * Math.min(1, 10 * dt);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- Smoothed sneak crouch (eased instead of snapping the eye height). ---
    const sneaking = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    const targetEyeOff = sneaking && !this.flying ? -0.18 : 0;
    this._eyeOff += (targetEyeOff - this._eyeOff) * Math.min(1, 12 * dt);
    const eye = EYE + this._eyeOff - this._landDip;

    // --- Camera roll: lean into strafes, with a touch of bob roll. ---
    const targetRoll = -this._strafe * 0.025 + bobX * 0.25;
    this._roll += (targetRoll - this._roll) * Math.min(1, 10 * dt);

    this.camera.position.set(this.pos.x + bobX, this.pos.y + eye + bobY, this.pos.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = this._roll;
  }

  eyePosition(out) {
    return out.set(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  // Flash step: blink up to `dist` blocks along the horizontal (dx,dz). Steps in
  // small increments, hopping one-block ledges, stopping before walls. Cancels the
  // fall, carries a little momentum and pops the FOV; returns blocks travelled.
  flashTeleport(dx, dz, dist) {
    const dl = Math.hypot(dx, dz); if (dl < 1e-4) return 0; dx /= dl; dz /= dl;
    const free = (x, y, z) => {
      const minX = Math.floor(x - HALF), maxX = Math.floor(x + HALF);
      const minY = Math.floor(y), maxY = Math.floor(y + HEIGHT - 0.02);
      const minZ = Math.floor(z - HALF), maxZ = Math.floor(z + HALF);
      for (let bx = minX; bx <= maxX; bx++) for (let by = minY; by <= maxY; by++) for (let bz = minZ; bz <= maxZ; bz++)
        if (isSolid(this.world.getBlock(bx, by, bz))) return false;
      return true;
    };
    const step = 0.3; let px = this.pos.x, py = this.pos.y, pz = this.pos.z, moved = 0;
    while (moved + step <= dist) {
      const nx = px + dx * step, nz = pz + dz * step;
      if (free(nx, py, nz)) { px = nx; pz = nz; }
      else if (free(nx, py + 1, nz)) { py += 1; px = nx; pz = nz; }   // dash up a one-block ledge
      else break;
      moved += step;
    }
    if (moved < 0.3) return 0;
    this.pos.set(px, py, pz);
    this.vel.x = dx * 7; this.vel.z = dz * 7;     // carry momentum out of the blink
    if (this.vel.y < 0) this.vel.y = 0;           // cancel the fall so you don't drop mid-dash
    this.fov += 9;                                // speed FOV punch (eases back in _updateCamera)
    return moved;
  }
}
