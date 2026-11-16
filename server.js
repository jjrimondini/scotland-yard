'use strict';
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { MAP } = require('./src/map');
const Game = require('./src/game');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

/** token segreto (salvato sul telefono) -> giocatore */
const players = new Map();
let game = null;

// ---------- rete ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback/i.test(name);
      const score = (virtual ? 10 : 0) + (a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : 2);
      out.push({ name, address: a.address, score });
    }
  }
  return out.sort((x, y) => x.score - y.score).map((a) => a.address);
}

// ---------- HTTP ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'phone.html')));
app.get('/board', (req, res) => res.sendFile(path.join(__dirname, 'public', 'board.html')));
app.get('/api/map', (req, res) => res.json(MAP));
app.get('/api/info', async (req, res) => {
  const urls = lanAddresses().map((ip) => `http://${ip}:${PORT}/`);
  const main = urls[0] || `http://localhost:${PORT}/`;
  const qr = await QRCode.toDataURL(main, { margin: 1, width: 320, color: { dark: '#000000', light: '#ffffff' } });
  res.json({ url: main, urls, qr });
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- stato ----------
function lobbyView() {
  return {
    players: [...players.values()]
      .filter((p) => p.name)
      .map((p) => ({ pid: p.pid, name: p.name, role: p.role, connected: p.sockets.size > 0 })),
  };
}

function broadcast() {
  const lobby = lobbyView();
  io.to('board').emit('state', { lobby, game: game ? Game.publicView(game) : null });
  for (const p of players.values()) {
    const payload = {
      lobby,
      you: { pid: p.pid, name: p.name, role: p.role },
      game: game ? Game.privateView(game, p.pid) : null,
    };
    for (const sid of p.sockets) io.to(sid).emit('state', payload);
  }
}

function playerOf(socket) {
  return socket.data.token ? players.get(socket.data.token) : null;
}

const safe = (fn) => (...args) => {
  try {
    fn(...args);
  } catch (err) {
    console.error(err);
    const cb = args.find((a) => typeof a === 'function');
    if (cb) cb({ ok: false, error: 'Errore interno' });
  }
};

io.on('connection', (socket) => {
  socket.on('board:hello', safe(() => {
    socket.join('board');
    socket.emit('state', { lobby: lobbyView(), game: game ? Game.publicView(game) : null });
  }));

  socket.on('hello', safe((data, cb) => {
    let token = data && typeof data.token === 'string' && data.token.length <= 64 ? data.token : null;
    let p = token && players.get(token);
    if (!p) {
      token = token || crypto.randomUUID();
      p = { token, pid: crypto.randomBytes(6).toString('hex'), name: null, role: null, sockets: new Set() };
      players.set(token, p);
    }
    p.sockets.add(socket.id);
    socket.data.token = token;
    if (typeof cb === 'function') cb({ token });
    broadcast();
  }));

  socket.on('join', safe((data, cb) => {
    const p = playerOf(socket);
    if (!p) return cb && cb({ ok: false, error: 'Connessione non pronta' });
    if (game) return cb && cb({ ok: false, error: 'Partita già in corso' });
    const name = String((data && data.name) || '').trim().slice(0, 20);
    const role = data && data.role === 'ghigno' ? 'ghigno' : 'detective';
    if (!name) return cb && cb({ ok: false, error: 'Inserisci un nome' });
    if (role === 'ghigno') {
      const other = [...players.values()].find((q) => q !== p && q.name && q.role === 'ghigno');
      if (other) return cb && cb({ ok: false, error: `Il Ghigno è già ${other.name}` });
    }
    p.name = name;
    p.role = role;
    if (cb) cb({ ok: true });
    broadcast();
  }));

  socket.on('leave', safe((data, cb) => {
    const p = playerOf(socket);
    if (p && !game) {
      p.name = null;
      p.role = null;
    }
    if (typeof cb === 'function') cb({ ok: true });
    broadcast();
  }));

  socket.on('board:kick', safe((pid) => {
    if (game) return;
    for (const p of players.values()) if (p.pid === pid) { p.name = null; p.role = null; }
    broadcast();
  }));

  socket.on('board:start', safe((data, cb) => {
    if (game) return cb && cb({ ok: false, error: 'Partita già in corso' });
    const joined = [...players.values()].filter((p) => p.name);
    const ghigno = joined.find((p) => p.role === 'ghigno');
    const dets = joined.filter((p) => p.role === 'detective');
    if (!ghigno) return cb && cb({ ok: false, error: 'Nessuno ha scelto il Ghigno' });
    if (!dets.length) return cb && cb({ ok: false, error: 'Serve almeno un detective' });
    const n = Math.max(dets.length, Math.min(5, Number(data && data.numDetectives) || 4));
    if (n > 5) return cb && cb({ ok: false, error: 'Massimo 5 detective' });
    const owners = Array.from({ length: n }, (_, i) => dets[i % dets.length]);
    game = Game.createGame({
      ghigno: { pid: ghigno.pid, name: ghigno.name },
      detectives: owners.map((p) => ({ pid: p.pid, name: p.name })),
    });
    console.log(`Partita iniziata: Ghigno = ${ghigno.name}, ${n} detective`);
    if (cb) cb({ ok: true });
    broadcast();
  }));

  socket.on('move', safe((data, cb) => {
    const p = playerOf(socket);
    if (!p || !game) return cb && cb({ ok: false, error: 'Nessuna partita in corso' });
    const pieceId = data && data.pieceId;
    const owner = pieceId === 'G' ? game.ghigno.owner : (game.detectives.find((d) => d.id === pieceId) || {}).owner;
    if (owner !== p.pid) return cb && cb({ ok: false, error: 'Questa pedina non è tua' });
    const res = Game.applyMove(game, {
      pieceId,
      to: Number(data.to),
      ticket: String(data.ticket),
      double: !!data.double,
    });
    if (cb) cb(res);
    if (res.ok) {
      if (game.phase === 'over') console.log(`Fine partita: ${game.winReason}`);
      broadcast();
    }
  }));

  socket.on('board:reset', safe((...args) => {
    const cb = args.find((a) => typeof a === 'function');
    game = null;
    if (typeof cb === 'function') cb({ ok: true });
    broadcast();
  }));

  socket.on('disconnect', () => {
    const p = playerOf(socket);
    if (p) {
      p.sockets.delete(socket.id);
      broadcast();
    }
  });
});

server.listen(PORT, () => {
  const ips = lanAddresses();
  console.log('\n  NERAPOLI — caccia al Ghigno\n');
  console.log(`  Tabellone (apri sul PC):   http://localhost:${PORT}/board`);
  if (ips.length) {
    console.log(`  Telefoni (stessa Wi-Fi):   http://${ips[0]}:${PORT}/`);
    for (const ip of ips.slice(1)) console.log(`                             http://${ip}:${PORT}/`);
  }
  console.log('\n  Se i telefoni non si collegano, consenti Node.js nel firewall di Windows (rete privata).\n');
});
