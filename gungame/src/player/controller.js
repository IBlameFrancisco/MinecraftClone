// First-person movement: mouse-look, accelerated WASD with sprint/crouch/jump, gravity,
// and swept AABB collision against the arena colliders (with step-up so ramps/steps are
// walkable). `pos` is the FEET position; the camera sits at pos.y + eye height.
import * as THREE from 'three';

const R = 0.34;                 // player half-width (x/z)
const STAND_H = 1.78, CROUCH_H = 1.25;
const STAND_EYE = 1.62, CROUCH_EYE = 1.05;
const STEP = 0.62;             // max ledge you auto-step up
const GRAV = 24, JUMP = 7.6;
const ACCEL = 60, AIR_ACCEL = 12, FRICTION = 9;

export class Controller {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.height = STAND_H; this.eye = STAND_EYE;
    this.crouching = false; this.sprinting = false;
    this.alive = true;
    this.speedMul = 1;            // ability haste (Sharingan)
    this._fwd = new THREE.Vector3();
  }
  spawn(p, yaw = 0) { this.pos.set(p.x, p.y, p.z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.onGround = true; this.speedMul = 1; }

  forward(out) { out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); return out; }

  update(dt, input, world) {
    // --- look ---
    const lk = input.look();
    this.yaw -= lk.dx; this.pitch -= lk.dy;
    const lim = Math.PI / 2 - 0.04;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));

    // --- crouch / sprint targets ---
    this.crouching = input.down('ControlLeft') || input.down('KeyC');
    const wantH = this.crouching ? CROUCH_H : STAND_H;
    const wantEye = this.crouching ? CROUCH_EYE : STAND_EYE;
    this.height += (wantH - this.height) * Math.min(1, 12 * dt);
    this.eye += (wantEye - this.eye) * Math.min(1, 12 * dt);

    // --- wish direction (relative to yaw) ---
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let fx = 0, fz = 0;
    if (input.down('KeyW')) { fx -= sinY; fz -= cosY; }
    if (input.down('KeyS')) { fx += sinY; fz += cosY; }
    if (input.down('KeyA')) { fx -= cosY; fz += sinY; }
    if (input.down('KeyD')) { fx += cosY; fz -= sinY; }
    const wl = Math.hypot(fx, fz);
    if (wl > 0) { fx /= wl; fz /= wl; }
    this.sprinting = input.down('ShiftLeft') && !this.crouching && fz * -cosY + fx * -sinY > -0.2 && wl > 0;
    const speed = (this.crouching ? 2.7 : this.sprinting ? 8.4 : 5.4) * this.speedMul;

    // --- horizontal acceleration + friction ---
    const accel = this.onGround ? ACCEL : AIR_ACCEL;
    const wishVX = fx * speed, wishVZ = fz * speed;
    if (this.onGround) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0) { const drop = sp * FRICTION * dt; const k = Math.max(0, sp - drop) / sp; this.vel.x *= k; this.vel.z *= k; }
    }
    this.vel.x += (wishVX - this.vel.x) * Math.min(1, accel * dt / Math.max(speed, 1));
    this.vel.z += (wishVZ - this.vel.z) * Math.min(1, accel * dt / Math.max(speed, 1));

    // --- jump + gravity ---
    if (this.onGround && (input.down('Space'))) { this.vel.y = JUMP; this.onGround = false; }
    this.vel.y -= GRAV * dt;
    if (this.vel.y < -55) this.vel.y = -55;

    // --- integrate with per-axis collision ---
    const cols = world.colliders, gy = world.groundY ?? 0, half = (world.half ?? 70) - R - 0.5;
    this._moveAxis('x', this.vel.x * dt, cols);
    this._moveAxis('z', this.vel.z * dt, cols);
    this._moveY(this.vel.y * dt, cols, gy);
    // arena bounds clamp (safety net beyond the wall colliders)
    this.pos.x = Math.max(-half, Math.min(half, this.pos.x));
    this.pos.z = Math.max(-half, Math.min(half, this.pos.z));
  }

  _aabb() {
    return { minx: this.pos.x - R, maxx: this.pos.x + R, miny: this.pos.y, maxy: this.pos.y + this.height, minz: this.pos.z - R, maxz: this.pos.z + R };
  }
  _hits(a, cols) {
    const out = [];
    for (const c of cols) {
      if (a.minx < c.max.x && a.maxx > c.min.x && a.miny < c.max.y && a.maxy > c.min.y && a.minz < c.max.z && a.maxz > c.min.z) out.push(c);
    }
    return out;
  }
  _moveAxis(axis, d, cols) {
    if (d === 0) return;
    this.pos[axis] += d;
    let a = this._aabb();
    for (const c of this._hits(a, cols)) {
      // step-up: if this is a low ledge and we're roughly grounded, climb it instead of stopping
      const top = c.max.y, rise = top - this.pos.y;
      if (rise > 0.02 && rise <= STEP) {
        const lifted = { ...a, miny: top + 0.001, maxy: top + 0.001 + this.height };
        if (this._hits(lifted, cols).length === 0) { this.pos.y = top + 0.001; this.onGround = true; a = this._aabb(); continue; }
      }
      // otherwise push out of this collider along the axis
      if (axis === 'x') this.pos.x = d > 0 ? c.min.x - R - 0.001 : c.max.x + R + 0.001;
      else this.pos.z = d > 0 ? c.min.z - R - 0.001 : c.max.z + R + 0.001;
      this.vel[axis] = 0;
      a = this._aabb();
    }
  }
  _moveY(d, cols, gy) {
    this.pos.y += d;
    this.onGround = false;
    let a = this._aabb();
    for (const c of this._hits(a, cols)) {
      if (d <= 0) { this.pos.y = c.max.y + 0.001; this.vel.y = 0; this.onGround = true; }   // landed on top
      else { this.pos.y = c.min.y - this.height - 0.001; this.vel.y = 0; }                    // bonked head
      a = this._aabb();
    }
    if (this.pos.y <= gy) { this.pos.y = gy; this.vel.y = 0; this.onGround = true; }
  }

  applyCamera(camera) {
    camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
