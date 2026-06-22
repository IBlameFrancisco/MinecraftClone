// Peer-to-peer co-op over WebRTC (PeerJS free cloud signaling). One player hosts
// (their peer id is the room code) and acts as the hub: guests connect to the
// host, receive the world seed + block edits, and the host relays position and
// edit messages between everyone. Mobs run locally per client.

import { Peer } from 'peerjs';
import * as THREE from 'three';
import { rayAABB } from './physics.js';
import { getSkin, DEFAULT_SKIN } from './skins.js';
import { makeHeldWeapon } from './guns.js';

const PREFIX = 'guncraft-';

// Remote-avatar hitbox (relative to the avatar group origin, which sits at the
// player's feet). Used for PvP ray/AoE tests. AV_HEAD is the headshot threshold.
const AV_HALF = 0.42, AV_TOP = 2.05, AV_MID = 1.05, AV_HEAD = 1.5;

function nameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(name, 128, 42);
  g.fillStyle = '#fff'; g.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(2.2, 0.55, 1);
  spr.position.y = 2.3;
  return spr;
}

// Re-tint only the team-coloured meshes (shirt / sleeves / pants) of an avatar,
// leaving skin, hair, eyes and hats alone.
function tintAvatarColor(group, color) {
  group.traverse((o) => { if (o.isMesh && o.userData.tintable && o.material && o.material.color) o.material.color.setHex(color); });
}
function darken(hex, f = 0.7) {
  const c = new THREE.Color(hex); c.multiplyScalar(f); return c.getHex();
}

// Build a blocky avatar from a skin descriptor. `shirtOverride` (a colour) forces
// the shirt/sleeves/pants — used to team-colour bots while keeping their features.
export function makeAvatar(name, skin, shirtOverride) {
  if (typeof skin === 'number') skin = { skin: 0xe8b89a, hair: 0x4a3526, hairStyle: 'short', eye: 0x303030, shirt: skin, pants: darken(skin, 0.6) };
  else if (!skin) skin = getSkin();
  const shirt = shirtOverride != null ? shirtOverride : skin.shirt;
  const pants = shirtOverride != null ? darken(shirtOverride, 0.7) : skin.pants;

  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const add = (w, h, d, c, x, y, z, tint) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z); if (tint) m.userData.tintable = true; g.add(m); return m;
  };
  add(0.6, 0.7, 0.35, shirt, 0, 1.15, 0, true);            // torso
  add(0.5, 0.5, 0.5, skin.skin, 0, 1.75, 0);               // head
  // eyes (front +z)
  for (const ex of [-0.12, 0.12]) { add(0.1, 0.1, 0.04, 0xffffff, ex, 1.8, 0.25); add(0.055, 0.07, 0.05, skin.eye, ex, 1.79, 0.27); }
  // hair
  if (skin.hairStyle === 'long') {
    add(0.56, 0.16, 0.56, skin.hair, 0, 2.0, 0); add(0.5, 0.5, 0.12, skin.hair, 0, 1.72, -0.24);
    add(0.12, 0.55, 0.5, skin.hair, -0.3, 1.6, 0); add(0.12, 0.55, 0.5, skin.hair, 0.3, 1.6, 0);
  } else if (skin.hairStyle === 'short') {
    add(0.54, 0.14, 0.54, skin.hair, 0, 2.0, 0); add(0.54, 0.26, 0.12, skin.hair, 0, 1.84, -0.22);
  }
  if (skin.mustache) add(0.28, 0.07, 0.05, 0x241a10, 0, 1.66, 0.25);
  if (skin.hat === 'sombrero') { add(1.15, 0.07, 1.15, 0xd9b25a, 0, 2.06, 0); add(0.52, 0.36, 0.52, 0xc99a3e, 0, 2.26, 0); }
  else if (skin.hat === 'cap') { add(0.55, 0.18, 0.55, skin.hatColor || 0x303030, 0, 2.02, 0); add(0.42, 0.07, 0.3, skin.hatColor || 0x303030, 0, 1.99, 0.34); }
  else if (skin.hat === 'beanie') { add(0.57, 0.28, 0.57, skin.hatColor || 0x884444, 0, 2.03, 0); }
  else if (skin.hat === 'helmet') { const hc = skin.hatColor || 0x4a4f30; add(0.58, 0.22, 0.58, hc, 0, 2.03, 0); add(0.66, 0.06, 0.66, darken(hc, 0.8), 0, 1.93, 0); }  // steel helmet (dome + brim)
  add(0.22, 0.62, 0.25, shirt, -0.41, 1.56, 0, true);      // arms (sleeves)
  add(0.22, 0.62, 0.25, shirt, 0.41, 1.56, 0, true);
  add(0.22, 0.16, 0.25, skin.skin, -0.41, 1.17, 0);        // hands
  add(0.22, 0.16, 0.25, skin.skin, 0.41, 1.17, 0);
  add(0.24, 0.8, 0.26, pants, -0.16, 0.4, 0, true);        // legs
  add(0.24, 0.8, 0.26, pants, 0.16, 0.4, 0, true);
  g.add(nameSprite(name));
  if (skin.scale && skin.scale !== 1) g.scale.setScalar(skin.scale);
  return g;
}

export class Multiplayer {
  constructor(scene) {
    this.scene = scene;
    this.peer = null;
    this.conns = new Map();      // peerId -> DataConnection
    this.remotes = new Map();    // peerId -> { group, target } (avatars)
    this.roster = new Map();     // peerId -> name (for the player list)
    this.isHost = false;
    this.online = false;
    this.myId = null;
    this.name = 'Player';
    this.skin = DEFAULT_SKIN;
    this.handlers = {};
    this.group = new THREE.Group();
    scene.add(this.group);
    this._lastPos = 0;
  }

  host(code, name, handlers) {
    this.handlers = handlers; this.isHost = true; this.name = name; this.roomCode = code;
    this.peer = new Peer(PREFIX + code);
    this.peer.on('open', () => { this.myId = this.peer.id; this.online = true; handlers.onStatus?.(`Hosting — room code: ${code}`); });
    this.peer.on('connection', (conn) => this._setup(conn, true));
    this.peer.on('error', (e) => handlers.onStatus?.('Network error: ' + e.type));
  }

  join(code, name, handlers) {
    this.handlers = handlers; this.isHost = false; this.name = name; this.roomCode = code;
    this.peer = new Peer();
    this.peer.on('open', () => {
      this.myId = this.peer.id;
      handlers.onStatus?.('Connecting…');
      const conn = this.peer.connect(PREFIX + code, { reliable: true });
      this._setup(conn, false);
    });
    this.peer.on('error', (e) => handlers.onStatus?.('Network error: ' + e.type));
  }

  _setup(conn, incoming) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.online = true;
      if (this.isHost && incoming) {
        conn.send({ t: 'init', ...this.handlers.getInit(), hostName: this.name });
        this.handlers.onStatus?.('A player joined');
      } else {
        conn.send({ t: 'hello', id: this.myId, name: this.name });
      }
    });
    conn.on('data', (d) => this._onData(conn, d));
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this._roster(conn.peer, null);
      this._removeRemote(conn.peer);
      // Star topology: tell the other guests to drop this peer's avatar + roster entry.
      if (this.isHost) this._relay(conn.peer, { t: 'leave', id: conn.peer });
    });
  }

  _roster(id, name) {
    if (!id || id === this.myId) return;
    if (name) {
      if (!this.roster.has(id)) { this.roster.set(id, name); this.handlers.onSystem?.(`${name} joined`); this.handlers.onRoster?.(); }
      else if (this.roster.get(id) !== name) { this.roster.set(id, name); this.handlers.onRoster?.(); }
    } else if (this.roster.has(id)) {
      const n = this.roster.get(id); this.roster.delete(id);
      this.handlers.onSystem?.(`${n} left`); this.handlers.onRoster?.();
    }
  }

  _onData(conn, d) {
    switch (d.t) {
      case 'init': this._roster(conn.peer, d.hostName || 'Host'); this.handlers.onInit(d); break;
      case 'hello': this._roster(d.id, d.name); if (this.isHost) this._relay(conn.peer, d); break;
      case 'pos': this._roster(d.id, d.name); this._updateRemote(d.id, d); if (this.isHost) this._relay(conn.peer, d); break;
      case 'edit': this.handlers.onEdit(d.x, d.y, d.z, d.id); if (this.isHost) this._relay(conn.peer, d); break;
      case 'edits': for (const e of d.list) this.handlers.onEdit(e[0], e[1], e[2], e[3]); if (this.isHost) this._relay(conn.peer, d); break;
      case 'chat': this.handlers.onChat?.(d.name, d.text); if (this.isHost) this._relay(conn.peer, d); break;
      case 'hit':
        if (d.target === this.myId) this.handlers.onHit?.(d.dmg, d.fromName);
        else if (this.isHost && String(d.target).startsWith('bot:')) this.handlers.onBotHit?.(d.target, d.dmg, d.fromName, d.head);
        if (this.isHost) this._relay(conn.peer, d);
        break;
      case 'death':
        this.handlers.onKillFeed?.(d.name, d.by);
        if (this.isHost) { this.handlers.onDeathAuthority?.(d.by, d.id); this._relay(conn.peer, d); }
        break;
      case 'pfire': this.handlers.onPlayerFire?.(d); if (this.isHost) this._relay(conn.peer, d); break;   // a remote player's shot (visual)
      case 'bpos': this._syncBots(d.bots); break;     // host → guests
      case 'bfire': this.handlers.onBotFire?.(d); break;
      case 'board': this.handlers.onBoard?.(d); break;
      case 'roundover': this.handlers.onRoundOver?.(d.winner); break;
      case 'roundreset': this.handlers.onRoundReset?.(); break;
      case 'leave': this._roster(d.id, null); this._removeRemote(d.id); if (this.isHost) this._relay(conn.peer, d); break;
    }
  }

  sendChat(text) {
    if (!this.online || !text) return;
    this.handlers.onChat?.(this.name, text);      // local echo
    this.broadcast({ t: 'chat', name: this.name, text });
  }

  playerList() {
    const list = [{ name: this.name, you: true }];
    for (const name of this.roster.values()) list.push({ name });
    return list;
  }

  _relay(from, d) { for (const [pid, c] of this.conns) if (pid !== from) c.send(d); }
  broadcast(d) { for (const c of this.conns.values()) c.send(d); }

  setSkin(id) { this.skin = id; }
  sendPos(p) {
    if (!this.online) return;
    const now = performance.now();
    if (now - this._lastPos < 50) return;          // ~20 Hz
    this._lastPos = now;
    this.broadcast({ t: 'pos', id: this.myId, name: this.name, skin: this.skin, x: p.x, y: p.y, z: p.z, yaw: p.yaw, alive: p.alive !== false, wep: p.wep | 0 });
  }
  sendEdit(x, y, z, id) { if (this.online) this.broadcast({ t: 'edit', x, y, z, id }); }
  sendEdits(list) { if (this.online && list.length) this.broadcast({ t: 'edits', list }); }

  // PvP: tell a peer it took damage (each client owns its own health). Routed via
  // the host relay, so it works whether shooter and target are host or guests.
  sendHit(target, dmg, head, fromName = this.name) {
    if (this.online && dmg > 0) this.broadcast({ t: 'hit', target, dmg, head: !!head, from: this.myId, fromName });
  }
  sendDeath(by) { if (this.online) this.broadcast({ t: 'death', id: this.myId, name: this.name, by: by || null }); }

  _rayHitAvatar(origin, dir, g, maxDist) {
    return rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      g.position.x - AV_HALF, g.position.y, g.position.z - AV_HALF,
      g.position.x + AV_HALF, g.position.y + AV_TOP, g.position.z + AV_HALF);
  }

  // Nearest remote player hit by a ray → { id, name, dist, head }, or null.
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const [id, r] of this.remotes) {
      if (!r.group.visible) continue;
      const t = this._rayHitAvatar(origin, dir, r.group, bestT);
      if (t < bestT) { bestT = t; best = id; }
    }
    if (!best) return null;
    const g = this.remotes.get(best).group;
    const head = (origin.y + dir.y * bestT) >= g.position.y + AV_HEAD;
    return { id: best, name: this.roster.get(best) || 'Player', dist: bestT, head };
  }

  // Every remote player a (piercing) ray passes through → [{ id, name, dist, head }].
  raycastAll(origin, dir, maxDist) {
    const out = [];
    for (const [id, r] of this.remotes) {
      if (!r.group.visible) continue;
      const t = this._rayHitAvatar(origin, dir, r.group, maxDist);
      if (t <= maxDist) {
        const head = (origin.y + dir.y * t) >= r.group.position.y + AV_HEAD;
        out.push({ id, name: this.roster.get(id) || 'Player', dist: t, head });
      }
    }
    return out;
  }

  // Remote players within `radius` of a world point (for splash damage) →
  // [{ id, dist }]. Torso-centred.
  playersNear(point, radius) {
    const out = [];
    for (const [id, r] of this.remotes) {
      const g = r.group;
      if (!g.visible) continue;                        // skip dead / spectating players (consistent with raycast)
      const d = Math.hypot(g.position.x - point.x, g.position.y + AV_MID - point.y, g.position.z - point.z);
      if (d < radius) out.push({ id, dist: d });
    }
    return out;
  }

  _updateRemote(id, d) {
    if (!id || id === this.myId) return;
    let r = this.remotes.get(id);
    if (!r) { r = { group: makeAvatar(d.name || 'Player', getSkin(d.skin)) }; this.group.add(r.group); this.remotes.set(id, r); }
    r.target = { x: d.x, y: d.y, z: d.z, yaw: d.yaw };
    r.group.visible = d.alive !== false;          // hide dead/spectating players (mirrors _updateBot)
    this._setHeldWeapon(r, d.wep | 0);
  }

  // Show the gun/jutsu a remote player is holding in their hand (rebuild on change).
  _setHeldWeapon(r, wep) {
    if (r.wep === wep) return;
    r.wep = wep;
    if (r.weapon) { r.group.remove(r.weapon); r.weapon.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); }); r.weapon = null; }
    if (wep) { try { r.weapon = makeHeldWeapon(wep); r.group.add(r.weapon); } catch { r.weapon = null; } }
  }

  // Guest-side bot avatar (driven by the host's 'bpos'); team-coloured, hidden when dead.
  _updateBot(d) {
    let r = this.remotes.get(d.id);
    if (!r) {
      const color = this.handlers.botColor ? this.handlers.botColor(d.team) : 0xff5b5b;
      r = { group: makeAvatar(d.name, getSkin(d.skin), color), bot: true, team: d.team };
      this.group.add(r.group); this.remotes.set(d.id, r);
    }
    r.target = { x: d.x, y: d.y, z: d.z, yaw: d.yaw };
    r.group.visible = d.alive !== false;
  }
  // Apply a full bot snapshot from the host and prune avatars for bots it no longer
  // reports (cleared/replaced across matches or mode changes) so they don't ghost.
  _syncBots(bots) {
    const live = new Set();
    for (const bd of bots) { live.add(bd.id); this._updateBot(bd); }
    const stale = [];
    for (const [id, r] of this.remotes) if (r.bot && !live.has(id)) stale.push(id);
    for (const id of stale) this._removeRemote(id);
  }
  recolorBots(colorFn) { for (const r of this.remotes.values()) if (r.bot) tintAvatarColor(r.group, colorFn(r.team)); }
  _removeRemote(id) {
    const r = this.remotes.get(id);
    if (r) {
      this.group.remove(r.group);
      r.group.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
        else if (o.isSprite && o.material) { o.material.map?.dispose(); o.material.dispose(); }   // name-tag texture
      });
      this.remotes.delete(id);
    }
  }

  update(dt) {
    const k = Math.min(1, 10 * dt);
    this._t = (this._t || 0) + dt;
    for (const r of this.remotes.values()) {
      if (!r.target) continue;
      r.group.position.x += (r.target.x - r.group.position.x) * k;
      r.group.position.y += (r.target.y - r.group.position.y) * k;
      r.group.position.z += (r.target.z - r.group.position.z) * k;
      // A player's forward is (-sin yaw, -cos yaw) but the avatar faces +Z, so a
      // human avatar must turn yaw+π to face where they look (bots already use the
      // +Z/atan2 convention). Lerp along the shortest arc so it never spins around.
      const faceYaw = r.target.yaw + (r.bot ? 0 : Math.PI);
      let dy = faceYaw - r.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.group.rotation.y += dy * k;
      if (r.weapon && r.weapon.userData.chakraAnim) r.weapon.userData.chakraAnim(0.7, dt, this._t);   // spin the held jutsu orb
    }
  }

  get playerCount() { let n = 0; for (const r of this.remotes.values()) if (!r.bot) n++; return n + (this.online ? 1 : 0); }
}
