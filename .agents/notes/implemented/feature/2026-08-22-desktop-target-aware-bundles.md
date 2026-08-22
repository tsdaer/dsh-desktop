# Agent Note: Desktop target-aware bundle configuration and updater inventory

Status: implemented

English | [中文](2026-08-22-desktop-target-aware-bundles.zh.md)

## Problem

Target selection covered the sidecar and runtime, but Tauri still carried one NSIS-only configuration and release helpers assumed one Windows installer. A target-aware runtime could therefore be paired with the wrong bundle settings or an incomplete updater manifest.

## Decision

`apps/desktop/src-tauri/tauri.conf.json` contains shared shell, resource, icon, external sidecar, and updater settings. Each supported target adds a reviewed layer under `apps/desktop/src-tauri/tauri.<target>.conf.json`; the bundle command validates the merged configuration and passes that layer with the explicit Rust target to Tauri. Runtime output directories include the Rust triple, so a target build does not reuse another target's bundle directory.

`size-report.mjs` inspects the target runtime and every expected artifact suffix, reports runtime bytes separately from compressed installer bytes, and fails when the runtime budget, dependency leakage, or artifact inventory check fails. `updater-manifest.mjs` maps signed primary updater artifacts to `windows-x86_64`, `linux-x86_64`, and `darwin-aarch64` rows, and rejects missing signatures, duplicate primary artifacts, unexpected names, empty signatures, and version mismatches. The existing flat Windows inventory remains accepted while the release workflow is Windows-only.

## Testing

Target specification, Tauri layer validation, artifact discovery, and updater inventory tests cover all three rows, missing and duplicate artifacts, wrong versions, unexpected names, and target-specific output paths. The existing sidecar and native-runtime tests run with these checks from the bundle command.

## Consequences

Local and CI commands must provide a native target runtime and use `--target <triple>` when switching platforms. Linux AppImage/deb and macOS app/dmg configuration is present for target-native builds, but those platforms remain unsupported until the release workflow, signing, installation, update, uninstall, and packaged GUI evidence are complete.

## Alternatives considered

**Generate one mutable `tauri.conf.json` in place.** Rejected because a generated file would hide the reviewed platform policy and could leave the worktree with a configuration for a different target.

**Keep release helpers Windows-specific until the matrix exists.** Rejected because target-specific artifact discovery and updater rows must be validated before release automation consumes them; the flat Windows fallback preserves the current workflow during the transition.
