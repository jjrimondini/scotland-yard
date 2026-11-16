'use strict';
/*
 * Logica di gioco pura (nessuna dipendenza da rete).
 * Lo stato è un oggetto serializzabile; applyMove lo modifica in place.
 */
const { MAP } = require('./map');

const MAX_ROUNDS = 24;
const REVEAL_ROUNDS = [3, 8, 13, 18, 24];
const DETECTIVE_TICKETS = { auto: 10, tram: 8, metro: 4 };
const GHIGNO_TICKETS = { auto: 4, tram: 3, metro: 3 };
const DOUBLE_MOVES = 2;
const DETECTIVE_STYLES = [
  { name: 'Detective Rosso', color: '#ff4d4d' },
  { name: 'Detective Blu', color: '#4da3ff' },
  { name: 'Detective Bianco', color: '#f0f0f0' },
  { name: 'Detective Arancio', color: '#ff9f1c' },
  { name: 'Detective Viola', color: '#b26bff' },
];

const adjacencyCache = new WeakMap();
function adjacency(map) {
  if (adjacencyCache.has(map)) return adjacencyCache.get(map);
  const adj = new Map(map.nodes.map((n) => [n.id, []]));
  for (const e of map.edges) {
    adj.get(e.a).push({ to: e.b, type: e.type });
    adj.get(e.b).push({ to: e.a, type: e.type });
  }
  adjacencyCache.set(map, adj);
  return adj;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {object} opts
 * @param {{pid:string,name:string}} opts.ghigno  giocatore che controlla il Ghigno
 * @param {{pid:string,name:string}[]} opts.detectives  un elemento per pedina detective (lo stesso giocatore può ripetersi)
 * @param {{ghigno:number, detectives:number[]}} [opts.starts]  posizioni iniziali forzate (per i test)
 */
function createGame({ ghigno, detectives, starts, rng = Math.random, map = MAP }) {
  if (!ghigno) throw new Error('Serve un giocatore per il Ghigno');
  if (!detectives.length || detectives.length > DETECTIVE_STYLES.length) {
    throw new Error(`Servono da 1 a ${DETECTIVE_STYLES.length} detective`);
  }
  const detPos = starts ? starts.detectives : shuffle(map.detectiveStarts, rng).slice(0, detectives.length);
  const ghignoPos = starts ? starts.ghigno : shuffle(map.ghignoStarts, rng)[0];

  return {
    phase: 'playing',
    mapName: map.name,
    ghigno: {
      id: 'G',
      owner: ghigno.pid,
      ownerName: ghigno.name,
      pos: ghignoPos,
      tickets: { ...GHIGNO_TICKETS, nero: detectives.length, doppia: DOUBLE_MOVES },
    },
    detectives: detectives.map((p, i) => ({
      id: `D${i + 1}`,
      owner: p.pid,
      ownerName: p.name,
      name: DETECTIVE_STYLES[i].name,
      color: DETECTIVE_STYLES[i].color,
      pos: detPos[i],
      tickets: { ...DETECTIVE_TICKETS },
    })),
    turn: { who: 'ghigno', index: -1 },
    doubleStep: 0, // 0 = mossa normale, 2 = il Ghigno deve fare la seconda metà di una doppia mossa
    log: [],
    lastRevealed: null,
    winner: null,
    winReason: '',
    moveCount: 0,
  };
}

function currentPieceId(state) {
  if (state.phase !== 'playing') return null;
  return state.turn.who === 'ghigno' ? 'G' : state.detectives[state.turn.index].id;
}

function pieceById(state, id) {
  return id === 'G' ? state.ghigno : state.detectives.find((d) => d.id === id);
}

/** Mosse legali per una pedina: [{to, tickets:[...]}] */
function legalMoves(state, pieceId, map = MAP) {
  const adj = adjacency(map);
  const piece = pieceById(state, pieceId);
  if (!piece) return [];
  const byTarget = new Map();
  const add = (to, ticket) => {
    if (!byTarget.has(to)) byTarget.set(to, new Set());
    byTarget.get(to).add(ticket);
  };

  if (pieceId === 'G') {
    const occupied = new Set(state.detectives.map((d) => d.pos));
    for (const e of adj.get(piece.pos)) {
      if (occupied.has(e.to)) continue;
      if (e.type !== 'traghetto' && piece.tickets[e.type] > 0) add(e.to, e.type);
      if (piece.tickets.nero > 0) add(e.to, 'nero');
    }
  } else {
    const occupied = new Set(state.detectives.filter((d) => d.id !== pieceId).map((d) => d.pos));
    for (const e of adj.get(piece.pos)) {
      if (e.type === 'traghetto' || occupied.has(e.to)) continue;
      if (piece.tickets[e.type] > 0) add(e.to, e.type);
    }
  }

  const order = ['auto', 'tram', 'metro', 'nero'];
  return [...byTarget.entries()]
    .map(([to, set]) => ({ to, tickets: order.filter((t) => set.has(t)) }))
    .sort((a, b) => a.to - b.to);
}

function canUseDouble(state) {
  return (
    state.phase === 'playing' &&
    state.turn.who === 'ghigno' &&
    state.doubleStep === 0 &&
    state.ghigno.tickets.doppia > 0 &&
    state.log.length <= MAX_ROUNDS - 2
  );
}

function endGame(state, winner, reason) {
  state.phase = 'over';
  state.winner = winner;
  state.winReason = reason;
  state.turn = { who: null, index: -1 };
}

/** Passa al primo detective (da startIndex) che può muoversi, altrimenti chiude il round. */
function advanceDetectives(state, startIndex, map) {
  if (startIndex === 0 && state.detectives.every((d) => legalMoves(state, d.id, map).length === 0)) {
    endGame(state, 'ghigno', 'Tutti i detective sono bloccati: il Ghigno è libero!');
    return;
  }
  for (let i = startIndex; i < state.detectives.length; i++) {
    if (legalMoves(state, state.detectives[i].id, map).length > 0) {
      state.turn = { who: 'detective', index: i };
      return;
    }
  }
  // fine del round
  if (state.log.length >= MAX_ROUNDS) {
    endGame(state, 'ghigno', `Il Ghigno è sfuggito per ${MAX_ROUNDS} turni ed è scomparso nella notte!`);
    return;
  }
  state.turn = { who: 'ghigno', index: -1 };
  if (legalMoves(state, 'G', map).length === 0) {
    endGame(state, 'detective', 'Il Ghigno è circondato e non può più muoversi!');
  }
}

/**
 * Applica una mossa. move = {pieceId, to, ticket, double?}
 * Ritorna {ok:true} oppure {ok:false, error}.
 */
function applyMove(state, move, map = MAP) {
  if (state.phase !== 'playing') return { ok: false, error: 'La partita non è in corso' };
  const { pieceId, to, ticket } = move;
  if (pieceId !== currentPieceId(state)) return { ok: false, error: 'Non è il turno di questa pedina' };

  const legal = legalMoves(state, pieceId, map).find((m) => m.to === to);
  if (!legal || !legal.tickets.includes(ticket)) return { ok: false, error: 'Mossa non valida' };

  if (pieceId === 'G') {
    const g = state.ghigno;
    let isDouble = state.doubleStep > 0;
    if (move.double) {
      if (!canUseDouble(state)) return { ok: false, error: 'Doppia mossa non disponibile' };
      g.tickets.doppia--;
      state.doubleStep = 1;
      isDouble = true;
    }
    g.tickets[ticket]--;
    g.pos = to;
    const round = state.log.length + 1;
    const revealed = REVEAL_ROUNDS.includes(round);
    state.log.push({ round, ticket, pos: to, revealed, double: isDouble });
    if (revealed) state.lastRevealed = { pos: to, round };
    state.moveCount++;

    if (state.doubleStep === 1) {
      state.doubleStep = 2; // resta il turno del Ghigno per la seconda mossa
      if (legalMoves(state, 'G', map).length === 0) {
        endGame(state, 'detective', 'Il Ghigno è circondato e non può più muoversi!');
      }
      return { ok: true };
    }
    state.doubleStep = 0;
    advanceDetectives(state, 0, map);
    return { ok: true };
  }

  const d = pieceById(state, pieceId);
  d.tickets[ticket]--;
  state.ghigno.tickets[ticket]++;
  d.pos = to;
  state.moveCount++;
  if (to === state.ghigno.pos) {
    endGame(state, 'detective', `${d.name} ha catturato il Ghigno alla posizione ${to}!`);
    return { ok: true };
  }
  advanceDetectives(state, state.turn.index + 1, map);
  return { ok: true };
}

/** Vista pubblica: quello che vede il tabellone e ogni detective. */
function publicView(state) {
  const over = state.phase === 'over';
  return {
    phase: state.phase,
    round: state.log.length,
    maxRounds: MAX_ROUNDS,
    revealRounds: REVEAL_ROUNDS,
    turn: { ...state.turn, pieceId: currentPieceId(state) },
    doubleStep: state.doubleStep,
    moveCount: state.moveCount,
    ghigno: {
      id: 'G',
      owner: state.ghigno.owner,
      ownerName: state.ghigno.ownerName,
      tickets: { ...state.ghigno.tickets },
      pos: over ? state.ghigno.pos : null,
    },
    detectives: state.detectives.map((d) => ({ ...d, tickets: { ...d.tickets } })),
    log: state.log.map((e) => ({
      round: e.round,
      ticket: e.ticket,
      double: e.double,
      revealed: e.revealed,
      pos: e.revealed || over ? e.pos : null,
    })),
    lastRevealed: state.lastRevealed,
    winner: state.winner,
    winReason: state.winReason,
  };
}

/** Vista per un singolo giocatore (pid). Il Ghigno vede la propria posizione. */
function privateView(state, pid, map = MAP) {
  const view = publicView(state);
  const isGhigno = state.ghigno.owner === pid;
  view.mine = [
    ...(isGhigno ? ['G'] : []),
    ...state.detectives.filter((d) => d.owner === pid).map((d) => d.id),
  ];
  if (isGhigno) {
    view.ghigno.pos = state.ghigno.pos;
    view.log = state.log.map((e) => ({ ...e }));
  }
  const current = currentPieceId(state);
  if (current && view.mine.includes(current)) {
    view.legal = {
      pieceId: current,
      moves: legalMoves(state, current, map),
      canDouble: current === 'G' && canUseDouble(state),
    };
  } else {
    view.legal = null;
  }
  return view;
}

module.exports = {
  MAX_ROUNDS,
  REVEAL_ROUNDS,
  DETECTIVE_STYLES,
  createGame,
  legalMoves,
  applyMove,
  canUseDouble,
  currentPieceId,
  publicView,
  privateView,
};
