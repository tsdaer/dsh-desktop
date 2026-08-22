# Agent Note: Desktop target specification

Status: implemented

English | [中文](2026-08-22-desktop-target-specification.zh.md)

## Problem

Desktop build scripts selected Windows x64 independently. The sidecar filename, native prebuild key, runtime directory, artifact directory, and bundle command could therefore disagree when a second platform was added.

## Decision

`apps/desktop/scripts/target-spec.mjs` is the single source of target policy for the supported product rows: Windows x64, Linux x64, and macOS arm64. Scripts accept an explicit Rust target triple through `--target`; without one, the resolver accepts only the host triple reported by `rustc -vV`. Unsupported or malformed triples fail before a script downloads, deletes, or stages files.

Each row owns the Node distribution name and archive kind, the exact sidecar source member and destination basename, the native-platform key, bundle kinds, artifact directories, updater suffixes, target-owned runtime directory, and size budget. Sidecar acquisition, runtime baking, size reporting, and the bundle orchestration all consume the same immutable row. Archive members are validated before they are joined to a temporary extraction directory.

The Windows Tauri resource path now points at its target-owned runtime directory. The bundle command forwards one resolved target to every preparation step and to `tauri build`; this establishes the target-selection seam for later platform-specific Tauri configuration and native packaging work. Linux and macOS are not declared released by this change because the Rust shell, Tauri configuration, release workflow, and packaged smoke evidence still require their planned work packages.

## Testing

`apps/desktop/scripts/target-spec.spec.mjs` pins every field that identifies the three target rows, rejects absent or unsupported targets, renders the three Node archive layouts, and rejects archive path traversal. The Node scripts pass syntax checks, and `git diff --check` passes.

## Alternatives considered

**Infer the product target from `process.platform` in each script.** Rejected because release preparation and native packaging must share one explicit target, and duplicated host inference lets the sidecar, runtime, and bundle drift.

**Keep one shared `.runtime/deploy` directory.** Rejected because switching targets or running matrix jobs could reuse native bytes from another platform. Runtime directories are keyed by Rust target triple.

**Add more architectures while defining the table.** Rejected because the plan requires native-dependency and runner evidence before expanding the supported target set.

## Consequences

Windows local bundles must rebake into `.runtime/x86_64-pc-windows-msvc/deploy`; the former unqualified runtime directory is no longer the configured resource source. The target resolver is ready for the next work packages, but each platform still needs native runtime, Rust, Tauri, release, updater, installation, and packaged GUI evidence before it can be listed as supported.
