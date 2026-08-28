import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import postgres from 'npm:postgres@3.4.7';
import { applyClaimedWord, claimedElapsedMs, createPuzzle, hydrateGame, serializeGame, validateTrace, Engine } from '../_shared/game_runtime.js';
import '../../../js/history.js';

const puzzleHeadline = globalThis.LetterMeltHistory.puzzleHeadline;
const scorePoints = globalThis.LetterMeltHistory.scorePoints;
const multiplayerScore = globalThis.LetterMeltHistory.multiplayerScore;
const dailyDateKey = globalThis.LetterMeltHistory.dailyDateKey;
const previousDateKey = globalThis.LetterMeltHistory.previousDateKey;
const streakStatsByMode = globalThis.LetterMeltHistory.streakStatsByMode;
const streakStats = globalThis.LetterMeltHistory.streakStats;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DATABASE_URL = Deno.env.get('LETTER_MELT_DB_URL') || Deno.env.get('SUPABASE_DB_URL');
const SITE_ORIGINS = new Set((Deno.env.get('SITE_ORIGINS') || 'http://localhost:5174,https://lettermelt.vercel.app,https://www.lettermelt.com,https://lettermelt.com')
  .split(',').map(value => value.trim()).filter(Boolean));
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const db = postgres(DATABASE_URL, { prepare: false, max: 3, idle_timeout: 20 });

function cors(request) {
  const origin = request.headers.get('origin') || '';
  return {
    'access-control-allow-origin': SITE_ORIGINS.has(origin) ? origin : 'null',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin'
  };
}

function reply(request, status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, cors(request))
  });
}

function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= 24 ? name : null;
}

function uuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function token(bytes = 24) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function shortCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

async function caller(request) {
  const auth = request.headers.get('authorization') || '';
  const accessToken = auth.replace(/^Bearer\s+/i, '');
  if (!accessToken) return null;
  const { data, error } = await admin.auth.getUser(accessToken);
  return error ? null : data.user;
}

async function broadcast(sql, roomId, event, payload) {
  try {
    await sql`select realtime.send(${sql.json(payload)}, ${event}, ${'room:' + roomId}, true)`;
  } catch (error) {
    // Realtime is an accelerator, not the source of truth. A temporary
    // outage must not roll back a committed room state or reject a find.
    console.error('realtime broadcast failed', event, error?.message || error);
  }
}

async function transactionWithBroadcasts(work) {
  const queued = [];
  const result = await db.begin(sql => work(sql, (roomId, event, payload) => {
    queued.push({
      roomId, event,
      payload: payload && typeof payload === 'object' ? Object.assign({}, payload) : payload
    });
  }));
  if (!queued.length) return result;
  const publishing = queued.reduce(
    (promise, item) => promise.then(() => broadcast(db, item.roomId, item.event, item.payload)),
    Promise.resolve()
  );
  if (typeof globalThis.EdgeRuntime?.waitUntil === 'function') globalThis.EdgeRuntime.waitUntil(publishing);
  else await publishing;
  return result;
}

async function profileFor(sql, userId) {
  const rows = await sql`select display_name from public.profiles where user_id = ${userId}`;
  return rows[0]?.display_name || 'Player';
}

async function publicProfileFor(sql, username) {
  const rows = await sql`
    select user_id, username, display_name, account_score,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'mode', streak.mode,
          'current_streak', streak.current_streak,
          'longest_streak', streak.longest_streak,
          'last_daily_date', streak.last_daily_date
        ))
        from public.account_daily_streaks streak
        where streak.user_id = profiles.user_id
      ), '[]'::jsonb) as streak_rows
    from public.profiles profiles where profiles.username = ${username}
  `;
  return rows[0] || null;
}

function dateKey(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return match ? match[1] : null;
}

function streaksFromAccountRows(rows) {
  const today = dailyDateKey();
  const yesterday = previousDateKey(today);
  let current = 0;
  let longest = 0;
  for (const row of rows) {
    const lastDate = dateKey(row.last_daily_date);
    const active = lastDate === today || lastDate === yesterday;
    if (active) current = Math.max(current, Number(row.current_streak) || 0);
    longest = Math.max(longest, Number(row.longest_streak) || 0);
  }
  return { current, longest };
}

function parseStreakRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) { return []; }
}

async function profileStreaks(sql, userId) {
  const rows = await sql`
    select mode, current_streak, longest_streak, last_daily_date
    from public.account_daily_streaks
    where user_id = ${userId}
  `;
  if (rows.length) return streaksFromAccountRows(rows);
  const results = await sql`
    select mode, daily_date, status
    from public.game_results
    where user_id = ${userId} and daily_date is not null
  `;
  return streakStats(results);
}

async function refreshProfileStreaks(sql, userId) {
  const results = await sql`
    select mode, daily_date, status
    from public.game_results
    where user_id = ${userId} and daily_date is not null
  `;
  const byMode = streakStatsByMode(results, dailyDateKey());
  const easy = byMode.easy;
  const hard = byMode.hard;
  await sql`
    insert into public.account_daily_streaks(
      user_id, mode, current_streak, longest_streak, last_daily_date
    ) values
      (${userId}, ${'easy'}, ${easy.current}, ${easy.longest}, ${easy.latestDate}),
      (${userId}, ${'hard'}, ${hard.current}, ${hard.longest}, ${hard.latestDate})
    on conflict (user_id, mode) do update set
      current_streak = excluded.current_streak,
      longest_streak = excluded.longest_streak,
      last_daily_date = excluded.last_daily_date,
      updated_at = now()
  `;
  return streaksFromAccountRows([
    { current_streak: byMode.easy.current, longest_streak: byMode.easy.longest, last_daily_date: byMode.easy.latestDate },
    { current_streak: byMode.hard.current, longest_streak: byMode.hard.longest, last_daily_date: byMode.hard.latestDate }
  ]);
}

async function publicProfile(body) {
  const username = String(body.username || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(username)) {
    throw Object.assign(new Error('Profile not found'), { status: 404 });
  }
  const profile = await publicProfileFor(db, username);
  if (!profile) throw Object.assign(new Error('Profile not found'), { status: 404 });
  const savedStreaks = parseStreakRows(profile.streak_rows);
  const streaks = streaksFromAccountRows(savedStreaks);
  const limit = Math.min(50, Math.max(1, Math.round(Number(body.limit) || 10)));
  const offset = Math.max(0, Math.round(Number(body.offset) || 0));
  const rows = await db`
    select source, mode, main_word, daily_date, status, elapsed_ms, stars, points,
      jsonb_array_length(found_words) as word_count, created_at
    from public.game_results
    where user_id = ${profile.user_id}
    order by created_at desc, id desc
    limit ${limit + 1} offset ${offset}
  `;
  const results = rows.slice(0, limit);
  return {
    username: profile.username,
    displayName: profile.display_name,
    accountScore: Number(profile.account_score) || 0,
    streaks,
    results,
    hasMore: rows.length > limit,
    nextOffset: offset + results.length
  };
}

// Profile reads include the durable account score so clients never need to
// reconstruct it from a partial, paginated history response.

async function roomPlayers(sql, roomId) {
  return sql`
    select p.slot, p.user_id, p.display_name, p.joined_at,
      coalesce(profile.account_score, 0)::int as account_score
    from public.room_players p
    left join public.profiles profile on profile.user_id = p.user_id
    where p.room_id = ${roomId}
    order by p.slot
  `;
}

async function roomSnapshot(sql, roomId, userId) {
  const rooms = await sql`
    select r.*,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'slot', player.slot,
          'user_id', player.user_id,
          'display_name', player.display_name,
          'joined_at', player.joined_at,
          'account_score', coalesce(profile.account_score, 0)::int
        ) order by player.slot)
        from public.room_players player
        left join public.profiles profile on profile.user_id = player.user_id
        where player.room_id = r.id
      ), '[]'::jsonb) as players,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sequence', room_find.sequence,
          'user_id', room_find.user_id,
          'display_name', room_find.display_name,
          'word', room_find.word,
          'kind', room_find.kind,
          'trace_ids', room_find.trace_ids,
          'elapsed_ms', room_find.elapsed_ms,
          'credited_ms', room_find.credited_ms
        ) order by room_find.sequence)
        from public.room_finds room_find
        where room_find.room_id = r.id
      ), '[]'::jsonb) as finds
    from public.rooms r
    join public.room_players viewer on viewer.room_id = r.id
    where r.id = ${roomId} and viewer.user_id = ${userId}
  `;
  if (!rooms.length) return null;
  const room = rooms[0];
  return {
    room: {
      id: room.id,
      mode: room.mode,
      seed: Number(room.seed),
      formatVersion: room.format_version,
      status: room.status,
      openingPuzzle: room.opening_puzzle,
      state: room.state,
      stateVersion: Number(room.state_version),
      savedMs: room.saved_ms,
      pausedAt: room.paused_at,
      pausedMs: Number(room.paused_ms) || 0,
      countdownAt: room.countdown_at,
      startedAt: room.started_at,
      finishedAt: room.finished_at,
      finalElapsedMs: room.final_elapsed_ms,
      shortCode: room.short_code
    },
    players: parseJsonArray(room.players),
    finds: parseJsonArray(room.finds),
    serverNow: Date.now()
  };
}

async function createRoom(user, body) {
  const mode = body.mode === 'hard' ? 'hard' : 'easy';
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const puzzle = createPuzzle(mode, seed);
  const inviteToken = token();
  const inviteHash = await sha256(inviteToken);
  const state = { puzzle, foundWords: [], foundWordTimes: [], extraWords: [] };
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = shortCode();
    try {
      const result = await db.begin(async sql => {
        const name = cleanName(body.displayName) || await profileFor(sql, user.id);
        const rows = await sql`
          insert into public.rooms(mode, seed, opening_puzzle, state, invite_hash, short_code, created_by)
          values (${mode}, ${seed}, ${sql.json(puzzle)}, ${sql.json(state)}, ${inviteHash}, ${code}, ${user.id})
          returning id
        `;
        await sql`
          insert into public.room_players(room_id, user_id, slot, display_name)
          values (${rows[0].id}, ${user.id}, 1, ${name})
        `;
        return { roomId: rows[0].id, shortCode: code };
      });
      const snapshot = await roomSnapshot(db, result.roomId, user.id);
      return Object.assign(result, { inviteToken, snapshot });
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
  throw new Error('Could not allocate an invite code');
}

async function joinRoom(user, body) {
  const inviteHash = body.inviteToken ? await sha256(body.inviteToken) : null;
  const code = String(body.shortCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  return transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const rows = inviteHash
      ? await sql`select * from public.rooms where invite_hash = ${inviteHash} for update`
      : await sql`select * from public.rooms where short_code = ${code} for update`;
    if (!rows.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = rows[0];
    if (room.status !== 'waiting' && room.status !== 'countdown') {
      const mine = await sql`select 1 from public.room_players where room_id = ${room.id} and user_id = ${user.id}`;
      if (!mine.length) throw Object.assign(new Error('This game has already started'), { status: 409 });
      return roomSnapshot(sql, room.id, user.id);
    }
    const existing = await sql`select slot from public.room_players where room_id = ${room.id} and user_id = ${user.id}`;
    let playerCount = 0;
    if (!existing.length) {
      const count = await sql`select count(*)::int as count from public.room_players where room_id = ${room.id}`;
      if (count[0].count >= 2) throw Object.assign(new Error('Room full'), { status: 409 });
      const name = cleanName(body.displayName) || await profileFor(sql, user.id);
      await sql`insert into public.room_players(room_id, user_id, slot, display_name) values (${room.id}, ${user.id}, 2, ${name})`;
      playerCount = Number(count[0].count) + 1;
    } else {
      const count = await sql`select count(*)::int as count from public.room_players where room_id = ${room.id}`;
      playerCount = Number(count[0].count);
    }
    if (playerCount === 2 && room.status === 'waiting') {
      queueBroadcast(room.id, 'room_ready', { roomId: room.id, stateVersion: Number(room.state_version), serverNow: Date.now() });
    }
    return roomSnapshot(sql, room.id, user.id);
  });
}

async function startRoom(user, body) {
  if (!uuid(body.roomId)) throw Object.assign(new Error('Invalid room'), { status: 400 });
  const result = await transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const rows = await sql`select * from public.rooms where id = ${body.roomId} for update`;
    if (!rows.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = rows[0];
    const mine = await sql`select 1 from public.room_players where room_id = ${room.id} and user_id = ${user.id}`;
    if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
    if (room.status === 'playing' || room.status === 'countdown') {
      return { snapshot: await roomSnapshot(sql, room.id, user.id) };
    }
    if (room.status !== 'waiting') {
      throw Object.assign(new Error('This game has already finished'), { status: 409 });
    }
    const players = await sql`select count(*)::int as count from public.room_players where room_id = ${room.id}`;
    if (players[0].count < 2) {
      throw Object.assign(new Error('Waiting for your friend'), { status: 409 });
    }
    const startedAt = new Date();
    await sql`
      update public.rooms
      set status = 'playing', countdown_at = null, started_at = ${startedAt}
      where id = ${room.id}
    `;
    const event = {
      roomId: room.id,
      startedAt: startedAt.toISOString(),
      stateVersion: Number(room.state_version),
      status: 'playing',
      serverNow: Date.now()
    };
    queueBroadcast(room.id, 'room_started', event);
    return { event };
  });
  return result.snapshot || result.event;
}

async function finalize(sql, room, status, elapsedMs, queueBroadcast) {
  const nextVersion = Number(room.state_version) + 1;
  await sql`
    update public.rooms set status = ${status}, state_version = ${nextVersion},
      finished_at = now(), final_elapsed_ms = ${Math.round(elapsedMs)} where id = ${room.id}
  `;
  const players = await sql`select user_id from public.room_players where room_id = ${room.id} and user_id is not null`;
  const stars = status === 'won' ? Engine.starsFor(elapsedMs, Engine.scheduleFor(room.mode)) : 0;
  const finds = await sql`
    select user_id, word, elapsed_ms
    from public.room_finds
    where room_id = ${room.id} and user_id is not null
    order by sequence
  `;
  const findsByPlayer = new Map();
  for (const find of finds) {
    const list = findsByPlayer.get(find.user_id) || [];
    list.push({ word: find.word, elapsedMs: Number(find.elapsed_ms) || 0 });
    findsByPlayer.set(find.user_id, list);
  }
  const totalWords = finds.length;
  const mainWord = puzzleHeadline(room.opening_puzzle) || puzzleHeadline(room.state && room.state.puzzle);
  for (const player of players) {
    const foundWords = findsByPlayer.get(player.user_id) || [];
    const points = multiplayerScore(modeFor(room.mode), stars, foundWords.length, totalWords);
    await sql`
      insert into public.game_results(user_id, client_result_id, room_id, source, seed, mode, main_word, status, elapsed_ms, stars, points, found_words)
      values (${player.user_id}, ${crypto.randomUUID()}, ${room.id}, 'multiplayer', ${room.seed}, ${room.mode}, ${mainWord}, ${status}, ${Math.round(elapsedMs)}, ${stars}, ${points}, ${sql.json(foundWords)})
    `;
    await sql`
      insert into public.profiles as profile(user_id, account_score)
      values (${player.user_id}, ${points})
      on conflict (user_id) do update set
        account_score = profile.account_score + excluded.account_score,
        updated_at = now()
    `;
  }
  const scores = await roomPlayers(sql, room.id);
  const event = {
    roomId: room.id, status, elapsedMs: Math.round(elapsedMs), stars,
    stateVersion: nextVersion, players: scores
  };
  queueBroadcast(room.id, 'room_finished', Object.assign({ serverNow: Date.now() }, event));
  return event;
}

function modeFor(value) {
  return value === 'hard' ? 'hard' : 'easy';
}

async function submit(user, body) {
  if (!uuid(body.roomId) || !uuid(body.requestId)) throw Object.assign(new Error('Invalid submission'), { status: 400 });
  return transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const previous = await sql`
      select response from public.submission_receipts
      where room_id = ${body.roomId} and user_id = ${user.id} and request_id = ${body.requestId}
    `;
    if (previous.length) return previous[0].response;
    const rooms = await sql`select * from public.rooms where id = ${body.roomId} for update`;
    if (!rooms.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = rooms[0];
    const players = await sql`select display_name from public.room_players where room_id = ${room.id} and user_id = ${user.id}`;
    if (!players.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
    const now = Date.now();
    if (!room.started_at || now < new Date(room.started_at).getTime()) {
      throw Object.assign(new Error('The game has not started'), { status: 409 });
    }
    if (room.status === 'won' || room.status === 'lost') return { type: 'inactive', stateVersion: Number(room.state_version) };
    const game = hydrateGame(room, now);
    const serverElapsed = game.elapsedMs;
    const claimedMs = claimedElapsedMs(game, body.elapsedMs);
    const ids = Array.isArray(body.traceIds) ? body.traceIds.map(Number) : [];
    const claimedWord = String(body.word || '').toLowerCase().replace(/[^a-z]/g, '');
    const word = claimedWord || validateTrace(game, ids) || '';
    if (!word) {
      const response = { type: 'invalid-trace', word: '', stateVersion: Number(room.state_version) };
      await sql`
        insert into public.submission_receipts(room_id, user_id, request_id, response)
        values (${room.id}, ${user.id}, ${body.requestId}, ${sql.json(response)})
      `;
      return response;
    }

    const existing = await sql`
      select sequence, user_id, display_name, word, kind, elapsed_ms, credited_ms, trace_ids
      from public.room_finds where room_id = ${room.id} and word = ${word}
    `;
    if (existing.length) {
      const prev = existing[0];
      if (claimedMs >= Number(prev.elapsed_ms)) {
        const response = {
          type: prev.kind === 'required' ? 'repeat-required' : 'repeat-extra',
          word, kind: prev.kind, finderId: prev.user_id, displayName: prev.display_name,
          sequence: Number(prev.sequence), elapsedMs: Number(prev.elapsed_ms), foundAtMs: Number(prev.elapsed_ms),
          timeSaved: Number(prev.credited_ms) || 0, traceIds: prev.trace_ids || [],
          stateVersion: Number(room.state_version), status: room.status, serverNow: now
        };
        await sql`
          insert into public.submission_receipts(room_id, user_id, request_id, response)
          values (${room.id}, ${user.id}, ${body.requestId}, ${sql.json(response)})
        `;
        return response;
      }
      const nextVersion = Number(room.state_version) + 1;
      await sql`
        update public.room_finds
        set user_id = ${user.id}, display_name = ${players[0].display_name},
            trace_ids = ${sql.json(ids)}, elapsed_ms = ${claimedMs}
        where room_id = ${room.id} and word = ${word} and elapsed_ms > ${claimedMs}
      `;
      await sql`update public.rooms set state_version = ${nextVersion} where id = ${room.id}`;
      const response = {
        type: prev.kind === 'required' ? 'required' : 'extra',
        word, kind: prev.kind, finderId: user.id, displayName: players[0].display_name,
        sequence: Number(prev.sequence), elapsedMs: claimedMs, foundAtMs: claimedMs,
        timeSaved: Number(prev.credited_ms) || 0, traceIds: ids, stolen: true,
        stateVersion: nextVersion, savedMs: Number(room.saved_ms) || 0,
        status: room.status, serverNow: now
      };
      queueBroadcast(room.id, 'word_accepted', response);
      await sql`
        insert into public.submission_receipts(room_id, user_id, request_id, response)
        values (${room.id}, ${user.id}, ${body.requestId}, ${sql.json(response)})
      `;
      return response;
    }

    const result = applyClaimedWord(game, word, claimedMs);
    let response = { type: result.type, word: result.word || word, stateVersion: Number(room.state_version) };
    if (result.type === 'required' || result.type === 'extra') {
      const kind = result.type === 'required' ? 'required' : 'bonus';
      const nextVersion = Number(room.state_version) + 1;
      const creditedMs = Number(result.timeSaved) || 0;
      const sequenceRows = await sql`select coalesce(max(sequence), 0)::bigint + 1 as sequence from public.room_finds where room_id = ${room.id}`;
      const sequence = Number(sequenceRows[0].sequence);
      await sql`
        insert into public.room_finds(room_id, sequence, user_id, display_name, word, kind, trace_ids, elapsed_ms, credited_ms)
        values (${room.id}, ${sequence}, ${user.id}, ${players[0].display_name}, ${result.word}, ${kind}, ${sql.json(ids)}, ${claimedMs}, ${creditedMs})
      `;
      await sql`
        update public.rooms set status = ${game.status === 'won' ? 'won' : 'playing'}, state = ${sql.json(serializeGame(game))},
          state_version = ${nextVersion}, saved_ms = saved_ms + ${creditedMs},
          finished_at = ${game.status === 'won' ? new Date() : null},
          final_elapsed_ms = ${game.status === 'won' ? Math.round(game.elapsedMs) : null}
        where id = ${room.id}
      `;
      response = Object.assign({}, result, {
        kind, finderId: user.id, displayName: players[0].display_name, sequence,
        elapsedMs: claimedMs, foundAtMs: claimedMs, traceIds: ids,
        stateVersion: nextVersion, state: serializeGame(game), savedMs: Number(room.saved_ms) + creditedMs,
        status: game.status, serverNow: now
      });
      queueBroadcast(room.id, 'word_accepted', response);
      if (game.status === 'won') {
        const finishedRoom = Object.assign({}, room, { state_version: nextVersion });
        const finished = await finalize(sql, finishedRoom, 'won', game.elapsedMs, queueBroadcast);
        response.stateVersion = finished.stateVersion;
        response.players = finished.players;
      } else if (serverElapsed >= game.schedule.failMs) {
        const finishedRoom = Object.assign({}, room, { state_version: nextVersion });
        const finished = await finalize(sql, finishedRoom, 'lost', game.schedule.failMs, queueBroadcast);
        response.status = 'lost';
        response.stateVersion = finished.stateVersion;
        response.players = finished.players;
      }
    } else if (serverElapsed >= game.schedule.failMs) {
      return finalize(sql, room, 'lost', game.schedule.failMs, queueBroadcast);
    }
    await sql`
      insert into public.submission_receipts(room_id, user_id, request_id, response)
      values (${room.id}, ${user.id}, ${body.requestId}, ${sql.json(response)})
    `;
    return response;
  });
}

async function syncHistory(user, body) {
  const records = Array.isArray(body.records) ? body.records.slice(0, 500) : [];
  return db.begin(async sql => {
    const daily = new Map();
    const regular = new Map();
    for (const record of records) {
      if (!uuid(record.clientResultId) || record.source === 'multiplayer') continue;
      const mode = modeFor(record.mode);
      const status = record.status === 'won' ? 'won' : 'lost';
      const elapsedMs = Math.max(0, Math.round(Number(record.elapsedMs) || 0));
      const stars = Math.max(0, Math.min(5, Math.round(Number(record.stars) || 0)));
      const points = status === 'won' ? scorePoints(mode, stars) : 0;
      const foundWords = Array.isArray(record.foundWords) ? record.foundWords : [];
      const date = /^\d{4}-\d{2}-\d{2}$/.test(record.dailyDate || '') ? record.dailyDate : null;
      const row = {
        client_result_id: record.clientResultId,
        seed: Number(record.seed) >>> 0,
        mode,
        main_word: typeof record.mainWord === 'string' ? record.mainWord : null,
        daily_date: date,
        status,
        elapsed_ms: elapsedMs,
        stars,
        points,
        found_words: foundWords
      };
      if (date) {
        daily.set(date + ':' + mode, row);
      } else {
        regular.set(record.clientResultId, row);
      }
    }

    const dailyRows = Array.from(daily.values());
    const regularRows = Array.from(regular.values());
    if (!dailyRows.length && !regularRows.length) return { saved: 0 };
    if (dailyRows.length) {
      await sql`
        insert into public.game_results(
          user_id, client_result_id, source, seed, mode, main_word, daily_date,
          status, elapsed_ms, stars, points, found_words
        )
        select ${user.id}, incoming.client_result_id, 'local', incoming.seed, incoming.mode,
          incoming.main_word, incoming.daily_date, incoming.status, incoming.elapsed_ms,
          incoming.stars, incoming.points, incoming.found_words
        from jsonb_to_recordset(${sql.json(dailyRows)}::jsonb) as incoming(
          client_result_id uuid, seed bigint, mode text, main_word text,
          daily_date date, status text, elapsed_ms integer, stars smallint,
          points integer, found_words jsonb
        )
        on conflict (user_id, daily_date, mode) where daily_date is not null do update set
          client_result_id = excluded.client_result_id,
          seed = excluded.seed,
          main_word = excluded.main_word,
          status = excluded.status,
          elapsed_ms = excluded.elapsed_ms,
          stars = excluded.stars,
          points = excluded.points,
          found_words = excluded.found_words
      `;
    }
    if (regularRows.length) {
      await sql`
        insert into public.game_results(
          user_id, client_result_id, source, seed, mode, main_word,
          status, elapsed_ms, stars, points, found_words
        )
        select ${user.id}, incoming.client_result_id, 'local', incoming.seed, incoming.mode,
          incoming.main_word, incoming.status, incoming.elapsed_ms, incoming.stars,
          incoming.points, incoming.found_words
        from jsonb_to_recordset(${sql.json(regularRows)}::jsonb) as incoming(
          client_result_id uuid, seed bigint, mode text, main_word text,
          daily_date date, status text, elapsed_ms integer, stars smallint,
          points integer, found_words jsonb
        )
        on conflict (user_id, client_result_id) do update set
          seed = excluded.seed,
          mode = excluded.mode,
          main_word = coalesce(public.game_results.main_word, excluded.main_word),
          status = excluded.status,
          elapsed_ms = excluded.elapsed_ms,
          stars = excluded.stars,
          points = excluded.points,
          found_words = excluded.found_words
      `;
    }
    const scoreRows = await sql`
      insert into public.profiles as profile(user_id, account_score)
      values (
        ${user.id}, coalesce((
          select sum(points)::integer from public.game_results
          where user_id = ${user.id}
        ), 0)
      )
      on conflict (user_id) do update set
        account_score = excluded.account_score,
        updated_at = now()
      returning account_score
    `;
    const streaks = await refreshProfileStreaks(sql, user.id);
    return {
      saved: dailyRows.length + regularRows.length,
      accountScore: Number(scoreRows[0]?.account_score) || 0,
      streaks
    };
  });
}

async function heartbeat(user, roomId) {
  if (!uuid(roomId)) throw Object.assign(new Error('Invalid room'), { status: 400 });
  return transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const rooms = await sql`select * from public.rooms where id = ${roomId} for update`;
    if (!rooms.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = rooms[0];
    const mine = await sql`select 1 from public.room_players where room_id = ${roomId} and user_id = ${user.id}`;
    if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
    if (room.status === 'won' || room.status === 'lost') {
      return { status: room.status, elapsedMs: room.final_elapsed_ms, stateVersion: Number(room.state_version) };
    }
    if (!room.started_at || Date.now() < new Date(room.started_at).getTime()) {
      return { status: room.status, stateVersion: Number(room.state_version), serverNow: Date.now() };
    }
    const game = hydrateGame(room, Date.now());
    if (room.paused_at) {
      return {
        status: 'paused', elapsedMs: Math.round(game.elapsedMs), stateVersion: Number(room.state_version),
        serverNow: Date.now(), pausedAt: room.paused_at, pausedMs: Number(room.paused_ms) || 0
      };
    }
    if (game.elapsedMs >= game.schedule.failMs) return finalize(sql, room, 'lost', game.schedule.failMs, queueBroadcast);
    return { status: 'playing', elapsedMs: Math.round(game.elapsedMs), stateVersion: Number(room.state_version), serverNow: Date.now() };
  });
}

async function pauseGame(user, body) {
  if (!uuid(body.roomId)) throw Object.assign(new Error('Invalid room'), { status: 400 });
  return transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const rooms = await sql`select * from public.rooms where id = ${body.roomId} for update`;
    if (!rooms.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = rooms[0];
    const mine = await sql`select 1 from public.room_players where room_id = ${room.id} and user_id = ${user.id}`;
    if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
    if (room.status === 'won' || room.status === 'lost' || !room.started_at ||
        Date.now() < new Date(room.started_at).getTime() || room.paused_at) {
      return roomSnapshot(sql, room.id, user.id);
    }
    await sql`update public.rooms set paused_at = now() where id = ${room.id} and paused_at is null`;
    const snapshot = await roomSnapshot(sql, room.id, user.id);
    queueBroadcast(room.id, 'room_paused', {
      roomId: room.id, status: snapshot.room.status, stateVersion: snapshot.room.stateVersion,
      pausedAt: snapshot.room.pausedAt, pausedMs: snapshot.room.pausedMs, serverNow: Date.now()
    });
    return snapshot;
  });
}

async function resumeGame(user, body) {
  if (!uuid(body.roomId)) throw Object.assign(new Error('Invalid room'), { status: 400 });
  return transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const rooms = await sql`select * from public.rooms where id = ${body.roomId} for update`;
    if (!rooms.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = rooms[0];
    const mine = await sql`select 1 from public.room_players where room_id = ${room.id} and user_id = ${user.id}`;
    if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
    if (!room.paused_at) return roomSnapshot(sql, room.id, user.id);
    await sql`
      update public.rooms
      set paused_ms = paused_ms + floor(extract(epoch from (now() - paused_at)) * 1000)::integer,
          paused_at = null
      where id = ${room.id} and paused_at is not null
    `;
    const snapshot = await roomSnapshot(sql, room.id, user.id);
    queueBroadcast(room.id, 'room_resumed', {
      roomId: room.id, status: snapshot.room.status, stateVersion: snapshot.room.stateVersion,
      pausedAt: null, pausedMs: snapshot.room.pausedMs, serverNow: Date.now()
    });
    return snapshot;
  });
}

async function prepareMerge(user) {
  const mergeToken = token(32);
  const hash = await sha256(mergeToken);
  await db`
    insert into public.account_merges(token_hash, source_user_id)
    values (${hash}, ${user.id})
    on conflict (token_hash) do nothing
  `;
  return { mergeToken };
}

async function completeMerge(user, mergeToken) {
  const hash = await sha256(mergeToken || '');
  const sourceId = await db.begin(async sql => {
    const rows = await sql`
      select source_user_id from public.account_merges
      where token_hash = ${hash} and expires_at > now() for update
    `;
    if (!rows.length) throw Object.assign(new Error('This account merge has expired'), { status: 410 });
    const source = rows[0].source_user_id;
    if (source === user.id) {
      await sql`delete from public.account_merges where token_hash = ${hash}`;
      return null;
    }
    const sourceProfile = await sql`select display_name from public.profiles where user_id = ${source}`;
    const targetProfile = await sql`select display_name from public.profiles where user_id = ${user.id}`;
    if (sourceProfile.length && (!targetProfile.length || targetProfile[0].display_name === 'Player')) {
      await sql`update public.profiles set display_name = ${sourceProfile[0].display_name}, updated_at = now() where user_id = ${user.id}`;
    }
    await sql`
      delete from public.room_players source
      using public.room_players target
      where source.user_id = ${source} and target.user_id = ${user.id} and source.room_id = target.room_id
    `;
    await sql`update public.room_players set user_id = ${user.id} where user_id = ${source}`;
    await sql`update public.room_finds set user_id = ${user.id} where user_id = ${source}`;
    await sql`update public.rooms set created_by = ${user.id} where created_by = ${source}`;
    await sql`
      delete from public.game_results source
      using public.game_results target
      where source.user_id = ${source} and target.user_id = ${user.id}
        and (source.client_result_id = target.client_result_id or
          (source.daily_date is not null and source.daily_date = target.daily_date and source.mode = target.mode))
    `;
    await sql`update public.game_results set user_id = ${user.id} where user_id = ${source}`;
    await sql`
      update public.profiles target
      set account_score = coalesce((
        select sum(result.points)::integer
        from public.game_results result
        where result.user_id = target.user_id
      ), 0), updated_at = now()
      where target.user_id = ${user.id}
    `;
    await refreshProfileStreaks(sql, user.id);
    await sql`delete from public.submission_receipts where user_id = ${source}`;
    await sql`delete from public.account_merges where token_hash = ${hash}`;
    return source;
  });
  if (sourceId) {
    const { error } = await admin.auth.admin.deleteUser(sourceId);
    if (error) console.error('merged guest cleanup failed', error);
  }
  return { merged: true };
}

async function rematch(user, body) {
  if (!uuid(body.roomId)) throw Object.assign(new Error('Invalid room'), { status: 400 });
  const rooms = await db`select mode, status from public.rooms where id = ${body.roomId}`;
  if (!rooms.length) throw Object.assign(new Error('Room not found'), { status: 404 });
  const current = rooms[0];
  const mine = await db`select 1 from public.room_players where room_id = ${body.roomId} and user_id = ${user.id}`;
  if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
  if (current.status === 'countdown' || current.status === 'playing') {
    return roomSnapshot(db, body.roomId, user.id);
  }
  if (current.status !== 'won' && current.status !== 'lost') {
    throw Object.assign(new Error('Finish the current game first'), { status: 409 });
  }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const puzzle = createPuzzle(current.mode, seed);
  const state = { puzzle, foundWords: [], foundWordTimes: [], extraWords: [] };
  return transactionWithBroadcasts(async (sql, queueBroadcast) => {
    const locked = await sql`select * from public.rooms where id = ${body.roomId} for update`;
    if (!locked.length) throw Object.assign(new Error('Room not found'), { status: 404 });
    const room = locked[0];
    const players = await sql`select count(*)::int as count from public.room_players where room_id = ${room.id}`;
    if (players[0].count < 2) throw Object.assign(new Error('Your friend has left'), { status: 409 });
    if (room.status === 'countdown' || room.status === 'playing') {
      return roomSnapshot(sql, room.id, user.id);
    }
    if (room.status !== 'won' && room.status !== 'lost') {
      throw Object.assign(new Error('Finish the current game first'), { status: 409 });
    }
    const nextVersion = Number(room.state_version) + 1;
    await sql`delete from public.room_finds where room_id = ${room.id}`;
    await sql`delete from public.submission_receipts where room_id = ${room.id}`;
    await sql`
      update public.rooms set
        seed = ${seed},
        opening_puzzle = ${sql.json(puzzle)},
        state = ${sql.json(state)},
        state_version = ${nextVersion},
        status = 'waiting',
        saved_ms = 0,
        countdown_at = null,
        started_at = null,
        finished_at = null,
        final_elapsed_ms = null,
        expires_at = now() + interval '24 hours'
      where id = ${room.id}
    `;
    queueBroadcast(room.id, 'rematch', {
      roomId: room.id,
      stateVersion: nextVersion,
      status: 'waiting',
      serverNow: Date.now()
    });
    return roomSnapshot(sql, room.id, user.id);
  });
}

async function dispatch(user, body) {
  switch (body.action) {
    case 'profile': {
      if (body.read === true) {
        const profile = await db`
          select display_name, username, account_score,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'mode', streak.mode,
                'current_streak', streak.current_streak,
                'longest_streak', streak.longest_streak,
                'last_daily_date', streak.last_daily_date
              ))
              from public.account_daily_streaks streak
              where streak.user_id = profiles.user_id
            ), '[]'::jsonb) as streak_rows
          from public.profiles profiles
          where profiles.user_id = ${user.id}
        `;
        const savedStreaks = parseStreakRows(profile[0]?.streak_rows);
        const streaks = streaksFromAccountRows(savedStreaks);
        return {
          displayName: profile[0]?.display_name || 'Player',
          username: profile[0]?.username || null,
          accountScore: Number(profile[0]?.account_score) || 0,
          streaks
        };
      }
      const name = cleanName(body.displayName);
      if (!name) throw Object.assign(new Error('Use a name between 1 and 24 characters'), { status: 400 });
      await db`
        insert into public.profiles(user_id, display_name)
        values (${user.id}, ${name})
        on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now()
      `;
      await db`update public.room_players set display_name = ${name} where user_id = ${user.id}`;
      return { displayName: name };
    }
    case 'streaks': return profileStreaks(db, user.id);
    case 'create_room': return createRoom(user, body);
    case 'join_room': return joinRoom(user, body);
    case 'start_room': return startRoom(user, body);
    case 'rematch': return rematch(user, body);
    case 'snapshot': return roomSnapshot(db, body.roomId, user.id);
    case 'submit': return submit(user, body);
    case 'heartbeat': return heartbeat(user, body.roomId);
    case 'pause': return pauseGame(user, body);
    case 'resume': return resumeGame(user, body);
    case 'sync_history': return syncHistory(user, body);
    case 'history': {
      const limit = Math.min(50, Math.max(1, Math.round(Number(body.limit) || 10)));
      const offset = Math.max(0, Math.round(Number(body.offset) || 0));
      const rows = await db`
        select source, seed, mode, main_word, daily_date, status, elapsed_ms, stars, points,
          jsonb_array_length(found_words) as word_count, client_result_id, created_at
        from public.game_results
        where user_id = ${user.id}
        order by created_at desc, id desc
        limit ${limit + 1} offset ${offset}
      `;
      const results = rows.slice(0, limit);
      return {
        results,
        hasMore: rows.length > limit,
        nextOffset: offset + results.length
      };
    }
    case 'prepare_merge': return prepareMerge(user);
    case 'complete_merge': return completeMerge(user, body.mergeToken);
    case 'cancel_countdown': {
      await transactionWithBroadcasts(async (sql, queueBroadcast) => {
        const rows = await sql`select * from public.rooms where id = ${body.roomId} for update`;
        if (!rows.length) return;
        const mine = await sql`select 1 from public.room_players where room_id = ${body.roomId} and user_id = ${user.id}`;
        if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
        if (rows[0].status !== 'countdown' || Date.now() >= new Date(rows[0].started_at).getTime()) return;
        await sql`update public.rooms set status = 'waiting', countdown_at = null, started_at = null where id = ${body.roomId}`;
        queueBroadcast(body.roomId, 'room_reset', {
          roomId: body.roomId, status: 'waiting', stateVersion: Number(rows[0].state_version), serverNow: Date.now()
        });
      });
      return { ok: true };
    }
    case 'delete_account': {
      await db.begin(async sql => {
        await sql`update public.room_players set display_name = 'Former player' where user_id = ${user.id}`;
        await sql`update public.room_finds set display_name = 'Former player' where user_id = ${user.id}`;
      });
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw error;
      return { deleted: true };
    }
    default: throw Object.assign(new Error('Unknown action'), { status: 400 });
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return reply(request, 405, { error: 'Method not allowed' });
  const origin = request.headers.get('origin') || '';
  if (origin && !SITE_ORIGINS.has(origin)) return reply(request, 403, { error: 'Origin not allowed' });
  try {
    const body = await request.json();
    if (body?.action === 'public_profile') return reply(request, 200, { data: await publicProfile(body) });
    const user = await caller(request);
    if (!user) return reply(request, 401, { error: 'Authentication required' });
    return reply(request, 200, { data: await dispatch(user, body || {}) });
  } catch (error) {
    console.error(error);
    return reply(request, error.status || 500, { error: error.message || 'Request failed' });
  }
});
