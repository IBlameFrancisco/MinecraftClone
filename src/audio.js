// Synthesized sound effects via the WebAudio API — no audio assets. Break/place
// thuds and soft footstep clicks. The context is created on first user gesture.

export class SFX {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.lastStep = 0;
    this.master = null;
    this.listener = null;     // { x, y, z, fx, fz } updated from the camera
  }

  ensure() {
    // Browsers create/leave the context suspended until a user gesture, and may
    // auto-suspend it when backgrounded — always try to resume so SFX aren't muted.
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    // Pre-build a short white-noise buffer.
    const len = this.ctx.sampleRate * 0.4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  // World-space listener (camera) for positional sounds.
  setListener(x, y, z, fx, fz) { this.listener = { x, y, z, fx, fz }; }

  // A panned + distance-attenuated output node for a world position, or null if
  // out of earshot. Sounds default to `this.master` (centred / full volume).
  _spatial(x, y, z) {
    const L = this.listener; if (!L) return this.master;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z, dist = Math.hypot(dx, dy, dz);
    const maxD = 72; if (dist > maxD) return null;
    const g = this.ctx.createGain();
    g.gain.value = Math.pow(Math.max(0, 1 - dist / maxD), 1.6);
    const pan = this.ctx.createStereoPanner();
    const rx = L.fz, rz = -L.fx, len = Math.hypot(dx, dz) || 1;   // right = forward rotated −90° about Y
    pan.pan.value = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len));
    g.connect(pan).connect(this.master);
    return g;
  }

  _noise(dur, freq, q, gain, type = 'lowpass', out = null) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt).connect(g).connect(out || this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone(freq, freq2, dur, gain, type = 'triangle', out = null) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(out || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  break() {
    if (!this.ctx) return;
    this._noise(0.16, 1200, 1.0, 0.5);
    this._tone(180, 90, 0.12, 0.18, 'square');
  }

  place() {
    if (!this.ctx) return;
    this._noise(0.10, 800, 0.8, 0.35);
    this._tone(140, 200, 0.08, 0.16, 'triangle');
  }

  gun(kind, out = null) {
    if (!this.ctx) return;
    // Punchier reports: a sharp transient + a body tone with a low thump.
    if (kind === 'sniper') {
      this._noise(0.05, 5000, 0.6, 0.6, 'highpass', out);     // crack
      this._noise(0.30, 700, 0.9, 0.55, 'lowpass', out);      // boom tail
      this._tone(260, 45, 0.28, 0.30, 'square', out);
      this._tone(70, 40, 0.22, 0.22, 'sine', out);            // sub thump
    } else if (kind === 'shotgun') {
      this._noise(0.06, 2400, 0.5, 0.6, 'lowpass', out);      // big spread blast
      this._noise(0.22, 900, 0.7, 0.5, 'lowpass', out);
      this._tone(150, 50, 0.2, 0.26, 'square', out);
      this._tone(60, 38, 0.2, 0.2, 'sine', out);
    } else if (kind === 'rail') {
      this._tone(1400, 240, 0.22, 0.22, 'sawtooth', out);     // electric zap
      this._noise(0.08, 3000, 1.6, 0.2, 'bandpass', out);
      this._tone(90, 60, 0.18, 0.16, 'sine', out);
    } else {
      this._noise(0.04, 3200, 0.7, 0.42, 'highpass', out);    // snap
      this._noise(0.10, 1200, 0.8, 0.30, 'lowpass', out);
      this._tone(360, 110, 0.07, 0.20, 'square', out);
      this._tone(90, 50, 0.08, 0.14, 'sine', out);
    }
  }
  // Spatial gunshot at a world position (remote players / bots).
  gunAt(kind, x, y, z) { if (!this.ctx) return; const o = this._spatial(x, y, z); if (o) this.gun(kind, o); }

  // Rocket / grenade explosion: a big filtered boom.
  explosion(out = null) {
    if (!this.ctx) return;
    this._noise(0.5, 500, 0.7, 0.7, 'lowpass', out);
    this._noise(0.25, 1800, 0.5, 0.4, 'lowpass', out);
    this._tone(120, 38, 0.45, 0.3, 'square', out);
    this._tone(60, 30, 0.5, 0.28, 'sine', out);
  }
  explosionAt(x, y, z) { if (!this.ctx) return; const o = this._spatial(x, y, z); if (o) this.explosion(o); }

  // Player took damage — a short oof.
  hurt() {
    if (!this.ctx) return;
    this._tone(200, 90, 0.18, 0.22, 'sawtooth');
    this._noise(0.08, 900, 0.8, 0.16, 'lowpass');
  }
  // Hit confirmation tick (brighter ding on a headshot).
  hitmark(head) { if (!this.ctx) return; this._tone(head ? 1600 : 1100, head ? 1950 : 1300, 0.05, 0.16, 'square'); }
  // Announcer stinger: First Blood / multikill / round win.
  announce(kind) {
    if (!this.ctx) return;
    if (kind === 'win') { this._tone(440, 880, 0.5, 0.18, 'triangle'); this._tone(660, 990, 0.5, 0.12, 'sine'); }
    else if (kind === 'multi') { this._tone(700, 1300, 0.18, 0.2, 'square'); this._tone(500, 900, 0.22, 0.14, 'sawtooth'); }
    else { this._tone(900, 500, 0.22, 0.2, 'sawtooth'); this._noise(0.1, 2000, 1.4, 0.12, 'bandpass'); }
  }
  plasma() {
    if (!this.ctx) return;
    this._tone(720, 170, 0.18, 0.16, 'sawtooth');
    this._noise(0.10, 2200, 1.5, 0.1, 'bandpass');
  }
  portal() {
    if (!this.ctx) return;
    this._tone(380, 920, 0.18, 0.15, 'sine');
  }

  // Surface-dependent footstep. `mat` is a material category.
  step(mat = 'grass') {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastStep < 270) return;
    this.lastStep = now;
    const M = {
      grass:  { freq: 480,  q: 0.7, gain: 0.10, type: 'lowpass',  dur: 0.07 },
      dirt:   { freq: 360,  q: 0.7, gain: 0.10, type: 'lowpass',  dur: 0.07 },
      stone:  { freq: 1700, q: 1.2, gain: 0.12, type: 'highpass', dur: 0.05 },
      sand:   { freq: 1900, q: 0.8, gain: 0.07, type: 'bandpass', dur: 0.08 },
      wood:   { freq: 430,  q: 2.6, gain: 0.12, type: 'bandpass', dur: 0.09 },
      snow:   { freq: 1300, q: 0.9, gain: 0.08, type: 'bandpass', dur: 0.05 },
      gravel: { freq: 880,  q: 2.0, gain: 0.12, type: 'bandpass', dur: 0.07 },
      glass:  { freq: 2600, q: 1.6, gain: 0.08, type: 'highpass', dur: 0.05 },
      wool:   { freq: 300,  q: 0.6, gain: 0.06, type: 'lowpass',  dur: 0.08 },
    };
    const m = M[mat] || M.grass;
    this._noise(m.dur, m.freq * (0.85 + Math.random() * 0.3), m.q, m.gain, m.type);
    if (mat === 'wood') this._tone(165, 95, 0.06, 0.06, 'sine'); // hollow thud
  }
}
