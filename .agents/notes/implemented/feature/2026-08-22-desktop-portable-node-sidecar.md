# Agent Note: Desktop portable Node sidecar acquisition

Status: implemented

English | [中文](2026-08-22-desktop-portable-node-sidecar.zh.md)

## Problem

The desktop sidecar fetcher selected a target-specific archive but trusted an unverified download and exposed its internal functions only through a script entry point. A stale binary, failed transfer, or corrupt archive could therefore survive into a later bundle attempt without focused tests for the failure paths.

## Decision

`apps/desktop/scripts/fetch-node-sidecar.mjs` downloads both the selected Node archive and the matching `SHASUMS256.txt`, requires an exact archive entry, verifies the SHA-256 digest before extraction, and records the archive name and digest beside the installed sidecar. Redirects are bounded, non-success responses fail, and proxy arguments remain argv-bound through `curl` while direct HTTPS downloads use the existing no-proxy path.

Extraction and installation use a newly created temporary directory. The target specification supplies the archive member and destination basename; the member is validated before it is resolved, and POSIX destinations receive executable permission. A cache hit requires matching version, Rust target, recorded digest metadata, and a successful `<sidecar> --version` check. Failed transfers, checksum checks, extraction, or executable checks leave the previous destination untouched and always remove the temporary directory.

The fetcher exports its download, extraction, checksum, and orchestration functions so tests can inject local archive and executable adapters without downloading or committing sidecars. The command-line entry point remains the production path used by the desktop bundle command.

## Testing

`apps/desktop/scripts/fetch-node-sidecar.spec.mjs` covers exact checksum parsing and verification, redirects, HTTP failures, corrupt archives, missing archive members, stale cache metadata, temporary-directory cleanup, POSIX executable-mode requests, and target-specific destination names. The target specification tests continue to pin all supported rows and archive path containment.

## Alternatives considered

**Trust HTTPS transport without `SHASUMS256.txt`.** Rejected because transport authentication does not provide the release-file digest check required before extraction.

**Keep the fetcher as a script-only module.** Rejected because injected adapters provide deterministic failure coverage without network access or downloaded test artifacts.

**Delete an existing sidecar before download.** Rejected because a failed preparation must not turn a previously usable cache into a partial destination.

## Consequences

The first fetch of each version and target performs an additional checksum-file request and stores digest metadata next to the ignored binary. Local tests use injected adapters; a host smoke that executes the fetched sidecar remains a target-runner requirement of the runtime-bake work package. Downloaded sidecars remain untracked build outputs.
