# Agent Note: Desktop Windows installed update acceptance workflow

Status: implemented

English | [中文](2026-08-23-desktop-windows-installed-update-workflow.zh.md)

## Problem

The Windows release job verifies one installed NSIS package, but it does not prove that an installed version can discover, install, and relaunch into a signed newer version while retaining user data.

## Decision

`.github/workflows/desktop-windows-update-acceptance.yml` provides a manually dispatched Windows x64 acceptance run. It requires two immutable version tags and a fixed loopback port, resolves each tag to a commit before reading version data, verifies the initial and second checkouts against those captured commits, and rejects a non-increasing version pair.

The workflow builds version N with a loopback updater endpoint, builds and signs version N+1 on the same Windows runner, stages the next-version updater inventory, and invokes `apps/desktop/scripts/update-smoke.mjs` with the NSIS installer mode and packaged terminal probe enabled. It uploads the smoke log, uses read-only repository permissions, and never creates or mutates a GitHub Release.

This workflow records Windows target-runner update evidence without changing the supported-release status. Native execution, Explorer integration, and the remaining packaged GUI evidence remain separate requirements.

## Alternatives considered

**Rely on the tag-gated release job.** Rejected because that job verifies installation and removal of one version; it does not build a controlled version-N updater endpoint or exercise a signed N-to-N+1 transition.

**Download two published Windows installers.** Rejected because version N must contain a controlled loopback endpoint while published artifacts use the production updater endpoint.

**Publish the update fixture or Release from the acceptance workflow.** Rejected because the workflow is evidence-only; it serves artifacts from loopback and uploads only its log, leaving Release publication to the tag-gated release workflow.

## Consequences

Maintainers can obtain repeatable Windows N-to-N+1 update evidence from two captured tag snapshots without granting the workflow Release-write permission. The workflow consumes the updater signing secret to create the next-version fixture, so it remains an explicit acceptance run rather than a pull-request check. A passing run proves the Windows update criterion only; it does not publish or support Linux or macOS.

## Testing

`scripts/desktop-windows-update-workflow.spec.ts` pins the manual inputs, Windows runner, immutable commit checks, target endpoint injection, NSIS installation mode, signature staging, packaged terminal probe, read-only permissions, and absence of Release mutation. The shared desktop update and packaged-smoke script tests cover the invoked coordinator and cleanup paths.
