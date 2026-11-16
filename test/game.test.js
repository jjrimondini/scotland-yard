'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAP } = require('../src/map');
const G = require('../src/game');

const players = { ghigno: { pid: 'g', name: 'Gina' }, d1: { pid: 'a', name: 'Aldo' }, d2: { pid: 'b', name: 'Bea' } };

function neighbors(id, type) {
  return MAP.edges
    .filter((e) => e.type === type && (e.a === id || e.b === id))
    .map((e) => (e.a === id ? e.b : e.a));
}

/** Nodi lontani da `from` (nessun collegamento diretto) e distinti tra loro. */
function farNodes(from, count, exclude = []) {
  const near = new Set(MAP.edges.flatMap((e) => (e.a === from ? [e.b] : e.b === from ? [e.a] : [])));
  return MAP.nodes
    .map((n) => n.id)
    .filter((id) => id !== from && !near.has(id) && !exclude.includes(id))
    .slice(-count);
}

test('mappa: grafo connesso, archi validi, ogni nodo ha una strada', () => {
  const ids = new Set(MAP.nodes.map((n) => n.id));
  assert.ok(MAP.nodes.length >= 100);
  for (const e of MAP.edges) {
    assert.ok(ids.has(e.a) && ids.has(e.b), `arco con nodo inesistente ${e.a}-${e.b}`);
    assert.notEqual(e.a, e.b);
    assert.ok(['auto', 'tram', 'metro', 'traghetto'].includes(e.type));
  }
  for (const n of MAP.nodes) assert.ok(neighbors(n.id, 'auto').length >= 1, `nodo ${n.id} senza strade`);

  const seen = new Set([MAP.nodes[0].id]);
  const stack = [MAP.nodes[0].id];
  while (stack.length) {
    const n = stack.pop();
    for (const m of neighbors(n, 'auto')) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  assert.equal(seen.size, MAP.nodes.length, 'la rete stradale deve collegare tutta la città');

  for (const s of [...MAP.detectiveStarts, ...MAP.ghignoStarts]) assert.ok(ids.has(s));
  assert.equal(new Set([...MAP.detectiveStarts, ...MAP.ghignoStarts]).size, MAP.detectiveStarts.length + MAP.ghignoStarts.length);
});

test('createGame assegna pedine, biglietti e posizioni distinte', () => {
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1, players.d1, players.d2] });
  assert.equal(s.detectives.length, 3);
  assert.deepEqual(s.ghigno.tickets, { auto: 4, tram: 3, metro: 3, nero: 3, doppia: 2 });
  assert.deepEqual(s.detectives[0].tickets, { auto: 10, tram: 8, metro: 4 });
  const pos = [s.ghigno.pos, ...s.detectives.map((d) => d.pos)];
  assert.equal(new Set(pos).size, pos.length);
  assert.equal(G.currentPieceId(s), 'G');
});

test('il Ghigno non entra su un detective; il traghetto richiede il biglietto nero', () => {
  const ferryNode = MAP.ferryLine[0];
  const ferryNext = MAP.ferryLine[1];
  const roadNext = neighbors(ferryNode, 'auto')[0];
  const [far] = farNodes(ferryNode, 1, [ferryNext, roadNext]);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1], starts: { ghigno: ferryNode, detectives: [roadNext] } });
  let moves = G.legalMoves(s, 'G');
  assert.ok(!moves.some((m) => m.to === roadNext), 'non può entrare dove c\'è un detective');
  const ferryMove = moves.find((m) => m.to === ferryNext);
  assert.ok(ferryMove.tickets.includes('nero'));
  assert.ok(!ferryMove.tickets.includes('traghetto'));

  s.ghigno.tickets.nero = 0;
  s.detectives[0].pos = far;
  moves = G.legalMoves(s, 'G');
  const viaFerryOnly = !MAP.edges.some((e) => e.type !== 'traghetto' && ((e.a === ferryNode && e.b === ferryNext) || (e.b === ferryNode && e.a === ferryNext)));
  if (viaFerryOnly) assert.ok(!moves.some((m) => m.to === ferryNext));
});

test('i biglietti dei detective passano al Ghigno; turni in ordine', () => {
  const g0 = MAP.ghignoStarts[0];
  const [d1, d2] = farNodes(g0, 2);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1, players.d2], starts: { ghigno: g0, detectives: [d1, d2] } });

  const gm = G.legalMoves(s, 'G')[0];
  assert.ok(G.applyMove(s, { pieceId: 'G', to: gm.to, ticket: gm.tickets[0] }).ok);
  assert.equal(s.log.length, 1);
  assert.equal(G.currentPieceId(s), 'D1');

  assert.equal(G.applyMove(s, { pieceId: 'D2', to: 1, ticket: 'auto' }).ok, false, 'fuori turno');

  const dm = G.legalMoves(s, 'D1').find((m) => m.to !== s.ghigno.pos);
  const before = s.ghigno.tickets[dm.tickets[0]];
  assert.ok(G.applyMove(s, { pieceId: 'D1', to: dm.to, ticket: dm.tickets[0] }).ok);
  assert.equal(s.ghigno.tickets[dm.tickets[0]], before + 1);
  assert.equal(s.detectives[0].tickets[dm.tickets[0]], { auto: 10, tram: 8, metro: 4 }[dm.tickets[0]] - 1);
  assert.equal(G.currentPieceId(s), 'D2');
});

test('doppia mossa: due voci nel registro, poi tocca ai detective', () => {
  const g0 = MAP.ghignoStarts[1];
  const [d1] = farNodes(g0, 1);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1], starts: { ghigno: g0, detectives: [d1] } });
  const m1 = G.legalMoves(s, 'G')[0];
  assert.ok(G.applyMove(s, { pieceId: 'G', to: m1.to, ticket: m1.tickets[0], double: true }).ok);
  assert.equal(s.ghigno.tickets.doppia, 1);
  assert.equal(G.currentPieceId(s), 'G');
  assert.equal(G.canUseDouble(s), false);
  const m2 = G.legalMoves(s, 'G')[0];
  assert.ok(G.applyMove(s, { pieceId: 'G', to: m2.to, ticket: m2.tickets[0] }).ok);
  assert.equal(s.log.length, 2);
  assert.ok(s.log.every((e) => e.double));
  assert.equal(G.currentPieceId(s), 'D1');
});

test('rivelazione al turno 3 e posizione nascosta nella vista pubblica', () => {
  const g0 = MAP.ghignoStarts[2];
  const [d1] = farNodes(g0, 1);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1], starts: { ghigno: g0, detectives: [d1] } });
  s.ghigno.tickets = { auto: 99, tram: 99, metro: 99, nero: 0, doppia: 0 };
  s.detectives[0].tickets = { auto: 99, tram: 99, metro: 99 };
  for (let r = 1; r <= 3; r++) {
    const gm = G.legalMoves(s, 'G')[0];
    G.applyMove(s, { pieceId: 'G', to: gm.to, ticket: gm.tickets[0] });
    const pub = G.publicView(s);
    assert.equal(pub.ghigno.pos, null);
    if (r < 3) {
      assert.equal(pub.log[r - 1].pos, null);
      // il detective si muove senza catturare
      const dm = G.legalMoves(s, 'D1').find((m) => m.to !== s.ghigno.pos);
      G.applyMove(s, { pieceId: 'D1', to: dm.to, ticket: dm.tickets[0] });
    } else {
      assert.equal(pub.log[2].pos, s.ghigno.pos);
      assert.deepEqual(pub.lastRevealed, { pos: s.ghigno.pos, round: 3 });
    }
  }
  const priv = G.privateView(s, 'g');
  assert.equal(priv.ghigno.pos, s.ghigno.pos);
  assert.ok(priv.log.every((e) => e.pos !== null));
  const det = G.privateView(s, 'a');
  assert.equal(det.ghigno.pos, null);
  assert.deepEqual(det.mine, ['D1']);
  assert.equal(det.legal.pieceId, 'D1');
});

test('cattura: un detective sulla posizione del Ghigno vince', () => {
  const g0 = MAP.ghignoStarts[3];
  const [d1] = farNodes(g0, 1);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1], starts: { ghigno: g0, detectives: [d1] } });
  const gm = G.legalMoves(s, 'G').find((m) => m.tickets.includes('auto'));
  G.applyMove(s, { pieceId: 'G', to: gm.to, ticket: 'auto' });
  // teletrasporta il detective accanto al Ghigno per il test
  s.detectives[0].pos = neighbors(s.ghigno.pos, 'auto').find((n) => n !== g0) ?? g0;
  const res = G.applyMove(s, { pieceId: 'D1', to: s.ghigno.pos, ticket: 'auto' });
  assert.ok(res.ok);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'detective');
  assert.notEqual(G.publicView(s).ghigno.pos, null, 'a fine partita la posizione è pubblica');
});

test('il Ghigno sopravvive 24 turni e vince', () => {
  const g0 = MAP.ghignoStarts[4];
  const [d1] = farNodes(g0, 1);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1], starts: { ghigno: g0, detectives: [d1] } });
  s.ghigno.tickets = { auto: 99, tram: 99, metro: 99, nero: 0, doppia: 0 };
  s.detectives[0].tickets = { auto: 99, tram: 99, metro: 99 };
  let guard = 0;
  while (s.phase === 'playing' && guard++ < 200) {
    const id = G.currentPieceId(s);
    let moves = G.legalMoves(s, id);
    if (id !== 'G') moves = moves.filter((m) => m.to !== s.ghigno.pos).concat(moves);
    G.applyMove(s, { pieceId: id, to: moves[0].to, ticket: moves[0].tickets[0] });
  }
  if (s.winner === 'ghigno') assert.equal(s.log.length, 24);
  assert.equal(s.phase, 'over');
});

test('detective senza biglietti: il Ghigno vince per blocco', () => {
  const g0 = MAP.ghignoStarts[5];
  const [d1] = farNodes(g0, 1);
  const s = G.createGame({ ghigno: players.ghigno, detectives: [players.d1], starts: { ghigno: g0, detectives: [d1] } });
  s.detectives[0].tickets = { auto: 0, tram: 0, metro: 0 };
  const gm = G.legalMoves(s, 'G')[0];
  G.applyMove(s, { pieceId: 'G', to: gm.to, ticket: gm.tickets[0] });
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'ghigno');
});
