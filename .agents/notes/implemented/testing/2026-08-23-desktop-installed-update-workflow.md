# Agent Note: Desktop Linux installed update workflow

Status: implemented

English | [中文](2026-08-23-desktop-installed-update-workflow.zh.md)

## Problem

The installed update smoke can coordinate a signed fixture and a packaged application, but no target-native workflow builds both versions with the required loopback endpoint and executes the transition on Linux.

## Decision

`.github/workflows/desktop-update-acceptance.yml` is a manually dispatched Linux x64 acceptance workflow. It accepts two tag refs and a fixed loopback port, verifies both refs are immutable tags and that the second version is newer, builds version N with the loopback updater endpoint, builds and signs version N+1 on the same Ubuntu runner, stages the next-version updater inventory, and invokes `apps/desktop/scripts/update-smoke.mjs` under `xvfb-run` with the packaged terminal probe enabled.

The workflow keeps the version-N AppImage outside the checkout while changing tags, stages version-N+1 artifacts under a separate temporary root, and passes the manifest path explicitly. It uploads the smoke log for failed or successful runs, uses read-only repository permissions, and never creates or mutates a GitHub Release.

This workflow records Linux target-runner update evidence without changing the supported-release status. Minimum-distribution compatibility, packaged GUI evidence, and the corresponding Windows and macOS runner checks remain separate requirements.

## Alternatives considered

**Run the check from the draft-release job.** Rejected because that job builds only one version and must remain responsible for validated release inventory and draft publication.

**Download two published releases and test them without rebuilding.** Rejected because version N must contain a controlled loopback endpoint and published artifacts use the production updater endpoint.

**Use a host-side mock updater instead of the signed fixture.** Rejected because the update path must exercise the product's updater selection, signature validation, confirmation calls, restart, and process cleanup together.

## Consequences

Maintainers can obtain repeatable Linux N-to-N+1 update evidence from two immutable tags without granting the workflow release-write permission. The workflow consumes updater signing secrets to create the next-version artifact, so it remains an explicit acceptance run rather than a pull-request check. A passing workflow run is evidence for the Linux update criterion only; it does not publish or support the platform by itself.

## Testing

`scripts/desktop-update-workflow.spec.ts` pins the manual inputs, Ubuntu runner, immutable-tag checks, target endpoint injection, signature staging, target-native smoke, terminal probe, read-only permissions, and absence of release mutation. The desktop update and packaged-smoke script tests cover the invoked coordinator and its cleanup paths.
