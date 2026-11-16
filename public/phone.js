(function () {
  'use strict';
  const { renderMap, TICKET_LABEL } = window.Nerapoli;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TOKEN_KEY = 'nerapoli-token';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignorato */ } },
  };

  const socket = io();
  let token = store.get(TOKEN_KEY);
  let state = null;
  let map = null;
  let mapApi = null;
  let zoom = 0.65;
  let selected = null;        // {to, ticket}
  let lastTurnKey = null;      // per azzerare la selezione a ogni nuovo turno
  let wasMyTurn = false;
  let centeredFor = null;

  fetch('/api/map').then((r) => r.json()).then((m) => {
    map = m;
    mapApi = renderMap($('map'), m, { labels: true });
    mapApi.onNodeClick(onMapTap);
    applyZoom();
    if (state) render();
  });

  socket.on('connect', () => {
    $('conn').classList.remove('off');
    socket.emit('hello', { token }, (res) => {
      token = res.token;
      store.set(TOKEN_KEY, token);
    });
  });
  socket.on('disconnect', () => $('conn').classList.add('off'));
  socket.on('state', (s) => {
    state = s;
    render();
  });

  // ---------- ingresso ----------
  const nameInput = $('name');
  nameInput.value = store.get('nerapoli-name') || '';
  document.querySelectorAll('.role-btn').forEach((btn) => {
    btn.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) {
        $('join-error').textContent = 'Inserisci prima il tuo nome.';
        nameInput.focus();
        return;
      }
      store.set('nerapoli-name', name);
      socket.emit('join', { name, role: btn.dataset.role }, (res) => {
        $('join-error').textContent = res.ok ? '' : res.error;
      });
    };
  });
  $('leave-btn').onclick = () => socket.emit('leave');

  // ---------- mappa ----------
  function applyZoom() {
    if (!map) return;
    const svg = $('map');
    svg.setAttribute('width', Math.round(map.width * zoom));
    svg.setAttribute('height', Math.round(map.height * zoom));
  }
  function centerOn(nodeId) {
    if (!mapApi || nodeId == null) return;
    const p = mapApi.nodeXY(nodeId);
    const box = $('map-box');
    box.scrollTo({ left: p.x * zoom - box.clientWidth / 2, top: p.y * zoom - box.clientHeight / 2, behavior: 'smooth' });
  }
  function focusNode() {
    const g = state && state.game;
    if (!g) return null;
    if (g.legal) return pieceOf(g, g.legal.pieceId).pos;
    if (g.mine.includes('G')) return g.ghigno.pos;
    const mine = g.detectives.find((d) => g.mine.includes(d.id));
    return mine ? mine.pos : null;
  }
  $('zoom-in').onclick = () => { zoom = Math.min(1.6, zoom * 1.25); applyZoom(); centerOn(focusNode()); };
  $('zoom-out').onclick = () => { zoom = Math.max(0.25, zoom / 1.25); applyZoom(); centerOn(focusNode()); };
  $('center').onclick = () => centerOn(focusNode());

  function onMapTap(nodeId) {
    const g = state && state.game;
    if (!g || !g.legal) return;
    const move = g.legal.moves.find((m) => m.to === nodeId);
    if (!move) return;
    select(move.to, selected && selected.to === move.to ? selected.ticket : move.tickets[0]);
  }

  // ---------- mosse ----------
  function select(to, ticket) {
    selected = { to, ticket };
    renderMoves();
    renderMapState();
    renderConfirm();
  }
  $('confirm-cancel').onclick = () => {
    selected = null;
    renderMoves();
    renderMapState();
    renderConfirm();
  };
  $('confirm-ok').onclick = () => {
    const g = state.game;
    if (!selected || !g || !g.legal) return;
    const btn = $('confirm-ok');
    btn.disabled = true;
    socket.emit('move', {
      pieceId: g.legal.pieceId,
      to: selected.to,
      ticket: selected.ticket,
      double: g.legal.pieceId === 'G' && $('double').checked,
    }, (res) => {
      btn.disabled = false;
      if (!res.ok) toast(res.error);
      else selected = null;
      renderConfirm();
    });
  };
  $('double').onchange = () => renderConfirm();

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  // ---------- render ----------
  function pieceOf(g, id) {
    return id === 'G' ? g.ghigno : g.detectives.find((d) => d.id === id);
  }
  function pieceLabel(g, id) {
    return id === 'G' ? 'il Ghigno' : pieceOf(g, id).name;
  }
  function chips(tickets, keys) {
    return keys.filter((k) => tickets[k] !== undefined)
      .map((k) => `<span class="tk ${k}">${TICKET_LABEL[k]} ${tickets[k]}</span>`).join('');
  }
  function show(screen) {
    for (const s of ['join', 'lobby', 'spectator', 'game']) $('screen-' + s).classList.toggle('hidden', s !== screen);
  }

  function render() {
    const { you, game, lobby } = state;
    $('me').textContent = you && you.name ? `${you.name} · ${you.role === 'ghigno' ? 'Ghigno' : 'Detective'}` : '';

    if (!game) {
      selected = null;
      lastTurnKey = null;
      wasMyTurn = false;
      centeredFor = null;
      renderConfirm();
      if (!you || !you.name) {
        show('join');
        const taken = lobby.players.find((p) => p.role === 'ghigno' && p.pid !== (you && you.pid));
        const gb = document.querySelector('.role-btn.ghigno');
        gb.disabled = !!taken;
        gb.querySelector('span').textContent = taken
          ? `Già scelto da ${taken.name}.`
          : "Muoviti nell'ombra. Nessuno deve trovarti.";
        return;
      }
      show('lobby');
      $('lobby-title').textContent = you.role === 'ghigno' ? 'Sei il Ghigno.' : 'Sei un detective.';
      $('lobby-list').innerHTML = lobby.players.map((p) =>
        `<li><span class="tag ${p.role}">${p.role === 'ghigno' ? 'Ghigno' : 'Detective'}</span>${esc(p.name)}${p.pid === you.pid ? ' <small class="muted">(tu)</small>' : ''}</li>`).join('');
      return;
    }

    if (!game.mine.length) {
      show('spectator');
      renderConfirm();
      return;
    }
    show('game');
    renderGame();
  }

  function renderGame() {
    const g = state.game;
    const turnKey = `${g.moveCount}-${g.turn.pieceId}`;
    if (turnKey !== lastTurnKey) {
      selected = null;
      $('double').checked = false;
      lastTurnKey = turnKey;
    }
    const myTurn = !!g.legal;
    if (myTurn && !wasMyTurn && navigator.vibrate) navigator.vibrate([120, 80, 120]);
    wasMyTurn = myTurn;

    // stato del turno
    const tc = $('turn-card');
    tc.classList.toggle('mine', myTurn);
    const next = g.revealRounds.find((r) => r > g.round);
    if (g.phase === 'over') {
      tc.innerHTML = `<div class="big">${g.winner === 'ghigno' ? 'Il Ghigno vince' : 'I detective vincono'}</div>`;
    } else if (myTurn) {
      const extra = g.legal.pieceId === 'G' && g.doubleStep ? ' — seconda mossa' : '';
      tc.innerHTML = `<div class="big">Tocca a te!</div><div class="sub">Muovi ${esc(pieceLabel(g, g.legal.pieceId))}${extra} · turno ${g.round}${next ? ` · avvistamento al turno ${next}` : ''}</div>`;
    } else {
      const who = g.turn.pieceId;
      const owner = who === 'G' ? g.ghigno.ownerName : pieceOf(g, who).ownerName;
      tc.innerHTML = `<div>Turno di <b>${esc(pieceLabel(g, who))}</b> (${esc(owner)})</div><div class="sub">Turno ${g.round} di ${g.maxRounds}${next ? ` · avvistamento al turno ${next}` : ''}</div>`;
    }

    // segreto del Ghigno
    const isGhigno = g.mine.includes('G');
    $('secret').classList.toggle('hidden', !isGhigno);
    $('log-box').classList.toggle('hidden', !isGhigno);
    if (isGhigno) {
      const n = mapApi && mapApi.byId.get(g.ghigno.pos);
      $('secret').innerHTML = `<div class="muted">Ti nascondi al</div><div class="pos">${g.ghigno.pos}</div><div class="muted">${n ? esc(n.district) : ''} — solo tu lo vedi</div>
        <div class="tickets">${chips(g.ghigno.tickets, ['auto', 'tram', 'metro', 'nero', 'doppia'])}</div>`;
      $('my-log').innerHTML = g.log.map((e) =>
        `<li class="${e.revealed ? 'reveal' : ''}">${TICKET_LABEL[e.ticket]} → <b>${e.pos}</b>${e.revealed ? ' (visto!)' : ''}${e.double ? ' · doppia' : ''}</li>`).join('');
    }

    // pedine detective
    $('my-pieces').innerHTML = g.detectives.filter((d) => g.mine.includes(d.id)).map((d) => `
      <div class="piece-card ${g.turn.pieceId === d.id ? 'active' : ''}">
        <div class="piece-head"><span class="dot" style="background:${d.color}"></span>${esc(d.name)}<small>posizione ${d.pos}</small></div>
        <div class="tickets">${chips(d.tickets, ['auto', 'tram', 'metro'])}</div>
      </div>`).join('') +
      (!isGhigno && g.lastRevealed ? `<p class="muted">Ultimo avvistamento del Ghigno: <b>${g.lastRevealed.pos}</b> (turno ${g.lastRevealed.round})</p>` : '');

    // mosse
    $('moves-panel').classList.toggle('hidden', !myTurn);
    if (myTurn) {
      const dw = $('double-wrap');
      dw.classList.toggle('hidden', !g.legal.canDouble);
      $('double-left').textContent = g.ghigno.tickets.doppia;
    }
    renderMoves();

    // fine partita
    const over = $('over');
    over.classList.toggle('hidden', g.phase !== 'over');
    if (g.phase === 'over') {
      over.innerHTML = `<h1>${g.winner === 'ghigno' ? 'Il Ghigno vince' : 'Preso!'}</h1><p>${esc(g.winReason)}</p><p class="muted">Una nuova partita si avvia dal tabellone.</p>`;
    }

    renderMapState();
    renderConfirm();

    const focus = focusNode();
    const key = `${turnKey}-${focus}`;
    if (mapApi && centeredFor !== key && (myTurn || centeredFor === null)) {
      centeredFor = key;
      setTimeout(() => centerOn(focus), 50);
    }
  }

  function renderMoves() {
    const g = state && state.game;
    const ul = $('moves');
    if (!g || !g.legal) { ul.innerHTML = ''; return; }
    ul.innerHTML = g.legal.moves.map((m) => {
      const n = mapApi && mapApi.byId.get(m.to);
      const isSel = selected && selected.to === m.to;
      return `<li class="${isSel ? 'selected' : ''}">
        <span class="dest">${m.to}<span class="dist">${n ? esc(n.district) : ''}</span></span>
        <span class="opts">${m.tickets.map((t) =>
          `<button class="tbtn ${t} ${isSel && selected.ticket === t ? 'on' : ''}" data-to="${m.to}" data-t="${t}">${TICKET_LABEL[t]}</button>`).join('')}</span>
      </li>`;
    }).join('') || '<li>Nessuna mossa possibile.</li>';
    ul.querySelectorAll('.tbtn').forEach((b) => (b.onclick = () => select(Number(b.dataset.to), b.dataset.t)));
  }

  function renderMapState() {
    const g = state && state.game;
    if (!mapApi || !g) return;
    for (const d of g.detectives) {
      mapApi.setPiece(d.id, d.pos, { color: d.color, label: d.id.slice(1), cls: g.turn.pieceId === d.id ? 'active' : '' });
    }
    if (g.ghigno.pos != null) mapApi.setPiece('G', g.ghigno.pos, { color: '#9cff57', label: 'G', r: 21, cls: g.turn.pieceId === 'G' ? 'active' : '' });
    else mapApi.removePiece('G');
    if (g.phase === 'over') {
      mapApi.drawPath(g.log.map((e) => e.pos));
      mapApi.setGhignoMark(null);
    } else {
      mapApi.drawPath(null);
      mapApi.setGhignoMark(g.lastRevealed && !g.mine.includes('G') ? g.lastRevealed.pos : null, g.lastRevealed ? `Turno ${g.lastRevealed.round}` : '');
    }
    mapApi.clearHighlights();
    if (g.legal) {
      mapApi.highlight(g.legal.moves.map((m) => m.to).filter((id) => !selected || id !== selected.to));
      if (selected) mapApi.highlight([selected.to], 'selected');
    }
  }

  function renderConfirm() {
    const g = state && state.game;
    const visible = !!(selected && g && g.legal);
    $('confirm').classList.toggle('hidden', !visible);
    if (!visible) return;
    const dbl = g.legal.pieceId === 'G' && $('double').checked ? ' (doppia mossa)' : '';
    $('confirm-text').innerHTML = `Vai al <b>${selected.to}</b> in ${TICKET_LABEL[selected.ticket]}${dbl}`;
  }
})();
