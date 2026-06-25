// Minimal procedural WebAudio SFX — punchy gun cracks, hit pings, reloads.
export class Audio {
  constructor() { this.ctx = null; this.master = null; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.35; this.master.connect(this.ctx.destination);
    const N = this.ctx.sampleRate * 0.4; const buf = this.ctx.createBuffer(1, N, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1; this.noise = buf;
  }
  _noise(dur, freq, q, gain, type = 'lowpass') {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  }
  _tone(f1, f2, dur, gain, type = 'square') {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  shoot(kind) {
    this._noise(0.05, 3600, 0.6, 0.5, 'highpass'); this._noise(0.16, 700, 0.7, 0.5, 'lowpass');
    this._tone(220, 60, 0.1, 0.3, 'square'); this._tone(90, 40, 0.14, 0.25, 'sine');
  }
  hit(head) { this._tone(head ? 1400 : 900, head ? 1900 : 1200, 0.06, 0.18, 'sine'); }
  hurt() { this._noise(0.18, 500, 0.6, 0.4, 'lowpass'); this._tone(180, 70, 0.14, 0.2, 'sawtooth'); }
  reload() { this._tone(300, 300, 0.03, 0.12, 'square'); setTimeout(() => this._tone(420, 420, 0.03, 0.12, 'square'), 180); }
  kill() { this._tone(700, 1100, 0.08, 0.2, 'square'); setTimeout(() => this._tone(1100, 1500, 0.1, 0.18, 'square'), 70); }
}
