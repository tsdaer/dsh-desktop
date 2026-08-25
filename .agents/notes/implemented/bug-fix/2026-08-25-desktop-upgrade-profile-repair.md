# Agent Note: Desktop upgrades repair stale profile bridge state

Status: implemented

English | [中文](2026-08-25-desktop-upgrade-profile-repair.zh.md)

## Problem

A stale desktop profile survives upgrades. The bridge packages are copied into the web profile at boot, but two gaps remain: the profile's `cordis.patch.yml` keeps the bridge rows of whatever version installed them (stale config keys ride along harmlessly until a future bridge renames one), legacy package directories from old copy paths accumulate, and a bridge that never loads fails silently — the settings page shows 401s while the boot log stays clean. There was also no record of which desktop version last synchronized the profile, so a repair could not be scoped to an upgrade.

## Decision

The shell performs a versioned, idempotent update repair on every boot:

1. **Bridge package refresh** (already shipped): copy the running source's `dsh-desktop-bridge`, `dsh-desktop-bridge-client`, and `schemastery` into the profile.
2. **Profile patch re-sync**: `sync_bridge_patch` rewrites the shell-owned bridge entries (the `- insert:` roster and the `- id: desktop-bridge` config) in `cordis.patch.yml` from the installed bridge package's own patch, preserving user-owned rows and comments. The bare `[]` template placeholder is replaced, and the legacy `bridge`/`bridge-client` residue directories are removed.
3. **Sync marker**: `.dsh-desktop-bridge-sync` records the desktop version and an FNV-1a hash of the bridge patch. The rewrite runs only when the marker is missing or either fingerprint advanced — so edits made within the current version survive a plain reboot, and an upgrade refreshes bridge defaults (the in-app settings page stores durable overrides in `settings.yaml` and is unaffected).
4. **Boot verification**: after the runtime reports readiness, the shell probes `GET /dsh-bridge/config` over loopback with the per-boot token and logs the HTTP status. A missing or stale bridge now shows up as `bridge probe: HTTP/1.1 404 ...` (or an unreachable description) in `%TEMP%/dsh-desktop-splash.log` instead of failing silently in the page.

## Testing

Unit tests pin the FNV reference vector, the row replacement (stale rows removed, user rows and the template preamble preserved, marker gating: no rewrite in-version, refresh on version advance), the empty-list placeholder replacement, the legacy-dir cleanup, and the probe's status-line parsing against a canned HTTP response plus the unreachable case. The probe request format was verified against a real `dsh web` server (200 with `Connection: close`). The full `cargo test --bin dsh-desktop` suite passes; the release build compiles.

## Consequences

Every upgrade now self-heals the profile bridge state and records that it did. A broken bridge is diagnosable from the splash log within one boot. The rewrite is conservative by construction (block removal + append, single YAML document), and the marker prevents clobbering user edits between upgrades.

## Alternatives considered

**Rewrite the profile patch on every boot.** Rejected: the profile patch is the documented place to configure bridge defaults, so unconditional replacement would destroy user edits.

**Compare versions with a semver ordering.** Rejected: any difference (including a downgrade) should re-sync; equality is the only skip condition needed.

**Probe from the page instead of the shell.** Rejected: a page-side probe runs after the client bundle loads and cannot distinguish a stale bundle from a stale host; the shell owns the token and the port at readiness, so it can verify the route before the window even opens.
