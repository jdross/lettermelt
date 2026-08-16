/* LetterMelt — pure sharing helpers (browser and Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LetterMeltShare = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function isIOS(navigatorLike) {
    const nav = navigatorLike || {};
    const ua = nav.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) ||
      (/Macintosh/i.test(ua) && Number(nav.maxTouchPoints) > 1);
  }

  function isMobileDevice(navigatorLike) {
    const nav = navigatorLike || {};
    if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
      return nav.userAgentData.mobile;
    }
    return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') || isIOS(nav);
  }

  function messagingUrl(text, navigatorLike) {
    return 'sms:' + (isIOS(navigatorLike) ? '&' : '?') +
      'body=' + encodeURIComponent(text);
  }

  function shareMessage(options) {
    const opts = options || {};
    if (opts.status === 'lost') {
      return 'LetterMelt melted me on ' + opts.modeLabel +
        ' mode 🫠 Think you can beat it? ' + opts.link;
    }
    const stars = '⭐'.repeat(Math.max(0, Number(opts.stars) || 0));
    return 'I got ' + stars + ' on ' + opts.modeLabel +
      ' mode, done in ' + opts.elapsed + '! Here\'s the puzzle: ' + opts.link;
  }

  function createController(options) {
    const opts = options || {};
    const button = opts.button;
    const nav = opts.navigator || {};
    const doc = opts.document;
    const win = opts.window;
    let resetTimer = null;

    function reset() {
      if (resetTimer !== null) {
        win.clearTimeout(resetTimer);
        resetTimer = null;
      }
      button.classList.remove('copied');
      button.textContent = 'Share with friends';
    }

    function showCopied() {
      if (resetTimer !== null) win.clearTimeout(resetTimer);
      button.classList.add('copied');
      button.textContent = 'copied!';
      resetTimer = win.setTimeout(function () {
        resetTimer = null;
        button.classList.remove('copied');
        button.textContent = 'Share with friends';
      }, 2200);
    }

    function copyWithSelection(text) {
      const field = doc.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      doc.body.appendChild(field);
      field.select();
      field.setSelectionRange(0, field.value.length);
      let copied = false;
      try {
        copied = doc.execCommand('copy');
      } catch (_e) { /* the prompt below is the final fallback */ }
      doc.body.removeChild(field);
      return copied;
    }

    function fallbackCopy(text) {
      if (copyWithSelection(text)) {
        showCopied();
        return 'copied';
      }
      win.prompt('Copy this:', text);
      return 'prompted';
    }

    function share() {
      const text = opts.getText();
      if (isMobileDevice(nav)) {
        win.location.href = messagingUrl(text, nav);
        return Promise.resolve('messaging');
      }
      if (nav.clipboard && nav.clipboard.writeText) {
        return Promise.resolve(nav.clipboard.writeText(text)).then(function () {
          showCopied();
          return 'copied';
        }, function () {
          return fallbackCopy(text);
        });
      }
      return Promise.resolve(fallbackCopy(text));
    }

    return { reset: reset, share: share };
  }

  return {
    createController: createController,
    isMobileDevice: isMobileDevice,
    messagingUrl: messagingUrl,
    shareMessage: shareMessage
  };
});
