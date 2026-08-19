# Agent Note: Static Windows updater manifests include an architecture fallback

Status: implemented

English | [中文](2026-08-19-windows-updater-target-fallback.zh.md)

## Problem

The Tauri updater selects a bundle-specific Windows target when the installed executable exposes its NSIS bundle type, then falls back to the architecture-only target. A static manifest containing only `windows-x86_64-nsis` can therefore fail target selection when the bundle type is unavailable. The desktop client classifies that JSON error as an invalid manifest, so the user-facing message does not identify the missing target.

## Decision

The desktop release manifest generator emits `windows-x86_64-nsis` and `windows-x86_64` entries with the same signed installer URL and signature. The architecture-only entry is the compatibility fallback for the updater's target lookup; it does not create a second installer or signature.

## Alternatives considered

**Keep only the NSIS-specific target.** Rejected because target detection is an optional runtime signal, and a valid NSIS installation can still lack the signal needed for the specific lookup.

**Change only the client error label.** Rejected because a clearer message would not make the published manifest usable.

**Switch to a dynamic update endpoint.** Rejected because the GitHub Release asset is intentionally a static, signed manifest and the generator already owns the required release metadata.

## Consequences

- Windows updater checks work whether Tauri reports the installed bundle type or only the operating system and architecture.
- Both manifest entries must continue to reference the same signed NSIS artifact.
- Future release manifests inherit the fallback automatically from `updater-manifest.mjs`.

## Testing

The generator is exercised with a temporary signed-artifact fixture; the resulting JSON parses successfully and contains both Windows target keys with identical URL and signature values.
