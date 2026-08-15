# Agent Note: Closed packaged runtime for dsh-desktop

Status: implemented

English | [中文](2026-08-15-desktop-packaged-runtime.zh.md)

## Problem

The dsh-desktop Tauri shell boots the dsh web profile by spawning a Node process running the CLI. For a distributable installer the runtime (CLI, web frontend, plugins, native addons) must travel inside the app with no path back into a checkout, and must boot without npm.

## Decision

Produce the runtime with `apps/desktop/scripts/bake-runtime.mjs`:

1. `pnpm deploy --legacy --config.nodeLinker=hoisted` the dsh CLI closure — FULL, not `--prod`, because this monorepo models the web profile's runtime plugins as CLI devDependencies, so `--prod` prunes exactly what the profile needs. Hoisted linking is mandatory: the loader resolves config-referenced plugin names from the runtime's own bin, and the isolated layout only surfaces direct dependencies at the top level.
2. Bake the auto-installed peers `pnpm deploy` drops (`autoInstallPeers: true` in the workspace is not reproduced by deploy) plus the desktop bridge packages, copying each workspace package's shipped `files` entries and never its `node_modules`.
3. Verify by booting the deployed CLI against a throwaway `DSH_HOME`, requiring the `dsh web:` readiness line.

Bare plugin names anchor to the runtime through a new `DSH_BARE_MODULE_BASE` env var: `apps/cli` passes it to `boot()`'s `bareModuleBaseUrl` (the documented closed-runtime resolution anchor), which routes bare names through the host's node_modules while relative names stay profile-relative. `main.rs` sets it to the runtime's own `lib/bin.js` file URL in packaged mode.

Packaged resolution in `main.rs`: env wiring (`DSH_CLI`/`DSH_NODE`/`DSH_BARE_MODULE_BASE`/`DSH_BRIDGE_TARBALL`) wins for the dev launcher; a build without `DSH_CLI` falls back to `resources/runtime/lib/bin.js`, the sidecar `node.exe` (Tauri `externalBin`, gitignored, fetched by `scripts/fetch-node-sidecar.mjs`), and offline bridge copying. The bridge packages travel in the runtime and are copied into the profile at first boot — a packaged app has no npm, and the dev npm-tarball path remains for the dev launcher.

## Alternatives considered

- **Isolated linker deploy** — the pnpm default; the closure resolved but config-referenced plugins (e.g. `dsh-typert-registry`) and auto-installed peers were missing, forcing a long boot-driven bake tail. Rejected in favor of hoisted linking, which is the natural shape for a closed install.
- **Full Node distribution as the sidecar** — keeps npm for the bridge install, but the bridge's prod dependency (`schemastery`) would still need the registry; offline requires copying packages anyway. The sidecar ships `node.exe` only.
- **`--prod` deploy** — halves the payload but drops the runtime plugin set (CLI devDependencies); rejected.
