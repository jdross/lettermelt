/* LetterMelt — local game history. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LetterMeltHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'lettermelt.games.v1';

  function asWord(value) {
    const word = String(value || '').toLowerCase();
    return /^[a-z]+$/.test(word) ? word : null;
  }

  function compactRecord(record) {
    const result = {
      s: Number(record.seed) >>> 0,
      m: record.mode === 'easy' ? 'easy' : 'hard',
      r: record.status === 'won' ? 'won' : 'lost',
      t: Math.max(0, Math.round(Number(record.elapsedMs) || 0)),
      z: Math.max(0, Math.min(5, Math.round(Number(record.stars) || 0))),
      f: []
    };
    const mainWord = asWord(record.mainWord);
    if (mainWord) result.w = mainWord;
    if (record.dailyDate) result.d = String(record.dailyDate);

    for (const found of Array.isArray(record.foundWords) ? record.foundWords : []) {
      const word = asWord(found && found.word);
      if (!word) continue;
      result.f.push([word, Math.max(0, Math.round(Number(found.elapsedMs) || 0))]);
    }
    return result;
  }

  function create(host) {
    const target = host || {};

    function storage() {
      try {
        return target.localStorage || null;
      } catch (_e) {
        return null;
      }
    }

    function read() {
      const store = storage();
      if (!store) return [];
      try {
        const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(game => game && typeof game === 'object') : [];
      } catch (_e) {
        return [];
      }
    }

    function write(games) {
      const store = storage();
      if (!store) return false;
      try {
        store.setItem(STORAGE_KEY, JSON.stringify(games));
        return true;
      } catch (_e) {
        return false;
      }
    }

    function save(record) {
      const compact = compactRecord(record || {});
      const games = read();
      // A daily game has one result per date and mode. Other runs remain
      // separate history entries, even when a player replays a shared link.
      if (compact.d) {
        const key = 'daily:' + compact.d + ':' + compact.m;
        const index = games.findIndex(game =>
          'daily:' + game.d + ':' + game.m === key
        );
        if (index >= 0) games[index] = compact;
        else games.push(compact);
      } else {
        games.push(compact);
      }
      return write(games);
    }

    function expand(compact) {
      if (!compact || typeof compact !== 'object') return null;
      return {
        seed: Number(compact.s) >>> 0,
        mode: compact.m === 'easy' ? 'easy' : 'hard',
        mainWord: compact.w || null,
        dailyDate: compact.d || null,
        status: compact.r === 'won' ? 'won' : 'lost',
        elapsedMs: Number(compact.t) || 0,
        stars: Number(compact.z) || 0,
        foundWords: (Array.isArray(compact.f) ? compact.f : [])
          .filter(found => Array.isArray(found) && asWord(found[0]))
          .map(found => ({
            word: found[0],
            elapsedMs: Number(found[1]) || 0
          }))
      };
    }

    function all() {
      return read().map(expand).filter(Boolean);
    }

    function getDaily(date, mode) {
      const wantedDate = String(date || '');
      const wantedMode = mode === 'easy' ? 'easy' : 'hard';
      const games = read();
      for (let i = games.length - 1; i >= 0; i--) {
        if (games[i].d === wantedDate && games[i].m === wantedMode) return expand(games[i]);
      }
      return null;
    }

    return { save: save, all: all, getDaily: getDaily, key: STORAGE_KEY };
  }

  return { STORAGE_KEY: STORAGE_KEY, create: create, compactRecord: compactRecord };
});
