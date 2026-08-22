# Agent Note: Desktop target-aware bundle configuration and updater inventory

Status: implemented

English | [中文](2026-08-22-desktop-target-aware-bundles.zh.md)

## Problem

Target selection covered the sidecar and runtime, but Tauri still carried one NSIS-only configuration and release helpers assumed one Windows installer. A target-aware runtime could therefore be paired with the wrong bundle settings or an incomplete updater manifest.

## Decision

`apps/desktop/src-tauri/tauri.conf.json` contains shared shell, resource, icon, external sidecar, and updater settings. Each supported target adds a reviewed layer under `apps/desktop/src-tauri/tauri.<target>.conf.json`; the bundle command validates the merged configuration and passes that layer with the explicit Rust target to Tauri. Runtime output directories include the Rust triple, so a target build does not reuse another target's bundle directory.

`size-report.mjs` inspects the target runtime and every expected artifact suffix, reports runtime bytes separately from compressed installer bytes, and fails when the runtime budget, dependency leakage, or artifact inventory check fails. `release-artifacts.mjs` validates and stages direct bundle outputs under a product-target directory, and verifies the combined release inventory before hashing. `updater-manifest.mjs` maps signed primary updater artifacts to the target directories present in the release workspace, and rejects missing signatures, duplicate primary artifacts, unexpected names, empty signatures, and version mismatches.

`.github/workflows/desktop-release.yml` validates the version, tag, changelog, and source commit once, then builds Windows x64 and Linux x64 on their native runners with separate sidecars and runtimes. The draft job downloads both staged inventories, records `SHA256SUMS`, and creates or refreshes only a draft Release. macOS is not included in the supported release inventory until its build, signing, notarization, and packaged evidence are complete.

## Testing

Target specification, Tauri layer validation, artifact discovery, release staging, and updater inventory tests cover all three rows, missing and duplicate artifacts, wrong versions, unexpected names, staged target selection, and target-specific output paths. The CI workflow specification pins tag validation, native runner selection, signing input checks, staged inventory verification, hash generation, and draft-only publication. The existing sidecar and native-runtime tests run with these checks from the bundle command.

## Consequences

Local and CI commands must provide a native target runtime and use `--target <triple>` when switching platforms. The release workflow produces Windows and Linux draft inventories without sharing native runtime bytes, but Linux and macOS remain unsupported until their signing where applicable, installation, update, uninstall, and packaged GUI evidence are complete.

## Alternatives considered

**Generate one mutable `tauri.conf.json` in place.** Rejected because a generated file would hide the reviewed platform policy and could leave the worktree with a configuration for a different target.

**Keep release helpers Windows-specific until the matrix exists.** Rejected because target-specific artifact discovery and updater rows must be validated before release automation consumes them; the flat Windows fallback preserves the current workflow during the transition.
