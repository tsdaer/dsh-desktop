# Agent Note: Build the desktop bridge packages before every pack/bake

Status: implemented

English | [中文](2026-08-16-desktop-bridge-build-pipeline.zh.md)

## Problem

The dsh-desktop bridge packages (apps/desktop/bridge and apps/desktop/bridge-client) are not pnpm workspace members, so `pnpm run build` never rebuilds their `lib/` output. The dev launcher (npm pack) and the runtime bake (bake-runtime.mjs) consume whatever `lib/` already contains — and bakePackage silently skips missing files entries. A bridge source change therefore reaches installers only when the developer manually runs tsc + tsdown first; a cleaned-out lib bakes a bridge package with no lib at all (dead plugin: no balance route, no drop handling) without any error. The balance feature shipped in this way: the installer the user installed was baked from a pre-feature bridge lib, so the pill's route 404'd and stayed hidden — and the one-time profile copy (ensure_bridge's marker check) kept that stale bridge across upgrades.

## Decision

- `apps/desktop/scripts/build-bridge.mjs` builds both bridge packages from source (tsc -p tsconfig.json, then tsdown, for each). The desktop npm scripts `dev`, `build`, `bake`, and `bundle` run it first, so every pack and every bake starts from current sources.
- `bake-runtime.mjs` fails loud after the bake rounds when `@deepseek-ai/dsh-desktop-bridge/lib/index.js` or `@deepseek-ai/dsh-desktop-bridge-client/lib/index.js` is missing from the deploy tree, instead of shipping a bridge that cannot load.
- main.rs's `ensure_bridge` re-syncs the profile's bridge packages from the runtime on every packaged boot (when `bridge_copy` is non-empty), replacing the one-time marker-gated copy. A rebuilt bridge therefore replaces a stale profile copy automatically; dev mode (npm tarballs) still installs once and leaves refreshes to the developer.

## Alternatives considered

**Making the bridge packages pnpm workspace members** — rejected. They are deliberately standalone npm-pack-able packages (baked and copied into profiles without a package manager); adding them to the workspace would change the deploy closure and the profiles module fallback for little gain.

**Version/hash-based staleness comparison for the profile copy** — rejected. The bridge lib is a build artifact whose content changes without a version bump; comparing versions cannot detect it, and the packages are small enough that an unconditional refresh on packaged boot is simpler and effectively free.

**Keeping the one-time profile copy** — rejected. It is exactly why a stale bridge survived an app upgrade; the marker check makes the profile's bridge immutable after first install.

## Consequences

Bridge source changes now reach dev runs and installers deterministically: every desktop flow builds the packages first, and the bake rejects a missing lib instead of silently shipping a dead bridge. Packaged boots copy three small packages into the profile on every launch (negligible I/O). Dev-mode installs remain one-time; a developer editing bridge sources must rebuild (the dev script does it automatically now) and, for an existing profile install, delete the profile's bridge marker to trigger a fresh npm install.

## Verification

`node apps/desktop/scripts/build-bridge.mjs` rebuilds both packages (host lib carries the balance route); the bake's missing-lib check is a fail path added after the bake rounds; `cargo check` passes with the ensure_bridge lockstep change; the profile re-sync was exercised by copying the rebuilt lib into an existing profile and confirming `/dsh-bridge/balance` answers.
