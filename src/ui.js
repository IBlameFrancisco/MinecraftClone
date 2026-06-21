// HUD overlays that aren't the hotbar/inventory: block-name popup, clock,
// game-mode indicator, survival health/hunger bars, and a damage flash.

export class HUD {
  constructor() {
    this._injectStyles();
    this._buildNameLabel();
    this._buildStatus();
    this._buildChat();
    this._scheduleHintFade();
    this.onChatSend = () => {};
  }

  _buildChat() {
    const ui = document.getElementById('ui');
    this.chatLog = document.createElement('div'); this.chatLog.id = 'chatlog';
    this.chatInput = document.createElement('input'); this.chatInput.id = 'chatinput';
    this.chatInput.maxLength = 100; this.chatInput.placeholder = 'Say something…';
    this.chatInput.autocomplete = 'off';
    this.playerList = document.createElement('div'); this.playerList.id = 'playerlist';
    this.ammoEl = document.createElement('div'); this.ammoEl.id = 'ammo';
    this.killFeed = document.createElement('div'); this.killFeed.id = 'killfeed';
    this.hitEl = document.createElement('div'); this.hitEl.id = 'hitmarker';
    ui.appendChild(this.chatLog); ui.appendChild(this.chatInput);
    ui.appendChild(this.playerList); ui.appendChild(this.ammoEl);
    ui.appendChild(this.killFeed); ui.appendChild(this.hitEl);
    this.chatOpen = false;

    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const t = this.chatInput.value.trim();
        this.chatInput.value = '';
        this.closeChat();
        if (t) this.onChatSend(t);
      } else if (e.code === 'Escape') {
        this.chatInput.value = ''; this.closeChat();
      }
    });
  }

  openChat() { this.chatOpen = true; this.chatInput.style.display = 'block'; this.chatInput.focus(); }
  closeChat() { this.chatOpen = false; this.chatInput.style.display = 'none'; this.chatInput.blur(); }
  isChatOpen() { return this.chatOpen; }

  addChat(name, text, system) {
    const line = document.createElement('div');
    line.className = 'chatline';
    if (system) line.innerHTML = `<span class="sys">✦ ${escapeHtml(text)}</span>`;
    else line.innerHTML = `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 10) this.chatLog.removeChild(this.chatLog.firstChild);
    setTimeout(() => { line.classList.add('fade'); }, 9000);
  }

  setPlayers(list) {
    if (!list || list.length <= 1) { this.playerList.style.display = 'none'; return; }
    this.playerList.style.display = 'block';
    this.playerList.innerHTML = `<div class="pltitle">Players (${list.length})</div>` +
      list.map((p) => `<div class="plrow">${escapeHtml(p.name)}${p.you ? ' <span class="you">(you)</span>' : ''}</div>`).join('');
  }

  setAmmo(text) {
    if (!text) { this.ammoEl.style.display = 'none'; return; }
    this.ammoEl.style.display = 'block';
    this.ammoEl.innerHTML = text;
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
    this.healthCanvasEl = wrap.querySelector('#health');
    this.hungerCanvasEl = wrap.querySelector('#hunger');
    this.healthCtx = this.healthCanvasEl.getContext('2d');
    this.hungerCtx = this.hungerCanvasEl.getContext('2d');
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
    this.hungerCanvasEl.style.display = '';
    this.diffEl.style.display = survival ? 'block' : 'none';
  }

  // Battle mode: show health only (no hunger / difficulty), red "Battle" badge.
  setBattle(on) {
    if (!on) return;
    this.modeEl.textContent = '⚔ Battle';
    this.modeEl.style.color = '#ff5b6e';
    this.statusEl.style.display = 'flex';
    this.hungerCanvasEl.style.display = 'none';
    this.diffEl.style.display = 'none';
  }

  // PvP kill feed (top-right): "Killer ☠ Victim", auto-fading.
  addKill(victim, killer) {
    const line = document.createElement('div');
    line.className = 'kfline';
    line.innerHTML = killer
      ? `<span class="kf-k">${escapeHtml(killer)}</span> <span class="kf-s">☠</span> <span class="kf-v">${escapeHtml(victim)}</span>`
      : `<span class="kf-v">${escapeHtml(victim)}</span> <span class="kf-s">fell</span>`;
    this.killFeed.appendChild(line);
    while (this.killFeed.children.length > 5) this.killFeed.removeChild(this.killFeed.firstChild);
    setTimeout(() => line.classList.add('fade'), 4200);
    setTimeout(() => { if (line.parentNode) line.remove(); }, 5400);
  }

  // Brief crosshair confirmation when you land a hit (gold + bigger on a headshot).
  hitMarker(head) {
    this.hitEl.classList.toggle('head', !!head);
    this.hitEl.style.transition = 'none';
    this.hitEl.style.opacity = '1';
    this.hitEl.style.transform = `translate(-50%, -50%) scale(${head ? 1.6 : 1.25})`;
    requestAnimationFrame(() => {
      this.hitEl.style.transition = 'opacity 0.3s, transform 0.3s';
      this.hitEl.style.opacity = '0';
      this.hitEl.style.transform = 'translate(-50%, -50%) scale(1)';
    });
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
      #chatlog { position:absolute; left:14px; bottom:110px; max-width:380px; font-size:13px; line-height:1.5; }
      .chatline { background:rgba(0,0,0,0.42); padding:2px 8px; border-radius:5px; margin-top:3px; width:fit-content;
        text-shadow:0 1px 2px #000; transition:opacity 1s; }
      .chatline.fade { opacity:0; }
      .chatline .sys { color:#9fd0ff; font-style:italic; }
      #chatinput { display:none; position:absolute; left:14px; bottom:80px; width:380px; padding:8px 10px;
        font-size:14px; border-radius:7px; border:1px solid rgba(255,255,255,0.3); background:rgba(0,0,0,0.6);
        color:#fff; outline:none; pointer-events:auto; }
      #playerlist { display:none; position:absolute; right:14px; top:100px; min-width:120px;
        background:rgba(0,0,0,0.4); border-radius:8px; padding:6px 10px; font-size:13px; text-shadow:0 1px 2px #000; }
      #playerlist .pltitle { font-weight:700; opacity:0.7; font-size:11px; text-transform:uppercase; margin-bottom:3px; }
      #playerlist .you { opacity:0.6; }
      #ammo { display:none; position:absolute; right:18px; bottom:78px; font-size:24px; font-weight:800;
        font-family:monospace; text-shadow:0 2px 4px #000; }
      #ammo .rl { font-size:13px; color:#ffcf6a; }
      #ammo .inf { color:#9fe0ff; }
      #killfeed { position:absolute; right:14px; top:150px; display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
      .kfline { background:rgba(0,0,0,0.45); padding:3px 9px; border-radius:5px; font-size:13px;
        text-shadow:0 1px 2px #000; transition:opacity 0.9s; border-left:3px solid #ff5b6e; }
      .kfline.fade { opacity:0; }
      .kfline .kf-k { font-weight:800; color:#ffd86b; }
      .kfline .kf-v { font-weight:700; color:#ff8f8f; }
      .kfline .kf-s { opacity:0.85; margin:0 2px; }
      #hitmarker { position:absolute; left:50%; top:50%; width:22px; height:22px;
        transform:translate(-50%,-50%); opacity:0; pointer-events:none; mix-blend-mode:screen; }
      #hitmarker::before, #hitmarker::after { content:''; position:absolute; left:50%; top:50%; width:2px; height:9px;
        background:#fff; box-shadow:0 0 4px #fff; }
      #hitmarker::before { transform:translate(-50%,-50%) rotate(45deg); }
      #hitmarker::after  { transform:translate(-50%,-50%) rotate(-45deg); }
      #hitmarker.head::before, #hitmarker.head::after { background:#ffd23a; box-shadow:0 0 6px #ffb02a; }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
