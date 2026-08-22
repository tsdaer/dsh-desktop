# Agent Note: Desktop update fixture server

Status: implemented

English | [中文](2026-08-22-desktop-update-fixture-server.zh.md)

## Problem

The desktop updater reads a signed target artifact from the endpoint embedded in the installed application. A manifest-only fixture does not prove that the target runner can fetch the exact artifact while keeping the production GitHub release untouched.

## Decision

`apps/desktop/scripts/update-fixture.mjs` validates an explicit target, next version, staged target directory, and updater manifest before serving a fixture. It requires the manifest row for that target, an artifact whose name contains the requested version, a matching detached signature, and a valid signature against the public key embedded in `tauri.conf.json`. It then exposes only a target-specific `latest.json` and the selected artifact from a loopback HTTP server. Artifact names are direct children of the staged target directory, and unknown routes return 404.

The fixture server does not read a target from the host operating system and does not alter the production endpoint. The version-N application must be built with the printed endpoint, and a target runner retains responsibility for user confirmations, installation, relaunch, and user-data checks.

## Alternatives considered

**Serve the complete release directory.** Rejected because an update runner should not be able to select a different platform's artifact through a fixture intended for one target.

**Trust the manifest signature text without checking the staged `.sig` file.** Rejected because the manifest and downloadable artifact could otherwise be replaced independently.

**Add automatic confirmation and installation to the helper.** Rejected because it would bypass the product's user-confirmation path and would not provide evidence for the actual updater interaction.

## Consequences

Target-native update work now has a loopback server that validates the signed next-version bytes before serving them. The helper remains suitable for Linux, Windows, and macOS fixture preparation, while installed update evidence still requires each target's native packaging, UI interaction, restart, and user-data verification.

## Testing

`apps/desktop/scripts/update-fixture.spec.mjs` covers explicit target validation, version and loopback-host parsing, signature verification through a generated Minisign fixture, target-only manifest URL rewriting, artifact serving, and rejection of unknown or traversal routes. The updater manifest tests continue to cover the shared signature format and public-key checks.
