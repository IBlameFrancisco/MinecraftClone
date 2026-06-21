// Peer-to-peer co-op over WebRTC (PeerJS free cloud signaling). One player hosts
// (their peer id is the room code) and acts as the hub: guests connect to the
// host, receive the world seed + block edits, and the host relays position and
// edit messages between everyone. Mobs run locally per client.

import { Peer } from 'peerjs';
import * as THREE from 'three';

const PREFIX = 'guncraft-';

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

function makeAvatar(name, color) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.y = y; g.add(m); return m; };
  box(0.6, 0.7, 0.35, color, 1.15);        // body
  box(0.5, 0.5, 0.5, 0xe8b89a, 1.75);      // head
  box(0.22, 0.75, 0.25, color, 1.5).position.x = -0.4;
  box(0.22, 0.75, 0.25, color, 1.5).position.x = 0.4;
  box(0.24, 0.8, 0.26, 0x2c3e8c, 0.4).position.x = -0.16;
  box(0.24, 0.8, 0.26, 0x2c3e8c, 0.4).position.x = 0.16;
  g.add(nameSprite(name));
  return g;
}

export class Multiplayer {
  constructor(scene) {
    this.scene = scene;
    this.peer = null;
    this.conns = new Map();      // peerId -> DataConnection
    this.remotes = new Map();    // peerId -> { group, target }
    this.isHost = false;
    this.online = false;
    this.myId = null;
    this.name = 'Player';
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
    conn.on('close', () => { this.conns.delete(conn.peer); this._removeRemote(conn.peer); });
  }

  _onData(conn, d) {
    switch (d.t) {
      case 'init': this.handlers.onInit(d); break;
      case 'hello': if (this.isHost) this._relay(conn.peer, d); break;
      case 'pos': this._updateRemote(d.id, d); if (this.isHost) this._relay(conn.peer, d); break;
      case 'edit': this.handlers.onEdit(d.x, d.y, d.z, d.id); if (this.isHost) this._relay(conn.peer, d); break;
      case 'edits': for (const e of d.list) this.handlers.onEdit(e[0], e[1], e[2], e[3]); if (this.isHost) this._relay(conn.peer, d); break;
      case 'leave': this._removeRemote(d.id); if (this.isHost) this._relay(conn.peer, d); break;
    }
  }

  _relay(from, d) { for (const [pid, c] of this.conns) if (pid !== from) c.send(d); }
  broadcast(d) { for (const c of this.conns.values()) c.send(d); }

  sendPos(p) {
    if (!this.online) return;
    const now = performance.now();
    if (now - this._lastPos < 50) return;          // ~20 Hz
    this._lastPos = now;
    this.broadcast({ t: 'pos', id: this.myId, name: this.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
  }
  sendEdit(x, y, z, id) { if (this.online) this.broadcast({ t: 'edit', x, y, z, id }); }
  sendEdits(list) { if (this.online && list.length) this.broadcast({ t: 'edits', list }); }

  _updateRemote(id, d) {
    if (!id || id === this.myId) return;
    let r = this.remotes.get(id);
    if (!r) { r = { group: makeAvatar(d.name || 'Player', 0x3a86ff) }; this.group.add(r.group); this.remotes.set(id, r); }
    r.target = { x: d.x, y: d.y, z: d.z, yaw: d.yaw };
  }
  _removeRemote(id) {
    const r = this.remotes.get(id);
    if (r) { this.group.remove(r.group); r.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.remotes.delete(id); }
  }

  update(dt) {
    const k = Math.min(1, 10 * dt);
    for (const r of this.remotes.values()) {
      if (!r.target) continue;
      r.group.position.x += (r.target.x - r.group.position.x) * k;
      r.group.position.y += (r.target.y - r.group.position.y) * k;
      r.group.position.z += (r.target.z - r.group.position.z) * k;
      r.group.rotation.y += (r.target.yaw - r.group.rotation.y) * k;
    }
  }

  get playerCount() { return this.remotes.size + (this.online ? 1 : 0); }
}
