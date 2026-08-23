# Agent Note: Desktop release inventory accepts the macOS app bundle

Status: implemented

English | [中文](2026-08-23-desktop-macos-app-bundle-inventory.zh.md)

## Problem

The macOS release inventory contains the Tauri `.app` bundle directory beside versioned updater and installer files. The default bundle directory name is `dsh-desktop.app`, so requiring every inventory entry to contain the release version rejects an otherwise valid signed macOS release before attachment.

## Decision

`apps/desktop/scripts/release-artifacts.mjs` requires the release version in every staged file name and permits a staged directory to use the target's native bundle name. The `.app` directory is still restricted by the target's allowed suffixes; the versioned `.app.tar.gz`, `.dmg`, and detached signatures keep the version check.

## Testing

`apps/desktop/scripts/release-artifacts.spec.mjs` stages a macOS inventory with `dsh-desktop.app` and versioned companion files, then verifies the complete inventory. The existing Windows and Linux tests continue to require versioned files and reject a wrong-version artifact.

## Consequences

The signed macOS attachment job can verify the bundle produced by Tauri without renaming or repackaging it. Release files remain tied to the validated version, and an unexpected unversioned file is still rejected because only the target's allowed suffixes are accepted.

## Alternatives considered

**Rename the `.app` directory before staging.** Rejected because the bundle name is part of the native app layout and changing it adds a release-only transformation that does not improve verification.

**Remove the version check for all macOS entries.** Rejected because updater archives, installer images, and signatures must remain tied to the validated release version.
