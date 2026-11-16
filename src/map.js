'use strict';
/*
 * Nerapoli — mappa originale.
 * La città è generata in modo deterministico (seed fisso): una griglia irregolare
 * di incroci divisa da un fiume, con ponti, un'isola, linee di tram, metro e traghetto.
 */

const COLS = 14;
const ROWS = 9;           // righe 0-4 a nord del fiume, 5-8 a sud
const WIDTH = 1600;
const HEIGHT = 1080;
const RIVER_Y = 560;
const RIVER_AMP = 18;
const RIVER_HALF = 70;
const BRIDGES = [1, 4, 10, 13]; // colonne in cui una strada attraversa il fiume

const ISLAND = { cx: 880, rx: 125, ry: 44 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function riverCenter(x) {
  return RIVER_Y + RIVER_AMP * Math.sin(x / 210);
}

function districtOf(r, c) {
  if (r <= 4) return c <= 4 ? 'Collina dei Magnati' : c <= 9 ? 'Cattedrale' : 'Ciminiere';
  return c <= 4 ? 'Porto Vecchio' : c <= 9 ? 'Bassifondi' : 'Docks';
}

const gid = (r, c) => r * COLS + c + 1;

function buildMap(seed = 1931) {
  const rnd = mulberry32(seed);
  const nodes = [];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = Math.round(80 + c * 111 + (rnd() - 0.5) * 50);
      let y = r < 5 ? 70 + r * 96 : 680 + (r - 5) * 110;
      y += (rnd() - 0.5) * 40;
      if (r === 4) y = Math.min(y, riverCenter(x) - RIVER_HALF - 22);
      if (r === 5) y = Math.max(y, riverCenter(x) + RIVER_HALF + 22);
      nodes.push({ id: gid(r, c), x, y: Math.round(y), district: districtOf(r, c) });
    }
  }

  // Isola del Manicomio: due nodi in mezzo al fiume
  const I1 = nodes.length + 1;
  const I2 = nodes.length + 2;
  nodes.push({ id: I1, x: 830, y: Math.round(riverCenter(830)), district: 'Isola del Manicomio' });
  nodes.push({ id: I2, x: 935, y: Math.round(riverCenter(935)), district: 'Isola del Manicomio' });

  const edgeKeys = new Set();
  const edges = [];
  function addEdge(a, b, type) {
    if (a === b) return;
    const key = `${Math.min(a, b)}-${Math.max(a, b)}-${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a: Math.min(a, b), b: Math.max(a, b), type });
  }

  // --- Strade (auto) ---
  const removable = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c < COLS - 1) {
        addEdge(gid(r, c), gid(r, c + 1), 'auto');
        removable.push([gid(r, c), gid(r, c + 1)]);
      }
      if (r < ROWS - 1) {
        if (r === 4) {
          if (BRIDGES.includes(c)) addEdge(gid(r, c), gid(r + 1, c), 'auto');
        } else {
          addEdge(gid(r, c), gid(r + 1, c), 'auto');
          removable.push([gid(r, c), gid(r + 1, c)]);
        }
      }
      if (r < ROWS - 1 && c < COLS - 1 && r !== 4) {
        const p = rnd();
        if (p < 0.22) addEdge(gid(r, c), gid(r + 1, c + 1), 'auto');
        else if (p < 0.37) addEdge(gid(r, c + 1), gid(r + 1, c), 'auto');
      }
    }
  }
  addEdge(gid(4, 7), I1, 'auto');
  addEdge(I1, I2, 'auto');
  addEdge(I2, gid(5, 8), 'auto');

  // Rimuove alcune strade per rendere la città irregolare, senza isolare nessun incrocio
  function autoNeighbors(skipKey) {
    const adj = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
      if (e.type !== 'auto') continue;
      if (`${e.a}-${e.b}-auto` === skipKey) continue;
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    return adj;
  }
  function connected(adj) {
    const seen = new Set([nodes[0].id]);
    const stack = [nodes[0].id];
    while (stack.length) {
      const n = stack.pop();
      for (const m of adj.get(n)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    return seen.size === nodes.length;
  }
  for (let i = removable.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [removable[i], removable[j]] = [removable[j], removable[i]];
  }
  let removed = 0;
  for (const [x, y] of removable) {
    if (removed >= 28) break;
    const a = Math.min(x, y), b = Math.max(x, y);
    const key = `${a}-${b}-auto`;
    const full = autoNeighbors(null);
    if (full.get(a).length < 3 || full.get(b).length < 3) continue;
    if (!connected(autoNeighbors(key))) continue;
    edgeKeys.delete(key);
    const idx = edges.findIndex((e) => e.a === a && e.b === b && e.type === 'auto');
    edges.splice(idx, 1);
    removed++;
  }

  // --- Tram ---
  const tramLines = [
    [[1, 0], [1, 2], [1, 5], [1, 7], [1, 10], [1, 13]],
    [[3, 1], [3, 3], [3, 6], [3, 8], [3, 11], [3, 13]],
    [[6, 0], [6, 2], [6, 4], [6, 7], [6, 9], [6, 12]],
    [[8, 1], [8, 4], [8, 6], [8, 9], [8, 11], [8, 13]],
    [[0, 1], [2, 1], [4, 1], [5, 1], [7, 1], [8, 1]],
    [[0, 4], [1, 4], [3, 4], [4, 4], [5, 4], [6, 4], [8, 4]],
    [[1, 10], [3, 10], [4, 10], [5, 10], [6, 10], [8, 10]],
    [[0, 13], [1, 13], [3, 13], [4, 13], [5, 13], [6, 13], [8, 13]],
  ].map((line) => line.map(([r, c]) => gid(r, c)));

  // --- Metro ---
  const metroLines = [
    [[1, 0], [3, 3], [3, 6], [3, 10], [1, 13]],
    [[0, 7], [3, 6], [6, 7], [8, 9]],
    [[6, 1], [6, 4], [6, 7], [6, 11], [3, 10]],
  ].map((line) => line.map(([r, c]) => gid(r, c)));

  // --- Traghetto (solo biglietto nero) ---
  const ferryLine = [gid(4, 0), gid(5, 2), I1, I2, gid(5, 10), gid(4, 13)];

  for (const line of tramLines) for (let i = 1; i < line.length; i++) addEdge(line[i - 1], line[i], 'tram');
  for (const line of metroLines) for (let i = 1; i < line.length; i++) addEdge(line[i - 1], line[i], 'metro');
  for (let i = 1; i < ferryLine.length; i++) addEdge(ferryLine[i - 1], ferryLine[i], 'traghetto');

  // Fiume come poligono
  const top = [];
  const bottom = [];
  for (let x = -20; x <= WIDTH + 20; x += 40) {
    top.push([x, Math.round(riverCenter(x) - RIVER_HALF)]);
    bottom.push([x, Math.round(riverCenter(x) + RIVER_HALF)]);
  }
  const river = top.concat(bottom.reverse());

  const colEdge = (c) => 80 + (c + 0.5) * 111;
  const districts = [
    { name: 'Collina dei Magnati', x: 0, y: 0, w: colEdge(4), h: 520 },
    { name: 'Cattedrale', x: colEdge(4), y: 0, w: colEdge(9) - colEdge(4), h: 520 },
    { name: 'Ciminiere', x: colEdge(9), y: 0, w: WIDTH - colEdge(9), h: 520 },
    { name: 'Porto Vecchio', x: 0, y: 600, w: colEdge(4), h: HEIGHT - 600 },
    { name: 'Bassifondi', x: colEdge(4), y: 600, w: colEdge(9) - colEdge(4), h: HEIGHT - 600 },
    { name: 'Docks', x: colEdge(9), y: 600, w: WIDTH - colEdge(9), h: HEIGHT - 600 },
  ];

  const detectiveStarts = [[0, 2], [0, 10], [1, 6], [2, 0], [2, 13], [4, 4], [5, 7], [6, 13], [7, 3], [8, 8]]
    .map(([r, c]) => gid(r, c));
  const ghignoStarts = [[0, 5], [2, 3], [2, 9], [3, 12], [6, 1], [6, 6], [7, 10], [8, 4], [3, 7]]
    .map(([r, c]) => gid(r, c));

  return {
    name: 'Nerapoli',
    width: WIDTH,
    height: HEIGHT,
    nodes,
    edges,
    tramLines,
    metroLines,
    ferryLine,
    river,
    island: { cx: ISLAND.cx, cy: Math.round(riverCenter(ISLAND.cx)), rx: ISLAND.rx, ry: ISLAND.ry },
    districts,
    detectiveStarts,
    ghignoStarts,
  };
}

const MAP = buildMap();

module.exports = { MAP, buildMap };
