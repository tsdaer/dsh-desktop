# Agent Note: Desktop drops put real paths in the composer, tray + close behavior, and the Explorer open-with entry

Status: implemented

English | [中文](2026-08-17-desktop-drops-tray-open-with.zh.md)

## Problem

WebView2 exposes no `File.path` on dropped files, so the desktop shell could not give the web page real filesystem paths: the bridge copied non-image drops into the session workspace's `drops/` folder and injected a text announcement, and images were the only files that reached the composer. There was no system tray, and closing the window always exited the app (killing the runtime child), even though a tray would make hide-on-close natural. Finally, opening a folder from Explorer ran the app with no way to tell it which folder was meant, so the user had to re-open the workspace manually.

## Decision

**The Tauri shell owns OS drops.** The main window's `dragDropEnabled: false` is removed (the default is true), so Tauri's drag-drop handler yields real paths; the browser page never sees the OS drag itself. The bridge client listens with `__TAURI__.webview.getCurrentWebview().onDragDropEvent` (withGlobalTauri exposes the webview module; `core:event:allow-listen` from capabilities/remote.json covers the underlying listen). On drop:

1. Image files are read back through the shell's bounded `read_dropped_file` command (base64, 20 MiB cap) and re-enter the dsh composer's native image intake as a synthetic drop over the document — the composer's image pipeline keeps working unchanged.
2. Every other file (and every image the read refused) has its path inserted into the composer input box as text, one path per line, through the React-controlled textarea's native value setter plus an `input` event (the composer's own onChange path feeds the input machine).
3. While the drag is over the window, a full-window overlay ("拖放文件到输入框") gives feedback the page cannot render itself.

The read command is allowlisted: main.rs's window event handler records dropped paths (5-minute window), and the command serves only paths from that list — the page runs on plain loopback with no auth, so the read surface stays user-gesture-bounded. The bridge's copy-to-`drops/` pipeline, its policy rows, and `maxBytes`/`copyEnabled` settings are removed with this change.

**Tray and close behavior.** The `tray-icon` feature joins the tauri dependency; `setup_tray` builds a tray with the bundled window icon and a two-item menu (显示主窗口 / 退出). Left-click on the icon shows and focuses the main window; 退出 stops the runtime child explicitly and calls `app.exit(0)` (the only real exit once close-to-tray is on). The 桌面设置 section gains a 关闭行为 toggle persisted in the bridge settings namespace (`$DSH_HOME/settings.yaml` via `POST /dsh-bridge/policy`); the bridge client mirrors the durable value into Rust through the `set_close_to_tray` command on boot and on every change, and the main window's `CloseRequested` handler prevents the close and hides the window while it is set. Default is `false` — the documented real-exit behavior stays the default; the tray is always present regardless.

**Explorer open-with.** On every start the shell (re)registers per-user context-menu entries under HKCU via `reg.exe` (no elevation, idempotent, always pointing at the current exe): `Software\\Classes\\Directory\\shell\\dsh-desktop` (folder row) and `Software\\Classes\\Directory\\Background\\shell\\dsh-desktop` (folder background), label 以 dsh-desktop 打开, command `"<exe>" "%V"`. The launched folder travels to the runtime as `DSH_DESKTOP_OPEN`; the bridge host's `GET /dsh-bridge/workspace` canonicalizes it (`fs.realpath`) and matches the workspace registry by exact path or by ancestor (case-insensitive on Windows); the bridge client then jumps once the page's workspace baseline is ready — opening the workspace's most recent session, or starting a fresh one when it has none. Unmatched folders boot normally. Registration failures are logged, never fatal; the NSIS installer does not yet remove the keys.

**Dev bridge freshness.** `ensure_bridge` now copies the bridge packages from the repository checkout into the profile on every dev boot (the packaged path already kept the profile copy in lockstep), so a rebuilt bridge always reaches an existing profile. The original npm-install path was removed: npm's peer auto-install resolves the published @deepseek-ai manifests, whose workspace: protocol specs fail with EUNSUPPORTEDPROTOCOL — no npm install can ever succeed there.

## Alternatives considered

**Keeping WebView2-level drops** (`dragDropEnabled: false`) — rejected: the page never gets real paths (no `File.path`), and real paths are the entire point of the feature.

**Byte-bridging every dropped file** — rejected: the requested behavior is path-into-input-box; the byte bridge exists only to preserve the composer's image intake, which has no path representation.

**Persisting close-to-tray shell-side** (tauri-plugin-store or a shell-owned file) — rejected: the bridge settings seam already persists desktop settings; the page mirror keeps one durable source.

**Defaulting close-to-tray to on** — rejected: closing the window terminating the runtime is documented, shipped behavior; the setting opts in explicitly.

**Registering the context menu from NSIS** — rejected for the test version: first-run registration keeps the command current across dev runs and reinstalls; uninstall cleanup stays future work.

**The winreg crate for registry writes** — rejected: `reg.exe` ships with every supported Windows and adds no dependency or lock churn.

**A web-app `--workspace` CLI flag** — rejected: the user constrained the change to the desktop shell and bridge plugin; the env var + bridge route keeps the blast radius inside apps/desktop.

## Consequences

Drops now give the model host paths outside the workspace sandbox — the filesystem policy governs what the agent may read, and the old copy-into-`drops/` guarantee is gone. Images keep full composer intake. The drop policy rows (copy switch, size cap) are removed from the settings page; 调试模式 remains. The tray is always present; close hides only when enabled. The per-user registry keys survive uninstall until cleanup is implemented. Dev boots refresh the profile bridge with a directory copy (no npm); the dev flow additionally requires the repository's workspace libs built (`pnpm run build:lib`), because the dev profile's module fallback points at the checkout.

## Verification

`cargo build` and the bridge tsc + tsdown builds pass. An end-to-end boot of the real web profile in a throwaway DSH_HOME (bridge packages copied in, patch rows merged) answered `GET /dsh-bridge/config` with the new shape, `POST /dsh-bridge/policy {closeToTray:true}` persisted `desktop-bridge.closeToTray` into settings.yaml and the follow-up `/config` read it back, `GET /dsh-bridge/workspace` canonicalized an unowned launch folder to `workspace: null`, and `/dsh-bridge/balance` stayed normalized. The exact/ancestor path matching was checked over the platform case rules. After the workspace libs were built, the repo CLI boots the real web profile to its readiness line (`dsh web: http://127.0.0.1:<port>`). The tray, close interception, and context-menu registration exercise on app start; the registry entries were written during the first real run after the HKCU prefix fix.
