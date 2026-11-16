/* Disegno SVG della mappa di Nerapoli, condiviso tra tabellone e telefono. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const COLORS = {
    auto: '#f2c94c',
    tram: '#2ecc71',
    metro: '#e0245e',
    traghetto: '#2d9cdb',
    nero: '#111111',
    doppia: '#9cff57',
  };
  const TICKET_LABEL = {
    auto: 'Auto',
    tram: 'Tram',
    metro: 'Metro',
    nero: 'Nero',
    traghetto: 'Traghetto',
    doppia: 'Doppia',
  };
  const DISTRICT_TINT = {
    'Collina dei Magnati': '#1d1a24',
    Cattedrale: '#211c1c',
    Ciminiere: '#1d201b',
    'Porto Vecchio': '#1b1f24',
    Bassifondi: '#221d17',
    Docks: '#1a1e22',
  };

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function renderMap(svg, map, options) {
    const opts = Object.assign({ labels: true }, options);
    svg.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
    svg.innerHTML = '';
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const types = new Map(map.nodes.map((n) => [n.id, new Set()]));
    for (const e of map.edges) {
      types.get(e.a).add(e.type);
      types.get(e.b).add(e.type);
    }

    el('rect', { x: 0, y: 0, width: map.width, height: map.height, fill: '#121318' }, svg);
    const gDistricts = el('g', { class: 'districts' }, svg);
    for (const d of map.districts) {
      el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, fill: DISTRICT_TINT[d.name] || '#1a1a1a' }, gDistricts);
    }
    el('polygon', { points: map.river.map((p) => p.join(',')).join(' '), fill: '#0d2433', stroke: '#1e4a63', 'stroke-width': 3 }, svg);
    el('ellipse', { cx: map.island.cx, cy: map.island.cy, rx: map.island.rx, ry: map.island.ry, fill: '#25211e', stroke: '#3a332c', 'stroke-width': 3 }, svg);

    if (opts.labels) {
      const gLabels = el('g', { class: 'district-labels' }, svg);
      for (const d of map.districts) {
        const t = el('text', { x: d.x + d.w / 2, y: d.y < 300 ? d.y + 40 : d.y + d.h - 18, 'text-anchor': 'middle', class: 'district-label' }, gLabels);
        t.textContent = d.name.toUpperCase();
      }
      const t = el('text', { x: map.island.cx, y: map.island.cy - map.island.ry - 8, 'text-anchor': 'middle', class: 'district-label small' }, gLabels);
      t.textContent = 'ISOLA DEL MANICOMIO';
    }

    const gEdges = el('g', { class: 'edges' }, svg);
    const polyline = (ids, attrs) =>
      el('polyline', Object.assign({ points: ids.map((id) => `${byId.get(id).x},${byId.get(id).y}`).join(' '), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, attrs), gEdges);

    polyline(map.ferryLine, { stroke: COLORS.traghetto, 'stroke-width': 5, 'stroke-dasharray': '14 10', opacity: 0.9 });
    for (const line of map.metroLines) polyline(line, { stroke: COLORS.metro, 'stroke-width': 13, opacity: 0.75 });
    for (const line of map.tramLines) polyline(line, { stroke: COLORS.tram, 'stroke-width': 7, opacity: 0.8 });
    for (const e of map.edges) {
      if (e.type !== 'auto') continue;
      const a = byId.get(e.a), b = byId.get(e.b);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: COLORS.auto, 'stroke-width': 3, opacity: 0.85 }, gEdges);
    }

    const gPath = el('g', { class: 'path' }, svg);
    const gHighlights = el('g', { class: 'highlights' }, svg);
    const gNodes = el('g', { class: 'nodes' }, svg);
    const nodeEls = new Map();
    for (const n of map.nodes) {
      const g = el('g', { class: 'node', transform: `translate(${n.x},${n.y})`, 'data-id': n.id }, gNodes);
      const t = types.get(n.id);
      if (t.has('metro')) el('rect', { x: -20, y: -20, width: 40, height: 40, rx: 8, fill: COLORS.metro }, g);
      if (t.has('tram')) el('circle', { r: 17, fill: COLORS.tram }, g);
      if (t.has('traghetto')) el('circle', { r: 21, fill: 'none', stroke: COLORS.traghetto, 'stroke-width': 4 }, g);
      el('circle', { r: 13, fill: '#f4ecd8', stroke: '#0b0b0b', 'stroke-width': 2 }, g);
      const label = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'node-label' }, g);
      label.textContent = n.id;
      nodeEls.set(n.id, g);
    }

    const gMarks = el('g', { class: 'marks' }, svg);
    const gPieces = el('g', { class: 'pieces' }, svg);
    const pieces = new Map();
    let clickHandler = null;

    svg.addEventListener('click', (ev) => {
      const g = ev.target.closest && ev.target.closest('[data-id]');
      if (g && clickHandler) clickHandler(Number(g.getAttribute('data-id')));
    });

    return {
      byId,
      nodeTypes: types,
      nodeXY(id) {
        const n = byId.get(id);
        return n ? { x: n.x, y: n.y } : null;
      },
      onNodeClick(fn) {
        clickHandler = fn;
      },
      clearHighlights() {
        gHighlights.innerHTML = '';
      },
      highlight(ids, cls) {
        for (const id of ids) {
          const n = byId.get(id);
          if (!n) continue;
          const c = el('circle', { cx: n.x, cy: n.y, r: 27, class: `hl ${cls || ''}`, 'data-id': id }, gHighlights);
          c.style.pointerEvents = 'all';
        }
      },
      setPiece(key, nodeId, style) {
        const n = byId.get(nodeId);
        let g = pieces.get(key);
        if (!n) {
          if (g) { g.remove(); pieces.delete(key); }
          return;
        }
        if (!g) {
          g = el('g', { class: `piece ${style.cls || ''}` }, gPieces);
          el('circle', { r: style.r || 19, fill: style.color, stroke: style.stroke || '#000', 'stroke-width': 4 }, g);
          const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'piece-label', fill: style.textColor || '#000' }, g);
          t.textContent = style.label || '';
          g.style.transform = `translate(${n.x}px, ${n.y}px)`;
          pieces.set(key, g);
          // forza il layout prima delle transizioni successive
          g.getBoundingClientRect();
        }
        g.setAttribute('class', `piece ${style.cls || ''}`);
        g.style.transform = `translate(${n.x}px, ${n.y}px)`;
      },
      removePiece(key) {
        const g = pieces.get(key);
        if (g) { g.remove(); pieces.delete(key); }
      },
      clearPieces() {
        gPieces.innerHTML = '';
        pieces.clear();
      },
      setGhignoMark(nodeId, label) {
        gMarks.innerHTML = '';
        const n = byId.get(nodeId);
        if (!n) return;
        const g = el('g', { class: 'ghigno-mark', transform: `translate(${n.x},${n.y})` }, gMarks);
        el('circle', { r: 30, class: 'ghigno-ring' }, g);
        if (label) {
          const anchor = n.x > map.width - 160 ? 'end' : n.x < 160 ? 'start' : 'middle';
          const dx = anchor === 'end' ? 30 : anchor === 'start' ? -30 : 0;
          const t = el('text', { x: dx, y: n.y < 70 ? 52 : -40, 'text-anchor': anchor, class: 'ghigno-mark-label' }, g);
          t.textContent = label;
        }
      },
      drawPath(ids) {
        gPath.innerHTML = '';
        if (!ids || ids.length < 2) return;
        el('polyline', {
          points: ids.map((id) => `${byId.get(id).x},${byId.get(id).y}`).join(' '),
          class: 'ghigno-path',
          fill: 'none',
        }, gPath);
      },
    };
  }

  global.Nerapoli = { renderMap, COLORS, TICKET_LABEL };
})(window);
