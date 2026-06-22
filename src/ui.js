// HUD overlays that aren't the hotbar/inventory: block-name popup, clock,
// game-mode indicator, survival health/hunger bars, and a damage flash.

export class HUD {
  constructor() {
    this._injectStyles();
    this._buildNameLabel();
    this._buildStatus();
    this._buildChat();
    this._buildBattle();
    this._scheduleHintFade();
    this.onChatSend = () => {};
  }

  _buildBattle() {
    const ui = document.getElementById('ui');
    this.sbEl = document.createElement('div'); this.sbEl.id = 'scoreboard';
    this.roEl = document.createElement('div'); this.roEl.id = 'roundover';
    this.radarEl = document.createElement('canvas'); this.radarEl.id = 'radar'; this.radarEl.width = 144; this.radarEl.height = 144;
    this.radarCtx = this.radarEl.getContext('2d');
    this.modeInfoEl = document.createElement('div'); this.modeInfoEl.id = 'modeinfo';
    ui.appendChild(this.modeInfoEl);
    this.announceEl = document.createElement('div'); this.announceEl.id = 'announce';
    this.dmgDirEl = document.createElement('div'); this.dmgDirEl.id = 'dmgdir'; this.dmgDirEl.innerHTML = '<div class="wedge"></div>';
    this.precogEl = document.createElement('div'); this.precogEl.id = 'precog';
    this.precogEl.innerHTML = '<div class="precog-tag">三 SHARINGAN · PRECOGNITION</div>';
    ui.appendChild(this.precogEl);
    this.kcEl = document.createElement('div'); this.kcEl.id = 'killcam';
    this.kcEl.innerHTML = '<div class="kc-bar kc-top"></div><div class="kc-bar kc-bot"></div>'
      + '<div class="kc-label"><div class="kc-tag">★ FINAL KILL</div><div class="kc-line"></div></div>';
    ui.appendChild(this.sbEl); ui.appendChild(this.roEl); ui.appendChild(this.radarEl);
    ui.appendChild(this.announceEl); ui.appendChild(this.dmgDirEl); ui.appendChild(this.kcEl);
  }

  // Cinematic final-kill cam overlay: letterbox bars slide in + a "FINAL KILL" tag
  // and, during a replay, a "REPLAY n/N" angle counter.
  showKillCam(killer, victim, pass, passes) {
    const tag = this.kcEl.querySelector('.kc-tag');
    tag.textContent = (pass && passes) ? `★ FINAL KILL · REPLAY ${pass}/${passes}` : '★ FINAL KILL';
    const line = this.kcEl.querySelector('.kc-line');
    line.innerHTML = victim
      ? `<b>${escapeHtml(killer)}</b> <span class="kc-arrow">▸</span> ${escapeHtml(victim)}`
      : `<b>${escapeHtml(killer)}</b> takes the win`;
    if (!this.kcEl.classList.contains('show')) {   // only replay the slide-in on first show, not per angle
      void this.kcEl.offsetWidth;
      this.kcEl.style.display = 'block';
      this.kcEl.classList.add('show');
    }
  }
  hideKillCam() { this.kcEl.classList.remove('show'); this.kcEl.style.display = 'none'; }

  // Sharingan Precognition: a red-rimmed bullet-time overlay.
  setPrecog(on) { if (this.precogEl) this.precogEl.classList.toggle('show', !!on); }

  // Big fading announcer banner (First Blood, multikills, round win…). Queued so two
  // banners fired in the same frame (e.g. multikill + killstreak) both show in turn
  // instead of the second silently clobbering the first.
  announce(text, color) {
    (this._annQ || (this._annQ = [])).push({ text, color: color || '#ffe27a' });
    if (!this._annActive) this._annNext();
  }
  _annNext() {
    if (!this._annQ || !this._annQ.length) { this._annActive = false; return; }
    this._annActive = true;
    const { text, color } = this._annQ.shift();
    this.announceEl.textContent = text;
    this.announceEl.style.color = color;
    this.announceEl.style.transition = 'none';
    this.announceEl.style.opacity = '1';
    this.announceEl.style.transform = 'translateX(-50%) scale(1.15)';
    requestAnimationFrame(() => {
      this.announceEl.style.transition = 'opacity 1.2s, transform 0.5s';
      this.announceEl.style.opacity = '0';
      this.announceEl.style.transform = 'translateX(-50%) scale(1)';
    });
    clearTimeout(this._annTimer);
    this._annTimer = setTimeout(() => this._annNext(), this._annQ.length ? 850 : 1300);
  }

  // Red wedge pointing toward where damage came from (relative to facing).
  showDamageDir(relAngle) {
    this.dmgDirEl.style.transform = `rotate(${relAngle}rad)`;
    const w = this.dmgDirEl.firstChild;
    w.style.transition = 'none'; w.style.opacity = '0.85';
    requestAnimationFrame(() => { w.style.transition = 'opacity 0.7s'; w.style.opacity = '0'; });
  }

  showRadar(on) { this.radarEl.style.display = on ? 'block' : 'none'; }
  drawRadar(blips) {
    const ctx = this.radarCtx, S = 144, R = S / 2, rad = R - 4;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(R, R, rad, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(R, R, rad, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(R, R, rad / 2, 0, 7); ctx.stroke();
    for (const b of blips) {
      const x = R + b.rx * rad, y = R - b.ry * rad;
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    }
    // the player (an arrow pointing up = facing)
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(R, R - 6); ctx.lineTo(R - 4, R + 4); ctx.lineTo(R + 4, R + 4); ctx.closePath(); ctx.fill();
  }

  setScoreboard(board, teamMode, scoreLimit, myTeam, teamInfo) {
    this._board = board; this._teamMode = teamMode; this._scoreLimit = scoreLimit; this._myTeam = myTeam; this._teamInfo = teamInfo || null;
    if (this.sbEl.style.display === 'block') this._renderScoreboard();
  }
  showScoreboard() { this.sbEl.style.display = 'block'; this._renderScoreboard(); }
  hideScoreboard() { this.sbEl.style.display = 'none'; }
  _renderScoreboard() {
    const b = this._board || [];
    let html = '';
    if (this._teamMode) {
      const red = b.filter((e) => e.team === 0), blue = b.filter((e) => e.team === 1);
      const sum = (a) => a.reduce((s, e) => s + e.kills, 0);
      const ti = this._teamInfo;
      html += `<div class="sbtitle">${ti ? ti.title : `Teams · ${this._scoreLimit} to win`}</div>`;
      html += this._teamBlock(ti ? ti.red : 'Red Team', red, sum(red), ti ? ti.redColor : '#ff6b6b');
      html += this._teamBlock(ti ? ti.blue : 'Blue Team', blue, sum(blue), ti ? ti.blueColor : '#6b9cff');
    } else {
      const sorted = [...b].sort((a, c) => c.kills - a.kills);
      html += `<div class="sbtitle">Free-for-all · ${this._scoreLimit} kills to win</div>`;
      html += `<table class="sbtable"><tr><th>Player</th><th>K</th><th>D</th></tr>${sorted.map((e) => this._sbRow(e)).join('')}</table>`;
    }
    this.sbEl.innerHTML = html;
  }
  _teamBlock(name, arr, score, color) {
    const sorted = [...arr].sort((a, c) => c.kills - a.kills);
    return `<div class="sbteamhdr" style="color:${color}">${name} — ${score}</div>` +
      `<table class="sbtable">${sorted.map((e) => this._sbRow(e)).join('')}</table>`;
  }
  _sbRow(e) {
    return `<tr class="${e.you ? 'sbyou' : ''}"><td>${e.bot ? '🤖 ' : ''}${escapeHtml(e.name)}${e.you ? ' (you)' : ''}</td><td>${e.kills}</td><td>${e.deaths}</td></tr>`;
  }
  showRoundOver(winner) {
    this.roEl.style.display = 'flex';
    this.roEl.innerHTML = `<div class="rocard"><div class="rowin">${escapeHtml(winner || 'Nobody')} wins!</div><div class="rosub">Next round starting…</div></div>`;
  }
  hideRoundOver() { this.roEl.style.display = 'none'; }
  setModeInfo(text) { this.modeInfoEl.style.display = text ? 'block' : 'none'; this.modeInfoEl.textContent = text || ''; }
  setGrenades(n) {
    if (!this.nadeEl) { this.nadeEl = document.createElement('div'); this.nadeEl.id = 'nades'; document.getElementById('ui').appendChild(this.nadeEl); }
    this.nadeEl.style.display = n > 0 ? 'block' : 'none';
    this.nadeEl.innerHTML = `💣 <b>${n}</b> <span>(G)</span>`;
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

    // Chakra gauge (battle/creative): a blue bar just above the status row. Parented
    // to #ui (not #status) so it shows in Creative too and never rides the menu.
    this.chakraEl = document.createElement('div');
    this.chakraEl.id = 'chakrabar';
    this.chakraEl.style.cssText = 'display:none;position:absolute;left:50%;bottom:100px;transform:translateX(-50%);width:230px;height:11px;border-radius:6px;background:rgba(10,20,40,0.55);box-shadow:inset 0 0 3px rgba(0,0,0,0.6);overflow:hidden;pointer-events:none;z-index:6;';
    this.chakraEl.innerHTML = '<div class="cfill" style="height:100%;width:100%;border-radius:6px;background:linear-gradient(90deg,#1f6dd0,#6fc8ff);transition:width 0.08s linear;"></div><span class="clabel" style="position:absolute;left:9px;top:0px;font:700 9px sans-serif;color:#d6ecff;text-shadow:0 1px 2px #000;letter-spacing:1px;line-height:11px;">CHAKRA</span>';
    document.getElementById('ui').appendChild(this.chakraEl);
    this.chakraFill = this.chakraEl.querySelector('.cfill');

    // Full-screen chakra aura glow (blue edges) while channelling.
    this.chakraAuraEl = document.createElement('div');
    this.chakraAuraEl.id = 'chakra-aura';
    this.chakraAuraEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 0.12s;z-index:8;mix-blend-mode:screen;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 38%,rgba(60,150,255,0.28) 80%,rgba(120,200,255,0.55) 100%);';
    document.getElementById('ui').appendChild(this.chakraAuraEl);
  }

  // Show/hide the chakra gauge (battle + creative — where jutsu are usable).
  setChakraVisible(on) { if (this.chakraEl) this.chakraEl.style.display = on ? 'block' : 'none'; if (!on) this.setChakraAura(0); }
  // frac 0..1; `full` adds a bright pulse glow.
  setChakra(frac, full) {
    if (!this.chakraFill) return;
    this.chakraFill.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    this.chakraFill.style.boxShadow = full ? '0 0 8px #8fd0ff, 0 0 14px #4aa3ff' : 'none';
  }
  // Channel aura overlay intensity 0..1.
  setChakraAura(intensity) { if (this.chakraAuraEl) this.chakraAuraEl.style.opacity = String(Math.max(0, Math.min(1, intensity))); }
  // Hide the health/hunger row (e.g. returning to the home menu).
  hideStatus() { if (this.statusEl) this.statusEl.style.display = 'none'; }

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
    this.onHitSound && this.onHitSound(!!head);
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
    cur = Math.max(0, Math.min(max, cur || 0));   // guard fractional / over-max / NaN
    const n = max / 2;          // 10 icons, each = 2 points
    ctx.clearRect(0, 0, 200, 18);
    for (let i = 0; i < n; i++) {
      const x = i * 18 + 9, y = 9;
      const v = cur - i * 2;     // 2 full, 1 half, <=0 empty
      this._icon(ctx, x, y, '#3a0d10', type);                       // empty background
      if (v >= 2) this._icon(ctx, x, y, type === 'heart' ? '#ff2d3a' : '#e9a23b', type);
      else if (v >= 1) { ctx.save(); ctx.beginPath(); ctx.rect(x - 8, 0, 8, 18); ctx.clip();
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
      #nades { display:none; position:absolute; right:18px; bottom:118px; font-size:16px; font-weight:700;
        text-shadow:0 2px 4px #000; }
      #nades span { opacity:0.5; font-size:12px; }
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
      #scoreboard { display:none; position:absolute; left:50%; top:80px; transform:translateX(-50%); min-width:340px; max-width:460px;
        background:rgba(8,12,22,0.82); border:1px solid rgba(255,255,255,0.14); border-radius:12px; padding:14px 18px;
        text-shadow:0 1px 2px #000; box-shadow:0 18px 50px rgba(0,0,0,0.6); }
      #scoreboard .sbtitle { text-align:center; font-size:13px; opacity:0.7; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
      #scoreboard .sbteamhdr { font-weight:800; font-size:15px; margin:8px 0 4px; }
      #scoreboard .sbtable { width:100%; border-collapse:collapse; font-size:14px; }
      #scoreboard .sbtable th { text-align:left; font-size:11px; opacity:0.55; font-weight:600; padding:2px 6px; }
      #scoreboard .sbtable th:not(:first-child), #scoreboard .sbtable td:not(:first-child) { text-align:center; width:38px; }
      #scoreboard .sbtable td { padding:3px 6px; border-top:1px solid rgba(255,255,255,0.07); }
      #scoreboard .sbyou td { color:#ffe27a; font-weight:700; }
      #roundover { display:none; position:absolute; inset:0; align-items:center; justify-content:center; pointer-events:none; z-index:22; }
      #roundover .rocard { text-align:center; background:rgba(8,12,22,0.7); padding:30px 50px; border-radius:18px;
        border:1px solid rgba(255,255,255,0.14); box-shadow:0 24px 70px rgba(0,0,0,0.6); }
      #roundover .rowin { font-size:40px; font-weight:900; letter-spacing:1px; background:linear-gradient(180deg,#ffe08a,#ff8f3a);
        -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
      #roundover .rosub { margin-top:8px; font-size:15px; opacity:0.8; }
      #radar { display:none; position:absolute; left:14px; bottom:14px; width:144px; height:144px;
        filter:drop-shadow(0 3px 8px rgba(0,0,0,0.6)); }
      #modeinfo { display:none; position:absolute; left:50%; top:48px; transform:translateX(-50%); font-size:14px; font-weight:700;
        background:rgba(0,0,0,0.4); padding:5px 14px; border-radius:9px; text-shadow:0 1px 2px #000; letter-spacing:0.4px; }
      #announce { position:absolute; left:50%; top:24%; transform:translateX(-50%); opacity:0; pointer-events:none;
        font-size:38px; font-weight:900; letter-spacing:2px; text-transform:uppercase; white-space:nowrap;
        text-shadow:0 2px 10px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.5); }
      #dmgdir { position:absolute; left:50%; top:50%; width:0; height:0; pointer-events:none; }
      #dmgdir .wedge { position:absolute; left:-110px; top:-185px; width:220px; height:80px; opacity:0;
        background:radial-gradient(ellipse at 50% 100%, rgba(255,45,45,0.85) 0%, rgba(255,45,45,0) 72%); }
      #killcam { display:none; position:absolute; inset:0; pointer-events:none; z-index:21; overflow:hidden; }
      #killcam .kc-bar { position:absolute; left:0; right:0; height:11vh; background:#000;
        box-shadow:0 0 40px rgba(0,0,0,0.9); transition:transform 0.45s cubic-bezier(.2,.7,.2,1); }
      #killcam .kc-top { top:0; transform:translateY(-100%); }
      #killcam .kc-bot { bottom:0; transform:translateY(100%); }
      #killcam.show .kc-top, #killcam.show .kc-bot { transform:translateY(0); }
      #killcam .kc-label { position:absolute; left:50%; top:13vh; transform:translate(-50%,-14px);
        text-align:center; opacity:0; transition:opacity 0.5s 0.25s, transform 0.5s 0.25s; }
      #killcam.show .kc-label { opacity:1; transform:translate(-50%,0); }
      #killcam .kc-tag { font-size:15px; font-weight:900; letter-spacing:4px; color:#ff5b5b;
        text-transform:uppercase; text-shadow:0 0 14px rgba(255,60,60,0.7), 0 2px 4px #000; }
      #killcam .kc-line { margin-top:6px; font-size:30px; font-weight:800; letter-spacing:1px; color:#fff;
        text-shadow:0 2px 10px rgba(0,0,0,0.9); }
      #killcam .kc-line b { background:linear-gradient(180deg,#ffe08a,#ff8f3a); -webkit-background-clip:text;
        background-clip:text; -webkit-text-fill-color:transparent; }
      #killcam .kc-arrow { color:#ff6a6a; margin:0 4px; }
      #precog { display:none; position:absolute; inset:0; pointer-events:none; z-index:18; opacity:0;
        transition:opacity 0.3s; box-shadow:inset 0 0 200px 30px rgba(200,12,28,0.42), inset 0 0 60px rgba(255,40,60,0.3);
        background:radial-gradient(ellipse at 50% 50%, rgba(255,0,20,0) 52%, rgba(150,0,16,0.28) 100%); }
      #precog.show { display:block; opacity:1; }
      #precog .precog-tag { position:absolute; left:50%; top:7%; transform:translateX(-50%); color:#ff3142;
        font-size:13px; font-weight:900; letter-spacing:3px; text-shadow:0 0 12px rgba(255,40,60,0.8), 0 2px 4px #000; }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
