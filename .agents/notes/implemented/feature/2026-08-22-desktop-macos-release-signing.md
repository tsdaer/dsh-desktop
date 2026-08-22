# Agent Note: Desktop macOS release signing lane

Status: implemented

English | [中文](2026-08-22-desktop-macos-release-signing.zh.md)

## Problem

The macOS arm64 workflow produced an unsigned experimental app and dmg, while the supported release path had no protected certificate, notarization, or Gatekeeper verification lane. Signing an app after Tauri generated its updater archive would also make the archive and its signature describe different bytes.

## Decision

The existing macOS experimental job remains the default and never contributes artifacts to the supported release inventory. A signed macOS job runs only when the repository variable `DSH_DESKTOP_MACOS_RELEASE` is `true`; it requires the Developer ID certificate, signing identity, Apple notarization credentials, and Tauri updater private key. Missing inputs fail that opt-in job before publication.

The workflow imports the Developer ID certificate into a temporary keychain, saves the runner's existing keychain search list, and passes `APPLE_SIGNING_IDENTITY` to Tauri during bundle creation. Tauri therefore signs the app and nested native helpers before producing the updater archive. An always-run cleanup step restores the search list and removes the temporary keychain and certificate. `macos-sign-release.mjs` runs on macOS after bundling, verifies nested code and the complete app with `codesign`, submits the dmg to `notarytool`, staples the app and dmg, checks the app with `spctl`, then recreates the updater archive from the stapled app and signs that archive with the protected Tauri key. It does not re-sign the app after the updater archive exists.

When the signed job succeeds, a separate attachment job downloads all target inventories, verifies the complete release, regenerates `latest.json` from the signed macOS updater artifact, recalculates `SHA256SUMS`, and uploads the macOS assets and refreshed metadata to the existing draft release. The attachment job is skipped when the signed lane is disabled or fails.

## Testing

The macOS signing helper tests required-input failures and nested native-file discovery. The workflow specification pins the opt-in condition, native runner, signing command, target staging, draft-only attachment, and updater-manifest refresh. The repository has no Apple credentials or macOS runner in the local environment, so signing, notarization, Gatekeeper, installation, updater installation, and GUI evidence remain CI or release evidence.

## Consequences

The macOS arm64 build remains experimental until the opt-in lane has completed native packaged startup, installation, update, uninstall, and GUI evidence. A signed macOS updater row can enter `latest.json` only through the staged signed inventory; the unsigned experimental artifact cannot enter that manifest.

## Alternatives considered

**Publish the unsigned experimental artifacts with the supported assets.** Rejected because an unsigned app cannot establish the release trust chain or provide a safe updater row.

**Re-sign the app after Tauri creates the updater archive without recreating the archive.** Rejected because the archive signature would cover the pre-signing bytes rather than the installed app; the shipped path instead recreates and signs the archive after stapling.

## Related

The target rows and updater inventory are defined by the [desktop target-aware bundle note](2026-08-22-desktop-target-aware-bundles.md). The overall release order and support criteria are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md). Existing updater behavior is defined by the [desktop signed updater note](2026-08-19-desktop-signed-updater.md).
