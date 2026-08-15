# Agent Note: Startup splashscreen for dsh-desktop

Status: implemented

English | [中文](2026-08-15-desktop-startup-splashscreen.zh.md)

## Problem

The shell booted straight into the dsh web profile, so a broken runtime, a missing WebView2, or an unset API key surfaced only as a dead page or a bare error line. There was no way to detect the environment before boot, explain what failed, or let the user retry.

## Decision

The app opens a frameless `splashscreen` window first and keeps the `main` window hidden until the runtime prints its `dsh web:` readiness line. `apps/desktop/src/splashscreen.html` renders a checklist driven by a polled status board: `run_checks` records one entry per step (`webview2`, `node`, `runtime`, `home`, `api-key`, `bridge`, `boot`) into a managed `SplashBoard`, the page polls the `splash_status` command every 250 ms, and a fatal entry keeps the splash up with a retry button.

The splash speaks to Rust through the low-level IPC bridge, not the `withGlobalTauri` high-level API: `window.__TAURI_INTERNALS__.invoke` is injected into every webview unconditionally, whereas `window.__TAURI__` is only present when `@tauri-apps/api` is installed and can be undefined during top-level script execution. The retry button and the WebView2 link invoke `splash_start` / `splash_open_webview2_download` through that bridge. `@tauri-apps/api` is still a devDependency so the injected title bar's `window.__TAURI__.window` controls resolve.

`get_webview_window("main")` can return `None` at the splash's first command round-trip (the main webview's registration lags the splash page load), so `splash_start` retries the lookup in a thread before running the checks.

WebView2 acquisition is an install-time concern, not a splash concern: `bundle.windows.webviewInstallMode` is `embedBootstrapper`, so the NSIS installer embeds the bootstrapper and downloads/installs the runtime with native progress. The splash cannot install a missing WebView2 (it is a WebView2 page); its `下载 / 修复 WebView2` link opens Microsoft's download page through `tauri-plugin-opener`.

## Consequences

A bad environment stops on a legible checklist with a per-step status and a retry, instead of a dead page. The splash depends only on `__TAURI_INTERNALS__` for its IPC, so it works whether or not `withGlobalTauri` injects the high-level API. The accepted costs: polling replaces push events (a 250 ms cadence on a tiny local command), and the main-window lookup retries up to 6 s before reporting the failure.

## Alternatives considered

- **`withGlobalTauri` events (`window.__TAURI__.event.listen` + `core.invoke`)** — the high-level API is not injected without `@tauri-apps/api`, and even with it the top-level-script timing is fragile; rejected in favor of the always-injected bridge plus polling.
- **Rust `window.eval` status delivery** — works without any JS→Rust channel, but a progressive checklist still needs the page to signal readiness first; the polled board avoids that handshake entirely.
