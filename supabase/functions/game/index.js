import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import postgres from 'npm:postgres@3.4.7';
import { createPuzzle, hydrateGame, serializeGame, validateTrace, Engine } from '../_shared/game_runtime.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DATABASE_URL = Deno.env.get('LETTER_MELT_DB_URL') || Deno.env.get('SUPABASE_DB_URL');
const SITE_ORIGINS = new Set((Deno.env.get('SITE_ORIGINS') || 'http://localhost:5174,https://lettermelt.vercel.app')
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
  await sql`select realtime.send(${sql.json(payload)}, ${event}, ${'room:' + roomId}, true)`;
}

async function profileFor(sql, userId) {
  const rows = await sql`select display_name from public.profiles where user_id = ${userId}`;
  return rows[0]?.display_name || 'Player';
}

async function roomSnapshot(sql, roomId, userId) {
  const rooms = await sql`
    select r.* from public.rooms r
    join public.room_players p on p.room_id = r.id
    where r.id = ${roomId} and p.user_id = ${userId}
  `;
  if (!rooms.length) return null;
  const players = await sql`
    select slot, user_id, display_name, joined_at from public.room_players
    where room_id = ${roomId} order by slot
  `;
  const finds = await sql`
    select sequence, user_id, display_name, word, kind, trace_ids, elapsed_ms, credited_ms
    from public.room_finds where room_id = ${roomId} order by sequence
  `;
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
      countdownAt: room.countdown_at,
      startedAt: room.started_at,
      finishedAt: room.finished_at,
      finalElapsedMs: room.final_elapsed_ms,
      shortCode: room.short_code
    },
    players,
    finds,
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
        const name = await profileFor(sql, user.id);
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
      return Object.assign(result, { inviteToken });
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
  throw new Error('Could not allocate an invite code');
}

async function joinRoom(user, body) {
  const inviteHash = body.inviteToken ? await sha256(body.inviteToken) : null;
  const code = String(body.shortCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  return db.begin(async sql => {
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
    if (!existing.length) {
      const count = await sql`select count(*)::int as count from public.room_players where room_id = ${room.id}`;
      if (count[0].count >= 2) throw Object.assign(new Error('Room full'), { status: 409 });
      const name = await profileFor(sql, user.id);
      await sql`insert into public.room_players(room_id, user_id, slot, display_name) values (${room.id}, ${user.id}, 2, ${name})`;
    }
    const count = await sql`select count(*)::int as count from public.room_players where room_id = ${room.id}`;
    if (count[0].count === 2 && room.status === 'waiting') {
      const startedAt = new Date(Date.now() + 3000);
      await sql`update public.rooms set status = 'countdown', countdown_at = now(), started_at = ${startedAt} where id = ${room.id}`;
      await broadcast(sql, room.id, 'countdown', { roomId: room.id, startedAt: startedAt.toISOString(), stateVersion: Number(room.state_version) });
    }
    return roomSnapshot(sql, room.id, user.id);
  });
}

async function finalize(sql, room, status, elapsedMs) {
  const nextVersion = Number(room.state_version) + 1;
  await sql`
    update public.rooms set status = ${status}, state_version = ${nextVersion},
      finished_at = now(), final_elapsed_ms = ${Math.round(elapsedMs)} where id = ${room.id}
  `;
  const players = await sql`select user_id from public.room_players where room_id = ${room.id} and user_id is not null`;
  const stars = status === 'won' ? Engine.starsFor(elapsedMs, Engine.scheduleFor(room.mode)) : 0;
  for (const player of players) {
    await sql`
      insert into public.game_results(user_id, client_result_id, room_id, source, seed, mode, status, elapsed_ms, stars, found_words)
      values (${player.user_id}, ${crypto.randomUUID()}, ${room.id}, 'multiplayer', ${room.seed}, ${room.mode}, ${status}, ${Math.round(elapsedMs)}, ${stars}, '[]'::jsonb)
    `;
  }
  const event = { roomId: room.id, status, elapsedMs: Math.round(elapsedMs), stars, stateVersion: nextVersion };
  await broadcast(sql, room.id, 'room_finished', event);
  return event;
}

async function submit(user, body) {
  if (!uuid(body.roomId) || !uuid(body.requestId)) throw Object.assign(new Error('Invalid submission'), { status: 400 });
  return db.begin(async sql => {
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
    if (game.elapsedMs >= game.schedule.failMs) return finalize(sql, room, 'lost', game.schedule.failMs);
    if (Number(body.expectedVersion) !== Number(room.state_version)) {
      return { type: 'stale', stateVersion: Number(room.state_version), snapshot: await roomSnapshot(sql, room.id, user.id) };
    }
    const ids = Array.isArray(body.traceIds) ? body.traceIds.map(Number) : [];
    const word = validateTrace(game, ids);
    const result = word ? Engine.submitWord(game, word) : { type: 'invalid-trace', word: '' };
    let response = { type: result.type, word: result.word || word || '', stateVersion: Number(room.state_version) };
    if (result.type === 'required' || result.type === 'extra') {
      const kind = result.type === 'required' ? 'required' : 'bonus';
      const nextVersion = Number(room.state_version) + 1;
      const creditedMs = Number(result.timeSaved) || 0;
      const sequenceRows = await sql`select coalesce(max(sequence), 0)::bigint + 1 as sequence from public.room_finds where room_id = ${room.id}`;
      const sequence = Number(sequenceRows[0].sequence);
      await sql`
        insert into public.room_finds(room_id, sequence, user_id, display_name, word, kind, trace_ids, elapsed_ms, credited_ms)
        values (${room.id}, ${sequence}, ${user.id}, ${players[0].display_name}, ${result.word}, ${kind}, ${sql.json(ids)}, ${Math.round(result.foundAtMs)}, ${creditedMs})
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
        traceIds: ids,
        stateVersion: nextVersion, state: serializeGame(game), savedMs: Number(room.saved_ms) + creditedMs,
        status: game.status, serverNow: now
      });
      await broadcast(sql, room.id, 'word_accepted', response);
      if (game.status === 'won') {
        const finishedRoom = Object.assign({}, room, { state_version: nextVersion });
        const finished = await finalize(sql, finishedRoom, 'won', game.elapsedMs);
        response.stateVersion = finished.stateVersion;
      }
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
  let saved = 0;
  for (const record of records) {
    if (!uuid(record.clientResultId)) continue;
    const mode = record.mode === 'hard' ? 'hard' : 'easy';
    const status = record.status === 'won' ? 'won' : 'lost';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(record.dailyDate || '') ? record.dailyDate : null;
    if (date) {
      await db`
        insert into public.game_results(user_id, client_result_id, source, seed, mode, main_word, daily_date, status, elapsed_ms, stars, found_words)
        values (${user.id}, ${record.clientResultId}, 'local', ${Number(record.seed) >>> 0}, ${mode}, ${record.mainWord || null}, ${date}, ${status},
          ${Math.max(0, Math.round(Number(record.elapsedMs) || 0))}, ${Math.max(0, Math.min(5, Number(record.stars) || 0))}, ${db.json(record.foundWords || [])})
        on conflict (user_id, daily_date, mode) where daily_date is not null do update set
          client_result_id = excluded.client_result_id, status = excluded.status, elapsed_ms = excluded.elapsed_ms,
          stars = excluded.stars, found_words = excluded.found_words
      `;
    } else {
      await db`
        insert into public.game_results(user_id, client_result_id, source, seed, mode, main_word, status, elapsed_ms, stars, found_words)
        values (${user.id}, ${record.clientResultId}, 'local', ${Number(record.seed) >>> 0}, ${mode}, ${record.mainWord || null}, ${status},
          ${Math.max(0, Math.round(Number(record.elapsedMs) || 0))}, ${Math.max(0, Math.min(5, Number(record.stars) || 0))}, ${db.json(record.foundWords || [])})
        on conflict (user_id, client_result_id) do nothing
      `;
    }
    saved++;
  }
  return { saved };
}

async function heartbeat(user, roomId) {
  if (!uuid(roomId)) throw Object.assign(new Error('Invalid room'), { status: 400 });
  return db.begin(async sql => {
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
    if (game.elapsedMs >= game.schedule.failMs) return finalize(sql, room, 'lost', game.schedule.failMs);
    return { status: 'playing', elapsedMs: Math.round(game.elapsedMs), stateVersion: Number(room.state_version), serverNow: Date.now() };
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
  const startedAt = new Date(Date.now() + 3000);
  return db.begin(async sql => {
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
        status = 'countdown',
        saved_ms = 0,
        countdown_at = now(),
        started_at = ${startedAt},
        finished_at = null,
        final_elapsed_ms = null,
        expires_at = now() + interval '24 hours'
      where id = ${room.id}
    `;
    await broadcast(sql, room.id, 'rematch', {
      roomId: room.id,
      startedAt: startedAt.toISOString(),
      stateVersion: nextVersion
    });
    return roomSnapshot(sql, room.id, user.id);
  });
}

async function dispatch(user, body) {
  switch (body.action) {
    case 'profile': {
      const name = cleanName(body.displayName);
      if (!name) throw Object.assign(new Error('Use a name between 1 and 24 characters'), { status: 400 });
      await db`update public.profiles set display_name = ${name}, updated_at = now() where user_id = ${user.id}`;
      return { displayName: name };
    }
    case 'create_room': return createRoom(user, body);
    case 'join_room': return joinRoom(user, body);
    case 'rematch': return rematch(user, body);
    case 'snapshot': return roomSnapshot(db, body.roomId, user.id);
    case 'submit': return submit(user, body);
    case 'heartbeat': return heartbeat(user, body.roomId);
    case 'sync_history': return syncHistory(user, body);
    case 'history': return { results: await db`select * from public.game_results where user_id = ${user.id} order by created_at desc` };
    case 'prepare_merge': return prepareMerge(user);
    case 'complete_merge': return completeMerge(user, body.mergeToken);
    case 'cancel_countdown': {
      await db.begin(async sql => {
        const rows = await sql`select * from public.rooms where id = ${body.roomId} for update`;
        if (!rows.length) return;
        const mine = await sql`select 1 from public.room_players where room_id = ${body.roomId} and user_id = ${user.id}`;
        if (!mine.length) throw Object.assign(new Error('Not a player in this room'), { status: 403 });
        if (rows[0].status !== 'countdown' || Date.now() >= new Date(rows[0].started_at).getTime()) return;
        await sql`update public.rooms set status = 'waiting', countdown_at = null, started_at = null where id = ${body.roomId}`;
        await broadcast(sql, body.roomId, 'room_reset', { roomId: body.roomId, status: 'waiting', stateVersion: Number(rows[0].state_version) });
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
  const user = await caller(request);
  if (!user) return reply(request, 401, { error: 'Authentication required' });
  try {
    const body = await request.json();
    return reply(request, 200, { data: await dispatch(user, body || {}) });
  } catch (error) {
    console.error(error);
    return reply(request, error.status || 500, { error: error.message || 'Request failed' });
  }
});
