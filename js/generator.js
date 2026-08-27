/* LetterMelt — puzzle generator (pure logic, works in browser and Node).
 *
 * MODEL
 * -----
 * A puzzle is 10-16 hidden words packed into a FIXED 4 x 4 grid (<= 16 letter
 * cells). Every word owns a canonical path: a self-avoiding sequence of
 * 8-adjacent cells, one cell per letter. Cells are shared between words
 * whenever the letters match. Exactly one word is the 8-11 letter "base" word,
 * or a requested 7-11 letter main word when the player chooses one.
 *
 * Construction is Cascade Pack: design a familiar overlapping family, then
 * route it as a choreographed melt.
 *   0. weave a readable base word across the 4 x 4,
 *   1. mine familiar words that fit the base's letter palette,
 *   2. route hooks straight and remaining words so each owns a melt,
 *   3. lightly saturate with more familiar zero-new-cell words.
 * Restarts keep the best-scoring board (dense, familiar, solvable in ~5 min).
 *
 * The board graph shown to the player is EXACTLY the union of the remaining
 * (unfound) words' canonical paths:
 *   - a node exists iff >= 1 remaining word uses that cell,
 *   - an edge exists iff >= 1 remaining word steps between those two cells.
 * No other adjacency is drawn or traversable. Solving a word recomputes the
 * union, so anything no longer needed disappears.
 *
 * Solvability is guaranteed by construction: canonical paths are untouched
 * until their word is solved, and union-removal never deletes a cell or edge
 * that a remaining word still needs.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LetterMeltGenerator = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Tunables
   * ------------------------------------------------------------------ */
  const CONFIG = {
    size: 4,                  // THE grid: every puzzle lives inside 4 x 4
    minWords: 10,             // hard floor for the solvable set
    maxWords: 16,             // cap for the solvable set
    targetEasy: 10,           // easy is a 10-word race
    targetHard: 13,           // hard aims at 13, then trims 4-letter filler to land there
    // The solvable set is DERIVED by enumeration, not by construction: we lay
    // down just enough words to shape the graph, then promote every common
    // word the finished board can spell. A denser construction spells far more
    // common words than the target allows (12 laid words -> ~27 traceable
    // commons), so construction stays deliberately sparse.
    constructMin: 5,
    constructMax: 7,
    longMin: 8,
    longMax: 11,
    mainMin: 7,               // custom main words may be one letter shorter
    mainMax: 11,
    regularMin: 4,
    regularMax: 7,
    saturateScan: 4200,       // familiar vocabulary entries scanned during saturation
    saturateExtra: 2,         // extra familiar words allowed after the script
    routeBudget: 1200,        // DFS steps for the preferred (reuse >= 2) route
    routeBudgetRelaxed: 600,  // DFS steps for the fallback (reuse >= 1) route
    saturateBudget: 260,      // DFS steps for a zero-new-cell route
    longRouteBudget: 4000,    // an empty 4x4 finds a mixed path long before this
    basePlaceTries: 8,        // cheap; keeps tiny test lexicons from failing to route
    // The search is bounded by restarts and by the DFS step budgets above, and
    // by nothing else. A wall-clock deadline would make the board depend on how
    // fast the device ran, which would stop a shared seed from rebuilding the
    // same puzzle. Restarts are the quality budget: cheaper attempts mean we
    // can roll more boards and keep the best.
    restarts: 80,
    // Boards may leave gaps in the grid — a hole-punched silhouette reads far
    // better than a solid block. minCells stops them from getting so sparse
    // that the puzzle turns into a thin thread.
    minCells: 14,
    // Occupancy budget drawn per attempt. Keeping the ceiling near capacity is
    // what forces words to share letters instead of sprawling.
    budgetMin: 14,
    budgetMax: 20,
    // Boards below this quality score are re-rolled until the restarts run
    // out; the best one found is used if none clears the bar.
    minFunScore: 78,
    // Human-pace estimate (seconds) a reasonably smart player should beat.
    // This is a generation quality target, not the race clock. Boards over
    // this still lose the gate and are kept only if nothing faster turned up.
    maxPaceSec: 300
  };

  /* ------------------------------------------------------------------ *
   * Fallback word data (the real lists live in data/lexicon.js)
   * ------------------------------------------------------------------ */
  const FALLBACK_COMMON = [
    'able', 'acre', 'atom', 'bake', 'bald', 'band', 'bare', 'barn', 'beam', 'bean',
    'bear', 'beat', 'bell', 'belt', 'bend', 'bird', 'blue', 'boat', 'bone', 'cake',
    'calm', 'cane', 'cart', 'cave', 'coal', 'coat', 'cold', 'cone', 'core', 'corn',
    'dare', 'dark', 'date', 'dawn', 'deal', 'dear', 'debt', 'dent', 'dial', 'dime',
    'earn', 'east', 'lace', 'lake', 'lamb', 'lame', 'land', 'lane', 'late', 'lead',
    'lean', 'mare', 'mast', 'mate', 'meal', 'mean', 'meat', 'mend', 'mole', 'moat',
    'nail', 'name', 'near', 'neat', 'nest', 'note', 'oral', 'oval', 'pale', 'pane',
    'part', 'past', 'pear', 'pest', 'plan', 'pole', 'rail', 'rain', 'rate', 'real',
    'rent', 'road', 'roam', 'robe', 'rode', 'role', 'rope', 'sale', 'salt', 'same',
    'sand', 'sane', 'seal', 'seam', 'seat', 'sent', 'slam', 'slate', 'snare', 'solar',
    'alone', 'blame', 'blast', 'brace', 'brain', 'bread', 'clean', 'clear', 'crane', 'cream',
    'dream', 'earls', 'learn', 'least', 'metal', 'ocean', 'organ', 'paint', 'panel', 'pearl',
    'place', 'plane', 'plant', 'plate', 'price', 'scale', 'score', 'shore', 'slate', 'smart',
    'snail', 'solid', 'stale', 'stand', 'stone', 'store', 'storm', 'table', 'trace', 'train',
    'anchor', 'animal', 'basket', 'candle', 'carbon', 'castle', 'centre', 'cellar', 'clever', 'coast',
    'dealer', 'desert', 'dinner', 'garden', 'inland', 'island', 'lantern', 'leader', 'legend', 'listen',
    'manner', 'marble', 'master', 'mental', 'metals', 'mineral', 'nature', 'normal', 'orange', 'parcel',
    'parent', 'planet', 'plaster', 'reason', 'relate', 'rental', 'sailor', 'salmon', 'sample', 'season',
    'senate', 'silent', 'silver', 'sister', 'stable', 'stream', 'talent', 'tender', 'tunnel', 'winter'
  ];

  const FALLBACK_LONG = [
    'painters', 'creation', 'material', 'mountain', 'notebook', 'sandstone', 'cardinal',
    'planetary', 'centrally', 'landscape', 'strangers', 'celebrate', 'presented',
    'restaurant', 'generation', 'personally', 'reasonable', 'management', 'centimeter'
  ];

  const FALLBACK_EXTRA = [
    'lane', 'lean', 'earn', 'near', 'tale', 'teal', 'late', 'seal', 'sale', 'ales',
    'rate', 'tear', 'tare', 'star', 'rats', 'arts', 'tars', 'note', 'tone', 'nose',
    'ones', 'eons', 'nest', 'nets', 'sent', 'tens', 'rest', 'rise', 'sire', 'tile',
    'lite', 'rite', 'tier', 'tire', 'mane', 'mean', 'name', 'amen', 'came', 'mace',
    'stone', 'notes', 'onset', 'tones', 'stare', 'tears', 'rates', 'aster', 'least',
    'steal', 'stale', 'slate', 'tales', 'learn', 'renal', 'antler', 'rental', 'canoe'
  ];

  /* ------------------------------------------------------------------ *
   * RNG
   * ------------------------------------------------------------------ */
  function createRng(seed) {
    let a = (typeof seed === 'number' ? seed : Date.now()) >>> 0;
    if (a === 0) a = 0x9e3779b9;
    return function rng() {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /** Pick one headline from equal-width buckets of the RNG's 0..1 output. */
  function chooseHeadlineWord(words, rng) {
    if (!Array.isArray(words) || !words.length) return null;
    const index = Math.min(words.length - 1, Math.floor(rng() * words.length));
    return words[index];
  }

  /* ------------------------------------------------------------------ *
   * Lattice helpers
   * ------------------------------------------------------------------ */
  const OFFSETS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  function key(x, y) {
    return x + ',' + y;
  }

  function edgeKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function isDiagonalStep(ax, ay, bx, by) {
    return ax !== bx && ay !== by;
  }

  /**
   * Visual tracing cost for a coordinate path. Direction changes add search
   * cost; diagonals do not. On this board they expose more neighbouring
   * letters at once than horizontal/vertical lanes, so cardinal-only paths
   * carry a small penalty instead.
   */
  function pathWiggliness(path) {
    let turns = 0;
    let diags = 0;
    for (let i = 1; i < path.length; i++) {
      if (isDiagonalStep(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y)) diags++;
      if (i >= 2) {
        const dx1 = path[i - 1].x - path[i - 2].x;
        const dy1 = path[i - 1].y - path[i - 2].y;
        const dx2 = path[i].x - path[i - 1].x;
        const dy2 = path[i].y - path[i - 1].y;
        if (dx1 !== dx2 || dy1 !== dy2) turns++;
      }
    }
    const cardinals = Math.max(0, path.length - 1 - diags);
    return { turns: turns, diags: diags, score: turns * 0.65 + cardinals * 0.2 };
  }

  function edgeMixGeometry(path, size) {
    const gridSize = size || CONFIG.size;
    const steps = Math.max(0, path.length - 1);
    let diags = 0;
    let perimeter = 0;
    const directions = new Set();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx !== 0 && dy !== 0) diags++;
      if ((a.x === b.x && (a.x === 0 || a.x === gridSize - 1)) ||
          (a.y === b.y && (a.y === 0 || a.y === gridSize - 1))) {
        perimeter++;
      }
      if (dy === 0) directions.add('h');
      else if (dx === 0) directions.add('v');
      else if (dx === dy) directions.add('d1');
      else directions.add('d2');
    }
    return {
      diagonalShare: steps ? diags / steps : 0,
      perimeterShare: steps ? perimeter / steps : 0,
      directionCount: directions.size
    };
  }

  function edgeMixValue(geometry) {
    const diagonal = 1 - ramp(Math.abs(geometry.diagonalShare - 0.5), 0.1, 0.5);
    const directions = ramp(geometry.directionCount, 2, 4);
    const interior = 1 - ramp(geometry.perimeterShare, 0.25, 0.75);
    return diagonal * 0.55 + directions * 0.25 + interior * 0.2;
  }

  function routeWiggliness(cells, cellIds) {
    const byId = new Map(cells.map(c => [c.id, c]));
    const path = [];
    for (const id of cellIds) {
      const cell = byId.get(id);
      if (cell) path.push(cell);
    }
    return pathWiggliness(path);
  }

  function puzzleEdgeMix(puzzle) {
    const cells = puzzle.allCells && puzzle.allCells.length ? puzzle.allCells : puzzle.cells;
    const byId = new Map(cells.map(c => [c.id, c]));
    const gridSize = puzzle.gridSize || CONFIG.size;
    let diags = 0;
    let perimeter = 0;
    const directions = new Set();
    for (const edge of puzzle.edges) {
      const a = byId.get(edge[0]);
      const b = byId.get(edge[1]);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx !== 0 && dy !== 0) diags++;
      if ((a.x === b.x && (a.x === 0 || a.x === gridSize - 1)) ||
          (a.y === b.y && (a.y === 0 || a.y === gridSize - 1))) perimeter++;
      if (dy === 0) directions.add('h');
      else if (dx === 0) directions.add('v');
      else if (dx === dy) directions.add('d1');
      else directions.add('d2');
    }
    const edgeCount = puzzle.edges.length || 1;
    const boardGeometry = {
      diagonalShare: diags / edgeCount,
      perimeterShare: perimeter / edgeCount,
      directionCount: directions.size
    };

    const headline = puzzle.words.find(w => w.isLong);
    if (!headline) return { value: edgeMixValue(boardGeometry), board: boardGeometry };
    const headlinePath = headline.cellIds.map(id => byId.get(id)).filter(Boolean);
    const headlineGeometry = edgeMixGeometry(headlinePath, gridSize);
    return {
      value: edgeMixValue(headlineGeometry) * 0.7 + edgeMixValue(boardGeometry) * 0.3,
      board: boardGeometry,
      headline: headlineGeometry
    };
  }

  function areAdjacent(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx <= 1 && dy <= 1 && dx + dy > 0;
  }

  function cellMap(cells) {
    const map = new Map();
    for (const cell of cells) map.set(key(cell.x, cell.y), cell);
    return map;
  }

  /* ------------------------------------------------------------------ *
   * Union derivation — the product's core invariant
   * ------------------------------------------------------------------ */

  /** Recompute puzzle.cells / puzzle.edges as the union of remaining words. */
  function computeUnion(puzzle) {
    const liveIds = new Set();
    const edgeIds = new Map();
    for (const word of puzzle.words) {
      if (word.found) continue;
      const ids = word.cellIds;
      for (let i = 0; i < ids.length; i++) {
        liveIds.add(ids[i]);
        if (i > 0) edgeIds.set(edgeKey(ids[i - 1], ids[i]), [ids[i - 1], ids[i]]);
      }
    }
    puzzle.cells = puzzle.allCells.filter(c => liveIds.has(c.id));
    puzzle.edges = Array.from(edgeIds.values());
    return puzzle;
  }

  /**
   * Verify the invariant exactly: shown nodes/edges are precisely the union of
   * the remaining words' canonical paths. Returns a list of problem strings
   * (empty when healthy).
   */
  function checkUnionInvariant(puzzle) {
    const problems = [];
    const wantNodes = new Set();
    const wantEdges = new Set();
    for (const word of puzzle.words) {
      if (word.found) continue;
      const ids = word.cellIds;
      for (let i = 0; i < ids.length; i++) {
        wantNodes.add(ids[i]);
        if (i > 0) wantEdges.add(edgeKey(ids[i - 1], ids[i]));
      }
    }
    const haveNodes = new Set(puzzle.cells.map(c => c.id));
    const haveEdges = new Set(puzzle.edges.map(e => edgeKey(e[0], e[1])));
    if (haveNodes.size !== puzzle.cells.length) problems.push('duplicate node id on board');
    if (haveEdges.size !== puzzle.edges.length) problems.push('duplicate edge on board');
    for (const id of wantNodes) if (!haveNodes.has(id)) problems.push('missing node ' + id);
    for (const id of haveNodes) if (!wantNodes.has(id)) problems.push('orphan node ' + id);
    for (const k of wantEdges) if (!haveEdges.has(k)) problems.push('missing edge ' + k);
    for (const k of haveEdges) if (!wantEdges.has(k)) problems.push('orphan edge ' + k);
    // Shown edges must connect lattice-adjacent cells.
    const byId = new Map(puzzle.cells.map(c => [c.id, c]));
    for (const [a, b] of puzzle.edges) {
      const ca = byId.get(a);
      const cb = byId.get(b);
      if (!ca || !cb) { problems.push('edge to unknown node ' + edgeKey(a, b)); continue; }
      if (!areAdjacent(ca, cb)) problems.push('non-adjacent edge ' + edgeKey(a, b));
    }
    const seen = new Set();
    for (const c of puzzle.cells) {
      const k = key(c.x, c.y);
      if (seen.has(k)) problems.push('two cells at ' + k);
      seen.add(k);
    }
    return problems;
  }

  /* ------------------------------------------------------------------ *
   * Crossing diagonals
   * ------------------------------------------------------------------ */

  /** Every pair of shown diagonals that visually cross (should always be []). */
  function findCrossingEdgePairs(cells, edges) {
    const map = cellMap(cells);
    const present = new Set(edges.map(e => edgeKey(e[0], e[1])));
    const crossings = [];
    for (const a of cells) {
      const b = map.get(key(a.x + 1, a.y));
      const c = map.get(key(a.x, a.y + 1));
      const d = map.get(key(a.x + 1, a.y + 1));
      if (!b || !c || !d) continue;
      if (present.has(edgeKey(a.id, d.id)) && present.has(edgeKey(b.id, c.id))) {
        crossings.push([[a.id, d.id], [b.id, c.id]]);
      }
    }
    return crossings;
  }

  function hasCrossing(cells, edges) {
    return findCrossingEdgePairs(cells, edges).length > 0;
  }

  /* ------------------------------------------------------------------ *
   * Graph queries
   * ------------------------------------------------------------------ */
  function adjacencyMap(cells, edges) {
    const adj = new Map();
    for (const cell of cells) adj.set(cell.id, new Set());
    for (const [a, b] of edges) {
      if (adj.has(a)) adj.get(a).add(b);
      if (adj.has(b)) adj.get(b).add(a);
    }
    return adj;
  }

  /** Connected components of the SHOWN graph (edges only, not adjacency). */
  function edgeComponents(cells, edges) {
    const adj = adjacencyMap(cells, edges);
    const byId = new Map(cells.map(c => [c.id, c]));
    const seen = new Set();
    const comps = [];
    for (const cell of cells) {
      if (seen.has(cell.id)) continue;
      const stack = [cell.id];
      const comp = [];
      seen.add(cell.id);
      while (stack.length) {
        const id = stack.pop();
        comp.push(byId.get(id));
        for (const next of adj.get(id) || []) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  /** Does some traceable route spelling `word` exist along shown edges? */
  function findRouteFrom(adj, byId, cells, word) {
    const target = String(word).toLowerCase();
    const used = new Set();
    const path = [];
    let budget = 100000;

    function walk(index, cellId) {
      if (budget-- <= 0) return false;
      path.push(cellId);
      used.add(cellId);
      if (index === target.length - 1) return true;
      const neighbours = adj.get(cellId);
      if (neighbours) {
        for (const next of neighbours) {
          if (used.has(next)) continue;
          const cell = byId.get(next);
          if (!cell || cell.letter !== target[index + 1]) continue;
          if (walk(index + 1, next)) return true;
        }
      }
      path.pop();
      used.delete(cellId);
      return false;
    }

    for (const cell of cells) {
      if (cell.letter !== target[0]) continue;
      path.length = 0;
      used.clear();
      if (walk(0, cell.id)) return path.slice();
    }
    return null;
  }

  function findRoute(cells, edges, word) {
    return findRouteFrom(
      adjacencyMap(cells, edges),
      new Map(cells.map(c => [c.id, c])),
      cells,
      word
    );
  }

  function isTraceable(cells, edges, word) {
    return findRoute(cells, edges, word) !== null;
  }

  /** Is an ordered list of node ids a legal trace along shown edges? */
  function isValidTrace(cells, edges, cellIds) {
    if (!Array.isArray(cellIds) || cellIds.length < 1) return false;
    const present = new Set(edges.map(e => edgeKey(e[0], e[1])));
    const ids = new Set(cells.map(c => c.id));
    const seen = new Set();
    for (let i = 0; i < cellIds.length; i++) {
      if (!ids.has(cellIds[i])) return false;
      if (seen.has(cellIds[i])) return false;
      seen.add(cellIds[i]);
      if (i > 0 && !present.has(edgeKey(cellIds[i - 1], cellIds[i]))) return false;
    }
    return true;
  }

  function traceToWord(cells, cellIds) {
    const byId = new Map(cells.map(c => [c.id, c]));
    return cellIds.map(id => (byId.get(id) ? byId.get(id).letter : '')).join('');
  }

  /* ------------------------------------------------------------------ *
   * Board under construction
   * ------------------------------------------------------------------ */
  function createBoard(cols, rows, cellBudget) {
    return {
      cols: cols,
      rows: rows,
      // How many of the cols*rows cells this board is allowed to occupy.
      // Budgets below capacity are what give boards their gaps.
      cellBudget: Math.min(cellBudget || cols * rows, cols * rows),
      occ: new Map(),          // "x,y" -> { x, y, letter }
      edges: new Set(),        // coord edge keys
      packedEdges: new Set(),  // integer edge keys for the router
      letterCounts: new Map(),
      paths: []                // [{ text, path: [{x,y,letter}] }]
    };
  }

  function coordEdgeKey(ax, ay, bx, by) {
    const ka = key(ax, ay);
    const kb = key(bx, by);
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  }

  /** Pack two 4x4 cells into a small integer (cell index fits in 8 bits). */
  function packEdge(ax, ay, bx, by, cols) {
    const a = ay * cols + ax;
    const b = by * cols + bx;
    return a < b ? (a << 8) | b : (b << 8) | a;
  }

  function commitPath(board, text, path) {
    for (const cell of path) {
      const k = key(cell.x, cell.y);
      if (!board.occ.has(k)) {
        board.occ.set(k, { x: cell.x, y: cell.y, letter: cell.letter });
        board.letterCounts.set(cell.letter, (board.letterCounts.get(cell.letter) || 0) + 1);
      }
    }
    for (let i = 1; i < path.length; i++) {
      const ax = path[i - 1].x, ay = path[i - 1].y, bx = path[i].x, by = path[i].y;
      board.edges.add(coordEdgeKey(ax, ay, bx, by));
      board.packedEdges.add(packEdge(ax, ay, bx, by, board.cols));
    }
    board.paths.push({ text: text, path: path.map(p => ({ x: p.x, y: p.y, letter: p.letter })) });
  }

  /**
   * Randomized DFS over (cell, letterIndex).
   *
   * From the current cell, the next letter may go to
   *   (a) an EXISTING node holding that letter in an adjacent cell (preferred:
   *       this is what creates sharing), or
   *   (b) an adjacent empty cell (a new node).
   * The path is self-avoiding, stays inside the lattice box, must reuse at
   * least `minReuse` existing nodes, and may never create a diagonal that
   * visually crosses another shown diagonal.
   */
  function routeWord(board, text, rng, minReuse, budgetLimit, maxNew, style) {
    const n = text.length;
    const cols = board.cols;
    const rows = board.rows;
    const nCells = cols * rows;
    const occ = new Array(nCells);
    for (let i = 0; i < nCells; i++) occ[i] = null;
    for (const cell of board.occ.values()) occ[cell.y * cols + cell.x] = cell.letter;

    const path = [];
    const inPath = new Uint8Array(nCells);
    const pathEdges = new Set();
    const shownEdges = board.packedEdges;
    const newCap = maxNew == null ? Infinity : maxNew;
    const allowFresh = newCap > 0;
    let reuse = 0;
    let fresh = 0;
    let budget = budgetLimit;
    const straight = style === 'straight';
    let diagonalSteps = 0;

    function letterAt(x, y) {
      const i = y * cols + x;
      if (inPath[i]) return path[inPath[i] - 1].letter;
      return occ[i];
    }

    function hasPacked(ax, ay, bx, by) {
      const packed = packEdge(ax, ay, bx, by, cols);
      return shownEdges.has(packed) || pathEdges.has(packed);
    }

    function crosses(ax, ay, bx, by) {
      if (ax === bx || ay === by) return false;
      if (letterAt(ax, by) === null || letterAt(bx, ay) === null) return false;
      return hasPacked(ax, by, bx, ay);
    }

    function neighbourCount(x, y) {
      let count = 0;
      for (let o = 0; o < 8; o++) {
        const nx = x + OFFSETS[o][0];
        const ny = y + OFFSETS[o][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const i = ny * cols + nx;
        if (occ[i] !== null || inPath[i]) count++;
      }
      return count;
    }

    function candidates(from, letter, prev) {
      const out = [];
      for (let o = 0; o < 8; o++) {
        const nx = from.x + OFFSETS[o][0];
        const ny = from.y + OFFSETS[o][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const i = ny * cols + nx;
        if (inPath[i]) continue;
        const existing = occ[i];
        if (existing !== null && existing !== letter) continue;
        if (!allowFresh && existing === null) continue;
        if (crosses(from.x, from.y, nx, ny)) continue;
        const isReuse = existing !== null;
        const sameDir = prev &&
          (nx - from.x === from.x - prev.x) &&
          (ny - from.y === from.y - prev.y);
        const diag = nx !== from.x && ny !== from.y;
        let score = (isReuse ? 6 : 0) + neighbourCount(nx, ny) * 0.5 + rng() * 1.6;
        if (straight) {
          if (sameDir) score += 3.2;
          else if (prev) score -= 0.3;
          if (diag) score -= 0.4;
        } else {
          if (sameDir) score += 0.8;
          // Steer toward an even, readable mix instead of exhausting long
          // cardinal lanes around the rim before considering diagonals.
          const nextSteps = path.length;
          const nextDiags = diagonalSteps + (diag ? 1 : 0);
          score -= Math.abs(nextDiags - nextSteps * 0.48) * 2.2;
          const alongRim =
            (from.x === nx && (nx === 0 || nx === cols - 1)) ||
            (from.y === ny && (ny === 0 || ny === rows - 1));
          if (alongRim) score -= 1.4;
        }
        out.push({ x: nx, y: ny, letter: letter, reuse: isReuse, score: score });
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    }

    function push(cell) {
      const prev = path.length ? path[path.length - 1] : null;
      path.push(cell);
      inPath[cell.y * cols + cell.x] = path.length;
      if (prev) {
        pathEdges.add(packEdge(prev.x, prev.y, cell.x, cell.y, cols));
        if (isDiagonalStep(prev.x, prev.y, cell.x, cell.y)) diagonalSteps++;
      }
      if (cell.reuse) reuse++; else fresh++;
    }

    function pop() {
      const cell = path.pop();
      inPath[cell.y * cols + cell.x] = 0;
      const prev = path.length ? path[path.length - 1] : null;
      if (prev) {
        pathEdges.delete(packEdge(prev.x, prev.y, cell.x, cell.y, cols));
        if (isDiagonalStep(prev.x, prev.y, cell.x, cell.y)) diagonalSteps--;
      }
      if (cell.reuse) reuse--; else fresh--;
    }

    function extend(index) {
      if (index === n - 1) return reuse >= minReuse;
      if (budget-- <= 0) return false;
      if (reuse + (n - 1 - index) < minReuse) return false;
      if (fresh > newCap) return false;
      const from = path[index];
      const prev = index >= 1 ? path[index - 1] : null;
      const opts = candidates(from, text[index + 1], prev);
      for (let i = 0; i < opts.length; i++) {
        push(opts[i]);
        if (extend(index + 1)) return true;
        pop();
      }
      return false;
    }

    const starts = [];
    for (let i = 0; i < nCells; i++) {
      if (occ[i] === text[0]) {
        starts.push({
          x: i % cols, y: (i / cols) | 0, letter: text[0], reuse: true, score: 6 + rng()
        });
      }
    }
    if (allowFresh && (minReuse <= 0 || starts.length < 6)) {
      if (board.occ.size === 0) {
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            starts.push({ x: x, y: y, letter: text[0], reuse: false, score: rng() });
          }
        }
      } else {
        const seen = new Uint8Array(nCells);
        for (const cell of board.occ.values()) {
          for (let o = 0; o < 8; o++) {
            const nx = cell.x + OFFSETS[o][0];
            const ny = cell.y + OFFSETS[o][1];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const i = ny * cols + nx;
            if (occ[i] !== null || seen[i]) continue;
            seen[i] = 1;
            starts.push({ x: nx, y: ny, letter: text[0], reuse: false, score: rng() * 1.2 });
          }
        }
      }
    }
    starts.sort((a, b) => b.score - a.score);
    const limit = starts.length < 26 ? starts.length : 26;

    for (let s = 0; s < limit; s++) {
      path.length = 0;
      inPath.fill(0);
      pathEdges.clear();
      reuse = 0;
      fresh = 0;
      diagonalSteps = 0;
      push(starts[s]);
      if (n === 1 ? reuse >= minReuse : extend(0)) {
        const out = [];
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          out.push({ x: p.x, y: p.y, letter: p.letter });
        }
        return out;
      }
      pop();
      if (budget <= 0) break;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Word pools
   * ------------------------------------------------------------------ */
  function usableWords(list, minLen, maxLen) {
    const out = [];
    const seen = new Set();
    if (!Array.isArray(list)) return out;
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const w = raw.toLowerCase();
      if (w.length < minLen || w.length > maxLen) continue;
      if (!/^[a-z]+$/.test(w)) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
    return out;
  }

  function resolvePools(opts) {
    const rawCommon = (opts.words && opts.words.length) ? opts.words : FALLBACK_COMMON;
    let rawLong = (opts.longWords && opts.longWords.length) ? opts.longWords : null;

    const regular = usableWords(rawCommon, CONFIG.regularMin, CONFIG.regularMax);
    if (!rawLong) {
      const mined = usableWords(rawCommon, CONFIG.longMin, CONFIG.longMax);
      rawLong = mined.length >= 4 ? mined : FALLBACK_LONG;
    }
    const long = usableWords(rawLong, CONFIG.longMin, CONFIG.longMax);
    return {
      regular: regular.length ? regular : usableWords(FALLBACK_COMMON, CONFIG.regularMin, CONFIG.regularMax),
      long: long.length ? long : usableWords(FALLBACK_LONG, CONFIG.longMin, CONFIG.longMax)
    };
  }

  /**
   * Words a reasonably smart player will think of. Hard mode still *promotes*
   * every common word the board can spell, but construction and trimming treat
   * this set as the ones worth keeping. When the caller omits it, the whole
   * common pool counts as familiar (tests, fallbacks).
   */
  function resolveFamiliar(opts, pools) {
    if (opts && opts.familiar instanceof Set) return opts.familiar;
    if (opts && Array.isArray(opts.familiar) && opts.familiar.length) {
      const set = new Set();
      for (const raw of opts.familiar) {
        if (typeof raw === 'string' && raw) set.add(raw.toLowerCase());
      }
      if (set.size) return set;
    }
    const set = new Set(pools.regular);
    for (const w of pools.long) set.add(w);
    return set;
  }

  function countLetters(word) {
    const counts = new Uint8Array(26);
    for (let i = 0; i < word.length; i++) counts[word.charCodeAt(i) - 97]++;
    return counts;
  }

  function boardLetterArr(letterCounts) {
    const have = new Uint8Array(26);
    for (const [ch, n] of letterCounts) {
      const i = ch.charCodeAt(0) - 97;
      if (i >= 0 && i < 26) have[i] = n > 255 ? 255 : n;
    }
    return have;
  }

  function deficitAgainst(wordCounts, have) {
    let def = 0;
    for (let c = 0; c < 26; c++) {
      const d = wordCounts[c] - have[c];
      if (d > 0) def += d;
    }
    return def;
  }

  /**
   * Saturation prefilter: the word's letter multiset must be a SUBSET of the
   * grid's letter multiset. A path is self-avoiding, so each letter instance
   * needs its own cell — a word needing two E's cannot be routed on a grid
   * holding one. Necessary (not sufficient); the tiny DFS decides the rest.
   */
  function multisetFits(word, letterCounts) {
    const need = new Map();
    for (const ch of word) {
      const n = (need.get(ch) || 0) + 1;
      if (n > (letterCounts.get(ch) || 0)) return false;
      need.set(ch, n);
    }
    return true;
  }

  /** How many new letter instances would `word` need beyond the board's bag? */
  function letterDeficit(word, letterCounts) {
    const need = new Map();
    let deficit = 0;
    for (const ch of word) {
      const n = (need.get(ch) || 0) + 1;
      need.set(ch, n);
      if (n > (letterCounts.get(ch) || 0)) deficit++;
    }
    return deficit;
  }

  function overlapsExisting(word, used) {
    for (const other of used) {
      if (isDerivedFrom(word, other) || isDerivedFrom(other, word)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Lexicon — dictionary + prefix index, built ONCE and reused
   * ------------------------------------------------------------------ */

  /**
   * A lexicon answers three questions in O(1):
   *   has(word)      is this a real word?
   *   isCommon(word) is it a word every player knows? (normal, never an extra)
   *   isPrefix(str)  could any real word start with this? (enumeration pruning)
   *
   * Prefixes are stored for every length up to PREFIX_DEPTH. On a 4x4 the
   * enumerator would otherwise walk every self-avoiding path past depth 5;
   * indexing the whole word (max 11 letters) keeps that walk on real stems.
   */
  const PREFIX_DEPTH = CONFIG.longMax;
  const FLAG_HARD_SHORT = 1;
  const FLAG_HARD_LONG = 2;
  const FLAG_EASY_SHORT = 4;
  const FLAG_EASY_LONG = 8;
  const FLAG_BASE = 16;
  const FLAG_EASY_BASE = 32;

  function decodeBase64(s) {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return new Uint8Array(Buffer.from(s, 'base64'));
    }
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * Expand the packed lexicon once. Words exist as a single shared string;
   * flags mark which difficulty pools each belongs to.
   */
  function unpackLexicon(data) {
    const words = String(data.w || '').split(' ').filter(Boolean);
    const flags = decodeBase64(String(data.f || ''));
    const prefixes = new Set();
    for (const w of words) {
      const n = Math.min(PREFIX_DEPTH, w.length);
      for (let i = 1; i <= n; i++) prefixes.add(w.slice(0, i));
    }
    const wordSet = new Set(words);
    const pools = {
      hard: { common: [], long: [], base: [] },
      easy: { common: [], long: [], base: [] }
    };
    const commonHard = new Set();
    const commonEasy = new Set();
    const n = Math.min(words.length, flags.length);
    for (let i = 0; i < n; i++) {
      const w = words[i];
      const f = flags[i];
      if (f & FLAG_HARD_SHORT) { pools.hard.common.push(w); commonHard.add(w); }
      if (f & FLAG_HARD_LONG) { pools.hard.long.push(w); commonHard.add(w); }
      if (f & FLAG_BASE) pools.hard.base.push(w);
      if (f & FLAG_EASY_SHORT) { pools.easy.common.push(w); commonEasy.add(w); }
      if (f & FLAG_EASY_LONG) { pools.easy.long.push(w); commonEasy.add(w); }
      if (f & FLAG_EASY_BASE) pools.easy.base.push(w);
    }
    return {
      words: wordSet,
      prefixes: prefixes,
      commonHard: commonHard,
      commonEasy: commonEasy,
      pools: pools
    };
  }

  /**
   * How many shorter common words sit inside `w` as a contiguous slice?
   * Checking substrings against the common set is O(L^2); scanning every
   * common word with indexOf was O(|common|). `limit` is an early-out:
   * screening only needs to know whether a candidate embeds more than one.
   */
  function countEmbeddedCommons(w, commonSet, limit) {
    if (!commonSet || !commonSet.size) return 0;
    let embedded = 0;
    const n = w.length;
    for (let i = 0; i <= n - 4; i++) {
      for (let len = 4; i + len <= n; len++) {
        if (len === n) continue;
        if (commonSet.has(w.slice(i, i + len))) {
          embedded++;
          if (limit != null && embedded > limit) return embedded;
        }
      }
    }
    return embedded;
  }

  function screenBaseWords(baseSource, commonSet) {
    const baseWords = [];
    const baseRoomy = [];
    if (!Array.isArray(baseSource) || !baseSource.length) return null;
    for (const raw of baseSource) {
      const w = String(raw).toLowerCase();
      const embedded = countEmbeddedCommons(w, commonSet, 1);
      if (embedded === 0) baseWords.push(w);
      if (embedded <= 1) baseRoomy.push(w);
    }
    return baseWords.length >= 40 ? baseWords
      : (baseRoomy.length >= 20 ? baseRoomy : null);
  }

  function finishLexicon(wordSet, prefixSet, commonSet, basePool) {
    return {
      size: wordSet.size,
      commonSize: commonSet.size,
      has: w => wordSet.has(w),
      isCommon: w => commonSet.has(w),
      isPrefix: p => (p.length > PREFIX_DEPTH ? true : prefixSet.has(p)),
      words: wordSet,
      common: commonSet,
      baseWords: basePool
    };
  }

  function lexiconFromPacked(unpacked, mode) {
    const easy = mode === 'easy';
    const commonSet = easy ? unpacked.commonEasy : unpacked.commonHard;
    const baseSource = unpacked.pools[easy ? 'easy' : 'hard'].base;
    return finishLexicon(
      unpacked.words,
      unpacked.prefixes,
      commonSet,
      screenBaseWords(baseSource, commonSet)
    );
  }

  function buildLexicon(dictRaw, commonList, longList, baseList) {
    const words = new Set();
    const prefixes = new Set();
    const common = new Set();

    function addWord(w) {
      if (!w) return;
      words.add(w);
      const n = Math.min(PREFIX_DEPTH, w.length);
      for (let i = 1; i <= n; i++) prefixes.add(w.slice(0, i));
    }

    if (typeof dictRaw === 'string' && dictRaw.length) {
      for (const w of dictRaw.split(/\s+/)) if (w) addWord(w.toLowerCase());
    } else if (Array.isArray(dictRaw)) {
      for (const w of dictRaw) if (w) addWord(String(w).toLowerCase());
    }
    for (const list of [commonList, longList]) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        if (!raw) continue;
        const w = String(raw).toLowerCase();
        addWord(w);
        common.add(w);
      }
    }
    const baseSource = Array.isArray(baseList) && baseList.length ? baseList : longList;
    return finishLexicon(words, prefixes, common, screenBaseWords(baseSource, common));
  }

  /* ------------------------------------------------------------------ *
   * Puzzle quality ("is this board fun?")
   * ------------------------------------------------------------------ */

  /** Map a raw value onto 0..1 across [lo, hi]. */
  function ramp(value, lo, hi) {
    if (hi === lo) return 0;
    return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  }

  /* Endings that build a new word out of an existing one. Finding "print" and
   * then "printer" is not a second discovery — it's the same word again. Note
   * this is deliberately about SHARED ROOTS, not shared letters: race/trace,
   * live/olive and cell/cellar are different words that happen to overlap, and
   * those are fun to spot. */
  const DERIVED_SUFFIXES = [
    's', 'es', 'ed', 'd', 'ing', 'er', 'r', 'est', 'st',
    'ly', 'y', 'ness', 'ment', 'ful', 'less', 'able', 'ible',
    'ist', 'ize', 'ise', 'ion', 'tion', 'al'
  ];

  /* Pairs that look like stem + suffix but are unrelated words. The stem must
   * itself be 4+ letters to ever reach this check, which already rules out
   * most of them (letter/let, summer/sum, manner/man). */
  const NOT_DERIVED = new Set([
    'corn|corner', 'flow|flower', 'mast|master', 'moth|mother', 'numb|number',
    'cove|cover', 'part|party', 'count|county', 'brow|brown', 'butt|butter',
    'fast|faster', 'tow|tower', 'lift|lifter', 'hang|hanger', 'poem|poems',
    'stat|state', 'plan|plane', 'plan|planet', 'come|comet', 'cast|caste',
    'char|charm', 'form|former', 'mine|miner', 'pain|paint', 'rest|rester',
    'wine|winter', 'sting|stinger', 'cent|center', 'cove|covert', 'ward|warden'
  ]);

  /**
   * Is `long` just `short` wearing a suffix? Handles the usual spelling
   * adjustments: silent-e drop (bake -> baking), consonant doubling
   * (stop -> stopper) and y -> i (happy -> happier).
   */
  function isDerivedFrom(short, long) {
    if (long.length <= short.length) return false;
    if (NOT_DERIVED.has(short + '|' + long)) return false;
    const stems = [short];
    if (short.endsWith('e')) stems.push(short.slice(0, -1));
    if (short.endsWith('y')) stems.push(short.slice(0, -1) + 'i');
    const last = short[short.length - 1];
    if (last === short[short.length - 2]) stems.push(short.slice(0, -1));
    else stems.push(short + last);
    for (const stem of stems) {
      if (!long.startsWith(stem)) continue;
      const tail = long.slice(stem.length);
      if (tail && DERIVED_SUFFIXES.indexOf(tail) !== -1) return true;
    }
    return false;
  }

  /**
   * Play the board out in a couple of random orders and watch how it melts.
   * A solve that removes nothing is "inert": the counter ticks but the board
   * doesn't move. A handful is fine (letters are shared, that's the game); a
   * long run of them means the puzzle sits still while you work.
   */
  function meltFlow(puzzle) {
    const ORDERS = 2;
    let inert = 0;
    let solves = 0;
    let longestRun = 0;
    for (let pass = 0; pass < ORDERS; pass++) {
      const copy = clonePuzzleForSim(puzzle);
      const order = copy.words.map(w => w.text);
      // Deterministic shuffle per pass so scoring is stable for a given board.
      for (let i = order.length - 1; i > 0; i--) {
        const j = (i * 7 + pass * 13 + order.length) % (i + 1);
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
      let run = 0;
      for (const text of order) {
        const index = findWordIndex(copy, text);
        if (index < 0) continue;
        const before = copy.cells.length;
        copy.words[index].found = true;
        computeUnion(copy);
        solves++;
        if (copy.cells.length === before) {
          inert++;
          run++;
          if (run > longestRun) longestRun = run;
        } else {
          run = 0;
        }
      }
    }
    return {
      inertShare: solves ? inert / solves : 0,
      longestInertRun: longestRun
    };
  }

  /** Structural clone deep enough for meltFlow to mutate freely. */
  function clonePuzzleForSim(puzzle) {
    return {
      cells: puzzle.cells.map(c => ({ id: c.id, x: c.x, y: c.y, letter: c.letter })),
      allCells: puzzle.allCells.map(c => ({ id: c.id, x: c.x, y: c.y, letter: c.letter })),
      edges: puzzle.edges.map(e => [e[0], e[1]]),
      words: puzzle.words.map(w => ({
        text: w.text,
        cellIds: w.cellIds.slice(),
        found: false,
        isLong: w.isLong
      })),
      gridSize: puzzle.gridSize,
      cellsUsed: puzzle.cellsUsed
    };
  }

  const DISTINCTIVE_LETTER_VALUE = {
    j: 4, q: 4, x: 3, z: 4,
    k: 1, v: 1, w: 1, y: 1
  };

  function distinctiveValue(word) {
    let value = 0;
    const seen = new Set();
    for (const letter of word) {
      if (seen.has(letter)) continue;
      seen.add(letter);
      value += DISTINCTIVE_LETTER_VALUE[letter] || 0;
    }
    return value;
  }

  function asFamiliarSet(familiar) {
    if (!familiar) return null;
    if (familiar instanceof Set) return familiar.size ? familiar : null;
    if (Array.isArray(familiar) && familiar.length) return new Set(familiar);
    return null;
  }

  function uniqueCellShare(puzzle, word) {
    if (!word) return 0;
    const live = puzzle.words.filter(w => !w.found);
    const counts = new Map();
    for (const w of live) {
      for (const id of w.cellIds) counts.set(id, (counts.get(id) || 0) + 1);
    }
    let remaining = 0;
    const seen = new Set();
    for (const w of live) {
      for (const id of w.cellIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        remaining++;
      }
    }
    if (!remaining) return 0;
    let unique = 0;
    for (const id of word.cellIds) if (counts.get(id) === 1) unique++;
    return unique / remaining;
  }

  function uniqueOwnerShare(puzzle) {
    const live = puzzle.words.filter(w => !w.found);
    if (!live.length) return 0;
    const counts = new Map();
    for (const w of live) {
      for (const id of w.cellIds) counts.set(id, (counts.get(id) || 0) + 1);
    }
    let owners = 0;
    for (const w of live) {
      if (w.cellIds.some(id => counts.get(id) === 1)) owners++;
    }
    return owners / live.length;
  }

  function findability(word, cells, familiar) {
    const wig = routeWiggliness(cells, word.cellIds);
    const rare = familiar && !familiar.has(word.text) ? 10 : 0;
    return word.text.length * 1.2 + rare + wig.score * 1.4 - distinctiveValue(word.text) * 0.4;
  }

  function countHooks(puzzle, familiar) {
    const cells = puzzle.allCells && puzzle.allCells.length ? puzzle.allCells : puzzle.cells;
    let n = 0;
    for (const w of puzzle.words) {
      if (w.isLong || w.text.length > 5) continue;
      if (familiar && !familiar.has(w.text)) continue;
      const wig = routeWiggliness(cells, w.cellIds);
      if (wig.turns <= 2 && wig.diags <= 2) n++;
    }
    return n;
  }

  /**
   * Play the required set in easy-first order and estimate wall-clock seconds
   * for a reasonably smart player. Uses union updates only (no collapse) so
   * scoring stays cheap enough for the restart loop.
   */
  function estimateSolveSec(puzzle, familiar) {
    const copy = clonePuzzleForSim(puzzle);
    const cells = copy.allCells;
    const ranked = copy.words.slice().sort((a, b) =>
      findability(a, cells, familiar) - findability(b, cells, familiar)
    );
    const longWord = copy.words.find(w => w.isLong) || null;
    const longShareStart = uniqueCellShare(copy, longWord);
    const midAt = Math.max(1, Math.floor(ranked.length * 0.4));
    let longShareMid = longShareStart;
    let longFoundEarly = false;
    let sec = 0;
    let inertRun = 0;
    let solved = 0;
    for (const word of ranked) {
      const index = findWordIndex(copy, word.text);
      if (index < 0) continue;
      const before = copy.cells.length;
      copy.words[index].found = true;
      computeUnion(copy);
      const inert = copy.cells.length === before;
      const wig = routeWiggliness(cells, word.cellIds);
      let cost = 10 + word.text.length * 2;
      if (familiar && !familiar.has(word.text)) cost += 14;
      cost += wig.score * 1.4;
      if (inert) {
        inertRun++;
        cost += 4 + inertRun * 2;
      } else {
        inertRun = 0;
        cost *= 0.88;
      }
      cost *= Math.max(0.5, 1 - solved * 0.045);
      sec += cost;
      solved++;
      if (word.isLong) longFoundEarly = solved <= midAt;
      if (solved === midAt && longWord && !longWord.found) {
        longShareMid = uniqueCellShare(copy, longWord);
      }
    }
    const emerged = longFoundEarly || longShareMid > longShareStart * 1.05;
    if (!emerged) sec += 12;
    return { sec: sec, emerged: emerged };
  }

  /**
   * Score a finished puzzle on the things that actually make it fun to play.
   * Returns { score (0-100), parts } so the generator can hold out for a good
   * board and so tests/tools can see WHY a board scored the way it did.
   *
   *  density      letters spelled per cell. A dense graph means every orb is
   *               pulling weight in several words — the whole point of the game.
   *  freshness    penalty for words contained in other words (print/printer):
   *               they inflate the count without being separate discoveries.
   *  melt         share of solves that actually change the board.
   *  variety      spread of word lengths, so a board isn't all four-letter words.
   *  extras       rare words available to stumble on for time back.
   *  familiarity  share of required words a reasonably smart player knows.
   *  hooks        short, straight, familiar opening finds.
   *  edgeMix      diagonal/cardinal and directional variety, especially in
   *               the headline path, without long runs around the perimeter.
   *  pace         estimated solve time; under 5 minutes is the target.
   */
  function scorePuzzle(puzzle, lexicon, extraCount, familiar) {
    const texts = puzzle.words.map(w => w.text);
    const letters = texts.reduce((sum, t) => sum + t.length, 0);
    const cells = puzzle.cells.length || 1;
    const familiarSet = asFamiliarSet(familiar);

    let subwordPairs = 0;
    for (let i = 0; i < texts.length; i++) {
      for (let j = 0; j < texts.length; j++) {
        if (i !== j && isDerivedFrom(texts[i], texts[j])) subwordPairs++;
      }
    }

    const flow = meltFlow(puzzle);
    const lengths = new Set(texts.map(t => t.length));
    const regular = texts.filter(t => t.length < CONFIG.longMin);
    const fourShare = regular.length
      ? regular.filter(t => t.length === 4).length / regular.length
      : 0;
    let familiarCount = texts.length;
    if (familiarSet) {
      familiarCount = 0;
      for (const t of texts) if (familiarSet.has(t)) familiarCount++;
    }
    const familiarShare = texts.length ? familiarCount / texts.length : 1;
    const pace = estimateSolveSec(puzzle, familiarSet);
    const hooks = countHooks(puzzle, familiarSet);
    const edgeMix = puzzleEdgeMix(puzzle);

    const parts = {
      density: ramp(letters / cells, 2.6, 4.6),
      freshness: 1 - ramp(subwordPairs, 0, 4),
      // Two ways melting goes wrong: too many solves that change nothing, and
      // long stretches where the board sits still.
      melt: (ramp(1 - flow.inertShare, 0.3, 0.7) + (1 - ramp(flow.longestInertRun, 2, 6))) / 2,
      variety: (ramp(lengths.size, 2, 5) + (1 - ramp(fourShare, 0.15, 0.55))) / 2,
      extras: ramp(extraCount || 0, 2, 14),
      familiarity: ramp(familiarShare, 0.7, 1.0),
      hooks: ramp(hooks, 0, 3),
      edgeMix: edgeMix.value,
      pace: 1 - ramp(pace.sec, 90, 300)
    };
    const score = Math.round(
      parts.density * 20 +
      parts.freshness * 15 +
      parts.melt * 17 +
      parts.variety * 8 +
      parts.extras * 6 +
      parts.familiarity * 12 +
      parts.hooks * 6 +
      parts.edgeMix * 8 +
      parts.pace * 8
    );
    parts.subwordPairs = subwordPairs;
    parts.lettersPerCell = letters / cells;
    parts.inertShare = flow.inertShare;
    parts.longestInertRun = flow.longestInertRun;
    parts.familiarShare = familiarShare;
    parts.hookCount = hooks;
    parts.estimateSec = pace.sec;
    parts.emerged = pace.emerged;
    parts.uniqueOwnerShare = uniqueOwnerShare(puzzle);
    parts.fourShare = fourShare;
    parts.boardDiagonalShare = edgeMix.board.diagonalShare;
    parts.headlineDiagonalShare = edgeMix.headline ? edgeMix.headline.diagonalShare : 0;
    parts.headlinePerimeterShare = edgeMix.headline ? edgeMix.headline.perimeterShare : 0;
    return { score: score, parts: parts };
  }

  /* ------------------------------------------------------------------ *
   * Enumeration — every word the board can actually spell
   * ------------------------------------------------------------------ */

  /**
   * Walk every self-avoiding path along the SHOWN edges and collect the ones
   * that spell a real word. This is the ground truth of "words that exist in
   * the puzzle": if the player can trace it, it is in here.
   *
   * Enumeration is monotone over a game: solving a word only removes nodes and
   * edges, so no new word can ever become traceable later.
   *
   * Returns Map(word -> route as an array of cell ids).
   */
  function enumerateWords(cells, edges, lexicon, options) {
    const opts = options || {};
    const minLen = opts.minLength || 4;
    const maxLen = opts.maxLength || 11;
    const adj = adjacencyMap(cells, edges);
    const byId = new Map(cells.map(c => [c.id, c]));
    const found = new Map();
    const path = [];
    const used = new Set();

    function walk(id, str) {
      path.push(id);
      used.add(id);
      if (str.length >= minLen && !found.has(str) && lexicon.has(str)) {
        found.set(str, path.slice());
      }
      if (str.length < maxLen) {
        for (const next of adj.get(id) || []) {
          if (used.has(next)) continue;
          const cell = byId.get(next);
          if (!cell) continue;
          const nextStr = str + cell.letter;
          if (!lexicon.isPrefix(nextStr)) continue;
          walk(next, nextStr);
        }
      }
      path.pop();
      used.delete(id);
    }

    for (const cell of cells) {
      if (!lexicon.isPrefix(cell.letter)) continue;
      walk(cell.id, cell.letter);
    }
    return found;
  }

  /** Just the common (normal-set-worthy) words the board can spell. */
  function enumerateCommon(cells, edges, lexicon, options) {
    const all = enumerateWords(cells, edges, lexicon, options);
    const out = new Map();
    for (const [word, route] of all) {
      if (lexicon.isCommon(word)) out.set(word, route);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Generation — Cascade Pack on a fixed 4 x 4
   * ------------------------------------------------------------------ */

  /**
   * Phase 0: lay a readable base path. Production games pass the headline
   * chosen for the whole generation run; small unscreened pools may still
   * sample candidates here. Keep the best route mix without hugging the rim.
   */
  function placeBaseWord(board, pools, rng, headline) {
    let best = null;
    let bestMix = -Infinity;
    const tries = CONFIG.basePlaceTries || 3;
    for (let attempt = 0; attempt < tries; attempt++) {
      const candidate = headline || chooseHeadlineWord(pools.long, rng);
      const path = routeWord(board, candidate, rng, 0, CONFIG.longRouteBudget, null, 'mixed');
      if (!path) continue;
      const mix = edgeMixValue(edgeMixGeometry(path, board.cols));
      if (mix > bestMix) {
        bestMix = mix;
        best = { text: candidate, path: path };
        if (bestMix >= 0.95) break;
      }
    }
    if (!best) return null;
    commitPath(board, best.text, best.path);
    return best.text;
  }

  function minePaletteCandidates(board, meta, used, extraSlots, rng, limit) {
    const have = boardLetterArr(board.letterCounts);
    const cap = limit || 320;
    const out = [];
    let seen = 0;
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      if (used.has(m.w)) continue;
      const deficit = deficitAgainst(m.counts, have);
      if (deficit > extraSlots) continue;
      if (m.len - deficit < 2) continue;
      seen++;
      if (out.length < cap) out.push(m.w);
      else {
        const j = Math.floor(rng() * seen);
        if (j < cap) out[j] = m.w;
      }
    }
    return out;
  }

  /**
   * Greedy-pick a family of overlapping familiar words from the palette.
   * Favours length variety and letters the script has not claimed yet.
   * Hard mode (`preferLong`) pushes 6-7 letter finds and caps 4-letter
   * filler at a couple of opening hooks.
   */
  function pickScript(board, candidates, rng, wantCount, used, preferLong, commonSet, countsByWord, embedCache) {
    const script = [];
    const lengthCounts = new Map();
    const letterClaim = new Map();
    const remaining = [];
    for (let i = 0; i < candidates.length; i++) {
      const word = candidates[i];
      if (!overlapsExisting(word, used)) remaining.push(word);
    }
    const have = boardLetterArr(board.letterCounts);
    const cache = embedCache || new Map();

    function scoreWord(word) {
      const counts = countsByWord.get(word);
      const deficit = counts ? deficitAgainst(counts, have) : letterDeficit(word, board.letterCounts);
      const overlap = word.length - deficit;
      const lenCount = lengthCounts.get(word.length) || 0;
      const varietyBonus = lenCount === 0 ? 4 : (lenCount === 1 ? 1.5 : -0.8);
      let underuse = 0;
      const seen = new Set();
      for (const ch of word) {
        if (seen.has(ch)) continue;
        seen.add(ch);
        const claimed = letterClaim.get(ch) || 0;
        const onBoard = have[ch.charCodeAt(0) - 97] || 0;
        if (claimed === 0 && onBoard > 0) underuse++;
        else if (claimed === 0) underuse += 0.5;
      }
      let lengthPref;
      if (preferLong) {
        const fours = lengthCounts.get(4) || 0;
        if (word.length <= 4) lengthPref = fours >= 2 ? -4 : 0.2;
        else if (word.length === 5) lengthPref = 1.2;
        else if (word.length === 6) lengthPref = 2.8;
        else lengthPref = 3.6;
        let embedded = cache.get(word);
        if (embedded == null) {
          embedded = countEmbeddedCommons(word, commonSet);
          cache.set(word, embedded);
        }
        lengthPref -= embedded * 1.4;
      } else {
        lengthPref = (word.length <= 5 ? 1.5 : 0) + (word.length >= 6 ? 0.8 : 0);
      }
      return overlap * 1.5 + varietyBonus + underuse * 1.2 + lengthPref +
        rng() * 0.6 - deficit * 0.4;
    }

    while (script.length < wantCount && remaining.length) {
      let bestI = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const word = remaining[i];
        const score = scoreWord(word);
        if (score > bestScore) {
          bestScore = score;
          bestI = i;
        }
      }
      if (bestI < 0) break;
      const word = remaining.splice(bestI, 1)[0];
      script.push(word);
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (isDerivedFrom(remaining[i], word) || isDerivedFrom(word, remaining[i])) {
          remaining.splice(i, 1);
        }
      }
      lengthCounts.set(word.length, (lengthCounts.get(word.length) || 0) + 1);
      const seen = new Set();
      for (const ch of word) {
        if (seen.has(ch)) continue;
        seen.add(ch);
        letterClaim.set(ch, (letterClaim.get(ch) || 0) + 1);
      }
    }
    return script;
  }

  /**
   * Route the script: shortest familiar words first as straight hooks, then
   * the rest preferring exactly one new cell so each owns a melt.
   */
  function routeScript(board, script, rng, used, cap) {
    const capacity = board.cellBudget || board.cols * board.rows;
    const ordered = script.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    let hooksLeft = 2;
    for (const word of ordered) {
      if (board.paths.length >= cap) break;
      if (used.has(word)) continue;
      const free = capacity - board.occ.size;
      if (free < 0) break;
      const isHook = hooksLeft > 0 && word.length <= 5;
      const style = isHook ? 'straight' : null;
      let path = null;
      if (!isHook && free >= 1) {
        path = routeWord(board, word, rng, 2, CONFIG.routeBudget, Math.min(1, free), style);
      }
      if (!path) {
        const maxNew = Math.min(Math.max(0, word.length - 2), free);
        path = routeWord(board, word, rng, 2, CONFIG.routeBudget, maxNew, style);
      }
      if (!path) {
        const maxNew = Math.min(Math.max(0, word.length - 2), free);
        path = routeWord(board, word, rng, 1, CONFIG.routeBudgetRelaxed, maxNew, style);
      }
      if (!path) continue;
      commitPath(board, word, path);
      used.add(word);
      if (isHook) hooksLeft--;
    }
  }

  /**
   * A short familiar-only saturate so the graph stays dense without spawning
   * a thicket of obscure commons. Caps extra laid words so enumeration does
   * not overspell.
   */
  function saturateFamiliar(board, rng, used, cap, preferLong, pool) {
    if (!pool || !pool.length) return;
    const extra = (CONFIG.saturateExtra || 2) + (preferLong ? 1 : 0);
    const extraCap = Math.min(cap, board.paths.length + extra);
    const limit = Math.min(pool.length, CONFIG.saturateScan);
    const offset = Math.floor(rng() * pool.length);
    const letters = board.letterCounts;
    for (let i = 0; i < limit && board.paths.length < extraCap; i++) {
      const candidate = pool[(offset + i) % pool.length];
      if (used.has(candidate)) continue;
      if (preferLong && candidate.length < 5 && board.paths.length >= 5) continue;
      if (!letters.has(candidate[0])) continue;
      if (overlapsExisting(candidate, used)) continue;
      if (!multisetFits(candidate, letters)) continue;
      const path = routeWord(board, candidate, rng, candidate.length, CONFIG.saturateBudget, 0, 'straight');
      if (path) {
        commitPath(board, candidate, path);
        used.add(candidate);
      }
    }
  }

  function buildBoard(pools, rng, cap, size, cellBudget, preferLong, poolMeta, commonSet, countsByWord, pool, embedCache, mainWord) {
    const board = createBoard(size, size, cellBudget);
    const longText = placeBaseWord(board, pools, rng, mainWord);
    if (!longText) return null;
    const used = new Set([longText]);
    const extraSlots = Math.max(0, (board.cellBudget || size * size) - board.occ.size);
    const candidates = minePaletteCandidates(board, poolMeta, used, extraSlots, rng, 320);
    const want = Math.max(0, cap - 1);
    const script = pickScript(board, candidates, rng, want, used, preferLong, commonSet, countsByWord, embedCache);
    routeScript(board, script, rng, used, cap);
    saturateFamiliar(board, rng, used, cap, preferLong, pool);
    return { board: board, longText: longText };
  }

  function materialize(board, longText) {
    const idByCoord = new Map();
    const allCells = [];
    let nextId = 1;
    for (const cell of board.occ.values()) {
      const node = { id: nextId++, x: cell.x, y: cell.y, letter: cell.letter };
      idByCoord.set(key(cell.x, cell.y), node.id);
      allCells.push(node);
    }
    const words = board.paths.map(p => ({
      text: p.text,
      cellIds: p.path.map(c => idByCoord.get(key(c.x, c.y))),
      found: false,
      isLong: p.text === longText
    }));
    words.sort((a, b) => (b.isLong ? 1 : 0) - (a.isLong ? 1 : 0));
    const puzzle = {
      allCells: allCells,
      cells: [],
      edges: [],
      words: words,
      longWord: longText,
      mainWord: longText,
      gridSize: board.cols,
      cellsUsed: allCells.length
    };
    computeUnion(puzzle);
    recenter(puzzle);
    return puzzle;
  }

  /** Split an enumeration into the common (solvable) words and a rare count. */
  function splitTraceable(traceable, lexicon, requiredWord) {
    const commons = new Map();
    let extraCount = 0;
    for (const [word, route] of traceable) {
      if (lexicon.isCommon(word) || word === requiredWord) commons.set(word, route);
      else extraCount++;
    }
    return { commons: commons, extraCount: extraCount };
  }

  function routeEdgeKeys(route) {
    const keys = [];
    for (let i = 1; i < route.length; i++) keys.push(edgeKey(route[i - 1], route[i]));
    return keys;
  }

  function cellsUsedByCommons(commons) {
    const live = new Set();
    for (const route of commons.values()) {
      for (const id of route) live.add(id);
    }
    return live.size;
  }

  // A pruning cut should spend the most disposable words first. Unfamiliar
  // (hard-only) words and same-root pairs go first; length and distinctive
  // letters still protect real discoveries such as "quiz" and "stone".
  function derivedPairWords(texts) {
    const dirty = new Set();
    for (let i = 0; i < texts.length; i++) {
      for (let j = 0; j < texts.length; j++) {
        if (i !== j && isDerivedFrom(texts[i], texts[j])) {
          dirty.add(texts[i]);
          dirty.add(texts[j]);
        }
      }
    }
    return dirty;
  }

  function pruneWordValue(word, opts) {
    const options = opts || {};
    // Four-letter words are plentiful and the first thing a trim should spend.
    // Each extra letter squares the keep-value so 6- and 7-letter finds survive.
    const lengthValue = word.length <= 4 ? 0.5 : Math.pow(word.length - 3, 2);
    let value = lengthValue + distinctiveValue(word);
    const familiar = options.familiar;
    if (familiar && familiar.size && !familiar.has(word)) value *= 0.25;
    if (options.derived && options.derived.has(word)) value *= 0.35;
    return value;
  }

  /**
   * Snip connections until the board spells the target number of common words.
   *
   * Every edge carries some set of words; cutting one removes exactly those,
   * so this is a cheaper and better-behaved fix than discarding the board. Two
   * things are protected: the base word's own route (the puzzle must keep its
   * headline) and any cut that would drop the count below the floor.
   * Unfamiliar and same-root filler are cheapest to cut, so the board that
   * remains is the one a reasonably smart player can finish.
   *
   * After a cut we re-route only the words whose current path used that edge
   * instead of walking the whole graph again. Enumeration is monotone: cutting
   * an edge cannot make a new common word appear.
   */
  function trimToWordCount(cells, edges, split, lexicon, longText, minWords, maxWords, familiar) {
    let liveEdges = edges.slice();
    let current = { commons: new Map(split.commons), extraCount: split.extraCount };
    const familiarSet = asFamiliarSet(familiar);
    const byId = new Map(cells.map(c => [c.id, c]));

    const baseRoute = current.commons.get(longText);
    const protectedKeys = new Set(baseRoute ? routeEdgeKeys(baseRoute) : []);

    function applyCut(cutKey) {
      const remaining = [];
      for (let i = 0; i < liveEdges.length; i++) {
        const e = liveEdges[i];
        if (edgeKey(e[0], e[1]) !== cutKey) remaining.push(e);
      }
      const nextAdj = adjacencyMap(cells, remaining);
      const nextCommons = new Map();
      for (const [word, route] of current.commons) {
        let usesCut = false;
        for (const k of routeEdgeKeys(route)) {
          if (k === cutKey) { usesCut = true; break; }
        }
        if (!usesCut) {
          nextCommons.set(word, route);
          continue;
        }
        const alt = findRouteFrom(nextAdj, byId, cells, word);
        if (alt) nextCommons.set(word, alt);
      }
      return { edges: remaining, adj: nextAdj, commons: nextCommons };
    }

    for (let pass = 0; pass < 24 && current.commons.size > maxWords; pass++) {
      const derived = derivedPairWords(Array.from(current.commons.keys()));
      const cost = new Map();
      for (const [word, route] of current.commons) {
        if (word === longText) continue;
        for (const k of routeEdgeKeys(route)) {
          if (protectedKeys.has(k)) continue;
          const entry = cost.get(k) || { count: 0, value: 0 };
          entry.count++;
          entry.value += pruneWordValue(word, { familiar: familiarSet, derived: derived });
          cost.set(k, entry);
        }
      }
      if (!cost.size) break;

      const excess = current.commons.size - maxWords;
      const floorRoom = current.commons.size - minWords;
      let bestKey = null;
      let bestOvershoot = Infinity;
      let bestAverageValue = Infinity;
      let bestCount = 0;
      for (const [k, entry] of cost) {
        const n = entry.count;
        if (n > floorRoom) continue;
        const overshoot = Math.max(0, n - excess);
        const averageValue = entry.value / n;
        if (overshoot < bestOvershoot ||
            (overshoot === bestOvershoot && averageValue < bestAverageValue) ||
            (overshoot === bestOvershoot && averageValue === bestAverageValue && n > bestCount)) {
          bestOvershoot = overshoot;
          bestAverageValue = averageValue;
          bestCount = n;
          bestKey = k;
        }
      }
      if (bestKey === null) break;

      const next = applyCut(bestKey);
      if (!next.commons.has(longText) || next.commons.size < minWords) break;
      if (next.commons.size >= current.commons.size) {
        protectedKeys.add(bestKey);
        continue;
      }
      liveEdges = next.edges;
      current = { commons: next.commons, extraCount: current.extraCount };
    }

    return { edges: liveEdges, split: current };
  }

  /**
   * Turn a constructed board into a finished puzzle.
   *
   * The solvable set is defined by commonness, not construction history: every
   * common word the board can spell becomes required. Extras are exclusively
   * the rare dictionary words. Returns null when a second 8+ letter common
   * word would rival the base word.
   */
  function finishPuzzle(board, longText, lexicon, minWords, maxWords, minCells, familiar, targetWords, mainWord) {
    const puzzle = materialize(board, longText);
    let edges = puzzle.edges;
    let split = splitTraceable(enumerateWords(puzzle.cells, edges, lexicon), lexicon, mainWord);
    let trimmed = false;

    // Always cap at maxWords (the 10-16 contract). Then try the tighter
    // per-mode target (13 on hard, 10 on easy) — keep that cut only if the
    // board still has enough cells to read as a grid.
    if (split.commons.size > maxWords) {
      const cut = trimToWordCount(
        puzzle.cells, edges, split, lexicon, longText, minWords, maxWords, familiar
      );
      edges = cut.edges;
      split = cut.split;
      puzzle.edges = edges;
      trimmed = true;
    }
    const floor = minCells || CONFIG.minCells;
    if (targetWords != null && split.commons.size > targetWords) {
      const cut = trimToWordCount(
        puzzle.cells, edges, split, lexicon, longText, minWords, targetWords, familiar
      );
      if (cut.split.commons.has(longText) &&
          cut.split.commons.size >= minWords &&
          cellsUsedByCommons(cut.split.commons) >= floor) {
        edges = cut.edges;
        split = cut.split;
        puzzle.edges = edges;
        trimmed = true;
      }
    }
    if (trimmed) {
      // Incremental trim keeps extraCount stale and may hold a non-canonical
      // route. One full walk on the final graph restores both.
      split = splitTraceable(enumerateWords(puzzle.cells, edges, lexicon), lexicon, mainWord);
    }
    const commons = split.commons;
    let extraCount = split.extraCount;

    // The base word must be the one and only long word in the solvable set.
    for (const word of commons.keys()) {
      if (word.length >= CONFIG.longMin && word !== longText) return null;
    }
    if (!commons.has(longText)) return null;
    if (commons.size < minWords || commons.size > maxWords) {
      return { rejected: true, normalCount: commons.size, puzzle: null };
    }

    // Every word takes the route the enumerator found for it, including words
    // that were laid down during construction. Their original path may have
    // crossed a connection that trimming has since cut, and reusing it would
    // put that connection back — reviving the words the cut was meant to
    // remove and breaking the "everything shown is used" promise.
    const words = [];
    for (const [text, route] of commons) {
      words.push({
        text: text,
        cellIds: route.slice(),
        found: false,
        isLong: text === longText
      });
    }
    words.sort((a, b) => (b.isLong ? 1 : 0) - (a.isLong ? 1 : 0));
    puzzle.words = words;
    computeUnion(puzzle);
    // Trimming can leave a cell with no word running through it. Nothing has
    // been solved yet, so such a cell was never part of this puzzle: drop it
    // from the master list rather than carrying a letter no word can use.
    const liveIds = new Set(puzzle.cells.map(c => c.id));
    if (liveIds.size !== puzzle.allCells.length) {
      puzzle.allCells = puzzle.allCells.filter(c => liveIds.has(c.id));
    }
    recenter(puzzle);
    puzzle.cellsUsed = puzzle.cells.length;

    // Checked after the union settles: trimming can strand cells, and it is
    // the final board that has to read as a grid.
    if (puzzle.cells.length < (minCells || CONFIG.minCells)) {
      return { rejected: true, normalCount: commons.size, puzzle: null };
    }
    return {
      rejected: false,
      normalCount: words.length,
      extraCount: extraCount,
      puzzle: puzzle
    };
  }

  let lexiconCache = null;
  function resolveLexicon(opts, pools) {
    if (opts.lexicon) return opts.lexicon;
    const dictRaw = opts.dictRaw != null ? opts.dictRaw : '';
    if (lexiconCache && lexiconCache.dictRaw === dictRaw &&
        lexiconCache.regular === pools.regular && lexiconCache.long === pools.long) {
      return lexiconCache.lexicon;
    }
    const lexicon = buildLexicon(dictRaw, pools.regular, pools.long);
    lexiconCache = { dictRaw: dictRaw, regular: pools.regular, long: pools.long, lexicon: lexicon };
    return lexicon;
  }

  // A shared seed reserves a small, opaque header for the requested main
  // word. The remaining bits still vary the board, while ordinary seeds keep
  // their original generation behavior. The word list is the lexicon's
  // canonical insertion order, so the same seed and data rebuild the same
  // requested word without putting that word in the URL.
  const SHARED_SEED_TAG = 0xff000000;
  const SHARED_SEED_INDEX_MASK = 0x0003ffff;
  const SHARED_SEED_VARIATION_MASK = 0x00fc0000;

  function randomPuzzleSeed() {
    const value = Math.floor(Math.random() * 0xffffffff) >>> 0;
    // 0xff marks an encoded custom word. Keep ordinary random games out of
    // that namespace so their later share links rebuild the same board.
    return (value >>> 24) === 0xff ? (value & 0xfeffffff) >>> 0 : value;
  }

  function sharedMainWords(lexicon) {
    const words = [];
    if (!lexicon || !lexicon.words) return words;
    for (const raw of lexicon.words) {
      const word = String(raw).toLowerCase();
      if (word.length >= CONFIG.mainMin && word.length <= CONFIG.mainMax &&
          /^[a-z]+$/.test(word)) words.push(word);
    }
    return words;
  }

  function mainWordFromSeed(seed, lexicon) {
    const value = seed >>> 0;
    if ((value >>> 24) !== 0xff) return null;
    const words = sharedMainWords(lexicon);
    const index = value & SHARED_SEED_INDEX_MASK;
    return words[index] || null;
  }

  function seedForMainWord(seed, mainWord, options) {
    const opts = options || {};
    const pools = resolvePools(opts);
    const lexicon = opts.lexicon || resolveLexicon(opts, pools);
    const words = sharedMainWords(lexicon);
    const index = words.indexOf(String(mainWord || '').toLowerCase());
    if (index < 0 || index > SHARED_SEED_INDEX_MASK) return null;
    const base = seed === undefined || seed === null
      ? Math.floor(Math.random() * 0xffffffff)
      : (seed >>> 0);
    return (SHARED_SEED_TAG | (base & SHARED_SEED_VARIATION_MASK) | index) >>> 0;
  }

  function generatePuzzle(options) {
    const opts = options || {};
    // Every puzzle records the seed it grew from, so a finished game can be
    // handed to someone else as a link and rebuild exactly the same board.
    const hasExplicitSeed = opts.seed !== undefined && opts.seed !== null;
    const seed = !hasExplicitSeed
      ? randomPuzzleSeed()
      : (opts.seed >>> 0);
    const rng = opts.rng || createRng(seed);
    let pools = resolvePools(opts);
    const lexicon = resolveLexicon(opts, pools);
    const hasRequestedMain = opts.mainWord != null;
    const requestedMain = hasRequestedMain
      ? String(opts.mainWord).toLowerCase()
      : (hasExplicitSeed ? mainWordFromSeed(seed, lexicon) : null);
    if (requestedMain &&
        (!/^[a-z]+$/.test(requestedMain) ||
         requestedMain.length < CONFIG.mainMin ||
         requestedMain.length > CONFIG.mainMax ||
         !lexicon.has(requestedMain))) {
      return null;
    }
    // Prefer base words that don't embed other common words (see buildLexicon).
    let headlinePool = null;
    if (lexicon.baseWords && lexicon.baseWords.length) {
      const allowed = new Set(pools.long);
      const screened = lexicon.baseWords.filter(w => allowed.has(w));
      if (screened.length >= 20) {
        headlinePool = screened;
        pools = Object.assign({}, pools, { long: screened });
      }
    }
    // Select the headline once. Board construction may retry many times, but
    // those retries must not give easy-to-score words more lottery tickets.
    // Tiny fallback/test pools are not screened for headline fitness, so they
    // retain the old retry behavior to avoid one weak word blocking a game.
    const productionMode = opts.mode === 'easy' || opts.mode === 'hard';
    const headlineWord = requestedMain ||
      (productionMode && headlinePool ? chooseHeadlineWord(headlinePool, rng) : null);
    const size = opts.size || CONFIG.size;
    const minWords = opts.minWords || CONFIG.minWords;
    const minCells = opts.minCells || CONFIG.minCells;
    const maxWords = opts.maxWords || (opts.mode === 'easy' ? 10 : CONFIG.maxWords);
    const familiar = resolveFamiliar(opts, pools);
    const preferLong = opts.mode === 'hard';
    // Easy is a 10-word race; hard aims at 13 and trims 4-letter filler to land
    // there. Tests that omit `mode` keep a random target inside the 10-16 band.
    let targetWords = opts.targetWords;
    if (targetWords == null) {
      if (opts.mode === 'easy') targetWords = CONFIG.targetEasy;
      else if (opts.mode === 'hard') targetWords = CONFIG.targetHard;
      else targetWords = minWords + Math.floor(rng() * (maxWords - minWords + 1));
    }
    targetWords = Math.max(minWords, Math.min(maxWords, targetWords));
    const minFunScore = opts.minFunScore != null ? opts.minFunScore : CONFIG.minFunScore;
    const maxPaceSec = opts.maxPaceSec != null ? opts.maxPaceSec : CONFIG.maxPaceSec;
    const restarts = opts.restarts || CONFIG.restarts;
    const capacity = size * size;

    // How many words to lay down before enumeration takes over. Hard lays a
    // few more so the board can reach 13 without leaning on 4-letter filler.
    const constructMin = preferLong ? CONFIG.constructMin + 2 : CONFIG.constructMin;
    const constructMax = preferLong ? CONFIG.constructMax + 2 : CONFIG.constructMax;
    let construct = constructMin +
      Math.floor(rng() * (constructMax - constructMin + 1));

    const familiarRegular = [];
    for (const word of pools.regular) {
      if (!familiar.size || familiar.has(word)) familiarRegular.push(word);
    }
    const poolSource = familiarRegular.length ? familiarRegular : pools.regular;
    const poolMeta = [];
    const countsByWord = new Map();
    for (let i = 0; i < poolSource.length; i++) {
      const w = poolSource[i];
      const counts = countLetters(w);
      poolMeta.push({ w: w, counts: counts, len: w.length });
      countsByWord.set(w, counts);
    }
    const commonSet = lexicon.common;
    const embedCache = new Map();

    let best = null;
    let bestScore = -Infinity;
    let attempts = 0;
    let rejects = 0;
    for (let attempt = 0; attempt < restarts; attempt++) {
      attempts++;
      // Each attempt gets its own occupancy budget, so boards vary in
      // silhouette; the ceiling stays under capacity to force letter sharing.
      const budgetMin = Math.max(1, opts.budgetMin || CONFIG.budgetMin);
      const budgetMax = Math.min(capacity, opts.budgetMax || CONFIG.budgetMax);
      const cellBudget = budgetMin + Math.floor(rng() * Math.max(1, budgetMax - budgetMin + 1));
      const built = buildBoard(pools, rng, construct, size, cellBudget, preferLong, poolMeta, commonSet, countsByWord, poolSource, embedCache, headlineWord);
      if (!built) continue;
      const result = finishPuzzle(built.board, built.longText, lexicon, minWords, maxWords, minCells, familiar, targetWords, built.longText);
      if (!result) { rejects++; continue; }          // rival long word
      if (result.rejected) {
        rejects++;
        if (result.normalCount > targetWords && construct > 4) construct--;
        else if (result.normalCount < targetWords && construct < constructMax + 2) construct++;
        continue;
      }
      if (result.normalCount < targetWords && construct < constructMax + 2) construct++;
      else if (result.normalCount > targetWords && construct > constructMin) construct--;
      // Quality gate: keep pulling new boards until one is actually fun AND
      // a reasonably smart player can finish it in under five minutes.
      const quality = scorePuzzle(result.puzzle, lexicon, result.extraCount, familiar);
      const off = Math.abs(result.normalCount - targetWords);
      const onTarget = off === 0 ? 12 : (off === 1 ? 4 : 0);
      const fourPenalty = Math.round(ramp(quality.parts.fourShare, 0.35, 0.65) * 6);
      const pacePenalty = quality.parts.estimateSec > maxPaceSec ? 8 : 0;
      const score = quality.score + onTarget - pacePenalty - fourPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = result.puzzle;
        best.quality = quality;
      }
      if (quality.score >= minFunScore &&
          result.normalCount === targetWords &&
          quality.parts.estimateSec < maxPaceSec) break;
    }
    if (best) {
      best.attempts = attempts;
      best.rejects = rejects;
      best.seed = seed;
      return best;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Removal + compaction
   * ------------------------------------------------------------------ */
  function centroidOf(cells) {
    let sx = 0;
    let sy = 0;
    for (const c of cells) { sx += c.x; sy += c.y; }
    return { x: sx / cells.length, y: sy / cells.length };
  }

  function recenter(puzzle) {
    if (!puzzle.cells.length) return;
    let minX = Infinity;
    let minY = Infinity;
    for (const c of puzzle.cells) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
    }
    if (minX === 0 && minY === 0) return;
    for (const c of puzzle.cells) {
      c.x -= minX;
      c.y -= minY;
    }
  }

  function tryShift(puzzle, comp, dx, dy) {
    const compIds = new Set(comp.map(c => c.id));
    const blocked = new Set();
    for (const cell of puzzle.cells) {
      if (!compIds.has(cell.id)) blocked.add(key(cell.x, cell.y));
    }
    for (const cell of comp) {
      if (blocked.has(key(cell.x + dx, cell.y + dy))) return false;
    }
    for (const cell of comp) { cell.x += dx; cell.y += dy; }
    if (hasCrossing(puzzle.cells, puzzle.edges)) {
      for (const cell of comp) { cell.x -= dx; cell.y -= dy; }
      return false;
    }
    return true;
  }

  /**
   * Slide whole edge-connected components toward the centroid, one lattice
   * step at a time. Components move rigidly, so every remaining word keeps its
   * canonical route. Nodes may end up lattice-adjacent without an edge — that
   * is correct in this model (no line drawn, no traversal allowed).
   */
  function collapse(puzzle) {
    if (!puzzle.cells.length) {
      puzzle.edges = [];
      return puzzle;
    }
    for (let iter = 0; iter < 200; iter++) {
      const comps = edgeComponents(puzzle.cells, puzzle.edges);
      if (comps.length <= 1) break;
      const target = centroidOf(puzzle.cells);
      comps.sort((a, b) => {
        const ca = centroidOf(a);
        const cb = centroidOf(b);
        return Math.hypot(cb.x - target.x, cb.y - target.y) - Math.hypot(ca.x - target.x, ca.y - target.y);
      });
      let movedAny = false;
      for (const comp of comps) {
        const c = centroidOf(comp);
        const dx = Math.abs(c.x - target.x) < 0.45 ? 0 : (c.x < target.x ? 1 : -1);
        const dy = Math.abs(c.y - target.y) < 0.45 ? 0 : (c.y < target.y ? 1 : -1);
        const tries = [[dx, dy], [dx, 0], [0, dy]];
        for (const [mx, my] of tries) {
          if (mx === 0 && my === 0) continue;
          if (tryShift(puzzle, comp, mx, my)) { movedAny = true; break; }
        }
      }
      if (!movedAny) break;
    }
    recenter(puzzle);
    return puzzle;
  }

  /**
   * Mark a word as found, recompute the union, compact the board.
   * Returns { removedIds, removedEdgeKeys, moved } for the renderer.
   */
  function removeWord(puzzle, wordIndex) {
    const word = puzzle.words[wordIndex];
    if (!word || word.found) return null;
    const beforeNodes = new Set(puzzle.cells.map(c => c.id));
    const beforeEdges = new Set(puzzle.edges.map(e => edgeKey(e[0], e[1])));
    const beforePos = new Map(puzzle.cells.map(c => [c.id, { x: c.x, y: c.y }]));

    word.found = true;
    computeUnion(puzzle);

    const stillNodes = new Set(puzzle.cells.map(c => c.id));
    const stillEdges = new Set(puzzle.edges.map(e => edgeKey(e[0], e[1])));
    const removedIds = [];
    for (const id of beforeNodes) if (!stillNodes.has(id)) removedIds.push(id);
    const removedEdgeKeys = [];
    for (const k of beforeEdges) if (!stillEdges.has(k)) removedEdgeKeys.push(k);

    collapse(puzzle);

    const moved = [];
    for (const c of puzzle.cells) {
      const prev = beforePos.get(c.id);
      if (prev && (prev.x !== c.x || prev.y !== c.y)) {
        moved.push({ id: c.id, fromX: prev.x, fromY: prev.y, toX: c.x, toY: c.y });
      }
    }
    return { removedIds: removedIds, removedEdgeKeys: removedEdgeKeys, moved: moved };
  }

  function findWordIndex(puzzle, text) {
    const t = String(text).toLowerCase();
    for (let i = 0; i < puzzle.words.length; i++) {
      if (!puzzle.words[i].found && puzzle.words[i].text === t) return i;
    }
    return -1;
  }

  /**
   * Fixed three-word board used by the how-to. PLAY is the first swipe;
   * START shows diagonal steps; TUTORIAL is the headline that clears the
   * rest. Canonical paths are the only edges, so the union melts the same
   * way a generated puzzle does.
   *
   *   T U T O
   *   S T I R
   *   P L A ·
   *   · · L Y
   */
  function makeTutorialPuzzle() {
    const allCells = [
      { id: 1, x: 0, y: 0, letter: 't' },
      { id: 2, x: 1, y: 0, letter: 'u' },
      { id: 3, x: 2, y: 0, letter: 't' },
      { id: 4, x: 3, y: 0, letter: 'o' },
      { id: 5, x: 0, y: 1, letter: 's' },
      { id: 6, x: 1, y: 1, letter: 't' },
      { id: 7, x: 2, y: 1, letter: 'i' },
      { id: 8, x: 3, y: 1, letter: 'r' },
      { id: 9, x: 0, y: 2, letter: 'p' },
      { id: 10, x: 1, y: 2, letter: 'l' },
      { id: 11, x: 2, y: 2, letter: 'a' },
      { id: 12, x: 2, y: 3, letter: 'l' },
      { id: 13, x: 3, y: 3, letter: 'y' }
    ];
    const words = [
      { text: 'tutorial', cellIds: [1, 2, 3, 4, 8, 7, 11, 12], found: false, isLong: true },
      { text: 'play', cellIds: [9, 10, 11, 13], found: false, isLong: false },
      { text: 'start', cellIds: [5, 6, 11, 8, 3], found: false, isLong: false }
    ];
    const puzzle = {
      allCells: allCells,
      cells: [],
      edges: [],
      words: words,
      longWord: 'tutorial',
      mainWord: 'tutorial',
      gridSize: 4,
      cellsUsed: allCells.length
    };
    computeUnion(puzzle);
    return puzzle;
  }

  function clonePuzzle(puzzle) {
    const allCells = puzzle.allCells.map(c => Object.assign({}, c));
    const clone = {
      allCells: allCells,
      cells: [],
      edges: [],
      longWord: puzzle.longWord,
      mainWord: puzzle.mainWord || puzzle.longWord,
      words: puzzle.words.map(w => ({
        text: w.text,
        cellIds: w.cellIds.slice(),
        found: w.found,
        isLong: w.isLong
      }))
    };
    computeUnion(clone);
    return clone;
  }

  return {
    CONFIG: CONFIG,
    FALLBACK_COMMON: FALLBACK_COMMON,
    FALLBACK_LONG: FALLBACK_LONG,
    FALLBACK_EXTRA: FALLBACK_EXTRA,
    createRng: createRng,
    shuffled: shuffled,
    chooseHeadlineWord: chooseHeadlineWord,
    checkUnionInvariant: checkUnionInvariant,
    findCrossingEdgePairs: findCrossingEdgePairs,
    adjacencyMap: adjacencyMap,
    findRoute: findRoute,
    isTraceable: isTraceable,
    isValidTrace: isValidTrace,
    traceToWord: traceToWord,
    PREFIX_DEPTH: PREFIX_DEPTH,
    unpackLexicon: unpackLexicon,
    lexiconFromPacked: lexiconFromPacked,
    buildLexicon: buildLexicon,
    seedForMainWord: seedForMainWord,
    enumerateWords: enumerateWords,
    enumerateCommon: enumerateCommon,
    multisetFits: multisetFits,
    trimToWordCount: trimToWordCount,
    scorePuzzle: scorePuzzle,
    generatePuzzle: generatePuzzle,
    collapse: collapse,
    removeWord: removeWord,
    findWordIndex: findWordIndex,
    clonePuzzle: clonePuzzle,
    makeTutorialPuzzle: makeTutorialPuzzle
  };
});
