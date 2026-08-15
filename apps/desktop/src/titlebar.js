// dsh-desktop custom title bar (single source of truth).
// Loaded by the shell's loading page via <script src="titlebar.js"> and
// re-injected into the dsh web page by the Rust host after navigation
// (main.rs embeds this exact file with include_str!).
//
// Theme following: the bar styles consume the dsh theme tokens
// (--dsw-alias-*) that ui-theme writes on <body>; switching the theme in
// the dsh settings repaints the bar automatically - no shell-side state to
// sync. Fallback colors keep the pre-theme loading page readable.
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
  drag.textContent = 'dsh-desktop';
  bar.appendChild(drag);

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