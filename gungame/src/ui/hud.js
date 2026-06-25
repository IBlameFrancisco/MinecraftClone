// HUD: thin wrapper over the DOM elements in index.html. Knows how to render mode-aware
// score (team vs team, or you-vs-leader for FFA), a match timer / warmup countdown, ammo,
// health, hitmarkers, killfeed and toasts.
export class Hud {
  constructor() {
    this.hpNum = document.getElementById('hpNum');
    this.hpBar = document.getElementById('hpBar');
    this.magNum = document.getElementById('magNum');
    this.resNum = document.getElementById('resNum');
    this.wepName = document.getElementById('wepName');
    this.hitmarker = document.getElementById('hitmarker');
    this.killfeed = document.getElementById('killfeed');
    this.toastEl = document.getElementById('toast');
    this.dmg = document.getElementById('dmg');
    this.scoreEl = document.getElementById('score');
    this.timerEl = document.getElementById('timer');
    this.abEl = [document.getElementById('ab0'), document.getElementById('ab1')];
    this._hmT = 0; this._toastT = 0; this._dmgT = 0;
  }
  setAbilities(abilities) {
    for (let i = 0; i < 2; i++) {
      const el = this.abEl[i]; if (!el) continue;
      const name = abilities.slotName(i);
      el.style.display = name ? 'flex' : 'none';
      el.querySelector('.nm').textContent = name;
    }
  }
  abilityTick(abilities) {
    for (let i = 0; i < 2; i++) {
      const el = this.abEl[i]; if (!el || el.style.display === 'none') continue;
      const f = abilities.cdFrac(i);
      el.querySelector('.cool').style.height = (f * 100) + '%';
      el.classList.toggle('ready', f <= 0);
    }
  }
  setHealth(hp) {
    hp = Math.max(0, Math.round(hp));
    this.hpNum.textContent = hp;
    this.hpBar.style.width = hp + '%';
    this.hpBar.style.background = hp > 50 ? 'linear-gradient(90deg,#2bd47a,#6effa8)' : hp > 25 ? 'linear-gradient(90deg,#e6c12b,#ffe06a)' : 'linear-gradient(90deg,#e63b3b,#ff7a6a)';
  }
  setAmmo(name, mag, reserve) {
    this.wepName.textContent = name;
    this.magNum.textContent = mag == null ? '∞' : mag;
    this.resNum.textContent = reserve == null ? '' : '/ ' + reserve;
  }

  matchStart(match) { this.scoreEl.style.display = 'flex'; if (this.timerEl) this.timerEl.style.display = 'block'; this.matchScore(match); }
  matchScore(match) {
    if (match.mode.teams) {
      const you = match.score('blue'), foe = match.score('red');
      this.scoreEl.innerHTML =
        `<span class="you lbl">BLUE</span><span class="you">${you}</span>` +
        `<span class="vs">${match.mode.scoreLimit}</span>` +
        `<span class="foe">${foe}</span><span class="foe lbl">RED</span>`;
    } else {
      const you = match.score(match.playerTeam);
      const lead = match.standings()[0] || { you: true, score: 0, label: '' };
      const goal = match.mode.ladder ? 'LADDER' : String(match.mode.scoreLimit);
      this.scoreEl.innerHTML =
        `<span class="you lbl">YOU</span><span class="you">${you}</span>` +
        `<span class="vs">${goal}</span>` +
        `<span class="foe">${lead.you ? '—' : lead.score}</span><span class="foe lbl">${lead.you ? 'LEAD' : lead.label}</span>`;
    }
  }
  setTimer(t, warmup) {
    if (!this.timerEl) return;
    if (warmup) { this.timerEl.textContent = t > 0 ? 'GET READY · ' + t : 'GO!'; this.timerEl.style.color = '#ffd24a'; }
    else { const s = Math.max(0, t | 0); this.timerEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); this.timerEl.style.color = s < 30 ? '#ff7a6a' : '#e7ecf3'; }
  }

  hit(head) { this.hitmarker.style.opacity = '1'; this.hitmarker.querySelectorAll('.l').forEach((l) => l.style.background = head ? '#ffd24a' : '#ff5252'); this._hmT = 0.12; }
  hurt() { this.dmg.style.boxShadow = 'inset 0 0 170px rgba(255,30,30,0.55)'; this._dmgT = 0.25; }
  kill(text, color = '#ff7a2f') { const k = document.createElement('div'); k.className = 'k'; k.style.color = color; k.textContent = text; this.killfeed.appendChild(k); setTimeout(() => k.remove(), 3500); }
  toast(text, color = '#ffd24a') { this.toastEl.textContent = text; this.toastEl.style.color = color; this.toastEl.style.opacity = '1'; this._toastT = 1.6; }
  update(dt) {
    if (this._hmT > 0) { this._hmT -= dt; if (this._hmT <= 0) this.hitmarker.style.opacity = '0'; }
    if (this._toastT > 0) { this._toastT -= dt; if (this._toastT <= 0) this.toastEl.style.opacity = '0'; }
    if (this._dmgT > 0) { this._dmgT -= dt; this.dmg.style.boxShadow = `inset 0 0 170px rgba(255,30,30,${0.55 * Math.max(0, this._dmgT / 0.25)})`; }
  }
}
