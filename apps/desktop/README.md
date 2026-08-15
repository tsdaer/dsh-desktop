# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

A Tauri 2 desktop shell that hosts the 'dsh web' profile in a native window: the shell spawns a Node process running the dsh CLI, waits for the readiness URL line the web profile prints, and navigates the window to it.

## Run (test version)

Prerequisites:

- Rust toolchain (rustc/cargo)
- Node ^22.19 || >=24 on PATH (or set DSH_NODE to an explicit executable)
- The repo built: `pnpm run build:lib` (dsh CLI) and `pnpm run build:web` (web frontend dist)

Start:

    node apps/desktop/scripts/dev.mjs
    # or, after a workspace install:
    pnpm --filter @deepseek-ai/dsh-desktop dev

The dev launcher sets DSH_CLI to the built apps/cli/lib/bin.js; DSH_NODE defaults to 'node' from PATH. The shell spawns 'dsh web --port 0' (OS-assigned free port) and parses the readiness line from the runtime's stdout.

## Bundle (local installer)

    pnpm --filter @deepseek-ai/dsh-desktop bundle

runs three stages: bake the runtime (`scripts/bake-runtime.mjs`), fetch the bundled Node sidecar (`scripts/fetch-node-sidecar.mjs`), then 'tauri build' (release profile with lto/strip; NSIS installer to src-tauri/target/release/bundle/nsis/). Proxy note: the first bundle downloads the NSIS toolchain and the Node sidecar from GitHub/nodejs.org; set HTTPS_PROXY/HTTP_PROXY if the machine needs a proxy to reach them.

The installer is self-contained: it ships the shell exe, node.exe (Tauri externalBin sidecar), and the baked runtime under resources/runtime/. On first launch the shell copies the bridge packages into the profile (no npm exists at runtime), spawns the runtime with DSH_BARE_MODULE_BASE anchoring bare plugin names to the packaged tree, and navigates to the served UI.

## Packaged runtime

`scripts/bake-runtime.mjs` produces a self-contained, bootable runtime from the built workspace:

1. `pnpm deploy --legacy --prod --config.nodeLinker=hoisted` the dsh CLI closure. Production-only deploy drops the workspace's dev/build/lint/docs toolchain (TypeScript, oxlint, eslint, mermaid, ...); the spine packages stay reachable through dsh-base's dependencies. Hoisted linking is required — the isolated layout only exposes direct deps at the top level, and the loader resolves config-referenced plugins from the runtime's own bin.
2. Bakes the auto-installed peers pnpm deploy drops (autoInstallPeers is not reproduced by deploy) plus the desktop bridge packages, copying each workspace package's shipped files (never its node_modules).
3. Prunes single-platform native prebuilds: node-pty ships every platform plus Windows debug symbols (.pdb) and build-time sources; `pruneRuntime` keeps only the win32-x64 prebuild.
4. Verifies the result by booting the deployed CLI against a throwaway DSH_HOME with DSH_BARE_MODULE_BASE set, requiring the 'dsh web:' readiness line.

Payload size gate: `pnpm --filter @deepseek-ai/dsh-desktop size-check` (or `node scripts/size-report.mjs --check`) asserts the runtime stays under its budget and that no dev toolchain leaked back in.

## Startup splash

The app opens a frameless splashscreen window first and reveals the main window only after the `dsh web:` readiness line arrives. The splash (`apps/desktop/src/splashscreen.html`) runs pre-boot environment checks — WebView2, the Node sidecar, the baked runtime, the data directory, and API key — recording each step on a polled status board; failures stay on the splash with a retry, and a `下载 / 修复 WebView2` link opens Microsoft's download page via tauri-plugin-opener.

WebView2 acquisition is an install-time concern: `bundle.windows.webviewInstallMode` is `embedBootstrapper`, so the NSIS installer embeds the bootstrapper and downloads/installs the runtime with native progress. The splash cannot install a missing WebView2 itself (it is a WebView2 page); it only detects and guides.

Env wiring in main.rs: DSH_CLI/DSH_NODE/DSH_BARE_MODULE_BASE/DSH_BRIDGE_TARBALL win (dev launcher); a release build without DSH_CLI falls back to resources/runtime/lib/bin.js, the sidecar node.exe, and offline bridge copying. DSH_BARE_MODULE_BASE is a product wiring in apps/cli (profile-boot.ts passes it to boot's bareModuleBaseUrl, the documented closed-runtime resolution anchor).

## Custom title bar

The window is frameless; the title bar is a single injected element whose source is apps/desktop/src/titlebar.js — loaded by the loading page via a script tag and re-injected into the dsh web page after navigation (main.rs embeds the file with include_str!, idempotent retries).

Theme following: the bar consumes the dsh theme tokens that ui-theme writes on <body> — background rides the sidebar-fill token (--dsw-specific-sidebar-fill, documented by ui-theme as the title-row background) and the rest ride the --dsw-alias-* set; switching the theme in the dsh settings (or the system dark mode) repaints the bar automatically with no shell-side state. Window controls run through the remote capability (capabilities/remote.json, URLPattern `http://127.0.0.1:*`); drag uses startDragging(); double-clicking the drag strip toggles maximize like the button (a fullscreen guard restores before dragging if fullscreen was entered another way).

Known test-version gaps: no Windows 11 snap-layout flyout (frameless), resize borders come from tao's default hit-testing, maximize icon syncs on click/resize events.

## Drag and drop

Native file drops are enabled by disabling the Tauri drag-drop handler ("dragDropEnabled": false): WebView2 delivers OS drops straight to the dsh page, whose own document-level intake (InputBar + DropOverlay) accepts images into the composer with browser-identical behavior. Non-image files follow the dsh page's own filtering.

## Shell bridge

The shell auto-installs the dsh-desktop-bridge packages into the web profile (npm tarball copies, offline) and mounts bridge/cordis.patch.yml on every boot. The bridge host half serves POST /dsh-bridge/drop: it copies dropped non-image files into the session workspace's drops/ directory and injects a user-message announcement (durable, model-visible). The bridge client half forwards non-image drops (WebView2 File.path) to the route; images keep using the dsh composer's native intake.

## Bridge policy

The bridge accepts only files matching its policy: an extension allowlist (empty = every extension) and a size cap. Defaults: allow all extensions, 50 MiB.

The title bar's gear button opens a settings panel (persisted through tauri-plugin-store at the app config dir's settings.json); saved values take effect immediately — the bridge host reads the store file per request and the client refreshes the policy per drop. Static fallback lives in the bridge row config (see below), used until the store holds values:

    - id: desktop-bridge
      config:
        allowedExtensions: ['md', 'txt', 'pdf']
        maxBytes: 10485760

The client pre-filters before upload; the host enforces the same policy again at write time.

## Test-version scope

- Dev runs the repo-built CLI on the PATH 'node'; the packaged app carries its own Node sidecar and baked runtime (see Bundle / Packaged runtime above). Remaining gaps: no auto-update, no tray, no single-instance lock, and the Windows-only sidecar means Linux/macOS are unhandled (node-pty also lacks Linux prebuilds in the dsh dependency tree).
- Icons derive from the DeepSeek fish logo (regenerate via `node scripts/gen-icons.mjs`).
- Closing the window terminates the runtime process; sessions persist on disk under $DSH_HOME.
- The window binds nothing of its own: the runtime still serves only loopback (127.0.0.1) with no auth, matching 'dsh web' posture.

## Layout

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host + node sidecar binaries/
    scripts/        dev launcher, runtime baker, and node sidecar fetcher