# Agent Note: Desktop Signed Updater

Status: implemented

English | [中文](2026-08-19-desktop-signed-updater.zh.md)

## Problem

The desktop release workflow produced only a Windows installer, and the application had no authenticated path for discovering or installing a later release.

## Decision

The Tauri updater plugin owns manifest parsing, artifact signature verification, download, and installation. The application embeds only the generated public key and points the updater at the repository's published `latest.json`; the Windows install mode is `passive`.

The browser bridge mounts one compact title-bar control after the main page boots. It checks once after boot, deduplicates an in-flight check, and renders explicit checking, no-update, available, downloading, ready-to-install, network failure, manifest failure, signature failure, and installation failure states. Download and installation each require a user confirmation. A failed download or installation leaves the current application running and does not replace a previously installed version.

The tag-gated workflow requires the signing private key through `TAURI_SIGNING_PRIVATE_KEY`, passes it only to the bundle step, runs Tauri with `--ci` to avoid interactive password prompts, uploads the signed installer and detached signature as workflow artifacts, and generates `latest.json` from the exact installer/signature pair. A password-protected key may additionally use `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; a passwordless key does not require that secret. The manifest targets `windows-x86_64-nsis`, embeds the signature text, and is uploaded beside the installer only on the matching release. The workflow fails when the signing input or signature artifact is missing.

The private key generated for this repository is kept outside the worktree; the public key is the only key material committed to `tauri.conf.json`. GitHub Actions must be configured with the matching private key before a signed release can be built.

## Testing

The bridge client build passes, focused updater state and failure-classification tests cover the user-visible states, and Rust dependency resolution includes `tauri-plugin-updater`. The manifest generator rejects an unsigned or incomplete artifact directory. A signed Windows bundle and manifest generation pass locally with the repository key. Protected CI execution, fresh-install smoke, upgrade from `0.2.1`, and published Release discovery remain release-hardening work.

## Alternatives considered

**Download the latest NSIS installer directly from GitHub.** Rejected because a Release asset URL does not authenticate the artifact or bind it to the accepted version manifest; the Tauri updater verifies both before installation.

**Expose the updater's raw plugin API throughout the shared client.** Rejected because the desktop bridge owns the native integration and keeps the visible state machine localized to the desktop title bar.

**Install immediately after download.** Rejected because Windows installation exits the application; the title bar requires a second confirmation and warns about the restart.

## Consequences

The release process now depends on one protected signing secret and on publishing the accepted Release before the `latest` endpoint can be discovered by clients. Draft assets remain testable as release products but are not update endpoints. The title bar gains a small updater control whose labels follow the application locale; the control requires enough width for status text and keeps retryable failures visible.
