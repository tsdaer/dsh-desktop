# Agent Note: Desktop macOS installed update acceptance workflow

Status: implemented

English | [中文](2026-08-23-desktop-macos-installed-update-workflow.zh.md)

## Problem

The macOS release lane can sign and notarize one bundle, but it does not by itself prove that a signed installed version can discover, install, and relaunch into a signed newer version while retaining user data.

## Decision

`.github/workflows/desktop-macos-update-acceptance.yml` provides a manual macOS arm64 acceptance run. It requires two immutable version tags and a fixed loopback port, verifies both tag commits before reading their desktop versions, and rejects a non-increasing version pair.

The workflow runs on `macos-14`, imports the Developer ID certificate into a temporary keychain, and builds version N with a loopback updater endpoint. It signs, notarizes, staples, and verifies version N before copying its dmg into a disposable update root. It then checks out the recorded version-N+1 commit, repeats the signed release preparation, stages the target artifacts, and generates a target-only updater manifest whose downloads point at the loopback fixture.

The existing `update-smoke` driver serves that signed next-version fixture and launches the version-N dmg through the existing updater control and confirmation path. The smoke also runs the packaged PTY probe, records the update log as a workflow artifact, and removes the temporary keychain in an always-run cleanup step. The workflow publishes no Release and does not change the supported-platform declaration.

## Testing

`scripts/desktop-macos-update-workflow.spec.ts` checks manual-only inputs, immutable commit propagation, the macOS target, signing and notarization steps, updater fixture generation, terminal smoke, secret use, artifact retention, and keychain cleanup. The workflow itself remains unexecuted until product-owned Apple and Tauri signing credentials are available on a macOS runner.

## Alternatives considered

**Reuse the Linux update workflow with a runner matrix.** Rejected because macOS requires a temporary signing keychain, Developer ID notarization, app stapling, and Gatekeeper verification; sharing a Linux job would hide platform-specific cleanup and trust checks.

**Test only the signed macOS release lane.** Rejected because signing and notarization of one version do not prove updater replacement, relaunch, or user-data retention across two installed versions.

**Publish the update fixture or Release from the acceptance workflow.** Rejected because the workflow is evidence-only; it serves artifacts from loopback and uploads only its log, leaving Release publication to the tag-gated release workflow.

## Consequences

The repository now has a target-native macOS update acceptance entry point that exercises the same signed artifact path used for publication. It consumes Apple and updater secrets only on the runner and leaves macOS unsupported until the run and the remaining packaged GUI evidence pass.
