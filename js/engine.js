/* LetterMelt — game engine (pure logic, works in browser and Node).
 *
 * The game is a race against a DRAINING CLOCK. Elapsed time counts up; the
 * vial shows what is left of the mode's deadline. Crossing a tier boundary
 * costs a star, and reaching the deadline ends the run as a loss. The only
 * win is emptying the board — solving every hidden word — and the score is
 * the stars left when that happens. Extra words (valid dictionary words that
 * are not puzzle words) SUBTRACT ten seconds from elapsed time, clamped at
 * zero, so they can buy a spent star back.
 *
 * All board mutation is delegated to LetterMeltGenerator.
 */
(function (root, factory) {
  const gen = (typeof module !== 'undefined' && module.exports)
    ? require('./generator.js')
    : root.LetterMeltGenerator;
  const api = factory(gen);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LetterMeltEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Generator) {
  'use strict';

  /* ---- tunables (single block, on purpose) ---- */
  const DEFAULTS = {
    minWordLength: 4,        // 3-letter traces are never valid
    solvedCreditMs: 0,       // time credited for solving a required word
    extraSeconds: 10         // seconds shaved off the stopwatch per extra word
  };

  /*
   * Stars and the deadline. The clock drains from `failMs` to nothing;
   * crossing a tier boundary costs a star, and reaching zero ends the run.
   * Hard is a three-minute race; easy gets five minutes and a slower ladder.
   * Difficulty still mainly changes which words count as required.
   */
  const HARD_SCHEDULE = {
    failMs: 3 * 60 * 1000,
    tiers: [
      { stars: 5, withinMs: 1.5 * 60 * 1000 },
      { stars: 4, withinMs: 2 * 60 * 1000 },
      { stars: 3, withinMs: 2.5 * 60 * 1000 },
      { stars: 2, withinMs: 2 * 60 * 1000 + 50 * 1000 },
      { stars: 1, withinMs: 3 * 60 * 1000 }
    ]
  };
  const EASY_SCHEDULE = {
    failMs: 5 * 60 * 1000,
    tiers: [
      { stars: 5, withinMs: 2.5 * 60 * 1000 },
      { stars: 4, withinMs: 3 * 60 * 1000 },
      { stars: 3, withinMs: 4 * 60 * 1000 },
      { stars: 2, withinMs: 4.5 * 60 * 1000 },
      { stars: 1, withinMs: 5 * 60 * 1000 }
    ]
  };
  const STAR_SCHEDULES = {
    hard: HARD_SCHEDULE,
    easy: EASY_SCHEDULE
  };
  const MAX_STARS = 5;

  function scheduleFor(mode) {
    return STAR_SCHEDULES[mode] || STAR_SCHEDULES.hard;
  }

  /** Stars a run finishing at `elapsedMs` earns; 0 means the clock ran out. */
  function starsFor(elapsedMs, schedule) {
    const s = schedule && schedule.tiers ? schedule : scheduleFor(schedule);
    for (const tier of s.tiers) {
      if (elapsedMs < tier.withinMs) return tier.stars;
    }
    return 0;
  }

  /**
   * Milliseconds until the next star is lost. The final boundary is the
   * deadline itself, so this drives both the countdown and the vial.
   */
  function msToNextStarLoss(elapsedMs, schedule) {
    const s = schedule && schedule.tiers ? schedule : scheduleFor(schedule);
    for (const tier of s.tiers) {
      if (elapsedMs < tier.withinMs) return tier.withinMs - elapsedMs;
    }
    return null;
  }

  /** Every extra word shaves a fixed ten seconds off the clock. */
  function extraSeconds() {
    return DEFAULTS.extraSeconds;
  }

  /** Build the lookup Set used for extra-word validation. */
  function buildDict(raw, extraWords) {
    const set = new Set();
    if (typeof raw === 'string' && raw.length) {
      for (const w of raw.split(/\s+/)) {
        if (w) set.add(w.toLowerCase());
      }
    } else if (Array.isArray(raw)) {
      for (const w of raw) if (w) set.add(String(w).toLowerCase());
    }
    if (Array.isArray(extraWords)) {
      for (const w of extraWords) if (w) set.add(String(w).toLowerCase());
    }
    return set;
  }

  function createGame(options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const puzzle = opts.puzzle;
    if (!puzzle) throw new Error('createGame requires a puzzle');
    return {
      puzzle: puzzle,
      dict: opts.dict || new Set(),
      config: opts,
      schedule: opts.schedule && opts.schedule.tiers ? opts.schedule : scheduleFor(opts.mode),
      elapsedMs: 0,
      status: 'playing',            // 'playing' | 'won' | 'lost'
      foundWords: [],               // puzzle words, in the order found
      foundWordTimes: [],            // { word, elapsedMs }, in the order found
      extraWords: [],               // { word, seconds, foundAtMs }
      savedMs: 0,                   // total time shaved off by bonuses
      finishedAt: null
    };
  }

  function remainingWords(state) {
    return state.puzzle.words.filter(w => !w.found);
  }

  function totalWords(state) {
    return state.puzzle.words.length;
  }

  function solvedCount(state) {
    return state.puzzle.words.filter(w => w.found).length;
  }

  /** Shave ms off the stopwatch, never below zero. Returns ms actually saved. */
  function creditTime(state, ms) {
    const before = state.elapsedMs;
    state.elapsedMs = Math.max(0, state.elapsedMs - ms);
    return before - state.elapsedMs;
  }

  /** Advance the clock. Returns true when this tick ran it out. */
  function tick(state, dtMs) {
    if (state.status !== 'playing') return false;
    if (!(dtMs > 0)) return false;
    state.elapsedMs += dtMs;
    if (state.elapsedMs >= state.schedule.failMs) {
      state.elapsedMs = state.schedule.failMs;
      state.status = 'lost';
      state.finishedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Judge a traced string.
   * Returns { type, word, ... } where type is one of:
   *   'required' | 'extra' | 'short' | 'repeat-required' | 'repeat-extra' |
   *   'plural' | 'unknown' | 'inactive'
   */
  function submitWord(state, rawWord) {
    const word = String(rawWord || '').toLowerCase();
    if (state.status !== 'playing') return { type: 'inactive', word: word };
    if (word.length < state.config.minWordLength) return { type: 'short', word: word };

    const index = Generator.findWordIndex(state.puzzle, word);
    if (index >= 0) {
      const isLong = !!state.puzzle.words[index].isLong;
      const foundAtMs = state.elapsedMs;
      const result = Generator.removeWord(state.puzzle, index);
      state.foundWords.push(word);
      state.foundWordTimes.push({ word: word, elapsedMs: foundAtMs });
      const solvedCredit = state.config.solvedCreditMs
        ? creditTime(state, state.config.solvedCreditMs)
        : 0;
      const bonusSeconds = isLong ? extraSeconds() : 0;
      const longestCredit = bonusSeconds ? creditTime(state, bonusSeconds * 1000) : 0;
      const credited = solvedCredit + longestCredit;
      state.savedMs += credited;
      const done = remainingWords(state).length === 0;
      if (done) {
        state.status = 'won';
        state.finishedAt = Date.now();
      }
      return {
        type: 'required',
        word: word,
        wordIndex: index,
        isLong: isLong,
        removedIds: result ? result.removedIds : [],
        removedEdgeKeys: result ? result.removedEdgeKeys : [],
        moved: result ? result.moved : [],
        foundAtMs: foundAtMs,
        bonusSeconds: bonusSeconds,
        timeSaved: credited,
        solved: done
      };
    }

    if (state.puzzle.words.some(w => w.found && w.text === word)) {
      return { type: 'repeat-required', word: word };
    }
    if (state.extraWords.some(b => b.word === word)) {
      return { type: 'repeat-extra', word: word };
    }
    if (state.dict.has(word)) {
      const secs = extraSeconds(word.length, state.config.extraSeconds);
      const foundAtMs = state.elapsedMs;
      const credited = creditTime(state, secs * 1000);
      state.extraWords.push({ word: word, seconds: secs, foundAtMs: foundAtMs });
      state.savedMs += credited;
      return { type: 'extra', word: word, seconds: secs, foundAtMs: foundAtMs, timeSaved: credited };
    }
    if (looksLikePlural(word, state.dict)) return { type: 'plural', word: word };
    return { type: 'unknown', word: word };
  }

  /**
   * Is this rejected trace just a plural of a real word?
   *
   * Plurals are deliberately absent from the dictionary — "reels" is not a
   * separate find from "reel" — so they land as 'unknown' alongside genuine
   * non-words. Telling the two apart lets the board say "no plurals" instead
   * of implying the letters spell nothing.
   */
  function looksLikePlural(word, dict) {
    if (!dict || word.length < 5 || !word.endsWith('s') || word.endsWith('ss')) return false;
    if (dict.has(word.slice(0, -1))) return true;                       // reels -> reel
    if (word.endsWith('es') && dict.has(word.slice(0, -2))) return true; // boxes -> box
    if (word.endsWith('ies') && dict.has(word.slice(0, -3) + 'y')) return true; // cities -> city
    return false;
  }

  /** Format ms as M:SS for the HUD. */
  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  return {
    DEFAULTS: DEFAULTS,
    STAR_SCHEDULES: STAR_SCHEDULES,
    MAX_STARS: MAX_STARS,
    scheduleFor: scheduleFor,
    starsFor: starsFor,
    msToNextStarLoss: msToNextStarLoss,
    extraSeconds: extraSeconds,
    buildDict: buildDict,
    createGame: createGame,
    remainingWords: remainingWords,
    totalWords: totalWords,
    solvedCount: solvedCount,
    submitWord: submitWord,
    tick: tick,
    creditTime: creditTime,
    formatTime: formatTime
  };
});
