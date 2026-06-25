// Pointer-lock input: keyboard state, mouse buttons, and accumulated look deltas.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false;
    this.rightDown = false;
    this.dx = 0; this.dy = 0;            // accumulated look delta since last consume
    this.locked = false;
    this.sens = 0.0022;
    this._wheel = 0;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('mousedown', (e) => { if (!this.locked) return; if (e.button === 0) this.mouseDown = true; if (e.button === 2) this.rightDown = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.rightDown = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    addEventListener('wheel', (e) => { this._wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouseDown = false; this.rightDown = false; }
      this.onLockChange && this.onLockChange(this.locked);
    });
  }
  lock() { this.canvas.requestPointerLock(); }
  unlock() { document.exitPointerLock(); }
  // Consume the accumulated look delta (call once per frame).
  look() { const o = { dx: this.dx * this.sens, dy: this.dy * this.sens }; this.dx = 0; this.dy = 0; return o; }
  wheel() { const w = this._wheel; this._wheel = 0; return w; }
  down(code) { return this.keys.has(code); }
  pressed(code) { return this.keys.has(code); }   // (edge handled by callers tracking prev)
}
