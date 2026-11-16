(function () {
  'use strict';
  const { renderMap, TICKET_LABEL } = window.Nerapoli;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const socket = io();
  let mapApi = null;
  let state = null;
  let prevGame = null;
  let hideOver = false;
  let bannerTimer = null;

  fetch('/api/map').then((r) => r.json()).then((map) => {
    mapApi = renderMap($('map'), map);
    if (state) render();
  });
  fetch('/api/info').then((r) => r.json()).then((info) => {
    $('qr').src = info.qr;
    $('join-url').textContent = info.url;
    if (info.urls.length > 1) $('other-urls').textContent = 'Altri indirizzi: ' + info.urls.slice(1).join('  ·  ');
  });

  socket.on('connect', () => socket.emit('board:hello'));
  socket.on('state', (s) => {
    state = s;
    if (mapApi) render();
  });

  $('start-btn').onclick = () => {
    socket.emit('board:start', { numDetectives: Number($('num-det').value) }, (res) => {
      if (!res.ok) showBanner(res.error, true);
    });
  };
  $('new-btn').onclick = () => {
    hideOver = false;
    socket.emit('board:reset');
  };
  $('show-map-btn').onclick = () => {
    hideOver = true;
    $('gameover').classList.add('hidden');
  };
  $('end-btn').onclick = () => {
    if (!state || !state.game) return;
    if (state.game.phase === 'over' || confirm('Terminare la partita e tornare alla lobby?')) {
      hideOver = false;
      socket.emit('board:reset');
    }
  };

  function showBanner(text, neutral) {
    const b = $('banner');
    b.textContent = text;
    b.className = 'banner' + (neutral ? ' neutral' : '');
    // riavvia l'animazione
    void b.offsetWidth;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.add('hidden'), neutral ? 2600 : 5000);
  }

  function ticketChips(tickets, keys) {
    return keys
      .filter((k) => tickets[k] !== undefined)
      .map((k) => `<span class="tk ${k}">${TICKET_LABEL[k]} ${tickets[k]}</span>`)
      .join('');
  }

  function renderLobby() {
    const players = state.lobby.players;
    const ul = $('lobby-players');
    ul.innerHTML = players.length
      ? players.map((p) => `
          <li class="${p.connected ? '' : 'off'}">
            <span class="role ${p.role}">${p.role === 'ghigno' ? 'Ghigno' : 'Detective'}</span>
            <b>${esc(p.name)}</b>${p.connected ? '' : ' <small>(disconnesso)</small>'}
            <button class="ghost kick" data-pid="${p.pid}" title="Rimuovi">×</button>
          </li>`).join('')
      : '<li class="empty">Nessun giocatore ancora. Inquadrate il QR code!</li>';
    ul.querySelectorAll('.kick').forEach((b) => (b.onclick = () => socket.emit('board:kick', b.dataset.pid)));

    const ghigno = players.find((p) => p.role === 'ghigno');
    const dets = players.filter((p) => p.role === 'detective');
    const sel = $('num-det');
    const prev = Number(sel.value) || 4;
    const min = Math.max(1, dets.length);
    sel.innerHTML = '';
    for (let n = min; n <= 5; n++) sel.add(new Option(String(n), String(n)));
    sel.value = String(Math.min(5, Math.max(min, prev)));
    sel.disabled = dets.length > 5;

    let hint = '';
    if (!ghigno) hint = 'Serve un giocatore che sia il Ghigno.';
    else if (!dets.length) hint = 'Serve almeno un detective.';
    else if (dets.length > 5) hint = 'Massimo 5 detective.';
    else if (Number(sel.value) > dets.length) hint = 'Alcuni giocatori controlleranno più di un detective.';
    $('lobby-hint').textContent = hint;
    $('start-btn').disabled = !ghigno || !dets.length || dets.length > 5;
  }

  function pieceName(g, id) {
    if (id === 'G') return `il Ghigno (${esc(g.ghigno.ownerName)})`;
    const d = g.detectives.find((x) => x.id === id);
    return d ? `${esc(d.name)} (${esc(d.ownerName)})` : id;
  }

  function announce(g) {
    if (!prevGame || g.moveCount <= prevGame.moveCount) return;
    if (g.log.length > prevGame.log.length) {
      const last = g.log[g.log.length - 1];
      if (last.revealed) showBanner(`Il Ghigno è stato avvistato al ${last.pos}!`);
      else showBanner(`Il Ghigno si muove in ${TICKET_LABEL[last.ticket]}${last.double ? ' (doppia mossa)' : ''}…`, true);
    }
  }

  function renderGame() {
    const g = state.game;
    announce(g);

    $('round').textContent = g.round;
    if (g.phase === 'playing') {
      const who = g.turn.pieceId;
      let txt = `Tocca a <b>${pieceName(g, who)}</b>`;
      if (who === 'G' && g.doubleStep) txt += ' — seconda metà della doppia mossa';
      const next = g.revealRounds.find((r) => r > g.round);
      if (next) txt += `<br><small>Prossimo avvistamento: turno ${next}</small>`;
      $('turn').innerHTML = txt;
    } else {
      $('turn').innerHTML = g.winner === 'ghigno' ? '<b>Il Ghigno vince</b>' : '<b>I detective vincono</b>';
    }

    $('ghigno-tickets').innerHTML = ticketChips(g.ghigno.tickets, ['auto', 'tram', 'metro', 'nero', 'doppia']);

    const items = [];
    for (let r = 1; r <= g.maxRounds; r++) {
      const e = g.log[r - 1];
      const cls = [];
      if (g.revealRounds.includes(r)) cls.push('reveal');
      if (e) cls.push(e.ticket);
      if (e && e.double) cls.push('double');
      if (!e && r === g.round + 1 && g.phase === 'playing') cls.push('current');
      const inner = e ? (e.pos != null ? `<span class="pos">${e.pos}</span>` : `<span>${TICKET_LABEL[e.ticket]}</span>`) : '';
      items.push(`<li class="${cls.join(' ')}"><span class="n">${r}</span>${inner}</li>`);
    }
    $('log').innerHTML = items.join('');

    $('detectives').innerHTML = g.detectives.map((d) => `
      <li class="${g.turn.pieceId === d.id ? 'active' : ''}">
        <div class="det-head"><span class="dot" style="background:${d.color}"></span>${esc(d.name)} <small>${esc(d.ownerName)} · ${d.pos}</small></div>
        <div class="tickets">${ticketChips(d.tickets, ['auto', 'tram', 'metro'])}</div>
      </li>`).join('');

    // mappa
    for (const d of g.detectives) {
      mapApi.setPiece(d.id, d.pos, { color: d.color, label: d.id.slice(1), cls: g.turn.pieceId === d.id ? 'active' : '' });
    }
    if (g.phase === 'over') {
      mapApi.setPiece('G', g.ghigno.pos, { color: '#9cff57', label: 'G', r: 22 });
      mapApi.drawPath(g.log.map((e) => e.pos));
      mapApi.setGhignoMark(null);
    } else {
      mapApi.removePiece('G');
      mapApi.drawPath(null);
      if (g.lastRevealed) mapApi.setGhignoMark(g.lastRevealed.pos, `Avvistato (turno ${g.lastRevealed.round})`);
      else mapApi.setGhignoMark(null);
    }

    const over = g.phase === 'over';
    $('gameover').classList.toggle('hidden', !over || hideOver);
    if (over) {
      $('over-title').textContent = g.winner === 'ghigno' ? 'IL GHIGNO VINCE' : 'PRESO!';
      $('over-reason').textContent = g.winReason;
    }
    $('end-btn').textContent = over ? 'Nuova partita' : 'Termina partita';
    prevGame = g;
  }

  function render() {
    const inGame = !!state.game;
    $('lobby').classList.toggle('hidden', inGame);
    if (!inGame) {
      prevGame = null;
      hideOver = false;
      mapApi.clearPieces();
      mapApi.drawPath(null);
      mapApi.setGhignoMark(null);
      $('round').textContent = '0';
      $('turn').textContent = 'In attesa dei giocatori…';
      $('log').innerHTML = '';
      $('detectives').innerHTML = '';
      $('ghigno-tickets').innerHTML = '';
      renderLobby();
      return;
    }
    renderGame();
  }
})();
