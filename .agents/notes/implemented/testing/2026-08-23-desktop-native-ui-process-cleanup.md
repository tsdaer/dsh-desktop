# Agent Note: Desktop native UI smoke process cleanup

Status: implemented

English | [中文](2026-08-23-desktop-native-ui-process-cleanup.zh.md)

## Problem

The Linux native Tauri UI smoke could wait forever when `tauri-driver` exited before the cleanup code attached its `exit` listener. A driver that ignored graceful termination also had no bounded cleanup path.

## Decision

`apps/desktop/scripts/tauri-ui-smoke.mjs` uses `terminateProcess()` for the `tauri-driver` child. The helper checks the recorded exit state before and after listener registration, sends `SIGTERM`, waits for a configurable grace period, sends `SIGKILL` when necessary, and returns whether the child reported exit before the force deadline. The smoke fails after cleanup when the driver remains alive, while the cleanup wait itself is bounded.

## Alternatives considered

**Attach a one-shot `exit` listener without checking the child state.** Rejected because a child can exit between process creation and cleanup, leaving the listener waiting for an event that will never recur.

**Wait indefinitely for graceful driver shutdown.** Rejected because a hung WebDriver process would hang the target-native release job instead of producing a bounded failure.

**Ignore a driver that survives the force signal.** Rejected because a successful smoke must not leave its native WebDriver process behind; the caller reports the cleanup failure after making the final termination attempt.

## Consequences

The native Linux UI smoke now handles early driver exit deterministically and cannot wait indefinitely for a graceful shutdown. The helper is local to the smoke harness and does not change the packaged application's runtime process policy.

## Testing

`apps/desktop/scripts/tauri-ui-smoke.spec.mjs` covers an already-exited child, graceful `SIGTERM` exit, and `SIGKILL` escalation with a bounded timeout. Target-runner execution remains required for WebKit and installed-package evidence.

## Related

The native WebKit interaction scope is recorded in the [Desktop Linux native Tauri UI smoke note](2026-08-23-desktop-linux-native-tauri-ui-smoke.md). Packaged application descendant cleanup is separately defined by the [Desktop packaged process cleanup verification note](../bug-fix/2026-08-22-desktop-packaged-process-cleanup.md).
