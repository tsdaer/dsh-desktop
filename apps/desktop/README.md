# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

A Tauri 2 desktop shell that hosts the 'dsh web' profile in a native window: the shell spawns a Node process running the dsh CLI, waits for the readiness URL line the web profile prints, and navigates the window to it.

## Roadmap

Delivered:

- [x] A native title bar that follows the application theme
- [x] A bundled Node.js sidecar
- [x] Balance display in the title bar
- [x] An Explorer **Open with dsh-desktop** context-menu action
- [x] Configurable close behavior: exit immediately or remain in the system tray
- [x] Native file and folder drag-and-drop

Planned for 0.3.0:

- [x] A desktop-only Workspace/Worktree sidebar switch that preserves the shared Workspace browser
- [x] Explorer, Search, read-only Git decorations, and Worktree path drops into the composer
- [ ] A visually consistent copy action beside every ordinary user and assistant message
- [x] API connection status beside the balance, with click-to-refresh balance updates
- [x] Automatic update checks against this repository's GitHub Releases, with installation of available updates
- [x] One black application icon shared by the splash screen, window, tray, and installer
- [x] An accessible title-bar emoji that reports local application workload

“Worktree” refers to a project view rooted in the selected Workspace; it does not manage Git worktree checkouts. The [Desktop 0.3 plan](../../.agents/notes/proposed/feature/2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md) defines the scope and acceptance criteria.

The switch is contributed by `bridge-client` through the existing sidebar plugin lifecycle. It portals desktop chrome into the Workspace region and leaves the shared `ui-workspace` package and its browser registration unchanged; unloading the desktop plugin removes the switch and restores the standard web composition.

## Run (test version)

Prerequisites:

- Rust toolchain (rustc/cargo)
- Node ^22.19 || >=24 on PATH (or set DSH_NODE to an explicit executable)
- The repo built: `pnpm run build` — build:lib emits every workspace package's lib/ (the web profile resolves its whole plugin roster through the profile's module fallback, which points at this checkout in dev) and build:web emits the frontend dist. A partial checkout (only apps/cli built) fails at boot with ERR_MODULE_NOT_FOUND for the missing package libs.

Start:

    node apps/desktop/scripts/dev.mjs
    # or, after a workspace install:
    pnpm --filter @deepseek-ai/dsh-desktop dev

The dev launcher sets DSH_CLI to the built apps/cli/lib/bin.js; DSH_NODE defaults to 'node' from PATH. The shell spawns 'dsh web --port 0 --no-open' (OS-assigned free port) and parses the readiness line from the runtime's stdout; `--no-open` keeps the web profile from handing the URL to the system default browser because the shell navigates its own window to it.

## Bundle (local installer)

    pnpm --filter @deepseek-ai/dsh-desktop bundle

runs five stages: sync the version into tauri.conf.json from package.json (`scripts/sync-version.mjs`), build the bridge packages from source (`scripts/build-bridge.mjs`), bake the runtime (`scripts/bake-runtime.mjs`), fetch the bundled Node sidecar (`scripts/fetch-node-sidecar.mjs`), then 'tauri build' (release profile with lto/strip; NSIS installer to src-tauri/target/release/bundle/nsis/). The version lives only in package.json, so a bump is one edit there. Proxy note: the first bundle downloads the NSIS toolchain and the Node sidecar from GitHub/nodejs.org; set HTTPS_PROXY/HTTP_PROXY if the machine needs a proxy to reach them.

The installer is self-contained: it ships the shell exe, node.exe (Tauri externalBin sidecar), and the baked runtime under resources/runtime/. On first launch the shell copies the bridge packages into the profile (no npm exists at runtime), heals the profile fallback for built-in packages, and navigates to the served UI. Profile-installed bundles remain resolvable from the profile's own node_modules.

## Packaged runtime

`scripts/bake-runtime.mjs` produces a self-contained, bootable runtime from the built workspace:

1. `pnpm deploy --legacy --prod --config.nodeLinker=hoisted` the dsh CLI closure. Production-only deploy drops the workspace's dev/build/lint/docs toolchain (TypeScript, oxlint, eslint, mermaid, ...); the spine packages stay reachable through dsh-base's dependencies. Hoisted linking is required — the isolated layout only exposes direct deps at the top level, while the profile fallback exposes the deployed closure to built-in package resolution.
2. Bakes the auto-installed peers pnpm deploy drops (autoInstallPeers is not reproduced by deploy) plus the desktop bridge packages, copying each workspace package's shipped files (never its node_modules).
3. Prunes single-platform native prebuilds: node-pty ships every platform plus Windows debug symbols (.pdb) and build-time sources; `pruneRuntime` keeps only the win32-x64 prebuild.
4. Verifies the result by booting the deployed CLI against a throwaway DSH_HOME, requiring the 'dsh web:' readiness line while preserving profile-owned bundle resolution.

Payload size gate: `pnpm --filter @deepseek-ai/dsh-desktop size-check` (or `node scripts/size-report.mjs --check`) asserts the runtime stays under its budget and that no dev toolchain leaked back in.

## Startup splash

The app opens a frameless splashscreen window first and reveals the main window only after the `dsh web:` readiness line arrives. The splash (`apps/desktop/src/splashscreen.html`) runs pre-boot environment checks — WebView2, the Node sidecar, the baked runtime, the data directory, and API key — recording each step on a polled status board; failures stay on the splash with a retry, and a `下载 / 修复 WebView2` link opens Microsoft's download page via tauri-plugin-opener.

WebView2 acquisition is an install-time concern: `bundle.windows.webviewInstallMode` is `embedBootstrapper`, so the NSIS installer embeds the bootstrapper and downloads/installs the runtime with native progress. The splash cannot install a missing WebView2 itself (it is a WebView2 page); it only detects and guides.

Env wiring in main.rs: DSH_CLI/DSH_NODE/DSH_BARE_MODULE_BASE/DSH_BRIDGE_TARBALL win (dev launcher); a release build without DSH_CLI falls back to resources/runtime/lib/bin.js, the sidecar node.exe, and offline bridge copying. A packaged launch leaves DSH_BARE_MODULE_BASE unset by default so the profile can resolve user bundles; an explicit value remains available for hosts that own the complete plugin set.

## Custom title bar

The window is frameless; the title bar is a single injected element whose source is apps/desktop/src/titlebar.js — loaded by the loading page via a script tag and re-injected into the main webview on every completed page load (main.rs embeds the file with include_str!, and the script is idempotent). Its API, workload, and balance labels follow the live `<html lang>` value, so an asynchronous locale preference cannot leave the chrome in a stale language.

Theme following: the bar consumes the dsh theme tokens that ui-theme writes on <body> — background rides the sidebar-fill token (--dsw-specific-sidebar-fill, documented by ui-theme as the title-row background) and the rest ride the --dsw-alias-* set; switching the theme in the dsh settings (or the system dark mode) repaints the bar automatically with no shell-side state. Window controls run through the remote capability (capabilities/remote.json, URLPattern `http://127.0.0.1:*`); drag uses startDragging(); double-clicking the drag strip toggles maximize like the button (a fullscreen guard restores before dragging if fullscreen was entered another way).

Left of the title, the bar shows a version badge next to the app title: main.rs prepends a `window.__DSH_DESKTOP_VERSION__` global before eval'ing the script (the value comes from tauri.conf.json's version, synced from package.json), so the badge always shows the packaged app version; the loading page has no global and renders the bare title.

Right of the title (before the window controls), the bar shows API state, local application workload, and the DeepSeek account balance. API state is `checking`, `connected`, `unavailable`, or `unconfigured`; the bridge host derives it from the same credential-safe `/dsh-bridge/balance` request and never sends the API key to the browser. The balance control refreshes on click, deduplicates in-flight requests, exposes `aria-busy`, polls every 5 minutes, refreshes when the window becomes visible, stays hidden until the first successful read, and keeps the last good amount while a refresh fails. The native `runtime_status` command samples the desktop process and managed runtime descendants at a low frequency and returns only `unknown`, `calm`, `active`, `busy`, or `saturated`; asymmetric thresholds and a four-second minimum dwell prevent rapid changes. The emoji has a localized text label and renders a neutral state when sampling is unavailable. The updater control is rebuilt on `locale/change`, so its status and confirmation copy follow the same preference.

The splash screen and packaged icon family use the same black transparent source at `apps/desktop/src/icon.svg`. `scripts/gen-icons.mjs` emits 16, 32, 48, 256, and 512 pixel PNG-backed assets; the splash uses the SVG on a light neutral backing shape for contrast.

## Automatic updates

After the main page boots, the title bar checks the published GitHub Release manifest at `latest.json` and reports no update, an available version, download progress, installation readiness, or a categorized recoverable failure. Download and installation require separate user confirmations; Windows uses Tauri's passive installer mode and restarts the application during installation.

The updater accepts only an artifact whose detached signature matches the public key embedded in `src-tauri/tauri.conf.json`. Draft Release assets are not update endpoints; publish the accepted Release before clients can discover it. The tag-gated workflow requires the matching `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret, runs Tauri in CI mode, and never stores the private key in the repository or application. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional for password-protected keys and is unnecessary for a passwordless key.

Known test-version gaps: no Windows 11 snap-layout flyout (frameless), resize borders come from tao's default hit-testing, maximize icon syncs on click/resize events.

## Drag and drop

The shell owns OS file drops through Tauri's drag-drop handler (`onDragDropEvent`, enabled by default — the window no longer sets `dragDropEnabled: false`). WebView2 cannot expose dropped-file paths (`File.path` does not exist there), so this is the only route that yields real filesystem paths; the browser page never sees the OS drag itself.

The bridge client listens on the main window and handles a drop as follows:

- Image files are read back through the shell's bounded `read_dropped_file` command (base64, 20 MiB cap, only paths from the recent drop are readable) and re-entered into the dsh composer's native image intake as a synthetic drop — image previews keep working exactly like before.
- Every other file has its path inserted into the composer input box as text (one path per line), ready to send to the agent. A dropped folder's path lands the same way.
- While the OS drag is over the window, a full-window overlay shows "拖放文件到输入框" (drag feedback the page cannot render itself, since it never receives the drag events).

The bridge's old copy-to-`drops/` machinery and its policy rows were removed with this change; the model sees the paths the user chose, and only the paths.

## Shell bridge

The shell installs the dsh-desktop-bridge packages into the web profile as plain directory copies — dev mode copies them from this checkout (apps/desktop/bridge, apps/desktop/bridge-client, and the vendored schemastery), a packaged boot copies them from the runtime — and mounts bridge/cordis.patch.yml on every boot. The bridge packages are not pnpm workspace members, so every desktop flow builds them first via scripts/build-bridge.mjs (the npm `dev`/`build`/`bake`/`bundle` scripts wire it in); dev mode re-copies on every boot so a rebuilt bridge always reaches the profile, and a packaged boot re-syncs the profile copy from the runtime for the same reason. (No npm install anywhere: the published @deepseek-ai manifests carry workspace: protocol specs that npm's peer auto-install cannot resolve.)

Bridge host routes (under /dsh-bridge):

- `GET /config` — the effective desktop settings (close-to-tray, debug mode, and Logo hover motion), read per request so settings-page saves take effect immediately.
- `POST /policy` — persist desktop settings through the runtime's settings seam ($DSH_HOME/settings.yaml). The dsh configuration boundary refuses browser writes to non-listed namespaces, so the settings rows save through this route instead of the client settingsScope.
- `GET /balance` — the title bar's balance pill: resolves the DeepSeek key through the credentials service and proxies the official /user/balance endpoint (see "Custom title bar").
- `GET /worktree/explorer` — lists one bounded directory level for a registered Workspace; the request accepts only a Workspace id and a Workspace-relative path, and the response marks truncation and paths resolved outside the Workspace.

The bridge client half owns the shell-side behaviors on the page: the drag-drop handling above, the close-button mirror, the debug guard, and Explorer path routing.

## Desktop settings, tray, and close behavior

The dsh settings page's 桌面设置 (Desktop) section (registered by the bridge client) hosts three rows, all persisted through the bridge host route:

- 关闭按钮行为 (Close button behavior): an explicit choice between closing and exiting the application or hiding the window while retaining it in the system tray. The retained runtime keeps serving and sessions keep running; the tray menu's 退出 stops the runtime child and terminates the app.
- 调试模式 (Debug mode): while off, right-click and devtools shortcuts are suppressed, and the shell flips WebView2's AreDevToolsEnabled.
- 新会话 Logo 动效 (New-session Logo animation): an explicit opt-in for the centered fish Logo hover animation; enabling it overrides the system reduced-motion preference for this cue only.

Both settings are stored in the bridge settings namespace ($DSH_HOME/settings.yaml, same seam as every other setting), with static fallbacks in the bridge row config:

    - id: desktop-bridge
      config:
        closeToTray: false
        debugMode: false
        logoMotion: false

The close-to-tray value lives in the runtime, but the close interception happens in the shell: the bridge client mirrors the durable value into Rust via the `set_close_to_tray` command on boot and on every settings change, and the main window's `CloseRequested` handler hides instead of closing while it is set.

The tray itself always exists: left-click (or the 显示主窗口 menu item) shows and focuses the main window; right-click opens the menu. The tray icon is the app's bundled icon (default_window_icon).

## Open with dsh-desktop (Explorer context menu)

On every start the shell (re)registers a per-user Explorer context-menu entry under HKCU (no elevation needed), so the command always points at the current executable:

- `Software\Classes\Directory\shell\dsh-desktop` — right-click on a folder row shows 以 dsh-desktop 打开.
- `Software\Classes\Directory\Background\shell\dsh-desktop` — the same entry for right-click on a folder's empty background.

The menu runs `<exe> <folder>`. The application is single-instance: when it is already running, the second process forwards the canonical folder to the existing window, brings that window forward, and exits. The bridge client selects the Workspace with the longest ancestor path, so a right-click in a nested Workspace resolves to the most specific owner. It opens that Workspace's most recent session, or starts one when none exists. When no Workspace owns the directory, the page asks before registering that directory as a new Workspace and opening it.

Registration is best-effort and logged on failure. Because the application writes these keys rather than the installer, the uninstaller removes them through the `NSIS_HOOK_POSTUNINSTALL` macro in `src-tauri/installer-hooks.nsh` (wired by `bundle.windows.nsis.installerHooks`); NSIS `installMode` stays at its `currentUser` default, so the unelevated uninstaller sees the installing user's HKCU. An update reinstall runs the same hook, and the next launch re-registers the entries.

## Test-version scope

- Dev runs the repo-built CLI on the PATH 'node'; the packaged app carries its own Node sidecar and baked runtime (see Bundle / Packaged runtime above). The updater is available on the supported Windows package; the Windows-only sidecar means Linux/macOS are unhandled (node-pty also lacks Linux prebuilds in the dsh dependency tree).
- Icons derive from the DeepSeek fish logo (regenerate via `node scripts/gen-icons.mjs`); the tray reuses the bundled window icon.
- Closing the window terminates the runtime process unless close-to-tray is enabled (see "Desktop settings, tray, and close behavior"); sessions persist on disk under $DSH_HOME.
- The window binds nothing of its own: the runtime still serves only loopback (127.0.0.1) with no auth, matching 'dsh web' posture.

## Layout

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host + node sidecar binaries/
    scripts/        dev launcher, runtime baker, and node sidecar fetcher
