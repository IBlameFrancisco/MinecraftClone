// GunGame multiplayer server — a lightweight room that syncs players over WebSocket.
//
// This is the multiplayer FOUNDATION: clients own their own movement and broadcast state at
// ~20 Hz; the server relays state + combat events to everyone else and tracks the roster
// and team scores. It is intentionally a relay (not yet fully authoritative): the next step
// toward production is to move the sim (src/game + movement + hit validation) server-side
// with client prediction + lag compensation, which this message protocol is shaped for.
//
// Run:  cd server && npm install && npm start   (PORT env optional, default 8787)
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8787;
const TICK = 1000 / 20;
const wss = new WebSocketServer({ port: PORT });

let nextId = 1;
const players = new Map();           // id -> { ws, state, alive }
const scores = { red: 0, blue: 0 };

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, exceptId) { const s = JSON.stringify(obj); for (const [id, p] of players) if (id !== exceptId && p.ws.readyState === 1) p.ws.send(s); }
function roster() { return [...players.values()].map((p) => p.state); }

wss.on('connection', (ws) => {
  const id = nextId++;
  const team = id % 2 === 0 ? 'blue' : 'red';                 // simple team balance
  const state = { id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, team, name: 'Player ' + id, hp: 100, w: 'rifle', alive: true };
  players.set(id, { ws, state });
  send(ws, { t: 'welcome', id, team, players: roster().filter((s) => s.id !== id), scores });
  broadcast({ t: 'join', player: state }, id);
  console.log(`+ player ${id} (${team}) — ${players.size} online`);

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    const p = players.get(id); if (!p) return;
    switch (m.t) {
      case 'state': Object.assign(p.state, m.s, { id, team: p.state.team }); break;   // batched out on the tick
      case 'shoot': broadcast({ t: 'shoot', id, o: m.o, d: m.d, w: m.w }, id); break;
      case 'hit': { const tgt = players.get(m.id); if (tgt) send(tgt.ws, { t: 'hit', dmg: m.dmg, by: id }); break; }
      case 'kill': { const killer = players.get(id); if (killer) { scores[killer.state.team]++; broadcast({ t: 'score', scores }, null); broadcast({ t: 'kill', by: id, victim: m.id }, null); } break; }
      case 'name': p.state.name = String(m.name || p.state.name).slice(0, 16); break;
      case 'respawn': Object.assign(p.state, { x: m.x, y: m.y, z: m.z, hp: 100, alive: true }); break;
    }
  });

  ws.on('close', () => { players.delete(id); broadcast({ t: 'leave', id }, null); console.log(`- player ${id} — ${players.size} online`); });
  ws.on('error', () => {});
});

// 20 Hz snapshot of everyone's state to everyone
setInterval(() => {
  if (!players.size) return;
  const snap = roster();
  for (const [, p] of players) send(p.ws, { t: 'snap', players: snap });
}, TICK);

console.log(`GunGame server listening on ws://localhost:${PORT}`);
