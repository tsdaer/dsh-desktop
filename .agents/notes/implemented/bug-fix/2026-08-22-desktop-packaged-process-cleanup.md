# Agent Note: Desktop packaged process cleanup verification

Status: implemented

English | [中文](2026-08-22-desktop-packaged-process-cleanup.zh.md)

## Problem

The target-native packaged smoke must not lose a bundled Node process that is re-parented while the desktop shell stops. Every wait must also remain bounded when the shell or a managed process ignores termination.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` records process snapshots and identifies the installed Node sidecar by its resolved absolute path as well as by parentage. Exact path-token matching distinguishes the package's `dsh-node` or `dsh-node.exe` process from unrelated or similarly prefixed runner commands. Shutdown waits for the shell and all managed processes with bounded deadlines. When managed processes outlive the shell, the final escalation takes a fresh snapshot and force-stops each process still identified by parentage or the exact sidecar path instead of retrying the exited shell PID. A successful forced stop satisfies cleanup; the smoke reports failure only when managed processes survive that escalation. The Windows smoke invokes the NSIS uninstaller with `_?=<install-directory>`, which prevents the temporary self-copy and keeps the command synchronous; temporary-home removal retains a bounded retry for final handle release.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` covers process snapshot parsing, detects re-parented installed sidecars by exact path without matching an unrelated system Node process, and verifies that the forced tier targets every remaining packaged PID and accepts their exit. It also pins bounded shell escalation, the synchronous NSIS uninstaller arguments, and the bounded temporary-home removal policy. Existing target argument, package-entry, and descendant tests remain in the same suite.

## Consequences

Target-native package smokes now fail deterministically when the packaged shell or its bundled Node survives shutdown, while a stuck process receives a final termination attempt before the failure is reported. The check still observes the real packaged entry point and does not establish terminal, updater, minimum-distribution, or GUI evidence.

## Related

The packaged startup scope and remaining platform acceptance requirements are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md). The package smoke implementation is recorded in the [desktop Linux packaged startup smoke note](../feature/2026-08-22-desktop-linux-packaged-smoke.md).

## Alternatives considered

**Check only the child process tree.** Rejected because a runtime child can be re-parented during shutdown, removing it from a later parent-child snapshot while it remains alive.

**Use an unbounded wait for graceful shutdown.** Rejected because a packaged process that ignores termination would hang the release smoke instead of producing a bounded failure and cleanup attempt.

**Match every process named `node`.** Rejected because the smoke must identify the target sidecar and must not report an unrelated Node process owned by the runner.
