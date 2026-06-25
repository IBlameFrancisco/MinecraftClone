// HUD: thin wrapper over the DOM elements in index.html.
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
    this.scoreYou = document.getElementById('scoreYou');
    this.scoreFoe = document.getElementById('scoreFoe');
    this._hmT = 0; this._toastT = 0; this._dmgT = 0;
  }
  setHealth(hp) {
    hp = Math.max(0, Math.round(hp));
    this.hpNum.textContent = hp;
    this.hpBar.style.width = hp + '%';
    this.hpBar.style.background = hp > 50 ? 'linear-gradient(90deg,#2bd47a,#6effa8)' : hp > 25 ? 'linear-gradient(90deg,#e6c12b,#ffe06a)' : 'linear-gradient(90deg,#e63b3b,#ff7a6a)';
  }
  setAmmo(name, mag, reserve) { this.wepName.textContent = name; this.magNum.textContent = mag; this.resNum.textContent = '/ ' + reserve; }
  setScore(you, foe) { this.scoreYou.textContent = you; this.scoreFoe.textContent = foe; }
  hit(head) { this.hitmarker.style.opacity = '1'; this.hitmarker.querySelectorAll('.l').forEach((l) => l.style.background = head ? '#ffd24a' : '#ff5252'); this._hmT = 0.12; }
  hurt() { this.dmg.style.boxShadow = 'inset 0 0 170px rgba(255,30,30,0.55)'; this._dmgT = 0.25; }
  kill(text, color = '#ff7a2f') { const k = document.createElement('div'); k.className = 'k'; k.style.color = color; k.textContent = text; this.killfeed.appendChild(k); setTimeout(() => k.remove(), 3500); }
  toast(text, color = '#ffd24a') { this.toastEl.textContent = text; this.toastEl.style.color = color; this.toastEl.style.opacity = '1'; this._toastT = 1.4; }
  update(dt) {
    if (this._hmT > 0) { this._hmT -= dt; if (this._hmT <= 0) this.hitmarker.style.opacity = '0'; }
    if (this._toastT > 0) { this._toastT -= dt; if (this._toastT <= 0) this.toastEl.style.opacity = '0'; }
    if (this._dmgT > 0) { this._dmgT -= dt; this.dmg.style.boxShadow = `inset 0 0 170px rgba(255,30,30,${0.55 * Math.max(0, this._dmgT / 0.25)})`; }
  }
}
