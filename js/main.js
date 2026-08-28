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
  // Only dismiss when press and release both land on the backdrop. A drag that
  // starts inside the sheet and ends on the dimmed area would otherwise fire
  // click on the overlay and close the modal.
  function dismissOnBackdrop(el, close) {
    if (!el) return;
    let downOnBackdrop = false;
    el.addEventListener('pointerdown', ev => { downOnBackdrop = ev.target === el; });
    el.addEventListener('click', ev => {
      if (downOnBackdrop && ev.target === el) close();
      downOnBackdrop = false;
    });
  }
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
    tutorialCoach: $('tutorialCoach'),
    tutorialKicker: $('tutorialKicker'),
    tutorialProgress: $('tutorialProgress'),
    tutorialStepTitle: $('tutorialStepTitle'),
    tutorialGuide: $('tutorialGuide'),
    tutorialWord: $('tutorialWord'),
    tutorialSkip: $('tutorialSkip'),
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
    reviewBack: $('reviewBack'),
    multiplayerOverlay: $('multiplayerOverlay'),
    resultAccount: $('resultAccount')
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
  let tutorialReturnHome = false;
  let tutorialBackup = null;
  let tutorialDoneTimer = null;
  let debugOpen = false;
  let reviewing = false;
  let inputController = null;
  let multiplayer = null;
  let multiplayerActive = false;
  let multiplayerVersion = 0;
  let multiplayerStartedAt = 0;
  let multiplayerServerOffsetMs = 0;
  let multiplayerSavedMs = 0;
  let multiplayerPlayers = [];
  let multiplayerFinds = [];
  let multiplayerFinalizing = false;
  let multiplayerAnimating = false;
  let multiplayerEventQueue = [];
  let multiplayerPendingFinish = null;
  let multiplayerPaused = false;
  let multiplayerPausedAt = 0;
  let multiplayerPausedMs = 0;
  let multiplayerPauseIntent = null;
  let multiplayerPauseRequestId = 0;

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
      const gaining = stars > shownStars ? stars : 0;
      els.stars.innerHTML = '';
      for (let i = 1; i <= Engine.MAX_STARS; i++) {
        const star = document.createElement('i');
        star.textContent = '★';
        if (i > stars) star.classList.add('spent');
        if (i === losing && !renderer.prefersReducedMotion()) star.classList.add('losing');
        if (i > shownStars && i <= gaining && !renderer.prefersReducedMotion()) {
          star.classList.add('gaining');
          window.setTimeout(() => star.classList.remove('gaining'), 720);
        }
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
    if (multiplayerActive) return multiplayerPaused;
    return menuOpen || debugOpen || tutorialOpen || document.hidden;
  }

  function syncFxPause() {
    const idle = document.hidden || (!multiplayerActive && menuOpen) ||
      (multiplayerActive && multiplayerPaused) || debugOpen ||
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
    if (multiplayerActive) {
      syncMultiplayerClock();
      renderHud();
      if (multiplayerPaused) return;
      if (game.elapsedMs >= game.schedule.failMs && !multiplayerFinalizing) {
        multiplayerFinalizing = true;
        multiplayer.heartbeat().then(result => {
          if (result?.status !== 'lost' && result?.status !== 'won') multiplayerFinalizing = false;
        }).catch(() => { multiplayerFinalizing = false; });
      }
      return;
    }
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

  function removeMultiplayerSummary() {
    const existing = document.getElementById('multiplayerResultSummary');
    if (existing) existing.remove();
  }

  function renderMultiplayerWordLog(missed) {
    els.sheetWordsLabel.textContent = 'Team finds · game time';
    els.sheetWords.classList.add('with-times');
    els.sheetWords.innerHTML = '';
    for (const entry of multiplayerFinds) {
      const li = document.createElement('li');
      li.className = entry.kind === 'bonus' ? 'extra' : 'found-time';
      const label = document.createElement('span');
      label.textContent = entry.word + (entry.kind === 'bonus' ? ' · bonus' : '');
      const finder = document.createElement('small');
      finder.className = 'finder-tag';
      finder.textContent = entry.displayName || entry.display_name || 'Player';
      label.appendChild(finder);
      const time = document.createElement('time');
      time.textContent = Engine.formatTime(entry.elapsedMs ?? entry.elapsed_ms);
      li.append(label, time);
      els.sheetWords.appendChild(li);
    }
    for (const word of missed || []) appendWordLogRow(word.text, null, 'missed');
  }

  function renderMultiplayerSummary() {
    removeMultiplayerSummary();
    const summary = document.createElement('div');
    summary.id = 'multiplayerResultSummary';
    summary.className = 'multiplayer-result-summary';
    for (const player of multiplayerPlayers) {
      const finds = multiplayerFinds.filter(entry => (entry.userId || entry.user_id) === player.user_id);
      const required = finds.filter(entry => entry.kind === 'required').length;
      const bonus = finds.filter(entry => entry.kind === 'bonus').length;
      const card = document.createElement('div');
      card.className = 'multiplayer-result-player';
      const name = document.createElement('strong');
      name.textContent = player.display_name || 'Player';
      const accountScore = document.createElement('span');
      accountScore.className = 'account-score';
      const score = Number(player.accountScore ?? player.account_score);
      accountScore.textContent = Number.isFinite(score) ? score + ' account score' : 'Account score unavailable';
      const counts = document.createElement('small');
      counts.textContent = required + ' words · ' + bonus + ' bonus';
      card.append(name, accountScore, counts);
      summary.appendChild(card);
    }
    els.sheetWordsLabel.before(summary);
  }

  function finishMultiplayer(payload) {
    if (!multiplayerActive) return;
    if (Array.isArray(payload?.players)) multiplayerPlayers = payload.players;
    if (multiplayerAnimating || busy) {
      multiplayerPendingFinish = payload;
      return;
    }
    if (multiplayerFinalizing && !els.overlay.hidden) return;
    multiplayerFinalizing = true;
    game.status = payload.status === 'won' ? 'won' : 'lost';
    game.elapsedMs = Number(payload.elapsedMs ?? payload.finalElapsedMs ?? game.elapsedMs);
    saveGameResult();
    renderHud();
    const won = game.status === 'won';
    els.sheetEmoji.textContent = won ? '🎉' : '💀';
    els.sheetTitle.textContent = won ? 'Solved together!' : 'Out of time';
    els.sheetTime.textContent = Engine.formatTime(game.elapsedMs);
    els.sheetSub.textContent = won ? '' : Engine.remainingWords(game).length + ' words got away.';
    const stars = won ? Engine.starsFor(game.elapsedMs, game.schedule) : 0;
    els.sheetStars.innerHTML = '';
    for (let i = 1; i <= Engine.MAX_STARS; i++) {
      const star = document.createElement('i');
      star.textContent = '★';
      if (i > stars) star.classList.add('spent');
      els.sheetStars.appendChild(star);
    }
    renderMultiplayerSummary();
    renderMultiplayerWordLog(won ? [] : Engine.remainingWords(game));
    renderResultDailyActions();
    els.overlay.hidden = false;
    els.reviewBoard.hidden = true;
    els.challengeAction.textContent = 'Share result';
    els.playAgain.disabled = false;
    stopClock();
    multiplayer.watchForRematch();
    if (won) burst();
  }

  function saveGameResult() {
    if (!history || !game || tutorialOpen || (game.status !== 'won' && game.status !== 'lost')) return;
    const foundWords = [];
    for (const found of game.foundWordTimes || []) foundWords.push(found);
    for (const extra of game.extraWords || []) {
      foundWords.push({ word: extra.word, elapsedMs: extra.foundAtMs });
    }
    foundWords.sort((a, b) => a.elapsedMs - b.elapsedMs);
    const headline = History.puzzleHeadline(openingPuzzle || game.puzzle) || currentMainWord;
    const stars = Engine.starsFor(game.elapsedMs, game.schedule);
    const multiplayerResult = multiplayerActive;
    let points = null;
    if (multiplayerResult && History.multiplayerScore) {
      const myId = multiplayerUserId();
      const creditedFinds = multiplayerFinds.filter(entry => entry &&
        (entry.userId || entry.user_id) && entry.word);
      const mine = creditedFinds.filter(entry => (entry.userId || entry.user_id) === myId).length;
      points = History.multiplayerScore(mode, stars, mine, creditedFinds.length);
    }
    const record = {
      seed: currentSeed,
      mode: mode,
      mainWord: headline,
      dailyDate: currentDailyDate,
      status: game.status,
      elapsedMs: game.elapsedMs,
      stars: stars,
      foundWords: foundWords,
      playedAt: Date.now()
    };
    if (multiplayerResult) {
      record.source = 'multiplayer';
      record.points = points;
    }
    history.save(record);
    if (multiplayer) multiplayer.syncHistory();
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
    removeMultiplayerSummary();
    els.reviewBoard.hidden = false;
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
    removeMultiplayerSummary();
    els.reviewBoard.hidden = false;
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
   * A puzzle is a seed plus a difficulty. Requested main words are encoded in
   * the seed, so sharing the link does not reveal the headline word.
   */

  function puzzleLink() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('s', String(currentSeed));
    url.searchParams.set('m', mode);
    url.searchParams.delete('w');
    return url.toString();
  }

  /**
   * Share links live in ?s=&m= (or a hash fallback). A fresh board is no
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
      url.searchParams.delete('w');
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

  const TUTORIAL_SEEN_KEY = 'lettermelt.tutorial.seen';
  const TUTORIAL_ORDER = ['play', 'start', 'tutorial'];
  const TUTORIAL_COPY = {
    play: 'Drag through the glowing letters to spell PLAY, then let go.',
    start: 'Connect letters touching on any side or corner.',
    tutorial: 'The long word clears what’s left. Trace TUTORIAL to melt the board.',
    done: 'Empty the board before the lava runs out. Bonus words put time back on the clock.'
  };
  const TUTORIAL_TITLES = {
    play: 'Trace a word',
    start: 'Letters can touch corners',
    tutorial: 'Clear the board',
    done: 'You’re ready to play'
  };

  function tutorialStorage() {
    try { return window.localStorage || null; } catch (_e) { return null; }
  }

  function hasSeenTutorial() {
    const store = tutorialStorage();
    if (!store) return true;
    try { return store.getItem(TUTORIAL_SEEN_KEY) === '1'; } catch (_e) { return true; }
  }

  function markTutorialSeen() {
    const store = tutorialStorage();
    try { if (store) store.setItem(TUTORIAL_SEEN_KEY, '1'); } catch (_e) { /* private mode */ }
  }

  function locationHasMultiplayerInvite() {
    try {
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash.replace(/^#/, '');
      const fromHash = hash ? new URLSearchParams(hash) : null;
      const token = params.get('mp') || (fromHash && fromHash.get('mp'));
      return !!(token && String(token).trim());
    } catch (_e) { return false; }
  }

  function shouldAutoOpenTutorial() {
    if (hasSeenTutorial()) return false;
    if (locationHasMultiplayerInvite()) return false;
    if (history && history.all().length) {
      markTutorialSeen();
      return false;
    }
    return true;
  }

  function tutorialTarget() {
    if (!game) return null;
    for (const text of TUTORIAL_ORDER) {
      const word = game.puzzle.words.find(item => item.text === text && !item.found);
      if (word) return word;
    }
    return null;
  }

  function renderTutorialCoach() {
    const total = TUTORIAL_ORDER.length;
    const target = tutorialTarget();
    const solved = game ? Engine.solvedCount(game) : 0;
    const step = target ? Math.min(solved + 1, total) : total;
    els.tutorialKicker.textContent = target ? 'How to play' : 'Tutorial complete';
    els.tutorialCoach.dataset.step = String(step);
    if (els.tutorialProgress) {
      const progress = els.tutorialProgress.querySelectorAll('[data-tutorial-step]');
      for (let i = 0; i < progress.length; i++) {
        const item = progress[i];
        item.classList.toggle('is-active', !!target && i + 1 === step);
        item.classList.toggle('is-complete', !target || i + 1 < step);
      }
    }
    if (!target) {
      els.tutorialStepTitle.textContent = TUTORIAL_TITLES.done;
      els.tutorialWord.textContent = 'Ready to play';
      els.tutorialGuide.textContent = TUTORIAL_COPY.done;
      if (renderer.setHint) renderer.setHint([]);
      return;
    }
    els.tutorialStepTitle.textContent = TUTORIAL_TITLES[target.text] || TUTORIAL_TITLES.play;
    els.tutorialWord.textContent = target.text.toUpperCase();
    els.tutorialGuide.textContent = TUTORIAL_COPY[target.text] || TUTORIAL_COPY.play;
    const liveIds = new Set((game.puzzle.cells || []).map(cell => cell.id));
    const hintIds = target.cellIds.filter(id => liveIds.has(id));
    if (renderer.setHint) renderer.setHint(hintIds, hintIds[0]);
  }

  function clearTutorialTimer() {
    if (tutorialDoneTimer) {
      window.clearTimeout(tutorialDoneTimer);
      tutorialDoneTimer = null;
    }
  }

  function setTutorialChrome(on) {
    document.body.classList.toggle('tutorial-mode', on);
    els.tutorialCoach.hidden = !on;
    els.tutorialSkip.hidden = !on;
    els.menuButton.hidden = on;
  }

  /** Tear down tutorial chrome without touching the live board. */
  function dismissTutorial(opts) {
    if (!tutorialOpen) return false;
    const options = opts || {};
    clearTutorialTimer();
    if (options.markSeen !== false) markTutorialSeen();
    tutorialOpen = false;
    tutorialBackup = null;
    tutorialReturnHome = false;
    setTutorialChrome(false);
    if (renderer.setHint) renderer.setHint([]);
    return true;
  }

  function closeTutorial(returnToMenu) {
    if (!tutorialOpen) return;
    const backup = tutorialBackup;
    const goHome = tutorialReturnHome;
    dismissTutorial();
    if (multiplayerActive && game && game.status === 'playing') {
      rebuildAdjacency();
      renderHud();
      return;
    }
    if (backup && backup.game && !goHome) {
      game = backup.game;
      openingPuzzle = backup.openingPuzzle;
      currentSeed = backup.currentSeed;
      currentMainWord = backup.currentMainWord;
      currentDailyMode = backup.currentDailyMode;
      currentDailyDate = backup.currentDailyDate;
      shownStars = backup.shownStars;
      reviewing = backup.reviewing;
      busy = false;
      pendingTrace = null;
      activeTrace = [];
      rebuildAdjacency();
      renderer.setPuzzle(game.puzzle);
      buildTicks();
      renderHud();
      renderStars(true);
      setCurrent('');
      startClock();
      if (returnToMenu) openMenu(false);
      return;
    }
    game = null;
    openingPuzzle = null;
    stopClock();
    if (returnToMenu) openMenu(true);
  }

  function completeTutorial() {
    if (!tutorialOpen) return;
    renderTutorialCoach();
    setCurrent('ready', 'good');
    els.tutorialSkip.hidden = true;
    clearTutorialTimer();
    tutorialDoneTimer = window.setTimeout(() => closeTutorial(true), 1100);
  }

  function showTutorial() {
    if (multiplayerActive) return;
    const returnHome = homeMenu || !game || game.status !== 'playing';
    if (menuOpen) closeMenu(true, true);
    startTutorial(returnHome);
  }

  function startTutorial(returnHome) {
    if (multiplayerActive) return;
    clearTutorialTimer();
    if (inputController) inputController.cancel();
    tutorialReturnHome = !!returnHome;
    tutorialBackup = (!returnHome && game && game.status === 'playing') ? {
      game: game,
      openingPuzzle: openingPuzzle,
      currentSeed: currentSeed,
      currentMainWord: currentMainWord,
      currentDailyMode: currentDailyMode,
      currentDailyDate: currentDailyDate,
      shownStars: shownStars,
      reviewing: reviewing
    } : null;
    stopClock();
    const puzzle = Generator.makeTutorialPuzzle();
    currentSeed = null;
    currentMainWord = 'tutorial';
    currentDailyMode = null;
    currentDailyDate = null;
    openingPuzzle = Generator.clonePuzzle(puzzle);
    game = Engine.createGame({
      puzzle: puzzle,
      dict: new Set(TUTORIAL_ORDER),
      mode: 'easy'
    });
    shownStars = Engine.MAX_STARS;
    rebuildAdjacency();
    renderer.setPuzzle(puzzle);
    buildTicks();
    renderHud();
    setCurrent('');
    reviewing = false;
    busy = false;
    pendingTrace = null;
    activeTrace = [];
    els.overlay.hidden = true;
    els.reviewBack.hidden = true;
    tutorialOpen = true;
    setTutorialChrome(true);
    renderTutorialCoach();
    syncFxPause();
    els.tutorialSkip.focus();
  }

  function renderMenuState() {
    document.body.classList.toggle('home-screen', homeMenu);
    if (els.openTutorial) els.openTutorial.hidden = hasSeenTutorial();
    if (homeMenu) {
      els.menuKicker.hidden = true;
      els.menuTitle.textContent = 'Choose a game';
      els.menuSub.textContent = 'Choose a way to play.';
      renderDailyAction(els.dailyEasy, 'easy');
      renderDailyAction(els.dailyHard, 'hard');
      els.resumeGame.hidden = true;
      els.menuShare.hidden = true;
    } else {
      els.menuKicker.hidden = false;
      els.menuKicker.textContent = multiplayerActive ? 'Two-player game' : 'Game paused';
      els.menuTitle.textContent = multiplayerActive ? 'Game menu' : 'Take a breather';
      els.menuSub.textContent = multiplayerActive
        ? (multiplayerPaused ? 'Paused for both players.' : 'The shared clock is still melting.')
        : 'Your lava timer is safely on ice.';
      renderDailyAction(els.dailyEasy, 'easy');
      renderDailyAction(els.dailyHard, 'hard');
      els.dailyEasy.hidden = currentDailyMode === 'easy';
      els.dailyHard.hidden = currentDailyMode === 'hard';
      els.resumeGame.hidden = false;
      els.menuShare.hidden = multiplayerActive;
    }
  }

  function renderDailyAction(button, nextMode) {
    const title = button.querySelector('.menu-action-copy strong');
    const sub = button.querySelector('.menu-action-copy small');
    const streak = button.querySelector('.menu-action-streak');
    const streakLabel = button.querySelector('.menu-action-streak-label');
    const arrow = button.querySelector('.menu-action-arrow');
    const result = history && history.getDaily(dailyDateKey(), nextMode);
    const streakDays = history && history.getDailyStreak
      ? history.getDailyStreak(dailyDateKey(), nextMode)
      : 0;
    button.classList.remove('daily-result', 'daily-result-won', 'daily-result-lost');
    button.disabled = false;
    button.removeAttribute('aria-label');
    streak.hidden = streakDays < 1;
    streakLabel.textContent = String(streakDays);
    if (!result) {
      title.textContent = 'Play daily ' + nextMode;
      sub.textContent = nextMode === 'easy'
        ? 'Today’s shared five-minute puzzle'
        : 'Today’s shared three-minute puzzle';
      arrow.hidden = false;
      return;
    }
    const stars = '★'.repeat(result.stars) + '☆'.repeat(Engine.MAX_STARS - result.stars);
    const label = nextMode + ' daily result: ' + result.stars + ' stars, ' + Engine.formatTime(result.elapsedMs) +
      (streakDays ? ', ' + streakDays + '-day streak' : '');
    const modeLabel = nextMode.charAt(0).toUpperCase() + nextMode.slice(1);
    title.textContent = modeLabel + ' ' + (result.status === 'won' ? 'complete' : 'timed out');
    sub.textContent = stars + ' · ' + Engine.formatTime(result.elapsedMs);
    arrow.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-label', label);
    button.classList.add('daily-result', 'daily-result-' + result.status);
  }

  function applyMultiplayerPauseState(room) {
    const authoritativePaused = !!room.pausedAt;
    if (multiplayerPauseIntent &&
        ((multiplayerPauseIntent === 'pause') !== authoritativePaused)) return;
    multiplayerPauseIntent = null;
    multiplayerPaused = authoritativePaused;
    multiplayerPausedAt = authoritativePaused ? new Date(room.pausedAt).getTime() : 0;
    multiplayerPausedMs = Number(room.pausedMs) || 0;
    if (multiplayerActive && game?.status === 'playing') {
      if (authoritativePaused && !menuOpen) openMenu(false, true);
      else if (!authoritativePaused && menuOpen && !homeMenu) closeMenu(false, true);
    }
    syncFxPause();
    if (menuOpen && !homeMenu) renderMenuState();
  }

  function requestMultiplayerPause() {
    if (!multiplayerActive || !multiplayer) return;
    const requestId = ++multiplayerPauseRequestId;
    multiplayerPauseIntent = 'pause';
    multiplayerPaused = true;
    multiplayerPausedAt = Date.now() + multiplayerServerOffsetMs;
    syncFxPause();
    multiplayer.pause().then(snapshot => {
      if (requestId !== multiplayerPauseRequestId || multiplayerPauseIntent !== 'pause') return;
      multiplayerPauseIntent = null;
      applyMultiplayerSnapshot(snapshot);
    }).catch(() => {
      if (requestId !== multiplayerPauseRequestId || multiplayerPauseIntent !== 'pause') return;
      multiplayerPauseIntent = null;
      setHint('pause syncing…');
      multiplayer.refresh().catch(() => {});
    });
  }

  function requestMultiplayerResume() {
    if (!multiplayerActive || !multiplayer) return;
    const requestId = ++multiplayerPauseRequestId;
    multiplayerPauseIntent = 'resume';
    multiplayerPaused = false;
    multiplayerPausedAt = 0;
    syncFxPause();
    multiplayer.resume().then(snapshot => {
      if (requestId !== multiplayerPauseRequestId || multiplayerPauseIntent !== 'resume') return;
      multiplayerPauseIntent = null;
      applyMultiplayerSnapshot(snapshot);
    }).catch(() => {
      if (requestId !== multiplayerPauseRequestId || multiplayerPauseIntent !== 'resume') return;
      multiplayerPauseIntent = null;
      setHint('resume syncing…');
      multiplayer.refresh().catch(() => {});
    });
  }

  function closeMenu(force, remote) {
    if (!menuOpen || (homeMenu && !force)) return;
    const resumeSharedGame = !remote && multiplayerActive && !homeMenu &&
      (multiplayerPaused || multiplayerPauseIntent === 'pause');
    closeMainWordPicker(false);
    menuOpen = false;
    homeMenu = false;
    document.body.classList.remove('home-screen');
    els.menuOverlay.hidden = true;
    els.menuOverlay.setAttribute('aria-hidden', 'true');
    els.menuButton.setAttribute('aria-expanded', 'false');
    if (resumeSharedGame) {
      multiplayerPauseIntent = 'resume';
      multiplayerPaused = false;
      multiplayerPausedAt = 0;
      syncFxPause();
      requestMultiplayerResume();
    }
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

  function openMenu(isHome, remote) {
    if (!isHome && (!game || game.status !== 'playing' || els.overlay.hidden === false || reviewing)) return;
    const pauseSharedGame = !remote && !isHome && multiplayerActive && multiplayer;
    closeMainWordPicker(false);
    homeMenu = !!isHome;
    menuOpen = true;
    if (pauseSharedGame) {
      multiplayerPauseIntent = 'pause';
      multiplayerPaused = true;
      multiplayerPausedAt = Date.now() + multiplayerServerOffsetMs;
    }
    lastTick = performance.now();
    syncFxPause();
    if (inputController) inputController.cancel();
    if (multiplayerActive && multiplayer) multiplayer.sendTrace([]);
    activeTrace = [];
    renderer.clearTrace();
    setCurrent('');
    menuShareController.reset();
    renderMenuState();
    els.menuOverlay.hidden = false;
    els.menuOverlay.setAttribute('aria-hidden', 'false');
    els.menuButton.setAttribute('aria-expanded', 'true');
    if (pauseSharedGame) requestMultiplayerPause();
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
    const hasLetters = /[a-z]/i.test(raw);
    els.mainWordStart.hidden = !hasLetters;
    els.mainWordRandom.hidden = hasLetters;
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
    els.menuKicker.hidden = true;
    els.menuTitle.textContent = 'Start another game';
    els.menuSub.textContent = 'Start random, or enter your own long word to build a game around';
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
    if (busy || (multiplayerActive && multiplayerAnimating)) {
      pendingTrace = ids.slice();
      return;
    }
    const word = Generator.traceToWord(game.puzzle.cells, ids);
    if (multiplayerActive) syncMultiplayerClock();
    const result = Engine.submitWord(game, word);
    if (multiplayerActive && !tutorialOpen && (result.type === 'required' || result.type === 'extra')) {
      publishMultiplayerFind(result, ids);
    }

    if (result.type === 'required') {
      busy = true;
      if (result.solved && multiplayerActive) multiplayerFinalizing = true;
      // Removing a word only shrinks the union, so the remaining graph is
      // already safe to trace while the renderer animates the old layout.
      rebuildAdjacency();
      setCurrent(word, 'good');
      // The base word no longer sits on a pill waiting to be found; solving it
      // just says so, and the message fades like every other.
      if (result.isLong && !tutorialOpen) {
        setHint('longest word! +' + result.bonusSeconds + 's');
        toast('longest word +' + result.bonusSeconds + 's', 'extra');
        flashTimer('extra');
      }
      renderHud(true);
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
          if (result.solved) {
            if (tutorialOpen) completeTutorial();
            else if (multiplayerActive) finishMultiplayer({ status: 'won', elapsedMs: game.elapsedMs });
            else finish();
          } else if (nextTrace) handleSubmit(nextTrace);
          else {
            if (tutorialOpen) renderTutorialCoach();
            processMultiplayerEvents();
          }
        }
      });
      return;
    }

    if (result.type === 'extra') {
      // Blue: a rare word, worth time back rather than a place on the board.
      renderer.drainTrace('extra', 520);
      renderer.sparkAt(ids[ids.length - 1]);
      toast('bonus word +' + result.seconds + 's', 'extra');
      flashTimer('extra');
      flashCurrent(word, 'extra', 800);
      renderHud();
      if (multiplayerActive) processMultiplayerEvents();
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
    if (tutorialOpen) {
      const target = tutorialTarget();
      if (target) setHint('trace ' + target.text.toUpperCase());
    }
  }

  /* ------------------------------ new game ----------------------------- */

  function newGame(seed, mainWord, quietFailure, dailyMode, dailyDate) {
    dismissTutorial({ markSeen: false });
    if (multiplayerActive && multiplayer) multiplayer.close();
    multiplayerActive = false;
    multiplayerFinalizing = false;
    multiplayerAnimating = false;
    multiplayerEventQueue = [];
    multiplayerPendingFinish = null;
    multiplayerPaused = false;
    multiplayerPausedAt = 0;
    multiplayerPausedMs = 0;
    multiplayerPauseIntent = null;
    multiplayerPauseRequestId += 1;
    renderer.clearRemoteTrace();
    const pools = poolsFor(mode);
    const wanted = (seed === undefined || seed === null) ? undefined : (seed >>> 0);
    const requestedMain = mainWord == null ? null : String(mainWord).toLowerCase();
    if (wanted === undefined) clearGameQuery();
    // New custom and daily boards encode the requested word in their seed.
    // Leave legacy shared links with ?w= untouched so they still rebuild the
    // exact board that was originally sent.
    let puzzleSeed = wanted;
    if (requestedMain && (wanted === undefined || dailyMode)) {
      puzzleSeed = Generator.seedForMainWord(wanted, requestedMain, {
        words: pools.common,
        longWords: pools.base,
        lexicon: lexicon
      });
      if (puzzleSeed === null) puzzleSeed = wanted;
    }
    const puzzle =
      Generator.generatePuzzle({
        words: pools.common,
        longWords: pools.base,
        lexicon: lexicon,
        seed: puzzleSeed,
        mode: mode,
        familiar: pools.familiar,
        mainWord: requestedMain
      }) ||
      Generator.generatePuzzle({
        words: Generator.FALLBACK_COMMON,
        longWords: Generator.FALLBACK_LONG,
        lexicon: lexicon,
        seed: puzzleSeed,
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

  function multiplayerState(snapshot) {
    return snapshot && snapshot.room && snapshot.room.state ? snapshot.room.state : null;
  }

  function startMultiplayer(snapshot) {
    dismissTutorial({ markSeen: false });
    const room = snapshot.room;
    const state = multiplayerState(snapshot);
    if (!room || !state || !state.puzzle) return;
    selectMode(room.mode);
    currentSeed = Number(room.seed) >>> 0;
    currentMainWord = null;
    currentDailyMode = null;
    currentDailyDate = null;
    openingPuzzle = Generator.clonePuzzle(room.openingPuzzle || state.puzzle);
    game = Engine.createGame({ puzzle: state.puzzle, dict: dict, mode: mode });
    game.foundWords = state.foundWords || [];
    game.foundWordTimes = state.foundWordTimes || [];
    game.extraWords = state.extraWords || [];
    game.savedMs = Number(room.savedMs) || 0;
    game.status = 'playing';
    multiplayerActive = true;
    multiplayerVersion = Number(room.stateVersion) || 0;
    multiplayerStartedAt = new Date(room.startedAt).getTime();
    multiplayerServerOffsetMs = Number(snapshot.serverNow) ? Number(snapshot.serverNow) - Date.now() : 0;
    multiplayerSavedMs = Number(room.savedMs) || 0;
    multiplayerPlayers = snapshot.players || [];
    multiplayerFinds = snapshot.finds || [];
    multiplayerFinalizing = false;
    multiplayerPaused = false;
    multiplayerPausedAt = 0;
    multiplayerPausedMs = 0;
    multiplayerPauseIntent = null;
    shownStars = Engine.MAX_STARS;
    rebuildAdjacency();
    renderer.setPuzzle(game.puzzle);
    buildTicks();
    renderHud();
    renderStars(true);
    setCurrent('');
    reviewing = false;
    busy = false;
    pendingTrace = null;
    activeTrace = [];
    closeMenu(true);
    closeDebug();
    els.overlay.hidden = true;
    els.reviewBack.hidden = true;
    els.menuButton.hidden = false;
    startClock();
  }

  function syncMultiplayerClock() {
    if (!multiplayerActive || !game) return;
    const serverNow = Date.now() + multiplayerServerOffsetMs;
    const activeNow = multiplayerPausedAt ? Math.min(serverNow, multiplayerPausedAt) : serverNow;
    game.elapsedMs = Math.max(0, Math.min(
      game.schedule.failMs,
      activeNow - multiplayerStartedAt - multiplayerSavedMs - multiplayerPausedMs
    ));
  }

  function myDisplayName() {
    const id = multiplayerUserId();
    const player = multiplayerPlayers.find(entry => entry.user_id === id);
    return player?.display_name || 'Player';
  }

  function eventWord(event) {
    return String(event?.word || '').toLowerCase();
  }

  function eventElapsed(event) {
    const value = event?.foundAtMs ?? event?.elapsedMs ?? event?.elapsed_ms;
    return Number(value);
  }

  function normalizeFindEvent(event) {
    if (!event) return null;
    const word = eventWord(event);
    if (!word) return null;
    const kind = event.kind === 'bonus' || event.type === 'extra' || event.type === 'repeat-extra'
      ? 'bonus' : (event.kind || 'required');
    const finderId = event.finderId || event.userId || event.user_id || '';
    return {
      word,
      kind,
      finderId,
      displayName: event.displayName || event.display_name || 'Player',
      sequence: event.sequence,
      elapsedMs: eventElapsed(event),
      creditedMs: Number(event.timeSaved ?? event.creditedMs ?? event.credited_ms) || 0,
      traceIds: event.traceIds || event.trace_ids || [],
      stateVersion: event.stateVersion,
      status: event.status,
      savedMs: event.savedMs,
      stolen: !!event.stolen,
      claimed: !!event.claimed
    };
  }

  function rememberFind(entry) {
    if (!entry?.word) return null;
    const index = multiplayerFinds.findIndex(found => found.word === entry.word);
    if (index < 0) {
      multiplayerFinds.push(entry);
      return entry;
    }
    const current = multiplayerFinds[index];
    const currentMs = Number(current.elapsedMs);
    const nextMs = Number(entry.elapsedMs);
    if (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs < currentMs)) {
      multiplayerFinds[index] = Object.assign({}, current, entry, { pending: false });
      return multiplayerFinds[index];
    }
    current.pending = false;
    if (entry.sequence != null) current.sequence = current.sequence || entry.sequence;
    if (entry.finderId && !current.userId) current.userId = entry.finderId;
    return null;
  }

  function publishMultiplayerFind(result, ids) {
    multiplayerSavedMs = game.savedMs;
    rememberFind({
      word: result.word,
      kind: result.type === 'required' ? 'required' : 'bonus',
      userId: multiplayerUserId(),
      displayName: myDisplayName(),
      elapsedMs: result.foundAtMs,
      creditedMs: Number(result.timeSaved) || 0,
      traceIds: ids.slice(),
      pending: true
    });
    multiplayer.submit({
      traceIds: ids,
      word: result.word,
      elapsedMs: result.foundAtMs,
      timeSaved: result.timeSaved,
      kind: result.type === 'required' ? 'required' : 'bonus'
    }).catch(error => {
      if (error?.status === 409 && /paused/i.test(error.message || '')) setHint('paused for both players');
      else setHint(error?.status ? 'server busy · retry' : 'connection lost · retry');
    });
  }

  function applyMultiplayerSnapshot(snapshot) {
    if (!snapshot || !snapshot.room) return;
    if (!multiplayerActive) return;
    const room = snapshot.room;
    multiplayerPlayers = snapshot.players || multiplayerPlayers;
    if (Number(snapshot.serverNow)) multiplayerServerOffsetMs = Number(snapshot.serverNow) - Date.now();
    multiplayerStartedAt = room.startedAt ? new Date(room.startedAt).getTime() : multiplayerStartedAt;
    applyMultiplayerPauseState(room);
    if (Number(room.stateVersion)) multiplayerVersion = Math.max(multiplayerVersion, Number(room.stateVersion));
    const remoteFinds = snapshot.finds || [];
    for (const found of remoteFinds) {
      rememberFind({
        word: String(found.word || '').toLowerCase(),
        kind: found.kind,
        userId: found.user_id || found.userId,
        displayName: found.display_name || found.displayName,
        sequence: found.sequence,
        elapsedMs: found.elapsed_ms ?? found.elapsedMs,
        creditedMs: found.credited_ms ?? found.creditedMs,
        pending: false
      });
    }
    const missing = remoteFinds.filter(found => {
      const word = String(found.word || '').toLowerCase();
      return word && !game.foundWords.includes(word) &&
        !game.extraWords.some(extra => extra.word === word);
    });
    if (multiplayerAnimating || busy) {
      for (const found of missing) applyMultiplayerAccepted(found);
      if (room.status === 'won' || room.status === 'lost') {
        multiplayerPendingFinish = { status: room.status, elapsedMs: room.finalElapsedMs };
      }
      return;
    }
    for (const found of missing) applyMultiplayerAccepted(found);
    multiplayerSavedMs = game.savedMs;
    if (room.status === 'won' || room.status === 'lost') {
      finishMultiplayer({ status: room.status, elapsedMs: room.finalElapsedMs });
    }
    if (!els.overlay.hidden && game.status !== 'playing') renderMultiplayerSummary();
  }

  function multiplayerUserId() {
    const client = multiplayer && multiplayer.client;
    if (!client) return '';
    if (typeof client.userId === 'function') return client.userId() || '';
    const session = client.session();
    if (!session) return '';
    if (session.user && session.user.id) return session.user.id;
    try {
      const payload = String(session.access_token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).sub || '';
    } catch (_e) { return ''; }
  }

  function applyMultiplayerAccepted(event) {
    const normalized = normalizeFindEvent(event);
    if (!multiplayerActive || !normalized) return;
    if (Array.isArray(event?.players)) {
      multiplayerPlayers = event.players;
      if (!els.overlay.hidden && game.status !== 'playing') renderMultiplayerSummary();
    }
    const existing = multiplayerFinds.find(found => found.word === normalized.word);
    const stolen = rememberFind({
      word: normalized.word,
      kind: normalized.kind,
      userId: normalized.finderId,
      displayName: normalized.displayName,
      sequence: normalized.sequence,
      elapsedMs: normalized.elapsedMs,
      creditedMs: normalized.creditedMs,
      traceIds: normalized.traceIds,
      pending: false
    });
    if (Number(normalized.stateVersion)) {
      multiplayerVersion = Math.max(multiplayerVersion, Number(normalized.stateVersion));
    }
    const alreadyOnBoard = game.foundWords.includes(normalized.word) ||
      game.extraWords.some(extra => extra.word === normalized.word);
    if (alreadyOnBoard) {
      if (stolen && existing && normalized.finderId && normalized.finderId !== existing.userId) {
        const mine = multiplayerUserId();
        if (normalized.finderId !== mine) setHint((normalized.displayName || 'Friend') + ' found it first');
      }
      return;
    }
    if (event.type === 'repeat-required' || event.type === 'repeat-extra') return;
    if (multiplayerEventQueue.some(queued => eventWord(queued) === normalized.word)) return;
    multiplayerEventQueue.push(normalized);
    multiplayerEventQueue.sort((a, b) => (Number.isFinite(eventElapsed(a)) ? eventElapsed(a) : 0) -
      (Number.isFinite(eventElapsed(b)) ? eventElapsed(b) : 0));
    processMultiplayerEvents();
  }

  function processMultiplayerEvents() {
    if (multiplayerAnimating || busy || !multiplayerEventQueue.length || !multiplayerActive) return;
    const event = multiplayerEventQueue.shift();
    const word = eventWord(event);
    if (!word || game.foundWords.includes(word) || game.extraWords.some(extra => extra.word === word)) {
      processMultiplayerEvents();
      return;
    }
    const foundAt = Number.isFinite(eventElapsed(event)) ? eventElapsed(event) : game.elapsedMs;
    game.elapsedMs = foundAt;
    const localResult = Engine.submitWord(game, word);
    if (localResult.type !== 'required' && localResult.type !== 'extra') {
      processMultiplayerEvents();
      return;
    }
    if (Number(event.stateVersion)) multiplayerVersion = Math.max(multiplayerVersion, Number(event.stateVersion));
    multiplayerSavedMs = game.savedMs;
    syncMultiplayerClock();
    rememberFind({
      word, kind: localResult.type === 'required' ? 'required' : 'bonus',
      userId: event.finderId, displayName: event.displayName,
      sequence: event.sequence, elapsedMs: foundAt,
      creditedMs: Number(localResult.timeSaved) || 0, pending: false
    });
    if (localResult.type === 'required') game.status = localResult.solved ? 'won' : 'playing';
    rebuildAdjacency();
    renderer.clearRemoteTrace();
    const myId = multiplayerUserId();
    const isRemoteFind = !!(event.finderId && myId && event.finderId !== myId);
    setCurrent(word, localResult.type === 'extra' ? 'extra' : 'good');
    if (isRemoteFind) setHint((event.displayName || 'Friend') + ' found it');
    else if (localResult.isLong) setHint('longest word! +' + localResult.bonusSeconds + 's');
    renderHud(true);
    if (localResult.type === 'extra') {
      renderer.drainTrace('extra', 420);
      const lastId = event.traceIds?.[event.traceIds.length - 1];
      if (lastId != null) renderer.sparkAt(lastId);
      toast('bonus word +' + Math.round((Number(localResult.timeSaved) || 0) / 1000) + 's', 'extra');
      flashTimer('extra');
      window.setTimeout(() => {
        if (activeTrace.length) {
          setCurrent(Generator.traceToWord(game.puzzle.cells, activeTrace));
        } else {
          setCurrent('');
        }
        if (event.status === 'won' || localResult.solved) {
          finishMultiplayer({ status: 'won', elapsedMs: game.elapsedMs });
        }
        const nextTrace = pendingTrace;
        pendingTrace = null;
        if (nextTrace) handleSubmit(nextTrace);
        else processMultiplayerEvents();
      }, 420);
      return;
    }
    multiplayerAnimating = true;
    if (!isRemoteFind) renderer.drainTrace('good', 380, true);
    renderer.playFound({
      removedIds: localResult.removedIds,
      removedEdgeKeys: localResult.removedEdgeKeys,
      keptIds: keptLetters(localResult, event.traceIds || []),
      traceIds: event.traceIds || [],
      onDone: function () {
        multiplayerAnimating = false;
        renderer.setTone(null);
        if (activeTrace.length) {
          setCurrent(Generator.traceToWord(game.puzzle.cells, activeTrace));
        } else {
          setCurrent('');
        }
        if (event.status === 'won' || localResult.solved) {
          multiplayerPendingFinish = { status: 'won', elapsedMs: game.elapsedMs };
        }
        const finishPayload = multiplayerPendingFinish;
        multiplayerPendingFinish = null;
        const nextTrace = pendingTrace;
        pendingTrace = null;
        if (finishPayload) finishMultiplayer(finishPayload);
        else if (nextTrace) handleSubmit(nextTrace);
        else processMultiplayerEvents();
      }
    });
  }

  function applyMultiplayerFinished(event) {
    if (!multiplayerActive || !event) return;
    if (event.stateVersion) multiplayerVersion = Math.max(multiplayerVersion, Number(event.stateVersion));
    finishMultiplayer(event);
  }

  function prepareMultiplayerRematch() {
    multiplayerFinalizing = false;
    multiplayerAnimating = false;
    multiplayerEventQueue = [];
    multiplayerPendingFinish = null;
    multiplayerFinds = [];
    multiplayerPaused = false;
    multiplayerPausedAt = 0;
    multiplayerPausedMs = 0;
    multiplayerPauseIntent = null;
    multiplayerPauseRequestId += 1;
    renderer.clearRemoteTrace();
    els.reviewBack.hidden = true;
    els.playAgain.disabled = false;
    reviewing = false;
    stopClock();
  }

  function playAnother() {
    if (multiplayerActive && multiplayer) {
      els.playAgain.disabled = true;
      multiplayer.rematch().catch(error => {
        els.playAgain.disabled = false;
        els.sheetSub.textContent = error?.message || 'Could not start another game';
      });
      return;
    }
    newGame();
  }

  /* ------------------------------- input ------------------------------- */

  if (window.LetterMeltMultiplayer) {
    multiplayer = window.LetterMeltMultiplayer.create({
      window: window,
      document: document,
      onStart: startMultiplayer,
      onSnapshot: applyMultiplayerSnapshot,
      onAccepted: applyMultiplayerAccepted,
      onFinished: applyMultiplayerFinished,
      onRematch: prepareMultiplayerRematch,
      onRemoteTrace: (ids, name) => {
        if (!multiplayerActive) return;
        if (ids.length) renderer.setRemoteTrace(ids, name);
        else renderer.clearRemoteTrace();
      }
    });
  }

  inputController = window.LetterMeltInput.attach(els.board, renderer, {
    getAdjacency: () => adjacency,
    isActive: () => !!game && game.status === 'playing' && !menuOpen && !debugOpen,
    onTraceChange: ids => {
      const starting = !activeTrace.length && ids.length > 0;
      activeTrace = ids.slice();
      if (multiplayerActive && multiplayer && !tutorialOpen) multiplayer.sendTrace(ids);
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
    onCancel: () => {
      if (multiplayerActive && multiplayer) multiplayer.sendTrace([]);
      setCurrent('');
    }
  });

  els.menuButton.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
  dismissOnBackdrop(els.menuOverlay, closeMenu);
  els.resumeGame.addEventListener('click', closeMenu);
  els.openTutorial.addEventListener('click', showTutorial);
  els.tutorialSkip.addEventListener('click', () => closeTutorial(true));
  els.debugClose.addEventListener('click', closeDebug);
  els.debugDone.addEventListener('click', closeDebug);
  dismissOnBackdrop(els.debugOverlay, closeDebug);
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
  els.playAgain.addEventListener('click', playAnother);
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
    const scrollSheet = '.menu-sheet, .debug-sheet, .multiplayer-sheet, .account-sheet, .sheet';
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
    } else if (locationHasMultiplayerInvite()) {
      openMenu(true);
    } else if (shouldAutoOpenTutorial()) {
      startTutorial(true);
    } else {
      openMenu(true);
    }
  }

  startFromLocation();

  // Test/debug hook.
  window.LETTER_MELT = {
    startTutorial: function () { startTutorial(true); },
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
