# Agent Note: Packaged desktop boots install the profile bridge

Status: implemented

English | [中文](2026-08-25-desktop-packaged-bridge-install.zh.md)

## Problem

A packaged desktop install kept a stale profile bridge. The runtime enforces the per-boot loopback token on every `/dsh-bridge` route, while the stale bridge client predates token support, so the Desktop settings section, the balance pill, and the close-to-tray mirror failed with HTTP 401 on every request.

The regression: `RuntimePaths::is_dev()` returned `!cli.is_empty()`, but `RuntimePaths::packaged()` also carries a CLI path (its own `runtime/lib/bin.js`), so packaged mode was always misclassified as dev. `ensure_bridge` therefore never reached the packaged copy branch and instead resolved bridge sources from a repository checkout at the packaged CLI's drive root, which does not exist. A stale (or, on a fresh profile, absent) bridge survived every upgrade; failures were eprintln-only, invisible in a GUI-subsystem app.

## Decision

`RuntimePaths` gains an explicit `dev` field: `from_env()` (the dev launcher) sets `true`, `packaged()` and the no-resources fallback set `false`, and `is_dev()` returns the field. `ensure_bridge` now reaches the packaged branch: an existing profile marker triggers a refresh copy from the runtime's `dsh-desktop-bridge`, `dsh-desktop-bridge-client`, and `schemastery` packages, and a fresh profile installs them plus the bridge patch rows. Copy outcomes are recorded through `splash_log` so a failed refresh is diagnosable from `%TEMP%/dsh-desktop-splash.log` instead of lost stderr.

## Testing

Two new unit tests pin the contract: dev mode is the launcher constructor regardless of environment, and a packaged-mode `ensure_bridge` refreshes a stale profile bridge from the runtime sources. The full `cargo test --bin dsh-desktop` suite passes; the bridge packages are byte-identical artifacts on every target, so the change is a shell-only fix with no platform-specific code.

## Consequences

Packaged upgrades re-sync the profile bridge on every boot, restoring authenticated Desktop settings after an upgrade. Fresh packaged installs now get the bridge rows automatically, matching the documented behavior in `apps/desktop/README.md`. The release smokes that inject bridge rows through `DSH_PATCH` are unaffected: the profile install path is additive.

## Alternatives considered

**Detect packaged mode by checking whether the CLI path exists under a resources directory.** Rejected: the heuristic is target-specific and duplicates knowledge the constructors already own; an explicit field is simpler and testable.

**Keep the heuristic and only flip `ensure_bridge`.** Rejected: `is_dev()` also gates the node-existence check, and the field makes every caller's intent explicit.
