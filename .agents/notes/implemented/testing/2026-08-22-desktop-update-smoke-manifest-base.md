# Agent Note: Desktop controlled update-smoke manifest URLs

Status: implemented

English | [中文](2026-08-22-desktop-update-smoke-manifest-base.zh.md)

## Problem

The updater manifest points at the published GitHub Release, while an installed version-N to version-N+1 smoke needs a signed version-N+1 fixture served from a target-runner-local endpoint without changing the production download location.

## Decision

`updater-manifest.mjs` keeps the GitHub Release URL as its default and accepts an explicit `downloadBaseUrl` for controlled update smokes. The URL builder accepts only HTTP(S) bases without queries or fragments, rejects path-bearing tags and artifact names, and appends the encoded release tag and artifact name as separate path components. Signature verification and target inventory validation run identically for the default and controlled URLs.

The command-line generator exposes the same option as `--download-base-url`. A local smoke can therefore prepare `latest.json` and the signed primary artifact under one temporary HTTP(S) directory while production manifests retain the GitHub Release endpoint. The installed application still needs target-specific endpoint injection; native installation, relaunch, user confirmation, and user-data retention remain required evidence.

## Alternatives considered

**Replace the production GitHub endpoint during testing.** Rejected because draft-release validation must not change the endpoint used by published clients.

**Accept an arbitrary URL string and concatenate file names.** Rejected because query fragments, path separators, and ambiguous bases can produce an endpoint different from the one the smoke operator intended.

## Consequences

The manifest generator can produce a target-runner-local update fixture without duplicating signature or artifact-selection logic. The default release behavior is unchanged, and an HTTP local endpoint remains a test-only choice because the signed release configuration still requires HTTPS.

## Testing

`apps/desktop/scripts/updater-manifest.spec.mjs` covers local base URL rendering, invalid schemes, query and fragment rejection, path-bearing tags, and application of the controlled base to every supported target row. The existing signature and inventory cases continue to exercise the same code path.
