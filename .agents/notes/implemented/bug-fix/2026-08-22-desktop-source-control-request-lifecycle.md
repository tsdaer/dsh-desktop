# Agent Note: Desktop Source Control request lifecycle

Status: implemented

English | [中文](2026-08-22-desktop-source-control-request-lifecycle.zh.md)

## Problem

Source Control actions started from the Worktree could outlive the selected Workspace. The Host supported cancellation, but the client did not pass an abort signal for mutations, commits, or diffs, so a response from an old Worktree could update the current view after a Workspace switch or reconnect.

## Decision

The Source Control client tracks each mutation and commit request with an `AbortController` and owns a separate controller for the active diff request. Changing or unmounting the Worktree aborts every active request and resets the action state; opening another diff aborts the previous diff, and closing the panel aborts its request. Aborted requests do not render an error, clear newer state, or call the refresh callback. The existing Source Control refresh control remains the retry path after the bridge reconnects, and each refresh uses a new request controller.

## Alternatives considered

**Rely on Host-side cancellation** — rejected: the Host cannot cancel a browser fetch that has no signal, so the browser would still retain stale work and could apply a late response.

**Use one controller for every Source Control request** — rejected: closing a diff must not cancel a commit or file mutation, and independent actions need independent lifecycle ownership.

## Consequences

Switching Workspace or leaving the Worktree stops obsolete HTTP and Host work. A successful response from an obsolete request cannot refresh another Workspace, and closing a diff releases its Host request immediately. Reconnecting keeps the current retry behavior while preventing the previous request from winning a race with the refreshed status.

## Testing

The bridge-client Source Control tests verify that an in-flight mutation receives an abort signal and is cancelled when the Worktree unmounts; the existing Host cancellation and fixed-argv tests continue to cover subprocess termination and mutation safety.
