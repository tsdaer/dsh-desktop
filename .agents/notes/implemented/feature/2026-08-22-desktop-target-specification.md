# Agent Note: Desktop target specification

Status: implemented

English | [中文](2026-08-22-desktop-target-specification.zh.md)

## Problem

Desktop build scripts selected Windows x64 independently. The sidecar filename, native prebuild key, runtime directory, artifact directory, and bundle command could therefore disagree when a second platform was added.

## Decision

`apps/desktop/scripts/target-spec.mjs` is the single source of target policy for the supported product rows: Windows x64, Linux x64, and macOS arm64. Scripts accept an explicit Rust target triple through `--target`; without one, the resolver accepts only the host triple reported by `rustc -vV`. Unsupported or malformed triples fail before a script downloads, deletes, or stages files.

Each row owns the Node distribution name and archive kind, the exact sidecar source member and destination basename, the native-platform key, bundle kinds, artifact directories, updater suffixes, target-owned runtime directory, and size budget. Sidecar acquisition, runtime baking, size reporting, and the bundle orchestration all consume the same immutable row. Archive members are validated before they are joined to a temporary extraction directory.

Each Tauri resource path points at its target-owned runtime directory under `src-tauri/runtime/<product-target>`. The bundle command forwards one resolved target to every preparation step and to `tauri build`, so platform-specific Tauri configuration and native packaging use the same selection.

## Testing

`apps/desktop/scripts/target-spec.spec.mjs` pins every field that identifies the three target rows, rejects absent or unsupported targets, renders the three Node archive layouts, and rejects archive path traversal. The Node scripts pass syntax checks, and `git diff --check` passes.

## Alternatives considered

**Infer the product target from `process.platform` in each script.** Rejected because release preparation and native packaging must share one explicit target, and duplicated host inference lets the sidecar, runtime, and bundle drift.

**Keep one shared runtime directory.** Rejected because switching targets or running matrix jobs could reuse native bytes from another platform. Runtime directories are keyed by the target row's product key.

**Add more architectures while defining the table.** Rejected because the plan requires native-dependency and runner evidence before expanding the supported target set.

## Consequences

Windows local bundles rebake into `src-tauri/runtime/windows-x64`. The short target-owned source path keeps deeply nested runtime files below the Windows NSIS input-path limit without changing their packaged `resources/runtime` destination.
