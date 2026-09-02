const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gen = require(path.join(__dirname, '../js/generator.js'));
const engine = require(path.join(__dirname, '../js/engine.js'));
const input = require(path.join(__dirname, '../js/input.js'));
const share = require(path.join(__dirname, '../js/share.js'));
const historyModule = require(path.join(__dirname, '../js/history.js'));
const supabaseModule = require(path.join(__dirname, '../js/supabase.js'));

/* Fixed embedded vocabulary so the suite never depends on the generated data
 * files. Lengths 4-7 for regular words, 8-11 for the single longest word. */
const WORDS = [
  'able', 'acre', 'atom', 'bake', 'bald', 'band', 'bare', 'barn', 'beam', 'bean',
  'bear', 'beat', 'bell', 'belt', 'bend', 'bird', 'blue', 'boat', 'bone', 'cake',
  'calm', 'cane', 'cart', 'cave', 'coal', 'coat', 'cold', 'cone', 'core', 'corn',
  'dare', 'dark', 'date', 'dawn', 'deal', 'dear', 'dent', 'dial', 'earn', 'east',
  'lace', 'lake', 'land', 'lane', 'late', 'lead', 'lean', 'mare', 'mast', 'mate',
  'meal', 'mean', 'meat', 'mend', 'moat', 'nail', 'name', 'near', 'neat', 'nest',
  'note', 'oral', 'oval', 'pale', 'pane', 'part', 'past', 'pear', 'plan', 'pole',
  'rail', 'rain', 'rate', 'real', 'rent', 'road', 'robe', 'role', 'rope', 'sale',
  'salt', 'same', 'sand', 'seal', 'seam', 'seat', 'sent', 'alone', 'blame', 'blast',
  'brace', 'brain', 'bread', 'clean', 'clear', 'crane', 'cream', 'dream', 'learn', 'least',
  'metal', 'ocean', 'organ', 'paint', 'panel', 'pearl', 'place', 'plane', 'plant', 'plate',
  'scale', 'score', 'shore', 'slate', 'snail', 'stale', 'stand', 'stone', 'store', 'table',
  'trace', 'train', 'anchor', 'animal', 'basket', 'candle', 'castle', 'cellar', 'dealer', 'desert',
  'garden', 'inland', 'island', 'leader', 'legend', 'listen', 'manner', 'marble', 'master', 'mental',
  'nature', 'normal', 'orange', 'parcel', 'parent', 'planet', 'reason', 'relate', 'rental', 'sailor',
  'salmon', 'sample', 'season', 'senate', 'silent', 'silver', 'sister', 'stable', 'stream', 'talent',
  'tender', 'tunnel', 'winter', 'lantern', 'mineral', 'plaster'
];

const LONG_WORDS = [
  'painters', 'creation', 'material', 'mountain', 'notebook', 'cardinal', 'sandstone',
  'planetary', 'landscape', 'celebrate', 'presented', 'strangers', 'restaurant',
  'generation', 'personally', 'reasonable', 'centimeter'
];

const EXTRA_WORDS = ['lean', 'earn', 'tale', 'teal', 'sale', 'rate', 'tear', 'tone', 'nets', 'stare'];

/* Rare words: real dictionary entries that are NOT common. These are the only
 * words allowed to surface as extras. */
const RARE_WORDS = [
  'alant', 'anear', 'anlace', 'arles', 'astern', 'baled', 'bedel', 'canst', 'carle',
  'certes', 'clart', 'dolent', 'ealder', 'entera', 'estral', 'lanate', 'leman',
  'malar', 'meatal', 'nacre', 'natter', 'oaten', 'orant', 'pareo', 'ratel',
  'reata', 'renal', 'retable', 'salep', 'sental', 'stane', 'taler', 'telamon',
  'tolane', 'trave', 'antre', 'arene', 'blare', 'crare', 'dorsal', 'elans'
];

/* The dictionary the tests validate against: every common word plus the rare
 * ones. Built once, exactly as the game does at startup. */
const DICT_WORDS = WORDS.concat(LONG_WORDS, EXTRA_WORDS, RARE_WORDS);
const LEXICON = gen.buildLexicon(DICT_WORDS, WORDS.concat(EXTRA_WORDS), LONG_WORDS);

const PUZZLE_COUNT = 24;
const SOLVE_COUNT = PUZZLE_COUNT;   // every generated puzzle is solved right through

// Structural tests care about invariants, not about how long the generator is
// willing to hunt for a high-scoring board, so they run with the quality gate
// open and a small restart budget. The quality tuning has its own tests.
const FAST = { minFunScore: 0, restarts: 40 };
const runSlowTests = process.env.LETTERMELT_SLOW === '1';
const slowTest = (name, fn) => test(name, {
  skip: runSlowTests ? false : 'slow test; run npm run test:slow'
}, fn);

test('desktop sharing copies, confirms briefly, and restores the label', async () => {
  const classes = new Set();
  const button = {
    textContent: 'Share with friends',
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value)
    }
  };
  let copiedText = null;
  let timeout = null;
  const controller = share.createController({
    button: button,
    navigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      clipboard: { writeText: text => { copiedText = text; return Promise.resolve(); } }
    },
    document: {},
    window: {
      location: {},
      setTimeout: callback => { timeout = callback; return 1; },
      clearTimeout: () => {}
    },
    getText: () => 'challenge text'
  });

  assert.equal(await controller.share(), 'copied');
  assert.equal(copiedText, 'challenge text');
  assert.equal(button.textContent, 'copied!');
  assert.equal(classes.has('copied'), true);
  timeout();
  assert.equal(button.textContent, 'Share with friends');
  assert.equal(classes.has('copied'), false);
});

test('mobile sharing builds messaging links with pre-filled text', () => {
  const text = 'Try this puzzle: https://example.test/?s=42&m=hard';
  const android = share.messagingUrl(text, {
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Mobile)'
  });
  const ios = share.messagingUrl(text, {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
  });
  assert.equal(android, 'sms:?body=' + encodeURIComponent(text));
  assert.equal(ios, 'sms:&body=' + encodeURIComponent(text));
  assert.equal(share.isMobileDevice({ userAgentData: { mobile: true } }), true);
});

test('mobile sharing opens the messaging app instead of the clipboard', async () => {
  let clipboardCalls = 0;
  const win = {
    location: {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    prompt: () => {}
  };
  const controller = share.createController({
    button: { textContent: '', classList: { add: () => {}, remove: () => {} } },
    navigator: {
      userAgentData: { mobile: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Mobile)',
      clipboard: { writeText: () => { clipboardCalls++; return Promise.resolve(); } }
    },
    document: {},
    window: win,
    getText: () => 'Try this one!'
  });

  assert.equal(await controller.share(), 'messaging');
  assert.equal(win.location.href, 'sms:?body=Try%20this%20one!');
  assert.equal(clipboardCalls, 0);
});

test('loss sharing is short, funny, and challenges a friend', () => {
  const text = share.shareMessage({
    status: 'lost',
    modeLabel: 'hard',
    link: 'https://example.test/?s=42&m=hard'
  });
  assert.match(text, /melted me/);
  assert.match(text, /Think you can beat it\?/);
  assert.match(text, /s=42&m=hard/);
});

test('win sharing uses one star emoji per earned star', () => {
  const text = share.shareMessage({
    status: 'won',
    stars: 4,
    modeLabel: 'hard',
    elapsed: '2:34',
    link: 'https://example.test/?s=42&m=hard'
  });
  assert.match(text, /^I got ⭐⭐⭐⭐ on hard mode/);
  assert.doesNotMatch(text, /\b4 stars?\b/);
});

test('game history stores compact replay data and word timestamps', () => {
  let raw = null;
  const history = historyModule.create({
    localStorage: {
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; }
    }
  });
  history.save({
    seed: 42,
    mode: 'hard',
    mainWord: 'volcano',
    status: 'won',
    elapsedMs: 123456.7,
    stars: 4,
    playedAt: 1700000000000,
    foundWords: [
      { word: 'lava', elapsedMs: 1200.4 },
      { word: 'volcano', elapsedMs: 123000.9 }
    ]
  });
  const stored = JSON.parse(raw);
  assert.deepEqual(stored, [{
    s: 42, m: 'hard', r: 'won', t: 123457, z: 4, c: 1700000000000,
    f: [['lava', 1200], ['volcano', 123001]], w: 'volcano'
  }]);
  assert.deepEqual(history.all()[0].foundWords, [
    { word: 'lava', elapsedMs: 1200 },
    { word: 'volcano', elapsedMs: 123001 }
  ]);
  assert.equal(history.all()[0].playedAt, 1700000000000);
});

test('history stores the longest word and a play date for random boards', () => {
  assert.equal(historyModule.puzzleHeadline({
    longWord: 'volcano',
    words: [{ text: 'lava' }, { text: 'volcano', isLong: true }]
  }), 'volcano');
  assert.equal(historyModule.puzzleHeadline({
    words: [{ text: 'lava' }, { text: 'lantern', isLong: true }]
  }), 'lantern');
  let raw = null;
  const history = historyModule.create({
    localStorage: {
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; }
    }
  });
  history.save({
    seed: 9,
    mode: 'easy',
    status: 'won',
    elapsedMs: 54000,
    stars: 5,
    foundWords: [
      { word: 'lava', elapsedMs: 1200 },
      { word: 'volcano', elapsedMs: 50000 }
    ]
  });
  const stored = JSON.parse(raw)[0];
  assert.equal(stored.w, 'volcano');
  assert.ok(stored.c > 0);
  assert.equal(history.all()[0].mainWord, 'volcano');
  assert.equal(historyModule.headlineWord({ f: [['lava', 1], ['volcano', 2]] }), 'volcano');
});

test('daily history replaces only that date and difficulty', () => {
  let raw = null;
  const history = historyModule.create({
    localStorage: {
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; }
    }
  });
  const base = { seed: 7, mode: 'easy', mainWord: 'volcano', dailyDate: '2026-08-21', status: 'lost', elapsedMs: 300000, stars: 0 };
  history.save(base);
  history.save(Object.assign({}, base, { status: 'won', elapsedMs: 42000, stars: 5 }));
  history.save(Object.assign({}, base, { mode: 'hard', dailyDate: '2026-08-22' }));
  assert.equal(history.all().length, 2);
  assert.equal(history.getDaily('2026-08-21', 'easy').status, 'won');
  assert.equal(history.getDaily('2026-08-22', 'hard').status, 'lost');
});

test('daily history counts consecutive wins per difficulty and breaks on a loss', () => {
  let raw = null;
  const history = historyModule.create({
    localStorage: {
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; }
    }
  });
  const base = { seed: 7, mode: 'easy', dailyDate: '2026-08-20', status: 'won', elapsedMs: 42000, stars: 5 };
  history.save(base);
  history.save(Object.assign({}, base, { dailyDate: '2026-08-21' }));
  assert.equal(history.getDailyStreak('2026-08-22', 'easy'), 2, 'an unfinished day continues the prior streak');
  history.save(Object.assign({}, base, { dailyDate: '2026-08-22' }));
  assert.equal(history.getDailyStreak('2026-08-22', 'easy'), 3);
  history.save({ seed: 99, mode: 'hard', status: 'lost', elapsedMs: 1234, stars: 0 });
  assert.equal(history.getDailyStreak('2026-08-23', 'easy'), 3, 'a custom-game loss does not break a daily streak');
  history.save({ seed: 8, mode: 'hard', dailyDate: '2026-08-20', status: 'won', elapsedMs: 42000, stars: 5 });
  history.save({ seed: 8, mode: 'hard', dailyDate: '2026-08-21', status: 'won', elapsedMs: 42000, stars: 5 });
  assert.equal(history.getDailyStreak('2026-08-22', 'hard'), 2, 'hard has its own daily streak');
  history.save(Object.assign({}, base, { dailyDate: '2026-08-23', status: 'lost', stars: 0 }));
  assert.equal(history.getDailyStreak('2026-08-23', 'easy'), 0);
  assert.equal(history.getDailyStreak('2026-08-24', 'easy'), 0, 'a loss breaks the next day too');
  assert.equal(history.getDailyStreak('2026-08-22', 'hard'), 2, 'an easy loss does not break hard');
});

test('daily streaks use the latest result and repair duplicate daily rows', () => {
  let raw = JSON.stringify([
    { d: '2026-08-20', m: 'easy', r: 'won', c: 100 },
    { d: '2026-08-21', m: 'easy', r: 'won', c: 300 },
    { d: '2026-08-21', m: 'easy', r: 'lost', c: 200 }
  ]);
  const history = historyModule.create({
    localStorage: {
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; }
    }
  });
  assert.equal(history.getDailyStreak('2026-08-22', 'easy'), 2,
    'an older duplicate loss cannot erase the later win');
  assert.equal(history.getDaily('2026-08-21', 'easy').status, 'won',
    'the menu result uses the same latest daily attempt as the streak');

  history.save({
    seed: 7,
    mode: 'easy',
    dailyDate: '2026-08-21',
    status: 'won',
    elapsedMs: 42000,
    stars: 5
  });
  const stored = JSON.parse(raw);
  assert.equal(stored.filter(game => game.d === '2026-08-21' && game.m === 'easy').length, 1);
  assert.equal(history.getDailyStreak('2026-08-22', 'easy'), 2);
});

test('stars score 1 point on easy and 2 points on hard', () => {
  assert.equal(historyModule.scorePoints('easy', 5), 5);
  assert.equal(historyModule.scorePoints('hard', 4), 8);
  assert.equal(historyModule.scorePoints('hard', 0), 0);
  assert.equal(historyModule.totalScore([
    { mode: 'easy', stars: 5 },
    { mode: 'hard', stars: 3 },
    { m: 'hard', z: 1 }
  ]), 13);
  assert.equal(historyModule.multiplayerScore('hard', 3, 5, 10), 5);
  assert.equal(historyModule.multiplayerScore('hard', 3, 10, 10), 9);
  assert.equal(historyModule.multiplayerScore('easy', 5, 0, 10), 0);
});

test('game history lists newest games first and formats play dates', () => {
  const now = Date.UTC(2026, 7, 27, 18, 0, 0);
  const older = { mainWord: 'volcano', playedAt: Date.UTC(2026, 7, 20) };
  const newer = { mainWord: 'lantern', created_at: '2026-08-27T16:00:00.000Z' };
  assert.deepEqual(historyModule.newestFirst([older, newer]).map(game => game.mainWord), ['lantern', 'volcano']);
  assert.deepEqual(historyModule.newestFirst([{ w: 'first' }, { w: 'second' }]).map(game => game.w), ['second', 'first']);
  assert.equal(historyModule.formatPlayedOn(now, now), 'Today');
  assert.equal(historyModule.formatPlayedOn(now - 24 * 60 * 60 * 1000, now), 'Yesterday');
  assert.equal(historyModule.formatPlayedOn('2026-08-21', now), 'Aug 21');
  assert.equal(historyModule.formatPlayedOn('2025-12-04', now), 'Dec 4, 2025');
});

test('history merge keeps the local headline and lists newest games first', () => {
  const local = [{
    s: 1, m: 'hard', r: 'won', t: 1000, z: 4, c: 1700000000000,
    w: 'volcano', i: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', f: [['volcano', 1000]]
  }];
  const remote = [{
    client_result_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    seed: 1, mode: 'hard', status: 'won', stars: 4,
    main_word: null, created_at: '2026-08-27T16:00:00.000Z', source: 'local'
  }, {
    client_result_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    seed: 2, mode: 'easy', status: 'won', stars: 5,
    main_word: 'lantern', created_at: '2026-08-27T18:00:00.000Z', source: 'local'
  }];
  const merged = historyModule.mergeHistory(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].mainWord, 'lantern');
  assert.equal(merged[1].mainWord, 'volcano');
  assert.equal(merged[1].playedAt, 1700000000000);
});

test('remote history hydrates the local cache without losing local detail', () => {
  const localId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const remoteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let raw = JSON.stringify([{
    s: 1, m: 'easy', r: 'won', t: 1000, z: 5, c: 1700000000000,
    w: 'volcano', i: localId, f: [['lava', 200], ['volcano', 900]]
  }]);
  const history = historyModule.create({
    localStorage: {
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; }
    }
  });

  const merged = history.mergeRemote([{
    client_result_id: localId,
    seed: 1,
    mode: 'easy',
    status: 'won',
    main_word: null,
    daily_date: '2026-08-20',
    elapsed_ms: 1000,
    stars: 5,
    word_count: 2,
    created_at: '2026-08-20T16:00:00.000Z',
    source: 'local'
  }, {
    client_result_id: remoteId,
    seed: 2,
    mode: 'hard',
    status: 'won',
    main_word: 'lantern',
    elapsed_ms: 2000,
    stars: 4,
    word_count: 3,
    created_at: '2026-08-21T16:00:00.000Z',
    source: 'local'
  }]);

  assert.equal(merged.length, 2);
  assert.equal(history.all().length, 2);
  assert.equal(history.getDaily('2026-08-20', 'easy').mainWord, 'volcano');
  assert.deepEqual(history.getDaily('2026-08-20', 'easy').foundWords, [
    { word: 'lava', elapsedMs: 200 },
    { word: 'volcano', elapsedMs: 900 }
  ]);
  const storedRemote = JSON.parse(raw).find(game => game.i === remoteId);
  assert.equal(storedRemote.w, 'lantern');
  assert.equal(storedRemote.n, 3);
});

test('account streaks keep the current run and the longest daily run', () => {
  const records = [];
  for (let day = 20; day <= 22; day++) {
    records.push({ dailyDate: '2026-08-' + day, mode: 'easy', status: 'won' });
  }
  records.push({ dailyDate: '2026-08-23', mode: 'easy', status: 'lost' });
  records.push({ dailyDate: '2026-08-24', mode: 'easy', status: 'won' });
  records.push({ dailyDate: '2026-08-25', mode: 'easy', status: 'won' });
  for (let day = 20; day <= 26; day++) {
    records.push({ dailyDate: '2026-08-' + day, mode: 'hard', status: 'won' });
  }
  const live = historyModule.streakStats(records, '2026-08-27');
  assert.equal(live.current, 7, 'an unfinished day continues the longest live difficulty');
  assert.equal(live.longest, 7);
  records.push({ dailyDate: '2026-08-27', mode: 'easy', status: 'lost' });
  const other = historyModule.streakStats(records, '2026-08-27');
  assert.equal(other.current, 7, 'an easy loss does not break a live hard streak');
  records.push({ dailyDate: '2026-08-27', mode: 'hard', status: 'lost' });
  const broken = historyModule.streakStats(records, '2026-08-27');
  assert.equal(broken.current, 0);
  assert.equal(broken.longest, 7, 'the best run survives a later loss');
});

test('streak stats accept database date values and expose per-mode runs', () => {
  const records = [
    { daily_date: new Date('2026-08-25T00:00:00.000Z'), mode: 'easy', status: 'won' },
    { daily_date: new Date('2026-08-26T00:00:00.000Z'), mode: 'easy', status: 'won' },
    { daily_date: new Date('2026-08-27T00:00:00.000Z'), mode: 'easy', status: 'won' }
  ];
  const byMode = historyModule.streakStatsByMode(records, '2026-08-27');
  assert.deepEqual(byMode.easy, {
    current: 3,
    longest: 3,
    latestDate: '2026-08-27'
  });
  assert.deepEqual(byMode.hard, { current: 0, longest: 0, latestDate: null });
});

test('account screen is a scoreboard, not a help page', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  const multiplayer = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  assert.match(html, /id="accountName"/);
  assert.match(html, /id="accountEmail"/);
  assert.match(html, /id="accountEmailSent"[^>]*>Check your email</);
  assert.match(html, /id="accountDeleteConfirm"[^>]*hidden/);
  assert.match(html, /id="accountDeleteInput"/);
  assert.match(html, /id="accountScoreValue">…</);
  assert.match(html, /id="accountStreakValue">…</);
  assert.match(html, /id="accountBestValue">…</);
  assert.ok(html.indexOf('id="accountEmailSection"') < html.indexOf('id="accountHistory"'),
    'the unlinked-account email form belongs above history');
  assert.doesNotMatch(html, /Keep it across devices/);
  assert.doesNotMatch(html, /Saved on this device/);
  assert.doesNotMatch(html, /Easy ★ = 1/);
  assert.doesNotMatch(html, /total points/);
  assert.doesNotMatch(html, /Latest games/);
  assert.match(css, /\.account-stat-score\s*\{/);
  assert.match(css, /\.account-name\s*\{[\s\S]*background: rgba\(255, 255, 255, \.05\)/);
  assert.match(multiplayer, /streakStats/);
  assert.match(multiplayer, /accountEmailSection\.hidden = signedIn \|\| emailLinkPending/);
  assert.match(multiplayer, /emailLinkPending/);
  assert.match(multiplayer, /accountEmailSent\.hidden = signedIn \|\| !emailLinkPending/);
  assert.match(multiplayer, /confirmation !== 'confirm'/);
  assert.match(multiplayer, /accountDeleteConfirm\?\.addEventListener\('submit', deleteAccount\)/);
  assert.match(multiplayer, /setAccountMetricsLoading/);
  assert.match(multiplayer, /paintAccount/);
  assert.match(multiplayer, /mergeHistory/);
});

test('accounts persist scores, paginate public history, and copy the username URL', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '../js/supabase.js'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '../supabase/functions/game/index.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608270003_public_profiles.sql'), 'utf8');
  const scoreMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608270004_account_scores.sql'), 'utf8');
  const streakMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608270005_account_streaks.sql'), 'utf8');
  const queryMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608270006_query_indexes.sql'), 'utf8');
  assert.match(html, /id="accountUsername"[^>]*type="button"/);
  assert.match(html, /id="accountHistoryMoreButton"/);
  assert.doesNotMatch(html, /accountShare|Public stats link/);
  assert.match(client, /profileUrl()/);
  assert.match(client, /publicCall\('public_profile'/);
  assert.match(client, /copyProfileUrl/);
  assert.match(client, /limit: 10/);
  assert.match(client, /foundCount.*word/);
  assert.match(supabase, /async function publicCall/);
  assert.match(game, /body\?\.action === 'public_profile'/);
  assert.match(game, /jsonb_array_length\(found_words\)/);
  assert.match(game, /case 'streaks': return profileStreaks/);
  assert.match(game, /refreshProfileStreaks/);
  assert.match(migration, /username text/);
  assert.match(migration, /profiles_username_idx/);
  assert.match(scoreMigration, /account_score integer/);
  assert.match(scoreMigration, /points integer/);
  assert.match(streakMigration, /create table public\.account_daily_streaks/);
  assert.match(streakMigration, /longest_streak integer/);
  assert.match(queryMigration, /game_results_user_created_id_idx/);
  assert.match(client, /validUsername/);
  assert.match(game, /select display_name, username, account_score,/);
  assert.match(game, /account_score/);
  assert.match(game, /jsonb_to_recordset/);
  assert.match(game, /returning account_score/);
  assert.doesNotMatch(client, /client\.call\('streaks'/);
  assert.match(client, /state\[id\] !== accountRecordSignature/);
  assert.match(client, /const \[syncResult, results\] = await Promise\.all/);
  assert.match(client, /const profileNamePromise = loadProfileName\(\)\.catch/);
  assert.match(client, /accountRequestIsCurrent/);
  assert.match(client, /mergeRemote\(accountHistoryRemote\)/);
  assert.match(client, /rememberRemoteHistorySynced/);
  assert.match(main, /onHistoryChanged/);
  assert.match(client, /snapshotPromiseKey/);
  assert.match(main, /account-score/);
  assert.match(main, /account score/);
});

test('regular game picker starts either difficulty directly', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(html, /id="gameStartEasy"[^>]*>Play easy game</);
  assert.match(html, /id="gameStartHard"[^>]*>Play hard game</);
  assert.doesNotMatch(html, /id="gameModeEasy"/);
  assert.doesNotMatch(html, /id="gameModeHard"/);
  assert.match(main, /startSelectedGame\('easy'\)/);
  assert.match(main, /startSelectedGame\('hard'\)/);
});

test('every finished game stores the puzzle headline, including random and multiplayer boards', () => {
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  const gameFn = fs.readFileSync(path.join(__dirname, '../supabase/functions/game/index.js'), 'utf8');
  assert.match(main, /History\.puzzleHeadline/);
  assert.match(main, /openingPuzzle \|\| game\.puzzle/);
  assert.match(main, /playedAt: Date\.now\(\)/);
  assert.match(main, /function finishMultiplayer[\s\S]*saveGameResult\(\)/);
  assert.match(gameFn, /js\/history\.js/);
  assert.match(gameFn, /LetterMeltHistory/);
  assert.match(gameFn, /puzzleHeadline/);
  assert.doesNotMatch(gameFn, /function puzzleHeadline/);
  assert.match(gameFn, /insert into public\.game_results\([\s\S]*main_word/);
});

test('the win sheet calls out the longest-word bonus even without extras', () => {
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(main, /const longest = game\.puzzle\.words\.find\(word => word\.isLong && word\.found\)/);
  assert.match(main, /longest word: ' \+ longest\.text\.toUpperCase\(\) \+ ' · \+' \+ Engine\.extraSeconds\(\)/);
  assert.match(main, /els\.sheetSub\.classList\.toggle\('result-bonus', bonusParts\.length > 0\)/);
});

test('the result share action avoids selectors blocked as social widgets', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(html, /id="challengeAction"/);
  assert.match(html, /id="resultDailyEasy"/);
  assert.match(html, /id="resultDailyHard"/);
  assert.match(html, />Play another</);
  assert.match(css, /\.challenge-action\s*\{/);
  assert.match(css, /\.result-daily-action\s*\{/);
  assert.match(main, /renderResultDailyActions/);
  assert.match(main, /4 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(main, /No extra words found/);
  assert.doesNotMatch(html, /(?:id="shareBtn"|class="btn-share")/);
});

test('mobile touch guard permits scrolling every overflow sheet', () => {
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  for (const selector of ['.menu-sheet', '.debug-sheet', '.multiplayer-sheet', '.account-sheet', '.sheet']) {
    assert.match(main, new RegExp(selector.replace('.', '\\.')),
      selector + ' must be exempt from the global touchmove guard');
  }
});

test('tutorial board is a playable three-word melt starting with play', () => {
  const puzzle = gen.makeTutorialPuzzle();
  assert.deepEqual(gen.checkUnionInvariant(puzzle), []);
  assert.equal(puzzle.longWord, 'tutorial');
  assert.deepEqual(puzzle.words.map(word => word.text), ['tutorial', 'play', 'start']);
  assert.equal(gen.isValidTrace(puzzle.cells, puzzle.edges, [9, 10, 11, 13]), true);
  assert.equal(gen.traceToWord(puzzle.cells, [9, 10, 11, 13]), 'play');
  assert.equal(gen.isTraceable(puzzle.cells, puzzle.edges, 'start'), true);
  assert.equal(gen.isTraceable(puzzle.cells, puzzle.edges, 'tutorial'), true);

  const game = engine.createGame({
    puzzle: puzzle,
    dict: new Set(['play', 'start', 'tutorial']),
    mode: 'easy'
  });
  const play = engine.submitWord(game, 'play');
  assert.equal(play.type, 'required');
  assert.equal(play.solved, false);
  assert.ok(play.removedIds.includes(9));
  assert.ok(play.removedIds.includes(13));
  assert.equal(puzzle.cells.some(cell => cell.id === 11), true);
  assert.equal(gen.isTraceable(puzzle.cells, puzzle.edges, 'start'), true);
  assert.equal(engine.submitWord(game, 'start').type, 'required');
  const last = engine.submitWord(game, 'tutorial');
  assert.equal(last.type, 'required');
  assert.equal(last.solved, true);
  assert.equal(game.status, 'won');
});

test('first-time homepage visitors get a skippable playable tutorial', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(html, /id="tutorialSkip"/);
  assert.match(html, /id="tutorialCoach"/);
  assert.match(main, /lettermelt\.tutorial\.seen/);
  assert.match(main, /shouldAutoOpenTutorial/);
  assert.match(main, /startTutorial\(true\)/);
  assert.match(main, /TUTORIAL_ORDER = \['play', 'start', 'tutorial'\]/);
  assert.match(main, /els\.openTutorial\.hidden = hasSeenTutorial\(\)/);
});

test('multiplayer invite links never auto-open the tutorial', () => {
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(main, /function locationHasMultiplayerInvite/);
  assert.match(main, /params.get\('mp'\)/);
  assert.match(main, /locationHasMultiplayerInvite\(\)/);
  assert.match(main, /function startTutorial\(returnHome\) \{\s*if \(multiplayerActive\) return;/);
  assert.match(main, /function startMultiplayer\(snapshot\) \{\s*dismissTutorial\(\{ markSeen: false \}\)/);
  assert.match(main, /if \(multiplayerActive && game && game.status === 'playing'\)/);
});

test('multiplayer client stays disabled without public Supabase configuration', () => {
  const client = supabaseModule.create({
    config: { url: '', key: '' },
    storage: { getItem: () => null },
    fetch: async () => { throw new Error('should not fetch'); },
    window: {}
  });
  assert.equal(client.configured(), false);
});

test('anonymous Supabase sessions persist and authorize Edge Function calls', async () => {
  const values = new Map();
  const calls = [];
  const session = {
    access_token: 'header.payload.signature',
    refresh_token: 'refresh',
    expires_in: 3600,
    user: { id: '00000000-0000-4000-8000-000000000001' }
  };
  const client = supabaseModule.create({
    config: { url: 'https://project.supabase.co', key: 'sb_publishable_test' },
    storage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const body = url.endsWith('/auth/v1/signup') ? session : { data: { ok: true } };
      return { ok: true, status: 200, json: async () => body };
    },
    window: {}
  });
  await client.ensureSession();
  assert.ok(values.get(supabaseModule.SESSION_KEY));
  assert.deepEqual(await client.call('history', {}), { ok: true });
  assert.match(calls[1].init.headers.authorization, /^Bearer /);
  assert.equal(JSON.parse(calls[1].init.body).action, 'history');
});

test('Supabase getUser loads the signed-in profile for an email account', async () => {
  const values = new Map();
  const session = {
    access_token: 'header.payload.signature',
    refresh_token: 'refresh',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '00000000-0000-4000-8000-000000000003' }
  };
  values.set(supabaseModule.SESSION_KEY, JSON.stringify(session));
  const client = supabaseModule.create({
    config: { url: 'https://project.supabase.co', key: 'sb_publishable_test' },
    storage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    fetch: async (url, init) => {
      assert.match(url, /\/auth\/v1\/user$/);
      assert.equal(init.method, 'GET');
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: session.user.id, email: 'melt@example.com', is_anonymous: false })
      };
    },
    window: {}
  });
  const user = await client.getUser();
  assert.equal(user.email, 'melt@example.com');
  assert.equal(client.session().user.email, 'melt@example.com');
  assert.equal(client.email(), 'melt@example.com');
});

test('Supabase public profile reads do not bootstrap an anonymous session', async () => {
  let calls = 0;
  const client = supabaseModule.create({
    config: { url: 'https://project.supabase.co', key: 'sb_publishable_test' },
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async (url, init) => {
      calls++;
      assert.match(url, /\/functions\/v1\/game$/);
      assert.equal(init.headers.authorization, undefined);
      assert.deepEqual(JSON.parse(init.body), { action: 'public_profile', username: 'alice' });
      return { ok: true, status: 200, json: async () => ({ data: { displayName: 'Alice' } }) };
    },
    window: {}
  });
  assert.deepEqual(await client.publicCall('public_profile', { username: 'alice' }), { displayName: 'Alice' });
  assert.equal(calls, 1);
});

test('concurrent multiplayer calls share one anonymous session bootstrap', async () => {
  const values = new Map();
  let signups = 0;
  const session = {
    access_token: 'header.payload.signature',
    refresh_token: 'refresh',
    expires_in: 3600,
    user: { id: '00000000-0000-4000-8000-000000000002' }
  };
  const client = supabaseModule.create({
    config: { url: 'https://project.supabase.co', key: 'sb_publishable_test' },
    storage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    fetch: async url => {
      if (url.endsWith('/auth/v1/signup')) {
        signups += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ok: true, status: 200, json: async () => session };
      }
      return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) };
    },
    window: {}
  });
  const sessions = await Promise.all([client.ensureSession(), client.ensureSession(), client.ensureSession()]);
  assert.equal(signups, 1);
  assert.equal(sessions[0].access_token, session.access_token);
  assert.equal(sessions[2].user.id, session.user.id);
});

test('the native Realtime client uses the compact v2 wire protocol', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/supabase.js'), 'utf8');
  assert.match(source, /vsn=2\.0\.0/);
  assert.doesNotMatch(source, /vsn=1\.0\.0/);
  assert.match(source, /REQUEST_TIMEOUT_MS/);
  assert.match(source, /ensurePromise/);
  assert.match(source, /flushPending/);
  assert.match(source, /socket\.binaryType = 'arraybuffer'/);
  assert.match(source, /bytes\[0\] !== 4/);
  assert.match(source, /payloadEncoding === 1/);
  assert.match(source, /data\.arrayBuffer\(\)/);
});

test('the native Realtime client handles binary v2 broadcasts', async () => {
  const session = {
    access_token: 'header.payload.signature',
    refresh_token: 'refresh',
    user: { id: '00000000-0000-4000-8000-000000000003' }
  };
  let socket;
  class FakeWebSocket {
    constructor() {
      this.readyState = 0;
      socket = this;
      setImmediate(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(value) {
      const message = JSON.parse(value);
      if (message[3] === 'phx_join') {
        setImmediate(() => this.onmessage?.({
          data: JSON.stringify([message[0], message[1], message[2], 'phx_reply', { status: 'ok' }])
        }));
      }
    }
    close() { this.readyState = 3; }
  }
  const client = supabaseModule.create({
    config: { url: 'https://project.supabase.co', key: 'sb_publishable_test' },
    fetch: async url => url.endsWith('/auth/v1/signup')
      ? { ok: true, status: 200, json: async () => session }
      : { ok: true, status: 200, json: async () => ({}) },
    WebSocket: FakeWebSocket,
    window: { setTimeout, clearTimeout, setInterval, clearInterval }
  });
  const broadcasts = [];
  const channel = client.channel('room-id', {
    onBroadcast: (event, payload) => broadcasts.push({ event, payload })
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  const encode = value => new TextEncoder().encode(value);
  const parts = [
    encode('realtime:room:room-id'),
    encode('room_started'),
    encode(JSON.stringify({ users: [] })),
    encode(JSON.stringify({ roomId: 'room-id', status: 'playing' }))
  ];
  const bytes = new Uint8Array(5 + parts.reduce((total, part) => total + part.length, 0));
  bytes.set([4, parts[0].length, parts[1].length, parts[2].length, 1]);
  let offset = 5;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  socket.onmessage({ data: bytes.buffer });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(broadcasts, [{
    event: 'room_started',
    payload: { roomId: 'room-id', status: 'playing' }
  }]);
  assert.equal(socket.binaryType, 'arraybuffer');
  channel.close();
});

test('multiplayer works on insecure LAN origins and polls the authoritative lobby', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  const render = fs.readFileSync(path.join(__dirname, '../js/render.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(source, /function randomUuid/);
  assert.doesNotMatch(source, /requestId:\s*crypto\.randomUUID/);
  assert.doesNotMatch(source, /value\.i\s*=\s*crypto\.randomUUID/);
  assert.match(source, /snapshotTimer = win\.setInterval/);
  assert.match(source, /closeOverlay\(\);[\s\S]+opts\.onStart/);
  assert.match(source, /client\.call\('start_room'/);
  assert.match(source, /room_ready/);
  assert.doesNotMatch(source, /Starting in/);
  assert.match(html, /id="multiplayerStart"[^>]*>Start game</);
  assert.doesNotMatch(html, /id="multiplayerCountdown"/);
  assert.match(source, /function applyRoomEvent/);
  assert.match(source, /function noteRoomVersion/);
  assert.match(source, /nextVersion > currentVersion \+ 1/);
  assert.match(source, /event === 'room_started'/);
  assert.match(source, /stopSnapshotPolling\(\);[\s\S]+closeOverlay\(\);[\s\S]+opts\.onStart/);
  assert.doesNotMatch(source, /channel\?\.broadcast\('rematch'/);
  assert.doesNotMatch(source, /channel\?\.broadcast\('word_accepted'/);
  assert.match(source, /client\.call\(nextPaused \? 'pause' : 'resume'/);
  assert.match(source, /room_paused/);
  assert.match(source, /room_resumed/);
  assert.match(source, /function watchForRematch/);
  assert.match(source, /PRESENCE_GRACE_MS/);
  assert.match(source, /snapshotEpoch/);
  assert.match(source, /channelGeneration/);
  assert.match(source, /LOBBY_POLL_MS/);
  assert.match(source, /game has not started/);
  assert.match(source, /serverOffsetMs/);
  assert.match(source, /lastTraceKey/);
  assert.match(source, /traceKey = event \+ ':' \+ ids\.join\(','\)/);
  assert.match(render, /function applyRemoteVisuals\(changedIds, changedEdges\)/);
  assert.match(render, /if \(sameIds && nextName === state\.remoteName\) return/);
  assert.match(render, /remoteLabel/);
  assert.match(main, /!multiplayerActive && menuOpen/);
  assert.doesNotMatch(main, /multiplayerActive \|\| debugOpen/);
});

test('multiplayer uses the signed-in profile name before creating or joining a room', () => {
  const client = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '../supabase/functions/game/index.js'), 'utf8');
  assert.match(client, /async function loadProfileName/);
  assert.match(client, /client\.call\('profile', \{ read: true \}\)/);
  assert.match(client, /await loadProfileName\(\)\.catch\(\(\) => \{\}\);[\s\S]+const name = await saveName/);
  assert.match(client, /if \(room\?\.room\?\.id\) await refreshSnapshot\(\)\.catch/);
  assert.match(game, /if \(body\.read === true\)/);
});

test('loopback Supabase config follows the host when the site is opened over LAN', () => {
  const Supabase = require(path.join(__dirname, '../js/supabase.js'));
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const client = Supabase.create({
    document: {
      querySelector: selector => ({
        'meta[name="lettermelt-supabase-url"]': { content: 'http://127.0.0.1:54321' },
        'meta[name="lettermelt-supabase-key"]': { content: 'public-key' },
        'meta[name="lettermelt-multiplayer-enabled"]': { content: 'true' }
      }[selector])
    },
    storage,
    fetch: async () => { throw new Error('not reached'); },
    window: { location: { hostname: '192.168.5.34' } }
  });
  assert.equal(client.configuration().url, 'http://192.168.5.34:54321');
  assert.equal(client.configured(), true);
});

test('multiplayer schema locks room data behind RLS and private realtime topics', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608260001_multiplayer.sql'), 'utf8');
  assert.match(schema, /alter table public\.rooms enable row level security/i);
  assert.match(schema, /room_players[\s\S]+unique \(room_id, user_id\)/i);
  assert.match(schema, /room realtime receive/i);
  assert.match(schema, /realtime\.topic\(\)/i);
  assert.match(schema, /slot in \(1, 2\)/i);
  assert.match(schema, /security definer[\s\S]+is_room_member/i);
});

test('multiplayer submissions are transactional, locked, versioned, and idempotent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/game/index.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared/game_runtime.js'), 'utf8');
  assert.match(source, /for update/i);
  assert.match(source, /submission_receipts/i);
  assert.match(source, /claimedElapsedMs/);
  assert.match(source, /applyClaimedWord/);
  assert.match(source, /body\.word/);
  assert.match(source, /body\.elapsedMs/);
  assert.match(source, /elapsed_ms > \$\{claimedMs\}/);
  assert.match(source, /stolen: true/);
  assert.doesNotMatch(source, /expectedVersion/);
  assert.doesNotMatch(source, /type: 'stale'/);
  assert.match(runtime, /CLAIM_FUTURE_GRACE_MS/);
  assert.match(runtime, /function claimedElapsedMs/);
  assert.match(runtime, /function applyClaimedWord/);
  assert.match(source, /realtime\.send/);
  assert.match(source, /realtime broadcast failed/);
  assert.match(source, /function transactionWithBroadcasts/);
  assert.match(source, /EdgeRuntime\?\.waitUntil/);
  assert.match(source, /queueBroadcast\(room\.id, 'room_started'/);
  assert.match(source, /return result\.snapshot \|\| result\.event/);
  assert.match(source, /case 'pause': return pauseGame/);
  assert.match(source, /case 'resume': return resumeGame/);
  assert.match(source, /case 'start_room': return startRoom/);
  assert.match(source, /status = 'playing'/);
  assert.match(source, /room_ready/);
  assert.doesNotMatch(source, /Date\.now\(\) \+ 3000/);
  assert.match(source, /cancel_countdown[\s\S]+Not a player in this room/);
  assert.match(source, /case 'rematch': return rematch/);
  assert.match(source, /Your friend has left/);
});

test('multiplayer clients apply finds locally and resolve conflicts by claimed time', () => {
  const client = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(client, /word_claimed/);
  assert.match(client, /elapsedMs/);
  assert.match(client, /event === 'word_accepted' \|\| event === 'word_claimed'/);
  assert.doesNotMatch(client, /expectedVersion/);
  assert.match(main, /function publishMultiplayerFind/);
  assert.match(main, /function syncMultiplayerClock/);
  assert.match(main, /Engine\.submitWord\(game, word\)/);
  assert.match(main, /multiplayer\.submit\(\{/);
  assert.doesNotMatch(main, /multiplayer\.submit\(ids, multiplayerVersion\)/);
  assert.match(main, /nextMs < currentMs/);
});

test('multiplayer rematch keeps the same pair on a fresh board', () => {
  const client = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.match(client, /Play LetterMelt with me:/);
  assert.match(client, /clipboard\.writeText\(url\)/);
  assert.doesNotMatch(client, /Create a private game or join a friend/);
  assert.match(client, /async function rematch/);
  assert.match(client, /event === 'rematch'/);
  assert.match(main, /function playAnother/);
  assert.match(main, /multiplayer\.rematch\(/);
  assert.match(main, /multiplayer\.watchForRematch\(/);
  assert.match(main, /multiplayerServerOffsetMs/);
  assert.match(main, /multiplayer\.heartbeat\(\)\.then/);
  assert.match(main, /function applyMultiplayerPauseState/);
  assert.match(main, /function requestMultiplayerPause/);
  assert.match(main, /function requestMultiplayerResume/);
  assert.match(main, /server busy · retry/);
  assert.doesNotMatch(main, /multiplayer\.rematch\(\)\.then/);
});

test('multiplayer hosting is one step with an inline invite and a hidden room code', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../js/multiplayer.js'), 'utf8');
  assert.match(html, /id="multiplayerShareLink"/);
  assert.match(html, /Have a code\?/);
  assert.match(html, /Show room code/);
  assert.match(html, /id="multiplayerJoinRow"[^>]*hidden/);
  assert.match(html, /id="multiplayerCodeCard"[^>]*hidden/);
  assert.doesNotMatch(html, /Create game/);
  assert.doesNotMatch(html, /Invite a friend/);
  assert.match(client, /open\(\{ join: true \}\)/);
  assert.match(client, /els\.action\?\.addEventListener\('click', \(\) => open\(\)\)/);
  assert.match(client, /function createRoom/);
  assert.match(client, /recreateIfModeChanged/);
  assert.match(client, /Share the link and keep this page open/);
  assert.match(client, /Show room code/);
});

test('invite URLs use a different share-card title than the home page', () => {
  const vercel = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
  const inject = fs.readFileSync(path.join(__dirname, '../scripts/inject_config.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(index, /og:title" content="LetterMelt — Trace Words\. Melt the Board\."/);
  assert.match(inject, /Play LetterMelt with me/);
  assert.match(inject, /function writeInviteHtml/);
  assert.match(vercel, /invite\.html/);
  assert.match(vercel, /"key": "mp"/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lettermelt-invite-'));
  try {
    const indexPath = path.join(tmp, 'index.html');
    fs.writeFileSync(indexPath, index);
    execFileSync(process.execPath, [path.join(__dirname, '../scripts/inject_config.js'), indexPath]);
    const invite = fs.readFileSync(path.join(tmp, 'invite.html'), 'utf8');
    assert.match(invite, /og:title" content="Play LetterMelt with me"/);
    assert.match(invite, /<title>Play LetterMelt with me<\/title>/);
    assert.doesNotMatch(invite, /og:title" content="LetterMelt — Trace Words\. Melt the Board\."/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('multiplayer pause state is part of the authoritative room clock', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608270001_multiplayer_pause.sql'), 'utf8');
  const uniqueWord = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608270002_room_finds_unique_word.sql'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared/game_runtime.js'), 'utf8');
  assert.match(migration, /paused_at timestamptz/);
  assert.match(migration, /paused_ms integer/);
  assert.match(uniqueWord, /room_finds_word_unique/);
  assert.match(runtime, /activeNow/);
  assert.match(runtime, /pausedMs/);
});

function makePuzzle(seed) {
  const rng = gen.createRng(seed);
  const puzzle = gen.generatePuzzle(Object.assign({
    rng: rng, words: WORDS, longWords: LONG_WORDS, lexicon: LEXICON
  }, FAST));
  assert.ok(puzzle, 'generatePuzzle returned null for seed ' + seed);
  return { puzzle: puzzle, rng: rng };
}

/** Structural checks that must hold at every point in a puzzle's life. */
function assertBoardHealthy(puzzle, context) {
  assert.deepEqual(
    gen.checkUnionInvariant(puzzle), [],
    'union invariant broken ' + context
  );
  assert.deepEqual(
    gen.findCrossingEdgePairs(puzzle.cells, puzzle.edges), [],
    'crossing diagonal edges ' + context
  );
  for (const word of puzzle.words) {
    if (word.found) continue;
    assert.ok(
      gen.isValidTrace(puzzle.cells, puzzle.edges, word.cellIds),
      'canonical path for "' + word.text + '" not traceable ' + context
    );
    assert.equal(gen.traceToWord(puzzle.cells, word.cellIds), word.text);
  }
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

slowTest('generates puzzles of 10-16 words with exactly one 8-11 letter base word', () => {
  for (let i = 0; i < PUZZLE_COUNT; i++) {
    const { puzzle } = makePuzzle(100000 + i);
    assert.ok(puzzle.words.length >= 10, 'too few words: ' + puzzle.words.length);
    assert.ok(puzzle.words.length <= 16, 'too many words: ' + puzzle.words.length);

    const longs = puzzle.words.filter(w => w.isLong);
    assert.equal(longs.length, 1, 'expected exactly one longest word');
    assert.ok(longs[0].text.length >= 8 && longs[0].text.length <= 11,
      'longest word out of range: ' + longs[0].text);
    assert.equal(longs[0].text, puzzle.longWord);

    for (const word of puzzle.words) {
      if (word.isLong) continue;
      assert.ok(word.text.length >= 4 && word.text.length <= 7,
        'regular word out of range: ' + word.text);
    }
    const texts = puzzle.words.map(w => w.text);
    assert.equal(new Set(texts).size, texts.length, 'duplicate word in puzzle');
    for (const word of puzzle.words) {
      assert.equal(word.cellIds.length, word.text.length);
      assert.equal(new Set(word.cellIds).size, word.cellIds.length, 'word path revisits a cell');
    }
  }
});

test('every screened headline gets an equal-width random bucket', () => {
  const words = Array.from({ length: 37 }, (_unused, i) => 'word-' + i);
  for (let i = 0; i < words.length; i++) {
    const middleOfBucket = (i + 0.5) / words.length;
    assert.equal(gen.chooseHeadlineWord(words, () => middleOfBucket), words[i]);
  }
});

test('generation chooses one random headline before its board retries', () => {
  // A production-sized screened pool activates the fair headline path. The
  // first RNG value selects painters; all later values build and score boards.
  // The ordinary random seed deliberately resembles an encoded custom-word
  // seed, which must only be decoded when the caller actually supplied it.
  const longWords = LONG_WORDS.concat(['centrally', 'management', 'paintbrush']);
  const lexicon = Object.assign({}, LEXICON, { baseWords: longWords });
  const boardRng = gen.createRng(9876);
  let first = true;
  const rng = () => first ? (first = false, 0.01) : boardRng();
  const random = Math.random;
  let puzzle;
  try {
    Math.random = () => 0xff000000 / 0xffffffff;
    puzzle = gen.generatePuzzle({
      rng: rng,
      words: WORDS,
      longWords: longWords,
      lexicon: lexicon,
      mode: 'easy',
      minFunScore: 0,
      restarts: 40
    });
  } finally {
    Math.random = random;
  }
  assert.ok(puzzle, 'the preselected headline did not build a puzzle');
  assert.notEqual(puzzle.seed >>> 24, 0xff, 'ordinary game used the custom-word seed tag');
  assert.equal(puzzle.longWord, 'painters');
});

test('a registered 7-letter main word can anchor a puzzle', () => {
  const puzzle = gen.generatePuzzle({
    seed: 4242,
    words: WORDS,
    longWords: LONG_WORDS,
    lexicon: LEXICON,
    mainWord: 'lantern',
    minFunScore: 0,
    restarts: 40
  });
  assert.ok(puzzle, 'requested main word did not produce a puzzle');
  assert.equal(puzzle.longWord, 'lantern');
  assert.equal(puzzle.mainWord, 'lantern');
  assert.ok(puzzle.words.some(word => word.text === 'lantern' && word.isLong));
  assertBoardHealthy(puzzle, 'with requested main word');
});

test('a shared seed carries the requested main word', () => {
  const options = {
    words: WORDS,
    longWords: LONG_WORDS,
    lexicon: LEXICON
  };
  const seed = gen.seedForMainWord(4242, 'lantern', options);
  assert.notEqual(seed, null, 'main word was not encodable in the seed');
  const requested = gen.generatePuzzle(Object.assign({}, options, FAST, {
    seed: seed,
    mainWord: 'lantern'
  }));
  const shared = gen.generatePuzzle(Object.assign({}, options, FAST, {
    seed: seed
  }));
  assert.ok(requested && shared, 'encoded seed did not rebuild a puzzle');
  assert.equal(shared.mainWord, 'lantern');
  assert.deepEqual(shared.words.map(w => w.text), requested.words.map(w => w.text));
  assert.deepEqual(shared.cells, requested.cells);
  assert.deepEqual(shared.edges, requested.edges);
});

test('sharing code removes the revealing main-word URL parameter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  assert.doesNotMatch(source, /searchParams\.set\('w'/);
  assert.match(source, /url\.searchParams\.delete\('w'\)/);
});

test('an unregistered or too-short main word is rejected', () => {
  for (const mainWord of ['lanter', 'not-in-the-dictionary']) {
    assert.equal(gen.generatePuzzle({
      seed: 4242,
      words: WORDS,
      longWords: LONG_WORDS,
      lexicon: LEXICON,
      mainWord: mainWord,
      minFunScore: 0,
      restarts: 40
    }), null);
  }
});

slowTest('initial board is exactly the union of the word paths, with no crossings', () => {
  let nodeMin = Infinity;
  let gappyGrids = 0;
  for (let i = 0; i < PUZZLE_COUNT; i++) {
    const { puzzle } = makePuzzle(200000 + i);
    assertBoardHealthy(puzzle, 'at generation (seed ' + (200000 + i) + ')');
    nodeMin = Math.min(nodeMin, puzzle.cells.length);
    // Sharing must actually happen: far fewer nodes than letters.
    const letters = puzzle.words.reduce((sum, w) => sum + w.text.length, 0);
    assert.ok(puzzle.cells.length < letters * 0.6, 'words are not sharing letters');
    // Board fits a phone-portrait lattice.
    // Everything lives inside the fixed 4 x 4 grid.
    assert.equal(gen.CONFIG.size, 4, 'the grid is 4 x 4');
    const capacity = gen.CONFIG.size * gen.CONFIG.size;
    for (const cell of puzzle.allCells) {
      assert.ok(cell.x >= 0 && cell.x < gen.CONFIG.size, 'cell x outside the grid: ' + cell.x);
      assert.ok(cell.y >= 0 && cell.y < gen.CONFIG.size, 'cell y outside the grid: ' + cell.y);
    }
    assert.ok(puzzle.allCells.length <= capacity,
      'more than ' + capacity + ' cells: ' + puzzle.allCells.length);
    assert.equal(puzzle.cellsUsed, puzzle.allCells.length);
    if (puzzle.allCells.length < capacity) gappyGrids++;
  }
  // Boards are NOT required to fill the 4 x 4 — each one draws a random
  // occupancy budget, so silhouettes differ from game to game. minCells is the
  // only floor: below it the board stops reading as a grid.
  assert.ok(nodeMin >= gen.CONFIG.minCells,
    'board sparser than minCells: ' + nodeMin + ' cells');
  assert.ok(gappyGrids > 0, 'no board ever left a gap in the grid');
});

test('phase-2 saturation prefilter is a correct multiset-subset test', () => {
  const grid = new Map([['a', 2], ['b', 1], ['t', 1]]);
  assert.equal(gen.multisetFits('bat', grid), true);
  assert.equal(gen.multisetFits('tab', grid), true);
  assert.equal(gen.multisetFits('abat', grid), true, 'two a\'s are available');
  assert.equal(gen.multisetFits('aaab', grid), false, 'only two a\'s exist');
  assert.equal(gen.multisetFits('bb', grid), false, 'only one b exists');
  assert.equal(gen.multisetFits('cat', grid), false, 'c is not on the grid');
  assert.equal(gen.multisetFits('', grid), true);

  // Against real boards: every word placed must pass its own grid's filter.
  for (let i = 0; i < 6; i++) {
    const { puzzle } = makePuzzle(150000 + i);
    const counts = new Map();
    for (const cell of puzzle.allCells) counts.set(cell.letter, (counts.get(cell.letter) || 0) + 1);
    for (const word of puzzle.words) {
      assert.ok(gen.multisetFits(word.text, counts),
        '"' + word.text + '" is placed but fails the multiset filter');
    }
  }
});

test('word-count pruning keeps longer and more distinctive finds', () => {
  const texts = ['lantern', 'quiz', 'able', 'material'];
  const cells = [];
  const edges = [];
  let id = 1;
  for (const text of texts) {
    let previous = null;
    for (const letter of text) {
      cells.push({ id: id, x: id, y: 0, letter: letter });
      if (previous !== null) edges.push([previous, id]);
      previous = id++;
    }
  }
  const lexicon = gen.buildLexicon(texts, texts.slice(0, 3), ['material']);
  const commons = gen.enumerateWords(cells, edges, lexicon);
  assert.deepEqual(Array.from(commons.keys()), texts,
    'fixture did not enumerate in the intended pruning order');

  const trimmed = gen.trimToWordCount(
    cells, edges, { commons: commons, extraCount: 0 }, lexicon, 'material', 3, 3
  );
  assert.deepEqual(Array.from(trimmed.split.commons.keys()), ['lantern', 'quiz', 'material']);
});

test('every word is findable along shown edges from the start', () => {
  for (let i = 0; i < 12; i++) {
    const { puzzle } = makePuzzle(300000 + i);
    for (const word of puzzle.words) {
      const route = gen.findRoute(puzzle.cells, puzzle.edges, word.text);
      assert.ok(route, 'no route for "' + word.text + '"');
      assert.equal(gen.traceToWord(puzzle.cells, route), word.text);
      assert.ok(gen.isValidTrace(puzzle.cells, puzzle.edges, route));
    }
  }
});

/* ------------------------------------------------------------------ *
 * Removal + compaction
 * ------------------------------------------------------------------ */

slowTest('solving in random order keeps the invariant exact until the board empties', () => {
  for (let i = 0; i < SOLVE_COUNT; i++) {
    const { puzzle, rng } = makePuzzle(400000 + i);
    const order = gen.shuffled(puzzle.words.map((_w, idx) => idx), rng);
    for (const index of order) {
      const target = puzzle.words[index].text;
      const result = gen.removeWord(puzzle, index);
      assert.ok(result, 'removeWord failed for "' + target + '"');

      const context = 'after removing "' + target + '" (seed ' + (400000 + i) + ')';
      assertBoardHealthy(puzzle, context);

      // Nothing that another word still needs may have been removed.
      const stillNeeded = new Set();
      for (const word of puzzle.words) {
        if (word.found) continue;
        for (const id of word.cellIds) stillNeeded.add(id);
      }
      for (const id of result.removedIds) {
        assert.ok(!stillNeeded.has(id), 'removed a node another word still needs ' + context);
      }
      // Every remaining word is still findable by any route.
      for (const word of puzzle.words) {
        if (word.found) continue;
        assert.ok(gen.isTraceable(puzzle.cells, puzzle.edges, word.text),
          '"' + word.text + '" became untraceable ' + context);
      }
    }
    assert.equal(puzzle.cells.length, 0, 'board not empty after all words found');
    assert.equal(puzzle.edges.length, 0, 'edges left after all words found');
  }
});

test('shared letters survive while another word still needs them', () => {
  let sawSharedSurvivor = false;
  for (let i = 0; i < 20 && !sawSharedSurvivor; i++) {
    const { puzzle } = makePuzzle(500000 + i);
    const first = puzzle.words.findIndex(w => !w.isLong);
    const doomed = puzzle.words[first];
    const others = new Set();
    for (const word of puzzle.words) {
      if (word === doomed) continue;
      for (const id of word.cellIds) others.add(id);
    }
    const shared = doomed.cellIds.filter(id => others.has(id));
    const result = gen.removeWord(puzzle, first);
    for (const id of shared) {
      assert.ok(puzzle.cells.some(c => c.id === id),
        'a shared letter disappeared while still needed');
      assert.ok(!result.removedIds.includes(id));
    }
    // Letters used only by the solved word must be gone.
    for (const id of doomed.cellIds) {
      if (others.has(id)) continue;
      assert.ok(!puzzle.cells.some(c => c.id === id), 'orphan letter stayed on the board');
    }
    if (shared.length) sawSharedSurvivor = true;
  }
  assert.ok(sawSharedSurvivor, 'no puzzle produced a shared letter — words are not entangled');
});

slowTest('compaction slides components without overlaps or new crossings', () => {
  for (let i = 0; i < 8; i++) {
    const { puzzle, rng } = makePuzzle(600000 + i);
    const order = gen.shuffled(puzzle.words.map((_w, idx) => idx), rng);
    for (const index of order.slice(0, Math.ceil(order.length / 2))) {
      gen.removeWord(puzzle, index);
      gen.collapse(puzzle);   // idempotent: a second pass must stay legal
      const keys = puzzle.cells.map(c => c.x + ',' + c.y);
      assert.equal(new Set(keys).size, keys.length, 'compaction overlapped cells');
      assert.ok(puzzle.cells.every(c => c.x >= 0 && c.y >= 0), 'board not recentred');
      assertBoardHealthy(puzzle, 'after an extra collapse pass');
    }
  }
});

test('clonePuzzle preserves the opening layout and is independent', () => {
  const { puzzle } = makePuzzle(700002);
  const opening = gen.clonePuzzle(puzzle);
  const clone = gen.clonePuzzle(puzzle);
  const startCells = opening.cells.length;
  const startEdges = opening.edges.length;

  const before = puzzle.cells.length;
  gen.removeWord(clone, 0);
  assert.equal(clone.words[0].found, true);
  assert.equal(puzzle.words[0].found, false);
  assert.equal(puzzle.cells.length, before, 'removeWord mutated the original');
  assert.ok(clone.cells.length <= before);

  for (let i = 0; i < puzzle.words.length; i++) {
    if (!puzzle.words[i].found) gen.removeWord(puzzle, i);
  }
  assert.equal(puzzle.cells.length, 0, 'a solved live board should be empty');
  assert.equal(opening.cells.length, startCells, 'the opening snapshot lost cells');
  assert.equal(opening.edges.length, startEdges, 'the opening snapshot lost lanes');
  assert.ok(opening.words.every(w => !w.found), 'the opening snapshot was marked found');
});

/* ------------------------------------------------------------------ *
 * Stars, seeds and plurals
 * ------------------------------------------------------------------ */

test('stars are spent as the clock drains, and running out is a loss', () => {
  const m = 60 * 1000;
  const hard = engine.scheduleFor('hard');
  assert.equal(engine.starsFor(0, hard), 5);
  assert.equal(engine.starsFor(1.49 * m, hard), 5);
  assert.equal(engine.starsFor(1.5 * m, hard), 4, 'one-thirty exactly costs the first star');
  assert.equal(engine.starsFor(2 * m, hard), 3);
  assert.equal(engine.starsFor(2.5 * m, hard), 2);
  assert.equal(engine.starsFor(2 * m + 50 * 1000, hard), 1);
  assert.equal(engine.starsFor(3 * m, hard), 0, 'the deadline is a loss, not a one-star finish');
  assert.equal(hard.tiers[hard.tiers.length - 1].withinMs, hard.failMs);
  assert.equal(engine.msToNextStarLoss(0, hard), 1.5 * m);
  assert.equal(engine.msToNextStarLoss(3 * m, hard), null);

  // An unknown mode falls back to hard rather than throwing.
  assert.equal(engine.starsFor(0, 'nonsense'), 5);
});

test('easy mode spends stars on a five-minute ladder', () => {
  const m = 60 * 1000;
  const easy = engine.scheduleFor('easy');
  assert.equal(easy.failMs, 5 * m);
  assert.equal(engine.starsFor(0, easy), 5);
  assert.equal(engine.starsFor(2.5 * m - 1, easy), 5);
  assert.equal(engine.starsFor(2.5 * m, easy), 4, 'two-thirty exactly costs the first star');
  assert.equal(engine.starsFor(3 * m, easy), 3);
  assert.equal(engine.starsFor(4 * m, easy), 2);
  assert.equal(engine.starsFor(4.5 * m, easy), 1);
  assert.equal(engine.starsFor(5 * m, easy), 0, 'the deadline is a loss, not a one-star finish');
  assert.equal(easy.tiers[easy.tiers.length - 1].withinMs, easy.failMs);
  assert.equal(engine.msToNextStarLoss(0, easy), 2.5 * m);
  assert.equal(engine.msToNextStarLoss(5 * m, easy), null);
});

test('an extra word can buy a star back', () => {
  const { puzzle } = makePuzzle(910001);
  const extra = EXTRA_WORDS.find(word => !puzzle.words.some(w => w.text === word));
  assert.ok(extra, 'need an extra word outside the puzzle');
  const game = engine.createGame({ puzzle: puzzle, dict: new Set(EXTRA_WORDS) });
  engine.tick(game, 1.5 * 60 * 1000 + 2000);     // just past the first threshold
  assert.equal(engine.starsFor(game.elapsedMs, game.schedule), 4);
  const result = engine.submitWord(game, extra);
  assert.equal(result.type, 'extra');
  assert.equal(result.seconds, 10);
  assert.equal(engine.starsFor(game.elapsedMs, game.schedule), 5, 'time credit did not restore the star');
});

test('the mode picks the schedule the game is played on', () => {
  const { puzzle } = makePuzzle(910003);
  const hard = engine.createGame({ puzzle: puzzle, dict: new Set(), mode: 'hard' });
  const easy = engine.createGame({ puzzle: puzzle, dict: new Set(), mode: 'easy' });
  assert.equal(hard.schedule.failMs, 3 * 60 * 1000);
  assert.equal(easy.schedule.failMs, 5 * 60 * 1000);
  // No mode at all is hard, so an old-style call still behaves.
  assert.equal(engine.createGame({ puzzle: puzzle, dict: new Set() }).schedule.failMs, 3 * 60 * 1000);
});

test('a plural is reported as a plural, not as gibberish', () => {
  const { puzzle } = makePuzzle(910002);
  const dict = new Set(['reel', 'box', 'city', 'glass']);
  const game = engine.createGame({ puzzle: puzzle, dict: dict });
  assert.equal(engine.submitWord(game, 'reels').type, 'plural');
  assert.equal(engine.submitWord(game, 'boxes').type, 'plural');
  assert.equal(engine.submitWord(game, 'cities').type, 'plural');
  // Words that merely end in s are not plurals of anything: "glass" is in the
  // dictionary and pays out as an extra, "qwxzs" is simply not a word.
  assert.equal(engine.submitWord(game, 'glass').type, 'extra');
  assert.equal(engine.submitWord(game, 'qwxzs').type, 'unknown');
});

test('a seed rebuilds the identical board', () => {
  for (const seed of [1, 42, 987654321]) {
    const a = gen.generatePuzzle(Object.assign({
      seed: seed, words: WORDS, longWords: LONG_WORDS, lexicon: LEXICON
    }, FAST));
    const b = gen.generatePuzzle(Object.assign({
      seed: seed, words: WORDS, longWords: LONG_WORDS, lexicon: LEXICON
    }, FAST));
    assert.ok(a && b, 'generation failed for seed ' + seed);
    assert.equal(a.seed, seed, 'puzzle did not record its seed');
    assert.deepEqual(
      a.words.map(w => w.text).sort(), b.words.map(w => w.text).sort(),
      'seed ' + seed + ' produced two different boards'
    );
    assert.deepEqual(
      a.cells.map(c => c.letter + c.x + ',' + c.y),
      b.cells.map(c => c.letter + c.x + ',' + c.y),
      'seed ' + seed + ' produced two different layouts'
    );
  }
  // Sharing is pointless if every seed gives the same puzzle.
  const one = gen.generatePuzzle(Object.assign({ seed: 5, words: WORDS, longWords: LONG_WORDS, lexicon: LEXICON }, FAST));
  const two = gen.generatePuzzle(Object.assign({ seed: 6, words: WORDS, longWords: LONG_WORDS, lexicon: LEXICON }, FAST));
  assert.notDeepEqual(one.words.map(w => w.text), two.words.map(w => w.text));
});

/* ------------------------------------------------------------------ *
 * Performance
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Engine — stopwatch model
 * ------------------------------------------------------------------ */

function newGame(seed, dictWords) {
  const { puzzle } = makePuzzle(seed);
  const dict = engine.buildDict((dictWords || EXTRA_WORDS).join(' '));
  return { game: engine.createGame({ puzzle: puzzle, dict: dict }), puzzle: puzzle };
}

test('the clock runs the game out at the deadline', () => {
  const { game } = newGame(900001);
  assert.equal(game.elapsedMs, 0);
  assert.equal(game.status, 'playing');
  assert.equal(engine.tick(game, 1000), false);
  assert.equal(game.elapsedMs, 1000);
  assert.equal(engine.tick(game, 178999), false, 'a millisecond short is still playable');
  assert.equal(game.status, 'playing');

  // The tick that reaches the deadline reports it, exactly once.
  assert.equal(engine.tick(game, 1), true, 'the deadline tick must announce the loss');
  assert.equal(game.elapsedMs, 180000, 'the clock is pinned at the deadline, never past it');
  assert.equal(game.status, 'lost');
  assert.ok(game.finishedAt, 'a lost game records when it ended');
  assert.equal(engine.tick(game, 999999), false, 'a lost game does not keep ticking');
  assert.equal(game.elapsedMs, 180000);
  assert.equal(engine.submitWord(game, EXTRA_WORDS[0]).type, 'inactive');

  assert.equal(engine.formatTime(0), '0:00');
  assert.equal(engine.formatTime(65000), '1:05');
  assert.equal(engine.formatTime(180000), '3:00');
  assert.equal(engine.formatTime(600000), '10:00');
});

test('easy mode runs out in five minutes', () => {
  const { puzzle } = makePuzzle(900011);
  const game = engine.createGame({ puzzle: puzzle, dict: new Set(), mode: 'easy' });
  assert.equal(engine.tick(game, 5 * 60 * 1000 - 1), false);
  assert.equal(game.status, 'playing');
  assert.equal(engine.tick(game, 1), true);
  assert.equal(game.status, 'lost');
  assert.equal(engine.starsFor(game.elapsedMs, game.schedule), 0);
});

test('traces shorter than four letters are always rejected', () => {
  const { game, puzzle } = newGame(900002, ['cat', 'ate'].concat(EXTRA_WORDS));
  assert.equal(engine.submitWord(game, 'cat').type, 'short');
  assert.equal(engine.submitWord(game, 'ate').type, 'short');
  assert.equal(engine.submitWord(game, 'a').type, 'short');
  assert.equal(engine.submitWord(game, 'qqqqq').type, 'unknown');
  assert.equal(game.extraWords.length, 0);
  assert.equal(puzzle.words.every(w => !w.found), true);
});

test('extra words always subtract ten seconds, clamped at zero', () => {
  const { game, puzzle } = newGame(900003);
  const puzzleTexts = new Set(puzzle.words.map(w => w.text));
  const extra = EXTRA_WORDS.find(w => !puzzleTexts.has(w) && w.length === 5) ||
    EXTRA_WORDS.find(w => !puzzleTexts.has(w));
  assert.ok(extra, 'need an extra word outside the puzzle');

  engine.tick(game, 120000);
  const before = game.elapsedMs;
  const first = engine.submitWord(game, extra);
  assert.equal(first.type, 'extra');
  assert.equal(first.foundAtMs, before);
  assert.equal(first.seconds, engine.extraSeconds(extra.length));
  assert.equal(game.elapsedMs, before - first.seconds * 1000);
  assert.equal(game.savedMs, first.seconds * 1000);

  const repeat = engine.submitWord(game, extra);
  assert.equal(repeat.type, 'repeat-extra');
  assert.equal(game.extraWords.length, 1);
  assert.equal(game.elapsedMs, before - first.seconds * 1000, 'repeat must not credit again');

  // Clamp at zero.
  const fresh = newGame(900004).game;
  engine.tick(fresh, 2000);
  const clamped = engine.creditTime(fresh, 30000);
  assert.equal(fresh.elapsedMs, 0);
  assert.equal(clamped, 2000, 'credit is capped by the elapsed time');

  assert.equal(engine.extraSeconds(4), 10);
  assert.equal(engine.extraSeconds(8), 10);
  assert.equal(engine.extraSeconds(11), 10);
});

test('solving every word wins the game and reports the counter', () => {
  const { game, puzzle } = newGame(900005);
  const total = puzzle.words.length;
  assert.equal(engine.totalWords(game), total);
  assert.equal(engine.solvedCount(game), 0);

  engine.tick(game, 45000);
  const texts = puzzle.words.map(w => w.text);
  let last = null;
  for (let i = 0; i < texts.length; i++) {
    last = engine.submitWord(game, texts[i]);
    assert.equal(last.type, 'required', 'failed to solve "' + texts[i] + '"');
    assert.equal(engine.solvedCount(game), i + 1);
  }
  assert.equal(last.solved, true);
  assert.equal(game.status, 'won');
  assert.equal(game.foundWords.length, total);
  assert.equal(puzzle.cells.length, 0);
  assert.equal(game.elapsedMs, 35000, 'the longest word should credit ten seconds');
  // Nothing counts once the game is over.
  assert.equal(engine.submitWord(game, texts[0]).type, 'inactive');
  assert.equal(engine.tick(game, 5000), false);
  assert.equal(game.elapsedMs, 35000, 'the stopwatch stops when the puzzle is solved');
});

test('required words record the elapsed time when they are found', () => {
  const { game, puzzle } = newGame(9000051);
  const first = puzzle.words[0].text;
  const second = puzzle.words[1].text;
  engine.tick(game, 12345);
  const firstResult = engine.submitWord(game, first);
  assert.equal(firstResult.foundAtMs, 12345);
  engine.tick(game, 6789);
  const secondFoundAt = 12345 - firstResult.timeSaved + 6789;
  assert.equal(engine.submitWord(game, second).foundAtMs, secondFoundAt);
  assert.deepEqual(game.foundWordTimes.slice(0, 2), [
    { word: first, elapsedMs: 12345 },
    { word: second, elapsedMs: secondFoundAt }
  ]);
});

slowTest('the game ends if and only if every normal word is solved and the board is empty', () => {
  for (let i = 0; i < 12; i++) {
    const { puzzle, rng } = makePuzzle(950000 + i);
    const dict = engine.buildDict(EXTRA_WORDS.join(' '));
    // The deadline is tested on its own; here it is pushed out of reach so the
    // only thing that can end the game is the board emptying.
    const endless = { failMs: Infinity, tiers: [{ stars: 5, withinMs: Infinity }] };
    const game = engine.createGame({ puzzle: puzzle, dict: dict, schedule: endless });
    const order = gen.shuffled(puzzle.words.map((_w, idx) => idx), rng);

    for (let step = 0; step < order.length; step++) {
      const word = puzzle.words[order[step]];
      const isLast = step === order.length - 1;

      // Before the last word the board must still hold letters.
      assert.ok(puzzle.cells.length > 0, 'board emptied before the last word');
      assert.equal(game.status, 'playing', 'game ended early');

      // Short of the deadline, time passing never ends the game.
      engine.tick(game, 600000);
      assert.equal(game.status, 'playing', 'the clock ended the game before the board emptied');

      // Extras never end the game either.
      const puzzleTexts = new Set(puzzle.words.map(w => w.text));
      const extra = EXTRA_WORDS.find(w => !puzzleTexts.has(w) && !game.extraWords.some(e => e.word === w));
      if (extra) {
        engine.submitWord(game, extra);
        assert.equal(game.status, 'playing', 'an extra word ended the game');
        assert.ok(puzzle.cells.length > 0, 'an extra word removed letters from the board');
      }

      const result = engine.submitWord(game, word.text);
      assert.equal(result.type, 'required');

      // THE biconditional, checked at this exact moment.
      const allSolved = puzzle.words.every(w => w.found);
      const boardEmpty = puzzle.cells.length === 0 && puzzle.edges.length === 0;
      assert.equal(allSolved, boardEmpty,
        'board emptiness must track solving every normal word (step ' + step + ')');
      assert.equal(game.status === 'won', allSolved,
        'win state must trigger exactly when the last normal word is solved');
      assert.equal(result.solved, allSolved);
      assert.equal(allSolved, isLast, 'the win must land on the final word, no earlier');
    }

    assert.equal(game.status, 'won');
    assert.equal(engine.solvedCount(game), puzzle.words.length);
    assert.equal(puzzle.cells.length, 0);
    assert.equal(puzzle.edges.length, 0);
    // There is no other end condition: nothing can be submitted afterwards.
    assert.equal(engine.submitWord(game, EXTRA_WORDS[0]).type, 'inactive');
    assert.equal(engine.tick(game, 999999), false);
  }
});

test('the longest word is reported through the result so the HUD can celebrate', () => {
  const { game, puzzle } = newGame(900006);
  const long = puzzle.words.find(w => w.isLong);
  const regular = puzzle.words.find(w => !w.isLong);
  assert.equal(engine.submitWord(game, regular.text).isLong, false);
  engine.tick(game, 20000);
  const result = engine.submitWord(game, long.text);
  assert.equal(result.isLong, true);
  assert.equal(result.bonusSeconds, 10);
  assert.equal(result.timeSaved, 10000);
  assert.equal(engine.submitWord(game, long.text).type, 'repeat-required');
});

test('finding the longest word can restore a spent star', () => {
  const { game, puzzle } = newGame(900008);
  const long = puzzle.words.find(w => w.isLong);
  engine.tick(game, 1.5 * 60 * 1000 + 2000);
  assert.equal(engine.starsFor(game.elapsedMs, game.schedule), 4);
  const result = engine.submitWord(game, long.text);
  assert.equal(result.type, 'required');
  assert.equal(result.bonusSeconds, 10);
  assert.equal(game.elapsedMs, 1.5 * 60 * 1000 - 8000);
  assert.equal(engine.starsFor(game.elapsedMs, game.schedule), 5);
});

test('the solved-word time credit is tunable', () => {
  const { puzzle } = makePuzzle(900007);
  const game = engine.createGame({ puzzle: puzzle, dict: new Set(), solvedCreditMs: 5000 });
  const regular = puzzle.words.find(w => !w.isLong);
  engine.tick(game, 60000);
  const result = engine.submitWord(game, regular.text);
  assert.equal(result.timeSaved, 5000);
  assert.equal(game.elapsedMs, 55000);
});


/* ------------------------------------------------------------------ *
 * The guarantee: every word that EXISTS in the puzzle works
 * ------------------------------------------------------------------ */

const PROPERTY_COUNT = 12;

/**
 * Submit every word the board can currently spell through the real engine.
 * Nothing traceable may ever come back 'unknown', and the normal/extra split
 * must follow commonness, not construction history.
 */
function assertEveryTraceableWordWorks(game, lexicon, context) {
  const puzzle = game.puzzle;
  const traceable = gen.enumerateWords(puzzle.cells, puzzle.edges, lexicon);
  const remaining = new Set(puzzle.words.filter(w => !w.found).map(w => w.text));
  const solved = new Set(puzzle.words.filter(w => w.found).map(w => w.text));

  for (const [word, route] of traceable) {
    // The route the enumerator found must be a legal trace.
    assert.ok(gen.isValidTrace(puzzle.cells, puzzle.edges, route),
      'enumerated route for "' + word + '" is not traceable ' + context);
    assert.equal(gen.traceToWord(puzzle.cells, route), word);

    if (lexicon.isCommon(word)) {
      // A common word is ALWAYS a normal word: solved already, or still to go.
      assert.ok(remaining.has(word) || solved.has(word),
        'traceable common word "' + word + '" is not in the normal set ' + context);
    }
    if (solved.has(word)) continue;         // already melted away, nothing to submit

    const before = game.puzzle.words.filter(w => !w.found).length;
    const result = engine.submitWord(game, word);
    assert.notEqual(result.type, 'unknown',
      'traceable word "' + word + '" was rejected as not-a-word ' + context);
    assert.notEqual(result.type, 'short', '"' + word + '" wrongly judged too short');

    if (result.type === 'required') {
      // Undo: this probe must not actually advance the game.
      assert.ok(remaining.has(word));
      assert.equal(game.puzzle.words.filter(w => !w.found).length, before - 1);
      return { probedSolve: word };
    }
    assert.ok(result.type === 'extra' || result.type === 'repeat-extra',
      'unexpected verdict "' + result.type + '" for "' + word + '" ' + context);
    // Extras are exclusively rare words.
    assert.equal(lexicon.isCommon(word), false,
      'common word "' + word + '" surfaced as an extra ' + context);
  }
  return { probedSolve: null };
}

slowTest('traceable words stay valid and common words remain required', () => {
  for (let i = 0; i < PROPERTY_COUNT; i++) {
    const { puzzle, rng } = makePuzzle(1200000 + i);
    const game = engine.createGame({ puzzle: puzzle, dict: LEXICON.words });
    const seed = 'seed ' + (1200000 + i);

    const traceable = gen.enumerateWords(puzzle.cells, puzzle.edges, LEXICON);
    const normal = new Set(puzzle.words.map(w => w.text));
    for (const word of traceable.keys()) {
      if (!LEXICON.isCommon(word)) continue;
      assert.ok(normal.has(word),
        'traceable common word "' + word + '" was left out of the normal set');
    }
    for (const word of puzzle.words) {
      assert.ok(traceable.has(word.text),
        'normal word "' + word.text + '" is not traceable on its own board');
      assert.ok(LEXICON.isCommon(word.text),
        'normal word "' + word.text + '" is not a common word');
    }
    const longs = Array.from(traceable.keys())
      .filter(w => w.length >= gen.CONFIG.longMin && LEXICON.isCommon(w));
    assert.deepEqual(longs, [puzzle.longWord], 'a rival long common word is traceable');
    for (const word of puzzle.words) {
      if (word.isLong) continue;
      assert.ok(word.text.length < puzzle.longWord.length,
        '"' + word.text + '" is not shorter than the base word');
    }

    assertEveryTraceableWordWorks(game, LEXICON, 'at the start (' + seed + ')');

    const order = gen.shuffled(puzzle.words.map((_w, idx) => idx), rng);
    let step = 0;
    for (const index of order) {
      const word = puzzle.words[index];
      if (word.found) continue;             // a probe may have solved it already
      const result = engine.submitWord(game, word.text);
      assert.equal(result.type, 'required', 'could not solve "' + word.text + '"');
      step++;
      assertBoardHealthy(puzzle, 'after solve ' + step + ' (' + seed + ')');
      assertEveryTraceableWordWorks(game, LEXICON, 'after solve ' + step + ' (' + seed + ')');
    }
    assert.equal(puzzle.cells.length, 0, 'board not empty after every word was solved');
    assert.equal(game.status, 'won');
  }
});

slowTest('enumeration is monotone: solving never makes a new word traceable', () => {
  for (let i = 0; i < 12; i++) {
    const { puzzle, rng } = makePuzzle(1300000 + i);
    let previous = new Set(gen.enumerateWords(puzzle.cells, puzzle.edges, LEXICON).keys());
    const order = gen.shuffled(puzzle.words.map((_w, idx) => idx), rng);
    for (const index of order) {
      gen.removeWord(puzzle, index);
      const now = new Set(gen.enumerateWords(puzzle.cells, puzzle.edges, LEXICON).keys());
      for (const word of now) {
        assert.ok(previous.has(word),
          '"' + word + '" became traceable only after a removal — enumeration is not monotone');
      }
      previous = now;
    }
  }
});

test('the lexicon answers membership, commonness and prefixes', () => {
  assert.equal(LEXICON.has('stone'), true);
  assert.equal(LEXICON.has('zzzzz'), false);
  assert.equal(LEXICON.isCommon('stone'), true);
  assert.equal(LEXICON.isCommon('anlace'), false, 'rare words are not common');
  assert.equal(LEXICON.has('anlace'), true, 'rare words are still real words');
  assert.equal(LEXICON.isPrefix('sto'), true);
  assert.equal(LEXICON.isPrefix('zqx'), false);
  // Past the indexed depth the prefix test degrades to "maybe", never to "no".
  assert.equal(LEXICON.isPrefix('a'.repeat(gen.PREFIX_DEPTH + 1)), true);
  for (const word of WORDS.concat(LONG_WORDS)) {
    assert.equal(LEXICON.isCommon(word), true, word + ' should be common');
    for (let n = 1; n <= Math.min(gen.PREFIX_DEPTH, word.length); n++) {
      assert.equal(LEXICON.isPrefix(word.slice(0, n)), true);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Tracing (regression: valid words were reaching the engine truncated)
 * ------------------------------------------------------------------ */

/**
 * Sample a route the way a real finger does: points spaced evenly ALONG the
 * path, at an arbitrary phase, so they land between tiles rather than
 * conveniently on top of them. `spacing` is in svg units; one tile step is
 * 100, so spacing 80 means roughly one pointer sample per tile — already a
 * brisk swipe. Browsers deliver 60-120 samples a second, i.e. far denser.
 */
function samplePath(points, spacing, phase) {
  const out = [points[0]];
  let carry = phase;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let t = carry;
    while (t < d) {
      out.push({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d });
      t += spacing;
    }
    carry = t - d;
  }
  out.push(points[points.length - 1]);
  return out;
}

function makeTracer(puzzle, options) {
  const positions = new Map(puzzle.cells.map(c => [c.id, { x: c.x * input.STEP, y: c.y * input.STEP }]));
  const adjacency = gen.adjacencyMap(puzzle.cells, puzzle.edges);
  const tracer = input.createTracer({
    getAdjacency: () => adjacency,
    nodeAt: (point, radius, filter) => input.nearestNode(positions, point, radius, filter)
  }, options);
  return { tracer: tracer, positions: positions, adjacency: adjacency };
}

/** Drive the pure tracer along a route with realistic pointer sampling. */
function traceRoute(puzzle, route, spacing, phase, options) {
  const rig = makeTracer(puzzle, options);
  const points = route.map(id => rig.positions.get(id));
  rig.tracer.down(points[0]);
  for (const point of samplePath(points, spacing, phase || 0).slice(1)) rig.tracer.move(point);
  return rig.tracer.end();
}

slowTest('a traced word reaches the engine complete, however coarsely it is sampled', () => {
  // The regression: sparse pointer samples used to skip tiles, so a perfectly
  // good word arrived at the engine truncated ("surge" -> "surg") and was
  // rejected as not-a-word. The tracer now walks each pointer segment.
  for (const spacing of [15, 80]) {
    for (const phase of [0, 23]) {
      for (let i = 0; i < 4; i++) {
        const { puzzle } = makePuzzle(1400000 + i);
        for (const word of puzzle.words) {
          const ids = traceRoute(puzzle, word.cellIds, spacing, phase);
          assert.deepEqual(ids, word.cellIds,
            'sampling every ' + spacing + ' units mangled "' + word.text + '" -> "' +
            gen.traceToWord(puzzle.cells, ids) + '"');
        }
      }
    }
  }
});

test('walking the pointer segment beats sampling only at the reported points', () => {
  // Same routes, sampled sparsely enough to hurt. Walking the segment must be
  // strictly better than the old point-sampling behaviour.
  let walked = 0;
  let pointOnly = 0;
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const { puzzle } = makePuzzle(1450000 + i);
    for (const word of puzzle.words) {
      total++;
      const a = traceRoute(puzzle, word.cellIds, 130, 11);
      const b = traceRoute(puzzle, word.cellIds, 130, 11, { walkStep: 1e9, lockRadius: 58 });
      if (gen.traceToWord(puzzle.cells, a) === word.text) walked++;
      if (gen.traceToWord(puzzle.cells, b) === word.text) pointOnly++;
    }
  }
  assert.ok(walked > pointOnly,
    'segment walking (' + walked + '/' + total + ') should beat point sampling (' +
    pointOnly + '/' + total + ')');
});

test('the tracer never locks a tile that is not connected to the trace', () => {
  const { puzzle } = makePuzzle(1500001);
  const adjacency = gen.adjacencyMap(puzzle.cells, puzzle.edges);
  for (const word of puzzle.words) {
    const ids = traceRoute(puzzle, word.cellIds, 30, 7);
    for (let i = 1; i < ids.length; i++) {
      assert.ok(adjacency.get(ids[i - 1]).has(ids[i]),
        'tracer locked a tile with no connecting lane');
    }
    assert.equal(new Set(ids).size, ids.length, 'tracer reused a tile');
  }
});

test('backtracking over the previous tile undoes a step', () => {
  const { puzzle } = makePuzzle(1500002);
  const rig = makeTracer(puzzle);
  const tracer = rig.tracer;
  const positions = rig.positions;
  const route = puzzle.words[0].cellIds;
  tracer.down(positions.get(route[0]));
  tracer.move(positions.get(route[1]));
  tracer.move(positions.get(route[2]));
  assert.equal(tracer.current().length, 3);
  tracer.move(positions.get(route[1]));   // drift back
  assert.deepEqual(tracer.current(), [route[0], route[1]]);
});

test('pointerup submits a complete trace even when capture is released away from the final tile', () => {
  const positions = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 100, y: 0 }],
    ['c', { x: 200, y: 0 }],
    ['away', { x: 0, y: 200 }]
  ]);
  const adjacency = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['a', 'c'])],
    ['c', new Set(['b'])],
    ['away', new Set()]
  ]);
  const listeners = new Map();
  const submitted = [];
  const svg = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    setPointerCapture: () => {},
    hasPointerCapture: () => true,
    // Model browsers that notify lostpointercapture while release is running.
    releasePointerCapture: pointerId => listeners.get('lostpointercapture')({ pointerId }),
  };
  const renderer = {
    toSvgPoint: (x, y) => ({ x, y }),
    nodeAt: (point, radius, filter) => input.nearestNode(positions, point, radius, filter),
    setTrace: () => {},
    clearTrace: () => {},
  };

  input.attach(svg, renderer, {
    getAdjacency: () => adjacency,
    isActive: () => true,
    onSubmit: ids => submitted.push(ids),
  });

  const event = (pointerId, point) => ({
    pointerId,
    pointerType: 'mouse',
    button: 0,
    clientX: point.x,
    clientY: point.y,
    preventDefault: () => {},
  });
  listeners.get('pointerdown')(event(7, positions.get('a')));
  listeners.get('pointermove')(event(7, positions.get('b')));
  listeners.get('pointermove')(event(7, positions.get('c')));
  listeners.get('pointerup')(event(7, positions.get('away')));

  assert.deepEqual(submitted, [['a', 'b', 'c']]);
});

test('pointerup walks the final unsampled segment of a fast drag', () => {
  const positions = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 100, y: 0 }],
    ['c', { x: 200, y: 0 }],
    ['d', { x: 300, y: 0 }]
  ]);
  const adjacency = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['a', 'c'])],
    ['c', new Set(['b', 'd'])],
    ['d', new Set(['c'])]
  ]);
  const listeners = new Map();
  const submitted = [];
  const svg = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    setPointerCapture: () => {},
    hasPointerCapture: () => true,
    releasePointerCapture: () => {},
  };
  const renderer = {
    toSvgPoint: (x, y) => ({ x, y }),
    nodeAt: (point, radius, filter) => input.nearestNode(positions, point, radius, filter),
    setTrace: () => {},
    clearTrace: () => {},
  };

  input.attach(svg, renderer, {
    getAdjacency: () => adjacency,
    isActive: () => true,
    onSubmit: ids => submitted.push(ids),
  });

  const event = point => ({
    pointerId: 31,
    pointerType: 'mouse',
    button: 0,
    clientX: point.x,
    clientY: point.y,
    preventDefault: () => {},
  });
  listeners.get('pointerdown')(event(positions.get('a')));
  listeners.get('pointerup')(event(positions.get('d')));

  assert.deepEqual(submitted, [['a', 'b', 'c', 'd']]);
});

/* ------------------------------------------------------------------ *
 * Feedback split
 * ------------------------------------------------------------------ */

test('repeats, short traces and non-words are three distinct verdicts', () => {
  const { puzzle } = makePuzzle(1600001);
  const game = engine.createGame({ puzzle: puzzle, dict: LEXICON.words });
  const normal = puzzle.words.find(w => !w.isLong).text;

  assert.equal(engine.submitWord(game, 'ate').type, 'short');
  assert.equal(engine.submitWord(game, 'qwxzj').type, 'unknown');

  assert.equal(engine.submitWord(game, normal).type, 'required');
  assert.equal(engine.submitWord(game, normal).type, 'repeat-required',
    'a solved word must read as already-found, not as a non-word');

  const traceable = gen.enumerateWords(puzzle.cells, puzzle.edges, LEXICON);
  const rare = Array.from(traceable.keys()).find(w => !LEXICON.isCommon(w));
  if (rare) {
    assert.equal(engine.submitWord(game, rare).type, 'extra');
    assert.equal(engine.submitWord(game, rare).type, 'repeat-extra',
      'a found extra must read as already-found, not as a non-word');
  }
});

/* ------------------------------------------------------------------ *
 * Real data files (only when they match the current contract)
 * ------------------------------------------------------------------ */

const realData = (() => {
  const sandbox = {};
  try {
    const previous = global.window;
    global.window = sandbox;
    require(path.join(__dirname, '../data/lexicon.js'));
    global.window = previous;
  } catch (_e) {
    return null;
  }
  if (!sandbox.LETTER_MELT_LEXICON || !sandbox.LETTER_MELT_LEXICON.w) return null;
  const unpacked = gen.unpackLexicon(sandbox.LETTER_MELT_LEXICON);
  sandbox.LETTER_MELT_COMMON = unpacked.pools.hard.common;
  sandbox.LETTER_MELT_COMMON_LONG = unpacked.pools.hard.long;
  sandbox.LETTER_MELT_BASE = unpacked.pools.hard.base;
  sandbox.LETTER_MELT_COMMON_EASY = unpacked.pools.easy.common;
  sandbox.LETTER_MELT_LONG_EASY = unpacked.pools.easy.long;
  sandbox.LETTER_MELT_FAMILIAR = unpacked.pools.easy.common.concat(unpacked.pools.easy.long);
  sandbox.LETTER_MELT_DICT_RAW = Array.from(unpacked.words).join(' ');
  sandbox.lexicon = gen.lexiconFromPacked(unpacked, 'hard');
  return sandbox;
})();

const slowRealTest = (name, missingDataReason, fn) => test(name, {
  skip: !runSlowTests
    ? 'slow test; run npm run test:slow'
    : (!realData ? missingDataReason : false)
}, fn);

slowRealTest('real boards are dense, fresh, familiar, and finishable in five minutes', 'no real data', () => {
  const density = [];
  const subwords = [];
  const scores = [];
  const familiarShare = [];
  const estimates = [];
  const counts = [];
  const fours = [];
  const headlineDiagonals = [];
  const headlinePerimeters = [];
  const boardDiagonals = [];
  for (let i = 0; i < 5; i++) {
    const puzzle = gen.generatePuzzle({
      rng: gen.createRng(7000000 + i),
      words: realData.LETTER_MELT_COMMON,
      longWords: realData.LETTER_MELT_BASE,
      lexicon: realData.lexicon,
      familiar: realData.LETTER_MELT_FAMILIAR,
      mode: 'hard'
    });
    assert.ok(puzzle, 'generation failed');
    assert.ok(puzzle.quality, 'puzzle carries no quality report');
    density.push(puzzle.quality.parts.lettersPerCell);
    subwords.push(puzzle.quality.parts.subwordPairs);
    scores.push(puzzle.quality.score);
    familiarShare.push(puzzle.quality.parts.familiarShare);
    estimates.push(puzzle.quality.parts.estimateSec);
    counts.push(puzzle.words.length);
    fours.push(puzzle.quality.parts.fourShare);
    headlineDiagonals.push(puzzle.quality.parts.headlineDiagonalShare);
    headlinePerimeters.push(puzzle.quality.parts.headlinePerimeterShare);
    boardDiagonals.push(puzzle.quality.parts.boardDiagonalShare);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  // Letters must be pulling their weight in several words each.
  assert.ok(avg(density) >= 3.5, 'boards not dense enough: ' + avg(density).toFixed(2) + ' letters/cell');
  // print/printer pairs pad the word count without being separate finds.
  // (race/trace and cell/cellar are fine — different words, real discoveries.)
  assert.ok(avg(subwords) <= 0.4, 'too many same-root pairs: ' + avg(subwords).toFixed(2) + ' per board');
  assert.ok(Math.min(...scores) >= 45, 'a board scored far below the quality bar: ' + Math.min(...scores));
  // Cascade Pack constructs from words a reasonably smart player knows.
  assert.ok(avg(familiarShare) >= 0.7, 'boards not familiar enough: ' + avg(familiarShare).toFixed(2));
  // The estimate is a generation quality target (~5 min), not the race clock.
  assert.ok(avg(estimates) < 300, 'estimated solve too slow: ' + avg(estimates).toFixed(0) + 's');
  assert.ok(avg(counts) >= 12 && avg(counts) <= 14,
    'hard boards should cluster on 13 words: ' + avg(counts).toFixed(2));
  // Longer finds are the point of hard; 4-letter slices of those words still
  // get promoted, so a perfect 4-letter drought is impossible. What we refuse
  // is a board that is mostly four-letter filler.
  assert.ok(avg(fours) <= 0.6, 'too many 4-letter words: ' + avg(fours).toFixed(2));
  // Headline words should weave through the board rather than snake around
  // its outside edge. The rest of the graph should inherit that richer mix.
  assert.ok(avg(headlineDiagonals) >= 0.35,
    'headline paths need more diagonals: ' + avg(headlineDiagonals).toFixed(2));
  assert.ok(avg(headlineDiagonals) <= 0.65,
    'headline paths lost their cardinal/diagonal mix: ' + avg(headlineDiagonals).toFixed(2));
  assert.ok(avg(headlinePerimeters) <= 0.45,
    'headline paths hug the perimeter: ' + avg(headlinePerimeters).toFixed(2));
  assert.ok(avg(boardDiagonals) >= 0.3,
    'board graphs need more diagonals: ' + avg(boardDiagonals).toFixed(2));
});

test('the quality score reacts to the things it claims to measure', () => {
  const { puzzle } = makePuzzle(880011);
  const baseline = gen.scorePuzzle(puzzle, LEXICON, 20);
  assert.ok(baseline.score >= 0 && baseline.score <= 100, 'score out of range: ' + baseline.score);

  // Planting the SAME WORD in another form must cost freshness.
  const withDerived = JSON.parse(JSON.stringify(puzzle));
  const host = withDerived.words.find(w => !w.isLong) || withDerived.words[0];
  withDerived.words.push({
    text: host.text + (host.text.endsWith('e') ? 'r' : 'er'),
    cellIds: host.cellIds.slice(),
    found: false,
    isLong: false
  });
  const dirty = gen.scorePuzzle(withDerived, LEXICON, 20);
  assert.ok(dirty.parts.subwordPairs > baseline.parts.subwordPairs, 'same-root pair went uncounted');
  assert.ok(dirty.parts.freshness < baseline.parts.freshness, 'freshness ignored the same-root pair');

  // But a different word that merely overlaps must NOT be penalised: finding
  // "race" after "trace" is a real second discovery.
  const withOverlap = JSON.parse(JSON.stringify(puzzle));
  withOverlap.words.push({
    text: 'race', cellIds: host.cellIds.slice(0, 4), found: false, isLong: false
  });
  withOverlap.words.push({
    text: 'trace', cellIds: host.cellIds.slice(0, 5), found: false, isLong: false
  });
  const overlapped = gen.scorePuzzle(withOverlap, LEXICON, 20);
  assert.equal(overlapped.parts.subwordPairs, baseline.parts.subwordPairs,
    'race/trace was wrongly counted as the same word');

  // More rare words to stumble on is worth more.
  const richer = gen.scorePuzzle(puzzle, LEXICON, 60);
  assert.ok(richer.parts.extras >= baseline.parts.extras, 'extras component ignored the rare-word count');

  // Words a player would not think of cost familiarity and estimated pace.
  const known = gen.scorePuzzle(puzzle, LEXICON, 20, new Set(puzzle.words.map(w => w.text)));
  const unknown = gen.scorePuzzle(puzzle, LEXICON, 20, new Set(['zzzzzzzz']));
  assert.ok(unknown.parts.familiarity < known.parts.familiarity, 'familiarity ignored the known-word set');
  assert.ok(unknown.parts.estimateSec > known.parts.estimateSec, 'unfamiliar words should look slower to solve');
  assert.ok(known.parts.estimateSec > 0, 'pace estimate missing');
});

slowRealTest('easy mode is a friendlier subset of the hard vocabulary', 'no real data', () => {
  const hard = new Set(realData.LETTER_MELT_COMMON);
  const hardLong = new Set(realData.LETTER_MELT_COMMON_LONG);
  assert.ok(realData.LETTER_MELT_COMMON_EASY.length > 500, 'easy vocabulary too small to build boards');
  assert.ok(realData.LETTER_MELT_COMMON_EASY.length < realData.LETTER_MELT_COMMON.length,
    'easy vocabulary is not narrower than hard');
  for (const word of realData.LETTER_MELT_COMMON_EASY) {
    assert.ok(hard.has(word), 'easy word "' + word + '" is not a hard word');
  }
  for (const word of realData.LETTER_MELT_LONG_EASY) {
    assert.ok(hardLong.has(word), 'easy long word "' + word + '" is not a hard long word');
  }
});

slowRealTest('base words are the recognisable subset of the long words', 'no real data', () => {
  const long = new Set(realData.LETTER_MELT_COMMON_LONG);
  for (const word of realData.LETTER_MELT_BASE) {
    assert.ok(long.has(word), 'base word "' + word + '" is not in the common long list');
    assert.ok(word.length >= 8 && word.length <= 11, 'base word out of range: ' + word);
  }
  // Being common and being fit to headline a puzzle are different bars, so the
  // base pool must be a genuine subset rather than a copy of the long list.
  assert.ok(realData.LETTER_MELT_BASE.length < realData.LETTER_MELT_COMMON_LONG.length,
    'base pool is not narrower than the long list');
  assert.ok(realData.LETTER_MELT_BASE.length >= 400,
    'base pool too small for variety: ' + realData.LETTER_MELT_BASE.length);
  assert.ok(realData.lexicon.baseWords.length > 320,
    'runtime screening still truncates the headline pool: ' + realData.lexicon.baseWords.length);
});

slowRealTest('real word lists carry no plural, past-tense, or -ly adverb forms', 'no real data', () => {
  // Required words are the ones the counter tallies, so "metal" AND "metals"
  // both counting would inflate the target without adding anything to solve.
  // Stems are checked against the shipped dictionary; it starts at 4 letters,
  // so only stems that long are verifiable here (dogs/dog is caught at build
  // time against the full word list).
  const dict = new Set(String(realData.LETTER_MELT_DICT_RAW).split(/\s+/));
  // Nouns whose normal form ends in -s are deliberately kept: "binoculars" is
  // not "binocular" plus an s the way "reels" is "reel" plus an s.
  const pluralOnly = new Set([
    'scissors', 'trousers', 'pliers', 'tweezers', 'binoculars', 'pajamas',
    'jeans', 'goggles', 'shears', 'suds', 'dregs', 'alms', 'series', 'species',
    'news', 'shorts', 'tongs', 'bellows', 'premises', 'measles', 'mumps'
  ]);
  const offenders = [];
  for (const word of realData.LETTER_MELT_COMMON.concat(realData.LETTER_MELT_COMMON_LONG)) {
    if (pluralOnly.has(word)) continue;
    const plural = word.endsWith('s') && !word.endsWith('ss') && dict.has(word.slice(0, -1));
    const past = word.endsWith('ed') && !word.endsWith('eed') &&
      (dict.has(word.slice(0, -1)) || dict.has(word.slice(0, -2)));
    if (plural || past) offenders.push(word);
  }
  assert.deepStrictEqual(offenders, [], 'inflected forms leaked into the required-word lists');
  const required = new Set(realData.LETTER_MELT_COMMON.concat(realData.LETTER_MELT_COMMON_LONG));
  for (const word of ['quickly', 'slowly', 'finally', 'absolutely', 'happily']) {
    assert.equal(required.has(word), false, word + ' should not be a required adverb');
  }
  for (const word of ['family', 'early', 'only', 'apply', 'ugly', 'really']) {
    assert.ok(required.has(word) || realData.LETTER_MELT_DICT_RAW.split(/\s+/).includes(word),
      word + ' is not an adverb and should stay playable');
  }
});

slowRealTest('high-prevalence words are required, low-prevalence stay extras', 'no real data', () => {
  const hard = new Set(realData.LETTER_MELT_COMMON.concat(realData.LETTER_MELT_COMMON_LONG));
  const easy = new Set(realData.LETTER_MELT_COMMON_EASY.concat(realData.LETTER_MELT_LONG_EASY));
  for (const word of ['grail', 'alpaca', 'gator', 'advisor', 'something', 'together']) {
    assert.ok(hard.has(word), word + ' should be a hard required word');
  }
  for (const word of ['grail', 'alpaca', 'gator', 'something']) {
    assert.ok(easy.has(word), word + ' should be an easy required word');
  }
  assert.ok(hard.has('mart'), 'mart should be a hard common word');
  assert.ok(easy.has('mart'), 'mart should be an easy common word');
  assert.equal(hard.has('abed'), false, 'low-prevalence words stay extras');
  assert.equal(hard.has('nous'), false);
  assert.equal(hard.has('thee'), false, 'archaic function words are not required');
  assert.equal(hard.has('hath'), false);
});

slowRealTest('real word lists: every word that exists in the puzzle works', 'no real data', () => {
  const lexicon = realData.lexicon;
  for (let i = 0; i < 3; i++) {
    const rng = gen.createRng(2000000 + i);
    const puzzle = gen.generatePuzzle({
      rng: rng,
      words: realData.LETTER_MELT_COMMON,
      longWords: realData.LETTER_MELT_BASE,
      lexicon: lexicon,
      familiar: realData.LETTER_MELT_FAMILIAR,
      minFunScore: 0, restarts: 20
    });
    assert.ok(puzzle, 'generatePuzzle returned null on real data');
    assert.ok(puzzle.words.length >= 10 && puzzle.words.length <= 16,
      'real-data puzzle has ' + puzzle.words.length + ' words');
    assert.ok(puzzle.allCells.length <= gen.CONFIG.size * gen.CONFIG.size,
      'real-data puzzle exceeded the 4 x 4 grid');
    assert.equal(puzzle.words.filter(w => w.isLong).length, 1);
    const game = engine.createGame({ puzzle: puzzle, dict: lexicon.words });
    const seed = 'real seed ' + (2000000 + i);

    // No traceable common word may be missing from the normal set, and the
    // base word is the only long one.
    const traceable = gen.enumerateWords(puzzle.cells, puzzle.edges, lexicon);
    const normal = new Set(puzzle.words.map(w => w.text));
    for (const word of traceable.keys()) {
      if (!lexicon.isCommon(word)) continue;
      assert.ok(normal.has(word), 'common word "' + word + '" left as an extra (' + seed + ')');
      if (word !== puzzle.longWord) {
        assert.ok(word.length < gen.CONFIG.longMin, 'rival long word "' + word + '" (' + seed + ')');
      }
    }
    assertEveryTraceableWordWorks(game, lexicon, 'at the start (' + seed + ')');

    const order = gen.shuffled(puzzle.words.map((_w, idx) => idx), rng);
    for (const index of order) {
      const word = puzzle.words[index];
      if (word.found) continue;
      assert.equal(engine.submitWord(game, word.text).type, 'required');
      assertBoardHealthy(puzzle, 'mid-solve (' + seed + ')');
      assertEveryTraceableWordWorks(game, lexicon, 'mid-solve (' + seed + ')');
    }
    assert.equal(puzzle.cells.length, 0);
    assert.equal(game.status, 'won');
  }
});

slowRealTest('a shared seed rebuilds the same real puzzle', 'no real data', () => {
  // The seed in a share link is the whole payload: whatever the recipient's
  // device does, it has to land on the identical board. This is the full
  // production path — real vocabulary, real restart count, no FAST shortcuts —
  // because that is where a wall-clock budget used to cut the search short at
  // a different point on every load.
  for (const seed of [3977333653, 42]) {
    const build = () => gen.generatePuzzle({
      seed: seed,
      words: realData.LETTER_MELT_COMMON,
      longWords: realData.LETTER_MELT_BASE,
      lexicon: realData.lexicon,
      familiar: realData.LETTER_MELT_FAMILIAR,
      mode: 'hard'
    });
    const a = build();
    const b = build();
    assert.ok(a && b, 'generation failed for seed ' + seed);
    assert.equal(a.seed, seed);
    assert.deepEqual(a.words.map(w => w.text), b.words.map(w => w.text),
      'seed ' + seed + ' built two different word sets');
    assert.deepEqual(
      a.cells.map(c => c.letter + '@' + c.x + ',' + c.y),
      b.cells.map(c => c.letter + '@' + c.x + ',' + c.y),
      'seed ' + seed + ' built two different layouts');
    assert.deepEqual(a.edges.map(e => e.a + '-' + e.b), b.edges.map(e => e.a + '-' + e.b),
      'seed ' + seed + ' built two different connection sets');
  }
});

slowRealTest('real-data generation stays inside the time budget', 'no real data', () => {
  const times = [];
  const counts = [];
  const cells = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const puzzle = gen.generatePuzzle({
      rng: gen.createRng(3000000 + i),
      words: realData.LETTER_MELT_COMMON,
      longWords: realData.LETTER_MELT_BASE,
      lexicon: realData.lexicon,
      familiar: realData.LETTER_MELT_FAMILIAR,
      mode: 'hard'
    });
    times.push(Date.now() - start);
    assert.ok(puzzle, 'generation failed');
    counts.push(puzzle.words.length);
    cells.push(puzzle.cells.length);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  // Generation has no wall-clock governor — the restart count is the budget —
  // so this guards the cost of a full run rather than enforcing it.
  assert.ok(median < 400, 'median generation ' + median + 'ms is too slow to feel instant');
  // ...and the reason it has no governor: a deadline makes the board depend on
  // how fast the device happened to be, which breaks shared links.
  assert.equal(gen.CONFIG.timeBudgetMs, undefined, 'the generator must not be wall-clock bounded');
  assert.ok(Math.min(...counts) >= 10 && Math.max(...counts) <= 16,
    'word counts outside 10-16: ' + Math.min(...counts) + '-' + Math.max(...counts));
  assert.ok(Math.min(...cells) >= gen.CONFIG.minCells,
    'board sparser than minCells: ' + Math.min(...cells));
  assert.ok(Math.max(...cells) <= gen.CONFIG.size * gen.CONFIG.size,
    'board exceeded the grid: ' + Math.max(...cells));
  // Gaps are the point of relaxing the fill rule: real boards must actually
  // vary in silhouette rather than all arriving as a solid 4 x 4.
  assert.ok(new Set(cells).size >= 2,
    'cell counts barely varied: ' + Array.from(new Set(cells)).sort((a, b) => a - b).join(','));
});
