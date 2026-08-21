# Agent Note: Desktop native window chrome

Status: implemented

English | [中文](2026-08-22-desktop-native-window-chrome.zh.md)

## Problem

The frameless main window had three user-visible gaps: no Windows 11 snap-layout flyout, resize borders left to tao's default hit-testing (which removes `WS_CAPTION | WS_THICKFRAME` for undecorated windows), and a maximize icon that synced on click and resize events rather than on window state.

## Decision

The shell restores the thick frame on the main window at setup: `apply_windows_chrome` re-adds `WS_THICKFRAME | WS_MAXIMIZEBOX` (without `WS_CAPTION`) through `SetWindowLongPtrW` and refreshes the frame with `SetWindowPos(SWP_FRAMECHANGED)`. The OS then provides native resize borders and the snap-layout flyout while the custom title bar stays. Failures leave the tao default rather than panicking.

Maximize state is pushed from the native host: `on_window_event` listens for `WindowEvent::Resized`, queries `is_maximized()`, and emits `dsh://maximize-change` with the authoritative boolean. The title bar listens for the event (through `window.__TAURI__.event`) and keeps the polling `isMaximized()` read as a fallback for hosts without the event.

## Alternatives considered

**Intercept `WM_NCHITTEST` for custom resize hit-testing** — rejected: re-adding the thick frame gives the OS the same behavior with less code and no per-pixel hit-test ownership.

**Render the maximize icon purely from the click handler** — rejected: the plan requires window state, not input inference; snap layouts and OS shortcuts change state without a click on the injected button.

## Consequences

The chrome fix is Windows-only and packaged-build verification still requires a machine with an installed build (a local `tauri build` needs the signing key; the running installation shares the single-instance identifier). `cargo check` and the debug build compile the change.

## Testing

`cargo check` passes for the shell change; the title bar event listener follows the existing `dsh://open-path` pattern. Packaged smoke verification is deferred to a machine that can install the release build.
