# Agent Note: Desktop bridge-client reads retired client-store fields

Status: implemented

English | [中文](2026-09-13-desktop-bridge-client-store-contract.zh.md)

## Problem

The desktop shell's Explorer "以 dsh-desktop 打开" flow stopped doing anything visible: the application woke, then neither switched to the owning Workspace nor offered to register the directory. The bridge-client's open-path routing hung inside `waitForWorkspaces`, whose readiness probe read `workspaces.list.getSnapshot().baselinesReady` — a field the client Workspace store replaced with the `phase: 'pending' | 'ready'` lifecycle. `undefined` is never ready, so the wait never resolved. The unowned-directory fallback additionally called `workspaces.startSession`, a method that now lives on the `uiWorkspace` navigation service, and the drain's catch swallowed both failures, which is why the breakage was silent. The desktop plugin declares minimal structural views (`WorkspacesLike`, `SessionsLike`) of the services it consumes, so the rename produced no compile signal.

## Decision

The bridge-client tracks the current client-runtime contracts: readiness is `phase === 'ready'`, starting a session goes through `ctx.uiWorkspace.startSession`, and `uiWorkspace` joins the plugin's `inject` list. The minimal interfaces are corrected to the real snapshot shapes. A regression spec pins the three routing paths against stores shaped like the runtime's: ready at bind routes to the owning Workspace's most recent Session, a pending baseline delays routing until it flips, and an unowned directory offers registration and starts the created Workspace's session.

## Alternatives considered

**Accept both field names at runtime.** A `baselinesReady ?? phase === 'ready'` read would tolerate older client builds, but the bridge-client ships with the runtime it targets and the retired name is gone from every supported build; the compat branch is dead weight that hides the next rename.

**Restore the old names on the client stores.** The rename is an upstream client refactor with its own consumers; re-adding `baselinesReady` for one desktop reader would split the store contract.

**Silence.** The flow is a delivered desktop feature (README, "Open with dsh-desktop"); a permanently-pending wait is a defect, not a degradation to tolerate.

## Consequences

Forwarded directories route again: the window wakes and lands on the owning Workspace's most recent Session, or offers Workspace registration. The seam stays typeblind — a future store-field rename again reaches the desktop only through behavior, and the new spec is the tripwire for the three shapes this flow reads.
