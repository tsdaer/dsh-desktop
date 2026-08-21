# Agent Note: Desktop Worktree Source Control

Status: implemented

English | [中文](2026-08-19-desktop-worktree-source-control.zh.md)

## Problem

The desktop Worktree needs a read-only view of Git changes without allowing browser input to choose a repository root, invoke arbitrary commands, or receive unbounded status output.

## Decision

The desktop bridge exposes `GET /dsh-bridge/worktree/source-control` with one request field: a registered `workspaceId`. The Host resolves the canonical Workspace directory through `ctx.workspaceRegistry` and `ctx.fs`, discovers the containing repository with fixed `git --no-pager rev-parse --show-toplevel`, and reads `git --no-pager status --porcelain=v1 -z --untracked-files=all` through `ctx.subprocess`. The browser supplies no filesystem path or Git argument.

When the Workspace is below a parent repository, the Host passes only the Host-derived Workspace-relative repository path to Git and projects returned paths back to Workspace-relative paths. A Workspace that is itself a nested repository is resolved by Git from that directory. Git status does not recurse into submodules; a submodule is represented by the parent repository's status entry. Unsupported porcelain records remain explicit entries rather than being guessed into a supported category.

The response groups staged, unstaged, untracked, conflicted, renamed, and unsupported entries. Rename records retain the old relative path. Non-repository Workspaces return an explicit `not-repository` state with no command-error card; Git failures return `unavailable`. Entry count, response bytes, process grace, and elapsed time are desktop bridge configuration values, and request aborts cancel filesystem and subprocess work.

The Worktree client renders Git decorations directly in the Explorer. Changed files show a primary status marker, parent directories aggregate descendant statuses and counts, and the Explorer header reports loading, unavailable, non-repository, and truncated Git states. The projection remains read-only and does not expose repository roots or Git output paths.

## Alternatives considered

**Run Git from the repository root and display its complete output** — rejected: a Workspace may be a child directory, and returning parent paths would expose unrelated project files. Host-derived path scoping keeps the projection inside the selected Workspace.

**Recursively query nested repositories and submodules** — rejected: it would combine independent Git histories and make status ownership ambiguous. Git resolves the repository containing the selected directory, while submodules remain entries owned by the parent status command.

**Expose a generic shell route for Git operations** — rejected: fixed argv, Host-owned working directories, and the existing subprocess capability keep browser values away from command authority and preserve cancellation and output bounds.

## Consequences

Source Control requires Git to be available in the desktop runtime and reports unavailable state when discovery or status cannot complete. Repository status is a snapshot, so later refreshes can observe different changes; write operations re-validate against a fresh listing before mutating (see [Desktop Source Control writes](2026-08-21-desktop-source-control-actions.md)). NUL-delimited porcelain parsing preserves paths containing spaces or line breaks; unsupported or unsafe records are visible only through bounded status categories and never become filesystem authority.

## Testing

Focused desktop tests pin fixed Git argv, Workspace-id validation, parent-repository path filtering, all supported status groups, rename origins, and entry truncation. The standalone bridge TypeScript build compiles the Host route, and the client build compiles the Explorer Git decorations and state indicators.
