/* LetterMelt — SVG rendering + animation (browser only).
 *
 * The board is drawn as ivory glass keycaps sitting above a lava bed: each
 * letter is a stack of layered fills (contact shadow, extruded skirt, cream
 * face, liquid fill, gloss, specular, bevel, heat rim) and connections are
 * molten "lanes" that run under the caps so tube and letter read as one piece.
 * Each lane carries a hidden liquid channel (pathLength=1 + dashoffset) that
 * fills directionally as the player traces and drains downhill when a word
 * melts. Everything animates via transform/opacity/dashoffset only.
 */
(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STEP = 100;
  const PAD = 54;
  const MELT_MS = 760;
  const ORB_R = 40;          // hit/effect radius (drops, auras, melt drips)
  const CAP = 38;            // radius of the drawn letter tile
  const CAP_LIFT = 4.5;      // how far the cap sits above its extruded skirt
  // Lanes tuck UNDER the caps (the node layer paints over the edge layer), so
  // a tube reads as running into the letter instead of stopping short of it.
  const LANE_OVERLAP = 13;
  const HOLD_MS = 400;       // survivors keep the verdict colour this long
  const SHIMMER_SHARE = 0.2;
  // Bubbles rising inside a filled cap. CSS keyframes are baked per-sprite
  // so transform stays compositor-eligible (no var() in the matrix).
  const BUBBLES = [
    { x: -21, r: 4.6, dur: 2.9, delay: 0,   drift: 3 },
    { x: -9,  r: 3.1, dur: 2.3, delay: 0.8, drift: -2.5 },
    { x: 3,   r: 5.4, dur: 3.3, delay: 1.5, drift: 2 },
    { x: 15,  r: 3.6, dur: 2.6, delay: 0.4, drift: -3 },
    { x: 23,  r: 4.2, dur: 3.1, delay: 2, drift: 2.5 }
  ];

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const k in attrs) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  function edgeKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------------------------- gradients ---------------------------- */

  function stop(offset, color, opacity) {
    const s = el('stop', { offset: offset, 'stop-color': color });
    if (opacity != null) s.setAttribute('stop-opacity', String(opacity));
    return s;
  }

  function gradient(kind, id, attrs, stops) {
    const g = el(kind, Object.assign({ id: id }, attrs));
    for (const s of stops) g.appendChild(stop(s[0], s[1], s[2]));
    return g;
  }

  function buildDefs() {
    const defs = el('defs');
    const grads = [
      // Unfilled tile face — dark, with a soft lift from the lava bed below.
      gradient('linearGradient', 'lmCap', { x1: '0', y1: '0', x2: '0.18', y2: '1' }, [
        ['0%', '#443449'], ['26%', '#302333'], ['62%', '#211823'],
        ['86%', '#171019'], ['100%', '#0f0a11']
      ]),
      // The extruded side of the dark tile, only ever visible along the bottom edge.
      gradient('linearGradient', 'lmCapSide', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        ['0%', '#653b4b'], ['48%', '#432635'], ['100%', '#271522']
      ]),
      // Inner bevel: a crisp lip along the top, warm bounce along the bottom.
      gradient('linearGradient', 'lmBevel', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        ['0%', '#ffffff', 0.64], ['34%', '#fff6e6', 0.12], ['70%', '#ffb877', 0.18],
        ['100%', '#ff9243', 0.36]
      ]),
      // Glassy reflection sitting on the top half of the face.
      gradient('linearGradient', 'lmGloss', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        ['0%', '#ffffff', 0.62], ['58%', '#fff4e2', 0.16], ['100%', '#fff4e2', 0]
      ]),
      // Liquid caramel — used for the cap fill and droplets.
      gradient('radialGradient', 'lmLiquid', { cx: '38%', cy: '22%', r: '90%' }, [
        ['0%', '#ffedbe'], ['32%', '#ffc45e'], ['62%', '#ff8f42'],
        ['88%', '#f26136'], ['100%', '#d84c2c']
      ]),
      // Bubble rising through a filled cap — same recipe as the timer's lava.
      gradient('radialGradient', 'lmBubble', { cx: '35%', cy: '30%', r: '70%' }, [
        ['0%', '#fffae1', 0.95], ['70%', '#ffd68c', 0.35], ['100%', '#ffc878', 0]
      ]),
      // Crisp little specular.
      gradient('radialGradient', 'lmSpec', { cx: '50%', cy: '50%', r: '50%' }, [
        ['0%', '#ffffff', 0.95], ['55%', '#fff3dd', 0.35], ['100%', '#fff3dd', 0]
      ]),
      // Soft contact shadow (gradient fade — no filter).
      gradient('radialGradient', 'lmContact', { cx: '50%', cy: '50%', r: '50%' }, [
        ['0%', '#0d0309', 0.22], ['58%', '#0d0309', 0.11], ['100%', '#0d0309', 0]
      ]),
      // Touch aura around a traced cap.
      gradient('radialGradient', 'lmAura', { cx: '50%', cy: '50%', r: '50%' }, [
        ['0%', '#ffc46b', 0.62], ['38%', '#ff7f3c', 0.4], ['72%', '#ff6a2e', 0.14],
        ['100%', '#ff6a2e', 0]
      ]),
      // Fingertip glow.
      gradient('radialGradient', 'lmTip', { cx: '50%', cy: '50%', r: '50%' }, [
        ['0%', '#fff3d0', 0.9], ['42%', '#ffb04d', 0.5], ['100%', '#ff6b5a', 0]
      ]),
      // Outcome tones. The liquid recolours the moment a trace is judged, so
      // the answer is legible from the board itself before any text is read.
      gradient('radialGradient', 'lmLiquidGood', { cx: '38%', cy: '22%', r: '90%' }, [
        ['0%', '#e8ffd8'], ['32%', '#96e86b'], ['62%', '#4cc862'],
        ['88%', '#2f9d4e'], ['100%', '#218040']
      ]),
      gradient('radialGradient', 'lmLiquidExtra', { cx: '38%', cy: '22%', r: '90%' }, [
        ['0%', '#dff2ff'], ['32%', '#7cc9ff'], ['62%', '#3e9df5'],
        ['88%', '#2274d6'], ['100%', '#1a5fb8']
      ]),
      gradient('radialGradient', 'lmLiquidDim', { cx: '38%', cy: '22%', r: '90%' }, [
        ['0%', '#e6e2e6'], ['32%', '#b3aab3'], ['62%', '#8b8189'],
        ['88%', '#6a6169'], ['100%', '#57505a']
      ]),
      gradient('radialGradient', 'lmLiquidBad', { cx: '38%', cy: '22%', r: '90%' }, [
        ['0%', '#ffe0e0'], ['32%', '#ff9a95'], ['62%', '#f4635f'],
        ['88%', '#d8433f'], ['100%', '#b83430']
      ])
    ];
    for (const g of grads) defs.appendChild(g);
    return defs;
  }

  function createRenderer(svg) {
    svg.appendChild(buildDefs());

    const gEdges = el('g', { class: 'layer-edges' });
    const gTrace = el('g', { class: 'layer-trace' });
    const gRemote = el('g', { class: 'layer-remote-trace', 'aria-hidden': 'true' });
    const gNodes = el('g', { class: 'layer-nodes' });
    const gFx = el('g', { class: 'layer-fx' });

    // Rubber band: a single molten segment from the last locked orb to the
    // fingertip (the traced lanes themselves carry the rest of the liquid).
    const bandHalo = el('line', { class: 'band-halo' });
    const bandGlow = el('line', { class: 'band-glow' });
    const band = el('line', { class: 'band' });
    const traceTip = el('circle', { class: 'trace-tip', r: 42, cx: 0, cy: 0, fill: 'url(#lmTip)' });
    gTrace.appendChild(bandHalo);
    gTrace.appendChild(bandGlow);
    gTrace.appendChild(band);
    gTrace.appendChild(traceTip);

    svg.appendChild(gEdges);
    svg.appendChild(gTrace);
    svg.appendChild(gNodes);
    // Name tag rides above the caps; letter fills themselves live on the nodes.
    svg.appendChild(gRemote);
    svg.appendChild(gFx);

    const state = {
      puzzle: null,
      nodeEls: new Map(),   // id -> { g, inner, body, liquid, text }
      edgeEls: new Map(),   // key -> { g, halo, bloom, glass, bore, liquid, core, a, b, dir }
      pos: new Map(),       // id -> { x, y } in svg units
      view: { x: 0, y: 0, w: 600, h: 600 },
      anim: null,
      tracedPairs: new Map(), // edgeKey -> fromId for locally filled lanes
      localIds: new Set(),
      remoteIds: [],
      remotePairs: new Map(), // edgeKey -> fromId for the other player's lanes
      remoteName: '',
      traceVersion: 0,
      // Bumped by setPuzzle. Node ids restart at 1 for every puzzle, so any
      // deferred callback from a previous board (melt timeouts, tween frames)
      // would happily delete or move the NEW board's tiles. Every deferred
      // step captures this token and no-ops once it is stale.
      gen: 0
    };

    /* --------------------------- geometry --------------------------- */

    function targetPos(cell) {
      return { x: cell.x * STEP, y: cell.y * STEP };
    }

    function targetView(cells) {
      if (!cells.length) return state.view;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of cells) {
        const p = targetPos(c);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      let w = (maxX - minX) + PAD * 2;
      let h = (maxY - minY) + PAD * 2;
      // Keep the board from ballooning when only a couple of letters remain.
      const min = 3.2 * STEP;
      if (w < min) { minX -= (min - w) / 2; w = min; }
      if (h < min) { minY -= (min - h) / 2; h = min; }
      return { x: minX - PAD, y: minY - PAD, w: w, h: h };
    }

    function applyView(v) {
      state.view = v;
      svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
    }

    /* --------------------------- elements --------------------------- */

    /** A circular tile centred on the node, optionally inset or nudged. */
    function capCircle(opts) {
      const o = opts || {};
      const radius = CAP - (o.inset || 0);
      const attrs = {
        cx: 0, cy: o.dy || 0, r: radius
      };
      if (o.className) attrs.class = o.className;
      if (o.fill) attrs.fill = o.fill;
      if (o.stroke) {
        attrs.fill = 'none';
        attrs.stroke = o.stroke;
        attrs['stroke-width'] = o.width;
      }
      return el('circle', attrs);
    }

    function makeNode(cell) {
      const g = el('g', { class: 'node' });
      g.dataset.id = String(cell.id);

      const hit = el('rect', {
        class: 'node-hit', x: -50, y: -50, width: 100, height: 100, rx: 26
      });
      const inner = el('g', { class: 'node-inner' });

      const clipId = 'lmClip-g' + state.gen + '-' + cell.id;
      const clip = el('clipPath', { id: clipId });
      clip.appendChild(capCircle({ inset: 0.6 }));

      const contact = el('ellipse', {
        class: 'node-contact', cx: 0, cy: CAP + 7.5, rx: CAP * 0.8, ry: 7,
        fill: 'url(#lmContact)'
      });
      const aura = el('circle', { class: 'node-aura', r: 64, cx: 0, cy: 0, fill: 'url(#lmAura)' });
      // The skirt is the cap's extruded side: an identical shape pushed down,
      // so only the bottom lip of it ever shows past the face.
      const skirt = capCircle({ className: 'node-skirt', dy: CAP_LIFT, fill: 'url(#lmCapSide)' });
      const body = capCircle({ className: 'node-body', fill: 'url(#lmCap)' });
      const liquidWrap = el('g', { 'clip-path': 'url(#' + clipId + ')' });
      const liquid = capCircle({ className: 'node-liquid', fill: 'url(#lmLiquid)' });
      liquidWrap.appendChild(liquid);
      // Bubbles live under the cap's clip alongside the liquid, so they are
      // trimmed by the same rounded corners. One random phase shift per cap
      // keeps a boardful of traced letters from bubbling in lockstep.
      const bubbles = el('g', { class: 'node-bubbles' });
      const phase = Math.random() * -3;
      for (let i = 0; i < BUBBLES.length; i++) {
        const b = BUBBLES[i];
        const dot = el('circle', {
          class: 'node-bubble node-bubble-' + (i + 1),
          cx: b.x, cy: CAP - 3, r: b.r, fill: 'url(#lmBubble)'
        });
        dot.style.animationDelay = (b.delay + phase).toFixed(2) + 's';
        bubbles.appendChild(dot);
      }
      liquidWrap.appendChild(bubbles);
      // Bevel rides just inside the silhouette; the heat rim rides just outside
      // it and only lights up while the cap is part of a trace.
      const bevel = capCircle({ className: 'node-bevel', inset: 1.6, stroke: 'url(#lmBevel)', width: 2.2 });
      const heat = capCircle({ className: 'node-heat', inset: -1.5, stroke: '#ffab5c', width: 3 });
      const gloss = el('circle', {
        class: 'node-sheen', cx: 0, cy: 0, r: CAP - 6, fill: 'url(#lmGloss)'
      });
      const spec = el('ellipse', {
        class: 'node-spec', cx: -CAP * 0.5, cy: -CAP * 0.56, rx: 8.5, ry: 4.5,
        fill: 'url(#lmSpec)', transform: 'rotate(-18)'
      });
      const shade = el('text', {
        class: 'node-letter-shade', x: 0, y: 5,
        'text-anchor': 'middle', 'dominant-baseline': 'central'
      });
      shade.textContent = cell.letter.toUpperCase();
      const text = el('text', {
        class: 'node-letter', x: 0, y: 2,
        'text-anchor': 'middle', 'dominant-baseline': 'central'
      });
      text.textContent = cell.letter.toUpperCase();

      inner.appendChild(clip);
      inner.appendChild(contact);
      inner.appendChild(aura);
      inner.appendChild(skirt);
      inner.appendChild(body);
      inner.appendChild(liquidWrap);
      inner.appendChild(gloss);
      inner.appendChild(spec);
      inner.appendChild(bevel);
      inner.appendChild(heat);
      inner.appendChild(shade);
      inner.appendChild(text);
      g.appendChild(hit);
      g.appendChild(inner);
      gNodes.appendChild(g);

      // A minority of caps breathe, each on its own offset.
      if (Math.random() < SHIMMER_SHARE) {
        g.classList.add('shimmer');
        gloss.style.animationDelay = (Math.random() * -7).toFixed(2) + 's';
      }
      return { g: g, inner: inner, body: body, liquid: liquid, text: text };
    }

    function syncNodes() {
      const live = new Set();
      for (const cell of state.puzzle.cells) {
        live.add(cell.id);
        if (!state.nodeEls.has(cell.id)) {
          state.nodeEls.set(cell.id, makeNode(cell));
          state.pos.set(cell.id, targetPos(cell));
          state.nodeEls.get(cell.id).g.classList.add('spawn');
        }
      }
      for (const [id, node] of state.nodeEls) {
        if (!live.has(id)) {
          node.g.remove();
          state.nodeEls.delete(id);
          state.pos.delete(id);
        }
      }
      placeNodes();
    }

    function placeNodes() {
      for (const [id, node] of state.nodeEls) {
        const p = state.pos.get(id);
        if (p) node.g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
      }
    }

    function makeLane(a, b) {
      const g = el('g', { class: 'lane' });
      const halo = el('path', { class: 'lane-halo', fill: 'none' });
      const bloom = el('path', { class: 'lane-bloom', fill: 'none' });
      const glass = el('path', { class: 'lane-glass', fill: 'none' });
      const bore = el('path', { class: 'lane-bore', fill: 'none' });
      const liquid = el('path', {
        class: 'lane-liquid', fill: 'none', pathLength: '1'
      });
      // Hot filament down the middle of the molten channel — the bit that
      // makes a filled lane read as lava rather than as a painted line.
      const core = el('path', { class: 'lane-core', fill: 'none', pathLength: '1' });
      g.appendChild(halo);
      g.appendChild(bloom);
      g.appendChild(glass);
      g.appendChild(bore);
      g.appendChild(liquid);
      g.appendChild(core);
      gEdges.appendChild(g);
      return {
        g: g, halo: halo, bloom: bloom, glass: glass, bore: bore,
        liquid: liquid, core: core, a: a, b: b, dir: null
      };
    }

    function syncEdges() {
      const wanted = new Map();
      for (const [a, b] of state.puzzle.edges) wanted.set(edgeKey(a, b), [a, b]);
      for (const [k, lane] of state.edgeEls) {
        if (!wanted.has(k)) {
          lane.g.remove();
          state.edgeEls.delete(k);
        }
      }
      for (const [k, pair] of wanted) {
        if (!state.edgeEls.has(k)) {
          const lane = makeLane(pair[0], pair[1]);
          lane.g.classList.add('fresh');
          state.edgeEls.set(k, lane);
          window.setTimeout(() => lane.g.classList.remove('fresh'), 30);
        }
      }
      placeEdges();
    }

    /** Distance from a circular cap's centre to its edge in any direction. */
    function capReach(ux, uy) {
      return CAP;
    }

    /** Lane endpoints, pushed just inside each cap so the seam is hidden. */
    function laneEnds(lane) {
      const a = state.pos.get(lane.a);
      const b = state.pos.get(lane.b);
      if (!a || !b) return null;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // If two caps get squeezed close, shrink the trim so the lane never
      // inverts.
      const trim = Math.min(capReach(ux, uy) - LANE_OVERLAP, len * 0.42);
      return {
        ax: a.x + ux * trim, ay: a.y + uy * trim,
        bx: b.x - ux * trim, by: b.y - uy * trim
      };
    }

    function laneD(lane, fromA) {
      const e = laneEnds(lane);
      if (!e) return '';
      return fromA
        ? 'M' + e.ax + ' ' + e.ay + ' L' + e.bx + ' ' + e.by
        : 'M' + e.bx + ' ' + e.by + ' L' + e.ax + ' ' + e.ay;
    }

    function placeEdges() {
      for (const lane of state.edgeEls.values()) {
        const shell = laneD(lane, true);
        if (!shell) continue;
        lane.halo.setAttribute('d', shell);
        lane.bloom.setAttribute('d', shell);
        lane.glass.setAttribute('d', shell);
        lane.bore.setAttribute('d', shell);
        // The liquid keeps whatever direction its current fill used.
        const fromA = lane.dir === null ? true : lane.dir;
        const flow = laneD(lane, fromA);
        lane.liquid.setAttribute('d', flow);
        lane.core.setAttribute('d', flow);
      }
    }

    /* ----------------------- liquid choreography ----------------------- */

    /** Point the lane's liquid path so it flows from `fromId` to the other end. */
    function orientLane(lane, fromId) {
      const fromA = fromId === lane.a;
      if (lane.dir === fromA) return;
      lane.dir = fromA;
      const flow = laneD(lane, fromA);
      lane.liquid.setAttribute('d', flow);
      lane.core.setAttribute('d', flow);
    }

    function fillLane(lane, fromId) {
      orientLane(lane, fromId);
      lane.g.classList.remove('remote-filled');
      lane.g.classList.add('filled');
    }

    function drainLane(lane) {
      lane.g.classList.remove('filled');
    }

    /**
     * Paint the other player's route in blue on any letter/lane the local
     * finger is not currently claiming. Local orange always wins overlaps.
     */
    function applyRemoteVisuals() {
      const remote = new Set(state.remoteIds);
      for (const [id, node] of state.nodeEls) {
        node.g.classList.toggle('remote-traced', remote.has(id) && !state.localIds.has(id));
      }
      for (const [k, lane] of state.edgeEls) {
        const fromId = state.remotePairs.get(k);
        if (fromId == null || state.tracedPairs.has(k)) {
          lane.g.classList.remove('remote-filled');
          continue;
        }
        orientLane(lane, fromId);
        lane.g.classList.add('remote-filled');
      }
    }

    function paintRemoteLabel() {
      while (gRemote.firstChild) gRemote.removeChild(gRemote.firstChild);
      if (!state.remoteName || !state.remoteIds.length) return;
      const tip = state.pos.get(state.remoteIds[state.remoteIds.length - 1]);
      if (!tip) return;
      const label = el('text', {
        class: 'remote-trace-label',
        x: tip.x,
        y: tip.y - 50
      });
      label.textContent = String(state.remoteName).slice(0, 24);
      gRemote.appendChild(label);
    }

    /* ----------------------------- effects ----------------------------- */

    /** Spawn short-lived particles at a board position. */
    function particles(x, y, opts) {
      if (prefersReducedMotion()) return;
      const count = opts.count;
      for (let i = 0; i < count; i++) {
        const angle = opts.spread * (Math.random() - 0.5) + opts.angle;
        const dist = opts.dist * (0.55 + Math.random() * 0.7);
        const dot = el('circle', {
          class: opts.className,
          cx: x + (Math.random() - 0.5) * 26,
          cy: y + (Math.random() - 0.5) * 14,
          r: opts.radius * (0.6 + Math.random() * 0.8),
          fill: opts.fill
        });
        dot.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
        dot.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
        dot.style.setProperty('--dur', (opts.duration * (0.75 + Math.random() * 0.5)).toFixed(2) + 's');
        dot.style.setProperty('--delay', (Math.random() * opts.stagger).toFixed(2) + 's');
        gFx.appendChild(dot);
        window.setTimeout(() => dot.remove(), (opts.duration + opts.stagger + 0.4) * 1000);
      }
    }

    /** Molten droplets falling off a melting orb or lane end. */
    function dripAt(x, y, count) {
      particles(x, y, {
        className: 'drop',
        count: count || 4 + Math.floor(Math.random() * 3),
        angle: Math.PI / 2,
        spread: 1.1,
        dist: 120,
        radius: 7,
        fill: 'url(#lmLiquid)',
        duration: 0.85,
        stagger: 0.22
      });
    }

    /** Ember burst — used when an extra word pays out. */
    function sparkAt(id) {
      const p = state.pos.get(id);
      if (!p) return;
      particles(p.x, p.y, {
        className: 'ember',
        count: 9,
        angle: -Math.PI / 2,
        spread: Math.PI * 1.7,
        dist: 130,
        radius: 6,
        fill: '#ffd166',
        duration: 0.75,
        stagger: 0.14
      });
    }

    /* --------------------------- public API --------------------------- */

    function setPuzzle(puzzle) {
      state.gen++;
      if (state.anim) {
        cancelAnimationFrame(state.anim);
        state.anim = null;
      }
      state.puzzle = puzzle;
      for (const node of state.nodeEls.values()) node.g.remove();
      for (const lane of state.edgeEls.values()) lane.g.remove();
      while (gFx.firstChild) gFx.removeChild(gFx.firstChild);
      state.nodeEls.clear();
      state.edgeEls.clear();
      state.pos.clear();
      state.tracedPairs.clear();
      state.localIds = new Set();
      state.remoteIds = [];
      state.remotePairs = new Map();
      state.remoteName = '';
      while (gRemote.firstChild) gRemote.removeChild(gRemote.firstChild);
      for (const cell of puzzle.cells) state.pos.set(cell.id, targetPos(cell));
      applyView(targetView(puzzle.cells));
      syncNodes();
      syncEdges();
      clearTrace();
      setTone(null);
    }

    function refresh() {
      syncNodes();
      syncEdges();
    }

    /** Tween node positions + viewBox to the puzzle's current layout. */
    function animateTo(duration, done) {
      if (state.anim) cancelAnimationFrame(state.anim);
      const token = state.gen;
      const from = new Map();
      const to = new Map();
      for (const cell of state.puzzle.cells) {
        const cur = state.pos.get(cell.id) || targetPos(cell);
        from.set(cell.id, { x: cur.x, y: cur.y });
        to.set(cell.id, targetPos(cell));
      }
      const viewFrom = Object.assign({}, state.view);
      const viewTo = targetView(state.puzzle.cells);
      const start = performance.now();

      function frame(now) {
        if (token !== state.gen) { state.anim = null; return; }
        const raw = Math.min(1, (now - start) / duration);
        const t = easeOutCubic(raw);
        for (const [id, f] of from) {
          const tp = to.get(id);
          state.pos.set(id, { x: f.x + (tp.x - f.x) * t, y: f.y + (tp.y - f.y) * t });
        }
        applyView({
          x: viewFrom.x + (viewTo.x - viewFrom.x) * t,
          y: viewFrom.y + (viewTo.y - viewFrom.y) * t,
          w: viewFrom.w + (viewTo.w - viewFrom.w) * t,
          h: viewFrom.h + (viewTo.h - viewFrom.h) * t
        });
        placeNodes();
        placeEdges();
        if (raw < 1) {
          state.anim = requestAnimationFrame(frame);
        } else {
          state.anim = null;
          if (done) done();
        }
      }
      state.anim = requestAnimationFrame(frame);
    }

    /**
     * Melt away the letters and connections the union no longer needs: liquid
     * drains downhill out of the word's lanes and orbs, droplets fall from
     * the low points, survivors bounce, then the board compacts.
     *
     * opts: { removedIds, removedEdgeKeys, keptIds, onDone }
     */
    function playFound(opts) {
      const token = state.gen;
      const removedIds = opts.removedIds || [];
      const goneKeys = new Set(opts.removedEdgeKeys || []);
      const keptIds = opts.keptIds || [];
      // The engine removes a word's canonical route, but the player may have
      // submitted any valid route spelling that word. Keep the verdict
      // styling tied to the route the player actually traced; the canonical
      // route is still used for the board mutation and melt animation.
      const verdictIds = new Set(opts.traceIds || []);
      const verdictKeys = new Set();
      const traceIds = opts.traceIds || [];
      for (let i = 1; i < traceIds.length; i++) {
        verdictKeys.add(edgeKey(traceIds[i - 1], traceIds[i]));
      }
      const onDone = opts.onDone;

      for (const id of verdictIds) {
        const node = state.nodeEls.get(id);
        if (node) node.g.classList.add('verdict-good');
      }
      for (const key of verdictKeys) {
        const lane = state.edgeEls.get(key);
        if (lane) lane.g.classList.add('verdict-good');
      }

      for (const id of removedIds) {
        const node = state.nodeEls.get(id);
        if (!node) continue;
        node.g.classList.remove('traced', 'remote-traced');
        node.g.classList.add('melting');
        const p = state.pos.get(id);
        if (p) dripAt(p.x, p.y + ORB_R * 0.5);
      }

      // Letters other words still need hold the verdict's colour for a beat —
      // the same beat a grey repeat gets — before their liquid drains, then
      // give a happy little bounce.
      for (const id of keptIds) {
        const node = state.nodeEls.get(id);
        if (!node) continue;
        node.g.classList.remove('traced', 'remote-traced');
        node.g.classList.add('held');
        node.g.classList.add('kept');
        window.setTimeout(() => {
          if (token === state.gen) node.g.classList.remove('held');
        }, HOLD_MS);
        window.setTimeout(() => node.g.classList.remove('kept'), 650);
      }

      const removed = new Set(removedIds);
      const melting = [];
      for (const [k, lane] of state.edgeEls) {
        if (goneKeys.has(k) || removed.has(lane.a) || removed.has(lane.b)) {
          melting.push([k, lane]);
        }
      }

      // Filled lanes drain downhill; empty ones sag out quietly.
      for (const [, lane] of melting) {
        const wasFilled = lane.g.classList.contains('filled') ||
          lane.g.classList.contains('remote-filled');
        if (wasFilled && !prefersReducedMotion()) {
          const a = state.pos.get(lane.a);
          const b = state.pos.get(lane.b);
          if (a && b) {
            const topFirst = a.y === b.y ? (a.x < b.x) : (a.y < b.y);
            orientLane(lane, topFirst ? lane.a : lane.b);
            const low = topFirst ? b : a;
            window.setTimeout(() => {
              if (token === state.gen) dripAt(low.x, low.y, 2);
            }, 300);
          }
          lane.g.classList.add('draining');
          lane.g.classList.remove('filled', 'remote-filled');
        } else {
          lane.g.classList.remove('filled', 'remote-filled');
        }
        lane.g.classList.add('melting');
      }

      window.setTimeout(() => {
        if (token !== state.gen) return;   // a new puzzle was loaded mid-melt
        for (const id of removedIds) {
          const node = state.nodeEls.get(id);
          if (node) {
            node.g.remove();
            state.nodeEls.delete(id);
            state.pos.delete(id);
          }
        }
        for (const [k, lane] of melting) {
          lane.g.remove();
          if (state.edgeEls.get(k) === lane) state.edgeEls.delete(k);
        }
        syncNodes();
        animateTo(560, () => {
          syncEdges();
          for (const id of verdictIds) {
            const node = state.nodeEls.get(id);
            if (node) node.g.classList.remove('verdict-good');
          }
          for (const key of verdictKeys) {
            const lane = state.edgeEls.get(key);
            if (lane) lane.g.classList.remove('verdict-good');
          }
          if (onDone) onDone();
        });
      }, MELT_MS);
    }

    function pulse(ids, className, ms) {
      for (const id of ids) {
        const node = state.nodeEls.get(id);
        if (!node) continue;
        node.g.classList.add(className);
        window.setTimeout(() => node.g.classList.remove(className), ms || 600);
      }
    }

    /** Glow the tiles a how-to step wants the player to trace. */
    function setHint(ids, startId) {
      const wanted = new Set(ids || []);
      for (const [id, node] of state.nodeEls) {
        node.g.classList.toggle('hint', wanted.has(id));
        node.g.classList.toggle('hint-start', startId != null && id === startId);
      }
      for (const lane of state.edgeEls.values()) {
        lane.g.classList.toggle('hint', wanted.has(lane.a) && wanted.has(lane.b));
      }
    }

    /** Squash-and-spring the orb that just locked into the trace. */
    function lockPulse(id) {
      const node = state.nodeEls.get(id);
      if (!node) return;
      node.g.classList.remove('lock');
      void node.g.getBoundingClientRect();
      node.g.classList.add('lock');
      window.setTimeout(() => node.g.classList.remove('lock'), 360);
    }

    /**
     * Highlight the current trace: liquid pours into each newly locked lane
     * (and drains back out on backtrack), orbs fill bottom-up, and a molten
     * band runs from the last orb to the fingertip.
     */
    function setTrace(ids, tip) {
      state.traceVersion++;
      const active = new Set(ids);
      state.localIds = active;
      for (const [id, node] of state.nodeEls) {
        node.g.classList.toggle('traced', active.has(id));
      }

      const pairs = new Map();
      for (let i = 1; i < ids.length; i++) {
        pairs.set(edgeKey(ids[i - 1], ids[i]), ids[i - 1]);
      }
      // Drain lanes that fell out of the trace.
      for (const k of state.tracedPairs.keys()) {
        if (!pairs.has(k)) {
          const lane = state.edgeEls.get(k);
          if (lane) drainLane(lane);
        }
      }
      // Fill lanes that just joined, flowing away from the earlier letter.
      for (const [k, fromId] of pairs) {
        if (!state.tracedPairs.has(k)) {
          const lane = state.edgeEls.get(k);
          if (lane) fillLane(lane, fromId);
        }
      }
      state.tracedPairs = pairs;
      // Reclaim / release blue remote fills where the local finger overlaps.
      applyRemoteVisuals();

      const hasTip = !!(tip && ids.length);
      if (hasTip) {
        const last = state.pos.get(ids[ids.length - 1]);
        if (last) {
          for (const seg of [band, bandGlow, bandHalo]) {
            seg.setAttribute('x1', last.x);
            seg.setAttribute('y1', last.y);
            seg.setAttribute('x2', tip.x);
            seg.setAttribute('y2', tip.y);
          }
        }
        traceTip.setAttribute('cx', tip.x);
        traceTip.setAttribute('cy', tip.y);
      }
      band.classList.toggle('visible', hasTip);
      bandGlow.classList.toggle('visible', hasTip);
      bandHalo.classList.toggle('visible', hasTip);
      traceTip.classList.toggle('visible', hasTip);
    }

    function clearTrace() {
      setTrace([], null);
    }

    function setRemoteTrace(ids, name) {
      const nextIds = (ids || []).map(Number).filter(id => state.pos.has(id));
      const pairs = new Map();
      for (let i = 1; i < nextIds.length; i++) {
        pairs.set(edgeKey(nextIds[i - 1], nextIds[i]), nextIds[i - 1]);
      }
      for (const k of state.remotePairs.keys()) {
        if (!pairs.has(k)) {
          const lane = state.edgeEls.get(k);
          if (lane) lane.g.classList.remove('remote-filled');
        }
      }
      state.remoteIds = nextIds;
      state.remotePairs = pairs;
      state.remoteName = name || '';
      applyRemoteVisuals();
      paintRemoteLabel();
    }

    function clearRemoteTrace() {
      for (const k of state.remotePairs.keys()) {
        const lane = state.edgeEls.get(k);
        if (lane) lane.g.classList.remove('remote-filled');
      }
      state.remoteIds = [];
      state.remotePairs = new Map();
      state.remoteName = '';
      applyRemoteVisuals();
      paintRemoteLabel();
    }

    const TONES = ['tone-good', 'tone-extra', 'tone-dim', 'tone-bad'];

    /** Recolour the liquid to signal an outcome ('good'|'extra'|'dim'|'bad'). */
    function setTone(tone) {
      for (const name of TONES) svg.classList.remove(name);
      if (tone) svg.classList.add('tone-' + tone);
    }

    /**
     * Hold the traced fill for a beat in the colour of its verdict, then let
     * it drain away. Solving a word is green, an extra is blue, and anything
     * already found (or too short to count) drains grey.
     */
    function drainTrace(tone, holdMs, keepTone) {
      const token = state.gen;
      const traceVersion = state.traceVersion;
      setTone(tone || null);
      window.setTimeout(() => {
        // A new attempt may have started during the verdict hold. Never clear
        // that newer trace or its tone when this older verdict expires.
        if (token !== state.gen || traceVersion !== state.traceVersion) return;
        clearTrace();
        // A solved word keeps its tone until the melt finishes; the caller
        // clears it. Everything else fades back to neutral on its own.
        if (keepTone) return;
        window.setTimeout(() => {
          if (token === state.gen && traceVersion === state.traceVersion) setTone(null);
        }, 320);
      }, holdMs == null ? 280 : holdMs);
    }

    function flashTrace(ids, className) {
      const nodes = ids.map(id => state.nodeEls.get(id)).filter(Boolean);
      for (const n of nodes) n.g.classList.add(className);
      window.setTimeout(() => {
        for (const n of nodes) n.g.classList.remove(className);
      }, 500);
    }

    /**
     * Map a client point into svg user units. The board uses
     * preserveAspectRatio="xMidYMid meet", so the viewBox is uniformly scaled
     * and centred inside the element — mapping each axis independently would
     * put the fingertip in the wrong place on any non-matching aspect ratio.
     */
    function viewTransform() {
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(
        rect.width / state.view.w,
        rect.height / state.view.h
      ) || 1;
      return {
        scale: scale,
        offsetX: rect.left + (rect.width - state.view.w * scale) / 2,
        offsetY: rect.top + (rect.height - state.view.h * scale) / 2
      };
    }

    function toSvgPoint(clientX, clientY) {
      const t = viewTransform();
      return {
        x: state.view.x + (clientX - t.offsetX) / t.scale,
        y: state.view.y + (clientY - t.offsetY) / t.scale
      };
    }

    /** Inverse of toSvgPoint — svg user units back to client coordinates. */
    function toClientPoint(x, y) {
      const t = viewTransform();
      return {
        x: t.offsetX + (x - state.view.x) * t.scale,
        y: t.offsetY + (y - state.view.y) * t.scale
      };
    }

    /** Client coordinates of a node's centre (used by input tests). */
    function nodeClientPoint(id) {
      const p = state.pos.get(id);
      return p ? toClientPoint(p.x, p.y) : null;
    }

    /** Nearest node to an svg point, within `radius` user units. */
    function nodeAt(point, radius, allowed) {
      let best = null;
      let bestDist = radius * radius;
      for (const [id] of state.nodeEls) {
        if (allowed && !allowed(id)) continue;
        const p = state.pos.get(id);
        if (!p) continue;
        const dx = p.x - point.x;
        const dy = p.y - point.y;
        const d = dx * dx + dy * dy;
        if (d <= bestDist) {
          bestDist = d;
          best = id;
        }
      }
      return best;
    }

    function scaleFactor() {
      return 1 / viewTransform().scale;
    }

    return {
      STEP: STEP,
      setPuzzle: setPuzzle,
      refresh: refresh,
      playFound: playFound,
      animateTo: animateTo,
      setTrace: setTrace,
      clearTrace: clearTrace,
      setRemoteTrace: setRemoteTrace,
      clearRemoteTrace: clearRemoteTrace,
      setTone: setTone,
      drainTrace: drainTrace,
      flashTrace: flashTrace,
      pulse: pulse,
      setHint: setHint,
      lockPulse: lockPulse,
      sparkAt: sparkAt,
      toSvgPoint: toSvgPoint,
      toClientPoint: toClientPoint,
      nodeClientPoint: nodeClientPoint,
      nodeAt: nodeAt,
      scaleFactor: scaleFactor,
      prefersReducedMotion: prefersReducedMotion,
      positions: state.pos
    };
  }

  root.LetterMeltRender = { create: createRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
