# Agent Note: Desktop repeatable evidence server

Status: implemented

English | [中文](2026-08-21-desktop-evidence-server.zh.md)

## Problem

Desktop GUI evidence needs a live web profile with the desktop bridge, a registered Workspace, and a disposable home. Building that composition by hand makes recordings slow and leaves the runtime topology easy to misidentify.

## Decision

`pnpm --filter @deepseek-ai/dsh-desktop evidence` runs `scripts/build-bridge.mjs`, creates a temporary `DSH_HOME`, and invokes the built CLI once with `--dump-default-config` to initialize the web profile files. It allows the later `dsh web` launch to create the missing `profiles/node_modules` fallback, copies the built `dsh-desktop-bridge` and `dsh-desktop-bridge-client` packages into `profiles/node_modules/@deepseek-ai/`, leaves an existing `schemastery` fallback link untouched, and merges the bridge patch into `profiles/web/cordis.patch.yml` idempotently.

The command then starts `dsh web` on port 4173, creates a Workspace through `workspace.create` for the selected directory, probes `/dsh-bridge/config`, and prints the serving URL and probe URL. `-- --port <port> --workspace <directory>` changes the fixed port or selected Workspace; Ctrl+C stops the child and removes the temporary home unless `--keep-home` is supplied.

The operating-constraints reference distinguishes source and packaged process topologies by measuring the desktop executable path and the spawned Node command line. It does not assume that a live GUI serves from the repository checkout.

## Alternatives considered

**Reuse the running desktop application's home** — rejected: evidence would depend on user state, could mutate a real Workspace registry, and could keep the session under test inside the build workspace.

**Install `schemastery` with the bridge packages** — rejected: the profile fallback owns that package as an installation symlink, and replacing it with a real directory breaks the module-resolution invariant.

**Register a Workspace by editing storage files** — rejected: the evidence environment must exercise the same RPC and durable registry path as the browser, so registration goes through `workspace.create`.

## Consequences

The evidence server requires built CLI and bridge artifacts; its package script builds the bridges before setup, while the repository and web frontend still need their normal build prerequisites. An existing installation-owned `schemastery` fallback entry must be a symlink; a missing entry is created by the web profile launch. The server has a fixed default port and runs until interrupted, making browser recordings reproducible but requiring cleanup on exit. `--keep-home` preserves diagnostic state for inspection and is intended for local troubleshooting only.

## Testing

`scripts/evidence-server.spec.mjs` covers option parsing, default selection, patch merging, idempotent installation text, and fallback-entry validation. A live run additionally checks profile initialization, the preserved or newly created `schemastery` fallback entry, bridge configuration response, and Workspace registration through the built web profile.
