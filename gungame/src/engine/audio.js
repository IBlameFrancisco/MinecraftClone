// Procedural WebAudio: punchy gun cracks, 3D-positional enemy fire, hit/hurt/reload pings,
// an ambient wind bed, a light combat music loop, and an announcer. Everything is
// synthesized — no audio files to load. Buses: sfx / music / ambience under a master gain.
import * as THREE from 'three';
const _p = new THREE.Vector3(), _f = new THREE.Vector3();

export class Audio {
  constructor() { this.ctx = null; this.master = null; }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 1.0; this.sfx.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.0; this.musicBus.connect(this.master);
    this.ambBus = this.ctx.createGain(); this.ambBus.gain.value = 0.0; this.ambBus.connect(this.master);
    // shared noise buffer
    const N = this.ctx.sampleRate * 0.5; const buf = this.ctx.createBuffer(1, N, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1; this.noise = buf;
    this._startAmbience();
    this._musicOn = false;
  }

  // --- 3D listener follows the camera ---
  setListener(cam) {
    if (!this.ctx) return; const L = this.ctx.listener; const p = cam.getWorldPosition(_p); const f = cam.getWorldDirection(_f);
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 7; p.maxDistance = 95; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfx); return p;
  }

  // --- low-level synths ---
  _noise(dur, freq, q, gain, type = 'lowpass', dest = null) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfx); s.start(t); s.stop(t + dur + 0.02);
  }
  _tone(f1, f2, dur, gain, type = 'square', dest = null) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  // --- gun crack (player, dry/loud) ---
  shoot(kind) {
    this._noise(0.05, 3600, 0.6, 0.5, 'highpass'); this._noise(0.16, 700, 0.7, 0.5, 'lowpass');
    this._tone(220, 60, 0.1, 0.3, 'square'); this._tone(90, 40, 0.14, 0.25, 'sine');
    this._duckMusic();
  }
  // --- gun crack from a world position (other combatants, 3D) ---
  shootAt(pos, kind) {
    if (!this.ctx) return; const t = this.ctx.currentTime; const dest = this._panner(pos);
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + 0.2);
  }
  footstepAt(pos) {
    if (!this.ctx) return; const t = this.ctx.currentTime; const dest = this._panner(pos);
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.9;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.1);
    s.connect(f).connect(g).connect(dest); s.start(t); s.stop(t + 0.12);
  }

  hit(head) { this._tone(head ? 1400 : 900, head ? 1900 : 1200, 0.06, 0.18, 'sine'); }
  hurt() { this._noise(0.18, 500, 0.6, 0.4, 'lowpass'); this._tone(180, 70, 0.14, 0.2, 'sawtooth'); }
  reload() { this._tone(300, 300, 0.03, 0.12, 'square'); setTimeout(() => this._tone(420, 420, 0.03, 0.12, 'square'), 180); }
  kill() { this._tone(700, 1100, 0.08, 0.2, 'square'); setTimeout(() => this._tone(1100, 1500, 0.1, 0.18, 'square'), 70); }
  ui() { this._tone(520, 660, 0.05, 0.12, 'triangle'); }
  // distinctive synthesized stingers for each ability ult
  ability(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'hollow': this._tone(120, 38, 0.8, 0.5, 'sawtooth'); this._noise(0.7, 280, 0.6, 0.45, 'lowpass'); this._tone(900, 180, 0.6, 0.22, 'sine'); break;
      case 'rasengan': this._noise(0.55, 1900, 3.5, 0.32, 'bandpass'); this._tone(380, 950, 0.32, 0.2, 'sine'); break;
      case 'rasenshuriken': this._noise(0.5, 2700, 4, 0.38, 'bandpass'); this._tone(950, 280, 0.45, 0.22, 'triangle'); break;
      case 'cleave': this._noise(0.16, 5200, 1, 0.42, 'highpass'); this._tone(1300, 200, 0.18, 0.26, 'sawtooth'); break;
      case 'fuga': this._noise(0.55, 480, 0.6, 0.48, 'lowpass'); this._tone(170, 920, 0.45, 0.26, 'sawtooth'); break;
      case 'blackhole': this._tone(58, 28, 1.3, 0.42, 'sine'); this._noise(1.1, 190, 0.6, 0.3, 'lowpass'); break;
      case 'timestop': this._tone(950, 55, 0.7, 0.38, 'sine'); this._noise(0.3, 1200, 2, 0.2, 'bandpass'); break;
      case 'stand': this._tone(280, 280, 0.1, 0.32, 'square'); setTimeout(() => this._tone(360, 360, 0.1, 0.28, 'square'), 90); break;
      case 'portal': this._tone(700, 1500, 0.28, 0.22, 'sine'); break;
      case 'sharingan': this._tone(520, 520, 0.35, 0.22, 'triangle'); this._noise(0.3, 900, 2, 0.15, 'bandpass'); break;
      default: this._tone(420, 820, 0.22, 0.2, 'sine');
    }
    this._duckMusic();
  }

  // --- announcer: short synthesized stingers ---
  announce(kind) {
    if (!this.ctx) return;
    const seq = {
      headshot: [[900, 0.0], [1500, 0.08]],
      victory: [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36]],
      defeat: [[440, 0], [392, 0.14], [311, 0.3]],
      death: [[300, 0], [180, 0.12]],
      firstblood: [[700, 0], [1050, 0.1], [1400, 0.2]],
    }[kind];
    if (!seq) return;
    for (const [f, d] of seq) setTimeout(() => this._tone(f, f * 1.02, 0.16, 0.16, 'triangle'), d * 1000);
  }

  // --- ambience: soft filtered-noise wind bed ---
  _startAmbience() {
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.5;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    // slow LFO on the filter for a breathing wind feel
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = this.ctx.createGain(); lg.gain.value = 160;
    lfo.connect(lg).connect(f.frequency); lfo.start(t);
    s.connect(f).connect(g).connect(this.ambBus); s.start(t);
    this.ambBus.gain.setTargetAtTime(0.18, t, 1.5);
  }

  // --- combat music: a light evolving pulse, started at match begin ---
  matchStart(mode) {
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(0.16, this.ctx.currentTime, 1.0);
    if (this._musicOn) return; this._musicOn = true;
    this._musicStep = 0; this._scheduleMusic();
  }
  _scheduleMusic() {
    if (!this.ctx || !this._musicOn) return;
    const root = 55; // A1
    const bass = [0, 0, 5, 3]; const i = this._musicStep % 4;
    const f = root * Math.pow(2, bass[i] / 12);
    this._tone(f, f, 0.5, 0.5, 'sawtooth', this.musicBus);
    if (i === 0 || i === 2) this._noise(0.06, 6000, 0.5, 0.25, 'highpass', this.musicBus); // hat
    // occasional high pad note
    if (Math.random() < 0.5) { const n = f * 4 * (Math.random() < 0.5 ? 1 : 1.5); this._tone(n, n, 0.7, 0.12, 'triangle', this.musicBus); }
    this._musicStep++;
    this._musicTimer = setTimeout(() => this._scheduleMusic(), 460);
  }
  stopMusic() { this._musicOn = false; if (this._musicTimer) clearTimeout(this._musicTimer); if (this.ctx) this.musicBus.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.5); }
  _duckMusic() {
    if (!this.ctx || !this._musicOn) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0.10, t + 0.04);
    this.musicBus.gain.setTargetAtTime(0.16, t + 0.12, 0.4);
  }
}
