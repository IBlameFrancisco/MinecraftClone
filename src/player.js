// First-person controller: pointer-lock mouse look, WASD movement relative to
// view, jump/sprint/sneak, AABB-vs-voxel collision, head bob and sprint FOV.

import * as THREE from 'three';
import { isSolid, WATER } from './blocks.js';

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
    this.fov = BASE_FOV;

    camera.rotation.order = 'YXZ';
    this._bindInput();
  }

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      const s = 0.0022;
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
    const sneaking = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    let sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && f && !sneaking;

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward = (-sinY, -cosY), right = (cosY, -sinY)
    let wx = (-sinY) * (f - b) + cosY * (r - l);
    let wz = (-cosY) * (f - b) + (-sinY) * (r - l);
    const wlen = Math.hypot(wx, wz);
    if (wlen > 0) { wx /= wlen; wz /= wlen; }

    let speed = sprinting ? SPRINT : sneaking ? SNEAK : WALK;
    if (this.inWater) speed *= 0.6;

    // --- Horizontal velocity with acceleration/friction ---
    const accel = this.onGround ? ACCEL : AIR_ACCEL;
    const targetX = wx * speed, targetZ = wz * speed;
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && wlen === 0) {
      // ground friction
      const fr = Math.min(1, 12 * dt);
      this.vel.x -= this.vel.x * fr;
      this.vel.z -= this.vel.z * fr;
    }

    // --- Water / gravity / jump ---
    this.inWater = this._headOrFeetInWater();
    if (this.inWater) {
      this.vel.y -= GRAVITY * 0.32 * dt;
      this.vel.y *= 0.86;
      if (this.keys.has('Space')) this.vel.y = 4.2;
      if (this.vel.y < -4) this.vel.y = -4;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.keys.has('Space') && this.onGround) {
        this.vel.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // --- Integrate with per-axis collision ---
    this.onGround = false;
    this._moveAxis('x', this.vel.x * dt);
    this._moveAxis('z', this.vel.z * dt);
    this._moveAxis('y', this.vel.y * dt);

    // Respawn safety if somehow fallen out of world.
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
    // Head bob
    const targetBob = walking ? Math.min(1, speed / WALK) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, 8 * dt);
    if (walking) this.bobTime += dt * (sprinting ? 13 : 10);
    const bobY = Math.sin(this.bobTime * 2) * 0.055 * this.bobAmount;
    const bobX = Math.cos(this.bobTime) * 0.045 * this.bobAmount;

    // Sprint FOV
    const targetFov = sprinting ? SPRINT_FOV : BASE_FOV;
    if (Math.abs(this.fov - targetFov) > 0.05) {
      this.fov += (targetFov - this.fov) * Math.min(1, 10 * dt);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Slightly lower eye when sneaking.
    const sneaking = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    const eye = EYE - (sneaking ? 0.18 : 0);

    this.camera.position.set(this.pos.x + bobX, this.pos.y + eye + bobY, this.pos.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    // subtle roll while strafing/bobbing
    this.camera.rotation.z = bobX * 0.25;
  }

  eyePosition(out) {
    return out.set(this.pos.x, this.pos.y + EYE, this.pos.z);
  }
}
