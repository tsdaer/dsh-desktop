# Agent Note: Desktop Source Control writes

Status: implemented

English | [中文](2026-08-21-desktop-source-control-actions.zh.md)

## Problem

The read-only Worktree projection ([Desktop Worktree Source Control](../../implemented/feature/2026-08-19-desktop-worktree-source-control.md)) can show changes but not act on them. Staging, unstaging, discarding, committing, and diff viewing each need a safe Git mutation path, and a destructive operation fed a stale path turns a mistake into lost work.

## Decision

The desktop bridge adds four POST routes and one GET route under `/dsh-bridge/worktree/source-control`: `stage`, `unstage`, `discard`, `commit`, and `diff`. The browser sends only a Workspace id, a Workspace-relative path, and a commit message; every Git argv is fixed in the Host, every command runs from the Host-derived Workspace root (or the repository root for blob reads), and every write re-reads the status projection first, refusing stale or unclassified entries with a stable error.

- `stage` runs `git add -A -- <paths>` (rename origins included).
- `unstage` runs `git restore --staged -- <paths>`.
- `discard` runs `git restore --staged --worktree` for tracked entries and `git clean -f` for untracked entries, after an inline confirmation that names the file.
- `commit` builds a temporary index (`GIT_INDEX_FILE`) from HEAD plus only the Workspace's staged entries (`git ls-files -s` feeding `update-index --cacheinfo` / `--force-remove`), so the commit can never include a file outside the selected Workspace; an empty repository bases the index on `read-tree --empty`.
- `diff` reads the HEAD blob with `git show HEAD:<repo-relative path>` (rename origins) and the worktree side through bounded `fs.readBytes`, decodes both as strict UTF-8, refuses binary content, flags per-side truncation, and renders through the shared `DiffBlock` presentation.

Unclassified entries (unsupported-only or empty statuses) are offered no mutation and no diff. Request aborts cancel subprocess work; timeouts reuse the read-only route's bounds. Git stderr is echoed bounded as `detail` on mutation failures. Error responses are gated on response writability only, because the request stream auto-destroys after its body ends.

## Alternatives considered

**Commit the whole repository index** — rejected: the acceptance requires committing confined to the selected Workspace, and a whole-index commit could include changes staged by other tools outside the Workspace.

**Commit by pathspec** (`git commit -m msg -- <paths>`) — rejected: pathspec commits record the worktree content of the listed paths, silently including changes the user staged and then modified. The temporary index commits exactly the staged blobs.

**Accept browser-supplied Git arguments** — rejected on the read-only note's grounds: fixed argv and Host-derived paths keep browser values away from command authority.

## Consequences

Mutations are whole-file only; hunk and line staging need a diff model the Host does not have and stay deferred. Commits require Git identity configuration; identity failures surface with bounded stderr. Pre-commit hooks run against the temporary index, and the temporary index file is removed best-effort afterward.

## Testing

Focused desktop tests pin the fixed argv, the operation matrix, stale and unclassified refusals, index-entry parsing and temporary-index plan building, binary and truncation diff handling, and a handler-level regression proving a POST error response is written after the request stream auto-destroys. Client tests cover per-row action availability, the file-naming confirmation flow, commit-bar behavior, and the DiffBlock panel. The live evidence server was exercised end-to-end against a scratch repository with a real commit.
