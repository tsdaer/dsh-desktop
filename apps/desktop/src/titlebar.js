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
// Right side (before the window controls): an API state, workload tier, and
// balance control. The bridge host resolves credentials and proxies balance;
// the native host returns only a normalized workload tier.
(function () {
  'use strict';
  var navigationToken = new URLSearchParams(window.location.search).get('dsh_token');
  if (navigationToken) window.__DSH_LOOPBACK_TOKEN__ = navigationToken;
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
      'border:0;background:transparent;font:inherit;color:var(--dsw-alias-label-primary,#e6e8ee);cursor:pointer;flex:none;' +
    '}' +
    '#dsh-desktop-titlebar .bar-balance:disabled{opacity:0.65;cursor:wait;}' +
    '#dsh-desktop-titlebar .bar-balance[hidden]{display:none !important;}' +
    '#dsh-desktop-titlebar .bar-balance svg{flex:none;opacity:0.8;}' +
    '#dsh-desktop-titlebar .bar-api-status,#dsh-desktop-titlebar .bar-load{display:flex;align-items:center;gap:5px;padding:0 8px;white-space:nowrap;flex:none;}' +
    '#dsh-desktop-titlebar .bar-updater{border:0;border-radius:6px;margin:0 4px;padding:4px 7px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3b5);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer;flex:none;}' +
    '#dsh-desktop-titlebar .bar-updater:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.08));color:inherit;}' +
    '#dsh-desktop-titlebar .bar-updater[data-state="available"],#dsh-desktop-titlebar .bar-updater[data-state="ready"]{color:#8bc4ff;}' +
    '#dsh-desktop-titlebar .bar-updater[data-state="failed"]{color:#ffb4c8;}' +
    '#dsh-desktop-titlebar .bar-updater:disabled{cursor:default;opacity:0.82;}' +
    '#dsh-desktop-titlebar .bar-api-dot{width:7px;height:7px;border-radius:50%;background:#9aa3b5;flex:none;}' +
    '#dsh-desktop-titlebar .bar-api-status.connected .bar-api-dot{background:#3fb96f;}' +
    '#dsh-desktop-titlebar .bar-api-status.unavailable .bar-api-dot{background:#e0a33f;}' +
    '#dsh-desktop-titlebar .bar-api-status.unconfigured .bar-api-dot{background:#7d8598;}' +
    '#dsh-desktop-titlebar .bar-api-status.checking .bar-api-dot{background:#4d9fff;box-shadow:0 0 0 3px rgba(77,159,255,0.18);}' +
    '#dsh-desktop-titlebar .bar-api-label,#dsh-desktop-titlebar .bar-load-label{color:var(--dsw-alias-label-secondary,#9aa3b5);}' +
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

  var apiStatus = document.createElement('div');
  apiStatus.className = 'bar-api-status checking';
  apiStatus.setAttribute('role', 'status');
  apiStatus.setAttribute('aria-live', 'polite');
  var apiDot = document.createElement('span');
  apiDot.className = 'bar-api-dot';
  apiDot.setAttribute('aria-hidden', 'true');
  var apiLabel = document.createElement('span');
  apiLabel.className = 'bar-api-label';
  apiStatus.append(apiDot, apiLabel);
  bar.appendChild(apiStatus);

  var load = document.createElement('div');
  load.className = 'bar-load';
  load.setAttribute('role', 'status');
  var loadEmoji = document.createElement('span');
  loadEmoji.className = 'bar-load-emoji';
  loadEmoji.setAttribute('aria-hidden', 'true');
  var loadLabel = document.createElement('span');
  loadLabel.className = 'bar-load-label';
  load.append(loadEmoji, loadLabel);
  bar.appendChild(load);

  var BALANCE_REFRESH_MS = 5 * 60 * 1000;
  var balanceTimer = null;
  var balanceEverShown = false;
  var balanceRequest = null;

  var balance = document.createElement('button');
  balance.type = 'button';
  balance.className = 'bar-balance';
  balance.hidden = true;
  balance.title = '刷新余额';
  balance.setAttribute('aria-label', '刷新余额');
  balance.innerHTML = '' +
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<circle cx="6" cy="6" r="4.75" stroke="currentColor" stroke-width="1"/>' +
      '<circle cx="6" cy="6" r="1.75" fill="currentColor"/>' +
    '</svg>' +
    '<span class="bar-balance-value">--</span>';
  bar.appendChild(balance);

  var CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', GBP: '£' };
  var apiLabels = {
    checking: ['检查余额', 'Checking balance'],
    connected: ['余额已连接', 'Balance connected'],
    unavailable: ['余额不可用', 'Balance unavailable'],
    unconfigured: ['未配置余额凭据', 'Balance credentials unconfigured']
  };
  var loadLabels = {
    unknown: ['负载未知', 'Workload unknown'],
    calm: ['负载平稳', 'Workload calm'],
    active: ['负载活跃', 'Workload active'],
    busy: ['负载繁忙', 'Workload busy'],
    saturated: ['负载饱和', 'Workload saturated']
  };
  var loadEmojiByTier = { unknown: '▫️', calm: '🌿', active: '⚡', busy: '🔥', saturated: '🟥' };
  var isZh = (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
  var activeApiState = 'checking';
  var activeWorkloadTier = 'unknown';
  var balanceLabels = ['刷新余额', 'Refresh balance'];

  function localized(pair) { return isZh ? pair[0] : pair[1]; }

  function applyApiState(state) {
    if (!apiLabels[state]) state = 'unavailable';
    activeApiState = state;
    apiStatus.className = 'bar-api-status ' + state;
    apiLabel.textContent = localized(apiLabels[state]);
    apiStatus.setAttribute('aria-label', localized(apiLabels[state]));
  }

  function applyWorkload(data) {
    var tier = data && typeof data.tier === 'string' && loadLabels[data.tier] ? data.tier : 'unknown';
    activeWorkloadTier = tier;
    loadEmoji.textContent = loadEmojiByTier[tier];
    loadLabel.textContent = localized(loadLabels[tier]);
    load.setAttribute('aria-label', localized(loadLabels[tier]));
  }

  // The locale plugin resolves a stored preference asynchronously and updates
  // <html lang> after this shell script can already have run. Keep the
  // title-bar copy in step with that authoritative document attribute.
  function syncLocale() {
    isZh = (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
    applyApiState(activeApiState);
    applyWorkload({ tier: activeWorkloadTier });
    balance.title = localized(balanceLabels);
    balance.setAttribute('aria-label', localized(balanceLabels));
  }

  if (typeof MutationObserver === 'function') {
    new MutationObserver(syncLocale).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang']
    });
  }
  syncLocale();

  function formatBalance(currency, total) {
    var symbol = CURRENCY_SYMBOLS[currency] || (currency + ' ');
    return symbol + total;
  }

  function applyBalance(data) {
    var state = data && typeof data.state === 'string' ? data.state : (data && data.ok === true ? 'connected' : 'unavailable');
    applyApiState(state);
    if (data && state === 'connected' && typeof data.totalBalance === 'string') {
      balanceEverShown = true;
      balance.querySelector('.bar-balance-value').textContent =
        formatBalance(data.currency, data.totalBalance);
      balance.hidden = false;
    } else if (!balanceEverShown) {
      balance.hidden = true;
    }
  }

  function refreshBalance() {
    if (balanceRequest !== null) return balanceRequest;
    if (balanceTimer !== null) {
      clearTimeout(balanceTimer);
      balanceTimer = null;
    }
    applyApiState('checking');
    balance.disabled = true;
    balance.setAttribute('aria-busy', 'true');
    var controller = new AbortController();
    var abort = setTimeout(function () { controller.abort(); }, 8000);
    var token = window.__DSH_LOOPBACK_TOKEN__;
    var headers = token ? { authorization: 'Bearer ' + token } : undefined;
    balanceRequest = fetch('/dsh-bridge/balance', { headers: headers, signal: controller.signal })
      .then(function (response) { return response.json(); })
      .then(applyBalance)
      .catch(function () { applyApiState('unavailable'); })
      .finally(function () {
        clearTimeout(abort);
        balanceRequest = null;
        balance.disabled = false;
        balance.removeAttribute('aria-busy');
        balanceTimer = setTimeout(refreshBalance, BALANCE_REFRESH_MS);
      });
    return balanceRequest;
  }
  balance.addEventListener('click', refreshBalance);
  refreshBalance();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshBalance();
  });

  function refreshWorkload() {
    try {
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('runtime_status').then(applyWorkload).catch(function () { applyWorkload(null); });
      } else {
        applyWorkload(null);
      }
    } catch (err) {
      applyWorkload(null);
    }
  }
  applyApiState('checking');
  applyWorkload(null);
  refreshWorkload();
  setInterval(refreshWorkload, 2000);

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

  // Authoritative maximize state arrives from the native host (Rust pushes
  // it on every window size change), so the icon follows snap layouts and
  // OS shortcuts instead of only the injected button's click. The polling
  // read stays as the fallback for hosts without the event.
  function applyMaximized(value) {
    var next = !!value;
    if (next !== isMaximized) {
      isMaximized = next;
      renderMaximizeIcon();
    }
  }

  function refreshMaximized() {
    if (!win) return;
    try {
      win.isMaximized().then(applyMaximized).catch(function () {});
    } catch (err) {}
  }

  var tauriApi = window.__TAURI__;
  if (tauriApi && tauriApi.event) {
    try {
      tauriApi.event.listen('dsh://maximize-change', function (event) {
        applyMaximized(event.payload);
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
