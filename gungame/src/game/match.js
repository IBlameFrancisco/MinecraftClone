// Match framework: the authoritative-ish game state that owns mode rules, scoring, the
// warmup→live→ended state machine, win/time limits, and difficulty. Rendering-independent
// so it can move server-side later (M3). main.js feeds it kills and drives spawn/reset
// through the onStart/onEnd callbacks.

export const MODES = {
  tdm: { id: 'tdm', name: 'Team Deathmatch', blurb: 'Blue squad vs Red. First team to the cap.', teams: true, scoreLimit: 30, time: 360, roster: { red: 4, blue: 3 } },
  ffa: { id: 'ffa', name: 'Free-for-All', blurb: 'Everyone for themselves. Top frag wins.', teams: false, scoreLimit: 20, time: 300, bots: 6 },
  gun: { id: 'gun', name: 'Gun Game', blurb: 'Each kill bumps your weapon. Finish the ladder first.', teams: false, scoreLimit: 0, time: 420, bots: 6, ladder: true },
};

// Difficulty scales bot reaction time, aim error, accuracy, health and damage dealt.
export const DIFFICULTY = {
  easy:   { id: 'easy',   name: 'Easy',   react: [0.45, 0.75], accuracy: 0.55, aimErr: 0.075, hp: 100, dmgMul: 0.7,  cover: 0.3 },
  normal: { id: 'normal', name: 'Normal', react: [0.22, 0.42], accuracy: 0.72, aimErr: 0.032, hp: 100, dmgMul: 1.0,  cover: 0.6 },
  hard:   { id: 'hard',   name: 'Hard',   react: [0.10, 0.22], accuracy: 0.88, aimErr: 0.014, hp: 120, dmgMul: 1.3,  cover: 0.85 },
};

export class Match {
  constructor({ hud, onStart, onEnd }) {
    this.hud = hud; this.onStart = onStart; this.onEnd = onEnd;
    this.mode = MODES.tdm; this.diff = DIFFICULTY.normal;
    this.state = 'idle';                 // idle | warmup | live | ended
    this.scores = new Map();             // teamKey -> kills
    this.names = new Map();              // teamKey -> display label
    this.playerTeam = 'blue';
    this.warmup = 0; this.timeLeft = 0;
  }

  configure(modeId, diffId) {
    this.mode = MODES[modeId] || MODES.tdm;
    this.diff = DIFFICULTY[diffId] || DIFFICULTY.normal;
  }

  // start a fresh match with the configured mode/difficulty
  begin() {
    this.scores = new Map(); this.names = new Map();
    this.playerTeam = this.mode.teams ? 'blue' : 'you';
    this.names.set(this.playerTeam, this.mode.teams ? 'BLUE' : 'YOU');
    if (this.mode.teams) this.names.set('red', 'RED');
    this.state = 'warmup'; this.warmup = 3.0; this.timeLeft = this.mode.time;
    this.onStart && this.onStart(this.mode, this.diff);     // main builds the roster + spawns
    this.hud.matchStart(this);
  }

  registerTeam(key, label) { if (!this.names.has(key)) this.names.set(key, label); if (!this.scores.has(key)) this.scores.set(key, 0); }
  score(team) { return this.scores.get(team) || 0; }

  // a kill happened: credit `team`. Returns the new score. Only counts while live.
  award(team) {
    if (this.state !== 'live' || team == null) return 0;
    const s = (this.scores.get(team) || 0) + 1;
    this.scores.set(team, s);
    this.hud.matchScore(this);
    if (this.mode.scoreLimit > 0 && s >= this.mode.scoreLimit) this.finish();
    return s;
  }

  // Gun Game: a player/bot finished the weapon ladder → instant win
  ladderWin(team) { if (this.state === 'live') this.finish(team); }

  finish(forceWinner) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    const winner = forceWinner || this.leader();
    this.onEnd && this.onEnd(this, winner);
  }

  // team key with the highest score (ties → player team if tied at top)
  leader() {
    let best = this.playerTeam, bd = -1;
    for (const [t, s] of this.scores) if (s > bd) { bd = s; best = t; }
    return best;
  }

  // sorted [{team,label,score,you}] for the end-screen standings
  standings() {
    const rows = [];
    for (const [t, s] of this.scores) rows.push({ team: t, label: this.names.get(t) || t, score: s, you: t === this.playerTeam });
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  playerWon(winner) {
    if (this.mode.teams) return winner === this.playerTeam;
    return winner === this.playerTeam;
  }

  update(dt) {
    if (this.state === 'warmup') {
      this.warmup -= dt;
      this.hud.setTimer(Math.ceil(this.warmup), true);
      if (this.warmup <= 0) { this.state = 'live'; this.hud.toast('FIGHT!', '#ffd24a'); }
      return;
    }
    if (this.state === 'live') {
      this.timeLeft -= dt;
      this.hud.setTimer(this.timeLeft, false);
      if (this.timeLeft <= 0) this.finish();
    }
  }
}
