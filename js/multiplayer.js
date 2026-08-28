/* LetterMelt — multiplayer rooms, account menus, and Supabase coordination. */
(function (root, factory) {
  const api = factory(root.LetterMeltSupabase, root.LetterMeltShare);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LetterMeltMultiplayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Supabase, Share) {
  'use strict';

  const NAME_KEY = 'lettermelt.player.name.v1';
  const MODE_KEY = 'lettermelt.multiplayer.mode.v1';
  const HISTORY_SYNC_KEY = 'lettermelt.history.synced.v1';
  const LOBBY_POLL_MS = 5000;
  const REMATCH_POLL_MS = 1000;
  const PRESENCE_GRACE_MS = 2500;
  const CANONICAL_ORIGIN = 'https://lettermelt.com';
  const PRODUCTION_HOSTS = new Set(['lettermelt.com', 'www.lettermelt.com', 'lettermelt.vercel.app']);

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

  function authRedirectUrl(win, params) {
    const location = win.location || {};
    const host = String(location.hostname || '').toLowerCase();
    const origin = PRODUCTION_HOSTS.has(host) ? CANONICAL_ORIGIN : location.origin;
    const url = new URL(location.pathname || '/', origin);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    return url.toString();
  }

  // Only dismiss when press and release both land on the backdrop. A drag that
  // starts inside the sheet (e.g. selecting the name) and ends on the dimmed
  // area would otherwise fire click on the overlay and close the modal.
  function dismissOnBackdrop(el, close) {
    if (!el) return;
    let downOnBackdrop = false;
    el.addEventListener('pointerdown', ev => { downOnBackdrop = ev.target === el; });
    el.addEventListener('click', ev => {
      if (downOnBackdrop && ev.target === el) close();
      downOnBackdrop = false;
    });
  }

  function create(options) {
    const opts = options || {};
    const win = opts.window || window;
    const doc = opts.document || document;
    const $ = id => doc.getElementById(id);
    const client = Supabase.create({ window: win, document: doc });
    const els = {
      action: $('multiplayerAction'), overlay: $('multiplayerOverlay'), closeButton: $('multiplayerClose'),
      status: $('multiplayerStatus'), lobby: $('multiplayerLobby'),
      name: $('multiplayerName'), easy: $('multiplayerEasy'), hard: $('multiplayerHard'),
      code: $('multiplayerCode'), join: $('multiplayerJoin'), joinRow: $('multiplayerJoinRow'),
      haveCode: $('multiplayerHaveCode'), showCode: $('multiplayerShowCode'),
      codeCard: $('multiplayerCodeCard'), shareRow: $('multiplayerShareRow'),
      shareLink: $('multiplayerShareLink'),
      roomCode: $('multiplayerRoomCode'), players: $('multiplayerPlayers'), start: $('multiplayerStart'),
      invite: $('multiplayerInvite'), accountAction: $('accountAction'), accountActionName: $('accountActionName'),
      accountActionStatus: $('accountActionStatus'), accountOverlay: $('accountOverlay'), accountClose: $('accountClose'),
      accountStatus: $('accountStatus'), accountName: $('accountName'),
      accountScore: $('accountScore'), accountScoreValue: $('accountScoreValue'),
      accountStreakStat: $('accountStreakStat'), accountStreakValue: $('accountStreakValue'),
      accountBestValue: $('accountBestValue'),
      accountConnected: $('accountConnected'), accountConnectedEmail: $('accountConnectedEmail'),
      accountEmail: $('accountEmail'), accountEmailLink: $('accountEmailLink'), accountEmailSection: $('accountEmailSection'),
      accountEmailSent: $('accountEmailSent'), accountDeleteConfirm: $('accountDeleteConfirm'),
      accountDeleteInput: $('accountDeleteInput'), accountDeleteConfirmButton: $('accountDeleteConfirmButton'),
      accountDeleteCancel: $('accountDeleteCancel'),
      accountHistory: $('accountHistory'),
      accountDelete: $('accountDelete'), resultAccount: $('resultAccount')
    };
    let mode = 'easy';
    let room = null;
    let inviteToken = null;
    let channel = null;
    let snapshotTimer = null;
    let started = false;
    let startInFlight = false;
    let watchingRematch = false;
    let serverOffsetMs = 0;
    let lastTraceAt = 0;
    let remoteClear = null;
    let connectionStatus = 'disconnected';
    let channelGeneration = 0;
    let snapshotEpoch = 0;
    let leaveTimer = null;
    let lastRematchVersion = 0;
    let lastRematchKey = '';
    let hosting = false;
    let creating = false;
    let emailLinkPending = false;
    let emailLinkInFlight = false;
    let deleteInFlight = false;

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

    function currentUserId() {
      if (typeof client.userId === 'function') return client.userId() || '';
      const session = client.session();
      if (!session) return '';
      if (session.user?.id) return session.user.id;
      try {
        const payload = String(session.access_token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(payload)).sub || '';
      } catch (_e) { return ''; }
    }

    async function saveName(value) {
      const name = String(value || '').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 24) throw new Error('Use a name between 1 and 24 characters');
      saveLocalName(name);
      const meId = currentUserId();
      if (meId && room?.players) {
        for (const player of room.players) {
          if (player.user_id === meId) player.display_name = name;
        }
      }
      renderPlayers();
      await client.call('profile', { displayName: name });
      return name;
    }

    function storedMode() {
      try { return win.localStorage.getItem(MODE_KEY) === 'hard' ? 'hard' : 'easy'; } catch (_e) { return 'easy'; }
    }

    function setMode(next, fromUser) {
      mode = next === 'hard' ? 'hard' : 'easy';
      try { win.localStorage.setItem(MODE_KEY, mode); } catch (_e) { /* preference stays in memory */ }
      const easy = mode === 'easy';
      els.easy?.classList.toggle('selected', easy);
      els.hard?.classList.toggle('selected', !easy);
      els.easy?.setAttribute('aria-pressed', String(easy));
      els.hard?.setAttribute('aria-pressed', String(!easy));
      if (fromUser) recreateIfModeChanged();
    }

    function canRecreate() {
      return hosting && room?.room?.status === 'waiting' && room.room.mode !== mode;
    }

    function recreateIfModeChanged() {
      if (!canRecreate()) return;
      createRoom();
    }

    function setBusy(busy, text) {
      if (els.join) els.join.disabled = busy;
      if (els.invite) els.invite.disabled = busy;
      if (text) els.status.textContent = text;
      syncModeLock(busy);
    }

    function syncModeLock(busy) {
      const locked = !!busy || !hosting || !room?.room || room.room.status !== 'waiting';
      if (els.easy) els.easy.disabled = locked;
      if (els.hard) els.hard.disabled = locked;
      const ready = room?.room?.status === 'waiting' && (room?.players?.length || 0) >= 2 && !started;
      if (els.start) {
        els.start.hidden = !(room?.room?.status === 'waiting' && !started);
        els.start.disabled = !ready || !!busy || startInFlight;
      }
    }

    function stopSnapshotPolling() {
      if (snapshotTimer) win.clearInterval(snapshotTimer);
      snapshotTimer = null;
    }

    function stopLeaveTimer() {
      if (leaveTimer) win.clearTimeout(leaveTimer);
      leaveTimer = null;
    }

    function showRematch(snapshot) {
      const nextVersion = Number(snapshot?.room?.stateVersion) || 0;
      const nextKey = snapshot?.room?.id && snapshot?.room?.startedAt
        ? snapshot.room.id + ':' + snapshot.room.startedAt : '';
      if (!snapshot?.room || snapshot.room.status !== 'waiting' ||
          (nextVersion && nextVersion < lastRematchVersion) || (nextKey && nextKey === lastRematchKey)) return false;
      lastRematchVersion = Math.max(lastRematchVersion, nextVersion);
      lastRematchKey = nextKey;
      watchingRematch = false;
      started = false;
      opts.onRematch?.(snapshot);
      openLobby(snapshot, inviteToken);
      return true;
    }

    function showError(error) {
      setBusy(false);
      els.status.textContent = error?.message || 'Something went wrong. Try again.';
    }

    function resetDisclosures() {
      if (els.codeCard) els.codeCard.hidden = true;
      if (els.joinRow) els.joinRow.hidden = true;
      if (els.showCode) {
        els.showCode.textContent = 'Show room code';
        els.showCode.setAttribute('aria-expanded', 'false');
      }
      if (els.haveCode) els.haveCode.setAttribute('aria-expanded', 'false');
    }

    function renderInvite() {
      const url = inviteUrl();
      if (els.shareLink) els.shareLink.value = url;
      if (els.shareRow) els.shareRow.hidden = !url;
      if (els.invite) {
        els.invite.textContent = Share?.isMobileDevice(navigator) ? 'Send invite' : 'Copy invite';
      }
      if (els.showCode) els.showCode.hidden = !room?.room?.shortCode;
    }

    function open(options) {
      if (!configured()) return;
      els.overlay.hidden = false;
      const name = storedName() || 'Player';
      els.name.value = name;
      const joining = !!(options && options.join);
      if (joining) {
        resetDisclosures();
        els.status.textContent = '';
        return;
      }
      const waiting = room?.room && room.room.status === 'waiting' && !started;
      if (waiting) {
        openLobby(room, inviteToken);
        return;
      }
      if (creating) return;
      resetDisclosures();
      createRoom();
    }

    function closeOverlay() { els.overlay.setAttribute('hidden', ''); }

    function inviteUrl() {
      if (!inviteToken) return '';
      const url = new URL(win.location.href);
      url.hash = '';
      url.search = '';
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

    function draftName() {
      return String(els.name?.value || '').replace(/\s+/g, ' ').trim();
    }

    function renderPlayers() {
      const meId = currentUserId();
      const mine = draftName() || storedName() || 'Player';
      els.players.innerHTML = '';
      if (creating && !room?.players?.length) {
        const row = doc.createElement('div');
        row.className = 'multiplayer-player';
        row.textContent = 'Creating room…';
        els.players.appendChild(row);
        return;
      }
      for (let slot = 1; slot <= 2; slot++) {
        const player = room?.players?.find(value => Number(value.slot) === slot);
        const row = doc.createElement('div');
        row.className = 'multiplayer-player' + (player && connectionStatus === 'connected' ? ' online' : '');
        if (!player) row.textContent = 'Waiting for player ' + slot + '…';
        else row.textContent = meId && player.user_id === meId ? mine : player.display_name;
        els.players.appendChild(row);
      }
    }

    function updateStartButton() {
      const status = room?.room?.status;
      if (status === 'playing' && !started) {
        started = true;
        closeOverlay();
        opts.onStart?.(room);
      }
      const waiting = status === 'waiting' && !started;
      const ready = waiting && (room?.players?.length || 0) >= 2;
      if (els.start) {
        els.start.hidden = !waiting;
        els.start.disabled = !ready || startInFlight;
        els.start.textContent = startInFlight ? 'Starting…' : 'Start game';
      }
    }

    function openLobby(snapshot, tokenValue) {
      const sameRoom = room?.room?.id === snapshot?.room?.id;
      if (!sameRoom) {
        lastRematchVersion = 0;
        lastRematchKey = '';
      }
      snapshotEpoch += 1;
      stopLeaveTimer();
      room = snapshot;
      if (Number(snapshot.serverNow)) serverOffsetMs = Number(snapshot.serverNow) - Date.now();
      if (tokenValue) inviteToken = tokenValue;
      watchingRematch = false;
      started = false;
      els.overlay.hidden = false;
      if (els.roomCode) els.roomCode.textContent = snapshot.room.shortCode;
      const ready = (snapshot.players?.length || 0) >= 2;
      els.status.textContent = snapshot.room.status === 'waiting'
        ? (ready ? 'Ready when you are.' : 'Share the link and keep this page open.')
        : 'Game in progress.';
      if (!hosting && snapshot.room.mode) setMode(snapshot.room.mode);
      const meId = currentUserId();
      const mine = draftName() || storedName();
      if (meId && mine && room?.players) {
        for (const player of room.players) {
          if (player.user_id === meId) player.display_name = mine;
        }
      }
      renderInvite();
      renderPlayers();
      syncModeLock();
      stopSnapshotPolling();
      snapshotTimer = win.setInterval(() => {
        refreshSnapshot().catch(showError);
      }, LOBBY_POLL_MS);
      updateStartButton();
      if (!sameRoom || !channel || connectionStatus !== 'connected') connectRoom();
    }

    async function refreshSnapshot() {
      if (!room?.room?.id) return;
      const roomId = room.room.id;
      const epoch = snapshotEpoch;
      const snapshot = await client.call('snapshot', { roomId });
      if (!snapshot) return;
      if (epoch !== snapshotEpoch || room?.room?.id !== roomId) return null;
      room = snapshot;
      if (Number(snapshot.serverNow)) serverOffsetMs = Number(snapshot.serverNow) - Date.now();
      renderPlayers();
      updateStartButton();
      syncModeLock();
      opts.onSnapshot?.(snapshot);
      if (watchingRematch && (snapshot.room.status === 'waiting' || snapshot.room.status === 'countdown')) {
        showRematch(snapshot);
      }
      return snapshot;
    }

    function connectRoom() {
      const generation = ++channelGeneration;
      channel?.close();
      channel = null;
      connectionStatus = 'disconnected';
      renderPlayers();
      if (!room?.room?.id) return;
      channel = client.channel(room.room.id, {
        onStatus: status => {
          if (generation !== channelGeneration) return;
          connectionStatus = status;
          renderPlayers();
          if (status === 'connected') refreshSnapshot().catch(showError);
        },
        onPresence: (type, payload) => {
          if (generation !== channelGeneration) return;
          if (type !== 'presence_diff') return;
          if (payload?.joins && Object.keys(payload.joins).length) stopLeaveTimer();
          if (payload?.leaves && Object.keys(payload.leaves).length && room?.room?.status === 'countdown') {
            stopLeaveTimer();
            leaveTimer = win.setTimeout(() => {
              if (generation !== channelGeneration || room?.room?.status !== 'countdown') return;
              client.call('cancel_countdown', { roomId: room.room.id })
                .then(() => refreshSnapshot())
                .catch(() => {});
            }, PRESENCE_GRACE_MS);
          }
        },
        onBroadcast: (event, payload) => {
          if (generation !== channelGeneration) return;
          if (event === 'trace') {
            if (remoteClear) win.clearTimeout(remoteClear);
            opts.onRemoteTrace?.(payload.traceIds || [], payload.displayName || 'Friend');
            remoteClear = win.setTimeout(() => opts.onRemoteTrace?.([], ''), 900);
          } else if (event === 'trace_end') {
            if (remoteClear) win.clearTimeout(remoteClear);
            remoteClear = null;
            opts.onRemoteTrace?.([], '');
          } else if (event === 'countdown' || event === 'room_ready' || event === 'room_started' || event === 'room_reset') {
            refreshSnapshot().catch(showError);
          } else if (event === 'room_paused' || event === 'room_resumed') {
            refreshSnapshot().catch(showError);
          } else if (event === 'rematch') {
            watchingRematch = false;
            const roomId = room?.room?.id;
            refreshSnapshot().then(snapshot => {
              if (snapshot && snapshot.room.id === roomId) showRematch(snapshot);
            }).catch(showError);
          } else if (event === 'word_accepted' || event === 'word_claimed') {
            opts.onAccepted?.(payload);
          } else if (event === 'room_finished') {
            opts.onFinished?.(payload);
            refreshSnapshot().catch(() => {});
          }
        },
        onError: error => { if (generation === channelGeneration) showError(error); }
      });
    }

    async function createRoom() {
      if (creating) return;
      creating = true;
      hosting = true;
      room = null;
      inviteToken = null;
      connectionStatus = 'disconnected';
      renderInvite();
      renderPlayers();
      try {
        setBusy(true, 'Creating room…');
        await client.ensureSession();
        const name = await saveName(els.name.value || storedName() || 'Player');
        const created = await client.call('create_room', { mode, displayName: name });
        inviteToken = created.inviteToken;
        const snapshot = await client.call('snapshot', { roomId: created.roomId });
        openLobby(snapshot, inviteToken);
        setBusy(false);
      } catch (error) { showError(error); hosting = !!room?.room; }
      creating = false;
      if (!room?.players?.length) renderPlayers();
      if (canRecreate()) createRoom();
    }

    async function joinRoom(tokenValue) {
      hosting = false;
      try {
        setBusy(true, 'Joining room…');
        await client.ensureSession();
        const name = await saveName(els.name.value || storedName() || 'Player');
        const payload = tokenValue
          ? { inviteToken: tokenValue, displayName: name }
          : { shortCode: els.code.value, displayName: name };
        const snapshot = await client.call('join_room', payload);
        openLobby(snapshot, tokenValue || null);
        setBusy(false);
      } catch (error) { showError(error); }
    }

    async function startGame() {
      if (startInFlight || started || !room?.room?.id || room.room.status !== 'waiting' ||
          (room.players?.length || 0) < 2) return null;
      startInFlight = true;
      updateStartButton();
      try {
        const snapshot = await client.call('start_room', { roomId: room.room.id });
        if (snapshot) {
          room = snapshot;
          if (Number(snapshot.serverNow)) serverOffsetMs = Number(snapshot.serverNow) - Date.now();
          renderPlayers();
          updateStartButton();
          opts.onSnapshot?.(snapshot);
        }
        return snapshot;
      } catch (error) {
        showError(error);
        return null;
      } finally {
        startInFlight = false;
        updateStartButton();
      }
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

    async function setPaused(nextPaused) {
      if (!room?.room?.id) return null;
      const snapshot = await client.call(nextPaused ? 'pause' : 'resume', { roomId: room.room.id });
      if (!snapshot) return null;
      room = snapshot;
      if (Number(snapshot.serverNow)) serverOffsetMs = Number(snapshot.serverNow) - Date.now();
      channel?.broadcast(nextPaused ? 'room_paused' : 'room_resumed', {
        roomId: snapshot.room.id,
        pausedAt: snapshot.room.pausedAt,
        pausedMs: snapshot.room.pausedMs
      });
      return snapshot;
    }

    async function submit(payload, retryCount) {
      if (!room?.room?.id) return null;
      const body = Array.isArray(payload) ? { traceIds: payload } : Object.assign({}, payload || {});
      const traceIds = Array.isArray(body.traceIds) ? body.traceIds : [];
      const word = String(body.word || '');
      const elapsedMs = body.elapsedMs;
      const kind = body.kind;
      const timeSaved = body.timeSaved;
      if (!body.requestId) body.requestId = randomUuid(win);
      const requestId = body.requestId;
      const attempts = Number(retryCount) || 0;
      if (!attempts) {
        channel?.broadcast('word_claimed', {
          word, traceIds: traceIds.slice(0, 11), elapsedMs, foundAtMs: elapsedMs,
          kind, timeSaved, requestId,
          finderId: currentUserId(),
          displayName: storedName() || 'Player',
          claimed: true
        });
      }
      let result;
      try {
        result = await client.call('submit', {
          roomId: room.room.id,
          requestId,
          traceIds,
          word,
          elapsedMs
        });
      } catch (error) {
        if (error?.status === 409 && /game has not started/i.test(error.message) && attempts < 4) {
          await new Promise(resolve => win.setTimeout(resolve, 250));
          return submit(body, attempts + 1);
        }
        if (attempts < 3 && (!error?.status || error.status >= 500)) {
          await new Promise(resolve => win.setTimeout(resolve, 200 * (attempts + 1)));
          return submit(body, attempts + 1);
        }
        throw error;
      }
      if (result?.snapshot) {
        room = result.snapshot;
        opts.onSnapshot?.(room);
      } else if (result?.type === 'required' || result?.type === 'extra' ||
                 result?.type === 'repeat-required' || result?.type === 'repeat-extra') {
        if (room?.room && result.stateVersion != null) {
          room.room.stateVersion = result.stateVersion;
          if (result.state) room.room.state = result.state;
          if (result.savedMs != null) room.room.savedMs = result.savedMs;
        }
        if (result.type === 'required' || result.type === 'extra') {
          channel?.broadcast('word_accepted', result);
        }
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
      }, REMATCH_POLL_MS);
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

    function historyApi() {
      return win.LetterMeltHistory || (typeof globalThis !== 'undefined' ? globalThis.LetterMeltHistory : null);
    }

    function linkedEmail(user) {
      const email = String(user?.email || '').trim();
      if (!email || user.is_anonymous === true) return '';
      return email;
    }

    function sessionEmail() {
      if (typeof client.email === 'function') return client.email() || '';
      return linkedEmail(client.session() && client.session().user);
    }

    function setAccountStatus(text) {
      if (!els.accountStatus) return;
      const message = String(text || '').trim();
      els.accountStatus.textContent = message;
      els.accountStatus.hidden = !message;
    }

    function setAccountMetricsLoading() {
      if (els.accountScoreValue) els.accountScoreValue.textContent = '…';
      if (els.accountStreakValue) els.accountStreakValue.textContent = '…';
      if (els.accountBestValue) els.accountBestValue.textContent = '…';
      els.accountStreakStat?.classList.remove('is-hot');
    }

    function resetDeleteConfirmation() {
      deleteInFlight = false;
      if (els.accountDeleteConfirm) els.accountDeleteConfirm.hidden = true;
      if (els.accountDelete) els.accountDelete.hidden = false;
      if (els.accountDeleteInput) els.accountDeleteInput.value = '';
      if (els.accountDeleteConfirmButton) els.accountDeleteConfirmButton.disabled = true;
      if (els.accountDeleteCancel) els.accountDeleteCancel.disabled = false;
    }

    function showDeleteConfirmation() {
      if (deleteInFlight) return;
      setAccountStatus('');
      if (els.accountDelete) els.accountDelete.hidden = true;
      if (els.accountDeleteConfirm) els.accountDeleteConfirm.hidden = false;
      if (els.accountDeleteInput) {
        els.accountDeleteInput.value = '';
        els.accountDeleteInput.focus();
      }
      if (els.accountDeleteConfirmButton) els.accountDeleteConfirmButton.disabled = true;
    }

    function applyAccountChrome(email, name) {
      const signedIn = !!email;
      const display = name || storedName() || 'Player';
      if (els.accountName) els.accountName.value = display;
      if (els.accountConnected) els.accountConnected.hidden = !signedIn;
      if (els.accountConnectedEmail) els.accountConnectedEmail.textContent = email;
      if (els.accountEmailSection) els.accountEmailSection.hidden = signedIn || emailLinkPending;
      if (els.accountEmailSent) els.accountEmailSent.hidden = signedIn || !emailLinkPending;
      if (els.accountActionStatus) els.accountActionStatus.textContent = email || 'Account';
      if (els.accountActionName) els.accountActionName.textContent = display;
    }

    function paintAccount(results) {
      const History = historyApi();
      const list = History?.newestFirst ? History.newestFirst(results || []) : (results || []);
      const total = History?.totalScore ? History.totalScore(list) : 0;
      const streaks = History?.streakStats ? History.streakStats(list) : { current: 0, longest: 0 };
      if (els.accountScoreValue) els.accountScoreValue.textContent = String(total);
      if (els.accountStreakValue) els.accountStreakValue.textContent = String(streaks.current || 0);
      if (els.accountBestValue) els.accountBestValue.textContent = String(streaks.longest || 0);
      els.accountStreakStat?.classList.toggle('is-hot', (streaks.current || 0) > 0);

      els.accountHistory.innerHTML = '';
      for (const result of list) {
        const mode = result.mode === 'hard' ? 'hard' : 'easy';
        const stars = Number(result.stars) || 0;
        const points = History?.scorePoints ? History.scorePoints(mode, stars) : stars * (mode === 'hard' ? 2 : 1);
        const word = History?.headlineWord ? History.headlineWord(result) : result.mainWord;
        const when = History?.formatPlayedOn ? History.formatPlayedOn(result.playedAt || result.dailyDate) : '';
        const kind = result.source === 'multiplayer' ? 'duo' : (result.dailyDate ? 'daily' : '');
        const row = doc.createElement('div');
        row.className = 'account-history-row ' + (result.status === 'won' ? 'is-won' : 'is-lost');
        const copy = doc.createElement('span');
        const title = doc.createElement('strong');
        title.textContent = word || (result.source === 'multiplayer' ? 'Two-player' : (result.dailyDate ? 'Daily' : 'Custom'));
        const detail = doc.createElement('span');
        detail.className = 'account-history-when';
        detail.textContent = [when, kind, mode].filter(Boolean).join(' · ');
        copy.append(title, detail);
        const meta = doc.createElement('span');
        meta.className = 'account-history-meta';
        meta.textContent = String(points);
        const glyphs = doc.createElement('span');
        glyphs.className = 'account-history-stars';
        const earned = Math.max(0, Math.min(5, Math.round(stars)));
        glyphs.textContent = '★'.repeat(earned) + '☆'.repeat(5 - earned);
        meta.appendChild(glyphs);
        row.append(copy, meta);
        els.accountHistory.appendChild(row);
      }
    }

    function historyKey() {
      const History = historyApi();
      return (History && History.STORAGE_KEY) || 'lettermelt.games.v1';
    }

    function localHistoryForSync() {
      const History = historyApi();
      const key = historyKey();
      let raw = [];
      try { raw = JSON.parse(win.localStorage.getItem(key) || '[]'); } catch (_e) { raw = []; }
      let changed = false;
      const records = [];
      for (const value of raw) {
        if (!value || typeof value !== 'object') continue;
        if (!value.i) { value.i = randomUuid(win); changed = true; }
        const word = History && History.headlineWord ? History.headlineWord(value) : null;
        if (word && value.w !== word) { value.w = word; changed = true; }
        const expanded = History && History.expand ? History.expand(value) : null;
        if (!expanded) continue;
        expanded.clientResultId = value.i;
        expanded.source = 'local';
        expanded._index = records.length;
        records.push(expanded);
      }
      if (changed) {
        try { win.localStorage.setItem(key, JSON.stringify(raw)); } catch (_e) { /* sync still works once */ }
      }
      return records;
    }

    async function historyRecords() {
      const local = localHistoryForSync();
      let remote = [];
      try {
        const data = await client.call('history', {});
        remote = data.results || [];
      } catch (_e) { /* local history still renders */ }
      const History = historyApi();
      return History?.mergeHistory ? History.mergeHistory(local, remote) : local.slice().reverse();
    }

    async function pushLocalHistory(onlyIfUnsynced) {
      try {
        if (onlyIfUnsynced && win.localStorage.getItem(HISTORY_SYNC_KEY)) return;
        const records = localHistoryForSync();
        if (records.length) await client.call('sync_history', { records });
        win.localStorage.setItem(HISTORY_SYNC_KEY, new Date().toISOString());
      } catch (_e) { /* local history remains until retry */ }
    }

    async function syncHistory() {
      if (!configured() || !client.session()) return;
      await pushLocalHistory(false);
    }

    async function openAccount() {
      if (!configured()) return;
      els.accountOverlay.hidden = false;
      const name = storedName() || 'Player';
      resetDeleteConfirmation();
      els.accountName.value = name;
      applyAccountChrome(sessionEmail(), name);
      setAccountStatus('');
      paintAccount(localHistoryForSync());
      setAccountMetricsLoading();
      try {
        await client.ensureSession();
        let email = sessionEmail();
        try {
          if (typeof client.getUser === 'function') email = linkedEmail(await client.getUser()) || email;
        } catch (_e) { /* anonymous session still has a device profile */ }
        applyAccountChrome(email, name);
        await pushLocalHistory(true);
        paintAccount(await historyRecords());
      } catch (error) {
        setAccountStatus(error.message);
        paintAccount(localHistoryForSync());
      }
    }

    async function emailLink() {
      const email = String(els.accountEmail.value || '').trim();
      if (!email || emailLinkPending || emailLinkInFlight) return;
      emailLinkInFlight = true;
      if (els.accountEmailLink) els.accountEmailLink.disabled = true;
      const callbackUrl = authRedirectUrl(win);
      try {
        await client.updateEmail(email, callbackUrl);
        emailLinkPending = true;
      } catch (error) {
        try {
          const merge = await client.call('prepare_merge', {});
          await client.sendMagicLink(email, authRedirectUrl(win, { merge: merge.mergeToken }));
          emailLinkPending = true;
        } catch (_second) {
          setAccountStatus(error.message);
        }
      } finally {
        emailLinkInFlight = false;
        if (emailLinkPending) {
          setAccountStatus('');
          applyAccountChrome(sessionEmail(), storedName() || 'Player');
        } else if (els.accountEmailLink) {
          els.accountEmailLink.disabled = false;
        }
      }
    }

    async function deleteAccount(event) {
      event?.preventDefault();
      if (deleteInFlight) return;
      const confirmation = String(els.accountDeleteInput?.value || '').trim().toLowerCase();
      if (confirmation !== 'confirm') {
        setAccountStatus('Type confirm to delete your account.');
        els.accountDeleteInput?.focus();
        return;
      }
      deleteInFlight = true;
      if (els.accountDeleteConfirmButton) els.accountDeleteConfirmButton.disabled = true;
      if (els.accountDeleteCancel) els.accountDeleteCancel.disabled = true;
      try {
        await client.call('delete_account', {});
        try {
          win.localStorage.removeItem(NAME_KEY);
          win.localStorage.removeItem(HISTORY_SYNC_KEY);
        } catch (_e) { /* already deleted remotely */ }
        await client.signOut();
        win.location.reload();
      } catch (error) {
        deleteInFlight = false;
        if (els.accountDeleteConfirmButton) els.accountDeleteConfirmButton.disabled = false;
        if (els.accountDeleteCancel) els.accountDeleteCancel.disabled = false;
        setAccountStatus(error.message);
      }
    }

    if (configured()) {
      els.action.hidden = false;
      els.accountAction.hidden = false;
      els.resultAccount.hidden = false;
      const name = storedName() || 'Player';
      saveLocalName(name);
      setMode(storedMode());
      applyAccountChrome(sessionEmail(), name);
    }

    try {
      const callback = new URL(win.location.href);
      const mergeToken = callback.searchParams.get('merge');
      if (mergeToken && client.session()) {
        client.call('complete_merge', { mergeToken }).then(() => {
          callback.searchParams.delete('merge');
          win.history.replaceState(null, '', callback.pathname + callback.search);
          applyAccountChrome(sessionEmail(), storedName() || 'Player');
        }).catch(() => {});
      }
    } catch (_e) { /* no merge callback */ }

    els.action?.addEventListener('click', () => open());
    els.closeButton?.addEventListener('click', closeOverlay);
    dismissOnBackdrop(els.overlay, closeOverlay);
    els.easy?.addEventListener('click', () => setMode('easy', true));
    els.hard?.addEventListener('click', () => setMode('hard', true));
    els.join?.addEventListener('click', () => joinRoom(null));
    els.code?.addEventListener('input', () => { els.code.value = els.code.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
    els.invite?.addEventListener('click', shareInvite);
    els.shareLink?.addEventListener('focus', () => els.shareLink.select());
    els.name?.addEventListener('input', () => { renderPlayers(); });
    els.name?.addEventListener('change', () => {
      saveName(els.name.value).catch(error => { els.status.textContent = error.message; });
    });
    els.showCode?.addEventListener('click', () => {
      const openCode = !!els.codeCard.hidden;
      els.codeCard.hidden = !openCode;
      els.showCode.textContent = openCode ? 'Hide room code' : 'Show room code';
      els.showCode.setAttribute('aria-expanded', String(openCode));
    });
    els.haveCode?.addEventListener('click', () => {
      const openJoin = !!els.joinRow.hidden;
      els.joinRow.hidden = !openJoin;
      els.haveCode.setAttribute('aria-expanded', String(openJoin));
      if (openJoin) els.code.focus();
    });
    els.start?.addEventListener('click', startGame);
    els.accountAction?.addEventListener('click', openAccount);
    els.resultAccount?.addEventListener('click', openAccount);
    els.accountClose?.addEventListener('click', () => { els.accountOverlay.hidden = true; });
    dismissOnBackdrop(els.accountOverlay, () => { els.accountOverlay.hidden = true; });
    els.accountName?.addEventListener('change', () => {
      saveName(els.accountName.value).then(name => {
        applyAccountChrome(sessionEmail(), name);
      }).catch(error => { setAccountStatus(error.message); });
    });
    els.accountEmailLink?.addEventListener('click', emailLink);
    els.accountDelete?.addEventListener('click', showDeleteConfirmation);
    els.accountDeleteConfirm?.addEventListener('submit', deleteAccount);
    els.accountDeleteInput?.addEventListener('input', () => {
      const confirmation = String(els.accountDeleteInput.value || '').trim().toLowerCase();
      if (els.accountDeleteConfirmButton) els.accountDeleteConfirmButton.disabled = deleteInFlight || confirmation !== 'confirm';
    });
    els.accountDeleteCancel?.addEventListener('click', () => {
      resetDeleteConfirmation();
      setAccountStatus('');
    });

    try {
      const params = new URLSearchParams(win.location.search);
      const incoming = params.get('mp');
      if (incoming && configured()) {
        win.setTimeout(() => { open({ join: true }); joinRoom(incoming); }, 0);
      }
    } catch (_e) { /* malformed URL leaves the normal home menu */ }

    return {
      configured,
      open,
      openAccount,
      start: startGame,
      submit,
      rematch,
      pause: () => setPaused(true),
      resume: () => setPaused(false),
      sendTrace,
      heartbeat,
      watchForRematch,
      syncHistory,
      refresh: refreshSnapshot,
      room: () => room,
      close: function () {
        channelGeneration += 1;
        snapshotEpoch += 1;
        channel?.close();
        channel = null;
        stopSnapshotPolling();
        stopLeaveTimer();
        if (remoteClear) win.clearTimeout(remoteClear);
        remoteClear = null;
        watchingRematch = false;
        connectionStatus = 'disconnected';
        lastRematchVersion = 0;
        lastRematchKey = '';
        closeOverlay();
      },
      client
    };
  }

  return { NAME_KEY, create };
});
