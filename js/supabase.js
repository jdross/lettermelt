/* LetterMelt — minimal Supabase Auth, Functions, and Realtime client.
 * Native fetch/WebSocket keeps the static game dependency-free. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LetterMeltSupabase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSION_KEY = 'lettermelt.supabase.session.v1';

  function localHost(value) {
    return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  }

  function isLoopback(value) {
    const host = localHost(value);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function resolveLocalUrl(value, location) {
    const currentHost = localHost(location?.hostname);
    if (!value || !currentHost || isLoopback(currentHost)) return value;
    try {
      const endpoint = new URL(value);
      if (isLoopback(endpoint.hostname)) {
        endpoint.hostname = currentHost;
        return endpoint.toString().replace(/\/$/, '');
      }
    } catch (_e) { /* leave malformed configuration unchanged */ }
    return value;
  }

  function configuration(doc) {
    if (!doc || !doc.querySelector) return { url: '', key: '', enabled: true };
    const url = doc.querySelector('meta[name="lettermelt-supabase-url"]');
    const key = doc.querySelector('meta[name="lettermelt-supabase-key"]');
    const enabled = doc.querySelector('meta[name="lettermelt-multiplayer-enabled"]');
    return {
      url: String(url && url.content || '').replace(/\/$/, ''),
      key: String(key && key.content || ''),
      enabled: !enabled || String(enabled.content).toLowerCase() !== 'false'
    };
  }

  function create(options) {
    const opts = options || {};
    const host = opts.window || (typeof window !== 'undefined' ? window : {});
    const store = opts.storage || host.localStorage || null;
    const fetcher = opts.fetch || host.fetch?.bind(host);
    const WebSocketImpl = opts.WebSocket || host.WebSocket;
    const config = opts.config || configuration(opts.document || host.document);
    if (!opts.config) config.url = resolveLocalUrl(config.url, host.location);
    let session = readSession();
    let refreshPromise = null;

    function jwtSubject(accessToken) {
      try {
        const payload = String(accessToken || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(payload)).sub || '';
      } catch (_e) { return ''; }
    }

    function readSession() {
      if (!store) return null;
      try {
        const value = JSON.parse(store.getItem(SESSION_KEY) || 'null');
        return value && value.access_token && value.refresh_token ? value : null;
      } catch (_e) { return null; }
    }

    function saveSession(value) {
      session = value && value.access_token ? value : null;
      if (store) {
        try {
          if (session) store.setItem(SESSION_KEY, JSON.stringify(session));
          else store.removeItem(SESSION_KEY);
        } catch (_e) { /* private mode: keep the in-memory session */ }
      }
      return session;
    }

    async function request(path, init) {
      if (!config.url || !config.key || !fetcher) throw new Error('Multiplayer is not configured');
      const settings = Object.assign({}, init || {});
      settings.headers = Object.assign({ apikey: config.key, 'content-type': 'application/json' }, settings.headers || {});
      const response = await fetcher(config.url + path, settings);
      let body = null;
      try { body = await response.json(); } catch (_e) { body = {}; }
      if (!response.ok) {
        const error = new Error(body.msg || body.message || body.error_description || body.error || 'Request failed');
        error.status = response.status;
        throw error;
      }
      return body;
    }

    function normalizeSession(value) {
      const next = value && value.session ? value.session : value;
      if (!next || !next.access_token) return null;
      if (!next.expires_at) next.expires_at = Math.floor(Date.now() / 1000) + Number(next.expires_in || 3600);
      return next;
    }

    async function refresh() {
      if (refreshPromise) return refreshPromise;
      if (!session?.refresh_token) return null;
      refreshPromise = request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token })
      }).then(value => saveSession(normalizeSession(value))).catch(error => {
        saveSession(null);
        throw error;
      }).finally(() => { refreshPromise = null; });
      return refreshPromise;
    }

    async function validSession() {
      if (!session) return null;
      if (Number(session.expires_at || 0) * 1000 <= Date.now() + 60000) return refresh();
      return session;
    }

    async function ensureSession() {
      const current = await validSession();
      if (current) return current;
      const value = await request('/auth/v1/signup', { method: 'POST', body: '{}' });
      const next = normalizeSession(value);
      if (!next) throw new Error('Anonymous sign-in is disabled');
      return saveSession(next);
    }

    async function updateEmail(email, redirectTo) {
      const current = await ensureSession();
      const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
      return request('/auth/v1/user' + query, {
        method: 'PUT',
        headers: { authorization: 'Bearer ' + current.access_token },
        body: JSON.stringify({ email: String(email).trim() })
      });
    }

    async function sendMagicLink(email, redirectTo) {
      const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
      return request('/auth/v1/otp' + query, {
        method: 'POST', body: JSON.stringify({ email: String(email).trim(), create_user: true })
      });
    }

    function captureCallback(location) {
      const hash = String(location?.hash || '').replace(/^#/, '');
      if (!hash) return false;
      const params = new URLSearchParams(hash);
      if (!params.get('access_token')) return false;
      saveSession({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_in: Number(params.get('expires_in') || 3600),
        expires_at: Math.floor(Date.now() / 1000) + Number(params.get('expires_in') || 3600),
        token_type: params.get('token_type') || 'bearer'
      });
      try {
        const url = new URL(location.href);
        url.hash = '';
        host.history?.replaceState(null, '', url.pathname + url.search);
      } catch (_e) { /* leave a malformed callback alone */ }
      return true;
    }

    async function signOut() {
      const current = session;
      saveSession(null);
      if (!current) return;
      try {
        await request('/auth/v1/logout', { method: 'POST', headers: { authorization: 'Bearer ' + current.access_token } });
      } catch (_e) { /* local sign-out still succeeds */ }
    }

    async function call(action, payload) {
      const current = await ensureSession();
      const body = Object.assign({}, payload || {}, { action: action });
      const response = await request('/functions/v1/game', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + current.access_token },
        body: JSON.stringify(body)
      });
      return response.data;
    }

    function channel(roomId, handlers) {
      if (!WebSocketImpl) throw new Error('Realtime is unavailable in this browser');
      const hooks = handlers || {};
      const topicName = 'room:' + roomId;
      const topic = 'realtime:' + topicName;
      let socket = null;
      let joined = false;
      let stopped = false;
      let ref = 0;
      let joinRef = null;
      let heartbeat = null;
      let reconnect = null;
      let delay = 500;
      const pending = [];

      function nextRef() { ref += 1; return String(ref); }
      function send(event, payload, messageTopic) {
        const message = [joinRef, nextRef(), messageTopic || topic, event, payload || {}];
        if (socket?.readyState === 1 && (joined || event === 'phx_join' || messageTopic === 'phoenix')) {
          socket.send(JSON.stringify(message));
        } else pending.push(message);
      }

      async function connect() {
        if (stopped) return;
        try {
          const current = await validSession() || await ensureSession();
          const wsUrl = config.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(config.key) + '&vsn=2.0.0';
          socket = new WebSocketImpl(wsUrl);
          socket.onopen = function () {
            delay = 500;
            joinRef = nextRef();
            socket.send(JSON.stringify([joinRef, joinRef, topic, 'phx_join', {
              config: {
                private: true,
                broadcast: { ack: false, self: false },
                presence: { enabled: true, key: current.user?.id || jwtSubject(current.access_token) }
              },
              access_token: current.access_token
            }]));
            heartbeat = host.setInterval(() => send('heartbeat', {}, 'phoenix'), 25000);
          };
          socket.onmessage = function (event) {
            let message;
            try { message = JSON.parse(event.data); } catch (_e) { return; }
            const messageTopic = message[2];
            const type = message[3];
            const payload = message[4] || {};
            if (messageTopic !== topic && messageTopic !== 'phoenix') return;
            if (type === 'phx_reply' && payload.status === 'ok' && message[1] === joinRef) {
              joined = true;
              while (pending.length) socket.send(JSON.stringify(pending.shift()));
              send('presence', { event: 'track', payload: { online_at: new Date().toISOString() } });
              hooks.onStatus?.('connected');
              return;
            }
            if (type === 'broadcast') hooks.onBroadcast?.(payload.event, payload.payload || payload);
            else if (type === 'presence_state' || type === 'presence_diff') hooks.onPresence?.(type, payload);
            else if (type === 'phx_error') hooks.onStatus?.('error');
          };
          socket.onclose = function () {
            joined = false;
            if (heartbeat) host.clearInterval(heartbeat);
            hooks.onStatus?.('disconnected');
            if (!stopped) {
              reconnect = host.setTimeout(connect, delay);
              delay = Math.min(10000, delay * 2);
            }
          };
        } catch (error) {
          hooks.onError?.(error);
          if (!stopped) reconnect = host.setTimeout(connect, Math.min(10000, delay *= 2));
        }
      }

      connect();
      return {
        broadcast: (event, payload) => send('broadcast', { type: 'broadcast', event: event, payload: payload }),
        setAccessToken: async function () {
          const current = await validSession();
          if (current) send('access_token', { access_token: current.access_token });
        },
        close: function () {
          stopped = true;
          if (heartbeat) host.clearInterval(heartbeat);
          if (reconnect) host.clearTimeout(reconnect);
          try { send('phx_leave', {}); socket?.close(); } catch (_e) { /* already closed */ }
        }
      };
    }

    captureCallback(host.location);
    return {
      configured: () => config.enabled !== false && !!(config.url && config.key),
      configuration: () => Object.assign({}, config),
      session: () => session,
      ensureSession,
      refresh,
      updateEmail,
      sendMagicLink,
      captureCallback,
      signOut,
      call,
      channel,
      key: SESSION_KEY
    };
  }

  return { SESSION_KEY, configuration, create };
});
