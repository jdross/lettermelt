/* LetterMelt — local game history. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LetterMeltHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'lettermelt.games.v1';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function asWord(value) {
    const word = String(value || '').toLowerCase();
    return /^[a-z]+$/.test(word) ? word : null;
  }

  function headlineFromFound(found) {
    let best = '';
    for (const entry of Array.isArray(found) ? found : []) {
      const word = asWord(Array.isArray(entry) ? entry[0] : (entry && entry.word));
      if (word && word.length >= best.length) best = word;
    }
    return best || null;
  }

  function puzzleHeadline(puzzle) {
    if (!puzzle || typeof puzzle !== 'object') return null;
    const tagged = asWord(puzzle.longWord || puzzle.mainWord);
    if (tagged) return tagged;
    const words = Array.isArray(puzzle.words) ? puzzle.words : [];
    const marked = words.find(word => word && word.isLong);
    if (marked) return asWord(marked.text);
    let best = '';
    for (const word of words) {
      const text = asWord(word && word.text);
      if (text && text.length >= best.length) best = text;
    }
    return best || headlineFromFound(puzzle.foundWords || puzzle.found_words);
  }

  function headlineWord(record) {
    if (!record) return null;
    return asWord(record.mainWord || record.main_word || record.w) ||
      headlineFromFound(record.foundWords || record.found_words || record.f);
  }

  function scorePoints(mode, stars) {
    const n = Math.max(0, Math.min(5, Math.round(Number(stars) || 0)));
    return n * (mode === 'hard' ? 2 : 1);
  }

  function multiplayerScore(mode, stars, foundCount, totalCount) {
    const total = Math.max(0, Number(totalCount) || 0);
    const found = Math.max(0, Number(foundCount) || 0);
    if (!total) return 0;
    return Math.round(scorePoints(mode, stars) * 1.5 * Math.min(1, found / total));
  }

  function foundWordCount(record) {
    if (!record || typeof record !== 'object') return 0;
    const explicit = record.wordCount != null ? record.wordCount : record.word_count;
    if (explicit != null && Number.isFinite(Number(explicit))) return Math.max(0, Math.round(Number(explicit)));
    const found = record.foundWords || record.found_words || record.f;
    return Array.isArray(found) ? found.length : 0;
  }

  function scoreForRecord(record) {
    if (!record || typeof record !== 'object') return 0;
    const source = record.source || record.o;
    if (source === 'multiplayer' && record.points != null && Number.isFinite(Number(record.points))) {
      return Math.max(0, Math.round(Number(record.points)));
    }
    const mode = record.mode || record.m;
    const stars = record.stars != null ? record.stars : record.z;
    return scorePoints(mode, stars);
  }

  function totalScore(records) {
    let total = 0;
    for (const record of Array.isArray(records) ? records : []) {
      total += scoreForRecord(record);
    }
    return total;
  }

  function resultTime(record, index) {
    const created = Date.parse(record.created_at || record.createdAt || '') || 0;
    const played = Number(record.playedAt || record.c) || 0;
    const daily = parseDayMs(recordDate(record) || '');
    if (created || played || daily) return Math.max(created, played, daily);
    if (record._index != null) return Number(record._index) + 1;
    return (Number(index) || 0) + 1;
  }

  function newestFirst(records) {
    const list = Array.isArray(records) ? records : [];
    return list.map((record, index) => ({ record, index, t: resultTime(record, index) }))
      .sort((a, b) => b.t - a.t || b.index - a.index)
      .map(item => item.record);
  }

  function utcDateKey(date) {
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(date.getUTCDate()).padStart(2, '0');
  }

  function shiftDateKey(value, days) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) ||
        date.getUTCMonth() !== Number(match[2]) - 1 ||
        date.getUTCDate() !== Number(match[3])) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return utcDateKey(date);
  }

  function previousDateKey(value) {
    return shiftDateKey(value, -1);
  }

  function nextDateKey(value) {
    return shiftDateKey(value, 1);
  }

  function dailyDateKey(nowMs) {
    const edt = new Date((nowMs || Date.now()) - 4 * 60 * 60 * 1000);
    return utcDateKey(edt);
  }

  function recordDate(record) {
    const raw = record && (record.daily_date || record.dailyDate || record.d);
    if (!raw) return null;
    if (raw instanceof Date && Number.isFinite(raw.getTime())) return utcDateKey(raw);
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw));
    return match ? match[1] : null;
  }

  function recordMode(record) {
    return (record && (record.mode || record.m)) === 'easy' ? 'easy' : 'hard';
  }

  function recordWon(record) {
    return (record && (record.status || record.r)) === 'won';
  }

  function dailyResults(records) {
    const maps = { easy: new Map(), hard: new Map() };
    for (const record of Array.isArray(records) ? records : []) {
      const date = recordDate(record);
      if (!date || !previousDateKey(date)) continue;
      maps[recordMode(record)].set(String(date), recordWon(record));
    }
    return maps;
  }

  function currentStreakFromWins(wins, date) {
    const wantedDate = String(date || '');
    if (!previousDateKey(wantedDate) || !wins) return 0;
    let cursor = wantedDate;
    if (wins.get(cursor) === false) return 0;
    if (wins.get(cursor) !== true) cursor = previousDateKey(cursor);
    let streak = 0;
    while (cursor && wins.get(cursor) === true) {
      streak++;
      cursor = previousDateKey(cursor);
    }
    return streak;
  }

  function longestStreakFromWins(wins) {
    if (!wins) return 0;
    const dates = [];
    for (const [date, won] of wins) {
      if (won && previousDateKey(date)) dates.push(date);
    }
    dates.sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const date of dates) {
      run = prev && date === nextDateKey(prev) ? run + 1 : 1;
      if (run > best) best = run;
      prev = date;
    }
    return best;
  }

  function latestDateFromWins(wins) {
    let latest = null;
    if (!wins) return latest;
    for (const date of wins.keys()) {
      if (!latest || date > latest) latest = date;
    }
    return latest;
  }

  function streakStatsByMode(records, dateKey) {
    const maps = dailyResults(records);
    const today = dateKey || dailyDateKey();
    const result = {};
    for (const mode of ['easy', 'hard']) {
      result[mode] = {
        current: currentStreakFromWins(maps[mode], today),
        longest: longestStreakFromWins(maps[mode]),
        latestDate: latestDateFromWins(maps[mode])
      };
    }
    return result;
  }

  function streakStats(records, dateKey) {
    const byMode = streakStatsByMode(records, dateKey);
    return {
      current: Math.max(byMode.easy.current, byMode.hard.current),
      longest: Math.max(byMode.easy.longest, byMode.hard.longest)
    };
  }

  function parseDayMs(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return 0;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function formatPlayedOn(value, nowMs) {
    const ms = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? parseDayMs(value)
      : Number(value) || 0;
    if (!ms) return '';
    const then = new Date(ms);
    if (!Number.isFinite(then.getTime())) return '';
    const now = new Date(nowMs || Date.now());
    const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    const label = MONTHS[then.getMonth()] + ' ' + then.getDate();
    if (then.getFullYear() !== now.getFullYear()) return label + ', ' + then.getFullYear();
    return label;
  }

  function compactRecord(record) {
    const playedAt = Math.max(0, Math.round(Number(record.playedAt) || Date.now()));
    const result = {
      s: Number(record.seed) >>> 0,
      m: record.mode === 'easy' ? 'easy' : 'hard',
      r: record.status === 'won' ? 'won' : 'lost',
      t: Math.max(0, Math.round(Number(record.elapsedMs) || 0)),
      z: Math.max(0, Math.min(5, Math.round(Number(record.stars) || 0))),
      c: playedAt,
      f: []
    };
    const mainWord = headlineWord(record);
    if (mainWord) result.w = mainWord;
    if (record.dailyDate) result.d = String(record.dailyDate);
    const id = String(record.clientResultId || record.i || '');
    if (id) result.i = id;
    if (record.source === 'multiplayer') result.o = 'multiplayer';
    if (record.points != null && Number.isFinite(Number(record.points))) {
      result.p = Math.max(0, Math.round(Number(record.points)));
    }

    for (const found of Array.isArray(record.foundWords) ? record.foundWords : []) {
      const word = asWord(found && found.word);
      if (!word) continue;
      result.f.push([word, Math.max(0, Math.round(Number(found.elapsedMs) || 0))]);
    }
    return result;
  }

  function expand(compact) {
    if (!compact || typeof compact !== 'object') return null;
    const foundWords = (Array.isArray(compact.f) ? compact.f : [])
      .filter(found => Array.isArray(found) && asWord(found[0]))
      .map(found => ({
        word: found[0],
        elapsedMs: Number(found[1]) || 0
      }));
    return {
      seed: Number(compact.s) >>> 0,
      mode: compact.m === 'easy' ? 'easy' : 'hard',
      mainWord: headlineWord(compact),
      dailyDate: recordDate(compact),
      source: compact.o === 'multiplayer' ? 'multiplayer' : 'local',
      status: compact.r === 'won' ? 'won' : 'lost',
      elapsedMs: Number(compact.t) || 0,
      stars: Number(compact.z) || 0,
      playedAt: Number(compact.c) || 0,
      foundWords: foundWords,
      wordCount: foundWords.length,
      points: compact.p != null ? Math.max(0, Math.round(Number(compact.p) || 0)) : null
    };
  }

  function normalizeResult(record, index) {
    if (!record || typeof record !== 'object') return null;
    const core = record.s != null && (record.m === 'easy' || record.m === 'hard')
      ? expand(record)
      : {
        seed: Number(record.seed) >>> 0,
        mode: recordMode(record),
        mainWord: headlineWord(record),
        dailyDate: recordDate(record),
        status: (record.status || record.r) === 'won' ? 'won' : 'lost',
        elapsedMs: Number(record.elapsedMs != null ? record.elapsedMs : record.elapsed_ms) || 0,
        stars: Number(record.stars != null ? record.stars : record.z) || 0,
        playedAt: Number(record.playedAt || record.c) || Date.parse(record.created_at || record.createdAt || '') || 0,
        foundWords: Array.isArray(record.foundWords) ? record.foundWords
          : Array.isArray(record.found_words) ? record.found_words : [],
        wordCount: record.wordCount != null ? record.wordCount
          : record.word_count != null ? record.word_count : null,
        points: record.points != null ? record.points : record.p != null ? record.p : null
      };
    if (!core) return null;
    core.source = record.source || core.source || 'local';
    core.clientResultId = String(record.client_result_id || record.clientResultId || record.id || record.i || '');
    core.wordCount = foundWordCount(core);
    if (core.points != null && Number.isFinite(Number(core.points))) core.points = Math.max(0, Math.round(Number(core.points)));
    else core.points = null;
    core._index = record._index != null ? record._index : index;
    return core;
  }

  function mergeHistory(local, remote) {
    const byId = new Map();
    const locals = (Array.isArray(local) ? local : []).map(normalizeResult).filter(Boolean);
    const remotes = (Array.isArray(remote) ? remote : []).map(normalizeResult).filter(Boolean);
    for (const row of locals) {
      byId.set(row.clientResultId || ('local:' + row._index), row);
    }
    for (const row of remotes) {
      let key = row.clientResultId || '';
      let prev = key ? byId.get(key) : null;
      if (!prev && row.source === 'multiplayer') {
        for (const [existingKey, existing] of byId) {
          if (existing.seed === row.seed && existing.mode === row.mode && existing.status === row.status) {
            prev = existing;
            key = existingKey;
            break;
          }
        }
      }
      const merged = prev ? Object.assign({}, prev, row) : row;
      merged.mainWord = (prev && prev.mainWord) || merged.mainWord || null;
      merged.playedAt = Number(prev && prev.playedAt) || Number(merged.playedAt) || 0;
      byId.set(key || ('remote:' + byId.size), merged);
    }
    return newestFirst([...byId.values()]);
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
        if (index >= 0) {
          if (!compact.i && games[index].i) compact.i = games[index].i;
          games[index] = compact;
        } else {
          games.push(compact);
        }
      } else {
        games.push(compact);
      }
      return write(games);
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

    function getDailyStreak(date, mode) {
      const wantedMode = mode === 'easy' ? 'easy' : 'hard';
      return currentStreakFromWins(dailyResults(read())[wantedMode], String(date || ''));
    }

    return {
      save: save,
      all: all,
      getDaily: getDaily,
      getDailyStreak: getDailyStreak,
      key: STORAGE_KEY
    };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    create: create,
    compactRecord: compactRecord,
    expand: expand,
    scorePoints: scorePoints,
    multiplayerScore: multiplayerScore,
    scoreForRecord: scoreForRecord,
    foundWordCount: foundWordCount,
    totalScore: totalScore,
    newestFirst: newestFirst,
    mergeHistory: mergeHistory,
    normalizeResult: normalizeResult,
    formatPlayedOn: formatPlayedOn,
    dailyDateKey: dailyDateKey,
    previousDateKey: previousDateKey,
    streakStatsByMode: streakStatsByMode,
    streakStats: streakStats,
    puzzleHeadline: puzzleHeadline,
    headlineWord: headlineWord
  };
});
