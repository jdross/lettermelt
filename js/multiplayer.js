/* LetterMelt — multiplayer rooms, account menus, and Supabase coordination. */
(function (root, factory) {
  const api = factory(root.LetterMeltSupabase, root.LetterMeltShare);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LetterMeltMultiplayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Supabase, Share) {
  'use strict';

  const NAME_KEY = 'lettermelt.player.name.v1';
  const HISTORY_KEY = 'lettermelt.games.v1';
  const HISTORY_SYNC_KEY = 'lettermelt.history.synced.v1';

  function randomUuid(host) {
    if (host.crypto?.randomUUID) return host.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (host.crypto?.getRandomValues) host.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
  }

  function create(options) {
    const opts = options || {};
    const win = opts.window || window;
    const doc = opts.document || document;
    const $ = id => doc.getElementById(id);
    const client = Supabase.create({ window: win, document: doc });
    const els = {
      action: $('multiplayerAction'), overlay: $('multiplayerOverlay'), closeButton: $('multiplayerClose'),
      status: $('multiplayerStatus'), setup: $('multiplayerSetup'), lobby: $('multiplayerLobby'),
      name: $('multiplayerName'), easy: $('multiplayerEasy'), hard: $('multiplayerHard'),
      create: $('multiplayerCreate'), code: $('multiplayerCode'), join: $('multiplayerJoin'),
      roomCode: $('multiplayerRoomCode'), players: $('multiplayerPlayers'), countdown: $('multiplayerCountdown'),
      invite: $('multiplayerInvite'), accountAction: $('accountAction'), accountActionName: $('accountActionName'),
      accountActionStatus: $('accountActionStatus'), accountOverlay: $('accountOverlay'), accountClose: $('accountClose'),
      accountStatus: $('accountStatus'), accountName: $('accountName'), accountSaveName: $('accountSaveName'),
      accountEmail: $('accountEmail'), accountEmailLink: $('accountEmailLink'), accountHistory: $('accountHistory'),
      accountDelete: $('accountDelete'), resultAccount: $('resultAccount')
    };
    let mode = 'easy';
    let room = null;
    let inviteToken = null;
    let channel = null;
    let countdownTimer = null;
    let snapshotTimer = null;
    let started = false;
    let watchingRematch = false;
    let serverOffsetMs = 0;
    let lastTraceAt = 0;
    let remoteClear = null;
    let connectionStatus = 'disconnected';

    function configured() { return client.configured(); }
    function storedName() {
      try { return (win.localStorage.getItem(NAME_KEY) || '').trim(); } catch (_e) { return ''; }
    }
    function saveLocalName(name) {
      try { win.localStorage.setItem(NAME_KEY, name); } catch (_e) { /* in-memory profile remains */ }
      els.name.value = name;
      els.accountName.value = name;
      els.accountActionName.textContent = name;
    }

    async function saveName(value) {
      const name = String(value || '').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 24) throw new Error('Use a name between 1 and 24 characters');
      saveLocalName(name);
      await client.call('profile', { displayName: name });
      return name;
    }

    function setMode(next) {
      mode = next === 'hard' ? 'hard' : 'easy';
      const easy = mode === 'easy';
      els.easy.classList.toggle('selected', easy);
      els.hard.classList.toggle('selected', !easy);
      els.easy.setAttribute('aria-pressed', String(easy));
      els.hard.setAttribute('aria-pressed', String(!easy));
    }

    function setBusy(busy, text) {
      els.create.disabled = busy;
      els.join.disabled = busy;
      if (text) els.status.textContent = text;
    }

    function stopSnapshotPolling() {
      if (snapshotTimer) win.clearInterval(snapshotTimer);
      snapshotTimer = null;
    }

    function showRematch(snapshot) {
      watchingRematch = false;
      started = false;
      opts.onRematch?.(snapshot);
      openLobby(snapshot, inviteToken);
    }

    function showError(error) {
      setBusy(false);
      els.status.textContent = error?.message || 'Something went wrong. Try again.';
    }

    function open() {
      if (!configured()) return;
      els.overlay.hidden = false;
      els.setup.hidden = false;
      els.lobby.hidden = true;
      els.status.textContent = '';
      const name = storedName();
      if (name) els.name.value = name;
      els.name.focus();
    }

    function closeOverlay() { els.overlay.setAttribute('hidden', ''); }

    function inviteUrl() {
      if (!inviteToken) return '';
      const url = new URL(win.location.href);
      url.hash = '';
      url.searchParams.delete('s');
      url.searchParams.delete('m');
      url.searchParams.delete('w');
      url.searchParams.set('mp', inviteToken);
      return url.toString();
    }

    async function shareInvite() {
      const url = inviteUrl();
      if (!url) return;
      if (Share?.isMobileDevice(navigator)) {
        win.location.href = Share.messagingUrl('Play LetterMelt with me: ' + url, navigator);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        const previous = els.invite.textContent;
        els.invite.textContent = 'Invite copied!';
        win.setTimeout(() => { els.invite.textContent = previous; }, 1600);
      } else {
        win.prompt('Copy this invite', url);
      }
    }

    function renderPlayers() {
      els.players.innerHTML = '';
      for (let slot = 1; slot <= 2; slot++) {
        const player = room?.players?.find(value => Number(value.slot) === slot);
        const row = doc.createElement('div');
        row.className = 'multiplayer-player' + (player && connectionStatus === 'connected' ? ' online' : '');
        row.textContent = player ? player.display_name : 'Waiting for player ' + slot + '…';
        els.players.appendChild(row);
      }
    }

    function updateCountdown() {
      if (!room?.room?.startedAt) {
        els.countdown.textContent = 'Waiting for your friend…';
        return;
      }
      const left = new Date(room.room.startedAt).getTime() - (Date.now() + serverOffsetMs);
      if (left > 0) {
        els.countdown.textContent = 'Starting in ' + Math.max(1, Math.ceil(left / 1000)) + '…';
        return;
      }
      els.countdown.textContent = 'Go!';
      if (!started) {
        started = true;
        if (countdownTimer) win.clearInterval(countdownTimer);
        countdownTimer = null;
        stopSnapshotPolling();
        closeOverlay();
        opts.onStart?.(room);
      }
    }

    function openLobby(snapshot, tokenValue) {
      const sameRoom = room?.room?.id === snapshot?.room?.id;
      room = snapshot;
      if (Number(snapshot.serverNow)) serverOffsetMs = Number(snapshot.serverNow) - Date.now();
      if (tokenValue) inviteToken = tokenValue;
      watchingRematch = false;
      started = false;
      els.overlay.hidden = false;
      els.setup.hidden = true;
      els.lobby.hidden = false;
      els.roomCode.textContent = snapshot.room.shortCode;
      els.status.textContent = snapshot.room.status === 'waiting' ? 'Share the invitation and keep this page open.' : 'Both players are here.';
      renderPlayers();
      if (countdownTimer) win.clearInterval(countdownTimer);
      countdownTimer = win.setInterval(updateCountdown, 150);
      stopSnapshotPolling();
      snapshotTimer = win.setInterval(() => {
        if (!started || watchingRematch) refreshSnapshot().catch(showError);
      }, 1000);
      updateCountdown();
      if (!sameRoom || !channel || connectionStatus !== 'connected') connectRoom();
    }

    async function refreshSnapshot() {
      if (!room?.room?.id) return;
      const snapshot = await client.call('snapshot', { roomId: room.room.id });
      if (!snapshot) return;
      room = snapshot;
      if (Number(snapshot.serverNow)) serverOffsetMs = Number(snapshot.serverNow) - Date.now();
      renderPlayers();
      updateCountdown();
      opts.onSnapshot?.(snapshot);
      if (watchingRematch && (snapshot.room.status === 'waiting' || snapshot.room.status === 'countdown')) {
        showRematch(snapshot);
      }
      return snapshot;
    }

    function connectRoom() {
      channel?.close();
      if (!room?.room?.id) return;
      channel = client.channel(room.room.id, {
        onStatus: status => {
          connectionStatus = status;
          renderPlayers();
          if (status === 'connected') refreshSnapshot().catch(showError);
        },
        onPresence: (type, payload) => {
          if (type === 'presence_diff' && payload?.leaves && Object.keys(payload.leaves).length &&
              room?.room?.status === 'countdown') {
            client.call('cancel_countdown', { roomId: room.room.id }).catch(() => {});
          }
        },
        onBroadcast: (event, payload) => {
          if (event === 'trace') {
            if (remoteClear) win.clearTimeout(remoteClear);
            opts.onRemoteTrace?.(payload.traceIds || [], payload.displayName || 'Friend');
            remoteClear = win.setTimeout(() => opts.onRemoteTrace?.([], ''), 900);
          } else if (event === 'trace_end') {
            if (remoteClear) win.clearTimeout(remoteClear);
            remoteClear = null;
            opts.onRemoteTrace?.([], '');
          } else if (event === 'countdown' || event === 'room_reset') {
            refreshSnapshot().catch(showError);
          } else if (event === 'rematch') {
            watchingRematch = false;
            refreshSnapshot().then(snapshot => showRematch(snapshot || room)).catch(showError);
          } else if (event === 'word_accepted') {
            opts.onAccepted?.(payload);
          } else if (event === 'room_finished') {
            opts.onFinished?.(payload);
            refreshSnapshot().catch(() => {});
          }
        },
        onError: showError
      });
    }

    async function createRoom() {
      try {
        setBusy(true, 'Building a shared board…');
        await client.ensureSession();
        await saveName(els.name.value);
        const created = await client.call('create_room', { mode });
        inviteToken = created.inviteToken;
        const snapshot = await client.call('snapshot', { roomId: created.roomId });
        openLobby(snapshot, inviteToken);
        setBusy(false);
      } catch (error) { showError(error); }
    }

    async function joinRoom(tokenValue) {
      try {
        setBusy(true, 'Joining room…');
        await client.ensureSession();
        await saveName(els.name.value);
        const payload = tokenValue ? { inviteToken: tokenValue } : { shortCode: els.code.value };
        const snapshot = await client.call('join_room', payload);
        openLobby(snapshot, tokenValue || null);
        setBusy(false);
      } catch (error) { showError(error); }
    }

    async function rematch() {
      if (!room?.room?.id) throw new Error('No multiplayer room to rematch');
      const snapshot = await client.call('rematch', { roomId: room.room.id });
      channel?.broadcast('rematch', {
        roomId: snapshot.room.id,
        startedAt: snapshot.room.startedAt,
        stateVersion: snapshot.room.stateVersion
      });
      showRematch(snapshot);
      return snapshot;
    }

    async function submit(traceIds, expectedVersion, retryCount) {
      if (!room?.room?.id) return null;
      let result;
      try {
        result = await client.call('submit', {
          roomId: room.room.id,
          requestId: randomUuid(win),
          expectedVersion,
          traceIds
        });
      } catch (error) {
        const attempts = Number(retryCount) || 0;
        if (error?.status === 409 && /game has not started/i.test(error.message) && attempts < 4) {
          await new Promise(resolve => win.setTimeout(resolve, 250));
          return submit(traceIds, expectedVersion, attempts + 1);
        }
        throw error;
      }
      if (result?.snapshot) {
        room = result.snapshot;
        opts.onSnapshot?.(room);
      } else if (result?.type === 'required' || result?.type === 'extra') {
        if (room?.room && result.stateVersion != null) {
          room.room.stateVersion = result.stateVersion;
          if (result.state) room.room.state = result.state;
          if (result.savedMs != null) room.room.savedMs = result.savedMs;
        }
        // Peer-broadcast the find so the other client updates immediately even
        // if postgres realtime.send is delayed or dropped. self:false means
        // this sender still relies on the HTTP path below for its own UI.
        channel?.broadcast('word_accepted', result);
        opts.onAccepted?.(result);
      }
      return result;
    }

    function watchForRematch() {
      if (!room?.room?.id) return;
      watchingRematch = true;
      started = true;
      stopSnapshotPolling();
      snapshotTimer = win.setInterval(() => {
        if (watchingRematch) refreshSnapshot().catch(showError);
      }, 1000);
      refreshSnapshot().catch(showError);
    }

    function sendTrace(traceIds) {
      if (!channel || !room) return;
      const now = performance.now();
      if (traceIds.length && now - lastTraceAt < 50) return;
      lastTraceAt = now;
      channel.broadcast(traceIds.length ? 'trace' : 'trace_end', {
        traceIds: traceIds.slice(0, 11),
        displayName: storedName() || 'Friend',
        stateVersion: room.room.stateVersion
      });
    }

    async function heartbeat() {
      if (!room?.room?.id) return null;
      const result = await client.call('heartbeat', { roomId: room.room.id });
      if (result?.status === 'lost' || result?.status === 'won') opts.onFinished?.(result);
      return result;
    }

    async function historyRecords() {
      try {
        const remote = await client.call('history', {});
        return remote.results || [];
      } catch (_e) { return []; }
    }

    function localHistoryForSync() {
      let raw = [];
      try { raw = JSON.parse(win.localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_e) { raw = []; }
      let changed = false;
      const records = raw.filter(value => value && typeof value === 'object').map(value => {
        if (!value.i) { value.i = randomUuid(win); changed = true; }
        return {
        clientResultId: value.i, seed: Number(value.s) >>> 0,
        mode: value.m, mainWord: value.w || null, dailyDate: value.d || null,
        status: value.r, elapsedMs: Number(value.t) || 0, stars: Number(value.z) || 0,
        foundWords: (value.f || []).map(found => ({ word: found[0], elapsedMs: found[1] }))
        };
      });
      if (changed) {
        try { win.localStorage.setItem(HISTORY_KEY, JSON.stringify(raw)); } catch (_e) { /* sync still works once */ }
      }
      return records;
    }

    async function syncHistoryOnce() {
      try {
        if (win.localStorage.getItem(HISTORY_SYNC_KEY)) return;
        const records = localHistoryForSync();
        if (records.length) await client.call('sync_history', { records });
        win.localStorage.setItem(HISTORY_SYNC_KEY, new Date().toISOString());
      } catch (_e) { /* retry next time account opens */ }
    }

    async function syncHistory() {
      if (!configured() || !client.session()) return;
      try {
        const records = localHistoryForSync();
        if (records.length) await client.call('sync_history', { records });
        win.localStorage.setItem(HISTORY_SYNC_KEY, new Date().toISOString());
      } catch (_e) { /* local history remains the source until retry */ }
    }

    async function openAccount() {
      if (!configured()) return;
      els.accountOverlay.hidden = false;
      const name = storedName() || 'Player';
      els.accountName.value = name;
      els.accountStatus.textContent = 'Saved on this device. Add email to use it elsewhere.';
      try {
        await client.ensureSession();
        await syncHistoryOnce();
        const results = await historyRecords();
        els.accountHistory.innerHTML = '';
        if (!results.length) {
          const empty = doc.createElement('div');
          empty.className = 'account-history-empty';
          empty.textContent = 'No finished games yet.';
          els.accountHistory.appendChild(empty);
        }
        for (const result of results) {
          const row = doc.createElement('div');
          row.className = 'account-history-row';
          const copy = doc.createElement('span');
          copy.textContent = (result.source === 'multiplayer' ? 'Two-player ' : '') + result.mode + ' · ' + result.status;
          const meta = doc.createElement('small');
          meta.textContent = Math.floor(result.elapsed_ms / 60000) + ':' + String(Math.floor(result.elapsed_ms / 1000) % 60).padStart(2, '0') + ' · ' + result.stars + '★';
          row.append(copy, meta);
          els.accountHistory.appendChild(row);
        }
      } catch (error) { els.accountStatus.textContent = error.message; }
    }

    async function emailLink() {
      const email = String(els.accountEmail.value || '').trim();
      if (!email) return;
      try {
        await client.updateEmail(email, win.location.origin + win.location.pathname);
        els.accountStatus.textContent = 'Check your email to finish linking this account.';
      } catch (error) {
        try {
          const merge = await client.call('prepare_merge', {});
          const callback = new URL(win.location.origin + win.location.pathname);
          callback.searchParams.set('merge', merge.mergeToken);
          await client.sendMagicLink(email, callback.toString());
          els.accountStatus.textContent = 'Check your email for the sign-in link.';
        } catch (_second) { els.accountStatus.textContent = error.message; }
      }
    }

    async function deleteAccount() {
      if (!win.confirm('Delete your LetterMelt account and private history? Shared results will show “Former player.”')) return;
      try {
        await client.call('delete_account', {});
        try {
          win.localStorage.removeItem(NAME_KEY);
          win.localStorage.removeItem(HISTORY_SYNC_KEY);
        } catch (_e) { /* already deleted remotely */ }
        await client.signOut();
        win.location.reload();
      } catch (error) { els.accountStatus.textContent = error.message; }
    }

    if (configured()) {
      els.action.hidden = false;
      els.accountAction.hidden = false;
      els.resultAccount.hidden = false;
      const name = storedName() || 'Player';
      saveLocalName(name);
      els.accountActionStatus.textContent = client.session() ? 'Account & history' : 'This device';
    }

    try {
      const callback = new URL(win.location.href);
      const mergeToken = callback.searchParams.get('merge');
      if (mergeToken && client.session()) {
        client.call('complete_merge', { mergeToken }).then(() => {
          callback.searchParams.delete('merge');
          win.history.replaceState(null, '', callback.pathname + callback.search);
          els.accountActionStatus.textContent = 'Account & history';
        }).catch(() => {});
      }
    } catch (_e) { /* no merge callback */ }

    els.action?.addEventListener('click', open);
    els.closeButton?.addEventListener('click', closeOverlay);
    els.overlay?.addEventListener('click', event => { if (event.target === els.overlay) closeOverlay(); });
    els.easy?.addEventListener('click', () => setMode('easy'));
    els.hard?.addEventListener('click', () => setMode('hard'));
    els.create?.addEventListener('click', createRoom);
    els.join?.addEventListener('click', () => joinRoom(null));
    els.code?.addEventListener('input', () => { els.code.value = els.code.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
    els.invite?.addEventListener('click', shareInvite);
    els.accountAction?.addEventListener('click', openAccount);
    els.resultAccount?.addEventListener('click', openAccount);
    els.accountClose?.addEventListener('click', () => { els.accountOverlay.hidden = true; });
    els.accountOverlay?.addEventListener('click', event => { if (event.target === els.accountOverlay) els.accountOverlay.hidden = true; });
    els.accountSaveName?.addEventListener('click', () => saveName(els.accountName.value).then(() => { els.accountStatus.textContent = 'Name saved.'; }).catch(error => { els.accountStatus.textContent = error.message; }));
    els.accountEmailLink?.addEventListener('click', emailLink);
    els.accountDelete?.addEventListener('click', deleteAccount);

    try {
      const params = new URLSearchParams(win.location.search);
      const incoming = params.get('mp');
      if (incoming && configured()) {
        win.setTimeout(() => { open(); joinRoom(incoming); }, 0);
      }
    } catch (_e) { /* malformed URL leaves the normal home menu */ }

    return {
      configured,
      open,
      openAccount,
      submit,
      rematch,
      sendTrace,
      heartbeat,
      watchForRematch,
      syncHistory,
      refresh: refreshSnapshot,
      room: () => room,
      close: function () {
        channel?.close();
        if (countdownTimer) win.clearInterval(countdownTimer);
        stopSnapshotPolling();
        watchingRematch = false;
        countdownTimer = null;
        closeOverlay();
      },
      client
    };
  }

  return { NAME_KEY, create };
});
