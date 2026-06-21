// Synthesized sound effects via the WebAudio API — no audio assets. Break/place
// thuds and soft footstep clicks. The context is created on first user gesture.

export class SFX {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.lastStep = 0;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // Pre-build a short white-noise buffer.
    const len = this.ctx.sampleRate * 0.4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  _noise(dur, freq, q, gain, type = 'lowpass') {
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
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone(freq, freq2, dur, gain, type = 'triangle') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(ctx.destination);
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

  gun(kind) {
    if (!this.ctx) return;
    if (kind === 'sniper') { this._noise(0.20, 1100, 0.8, 0.5, 'lowpass'); this._tone(240, 55, 0.2, 0.26, 'square'); }
    else { this._noise(0.07, 1900, 0.7, 0.34, 'highpass'); this._tone(330, 120, 0.06, 0.16, 'square'); }
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
