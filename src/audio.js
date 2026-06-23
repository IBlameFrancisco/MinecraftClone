// Synthesized sound effects via the WebAudio API — no audio assets. Every report,
// ability, footstep and UI tick is built at runtime by layering noise bursts,
// tonal bodies and short tails through tasteful attack/decay envelopes. The
// context is created on first user gesture; positional sounds are panned and
// distance-attenuated relative to the camera listener.

export class SFX {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.lastStep = 0;
    this.stepFlip = 0;        // alternate L/R footsteps for a walking gait
    this.master = null;
    this.limiter = null;
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
    this.master.gain.value = 0.82;
    // A gentle limiter so layered transients (gunfire, explosions) stay glued and
    // never clip into harsh digital distortion — keeps the overall mix cohesive.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 24;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    // Pre-build a longer white-noise buffer (used for tails / explosions too).
    const len = Math.floor(this.ctx.sampleRate * 0.8);
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
    // Distant sounds lose their highs (air absorption) — adds a sense of space.
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000 - Math.min(15000, dist * 200);
    const pan = this.ctx.createStereoPanner();
    const rx = L.fz, rz = -L.fx, len = Math.hypot(dx, dz) || 1;   // right = forward rotated −90° about Y
    pan.pan.value = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len));
    g.connect(lp).connect(pan).connect(this.master);
    return g;
  }

  // Filtered noise burst with a short attack and exponential decay tail.
  // `atk` (optional 6th positional arg via opts) keeps the original signature.
  _noise(dur, freq, q, gain, type = 'lowpass', out = null) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    // Randomise the read offset so repeated shots don't sound mechanically identical.
    const maxOff = Math.max(0, this.noiseBuffer.duration - dur - 0.05);
    const off = Math.random() * maxOff;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const atk = Math.min(0.004, dur * 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);   // fast attack, no click
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt).connect(g).connect(out || this.master);
    src.start(t, off);
    src.stop(t + dur + 0.02);
  }

  // Pitch-swept oscillator with a short attack and exponential decay.
  _tone(freq, freq2, dur, gain, type = 'triangle', out = null) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
    const atk = Math.min(0.006, dur * 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(out || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // ---- internal layering helpers (not part of the public API) ----

  // A delayed sub-thump for weight under a transient.
  _thump(freq, freq2, dur, gain, out = null, delay = 0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(out || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A very short bright noise "click" for a crisp mechanical transient.
  _click(freq, gain, out = null) {
    this._noise(0.012, freq, 0.5, gain, 'highpass', out);
  }

  // ---- foley ----

  break() {
    if (!this.ctx) return;
    this._noise(0.20, 1300, 1.1, 0.44, 'bandpass');   // crunch (slightly longer, fuller)
    this._noise(0.11, 3400, 0.6, 0.20, 'highpass');   // splintery top
    this._noise(0.05, 2200, 2.0, 0.16, 'bandpass');   // initial sharp crack
    this._tone(200, 78, 0.13, 0.18, 'square');         // body crack
    this._tone(140, 60, 0.09, 0.08, 'triangle');       // woody undertone
    this._thump(110, 50, 0.12, 0.15);                  // dull weight
  }

  place() {
    if (!this.ctx) return;
    this._noise(0.09, 680, 0.9, 0.28, 'lowpass');      // settling tap
    this._noise(0.03, 1800, 1.4, 0.12, 'bandpass');    // crisp contact tick
    this._tone(150, 215, 0.08, 0.15, 'triangle');      // satisfying upward set
    this._tone(300, 430, 0.05, 0.06, 'sine');          // bright confirm overtone
    this._thump(120, 66, 0.08, 0.13);                  // soft seated weight
  }

  // Per-weapon gunshot. Each layers a noise transient + tonal body + short tail
  // and a sub thump for weight; `out` routes to a spatial node when positional.
  gun(kind, out = null) {
    if (!this.ctx) return;
    if (kind === 'sniper') {
      // Sharp supersonic crack, then a wide booming tail.
      this._click(7200, 0.5, out);
      this._noise(0.05, 6200, 0.5, 0.58, 'highpass', out);
      this._noise(0.06, 2600, 0.6, 0.5, 'bandpass', out);    // mid body of the report
      this._noise(0.34, 600, 0.9, 0.5, 'lowpass', out);       // boom tail
      this._noise(0.20, 260, 0.5, 0.24, 'lowpass', out, 0.03);// distant slap-back rumble
      this._tone(300, 50, 0.26, 0.28, 'square', out);
      this._tone(180, 44, 0.22, 0.12, 'sawtooth', out);       // gritty mid harmonic
      this._thump(75, 36, 0.28, 0.26, out);                   // deep recoil thump
    } else if (kind === 'shotgun') {
      // Boomy, wide, low — a big spread blast with a long decaying roar.
      this._noise(0.06, 2800, 0.4, 0.58, 'lowpass', out);
      this._noise(0.32, 800, 0.6, 0.55, 'lowpass', out);
      this._noise(0.16, 420, 0.5, 0.4, 'lowpass', out);
      this._noise(0.04, 4200, 0.5, 0.22, 'highpass', out);    // shell spray top-end
      this._tone(160, 44, 0.24, 0.26, 'square', out);
      this._tone(220, 70, 0.10, 0.12, 'sawtooth', out);       // mid bark
      this._thump(60, 32, 0.32, 0.30, out);
    } else if (kind === 'rail') {
      // Electric railgun zap — a charged sweep with a metallic resonant body.
      this._tone(1700, 175, 0.26, 0.22, 'sawtooth', out);     // descending zap
      this._tone(2600, 900, 0.10, 0.12, 'square', out);       // bright spark
      this._tone(3400, 1500, 0.06, 0.07, 'sawtooth', out);    // hot leading edge
      this._noise(0.12, 3200, 6.0, 0.18, 'bandpass', out);    // crackle
      this._noise(0.18, 1400, 8.0, 0.08, 'bandpass', out);    // resonant metallic ring
      this._tone(95, 58, 0.20, 0.16, 'sine', out);            // power thump
    } else if (kind === 'mg42') {
      // Heavy machine-gun chug — fat, percussive, mechanical.
      this._click(3000, 0.28, out);
      this._noise(0.05, 1900, 0.7, 0.4, 'lowpass', out);
      this._noise(0.13, 680, 0.7, 0.3, 'lowpass', out);
      this._tone(280, 68, 0.09, 0.22, 'square', out);
      this._tone(170, 50, 0.06, 0.10, 'sawtooth', out);       // mechanical grit
      this._thump(82, 42, 0.13, 0.22, out);                   // weighty bolt slam
    } else if (kind === 'smg') {
      // Fast, light, snappy — bright crack with a small body.
      this._click(4400, 0.26, out);
      this._noise(0.035, 3700, 0.7, 0.36, 'highpass', out);
      this._noise(0.07, 1500, 0.8, 0.24, 'lowpass', out);
      this._tone(400, 128, 0.05, 0.17, 'square', out);
      this._thump(95, 52, 0.07, 0.12, out);
    } else if (kind === 'assault' || kind === 'rifle') {
      // Assault rifle — punchy mid-weight crack with a tight tail.
      this._click(4700, 0.3, out);
      this._noise(0.045, 3500, 0.7, 0.42, 'highpass', out);
      this._noise(0.12, 1250, 0.8, 0.3, 'lowpass', out);
      this._tone(340, 98, 0.08, 0.2, 'square', out);
      this._tone(560, 180, 0.04, 0.08, 'sawtooth', out);      // crisp leading snap
      this._thump(86, 46, 0.10, 0.16, out);
    } else if (kind === 'plasma') {
      // Sci-fi plasma bolt (also see plasma()) — bright energetic pew.
      this._tone(900, 195, 0.17, 0.18, 'sawtooth', out);
      this._tone(1500, 520, 0.09, 0.1, 'square', out);
      this._tone(2400, 1100, 0.05, 0.05, 'sine', out);        // ionised sparkle
      this._noise(0.10, 2600, 5.0, 0.12, 'bandpass', out);
      this._thump(90, 58, 0.11, 0.1, out);
    } else {
      // Default handgun — a clean, meaty pistol crack.
      this._click(4000, 0.3, out);
      this._noise(0.04, 3500, 0.7, 0.42, 'highpass', out);    // snap
      this._noise(0.11, 1200, 0.8, 0.3, 'lowpass', out);      // body
      this._tone(380, 108, 0.06, 0.2, 'square', out);
      this._tone(620, 200, 0.035, 0.08, 'sawtooth', out);     // crisp report edge
      this._thump(90, 48, 0.09, 0.16, out);                   // sub thump
    }
  }
  // Spatial gunshot at a world position (remote players / bots).
  gunAt(kind, x, y, z) { if (!this.ctx) return; const o = this._spatial(x, y, z); if (o) this.gun(kind, o); }

  // Rocket / grenade explosion: a deep filtered boom with a long rumbling tail.
  explosion(out = null) {
    if (!this.ctx) return;
    this._noise(0.07, 3200, 0.4, 0.55, 'lowpass', out);       // initial crack/debris
    this._noise(0.55, 470, 0.6, 0.7, 'lowpass', out);         // main body roar
    this._noise(0.42, 1600, 0.5, 0.32, 'bandpass', out);      // grit / shrapnel
    this._noise(0.30, 240, 0.5, 0.30, 'lowpass', out, 0.05);  // delayed billowing tail
    this._tone(130, 32, 0.5, 0.3, 'square', out);             // mid punch
    this._tone(200, 60, 0.18, 0.14, 'sawtooth', out);         // gritty fireball bark
    this._thump(68, 24, 0.62, 0.34, out);                     // deep sub boom
    this._thump(44, 20, 0.72, 0.2, out, 0.02);                // sustained rumble
  }
  explosionAt(x, y, z) { if (!this.ctx) return; const o = this._spatial(x, y, z); if (o) this.explosion(o); }

  // Player took damage — a short pained grunt.
  hurt() {
    if (!this.ctx) return;
    this._tone(230, 82, 0.22, 0.22, 'sawtooth');              // pained vocal drop
    this._tone(150, 68, 0.16, 0.12, 'square');
    this._tone(95, 60, 0.10, 0.08, 'sine');                   // gut-impact weight
    this._noise(0.10, 760, 0.8, 0.16, 'lowpass');             // breath/impact
  }
  // Hit confirmation tick (brighter, sharper ding on a headshot).
  hitmark(head) {
    if (!this.ctx) return;
    if (head) {
      // Distinct crisp two-note headshot zing.
      this._tone(1700, 2150, 0.05, 0.17, 'square');
      this._tone(2300, 2700, 0.06, 0.1, 'triangle');
      this._tone(3100, 3500, 0.04, 0.05, 'sine');             // bright sparkle top
      this._click(6200, 0.12);
    } else {
      this._tone(1150, 1380, 0.045, 0.16, 'square');
      this._tone(1600, 1850, 0.035, 0.06, 'triangle');        // subtle confirm shimmer
      this._click(5000, 0.08);
    }
  }
  // Announcer stinger: First Blood / multikill / round win.
  announce(kind) {
    if (!this.ctx) return;
    if (kind === 'win') {
      // Triumphant ascending fanfare (major triad + octave for a fuller chord).
      this._tone(523, 523, 0.5, 0.17, 'triangle');
      this._tone(659, 659, 0.5, 0.13, 'triangle');
      this._tone(784, 988, 0.55, 0.13, 'sine');
      this._tone(1047, 1047, 0.5, 0.07, 'sine');              // shining octave on top
      this._tone(262, 262, 0.6, 0.1, 'sine');                 // grounding root
    } else if (kind === 'multi') {
      // Aggressive bright stinger.
      this._tone(740, 1480, 0.16, 0.2, 'square');
      this._tone(560, 1120, 0.2, 0.14, 'sawtooth');
      this._tone(370, 740, 0.24, 0.1, 'triangle');
      this._tone(185, 370, 0.22, 0.07, 'sine');               // sub reinforcement
      this._noise(0.08, 3000, 1.6, 0.08, 'bandpass');
    } else {
      // First blood / generic callout — a sharp descending zap.
      this._tone(950, 470, 0.22, 0.2, 'sawtooth');
      this._tone(1400, 700, 0.14, 0.1, 'square');
      this._tone(475, 235, 0.18, 0.08, 'triangle');           // octave-below body
      this._noise(0.1, 2200, 1.4, 0.1, 'bandpass');
    }
  }
  plasma() {
    if (!this.ctx) return;
    // Bright sci-fi pew with a shimmering tail.
    this._tone(820, 175, 0.19, 0.17, 'sawtooth');
    this._tone(1400, 460, 0.1, 0.1, 'square');
    this._tone(2300, 1000, 0.06, 0.05, 'sine');        // ionised sparkle edge
    this._noise(0.11, 2400, 4.0, 0.1, 'bandpass');
    this._thump(92, 56, 0.11, 0.1);
  }
  portal() {
    if (!this.ctx) return;
    // Warbling rising shimmer — also used as a pleasant pickup/teleport cue.
    this._tone(360, 960, 0.2, 0.16, 'sine');
    this._tone(540, 1320, 0.18, 0.1, 'triangle');
    this._tone(720, 1760, 0.14, 0.05, 'sine');         // upper harmonic glint
    this._noise(0.16, 3200, 2.4, 0.06, 'highpass');
  }
  blackhole() {
    if (!this.ctx) return;
    // Ominous collapsing swell sucking inward.
    this._tone(240, 32, 0.9, 0.22, 'sawtooth');      // deep descending swell
    this._tone(170, 28, 0.7, 0.14, 'square');         // gritty harmonic
    this._tone(360, 40, 0.55, 0.08, 'sawtooth');      // upper layer dragged down
    this._thump(120, 22, 1.05, 0.2);                  // sub rumble
    this._noise(0.75, 340, 0.6, 0.13, 'lowpass');     // airy suck
    this._noise(0.55, 1800, 3.0, 0.06, 'bandpass');   // swirling whine
  }
  // Flash step — a sharp whoosh of displaced air as you blink across the field.
  flashStep() {
    if (!this.ctx) return;
    this._tone(940, 220, 0.16, 0.12, 'sine');          // fast descending zip
    this._noise(0.18, 2600, 1.4, 0.12, 'highpass');    // airy swish
    this._noise(0.06, 4200, 1.0, 0.06, 'highpass');    // crisp leading sssh
    this._noise(0.1, 680, 0.8, 0.07, 'bandpass');      // low whump body
  }
  rasengan() {
    if (!this.ctx) return;
    // Dense swirling grind of compressed chakra.
    this._tone(470, 180, 0.27, 0.15, 'sine');         // swirling whoosh
    this._tone(330, 148, 0.24, 0.1, 'triangle');      // counter-swirl
    this._tone(660, 300, 0.16, 0.05, 'sine');         // shimmering upper swirl
    this._noise(0.25, 1600, 2.4, 0.13, 'bandpass');   // grinding hiss
    this._noise(0.18, 580, 0.7, 0.08, 'lowpass');     // low body
  }
  rasenshuriken() {
    if (!this.ctx) return;
    // Screaming high-pitched whirr of countless chakra blades on the throw.
    this._tone(760, 2000, 0.19, 0.14, 'sawtooth');
    this._tone(1200, 2700, 0.12, 0.08, 'square');     // shrieking overtone
    this._tone(500, 1500, 0.16, 0.06, 'sawtooth');    // dense lower whirr layer
    this._noise(0.17, 3600, 3.2, 0.09, 'highpass');   // bladed hiss
    this._noise(0.1, 1800, 2.0, 0.06, 'bandpass');
  }
  // Cleave & Dismantle: a sharp curse-energy cut — a fast downward metallic swoosh
  // with a bright slicing hiss.
  slash() {
    if (!this.ctx) return;
    this._noise(0.13, 5200, 2.6, 0.13, 'highpass');   // slicing air hiss
    this._noise(0.07, 2600, 3.2, 0.10, 'bandpass');   // bladed shing
    this._tone(1300, 360, 0.12, 0.11, 'sawtooth');    // downward cut sweep
    this._tone(840, 210, 0.10, 0.06, 'triangle');     // body
    this._tone(2200, 880, 0.07, 0.04, 'square');      // metallic glint
  }
  // Stand barrage — a rapid flurry of punch impacts (ORA ORA ORA), staggered over
  // ~0.35s. `pos` spatialises it to the target.
  standBarrage(pos = null) {
    if (!this.ctx) return;
    const o = pos ? this._spatial(pos.x, pos.y, pos.z) : null;
    if (pos && !o) return;
    const punch = () => {
      this._noise(0.04, 1700 + Math.random() * 700, 1.4, 0.16, 'bandpass', o);   // knuckle thud
      this._noise(0.03, 5200, 0.7, 0.06, 'highpass', o);                          // air whip
      this._tone(150 + Math.random() * 40, 80, 0.05, 0.10, 'square', o);          // body of the hit
    };
    punch();
    for (let i = 1; i < 7; i++) setTimeout(punch, i * 52);
  }
  // Stand deflect — a bright metallic ting as a hit is caught.
  standBlock(pos = null) {
    if (!this.ctx) return;
    const o = pos ? this._spatial(pos.x, pos.y, pos.z) : null;
    if (pos && !o) return;
    this._tone(1400, 2100, 0.09, 0.10, 'triangle', o);
    this._tone(2300, 3000, 0.06, 0.05, 'sine', o);
    this._noise(0.05, 3800, 2.4, 0.08, 'highpass', o);
  }
  // Stand summon — a short rising whoosh as the spirit manifests.
  standSummon() {
    if (!this.ctx) return;
    this._tone(220, 720, 0.32, 0.12, 'sawtooth');
    this._tone(140, 360, 0.32, 0.07, 'triangle');
    this._noise(0.3, 900, 1.6, 0.08, 'bandpass');
  }
  // Chakra gathering — a rising swirling hum that ramps up while the orb forms.
  chakraCharge() {
    if (!this.ctx) return;
    this._tone(180, 580, 0.58, 0.12, 'sine');          // rising swell as chakra gathers
    this._tone(120, 290, 0.58, 0.08, 'triangle');      // sub support, rising
    this._tone(270, 860, 0.5, 0.05, 'sine');           // shimmering upper sweep
    this._noise(0.52, 1000, 2.2, 0.07, 'bandpass');    // grinding spin building
  }
  // Chakra fully formed — a bright shimmering ping at peak charge.
  chakraReady() {
    if (!this.ctx) return;
    this._tone(880, 1320, 0.2, 0.14, 'triangle');
    this._tone(1320, 1760, 0.18, 0.08, 'sine');
    this._tone(1760, 2640, 0.14, 0.05, 'sine');        // sparkle top
    this._tone(2640, 3520, 0.1, 0.03, 'sine');         // airy crystalline glint
    this._noise(0.14, 4400, 3.0, 0.06, 'highpass');    // crystalline shimmer
  }

  // ---- Chakra power-up channel: a sustained rising hum (start/ramp/stop) ----
  chakraChannelStart() {
    if (!this.ctx || this._chan) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, t);
    const osc2 = this.ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.setValueAtTime(151.2, t); // slight detune = thickness
    const sub = this.ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(70, t);
    const filt = this.ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.setValueAtTime(550, t); filt.Q.value = 3;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.setTargetAtTime(0.085, t, 0.18);
    osc.connect(filt); osc2.connect(filt); filt.connect(g); sub.connect(g); g.connect(this.master);
    osc.start(); osc2.start(); sub.start();
    this._chan = { osc, osc2, sub, filt, g };
  }
  chakraChannelRamp(frac) {
    if (!this.ctx || !this._chan) return;
    const t = this.ctx.currentTime, f = Math.max(0, Math.min(1, frac));
    this._chan.osc.frequency.setTargetAtTime(150 + f * 560, t, 0.12);
    this._chan.osc2.frequency.setTargetAtTime(151.2 + f * 564, t, 0.12);
    this._chan.filt.frequency.setTargetAtTime(500 + f * 2200, t, 0.12);
    this._chan.g.gain.setTargetAtTime(0.085 + f * 0.04, t, 0.12);   // swells as it nears peak
  }
  chakraChannelStop() {
    if (!this._chan) return;
    const t = this.ctx.currentTime, c = this._chan; this._chan = null;
    c.g.gain.setTargetAtTime(0.0001, t, 0.08);
    c.osc.stop(t + 0.25); c.sub.stop(t + 0.25);
    if (c.osc2) c.osc2.stop(t + 0.25);
  }

  // ---- Laser cannon: one continuous searing beam tone (start/stop), not repeated
  // zaps — a buzzy sawtooth + bright square through a shimmering bandpass. ----
  beamStart() {
    if (!this.ctx || this._beam) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(118, t);
    const osc2 = this.ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.setValueAtTime(740, t);
    const filt = this.ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.setValueAtTime(1700, t); filt.Q.value = 5;
    const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.setValueAtTime(28, t);   // shimmer
    const lfoG = this.ctx.createGain(); lfoG.gain.setValueAtTime(420, t); lfo.connect(lfoG); lfoG.connect(filt.frequency);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.setTargetAtTime(0.06, t, 0.03);   // quick swell in
    osc.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start(); osc2.start(); lfo.start();
    this._beam = { osc, osc2, lfo, g };
  }
  beamStop() {
    if (!this._beam) return;
    const t = this.ctx.currentTime, c = this._beam; this._beam = null;
    c.g.gain.setTargetAtTime(0.0001, t, 0.05);
    c.osc.stop(t + 0.15); c.osc2.stop(t + 0.15); c.lfo.stop(t + 0.15);
  }
  // Power-up shockwave when the chakra peaks.
  chakraBurst() {
    if (!this.ctx) return;
    this._tone(720, 195, 0.34, 0.18, 'sawtooth');
    this._tone(140, 42, 0.4, 0.24, 'square');
    this._tone(1080, 320, 0.16, 0.07, 'sine');         // bright shockfront flash
    this._noise(0.44, 1300, 0.8, 0.26, 'lowpass');
    this._thump(78, 34, 0.52, 0.3);                    // deep concussive boom
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
    // Alternate a touch of pitch/pan feel between left/right steps for a gait.
    this.stepFlip ^= 1;
    const pitch = (0.85 + Math.random() * 0.3) * (this.stepFlip ? 1.04 : 0.96);
    this._noise(m.dur, m.freq * pitch, m.q, m.gain, m.type);
    if (mat === 'wood')   this._tone(165 * pitch, 92, 0.06, 0.06, 'sine');  // hollow thud
    if (mat === 'stone' || mat === 'glass') this._click(m.freq * 1.4, m.gain * 0.4); // hard scuff
    if (mat === 'gravel' || mat === 'sand') this._noise(0.03, m.freq * 1.8, m.q, m.gain * 0.35, m.type); // loose grit
    if (mat === 'grass' || mat === 'dirt' || mat === 'wool') this._thump(88, 58, 0.05, m.gain * 0.5); // soft pad
  }
}
