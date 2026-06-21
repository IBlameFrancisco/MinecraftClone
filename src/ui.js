// HUD overlays that aren't the hotbar/inventory: block-name popup, clock,
// game-mode indicator, survival health/hunger bars, and a damage flash.

export class HUD {
  constructor() {
    this._injectStyles();
    this._buildNameLabel();
    this._buildStatus();
    this._scheduleHintFade();
  }

  _buildNameLabel() {
    const el = document.createElement('div');
    el.id = 'blockname';
    document.getElementById('ui').appendChild(el);
    this.nameLabel = el;
  }

  _buildStatus() {
    const wrap = document.createElement('div');
    wrap.id = 'status';
    wrap.innerHTML = `<canvas id="health" width="200" height="18"></canvas>
                      <canvas id="hunger" width="200" height="18"></canvas>`;
    document.getElementById('ui').appendChild(wrap);
    this.healthCtx = wrap.querySelector('#health').getContext('2d');
    this.hungerCtx = wrap.querySelector('#hunger').getContext('2d');
    this.statusEl = wrap;

    this.modeEl = document.createElement('div');
    this.modeEl.id = 'modeind';
    document.getElementById('ui').appendChild(this.modeEl);

    this.diffEl = document.createElement('div');
    this.diffEl.id = 'diffind';
    document.getElementById('ui').appendChild(this.diffEl);

    this.hurtEl = document.createElement('div');
    this.hurtEl.id = 'hurt';
    document.getElementById('ui').appendChild(this.hurtEl);
  }

  showName(name) {
    this.nameLabel.textContent = name;
    this.nameLabel.style.opacity = '1';
    clearTimeout(this._nameT);
    this._nameT = setTimeout(() => { this.nameLabel.style.opacity = '0'; }, 1100);
  }

  setClock(text) {
    const el = document.getElementById('clock');
    if (el) el.textContent = text;
  }

  setMode(survival) {
    this.modeEl.textContent = survival ? 'Survival' : 'Creative';
    this.modeEl.style.color = survival ? '#ff8f6a' : '#7ad0ff';
    this.statusEl.style.display = survival ? 'flex' : 'none';
    this.diffEl.style.display = survival ? 'block' : 'none';
  }

  setDifficulty(name) {
    this.diffEl.textContent = name;
    this.diffEl.style.color = name === 'Peaceful' ? '#8fe08f' : name === 'Hardcore' ? '#ff5050' : '#ddd';
  }

  setHealth(cur, max = 20) { this._drawIcons(this.healthCtx, cur, max, 'heart'); }
  setHunger(cur, max = 20) { this._drawIcons(this.hungerCtx, cur, max, 'food'); }

  flashHurt() {
    this.hurtEl.style.transition = 'none';
    this.hurtEl.style.opacity = '0.55';
    requestAnimationFrame(() => {
      this.hurtEl.style.transition = 'opacity 0.45s';
      this.hurtEl.style.opacity = '0';
    });
  }

  _drawIcons(ctx, cur, max, type) {
    const n = max / 2;          // 10 icons, each = 2 points
    ctx.clearRect(0, 0, 200, 18);
    for (let i = 0; i < n; i++) {
      const x = i * 18 + 9, y = 9;
      const v = cur - i * 2;     // 2 full, 1 half, <=0 empty
      this._icon(ctx, x, y, '#3a0d10', type);                       // empty background
      if (v >= 2) this._icon(ctx, x, y, type === 'heart' ? '#ff2d3a' : '#e9a23b', type);
      else if (v === 1) { ctx.save(); ctx.beginPath(); ctx.rect(x - 8, 0, 8, 18); ctx.clip();
        this._icon(ctx, x, y, type === 'heart' ? '#ff2d3a' : '#e9a23b', type); ctx.restore(); }
    }
  }

  _icon(ctx, cx, cy, color, type) {
    ctx.fillStyle = color;
    if (type === 'heart') {
      ctx.beginPath();
      ctx.moveTo(cx, cy + 5);
      ctx.bezierCurveTo(cx - 7, cy - 2, cx - 4, cy - 7, cx, cy - 3);
      ctx.bezierCurveTo(cx + 4, cy - 7, cx + 7, cy - 2, cx, cy + 5);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, cy - 1, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - 1.5, cy + 3, 3, 4); // drumstick bone
    }
  }

  _scheduleHintFade() {
    const hint = document.getElementById('hint');
    setTimeout(() => { hint.style.opacity = '0'; }, 16000);
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) {
        hint.style.opacity = '1';
        clearTimeout(this._hintT);
        this._hintT = setTimeout(() => { hint.style.opacity = '0'; }, 9000);
      }
    });
  }

  _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #blockname { position:absolute; left:50%; bottom:84px; transform:translateX(-50%);
        background:rgba(0,0,0,0.4); padding:3px 12px; border-radius:6px; font-size:14px;
        opacity:0; transition:opacity 0.3s; text-shadow:0 1px 2px #000; }
      #status { position:absolute; left:50%; bottom:78px; transform:translateX(-50%);
        display:none; gap:18px; width:430px; justify-content:space-between; pointer-events:none; }
      #status canvas { image-rendering:auto; filter:drop-shadow(0 1px 1px rgba(0,0,0,0.6)); }
      #modeind { position:absolute; right:14px; top:40px; font-size:13px; font-weight:700;
        background:rgba(0,0,0,0.35); padding:4px 10px; border-radius:8px; text-shadow:0 1px 2px #000; }
      #diffind { position:absolute; right:14px; top:70px; font-size:12px; font-weight:700;
        background:rgba(0,0,0,0.30); padding:3px 9px; border-radius:8px; text-shadow:0 1px 2px #000; }
      #hurt { position:absolute; inset:0; pointer-events:none; opacity:0;
        background:radial-gradient(ellipse at center, rgba(120,0,0,0) 40%, rgba(150,0,0,0.85) 100%); }
    `;
    document.head.appendChild(s);
  }
}
