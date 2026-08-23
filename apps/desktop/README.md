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
- [x] Whole-file Source Control writes: stage, unstage, discard (with a file-naming confirmation), commit with a message confined to the selected Workspace, and diff viewing through the shared diff presentation
- [x] An in-app read-only file viewer for Explorer rows and Search results, with truncation and binary refusal states and matched-line scrolling
- [x] A visually consistent copy action beside every ordinary user and assistant message
- [x] API connection status beside the balance, with click-to-refresh balance updates
- [x] Automatic update checks against this repository's GitHub Releases, with installation of available updates
- [x] One black application icon shared by the splash screen, window, tray, and installer
- [x] An accessible title-bar emoji that reports local application workload

“Worktree” refers to a project view rooted in the selected Workspace; it does not manage Git worktree checkouts. The [Desktop 0.3 plan](../../.agents/notes/proposed/feature/2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md) defines the scope and acceptance criteria.

Source Control requests carry browser cancellation signals. Switching Workspaces or leaving Worktree cancels in-flight mutations, commits, and diff reads; canceled responses do not update the new view. If the bridge reconnects, use Refresh to issue a new Git status request. The lifecycle decision is recorded in the [Source Control request lifecycle note](../../.agents/notes/implemented/bug-fix/2026-08-22-desktop-source-control-request-lifecycle.md).

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

For repeatable browser evidence, run:

    pnpm --filter @deepseek-ai/dsh-desktop evidence

The evidence command builds the standalone bridge packages, creates a throwaway `DSH_HOME`, initializes the web profile and its module fallback, installs the bridge packages without replacing the fallback's `@deepseek-ai/schemastery` symlink, merges the bridge patch, registers the repository as a Workspace, and serves port 4173. It prints the ready URL and the `/dsh-bridge/config` probe URL; open the ready URL in a browser and select Worktree (shown as 项目文件 in the Chinese UI). Use `-- --port <port> --workspace <directory>` to change the port or Workspace, and press Ctrl+C to remove the scratch home and stop the server.

## Bundle (local installer)

    pnpm --filter @deepseek-ai/dsh-desktop bundle

runs the target-aware preparation stages: sync the version from package.json into tauri.conf.json, Cargo.toml, and Cargo.lock (`scripts/sync-version.mjs`), build the bridge packages from source (`scripts/build-bridge.mjs`), run the target script tests, fetch the matching Node sidecar (`scripts/fetch-node-sidecar.mjs`), bake the target-owned runtime with that sidecar (`scripts/bake-runtime.mjs`), then run `tauri build` (release profile with lto/strip). Pass a Rust target explicitly with `pnpm --filter @deepseek-ai/dsh-desktop bundle -- --target <triple>`; without it, the scripts use the host target reported by `rustc -vV`. The command merges the reviewed base config with one target layer under `src-tauri/tauri.<target>.conf.json`, and validates the effective bundle targets and runtime resource before Tauri runs. Target output is under `src-tauri/target/<triple>/release/bundle/`: Windows uses NSIS, Linux uses AppImage and deb, and macOS uses app and dmg. Release inventory reads the expected direct artifacts, ignores Tauri's unpacked working directories, and still rejects unexpected direct files. The Linux release build runs on Ubuntu 22.04, passes `--verbose` so linuxdeploy diagnostics remain visible, and sets `NO_STRIP=1` because the Rust executable is already stripped by the release profile and bundled prebuilt ELF files must remain unchanged. Native target runners are required for native runtime and packaging evidence. The version lives only in package.json, so a bump is one edit there; `pnpm --filter @deepseek-ai/dsh-desktop version-check` asserts the propagated sources agree without writing, and the release workflow refuses a tag that fails it. Proxy note: the first bundle downloads the target toolchain and Node sidecar from GitHub/nodejs.org; set HTTPS_PROXY/HTTP_PROXY if the machine needs a proxy to reach them.

The Linux release runner records its glibc, GTK, WebKitGTK, and packaging-tool versions with `pnpm --filter @deepseek-ai/dsh-desktop linux-baseline -- --target x86_64-unknown-linux-gnu`. Add `--output <file>` to retain the JSON record as a build artifact. This records the build environment; it does not establish compatibility with older distributions.

Target-native package startup smoke is available through `pnpm --filter @deepseek-ai/dsh-desktop packaged-smoke -- --target <triple> --artifact <path>`. Filtered pnpm scripts execute from the package directory, so workflow callers resolve artifact arguments to absolute paths before invoking them. Windows installs an NSIS artifact with `--install-nsis`; Linux accepts an AppImage or, with `--install-deb`, a deb; macOS accepts an app bundle or, with `--install-dmg`, a dmg. The AppImage path launches its root `AppRun` entry so GTK hooks and the `$APPDIR/usr` working directory used by WebKit helper lookup remain active. The dmg path uses a temporary installation root separate from `DSH_HOME`, matching the separation between `/Applications` and user data, and resolves that root before launch so macOS's `/var` alias does not become a symlinked executable ancestor rejected by Tauri. A startup timeout includes the isolated native splash log. The smoke launches the installed executable, waits for the runtime readiness URL, verifies that managed descendants exit, runs the packaged PTY probe when `--terminal-smoke` is present, and checks that the temporary `DSH_HOME` remains after package removal. Linux can add `--web-smoke` to open the installed package's readiness URL in Chromium, require the composer DOM to mount, and retain a screenshot; this validates the packaged runtime and HTTP UI while native Tauri WebView evidence remains separate. It requires the target runner and does not replace updater, minimum-distribution, or GUI evidence.

The deb smoke creates a user-data marker before installation and requires it to survive package purge. This verifies the package's uninstall path without treating the disposable smoke home as application-owned data. It reads the package-owned file inventory with a bounded output allowance large enough for the baked runtime and reuses that inventory for executable, sidecar, and runtime discovery. Production runtime baking removes the workspace's development dependencies, so the Linux release job restores the frozen development install before installing Chromium and running package, native UI, and replay probes. The job also replays the keyless `navigation-panes` browser scenario under Chromium, covering the assembled Web profile's model-facing terminal card and navigation interactions. That replay is separate from the installed-package smoke and does not claim installed GUI evidence; the installed version-N to version-N+1 update still requires its target-native acceptance workflow.

The Linux-only `pnpm --filter @deepseek-ai/dsh-desktop native-ui-smoke -- --target x86_64-unknown-linux-gnu --artifact <deb> --screenshot <path>` installs the deb, starts `tauri-driver` against the installed executable, restores the committed keyless `navigation-panes` session, opens it through the native WebKit WebView, verifies the composer and model-facing terminal card, and captures a screenshot before purging the package. The runner needs `webkit2gtk-driver`, `tauri-driver`, and an X display such as `xvfb`; the fixture uses a temporary plaintext session-persistence override and must not be treated as live model or minimum-distribution evidence.

The installer is self-contained: it ships the shell executable, the Node sidecar (Tauri externalBin), and the baked runtime under resources/runtime/. Tauri reads a target-suffixed source such as `dsh-node-x86_64-pc-windows-msvc.exe` but installs it as the product-owned `dsh-node.exe` on Windows or `dsh-node` on POSIX, avoiding collisions with a system Node installation. Source runtime directories live under `src-tauri/runtime/<product-target>`, and the target resolver rejects unsupported rows before staging files. On first launch the shell copies the bridge packages into the profile (no npm exists at runtime), heals the profile fallback for built-in packages, and navigates to the served UI. Profile-installed bundles remain resolvable from the profile's own node_modules.

macOS arm64 also has an unsigned build-only command: `pnpm --filter @deepseek-ai/dsh-desktop bundle -- --target aarch64-apple-darwin --experimental`. It produces an app and dmg without updater artifacts; the result is compilation and packaging evidence, not a supported download or update channel. A signed and notarized macOS release requires the product's Developer ID and updater credentials.

## Packaged runtime

`scripts/bake-runtime.mjs` produces a self-contained, bootable runtime from the built workspace:

1. `pnpm deploy --legacy --prod --config.nodeLinker=hoisted` the dsh CLI closure. Production-only deploy drops the workspace's dev/build/lint/docs toolchain (TypeScript, oxlint, eslint, mermaid, ...); the spine packages stay reachable through dsh-base's dependencies. Hoisted linking is required — the isolated layout only exposes direct deps at the top level, while the profile fallback exposes the deployed closure to built-in package resolution.
2. Bakes the auto-installed peers pnpm deploy drops (autoInstallPeers is not reproduced by deploy) plus the desktop bridge packages, copying each workspace package's shipped files (never its node_modules).
3. Prunes and validates native files: every `prebuilds` directory keeps only the selected target when a compatible prebuild exists, otherwise a target source build beside it is accepted and foreign prebuilds are removed; a target-specific Koffi package keeps only its selected ABI directory, so a glibc runtime cannot retain a musl addon; `node-pty` and `koffi` must contain a loadable native binary when present, and foreign-platform dynamic libraries or helpers fail the bake before boot verification.
4. Verifies the result by booting the deployed CLI with the target sidecar against a throwaway DSH_HOME, requiring the 'dsh web:' readiness line while preserving profile-owned bundle resolution.

Payload size gate: `pnpm --filter @deepseek-ai/dsh-desktop size-check` (or `node scripts/size-report.mjs --check`) asserts the runtime stays under its budget and that no dev toolchain leaked back in.

## Startup splash

The app opens a frameless splashscreen window first and reveals the main window only after the `dsh web:` readiness line arrives. The splash (`apps/desktop/src/splashscreen.html`) runs pre-boot environment checks — the platform webview, the Node sidecar, the baked runtime, the data directory, and API key — recording each step on a polled status board; failures stay on the splash with a retry. Windows exposes a `下载 / 修复 WebView2` link through tauri-plugin-opener; Linux and macOS report their platform webview limitation instead of offering the Microsoft repair action.

WebView2 acquisition is an install-time concern: `bundle.windows.webviewInstallMode` is `embedBootstrapper`, so the NSIS installer embeds the bootstrapper and downloads/installs the runtime with native progress. The splash cannot install a missing WebView2 itself (it is a WebView2 page); it only detects and guides.

Env wiring in main.rs: DSH_CLI/DSH_NODE/DSH_BARE_MODULE_BASE/DSH_BRIDGE_TARBALL win (dev launcher); a release build without DSH_CLI requires resources/runtime/lib/bin.js and Tauri's installed `dsh-node.exe` or `dsh-node` beside the app executable, then performs offline bridge copying. A packaged launch leaves DSH_BARE_MODULE_BASE unset by default so the profile can resolve user bundles; an explicit value remains available for hosts that own the complete plugin set.

## Custom title bar

The window is frameless; the title bar is a single injected element whose source is apps/desktop/src/titlebar.js — loaded by the loading page via a script tag and re-injected into the main webview on every completed page load (main.rs embeds the file with include_str!, and the script is idempotent). Its API, workload, and balance labels follow the live `<html lang>` value, so an asynchronous locale preference cannot leave the chrome in a stale language.

Theme following: the bar consumes the dsh theme tokens that ui-theme writes on <body> — background rides the sidebar-fill token (--dsw-specific-sidebar-fill, documented by ui-theme as the title-row background) and the rest ride the --dsw-alias-* set; switching the theme in the dsh settings (or the system dark mode) repaints the bar automatically with no shell-side state. Window controls run through the remote capability (capabilities/remote.json, URLPattern `http://127.0.0.1:*`); drag uses startDragging(); double-clicking the drag strip toggles maximize like the button (a fullscreen guard restores before dragging if fullscreen was entered another way).

Left of the title, the bar shows a version badge next to the app title: main.rs prepends a `window.__DSH_DESKTOP_VERSION__` global before eval'ing the script (the value comes from tauri.conf.json's version, synced from package.json), so the badge always shows the packaged app version; the loading page has no global and renders the bare title.

Right of the title (before the window controls), the bar shows API state, local application workload, and the DeepSeek account balance. API state is `checking`, `connected`, `unavailable`, or `unconfigured`; the bridge host derives it from the same credential-safe `/dsh-bridge/balance` request and never sends the API key to the browser. The balance control refreshes on click, deduplicates in-flight requests, exposes `aria-busy`, polls every 5 minutes, refreshes when the window becomes visible, stays hidden until the first successful read, and keeps the last good amount while a refresh fails. The native `runtime_status` command samples the desktop process and managed runtime descendants at a low frequency and returns only `unknown`, `calm`, `active`, `busy`, or `saturated`; asymmetric thresholds and a four-second minimum dwell prevent rapid changes. The emoji has a localized text label and renders a neutral state when sampling is unavailable. The updater control is rebuilt on `locale/change`, so its status and confirmation copy follow the same preference.

The splash screen and packaged icon family use the same black transparent source at `apps/desktop/src/icon.svg`. `scripts/gen-icons.mjs` emits 16, 32, 48, 256, and 512 pixel PNG-backed assets; the splash uses the SVG on a light neutral backing shape for contrast.

## Automatic updates

After the main page boots, the title bar checks the published GitHub Release manifest at `latest.json` and reports no update, an available version, download progress, installation readiness, or a categorized recoverable failure. `scripts/updater-manifest.mjs` accepts only the signed primary updater artifact for each target and rejects missing signatures, duplicate targets, unexpected names, and version mismatches. Download and installation require separate user confirmations; Windows uses Tauri's passive installer mode and restarts the application during installation.

The updater accepts only an artifact whose detached signature matches the public key embedded in `src-tauri/tauri.conf.json`. Draft Release assets are not update endpoints; publish the accepted Release before clients can discover it. The target-aware manifest uses `windows-x86_64`, `linux-x86_64`, and `darwin-aarch64` platform rows when those signed artifacts are present. The tag-gated workflow requires the matching `TAURI_SIGNING_PRIVATE_KEY` GitHub Secret, runs Tauri in CI mode, and never stores the private key in the repository or application. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional for password-protected keys and is unnecessary for a passwordless key.

An update-smoke fixture may pass `--download-base-url <http(s)://host/path>` to `scripts/updater-manifest.mjs` and `--updater-endpoint <http(s)://host/path/latest.json>` to `bundle` so a target runner can serve signed artifacts locally. The bundle command writes the endpoint to a temporary extra Tauri config layer; it rejects credentials, query strings, and fragments, and production builds retain the GitHub endpoint unless the option is explicit. The installed version-N to version-N+1 workflow still needs native installation, relaunch, user confirmation, and user-data evidence.

`pnpm --filter @deepseek-ai/dsh-desktop update-fixture -- --target <triple> --version <next-version> --artifact-root <staged-root>` validates the selected target's detached signature and serves its updater artifact plus a target-only `latest.json` from loopback. Build the version-N artifact with `bundle -- --updater-endpoint <printed-url>` before launching it; the fixture keeps running while the target runner performs the existing update confirmations. This helper does not approve, install, or claim the N-to-N+1 transition itself.

The installed update smoke uses that target-native package with `--update-smoke --expected-version <next-version>`. It enables an explicit runner-only driver that clicks the existing updater control, accepts the two existing confirmation calls, records the version written by each packaged launch, waits for the N-to-N+1 restart, stops the restarted process, and then checks user-data retention. The version-N package must embed the fixture URL, and the next-version artifact must be signed for the same target. This driver is not enabled by a normal launch and does not replace target-runner evidence for GUI behavior or minimum-distribution compatibility.

`pnpm --filter @deepseek-ai/dsh-desktop update-smoke -- --target <triple> --artifact <version-N-package> --next-version <version-N+1> --artifact-root <staged-root> --port <fixed-loopback-port>` starts the signed fixture, invokes `packaged-smoke` without shell interpolation, and closes the fixture server on success or failure. Build version N with the same fixed `--updater-endpoint` before running this command; it does not build either version or claim evidence on a non-native runner.

The target-native Linux N-to-N+1 check is available from the `Desktop Linux update acceptance` workflow. Provide two immutable tags and a fixed loopback port; the job builds version N with the fixture endpoint, builds and signs version N+1, stages its manifest, and runs the update smoke under `xvfb-run`. It uploads the smoke log but does not publish a release or mark Linux supported; minimum-distribution and packaged GUI evidence remain separate acceptance requirements.

The target-native macOS N-to-N+1 check is available from the `Desktop macOS update acceptance` workflow. Provide two immutable tags and a fixed loopback port; the job signs, notarizes, staples, and verifies both arm64 versions on `macos-14`, then runs the update smoke against the signed dmg and uploads its log. It consumes Apple and Tauri signing secrets, publishes no Release, and does not mark macOS supported; the workflow remains evidence-only until it passes with packaged GUI and Gatekeeper evidence.

The frameless main window re-adds `WS_THICKFRAME` (without `WS_CAPTION`) at setup, so the OS provides native resize borders and the Windows 11 snap-layout flyout while the title bar stays custom. The maximize icon reads window state from the native host: Rust pushes `dsh://maximize-change` on every size event and the title bar listens for it, with the polling read kept as a fallback.

## Drag and drop

The shell owns OS file drops through Tauri's drag-drop handler (`onDragDropEvent`, enabled by default — the window no longer sets `dragDropEnabled: false`). WebView2 cannot expose dropped-file paths (`File.path` does not exist there), so this is the only route that yields real filesystem paths; the browser page never sees the OS drag itself.

The bridge client listens on the main window and handles a drop as follows:

- Image files are read back through the shell's bounded `read_dropped_file` command (base64, 20 MiB cap, only paths from the recent drop are readable) and re-entered into the dsh composer's native image intake as a synthetic drop — image previews keep working exactly like before.
- Every other file has its path inserted into the composer input box as text (one path per line), ready to send to the agent. A dropped folder's path lands the same way.
- While the OS drag is over the window, a full-window overlay shows "拖放文件到输入框" (drag feedback the page cannot render itself, since it never receives the drag events).

The bridge's old copy-to-`drops/` machinery and its policy rows were removed with this change; the model sees the paths the user chose, and only the paths.

## Shell bridge

The shell installs the dsh-desktop-bridge packages into the web profile as plain directory copies — dev mode copies them from this checkout (apps/desktop/bridge, apps/desktop/bridge-client, and the vendored schemastery), a packaged boot copies them from the runtime — and mounts bridge/cordis.patch.yml on every boot. The bridge packages are pnpm workspace members but remain outside the ordinary workspace build globs, so every desktop flow builds them first via scripts/build-bridge.mjs (the npm `dev`/`build`/`bake`/`bundle` scripts wire it in); dev mode re-copies on every boot so a rebuilt bridge always reaches the profile, and a packaged boot re-syncs the profile copy from the runtime for the same reason. Runtime installation does not run npm: published @deepseek-ai manifests carry workspace: protocol specs that npm cannot resolve.

Bridge host routes (under /dsh-bridge):

- `GET /config` — the effective desktop settings (close-to-tray, debug mode, and Logo hover motion), read per request so settings-page saves take effect immediately.
- `POST /policy` — persist desktop settings through the runtime's settings seam ($DSH_HOME/settings.yaml). The dsh configuration boundary refuses browser writes to non-listed namespaces, so the settings rows save through this route instead of the client settingsScope.
- `GET /balance` — the title bar's balance pill: resolves the DeepSeek key through the credentials service and proxies the official /user/balance endpoint (see "Custom title bar").
- `GET /worktree/explorer` — lists one bounded directory level for a registered Workspace; the request accepts only a Workspace id and a Workspace-relative path, and the response marks truncation and paths resolved outside the Workspace.
- `GET /worktree/file` — reads one bounded file for a registered Workspace; the response is strict UTF-8 with an explicit truncation flag, and binary or non-UTF-8 content is refused with a stable error. Explorer rows and Search results open it in the in-app viewer, which highlights through the client's shiki highlighter and scrolls a Search result to its matched line.

The bridge client half owns the shell-side behaviors on the page: the drag-drop handling above, the close-button mirror, the debug guard, and Explorer path routing.

## Desktop settings, tray, and close behavior

The dsh settings page's 桌面设置 (Desktop) section (registered by the bridge client) hosts three rows, all persisted through the bridge host route:

- 关闭按钮行为 (Close button behavior): an explicit choice between closing and exiting the application or hiding the window while retaining it in the system tray. The retained runtime keeps serving and sessions keep running; the tray menu's 退出 stops the runtime child and terminates the app.
- Debug mode: while off, right-click and devtools shortcuts are suppressed. Windows also flips WebView2's `AreDevToolsEnabled`; Linux and macOS return an explicit platform limitation because their system webviews do not expose the same runtime control.
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

- Dev runs the repo-built CLI on the PATH 'node'; the packaged app carries its own Tauri-installed Node sidecar and baked runtime (see Bundle / Packaged runtime above). The tag-gated release workflow builds Windows x64 and Linux x64 draft artifacts from target-native jobs and attaches a separately labeled unsigned macOS arm64 experimental bundle to the same draft Release. The experimental macOS assets remain outside the supported release inventory; the supported updater and release package remain Windows x64 only until Linux native installation, update, uninstall, and packaged GUI evidence are complete, and macOS remains unsupported until signing, notarization, updater, installation, update, uninstall, and packaged GUI evidence are complete.
- Icons derive from the DeepSeek fish logo (regenerate via `node scripts/gen-icons.mjs`); the tray reuses the bundled window icon.
- Closing the window terminates the runtime process unless close-to-tray is enabled (see "Desktop settings, tray, and close behavior"); sessions persist on disk under $DSH_HOME.
- The window binds nothing of its own: the runtime still serves only loopback (127.0.0.1) with no auth, matching 'dsh web' posture.

## Layout

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host + node sidecar binaries/
    scripts/        dev launcher, runtime baker, and node sidecar fetcher
