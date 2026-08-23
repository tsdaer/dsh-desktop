# Agent Note: Desktop target-aware bundle configuration and updater inventory

Status: implemented

English | [中文](2026-08-22-desktop-target-aware-bundles.zh.md)

## Problem

Target selection covered the sidecar and runtime, but Tauri still carried one NSIS-only configuration and release helpers assumed one Windows installer. A target-aware runtime could therefore be paired with the wrong bundle settings or an incomplete updater manifest.

## Decision

`apps/desktop/src-tauri/tauri.conf.json` contains shared shell, resource, icon, external sidecar, and updater settings. Each supported target adds a reviewed layer under `apps/desktop/src-tauri/tauri.<target>.conf.json`; the bundle command validates the merged configuration and passes that layer with the explicit Rust target to Tauri. Runtime output directories use the target row's product key under `src-tauri/runtime/`, so a target build does not reuse another target's bundle directory and Windows resource paths remain short enough for NSIS.

`size-report.mjs` inspects the target runtime and every expected direct artifact suffix, reports runtime bytes separately from compressed installer bytes, and fails when the runtime budget, dependency leakage, or artifact inventory check fails. `release-artifacts.mjs` validates and stages direct bundle outputs under a product-target directory, and verifies the combined release inventory before hashing. Both inventory helpers leave Tauri's unpacked working directories outside the artifact set; release staging still rejects an unexpected direct file. `updater-manifest.mjs` maps primary updater artifacts to the target directories present in the release workspace, reads the updater public key from the shared Tauri configuration, and verifies each primary artifact's Minisign file and trusted comment signatures before writing a manifest. It rejects missing signatures, duplicate primary artifacts, unexpected names, empty signatures, invalid signatures, and version mismatches.

`.github/workflows/desktop-release.yml` validates the version, tag, changelog, and source commit once, then builds Windows x64 and Linux x64 on their native runners with separate sidecars and runtimes. The Linux bundle step sets `NO_STRIP=1` for linuxdeploy because Tauri's Rust release profile already strips the shell and the package contains prebuilt ELF runtime files that linuxdeploy must not rewrite. A macOS arm64 job builds an unsigned app and dmg through the reviewed experimental layer without updater artifacts; it uploads that evidence separately and never feeds it to the release inventory. The draft job downloads the Windows and Linux staged inventories, records `SHA256SUMS`, and creates or refreshes only a draft Release.

## Testing

Target specification, Tauri layer validation, artifact discovery, release staging, and updater inventory tests cover all three rows, missing and duplicate artifacts, wrong versions, unexpected names, ignored Tauri working directories, staged target selection, target-specific output paths, unsigned macOS artifact mode, valid Minisign fixtures, changed artifacts, and public-key mismatch. An existing Tauri-generated Windows updater artifact also verifies against the configured public key. The CI workflow specification pins tag validation, native runner selection, the Linux no-strip input, the separate macOS experimental job, signing input checks for supported release targets, staged inventory verification, hash generation, and draft-only publication. The existing sidecar and native-runtime tests run with these checks from the bundle command.

## Consequences

Local and CI commands must provide a native target runtime and use `--target <triple>` when switching platforms. The release workflow produces Windows and Linux draft inventories without sharing native runtime bytes and keeps macOS build evidence separate. Linux and macOS remain unsupported until their signing where applicable, installation, update, uninstall, and packaged GUI evidence are complete.

## Alternatives considered

**Generate one mutable `tauri.conf.json` in place.** Rejected because a generated file would hide the reviewed platform policy and could leave the worktree with a configuration for a different target.

**Keep release helpers Windows-specific until the matrix exists.** Rejected because target-specific artifact discovery and updater rows must be validated before release automation consumes them; the flat Windows fallback preserves the current workflow during the transition.
