/* LetterMelt — wiring. */
(function () {
  'use strict';

  const Generator = window.LetterMeltGenerator;
  const Engine = window.LetterMeltEngine;
  const Share = window.LetterMeltShare;

  // Keep sensitive categories out of both required and bonus words at the
  // runtime boundary as well as in the word-list build pipeline. This also
  // protects users running an older cached data asset.
  const BLOCKED_WORDS = new Set([
    'marijuana', 'cannabis', 'hashish', 'heroin', 'cocaine', 'meth', 'ecstasy',
    'mdma', 'opioid', 'opioids', 'fentanyl', 'overdose', 'drug', 'drugs'
  ]);
  const isAllowedWord = word => {
    const w = String(word).toLowerCase();
    return !w.includes('sex') && !w.includes('drug') && !BLOCKED_WORDS.has(w);
  };
  const cleanWords = list => (Array.isArray(list)
    ? list.filter(word => isAllowedWord(word) && String(word).toLowerCase() !== 'dean')
    : []);

  const $ = id => document.getElementById(id);
  const els = {
    board: $('board'),
    timer: $('timer'),
    timerValue: $('timerValue'),
    timerToasts: $('timerToasts'),
    solvedCount: $('solvedCount'),
    totalCount: $('totalCount'),
    newGame: $('newGame'),
    menuButton: $('menuButton'),
    menuOverlay: $('menuOverlay'),
    resumeGame: $('resumeGame'),
    openTutorial: $('openTutorial'),
    tutorialOverlay: $('tutorialOverlay'),
    tutorialClose: $('tutorialClose'),
    tutorialGuide: $('tutorialGuide'),
    tutorialBoard: $('tutorialBoard'),
    tutorialLinks: $('tutorialLinks'),
    tutorialCells: $('tutorialCells'),
    tutorialWord: $('tutorialWord'),
    tutorialProgress: $('tutorialProgress'),
    tutorialBack: $('tutorialBack'),
    tutorialNext: $('tutorialNext'),
    menuShare: $('menuShare'),
    menuShareLabel: $('menuShareLabel'),
    menuModeTitle: $('menuModeTitle'),
    menuModeDetail: $('menuModeDetail'),
    debugOverlay: $('debugOverlay'),
    debugClose: $('debugClose'),
    debugDone: $('debugDone'),
    debugMeta: $('debugMeta'),
    debugWordCount: $('debugWordCount'),
    debugWords: $('debugWords'),
    debugCommonCount: $('debugCommonCount'),
    debugCommon: $('debugCommon'),
    modeLabel: $('modeLabel'),
    current: $('currentText'),
    currentHint: $('currentHint'),
    overlay: $('overlay'),
    sheetEmoji: $('sheetEmoji'),
    sheetTitle: $('sheetTitle'),
    sheetTime: $('sheetTime'),
    sheetBurst: $('sheetBurst'),
    sheetSub: $('sheetSub'),
    sheetWords: $('sheetWords'),
    playAgain: $('playAgain'),
    stars: $('stars'),
    tube: $('tube'),
    tubeFill: $('tubeFill'),
    tubeTicks: $('tubeTicks'),
    modeToggle: $('modeToggle'),
    sheetStars: $('sheetStars'),
    challengeAction: $('challengeAction')
  };

  /* ----------------------------- vocabulary -----------------------------
   * Two difficulties over one dictionary. Hard uses the full common-word
   * vocabulary; easy uses a friendlier subset, so a board spells fewer
   * required words and every one of them is instantly recognisable. Bonus
   * words are shared: the dictionary does not change with difficulty.
   */
  const MODES = {
    hard: {
      label: 'Hard',
      common: cleanWords(window.LETTER_MELT_COMMON),
      long: cleanWords(window.LETTER_MELT_COMMON_LONG),
      base: cleanWords(window.LETTER_MELT_BASE)
    },
    easy: {
      label: 'Easy',
      common: cleanWords(window.LETTER_MELT_COMMON_EASY),
      long: cleanWords(window.LETTER_MELT_LONG_EASY),
      base: cleanWords(window.LETTER_MELT_BASE_EASY)
    }
  };

  for (const mode of Object.values(MODES)) {
    for (const word of ['advisor', 'broth', 'cram', 'grail', 'intone', 'mane']) {
      if (!mode.common.includes(word)) mode.common.push(word);
    }
  }

  const rawDict = typeof window.LETTER_MELT_DICT_RAW === 'string'
    ? window.LETTER_MELT_DICT_RAW.split(/\s+/).filter(isAllowedWord)
    : [];
  const fallbackDict = Generator.FALLBACK_COMMON
    .concat(Generator.FALLBACK_EXTRA, Generator.FALLBACK_LONG)
    .filter(isAllowedWord);
  const dictSource = rawDict.length
    ? rawDict
    : fallbackDict;

  const usable = list => (Array.isArray(list) && list.length ? list : null);

  /**
   * Word pools for a difficulty, falling back to hard (then to the embedded
   * lists) when the data files predate a contract.
   *
   * The embedded fallbacks substitute for missing data, never supplement it:
   * folding them into a real word list would smuggle their sample plurals
   * ("tones", "metals") into the required set.
   */
  function poolsFor(mode) {
    const m = MODES[mode] || MODES.hard;
    const common = usable(m.common) || usable(MODES.hard.common) || Generator.FALLBACK_COMMON;
    const long = usable(m.long) || usable(MODES.hard.long) || Generator.FALLBACK_LONG;
    // Every long word counts as required; only base words headline a puzzle.
    const base = usable(m.base) || usable(MODES.hard.base) || long;
    const familiar = (usable(MODES.easy.common) || common)
      .concat(usable(MODES.easy.long) || [], usable(MODES.easy.base) || []);
    return { common: common, long: long, base: base, familiar: familiar };
  }

  // Lexicons are ~300ms to build, so each difficulty builds one on first use.
  const lexicons = {};
  function lexiconFor(mode) {
    if (!lexicons[mode]) {
      const p = poolsFor(mode);
      lexicons[mode] = Generator.buildLexicon(dictSource, p.common, p.long, p.base);
    }
    return lexicons[mode];
  }

  let mode = 'easy';
  let lexicon = lexiconFor(mode);
  let dict = lexicon.words;
  let currentSeed = null;
  let shownStars = Engine.MAX_STARS;

  const renderer = window.LetterMeltRender.create(els.board);

  let game = null;
  let adjacency = new Map();
  let busy = false;
  let pendingTrace = null;
  let activeTrace = [];
  let lastTick = 0;
  let clockId = null;
  let hintTimer = null;
  let menuOpen = false;
  let tutorialOpen = false;
  let tutorialStep = 0;
  let debugOpen = false;
  let inputController = null;

  /* ------------------------------ helpers ------------------------------ */

  function rebuildAdjacency() {
    adjacency = Generator.adjacencyMap(game.puzzle.cells, game.puzzle.edges);
  }

  /**
   * Letters of the just-traced route that other words still need.
   *
   * Keyed off the route the player actually traced, NOT the puzzle's stored
   * route for the word. A word with a repeated letter often has several legal
   * routes, and the stored one may run through a different copy than the one
   * under the player's finger — reading survivors off the stored route lit up
   * and bounced the tile they never touched. Which cells LEAVE the board is a
   * property of the union, so it stays route-independent.
   */
  function keptLetters(result, tracedIds) {
    const gone = new Set(result.removedIds);
    return tracedIds.filter(id => !gone.has(id));
  }

  /* --------------------------- the clock ---------------------------- *
   * A vial of lava draining away rather than a number ticking up. It starts
   * full and empties to the right; the notches mark where each star goes, and
   * running it dry ends the game. Each difficulty has its own schedule.
   */
  function schedule() {
    return game ? game.schedule : Engine.scheduleFor(mode);
  }

  /** Fraction of the vial still full when `elapsedMs` has passed. */
  function fillFraction(elapsedMs) {
    return Math.max(0, Math.min(1, 1 - elapsedMs / schedule().failMs));
  }

  /** Notches sit where the draining edge will be as each star is lost. */
  function buildTicks() {
    els.tubeTicks.innerHTML = '';
    for (const tier of schedule().tiers) {
      const at = fillFraction(tier.withinMs);
      if (at <= 0 || at >= 1) continue;   // the last notch is the tube's end
      const tick = document.createElement('i');
      tick.style.left = (at * 100).toFixed(2) + '%';
      tick.dataset.at = String(tier.withinMs);
      els.tubeTicks.appendChild(tick);
    }
  }

  function renderStars(force) {
    const stars = Engine.starsFor(game.elapsedMs, game.schedule);
    const next = Engine.msToNextStarLoss(game.elapsedMs, game.schedule);
    if (stars !== shownStars || force) {
      const losing = stars < shownStars ? shownStars : 0;
      els.stars.innerHTML = '';
      for (let i = 1; i <= Engine.MAX_STARS; i++) {
        const star = document.createElement('i');
        star.textContent = '★';
        if (i > stars) star.classList.add('spent');
        if (i === losing && !renderer.prefersReducedMotion()) star.classList.add('losing');
        els.stars.appendChild(star);
      }
      shownStars = stars;
    }
    // The star about to go beats faster the nearer it gets. Quantize the
    // period so we do not restart the CSS animation on every clock tick.
    const atRisk = next !== null && next < 60000 && stars > 0 &&
      !renderer.prefersReducedMotion();
    const beat = atRisk ? (0.3 + (next / 60000) * 1.1).toFixed(1) + 's' : '';
    for (let i = 0; i < els.stars.children.length; i++) {
      const star = els.stars.children[i];
      const shouldRisk = atRisk && i === stars - 1;
      star.classList.toggle('atrisk', shouldRisk);
      if (shouldRisk) {
        if (star.style.getPropertyValue('--beat') !== beat) {
          star.style.setProperty('--beat', beat);
        }
      } else if (star.style.getPropertyValue('--beat')) {
        star.style.removeProperty('--beat');
      }
    }
  }

  function renderClock() {
    const elapsed = game.elapsedMs;
    const remaining = Math.max(0, schedule().failMs - elapsed);
    const fill = fillFraction(elapsed);
    const fillVar = fill.toFixed(4);
    if (els.tubeFill.style.getPropertyValue('--fill') !== fillVar) {
      els.tubeFill.style.setProperty('--fill', fillVar);
    }
    els.tube.classList.toggle('empty', fill <= 0);
    const timeText = Engine.formatTime(remaining);
    if (els.timerValue.textContent !== timeText) els.timerValue.textContent = timeText;

    const next = Engine.msToNextStarLoss(elapsed, game.schedule);
    els.tube.classList.toggle('warn', next !== null && next < 30000);

    for (const tick of els.tubeTicks.children) {
      tick.classList.toggle('passed', elapsed >= Number(tick.dataset.at));
    }
  }

  function renderHud(tick) {
    renderClock();
    renderStars();
    const solved = String(Engine.solvedCount(game));
    if (tick && els.solvedCount.textContent !== solved) {
      els.solvedCount.classList.remove('tick');
      void els.solvedCount.offsetWidth;   // restart the spring
      els.solvedCount.classList.add('tick');
      window.setTimeout(() => els.solvedCount.classList.remove('tick'), 560);
    }
    if (els.solvedCount.textContent !== solved) els.solvedCount.textContent = solved;
    const total = String(Engine.totalWords(game));
    if (els.totalCount.textContent !== total) els.totalCount.textContent = total;
  }

  function toast(text, tone) {
    const node = document.createElement('div');
    node.className = tone ? 'toast toast-' + tone : 'toast';
    node.textContent = text;
    els.timerToasts.appendChild(node);
    window.setTimeout(() => node.remove(), 1300);
  }

  /** An extra word buys time back: the tube flashes blue as it refills. */
  function flashTimer(tone) {
    const cls = tone === 'extra' ? 'credited-extra' : 'credited';
    els.tube.classList.remove('credited', 'credited-extra');
    void els.tube.offsetWidth;   // restart the flash on rapid extras
    els.tube.classList.add(cls);
    window.setTimeout(() => els.tube.classList.remove(cls), 900);
  }

  /** Small one-line explanation under the traced word. */
  function setHint(text) {
    if (!els.currentHint) return;
    els.currentHint.textContent = text || '';
    els.currentHint.classList.toggle('visible', !!text);
    if (hintTimer) window.clearTimeout(hintTimer);
    if (text) hintTimer = window.setTimeout(() => setHint(''), 1100);
  }

  function setCurrent(text, mood) {
    if (!mood) setHint('');
    els.current.className = 'current-text' + (mood ? ' ' + mood : '');
    els.current.textContent = text ? text.toUpperCase() : '';
  }

  function flashCurrent(text, mood, holdMs) {
    setCurrent(text, mood);
    window.setTimeout(() => {
      if (els.current.textContent === text.toUpperCase()) setCurrent('');
    }, holdMs || 700);
  }

  /* ------------------------------- loop -------------------------------- *
   * The HUD is a draining clock, not a 60fps scene. A 4 Hz interval is
   * plenty for the vial and the M:SS readout, and it is what keeps phones
   * from cooking while the player is just staring at the board.
   */

  const CLOCK_MS = 250;

  function clockPaused() {
    return menuOpen || debugOpen || document.hidden;
  }

  function syncFxPause() {
    const idle = document.hidden || menuOpen || debugOpen ||
      !game || game.status !== 'playing';
    document.body.classList.toggle('fx-paused', idle);
  }

  function stopClock() {
    if (clockId !== null) {
      window.clearInterval(clockId);
      clockId = null;
    }
    syncFxPause();
  }

  function startClock() {
    stopClock();
    lastTick = performance.now();
    clockId = window.setInterval(tickClock, CLOCK_MS);
    syncFxPause();
  }

  function tickClock() {
    if (!game || game.status !== 'playing') {
      stopClock();
      return;
    }
    const now = performance.now();
    if (clockPaused()) {
      // Keep the baseline current while paused so resuming does not jump.
      lastTick = now;
      return;
    }
    const dt = lastTick ? now - lastTick : 0;
    lastTick = now;
    const ranOut = dt > 0 && dt < 2000 ? Engine.tick(game, dt) : false;
    renderHud();
    if (ranOut) fail();
  }

  /* ------------------------------ endgame ------------------------------ */

  /** Count the final time up from zero, then settle on the real value. */
  function countUpTime(target) {
    if (renderer.prefersReducedMotion()) {
      els.sheetTime.textContent = Engine.formatTime(target);
      return;
    }
    const duration = 900;
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      els.sheetTime.textContent = Engine.formatTime(target * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** Celebratory particle burst behind the win copy. */
  function burst() {
    els.sheetBurst.innerHTML = '';
    if (renderer.prefersReducedMotion()) return;
    const colors = ['#ffd166', '#ffb04d', '#ff6b5a', '#fff3e6'];
    for (let i = 0; i < 18; i++) {
      const dot = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const dist = 90 + Math.random() * 90;
      dot.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
      dot.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
      dot.style.setProperty('--delay', (Math.random() * 0.25).toFixed(2) + 's');
      dot.style.setProperty('--spark', colors[i % colors.length]);
      els.sheetBurst.appendChild(dot);
    }
  }

  function finish() {
    busy = true;
    renderHud();
    const extras = game.extraWords;
    const saved = Math.round(game.savedMs / 1000);
    els.sheetEmoji.textContent = '🎉';
    els.sheetTitle.textContent = 'Solved!';
    countUpTime(game.elapsedMs);
    els.sheetSub.textContent = extras.length
      ? extras.length + ' extra word' + (extras.length === 1 ? '' : 's') + ' saved you ' + saved + 's'
      : 'No extra words found — try hunting for bonus words next time.';

    const stars = Engine.starsFor(game.elapsedMs, game.schedule);
    els.sheetStars.innerHTML = '';
    for (let i = 1; i <= Engine.MAX_STARS; i++) {
      const star = document.createElement('i');
      star.textContent = '★';
      if (i > stars) star.classList.add('spent');
      star.style.setProperty('--delay', (0.1 * i).toFixed(2) + 's');
      els.sheetStars.appendChild(star);
    }

    els.sheetWords.innerHTML = '';
    for (const extra of extras.slice(0, 18)) {
      const li = document.createElement('li');
      li.className = 'extra';
      li.textContent = extra.word;
      els.sheetWords.appendChild(li);
    }
    shareController.reset();
    els.overlay.hidden = false;
    stopClock();
    burst();
  }

  /** The vial ran dry: show what was left on the board. */
  function fail() {
    busy = true;
    renderHud();
    renderer.clearTrace();
    renderer.setTone(null);
    const missed = Engine.remainingWords(game);
    els.sheetEmoji.textContent = '💀';
    els.sheetTitle.textContent = 'Out of time';
    els.sheetTime.textContent = Engine.formatTime(schedule().failMs);
    els.sheetSub.textContent = missed.length === 1
      ? 'One word got away.'
      : missed.length + ' words got away.';

    els.sheetStars.innerHTML = '';
    for (let i = 1; i <= Engine.MAX_STARS; i++) {
      const star = document.createElement('i');
      star.textContent = '★';
      star.classList.add('spent');
      star.style.setProperty('--delay', (0.05 * i).toFixed(2) + 's');
      els.sheetStars.appendChild(star);
    }

    els.sheetWords.innerHTML = '';
    for (const word of missed.slice(0, 18)) {
      const li = document.createElement('li');
      li.className = 'missed';
      li.textContent = word.text;
      els.sheetWords.appendChild(li);
    }
    els.sheetBurst.innerHTML = '';
    shareController.reset();
    els.overlay.hidden = false;
    stopClock();
  }

  /* ------------------------------ sharing ------------------------------ *
   * A puzzle is just a seed plus a difficulty, so a link is enough to hand
   * someone the exact board you played.
   */

  function puzzleLink() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('s', String(currentSeed));
    url.searchParams.set('m', mode);
    return url.toString();
  }

  function shareMessage() {
    const label = MODES[mode].label.toLowerCase();
    return Share.shareMessage({
      status: game.status,
      modeLabel: label,
      stars: Engine.starsFor(game.elapsedMs, game.schedule),
      elapsed: Engine.formatTime(game.elapsedMs),
      link: puzzleLink()
    });
  }

  const shareController = Share.createController({
    button: els.challengeAction,
    navigator: navigator,
    document: document,
    window: window,
    getText: shareMessage
  });

  const menuShareController = Share.createController({
    button: els.menuShare,
    labelElement: els.menuShareLabel,
    navigator: navigator,
    document: document,
    window: window,
    mobileShare: false,
    defaultLabel: 'Share game',
    copiedLabel: 'Link copied!',
    getText: puzzleLink
  });

  const TUTORIAL_CELLS = [
    { id: 't0', letter: 'T', x: 0, y: 0 },
    { id: 'u0', letter: 'U', x: 1, y: 0 },
    { id: 't1', letter: 'T', x: 2, y: 0 },
    { id: 'o0', letter: 'O', x: 3, y: 0 },
    { id: 's0', letter: 'S', x: 0, y: 1 },
    { id: 't2', letter: 'T', x: 1, y: 1 },
    { id: 'i0', letter: 'I', x: 2, y: 1 },
    { id: 'r0', letter: 'R', x: 3, y: 1 },
    { id: 'p0', letter: 'P', x: 0, y: 2 },
    { id: 'l0', letter: 'L', x: 1, y: 2 },
    { id: 'a0', letter: 'A', x: 2, y: 2 },
    { id: 'l1', letter: 'L', x: 2, y: 3 },
    { id: 'y0', letter: 'Y', x: 3, y: 3 }
  ];
  const TUTORIAL_STEPS = [
    {
      word: 'PLAY',
      guide: 'Drag through connected letters to spell PLAY.',
      route: ['p0', 'l0', 'a0', 'y0']
    },
    {
      word: 'START',
      guide: 'Move sideways, vertically, or diagonally — just never reuse a tile.',
      route: ['s0', 't2', 'a0', 'r0', 't1']
    },
    {
      word: 'TUTORIAL',
      guide: 'Longer words can twist around the board. Hunt for the fun ones!',
      route: ['t0', 'u0', 't1', 'o0', 'r0', 'i0', 'a0', 'l1']
    },
    {
      word: 'READY!',
      guide: 'Release to submit. Solved words melt away, and bonus words put time back.',
      route: null
    }
  ];
  const tutorialById = new Map(TUTORIAL_CELLS.map(cell => [cell.id, cell]));

  function buildTutorialBoard() {
    els.tutorialCells.innerHTML = '';
    for (const cell of TUTORIAL_CELLS) {
      const tile = document.createElement('span');
      tile.className = 'tutorial-cell';
      tile.dataset.id = cell.id;
      tile.textContent = cell.letter;
      tile.setAttribute('aria-hidden', 'true');
      tile.style.gridColumn = String(cell.x + 1);
      tile.style.gridRow = String(cell.y + 1);
      els.tutorialCells.appendChild(tile);
    }
  }

  function drawTutorialRoute(route, routeIndex) {
    for (let i = 1; i < route.length; i++) {
      const from = tutorialById.get(route[i - 1]);
      const to = tutorialById.get(route[i]);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(from.x * 100 + 50));
      line.setAttribute('y1', String(from.y * 100 + 50));
      line.setAttribute('x2', String(to.x * 100 + 50));
      line.setAttribute('y2', String(to.y * 100 + 50));
      line.classList.add('tutorial-link');
      if (routeIndex !== null) line.classList.add('route-' + routeIndex);
      line.style.setProperty('--delay', String((i - 1) * 55) + 'ms');
      els.tutorialLinks.appendChild(line);
    }
  }

  function renderTutorial() {
    const step = TUTORIAL_STEPS[tutorialStep];
    els.tutorialGuide.textContent = step.guide;
    els.tutorialWord.textContent = step.word;
    els.tutorialProgress.textContent = (tutorialStep + 1) + ' of ' + TUTORIAL_STEPS.length;
    els.tutorialBack.disabled = tutorialStep === 0;
    els.tutorialNext.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Start playing' : 'Next';
    els.tutorialLinks.innerHTML = '';

    const activeIds = new Set(step.route || TUTORIAL_CELLS.map(cell => cell.id));
    for (const tile of els.tutorialCells.children) {
      tile.classList.toggle('is-path', activeIds.has(tile.dataset.id));
      tile.classList.toggle('is-ready', !step.route);
      if (step.route) {
        const index = step.route.indexOf(tile.dataset.id);
        tile.style.setProperty('--delay', String(Math.max(0, index) * 55) + 'ms');
      } else {
        tile.style.removeProperty('--delay');
      }
    }

    if (step.route) {
      drawTutorialRoute(step.route, tutorialStep);
    } else {
      for (let i = 0; i < TUTORIAL_STEPS.length - 1; i++) {
        drawTutorialRoute(TUTORIAL_STEPS[i].route, i);
      }
    }
  }

  function closeTutorial(returnToMenu) {
    if (!tutorialOpen) return;
    tutorialOpen = false;
    els.tutorialOverlay.hidden = true;
    els.tutorialOverlay.setAttribute('aria-hidden', 'true');
    if (returnToMenu && menuOpen) {
      els.menuOverlay.hidden = false;
      els.menuOverlay.setAttribute('aria-hidden', 'false');
      els.openTutorial.focus();
    }
  }

  function showTutorial() {
    if (!menuOpen) return;
    tutorialStep = 0;
    tutorialOpen = true;
    els.menuOverlay.hidden = true;
    els.menuOverlay.setAttribute('aria-hidden', 'true');
    renderTutorial();
    els.tutorialOverlay.hidden = false;
    els.tutorialOverlay.setAttribute('aria-hidden', 'false');
    els.tutorialClose.focus();
  }

  function closeMenu() {
    if (!menuOpen) return;
    closeTutorial(false);
    menuOpen = false;
    els.menuOverlay.hidden = true;
    els.menuOverlay.setAttribute('aria-hidden', 'true');
    els.menuButton.setAttribute('aria-expanded', 'false');
    lastTick = performance.now();
    syncFxPause();
  }

  function renderDebug() {
    const words = game.puzzle.words;
    const commonWords = Array.from(Generator.enumerateCommon(game.puzzle.cells, game.puzzle.edges, lexicon).keys()).sort();
    els.debugMeta.textContent = MODES[mode].label + ' mode · seed ' + currentSeed;
    els.debugWordCount.textContent = words.length + ' total';
    els.debugWords.innerHTML = '';
    for (const word of words) {
      const item = document.createElement('li');
      item.className = word.found ? 'found' : '';
      item.textContent = word.text + (word.found ? ' · found' : '');
      els.debugWords.appendChild(item);
    }
    els.debugCommonCount.textContent = commonWords.length + ' words';
    els.debugCommon.textContent = commonWords.join(' · ');
  }

  function closeDebug() {
    if (!debugOpen) return;
    debugOpen = false;
    els.debugOverlay.hidden = true;
    els.debugOverlay.setAttribute('aria-hidden', 'true');
    lastTick = performance.now();
    syncFxPause();
  }

  function openDebug() {
    if (!game || game.status !== 'playing') return;
    if (menuOpen) closeMenu();
    debugOpen = true;
    lastTick = performance.now();
    syncFxPause();
    if (inputController) inputController.cancel();
    activeTrace = [];
    renderer.clearTrace();
    setCurrent('');
    renderDebug();
    els.debugOverlay.hidden = false;
    els.debugOverlay.setAttribute('aria-hidden', 'false');
    els.debugClose.focus();
  }

  function openMenu() {
    if (!game || game.status !== 'playing' || els.overlay.hidden === false) return;
    menuOpen = true;
    lastTick = performance.now();
    syncFxPause();
    if (inputController) inputController.cancel();
    activeTrace = [];
    renderer.clearTrace();
    setCurrent('');
    menuShareController.reset();
    closeTutorial(false);
    els.menuOverlay.hidden = false;
    els.menuOverlay.setAttribute('aria-hidden', 'false');
    els.menuButton.setAttribute('aria-expanded', 'true');
  }

  /* ------------------------------ submit ------------------------------- */

  function handleSubmit(ids) {
    if (!game || game.status !== 'playing' || !ids.length) {
      renderer.clearTrace();
      renderer.setTone(null);
      setCurrent('');
      return;
    }
    // A player may finish tracing while the previous word is still melting.
    // Keep that attempt and judge it after the board transition has settled.
    if (busy) {
      pendingTrace = ids.slice();
      return;
    }
    const word = Generator.traceToWord(game.puzzle.cells, ids);
    const result = Engine.submitWord(game, word);

    if (result.type === 'required') {
      busy = true;
      // Removing a word only shrinks the union, so the remaining graph is
      // already safe to trace while the renderer animates the old layout.
      rebuildAdjacency();
      setCurrent(word, 'good');
      renderHud(true);
      // The base word no longer sits on a pill waiting to be found; solving it
      // just says so, and the message fades like every other.
      if (result.isLong) setHint('longest word!');
      // Green: a word off the board. The fill holds for the same beat a grey
      // repeat gets, then drains — letters shared with other words keep their
      // connections, so leaving the trace up would strand them filled. The
      // tone rides through the melt and is cleared in onDone below.
      renderer.drainTrace('good', 380, true);
      renderer.playFound({
        removedIds: result.removedIds,
        removedEdgeKeys: result.removedEdgeKeys,
        keptIds: keptLetters(result, ids),
        traceIds: ids,
        onDone: function () {
          const nextTrace = pendingTrace;
          pendingTrace = null;
          rebuildAdjacency();
          busy = false;
          if (!activeTrace.length) setCurrent('');
          renderer.setTone(null);
          if (result.solved) finish();
          else if (nextTrace) handleSubmit(nextTrace);
        }
      });
      return;
    }

    if (result.type === 'extra') {
      // Blue: a rare word, worth time back rather than a place on the board.
      renderer.drainTrace('extra', 520);
      renderer.sparkAt(ids[ids.length - 1]);
      toast('-' + result.seconds + 's', 'extra');
      flashTimer('extra');
      flashCurrent(word, 'extra', 800);
      renderHud();
      return;
    }

    // Feedback is split by MEANING, not lumped into one rejection:
    //   already found -> neutral acknowledgement, no red shake
    //   too short     -> a quiet nudge about the 4-letter minimum
    //   not a word    -> the red shake
    if (result.type === 'repeat-required' || result.type === 'repeat-extra') {
      // Grey: you already have this one, nothing more to win from it.
      renderer.drainTrace('dim', 380);
      flashCurrent(word, 'again', 900);
      setHint('already found');
      return;
    }

    // Plurals are deliberately not in the dictionary, so say that outright
    // rather than letting the red shake imply the letters spell nothing.
    if (result.type === 'plural') {
      renderer.drainTrace('dim', 380);
      flashCurrent(word, 'again', 900);
      setHint('no plurals');
      return;
    }

    if (result.type === 'short') {
      // Grey too: nothing is wrong with the letters, the word is just short.
      renderer.drainTrace('dim', 320);
      flashCurrent(word || '·', 'short', 700);
      setHint('4 letters or more');
      return;
    }

    renderer.drainTrace('bad', 320);
    renderer.flashTrace(ids, 'wrong');
    flashCurrent(word || '·', 'bad', 620);
  }

  /* ------------------------------ new game ----------------------------- */

  function newGame(seed) {
    const pools = poolsFor(mode);
    const wanted = (seed === undefined || seed === null) ? undefined : (seed >>> 0);
    const puzzle =
      Generator.generatePuzzle({
        words: pools.common,
        longWords: pools.base,
        lexicon: lexicon,
        seed: wanted,
        mode: mode,
        familiar: pools.familiar
      }) ||
      Generator.generatePuzzle({
        words: Generator.FALLBACK_COMMON,
        longWords: Generator.FALLBACK_LONG,
        lexicon: lexicon,
        mode: mode
      });
    if (!puzzle) {
      els.sheetEmoji.textContent = '😵';
      els.sheetTitle.textContent = 'Could not build a puzzle';
      els.sheetTime.textContent = '';
      els.sheetSub.textContent = 'Try again.';
      els.overlay.hidden = false;
      stopClock();
      return;
    }
    currentSeed = puzzle.seed;
    game = Engine.createGame({ puzzle: puzzle, dict: dict, mode: mode });
    shownStars = Engine.MAX_STARS;
    rebuildAdjacency();
    renderer.setPuzzle(puzzle);
    buildTicks();
    renderHud();
    renderStars(true);
    setCurrent('');
    closeMenu();
    closeDebug();
    els.overlay.hidden = true;
    busy = false;
    pendingTrace = null;
    activeTrace = [];
    startClock();
  }

  /* ------------------------------- input ------------------------------- */

  inputController = window.LetterMeltInput.attach(els.board, renderer, {
    getAdjacency: () => adjacency,
    isActive: () => !!game && game.status === 'playing' && !menuOpen && !tutorialOpen,
    onTraceChange: ids => {
      const starting = !activeTrace.length && ids.length > 0;
      activeTrace = ids.slice();
      // A fresh attempt always returns the player fill to its neutral molten
      // orange, regardless of the previous verdict's temporary tone.
      if (starting) renderer.setTone(null);
      if (!ids.length) {
        // Releasing the finger clears the live trace text, but never the
        // verdict a submit just put there (good / again / short / bad) —
        // flashCurrent owns clearing that.
        if (busy) return;
        if (els.current.className === 'current-text') setCurrent('');
        return;
      }
      setCurrent(Generator.traceToWord(game.puzzle.cells, ids));
    },
    onLock: id => renderer.lockPulse(id),
    onStart: id => renderer.lockPulse(id),
    onSubmit: handleSubmit,
    onCancel: () => setCurrent('')
  });

  els.menuButton.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
  els.menuOverlay.addEventListener('click', ev => {
    if (ev.target === els.menuOverlay) closeMenu();
  });
  els.resumeGame.addEventListener('click', closeMenu);
  els.openTutorial.addEventListener('click', showTutorial);
  els.tutorialClose.addEventListener('click', () => closeTutorial(true));
  els.tutorialOverlay.addEventListener('click', ev => {
    if (ev.target === els.tutorialOverlay) closeTutorial(true);
  });
  els.tutorialBack.addEventListener('click', () => {
    tutorialStep = Math.max(0, tutorialStep - 1);
    renderTutorial();
  });
  els.tutorialNext.addEventListener('click', () => {
    if (tutorialStep === TUTORIAL_STEPS.length - 1) {
      closeMenu();
      return;
    }
    tutorialStep += 1;
    renderTutorial();
  });
  els.debugClose.addEventListener('click', closeDebug);
  els.debugDone.addEventListener('click', closeDebug);
  els.debugOverlay.addEventListener('click', ev => {
    if (ev.target === els.debugOverlay) closeDebug();
  });
  els.newGame.addEventListener('click', () => newGame());
  els.playAgain.addEventListener('click', () => newGame());
  els.challengeAction.addEventListener('click', shareController.share);
  els.menuShare.addEventListener('click', menuShareController.share);

  function renderMode() {
    const easy = mode === 'easy';
    const nextMode = easy ? 'hard' : 'easy';
    const nextLabel = MODES[nextMode].label;
    els.modeLabel.textContent = MODES[mode].label;
    els.modeToggle.setAttribute('aria-pressed', String(easy));
    els.modeToggle.setAttribute('aria-label', 'Switch to ' + nextLabel + ' mode');
    els.modeToggle.classList.toggle('easy', easy);
    els.menuModeTitle.textContent = 'Switch to ' + nextLabel;
    els.menuModeDetail.textContent = 'Try the ' + (easy ? 'harder' : 'easier') + ' word pool';
  }

  els.modeToggle.addEventListener('click', () => {
    mode = mode === 'hard' ? 'easy' : 'hard';
    lexicon = lexiconFor(mode);
    dict = lexicon.words;
    renderMode();
    newGame();
  });

  document.addEventListener('keydown', ev => {
    if (ev.key.toLowerCase() === 'd' && game && game.status === 'playing') {
      ev.preventDefault();
      if (debugOpen) closeDebug();
      else openDebug();
    } else if (ev.key === 'Escape' && tutorialOpen) {
      closeTutorial(true);
    } else if (ev.key === 'Escape' && debugOpen) {
      closeDebug();
    } else if (ev.key === 'Escape' && menuOpen) {
      closeMenu();
    }
  });

  // Kill double-tap zoom and rubber-band scrolling on iOS.
  document.addEventListener('gesturestart', ev => ev.preventDefault());
  document.addEventListener('dblclick', ev => ev.preventDefault());
  document.addEventListener('touchmove', ev => {
    if (ev.cancelable) ev.preventDefault();
  }, { passive: false });

  window.addEventListener('resize', () => {
    if (game) renderer.refresh();
  });

  document.addEventListener('visibilitychange', () => {
    lastTick = performance.now();
    syncFxPause();
  });

  /**
   * A shared link carries the seed and difficulty, so opening it rebuilds the
   * exact board the sender played. Anything unparseable just starts a normal
   * game rather than failing.
   */
  function startFromLocation() {
    let seed = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash.replace(/^#/, '');
      const fromHash = hash ? new URLSearchParams(hash) : null;
      const rawMode = params.get('m') || (fromHash && fromHash.get('m'));
      const rawSeed = params.get('s') || (fromHash && fromHash.get('s'));
      if (rawMode && MODES[rawMode]) {
        mode = rawMode;
        lexicon = lexiconFor(mode);
        dict = lexicon.words;
      }
      if (rawSeed && /^\d+$/.test(rawSeed)) seed = Number(rawSeed) >>> 0;
    } catch (_e) { /* malformed URL: just play a fresh board */ }
    renderMode();
    newGame(seed);
  }

  buildTutorialBoard();
  startFromLocation();

  // Test/debug hook.
  window.LETTER_MELT = {
    newGame: newGame,
    getGame: () => game,
    getSeed: () => currentSeed,
    getMode: () => mode,
    setMode: function (next) {
      if (!MODES[next]) return false;
      mode = next;
      lexicon = lexiconFor(mode);
      dict = lexicon.words;
      renderMode();
      return true;
    },
    shareMessage: () => shareMessage(),
    renderer: renderer,
    lexicon: lexicon,
    enumerate: function () {
      const g = game.puzzle;
      return Array.from(Generator.enumerateWords(g.cells, g.edges, lexicon).keys());
    },
    solve: function (text) {
      const traceIds = Generator.findRoute(game.puzzle.cells, game.puzzle.edges, text) || [];
      const result = Engine.submitWord(game, text);
      if (result.type === 'required') {
        renderHud();
        renderer.playFound({
          removedIds: result.removedIds,
          removedEdgeKeys: result.removedEdgeKeys,
          keptIds: keptLetters(result, traceIds),
          traceIds: traceIds,
          onDone: function () {
            rebuildAdjacency();
            if (result.solved) finish();
          }
        });
      }
      return result;
    }
  };
})();
