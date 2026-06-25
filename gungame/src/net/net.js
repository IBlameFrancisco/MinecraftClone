// Browser-side multiplayer client. Connects to the room server, broadcasts the local
// player's state at ~20 Hz, and renders/interpolates remote players as character avatars.
// Combat events (shots) are relayed for tracers; hits/kills route through callbacks. This
// is the foundation layer — interpolation only (no prediction/lag-comp yet).
import * as THREE from 'three';
import { makeCharacter } from '../models/character.js';

export class Net {
  constructor(url) {
    this.url = url; this.ws = null; this.id = null; this.team = 'red';
    this.remotes = new Map(); this.scene = null; this.connected = false;
    this.onShoot = null; this.onHit = null; this.onScore = null; this.onKill = null;
    this._sendT = 0;
  }

  connect(scene) {
    this.scene = scene;
    return new Promise((res, rej) => {
      let done = false;
      try { this.ws = new WebSocket(this.url); } catch (e) { return rej(e); }
      this.ws.onopen = () => { this.connected = true; done = true; res(); };
      this.ws.onerror = (e) => { if (!done) rej(e); };
      this.ws.onclose = () => { this.connected = false; };
      this.ws.onmessage = (ev) => { try { this._msg(JSON.parse(ev.data)); } catch {} };
      setTimeout(() => { if (!done) rej(new Error('connect timeout')); }, 4000);
    });
  }

  _ensure(s) {
    let r = this.remotes.get(s.id);
    if (!r) {
      const group = makeCharacter({ team: s.team, uniform: s.team === 'blue' ? 0x42588e : 0x9a4a42 });
      group.userData.netId = s.id; this.scene.add(group);
      r = { state: { ...s }, target: { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, group, t: 0 };
      this.remotes.set(s.id, r);
    }
    return r;
  }
  _remove(id) { const r = this.remotes.get(id); if (r) { this.scene.remove(r.group); this.remotes.delete(id); } }

  _msg(m) {
    switch (m.t) {
      case 'welcome': this.id = m.id; this.team = m.team; for (const s of m.players) this._ensure(s); this.onScore && this.onScore(m.scores); break;
      case 'join': this._ensure(m.player); break;
      case 'leave': this._remove(m.id); break;
      case 'snap':
        for (const s of m.players) {
          if (s.id === this.id) continue;
          const r = this._ensure(s); r.target = { x: s.x, y: s.y, z: s.z, yaw: s.yaw }; r.state.hp = s.hp; r.state.alive = s.alive; r.group.visible = !!s.alive;
        }
        break;
      case 'shoot': this.onShoot && this.onShoot(m.o, m.d, m.w, m.id); break;
      case 'hit': this.onHit && this.onHit(m.dmg, m.by); break;
      case 'score': this.onScore && this.onScore(m.scores); break;
      case 'kill': this.onKill && this.onKill(m.by, m.victim); break;
    }
  }

  sendState(s, dt) { this._sendT += dt; if (!this.connected || this._sendT < 0.05) return; this._sendT = 0; this.ws.send(JSON.stringify({ t: 'state', s })); }
  shoot(o, d, w) { if (this.connected) this.ws.send(JSON.stringify({ t: 'shoot', o, d, w })); }
  hit(id, dmg) { if (this.connected) this.ws.send(JSON.stringify({ t: 'hit', id, dmg })); }
  kill(id) { if (this.connected) this.ws.send(JSON.stringify({ t: 'kill', id })); }

  update(dt) {
    for (const [, r] of this.remotes) {
      const k = Math.min(1, 12 * dt);
      const g = r.group;
      const before = g.position.x, beforez = g.position.z;
      g.position.x += (r.target.x - g.position.x) * k;
      g.position.y += (r.target.y - g.position.y) * k;
      g.position.z += (r.target.z - g.position.z) * k;
      let dy = r.target.yaw - g.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      g.rotation.y += dy * k;
      const moving = Math.hypot(g.position.x - before, g.position.z - beforez) > 0.004;
      r.t += dt; if (g.userData.anim) g.userData.anim({ moving, speed: 0.6, t: r.t }, dt, r.t);
    }
  }

  remoteGroups() { return [...this.remotes.values()].filter((r) => r.state.alive !== false).map((r) => r.group); }
  remoteById(id) { return this.remotes.get(id); }
  disconnect() { for (const id of [...this.remotes.keys()]) this._remove(id); if (this.ws) this.ws.close(); this.connected = false; }
}
