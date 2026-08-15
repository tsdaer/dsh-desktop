// dsh-desktop custom title bar (single source of truth).
// Loaded by the shell's loading page via <script src="titlebar.js"> and
// re-injected into the dsh web page by the Rust host after navigation
// (main.rs embeds this exact file with include_str!).
//
// Theme following: the bar styles consume the dsh theme tokens
// (--dsw-alias-*) that ui-theme writes on <body>; switching the theme in
// the dsh settings repaints the bar automatically - no shell-side state to
// sync. Fallback colors keep the pre-theme loading page readable.
//
// Left side: the app title plus a version badge. The Rust host prepends a
// window.__DSH_DESKTOP_VERSION__ global before eval'ing this script into
// the dsh page, so the badge shows the packaged app version there; the
// loading page (plain <script src>) has no global and renders the bare
// title.
//
// Right side (before the window controls): a balance pill fed by
// GET /dsh-bridge/balance - the desktop bridge host resolves the DeepSeek
// key through the runtime's credentials seam and proxies the official
// /user/balance endpoint. The pill polls every 5 minutes and on window
// visibility; it stays hidden until the first successful read, keeps the
// last good amount while a refresh fails, and never touches the API key
// itself (the browser only ever sees the amount).
(function () {
  'use strict';
  if (document.getElementById('dsh-desktop-titlebar')) return;

  var BAR_H = 36;

  var style = document.createElement('style');
  style.id = 'dsh-desktop-titlebar-style';
  style.textContent =
    '#dsh-desktop-titlebar{' +
      'position:fixed;top:0;left:0;right:0;height:' + BAR_H + 'px;display:flex;align-items:stretch;' +
      'z-index:2147483647;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,#0f1117));' +
      'color:var(--dsw-alias-label-secondary,#9aa3b5);' +
      'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));' +
      'font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:12px;' +
      'user-select:none;-webkit-user-select:none;' +
    '}' +
    '#dsh-desktop-titlebar .bar-drag{' +
      'flex:1;display:flex;align-items:center;gap:8px;padding:0 12px;overflow:hidden;white-space:nowrap;' +
    '}' +
    '#dsh-desktop-titlebar .bar-version{' +
      'font-size:11px;line-height:16px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));' +
      'border-radius:4px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#9aa3b5));' +
      'flex:none;' +
    '}' +
    '#dsh-desktop-titlebar .bar-balance{' +
      'display:flex;align-items:center;gap:6px;padding:0 12px;white-space:nowrap;' +
      'color:var(--dsw-alias-label-primary,#e6e8ee);cursor:default;flex:none;' +
    '}' +
    '#dsh-desktop-titlebar .bar-balance[hidden]{display:none !important;}' +
    '#dsh-desktop-titlebar .bar-balance svg{flex:none;opacity:0.8;}' +
    '#dsh-desktop-titlebar .bar-btn{' +
      'width:46px;border:0;margin:0;padding:0;display:flex;align-items:center;justify-content:center;' +
      'background:transparent;color:inherit;cursor:pointer;' +
    '}' +
    '#dsh-desktop-titlebar .bar-btn:hover{' +
      'background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.08));' +
    '}' +
    '#dsh-desktop-titlebar .bar-btn.close:hover{' +
      'background:var(--dsw-static-red-500,#e01818);color:#fff;' +
    '}' +
    '/* keep the app content below the bar: body padding (no margin' +
    '   collapse, so the document never grows a scrollbar) */' +
    'body{box-sizing:border-box !important;padding-top:' + BAR_H + 'px !important;}' +
    '#root{height:100% !important;margin-top:0 !important;}';
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = 'dsh-desktop-titlebar';

  var drag = document.createElement('div');
  drag.className = 'bar-drag';

  var title = document.createElement('span');
  title.className = 'bar-title';
  title.textContent = 'dsh-desktop';
  drag.appendChild(title);

  // Version badge: only the Rust host sets the global before eval'ing this
  // script into the dsh page, so the loading page (plain script tag) shows
  // the bare title.
  var appVersion = window.__DSH_DESKTOP_VERSION__;
  if (typeof appVersion === 'string' && appVersion.length > 0) {
    var versionBadge = document.createElement('span');
    versionBadge.className = 'bar-version';
    versionBadge.textContent = 'v' + appVersion;
    drag.appendChild(versionBadge);
  }
  bar.appendChild(drag);

  // Balance pill (right side, before the window controls): fed by the
  // bridge host's /dsh-bridge/balance route, polled every 5 minutes and on
  // window visibility. Hidden until the first successful read; a failed
  // refresh keeps the last good amount, and the API key never reaches this
  // page (the bridge resolves it host-side).
  var BALANCE_REFRESH_MS = 5 * 60 * 1000;
  var balanceTimer = null;
  var balanceEverShown = false;

  var balance = document.createElement('div');
  balance.className = 'bar-balance';
  balance.hidden = true;
  balance.title = '余额';
  balance.setAttribute('aria-label', '余额');
  balance.innerHTML = '' +
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<circle cx="6" cy="6" r="4.75" stroke="currentColor" stroke-width="1"/>' +
      '<circle cx="6" cy="6" r="1.75" fill="currentColor"/>' +
    '</svg>' +
    '<span class="bar-balance-value">--</span>';
  bar.appendChild(balance);

  var CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', GBP: '£' };

  function formatBalance(currency, total) {
    var symbol = CURRENCY_SYMBOLS[currency] || (currency + ' ');
    return symbol + total;
  }

  function applyBalance(data) {
    if (data && data.ok === true && typeof data.totalBalance === 'string') {
      balanceEverShown = true;
      balance.querySelector('.bar-balance-value').textContent =
        formatBalance(data.currency, data.totalBalance);
      balance.hidden = false;
    } else if (!balanceEverShown) {
      balance.hidden = true;
    }
  }

  function refreshBalance() {
    if (balanceTimer !== null) {
      clearTimeout(balanceTimer);
      balanceTimer = null;
    }
    var controller = new AbortController();
    var abort = setTimeout(function () { controller.abort(); }, 8000);
    fetch('/dsh-bridge/balance', { signal: controller.signal })
      .then(function (response) { return response.json(); })
      .then(applyBalance)
      .catch(function () { /* transient: keep the last shown amount */ })
      .finally(function () {
        clearTimeout(abort);
        balanceTimer = setTimeout(refreshBalance, BALANCE_REFRESH_MS);
      });
  }
  refreshBalance();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshBalance();
  });

  var win = null;
  try {
    if (window.__TAURI__ && window.__TAURI__.window) {
      win = window.__TAURI__.window.getCurrentWindow();
    }
  } catch (err) {
    win = null;
  }

  function iconSvg(body) {
    return '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">' + body + '</svg>';
  }
  var MIN_ICON = iconSvg('<path d="M0.5 8.5h9" stroke="currentColor" stroke-width="1"/>');
  var MAX_ICON = iconSvg('<rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1"/>');
  var RESTORE_ICON = iconSvg('<path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" stroke="currentColor" stroke-width="1"/>');
  var CLOSE_ICON = iconSvg('<path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1"/>');

  function addButton(cls, html, action) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bar-btn ' + cls;
    btn.innerHTML = html;
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      action();
    });
    bar.appendChild(btn);
    return btn;
  }

  var maximizeBtn = null;
  var isMaximized = false;

  function renderMaximizeIcon() {
    if (maximizeBtn) maximizeBtn.innerHTML = isMaximized ? RESTORE_ICON : MAX_ICON;
  }

  function refreshMaximized() {
    if (!win) return;
    try {
      win.isMaximized().then(function (value) {
        isMaximized = value;
        renderMaximizeIcon();
      }).catch(function () {});
    } catch (err) {}
  }

  if (win) {
    addButton('min', MIN_ICON, function () {
      try { win.minimize(); } catch (err) {}
    });
    maximizeBtn = addButton('max', MAX_ICON, function () {
      try {
        win.toggleMaximize().then(function () { refreshMaximized(); }).catch(function () {});
      } catch (err) {}
    });
    addButton('close', CLOSE_ICON, function () {
      try { win.close(); } catch (err) {}
    });
    if (win.onResized) {
      try {
        win.onResized(function () { refreshMaximized(); });
      } catch (err) {}
    }
  }

  drag.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return;
    // The second press of a double-click toggles maximize instead of
    // starting a window drag (the native drag loop would swallow the
    // dblclick event entirely).
    if (event.detail >= 2) {
      if (win) {
        try {
          win.toggleMaximize().then(function () { refreshMaximized(); }).catch(function () {});
        } catch (err) {}
      }
      return;
    }
    if (!win) return;
    // Dragging a fullscreen window must restore it to windowed first,
    // mirroring the native maximize-drag behavior; otherwise the drag
    // would act on an immovable fullscreen window.
    var startDrag = function () {
      try { win.startDragging(); } catch (err) {}
    };
    try {
      win.isFullscreen().then(function (full) {
        if (full) {
          win.setFullscreen(false).then(startDrag).catch(startDrag);
        } else {
          startDrag();
        }
      }).catch(startDrag);
    } catch (err) {}
  });

  document.body.appendChild(bar);
})();