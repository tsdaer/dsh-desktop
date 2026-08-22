# Agent Note: Desktop packaged process cleanup verification

Status: implemented

English | [中文](2026-08-22-desktop-packaged-process-cleanup.zh.md)

## Problem

The Linux and macOS packaged smoke could miss a bundled Node process that was re-parented while the desktop shell stopped. Its unbounded wait could also leave a failed smoke run hanging when the shell ignored termination.

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` records `ps -eo pid=,ppid=,args=` snapshots and identifies the target-named Node sidecar by command line as well as by parentage. Shutdown waits for the shell and all recorded managed processes with bounded deadlines, escalates the process group to `SIGKILL` after a failed graceful stop, and reports any remaining managed process ids. The target specification supplies the sidecar basename, so Linux and macOS checks cannot silently share a host Node name.

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` covers process snapshot parsing and detects a re-parented target sidecar without matching an unrelated system Node process. Existing target argument, package-entry, and descendant tests remain in the same suite.

## Consequences

Target-native package smokes now fail deterministically when the packaged shell or its bundled Node survives shutdown, while a stuck process receives a final termination attempt before the failure is reported. The check still observes the real packaged entry point and does not establish terminal, updater, minimum-distribution, or GUI evidence.

## Related

The packaged startup scope and remaining platform acceptance requirements are defined by the [desktop multi-platform implementation plan](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md). The package smoke implementation is recorded in the [desktop Linux packaged startup smoke note](../feature/2026-08-22-desktop-linux-packaged-smoke.md).

## Alternatives considered

**Check only the child process tree.** Rejected because a runtime child can be re-parented during shutdown, removing it from a later parent-child snapshot while it remains alive.

**Use an unbounded wait for graceful shutdown.** Rejected because a packaged process that ignores termination would hang the release smoke instead of producing a bounded failure and cleanup attempt.

**Match every process named `node`.** Rejected because the smoke must identify the target sidecar and must not report an unrelated Node process owned by the runner.
