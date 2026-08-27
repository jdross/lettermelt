import '../../../data/lexicon.js';
import '../../../js/generator.js';
import '../../../js/engine.js';

const Generator = globalThis.LetterMeltGenerator;
const Engine = globalThis.LetterMeltEngine;
const packed = globalThis.LETTER_MELT_LEXICON;
const unpacked = Generator.unpackLexicon(packed);
const cache = new Map();

function runtimeFor(mode) {
  const key = mode === 'hard' ? 'hard' : 'easy';
  if (cache.has(key)) return cache.get(key);
  const lexicon = Generator.lexiconFromPacked(unpacked, key);
  const pools = unpacked.pools[key];
  const easy = unpacked.pools.easy;
  const value = {
    mode: key,
    lexicon,
    dict: lexicon.words,
    pools: {
      common: pools.common,
      base: pools.base.length ? pools.base : pools.long,
      familiar: easy.common.concat(easy.long, easy.base)
    }
  };
  cache.set(key, value);
  return value;
}

export function createPuzzle(mode, seed) {
  const runtime = runtimeFor(mode);
  const puzzle = Generator.generatePuzzle({
    words: runtime.pools.common,
    longWords: runtime.pools.base,
    familiar: runtime.pools.familiar,
    lexicon: runtime.lexicon,
    mode: runtime.mode,
    seed: Number(seed) >>> 0
  });
  if (!puzzle) throw new Error('Could not generate a multiplayer puzzle');
  return puzzle;
}

export function hydrateGame(room, nowMs) {
  const runtime = runtimeFor(room.mode);
  const state = typeof room.state === 'string' ? JSON.parse(room.state) : room.state;
  const game = Engine.createGame({ puzzle: state.puzzle, dict: runtime.dict, mode: room.mode });
  game.foundWords = state.foundWords || [];
  game.foundWordTimes = state.foundWordTimes || [];
  game.extraWords = state.extraWords || [];
  game.savedMs = Number(room.saved_ms) || 0;
  game.status = room.status === 'won' || room.status === 'lost' ? room.status : 'playing';
  const started = room.started_at ? new Date(room.started_at).getTime() : nowMs;
  const pausedAt = room.paused_at ? new Date(room.paused_at).getTime() : 0;
  const activeNow = pausedAt ? Math.min(nowMs, pausedAt) : nowMs;
  const pausedMs = Number(room.paused_ms) || 0;
  game.elapsedMs = Math.max(0, Math.min(game.schedule.failMs, activeNow - started - game.savedMs - pausedMs));
  return game;
}

export function serializeGame(game) {
  return {
    puzzle: game.puzzle,
    foundWords: game.foundWords,
    foundWordTimes: game.foundWordTimes,
    extraWords: game.extraWords
  };
}

export function validateTrace(game, ids) {
  if (!Array.isArray(ids) || ids.length > 11 || new Set(ids).size !== ids.length) return null;
  const cells = new Set(game.puzzle.cells.map(cell => cell.id));
  if (!ids.length || ids.some(id => !cells.has(id))) return null;
  const adjacency = Generator.adjacencyMap(game.puzzle.cells, game.puzzle.edges);
  for (let i = 1; i < ids.length; i++) {
    if (!adjacency.get(ids[i - 1])?.has(ids[i])) return null;
  }
  return Generator.traceToWord(game.puzzle.cells, ids);
}

const CLAIM_FUTURE_GRACE_MS = 2000;

export function claimedElapsedMs(game, requestedMs) {
  const failMs = game.schedule.failMs;
  const serverElapsed = Math.round(game.elapsedMs);
  let claimed = Math.round(Number(requestedMs));
  if (!Number.isFinite(claimed) || claimed < 0) claimed = serverElapsed;
  if (claimed > serverElapsed + CLAIM_FUTURE_GRACE_MS) claimed = serverElapsed;
  return Math.max(0, Math.min(failMs, claimed));
}

export function applyClaimedWord(game, word, elapsedMs) {
  game.elapsedMs = elapsedMs;
  return Engine.submitWord(game, word);
}

export { Generator, Engine };
