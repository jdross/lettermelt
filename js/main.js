/* LetterMelt — wiring. */
(function () {
  'use strict';

  const Generator = window.LetterMeltGenerator;
  const Engine = window.LetterMeltEngine;
  const Share = window.LetterMeltShare;
  const History = window.LetterMeltHistory;

  // Keep sensitive categories out of both required and bonus words at the
  // runtime boundary as well as in the word-list build pipeline. This also
  // protects users running an older cached data asset.
  const BLOCKED_WORDS = new Set([
    'marijuana', 'cannabis', 'hashish', 'heroin', 'cocaine', 'meth', 'ecstasy',
    'mdma', 'opioid', 'opioids', 'fentanyl', 'overdose', 'drug', 'drugs'
  ]);
  const isAllowedWord = word => {
    const w = String(word).toLowerCase();
    return !w.includes('sex') && !w.includes('drug') &&
      !w.includes('porn') && !w.includes('fuck') && !BLOCKED_WORDS.has(w);
  };

  const $ = id => document.getElementById(id);
  const els = {
    board: $('board'),
    timerValue: $('timerValue'),
    timerToasts: $('timerToasts'),
    solvedCount: $('solvedCount'),
    totalCount: $('totalCount'),
    dailyEasy: $('dailyEasy'),
    dailyHard: $('dailyHard'),
    newGame: $('newGame'),
    mainWordPicker: $('mainWordPicker'),
    mainWordInput: $('mainWordInput'),
    mainWordHint: $('mainWordHint'),
    mainWordStart: $('mainWordStart'),
    mainWordRandom: $('mainWordRandom'),
    mainWordCancel: $('mainWordCancel'),
    otherModeEasy: $('otherModeEasy'),
    otherModeHard: $('otherModeHard'),
    menuOptions: $('menuOptions'),
    menuButton: $('menuButton'),
    menuOverlay: $('menuOverlay'),
    menuKicker: $('menuKicker'),
    menuTitle: $('menuTitle'),
    menuSub: $('menuSub'),
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
    debugOverlay: $('debugOverlay'),
    debugClose: $('debugClose'),
    debugDone: $('debugDone'),
    debugMeta: $('debugMeta'),
    debugWordCount: $('debugWordCount'),
    debugWords: $('debugWords'),
    debugCommonCount: $('debugCommonCount'),
    debugCommon: $('debugCommon'),
    current: $('currentText'),
    currentHint: $('currentHint'),
    overlay: $('overlay'),
    sheetEmoji: $('sheetEmoji'),
    sheetTitle: $('sheetTitle'),
    sheetTime: $('sheetTime'),
    sheetBurst: $('sheetBurst'),
    sheetSub: $('sheetSub'),
    sheetWordsLabel: $('sheetWordsLabel'),
    sheetWords: $('sheetWords'),
    playAgain: $('playAgain'),
    resultDailyEasy: $('resultDailyEasy'),
    resultDailyHard: $('resultDailyHard'),
    stars: $('stars'),
    tube: $('tube'),
    tubeFill: $('tubeFill'),
    tubeTicks: $('tubeTicks'),
    sheetStars: $('sheetStars'),
    challengeAction: $('challengeAction'),
    reviewBoard: $('reviewBoard'),
    reviewBack: $('reviewBack')
  };

  /* Packed lexicon: one copy of every word, bit flags for the pools.
   * Two difficulties over one dictionary. Hard uses the full common-word
   * vocabulary; easy uses a friendlier subset. Bonus words are shared.
   * Fall back to the embedded lists if the data file is missing. */
  const unpacked = window.LETTER_MELT_LEXICON
    ? Generator.unpackLexicon(window.LETTER_MELT_LEXICON)
    : null;

  function cleanPool(list) {
    return Array.isArray(list) ? list.filter(isAllowedWord) : [];
  }

  const MODES = unpacked ? {
    hard: {
      label: 'Hard',
      common: cleanPool(unpacked.pools.hard.common),
      long: cleanPool(unpacked.pools.hard.long),
      base: cleanPool(unpacked.pools.hard.base)
    },
    easy: {
      label: 'Easy',
      common: cleanPool(unpacked.pools.easy.common),
      long: cleanPool(unpacked.pools.easy.long),
      base: cleanPool(unpacked.pools.easy.base)
    }
  } : {
    hard: { label: 'Hard', common: [], long: [], base: [] },
    easy: { label: 'Easy', common: [], long: [], base: [] }
  };

  const usable = list => (Array.isArray(list) && list.length ? list : null);

  /**
   * Word pools for a difficulty. Missing easy data falls back to hard, then
   * to the embedded lists. Those lists substitute for missing data; never
   * concatenate them onto a real word list (they contain sample plurals).
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

  // Screen the base-word pool once per difficulty on first use.
  const lexicons = {};
  function lexiconFor(mode) {
    if (!lexicons[mode]) {
      if (unpacked) {
        lexicons[mode] = Generator.lexiconFromPacked(unpacked, mode);
      } else {
        const p = poolsFor(mode);
        lexicons[mode] = Generator.buildLexicon(
          p.common.concat(p.long, Generator.FALLBACK_EXTRA),
          p.common, p.long, p.base
        );
      }
    }
    return lexicons[mode];
  }

  let mode = 'easy';
  let lexicon = lexiconFor(mode);
  let dict = lexicon.words;
  let currentSeed = null;
  let currentMainWord = null;
  let currentDailyMode = null;
  let currentDailyDate = null;
  let otherGameMode = 'easy';
  let shownStars = Engine.MAX_STARS;

  const renderer = window.LetterMeltRender.create(els.board);
  const history = History ? History.create(window) : null;

  let game = null;
  let openingPuzzle = null;
  let adjacency = new Map();
  let busy = false;
  let pendingTrace = null;
  let activeTrace = [];
  let lastTick = 0;
  let clockId = null;
  let hintTimer = null;
  let menuOpen = false;
  let homeMenu = false;
  let tutorialOpen = false;
  let tutorialStep = 0;
  let debugOpen = false;
  let reviewing = false;
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

  function appendWordLogRow(word, elapsedMs, className, suffix) {
    const li = document.createElement('li');
    li.className = className || 'found-time';
    const label = document.createElement('span');
    label.textContent = word + (suffix ? ' · ' + suffix : '');
    li.appendChild(label);
    if (elapsedMs != null) {
      const time = document.createElement('time');
      time.textContent = Engine.formatTime(elapsedMs);
      li.appendChild(time);
    }
    els.sheetWords.appendChild(li);
  }

  function renderEndWordLog(missed) {
    els.sheetWordsLabel.textContent = 'Found words · game time';
    els.sheetWords.classList.add('with-times');
    els.sheetWords.innerHTML = '';
    const found = game.foundWordTimes || game.foundWords.map(word => ({ word: word, elapsedMs: null }));
    for (const entry of found) appendWordLogRow(entry.word, entry.elapsedMs, 'found-time');
    for (const extra of game.extraWords) {
      appendWordLogRow(extra.word, extra.foundAtMs, 'extra', 'bonus');
    }
    for (const word of missed || []) {
      appendWordLogRow(word.text, null, 'missed');
    }
  }

  function saveGameResult() {
    if (!history || !game || (game.status !== 'won' && game.status !== 'lost')) return;
    const foundWords = [];
    for (const found of game.foundWordTimes || []) foundWords.push(found);
    for (const extra of game.extraWords || []) {
      foundWords.push({ word: extra.word, elapsedMs: extra.foundAtMs });
    }
    foundWords.sort((a, b) => a.elapsedMs - b.elapsedMs);
    history.save({
      seed: currentSeed,
      mode: mode,
      mainWord: currentMainWord,
      dailyDate: currentDailyDate,
      status: game.status,
      elapsedMs: game.elapsedMs,
      stars: Engine.starsFor(game.elapsedMs, game.schedule),
      foundWords: foundWords
    });
  }

  function renderResultDailyActions() {
    for (const [button, nextMode] of [
      [els.resultDailyEasy, 'easy'],
      [els.resultDailyHard, 'hard']
    ]) {
      button.hidden = !!(history && history.getDaily(dailyDateKey(), nextMode));
    }
  }

  function finish() {
    busy = true;
    saveGameResult();
    renderHud();
    const extras = game.extraWords;
    const saved = Math.round(game.savedMs / 1000);
    els.sheetEmoji.textContent = '🎉';
    els.sheetTitle.textContent = 'Solved!';
    countUpTime(game.elapsedMs);
    els.sheetSub.textContent = extras.length
      ? extras.length + ' extra word' + (extras.length === 1 ? '' : 's') + ' saved you ' + saved + 's'
      : '';

    const stars = Engine.starsFor(game.elapsedMs, game.schedule);
    els.sheetStars.innerHTML = '';
    for (let i = 1; i <= Engine.MAX_STARS; i++) {
      const star = document.createElement('i');
      star.textContent = '★';
      if (i > stars) star.classList.add('spent');
      star.style.setProperty('--delay', (0.1 * i).toFixed(2) + 's');
      els.sheetStars.appendChild(star);
    }

    renderEndWordLog([]);
    renderResultDailyActions();
    shareController.reset();
    reviewing = false;
    els.reviewBack.hidden = true;
    els.menuButton.hidden = false;
    els.overlay.hidden = false;
    stopClock();
    burst();
  }

  /** The vial ran dry: show what was left on the board. */
  function fail() {
    busy = true;
    saveGameResult();
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

    renderEndWordLog(missed);
    renderResultDailyActions();
    els.sheetBurst.innerHTML = '';
    shareController.reset();
    reviewing = false;
    els.reviewBack.hidden = true;
    els.menuButton.hidden = false;
    els.overlay.hidden = false;
    stopClock();
  }

  function openReview() {
    if (!game || (game.status !== 'won' && game.status !== 'lost')) return;
    reviewing = true;
    if (game.status === 'won' && openingPuzzle) renderer.setPuzzle(openingPuzzle);
    renderer.clearTrace();
    renderer.setTone(null);
    els.overlay.hidden = true;
    els.menuButton.hidden = true;
    els.reviewBack.hidden = false;
    els.reviewBack.focus();
  }

  function closeReview() {
    if (!reviewing) return;
    reviewing = false;
    els.reviewBack.hidden = true;
    els.menuButton.hidden = false;
    els.overlay.hidden = false;
  }

  /* ------------------------------ sharing ------------------------------ *
   * A puzzle is a seed plus a difficulty, with an optional requested main
   * word. That is enough to hand someone the exact board you played.
   */

  function puzzleLink() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('s', String(currentSeed));
    url.searchParams.set('m', mode);
    if (currentMainWord) url.searchParams.set('w', currentMainWord);
    else url.searchParams.delete('w');
    return url.toString();
  }

  /**
   * Share links live in ?s=&m=&w= (or a hash fallback). A fresh board is no
   * longer that puzzle, so drop those params or a refresh rebuilds the old one.
   */
  function clearGameQuery() {
    try {
      const url = new URL(window.location.href);
      const hash = url.hash.replace(/^#/, '');
      const hashParams = hash ? new URLSearchParams(hash) : null;
      const hadSearch = url.searchParams.has('s') || url.searchParams.has('m') || url.searchParams.has('w');
      const hadHash = !!(hashParams && (hashParams.has('s') || hashParams.has('m') || hashParams.has('w')));
      if (!hadSearch && !hadHash) return;
      url.searchParams.delete('s');
      url.searchParams.delete('m');
      url.searchParams.delete('w');
      if (hadHash) {
        hashParams.delete('s');
        hashParams.delete('m');
        hashParams.delete('w');
        const leftover = hashParams.toString();
        url.hash = leftover ? leftover : '';
      }
      const next = url.pathname + url.search + url.hash;
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (next !== current) history.replaceState(null, '', next);
    } catch (_e) { /* file:// or a locked history: just play */ }
  }

  function rememberGameQuery() {
    try {
      const url = new URL(window.location.href);
      url.hash = '';
      url.searchParams.set('s', String(currentSeed));
      url.searchParams.set('m', mode);
      if (currentMainWord) url.searchParams.set('w', currentMainWord);
      else url.searchParams.delete('w');
      const next = url.pathname + url.search + url.hash;
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (next !== current) history.replaceState(null, '', next);
    } catch (_e) { /* file:// or a locked history: just play */ }
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

  function renderMenuState() {
    document.body.classList.toggle('home-screen', homeMenu);
    if (homeMenu) {
      els.menuKicker.textContent = 'Welcome to LetterMelt';
      els.menuTitle.textContent = 'Choose a game';
      els.menuSub.textContent = 'Choose a way to play.';
      renderDailyAction(els.dailyEasy, 'easy');
      renderDailyAction(els.dailyHard, 'hard');
      els.resumeGame.hidden = true;
      els.menuShare.hidden = true;
    } else {
      els.menuKicker.textContent = 'Game paused';
      els.menuTitle.textContent = 'Take a breather';
      els.menuSub.textContent = 'Your lava timer is safely on ice.';
      renderDailyAction(els.dailyEasy, 'easy');
      renderDailyAction(els.dailyHard, 'hard');
      els.dailyEasy.hidden = currentDailyMode === 'easy';
      els.dailyHard.hidden = currentDailyMode === 'hard';
      els.resumeGame.hidden = false;
      els.menuShare.hidden = false;
    }
  }

  function renderDailyAction(button, nextMode) {
    const title = button.querySelector('.menu-action-copy strong');
    const sub = button.querySelector('.menu-action-copy small');
    const arrow = button.querySelector('.menu-action-arrow');
    const result = history && history.getDaily(dailyDateKey(), nextMode);
    button.classList.remove('daily-result', 'daily-result-won', 'daily-result-lost');
    button.disabled = false;
    button.removeAttribute('aria-label');
    if (!result) {
      title.textContent = 'Play daily ' + nextMode;
      sub.textContent = nextMode === 'easy'
        ? 'Today’s shared five-minute puzzle'
        : 'Today’s shared three-minute puzzle';
      arrow.hidden = false;
      return;
    }
    const stars = '★'.repeat(result.stars) + '☆'.repeat(Engine.MAX_STARS - result.stars);
    const label = nextMode + ' daily result: ' + result.stars + ' stars, ' + Engine.formatTime(result.elapsedMs);
    title.textContent = 'Daily ' + nextMode + ' · ' + (result.status === 'won' ? 'complete' : 'out of time');
    sub.textContent = stars + ' · ' + Engine.formatTime(result.elapsedMs);
    arrow.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-label', label);
    button.classList.add('daily-result', 'daily-result-' + result.status);
  }

  function closeMenu(force) {
    if (!menuOpen || (homeMenu && !force)) return;
    closeTutorial(false);
    closeMainWordPicker(false);
    menuOpen = false;
    homeMenu = false;
    document.body.classList.remove('home-screen');
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

  function openMenu(isHome) {
    if (!isHome && (!game || game.status !== 'playing' || els.overlay.hidden === false || reviewing)) return;
    closeMainWordPicker(false);
    homeMenu = !!isHome;
    menuOpen = true;
    lastTick = performance.now();
    syncFxPause();
    if (inputController) inputController.cancel();
    activeTrace = [];
    renderer.clearTrace();
    setCurrent('');
    menuShareController.reset();
    closeTutorial(false);
    renderMenuState();
    els.menuOverlay.hidden = false;
    els.menuOverlay.setAttribute('aria-hidden', 'false');
    els.menuButton.setAttribute('aria-expanded', 'true');
  }

  function hashSeed(text) {
    let hash = 2166136261;
    const value = String(text);
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function dailyDateKey(date) {
    const d = date || new Date();
    // Daily puzzles turn over at midnight EDT (04:00 UTC), not at UTC
    // midnight. Shift into the fixed EDT calendar before reading the date.
    const edt = new Date(d.getTime() - 4 * 60 * 60 * 1000);
    return edt.getUTCFullYear() + '-' + String(edt.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(edt.getUTCDate()).padStart(2, '0');
  }

  function dailySeedFor(nextMode, dateKey) {
    return hashSeed('daily:' + (dateKey || dailyDateKey()) + ':' + nextMode);
  }

  function dailyMainWords(nextMode) {
    const pools = poolsFor(nextMode);
    const words = new Set();
    for (const word of (pools.base || [])) {
      if (word.length >= Generator.CONFIG.mainMin && isAllowedWord(word)) words.add(word);
    }
    for (const word of (pools.common || [])) {
      if (word.length >= Generator.CONFIG.mainMin && isAllowedWord(word)) words.add(word);
    }
    return Array.from(words).sort();
  }

  function selectMode(nextMode) {
    mode = nextMode;
    lexicon = lexiconFor(mode);
    dict = lexicon.words;
    renderMode();
  }

  function startDailyGame(nextMode) {
    selectMode(nextMode);
    const dateKey = dailyDateKey();
    const seed = dailySeedFor(nextMode, dateKey);
    const words = dailyMainWords(nextMode);
    if (!words.length) return;
    const first = Math.floor(Generator.createRng(seed)() * words.length);
    // A deterministic fallback sequence keeps the daily date usable even if
    // a particular main word cannot form a full board in this mode.
    const tries = Math.min(words.length, 32);
    for (let i = 0; i < tries; i++) {
      const word = words[(first + i) % words.length];
      if (newGame(seed, word, true, nextMode, dateKey)) return;
    }
    els.menuSub.textContent = 'Today’s puzzle could not be built. Try another game.';
  }

  function registeredMainWord(value) {
    const word = String(value || '').trim().toLowerCase();
    const max = Generator.CONFIG.mainMax || Generator.CONFIG.longMax;
    if (!/^[a-z]+$/.test(word) || word.length < Generator.CONFIG.mainMin ||
        word.length > max || !isAllowedWord(word) || !lexicon.has(word)) return null;
    return word;
  }

  function renderMainWordHint() {
    const raw = els.mainWordInput.value.trim();
    const word = registeredMainWord(raw);
    els.mainWordHint.classList.remove('is-bad', 'is-ready');
    if (!raw) {
      els.mainWordHint.textContent = '';
      els.mainWordHint.hidden = true;
      els.mainWordStart.disabled = true;
      return null;
    }
    els.mainWordHint.hidden = false;
    if (!word) {
      els.mainWordHint.textContent = 'Use a registered word with 7–' + (Generator.CONFIG.mainMax || Generator.CONFIG.longMax) + ' letters.';
      els.mainWordHint.classList.add('is-bad');
      els.mainWordStart.disabled = true;
      return null;
    }
    els.mainWordHint.textContent = 'Ready to build a board around ' + word + '.';
    els.mainWordHint.classList.add('is-ready');
    els.mainWordStart.disabled = false;
    return word;
  }

  function renderOtherMode() {
    const easy = otherGameMode === 'easy';
    els.otherModeEasy.classList.toggle('selected', easy);
    els.otherModeHard.classList.toggle('selected', !easy);
    els.otherModeEasy.setAttribute('aria-pressed', String(easy));
    els.otherModeHard.setAttribute('aria-pressed', String(!easy));
  }

  function chooseOtherMode(nextMode) {
    if (nextMode !== 'easy' && nextMode !== 'hard') return;
    otherGameMode = nextMode;
    renderOtherMode();
  }

  function openMainWordPicker() {
    if (!menuOpen) return;
    otherGameMode = game && game.status === 'playing' ? mode : 'easy';
    renderOtherMode();
    els.menuOptions.hidden = true;
    els.resumeGame.hidden = true;
    els.mainWordPicker.hidden = false;
    els.menuTitle.textContent = 'Choose your main word';
    els.menuSub.textContent = 'The board will grow around your choice.';
    els.mainWordInput.value = '';
    renderMainWordHint();
    els.mainWordInput.focus();
  }

  function closeMainWordPicker(returnFocus) {
    if (els.mainWordPicker.hidden) return;
    els.mainWordPicker.hidden = true;
    els.menuOptions.hidden = false;
    renderMenuState();
    if (returnFocus) els.newGame.focus();
  }

  function startMainWordGame() {
    const word = renderMainWordHint();
    if (!word) return;
    if (startOtherGame(word)) return;
    els.mainWordHint.textContent = 'That word could not anchor a full board in this mode. Try another.';
    els.mainWordHint.classList.remove('is-ready');
    els.mainWordHint.classList.add('is-bad');
  }

  function startRandomOtherGame() {
    startOtherGame(null);
  }

  function startOtherGame(mainWord) {
    const previousMode = mode;
    selectMode(otherGameMode);
    if (newGame(undefined, mainWord, true)) return true;
    selectMode(previousMode);
    return false;
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

  function newGame(seed, mainWord, quietFailure, dailyMode, dailyDate) {
    const pools = poolsFor(mode);
    const wanted = (seed === undefined || seed === null) ? undefined : (seed >>> 0);
    const requestedMain = mainWord == null ? null : String(mainWord).toLowerCase();
    if (wanted === undefined) clearGameQuery();
    const puzzle =
      Generator.generatePuzzle({
        words: pools.common,
        longWords: pools.base,
        lexicon: lexicon,
        seed: wanted,
        mode: mode,
        familiar: pools.familiar,
        mainWord: requestedMain
      }) ||
      Generator.generatePuzzle({
        words: Generator.FALLBACK_COMMON,
        longWords: Generator.FALLBACK_LONG,
        lexicon: lexicon,
        mode: mode,
        mainWord: requestedMain
      });
    if (!puzzle) {
      if (quietFailure) return false;
      els.sheetEmoji.textContent = '😵';
      els.sheetTitle.textContent = 'Could not build a puzzle';
      els.sheetTime.textContent = '';
      els.sheetSub.textContent = 'Try again.';
      els.overlay.hidden = false;
      stopClock();
      return;
    }
    currentSeed = puzzle.seed;
    currentMainWord = requestedMain;
    currentDailyMode = dailyMode || null;
    currentDailyDate = currentDailyMode ? (dailyDate || dailyDateKey()) : null;
    if (currentMainWord) rememberGameQuery();
    openingPuzzle = Generator.clonePuzzle(puzzle);
    game = Engine.createGame({ puzzle: puzzle, dict: dict, mode: mode });
    shownStars = Engine.MAX_STARS;
    rebuildAdjacency();
    renderer.setPuzzle(puzzle);
    buildTicks();
    renderHud();
    renderStars(true);
    setCurrent('');
    reviewing = false;
    els.reviewBack.hidden = true;
    els.menuButton.hidden = false;
    closeMenu(true);
    closeDebug();
    els.overlay.hidden = true;
    busy = false;
    pendingTrace = null;
    activeTrace = [];
    startClock();
    return true;
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
      if (homeMenu) closeTutorial(true);
      else closeMenu();
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
  els.dailyEasy.addEventListener('click', () => startDailyGame('easy'));
  els.dailyHard.addEventListener('click', () => startDailyGame('hard'));
  els.newGame.addEventListener('click', openMainWordPicker);
  els.otherModeEasy.addEventListener('click', () => chooseOtherMode('easy'));
  els.otherModeHard.addEventListener('click', () => chooseOtherMode('hard'));
  els.mainWordInput.addEventListener('input', renderMainWordHint);
  els.mainWordInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      startMainWordGame();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeMainWordPicker(true);
    }
  });
  els.mainWordStart.addEventListener('click', startMainWordGame);
  els.mainWordRandom.addEventListener('click', startRandomOtherGame);
  els.mainWordCancel.addEventListener('click', () => closeMainWordPicker(true));
  els.playAgain.addEventListener('click', () => newGame());
  els.resultDailyEasy.addEventListener('click', () => startDailyGame('easy'));
  els.resultDailyHard.addEventListener('click', () => startDailyGame('hard'));
  els.challengeAction.addEventListener('click', shareController.share);
  els.reviewBoard.addEventListener('click', openReview);
  els.reviewBack.addEventListener('click', closeReview);
  els.menuShare.addEventListener('click', menuShareController.share);

  function renderMode() {
    renderOtherMode();
  }

  document.addEventListener('keydown', ev => {
    if (ev.key.toLowerCase() === 'd' && game && game.status === 'playing' &&
        !menuOpen && !tutorialOpen) {
      ev.preventDefault();
      if (debugOpen) closeDebug();
      else openDebug();
    } else if (ev.key === 'Escape' && tutorialOpen) {
      closeTutorial(true);
    } else if (ev.key === 'Escape' && debugOpen) {
      closeDebug();
    } else if (ev.key === 'Escape' && menuOpen) {
      closeMenu();
    } else if (ev.key === 'Escape' && reviewing) {
      closeReview();
    }
  });

  // Kill double-tap zoom and rubber-band scrolling on iOS, while leaving
  // intentional overlay scrollers free to handle vertical swipes.
  document.addEventListener('gesturestart', ev => ev.preventDefault());
  document.addEventListener('dblclick', ev => ev.preventDefault());
  document.addEventListener('touchmove', ev => {
    const scrollSheet = '.menu-sheet, .tutorial-sheet, .debug-sheet, .sheet';
    if (ev.target.closest && ev.target.closest(scrollSheet)) return;
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
    let mainWord = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash.replace(/^#/, '');
      const fromHash = hash ? new URLSearchParams(hash) : null;
      const rawMode = params.get('m') || (fromHash && fromHash.get('m'));
      const rawSeed = params.get('s') || (fromHash && fromHash.get('s'));
      const rawMain = params.get('w') || (fromHash && fromHash.get('w'));
      if (rawMode && MODES[rawMode]) {
        mode = rawMode;
        lexicon = lexiconFor(mode);
        dict = lexicon.words;
      }
      if (rawSeed && /^\d+$/.test(rawSeed)) seed = Number(rawSeed) >>> 0;
      if (rawMain) mainWord = registeredMainWord(rawMain);
    } catch (_e) { /* malformed URL: just play a fresh board */ }
    renderMode();
    if (seed !== null) {
      newGame(seed, mainWord);
    } else {
      openMenu(true);
    }
  }

  buildTutorialBoard();
  startFromLocation();

  // Test/debug hook.
  window.LETTER_MELT = {
    newGame: newGame,
    getGame: () => game,
    getSeed: () => currentSeed,
    getMainWord: () => currentMainWord,
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
