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