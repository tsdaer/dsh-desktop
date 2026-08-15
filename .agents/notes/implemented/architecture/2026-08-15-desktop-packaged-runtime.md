# Agent Note: Closed packaged runtime for dsh-desktop

Status: implemented

English | [中文](2026-08-15-desktop-packaged-runtime.zh.md)

## Problem

The dsh-desktop Tauri shell boots the dsh web profile by spawning a Node process running the CLI. For a distributable installer the runtime (CLI, web frontend, plugins, native addons) must travel inside the app with no path back into a checkout, and must boot without npm.

## Decision

Produce the runtime with `apps/desktop/scripts/bake-runtime.mjs`:

1. `pnpm deploy --legacy --prod --config.nodeLinker=hoisted` the dsh CLI closure. Production-only deploy drops the workspace's dev/build/lint/docs toolchain (TypeScript, oxlint, eslint, mermaid — ~300 MB of the original 573.8 MB payload). The web profile's spine packages remain reachable through `dsh-base`'s dependencies, and the scan/bake loop below restores every auto-installed peer and config-referenced plugin that `--prod` prunes, so no dedicated manifest package is needed. Hoisted linking is mandatory: the loader resolves config-referenced plugin names from the runtime's own bin, and the isolated layout only surfaces direct dependencies at the top level.
2. Bake the auto-installed peers `pnpm deploy` drops (`autoInstallPeers: true` in the workspace is not reproduced by deploy) plus the desktop bridge packages, copying each workspace package's shipped `files` entries and never its `node_modules`.
3. Prune single-platform native prebuilds: `node-pty` ships every platform plus Windows `.pdb` symbols and build-time sources; `pruneRuntime` keeps only the `win32-x64` prebuild (62.6 MB → 2.6 MB). `scripts/size-report.mjs --check` (a budget plus a dev-tool leakage assertion) pins the baked payload after every bake.
4. Verify by booting the deployed CLI against a throwaway `DSH_HOME`, requiring the `dsh web:` readiness line.

Bare plugin names anchor to the runtime through `DSH_BARE_MODULE_BASE`: `apps/cli` passes it to `boot()`'s `bareModuleBaseUrl` (the documented closed-runtime resolution anchor), which routes bare names through the host's node_modules while relative names stay profile-relative. `main.rs` sets it to the runtime's own `lib/bin.js` file URL in packaged mode.

Packaged resolution in `main.rs`: env wiring (`DSH_CLI`/`DSH_NODE`/`DSH_BARE_MODULE_BASE`/`DSH_BRIDGE_TARBALL`) wins for the dev launcher; a build without `DSH_CLI` falls back to `resources/runtime/lib/bin.js`, the sidecar `node.exe` (Tauri `externalBin`, gitignored, fetched by `scripts/fetch-node-sidecar.mjs`), and offline bridge copying. The bridge packages travel in the runtime and are copied into the profile at first boot — a packaged app has no npm, and the dev npm-tarball path remains for the dev launcher.

Two Windows packaging facts this closed install surfaced, both owned here:

- `resource_dir()` returns a `\\?\`-prefixed verbatim path; node's `realpath` cannot resolve it (`EISDIR` on the drive letter), so the runtime exited before printing its readiness line. `packaged()` strips the prefix with `dunce::simplified` before handing the path to node or `Url::from_file_path`.
- The profile template's `cordis.patch.yml` is a comment header plus an empty `[]` list; `install_profile_patch` must replace that `[]` with the bridge rows, not append after it (appending produces a second YAML document and breaks the profile parse). The bridge packages also resolve one level deeper than the original code (`resource_dir/runtime/node_modules`, two parents from `lib/bin.js`).

## Alternatives considered

- **Isolated linker deploy** — the pnpm default; the closure resolved but config-referenced plugins (e.g. `dsh-typert-registry`) and auto-installed peers were missing, forcing a long boot-driven bake tail. Rejected in favor of hoisted linking, which is the natural shape for a closed install.
- **Full Node distribution as the sidecar** — keeps npm for the bridge install, but the bridge's prod dependency (`schemastery`) would still need the registry; offline requires copying packages anyway. The sidecar ships `node.exe` only.
- **FULL deploy (the original choice)** — the dev/build/lint/docs toolchain leaked into the payload (~300 MB); rejected once `--prod` plus the scan/bake loop proved it restores every runtime plugin.

## Consequences

The baked payload is ~185.7 MB (down from 573.8 MB); `size-report --check` pins the budget and the dev-tool leakage assertion after every bake. The two Windows facts above document the guards a future packaging change must not reintroduce: a raw `resource_dir()` path handed to node, or appending a patch after the profile's empty `[]`.
