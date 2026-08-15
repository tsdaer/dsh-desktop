# @deepseek-ai/dsh-desktop

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

## Custom title bar

The window is frameless; the title bar is a single injected element whose source is apps/desktop/src/titlebar.js — loaded by the loading page via a script tag and re-injected into the dsh web page after navigation (main.rs embeds the file with include_str!, idempotent retries).

Theme following: the bar consumes the dsh theme tokens that ui-theme writes on <body> — background rides the sidebar-fill token (--dsw-specific-sidebar-fill, documented by ui-theme as the title-row background) and the rest ride the --dsw-alias-* set; switching the theme in the dsh settings (or the system dark mode) repaints the bar automatically with no shell-side state. Window controls run through the remote capability (capabilities/remote.json, URLPattern http://127.0.0.1:*); drag uses startDragging(); double-clicking the drag strip toggles maximize like the button (a fullscreen guard restores before dragging if fullscreen was entered another way).

Known test-version gaps: no Windows 11 snap-layout flyout (frameless), resize borders come from tao's default hit-testing, maximize icon syncs on click/resize events.

## Drag and drop

Native file drops are enabled by disabling the Tauri drag-drop handler ("dragDropEnabled": false): WebView2 delivers OS drops straight to the dsh page, whose own document-level intake (InputBar + DropOverlay) accepts images into the composer with browser-identical behavior. Non-image files follow the dsh page's own filtering.

## Test-version scope

- The runtime is the locally built dsh CLI run by the PATH 'node'; the production path (bundled Node sidecar, packaged CLI in app resources, installer via 'tauri build') is deferred.
- Icons derive from the DeepSeek fish logo (regenerate via `node scripts/gen-icons.mjs`); no auto-update, no tray, no single-instance lock yet.
- Linux is not handled yet (node-pty has no Linux prebuilds in the dsh dependency tree).
- Closing the window terminates the runtime process; sessions persist on disk under $DSH_HOME.
- The window binds nothing of its own: the runtime still serves only loopback (127.0.0.1) with no auth, matching 'dsh web' posture.

## Layout

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host
    scripts/        dev launcher that wires DSH_CLI to the built CLI