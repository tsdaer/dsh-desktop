# Agent Note: Desktop macOS packaged startup smoke

Status: implemented

English | [中文](2026-08-22-desktop-macos-packaged-smoke.zh.md)

## Problem

An unsigned or signed macOS bundle can pass Tauri's build and code-signing checks while its app-bundle resource lookup, target sidecar, or managed runtime fails at launch.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` accepts macOS arm64 app and dmg artifacts in addition to the Linux x64 package paths. An app artifact launches its `Contents/MacOS/dsh-desktop` executable directly. A dmg artifact is mounted read-only with `hdiutil`, copied into the smoke home, detached, and then launched from the copied app bundle. Both paths use a temporary `DSH_HOME`, require the packaged readiness URL, stop the detached process group, and verify that recorded runtime descendants exit.

The unsigned experimental macOS job and the opt-in signed macOS job run the app-bundle smoke on their native runner after bundle creation. The smoke remains evidence of packaged startup only; it does not make unsigned artifacts releasable or establish macOS support before signing, update, uninstall, and GUI evidence are complete.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` covers macOS argument validation, app-bundle executable resolution, dmg mount arguments, and the existing Linux paths. The target-native macOS jobs invoke the same script against the generated app bundle.

## Consequences

macOS packaging jobs now exercise the installed app layout and the target-named runtime before uploading artifacts. Dmg verification copies the app instead of launching from the mounted volume, so resource lookup and process cleanup are checked after the volume is detached. The smoke requires macOS tools and cannot be reproduced on a Windows host.

## Alternatives considered

**Run `cargo run` or the source CLI.** Rejected because those paths bypass the app bundle, packaged resources, sidecar basename, and Tauri startup lifecycle.

**Launch the app with `open` and inspect only its exit status.** Rejected because `open` detaches from the app process and hides the readiness line and managed descendant tree needed by the smoke.

**Treat a successful code-signing verification as startup evidence.** Rejected because signing proves code identity and structure, not resource lookup or runtime boot.
