# Agent Note: Desktop packaged process cleanup verification

Status: implemented

English | [中文](2026-08-22-desktop-packaged-process-cleanup.zh.md)

## Problem

The Linux and macOS packaged smoke could miss a bundled Node process that was re-parented while the desktop shell stopped. Its unbounded wait could also leave a failed smoke run hanging when the shell ignored termination.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` records process snapshots and identifies the installed Node sidecar by its resolved absolute path as well as by parentage. Exact path-token matching distinguishes the package's `dsh-node` or `dsh-node.exe` process from unrelated or similarly prefixed runner commands. Shutdown waits for the shell and all recorded managed processes with bounded deadlines, escalates to forced termination after a failed graceful stop, accepts cleanup when the forced stop succeeds, and reports failure only when managed processes survive that escalation. The Windows smoke invokes the NSIS uninstaller with `_?=<install-directory>`, which prevents the temporary self-copy and keeps the command synchronous; temporary-home removal retains a bounded retry for final handle release.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` covers process snapshot parsing, detects a re-parented installed sidecar by exact path without matching an unrelated system Node process, pins bounded graceful-to-forced escalation and the synchronous NSIS uninstaller arguments, and verifies the bounded temporary-home removal policy. Existing target argument, package-entry, and descendant tests remain in the same suite.

## Consequences

Target-native package smokes now fail deterministically when the packaged shell or its bundled Node survives shutdown, while a stuck process receives a final termination attempt before the failure is reported. The check still observes the real packaged entry point and does not establish terminal, updater, minimum-distribution, or GUI evidence.

## Related

The packaged startup scope and remaining platform acceptance requirements are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md). The package smoke implementation is recorded in the [desktop Linux packaged startup smoke note](../feature/2026-08-22-desktop-linux-packaged-smoke.md).

## Alternatives considered

**Check only the child process tree.** Rejected because a runtime child can be re-parented during shutdown, removing it from a later parent-child snapshot while it remains alive.

**Use an unbounded wait for graceful shutdown.** Rejected because a packaged process that ignores termination would hang the release smoke instead of producing a bounded failure and cleanup attempt.

**Match every process named `node`.** Rejected because the smoke must identify the target sidecar and must not report an unrelated Node process owned by the runner.
