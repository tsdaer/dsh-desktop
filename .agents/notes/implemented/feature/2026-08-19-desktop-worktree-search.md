# Agent Note: Desktop Worktree Search

Status: implemented

English | [中文](2026-08-19-desktop-worktree-search.zh.md)

## Problem

The desktop Worktree needs project-text search without allowing browser input to select an arbitrary filesystem root, command, or unbounded result set.

## Decision

The desktop bridge exposes `GET /dsh-bridge/worktree/search` with a registered `workspaceId`, a non-empty plain-text `query`, an optional positive `include` glob for Host callers, strict case-sensitive and whole-word toggles, and an opaque page cursor. The Host resolves the canonical Workspace root from `ctx.workspaceRegistry` and `ctx.fs`, then runs packaged ripgrep content and file-list scans through `ctx.subprocess` with fixed arguments, a Workspace-root working directory, ignore-aware and non-hidden traversal, fixed VCS/generated-directory exclusions, and no shell. The browser cannot provide a root path or command.

Search output is incrementally parsed from `rg --json` and exposed as an NDJSON stream of relative file paths, line numbers, and bounded previews. Content-match events arrive while ripgrep is running; the terminal event supplies the authoritative page after adding file-path matches and applying configurable match, response-byte, raw-output, file-size, process-grace, and elapsed-time limits. A cursor records the last returned path and line; later pages rescan deterministically and discard matches before that cursor. Replacement requests abort the previous HTTP request, and timeout, output truncation, invalid input, missing Workspaces, and process failures have explicit machine-readable events or responses. The route retains its JSON response when streaming is not requested.

The Worktree client renders one file-list view with the search toolbar above it. The toolbar contains one flexible text input, searches partial input after a short debounce, submits immediately on Enter, exposes case-sensitive and whole-word buttons on the right, and provides usage guidance through the input hover tooltip. It appends streamed matches with a short entry transition, disabled when the operating system requests reduced motion, then reconciles them with the terminal page. Results can represent either a content line or a matching relative file path. An empty input restores the default file list. Search renders empty, loading, error, partial, and paginated states, and opens a selected result through the existing `workspaces.openPath()` Host opener after joining it with the selected Workspace root. Git status is rendered alongside the Explorer entries rather than as a separate Worktree window.

## Alternatives considered

**Expose a generic shell or filesystem search endpoint** — rejected: fixed ripgrep arguments and a registry-owned root keep browser input away from command and path authority.

**Add recursive search to the filesystem Service Definition** — rejected: the existing subprocess capability and packaged ripgrep already provide bounded process execution, while a universal provider method would impose search semantics on remote filesystem implementations.

**Return the complete match list in one response** — rejected: page cursors and response limits keep the browser payload bounded and make truncation visible.

## Consequences

Search pages rescan the Workspace from the canonical root, so later pages spend additional I/O in exchange for an opaque stateless cursor. Default ripgrep traversal respects repository ignore files, skips hidden entries, and excludes common VCS and generated directories; this avoids spending the latency budget on dependencies and build output. The Host streams parsed matches rather than raw ripgrep bytes; reaching the raw-output limit terminates the scan, preserves complete match records already parsed, and marks the terminal result list as incomplete. Search is read-only; Git status uses a separate fixed Host route and appears as Explorer decorations. If large source trees still exceed the latency target, a persistent incremental index is the next acceleration step.

## Testing

Desktop tests pin plain-text, include, and matching-toggle validation, cursor rejection, fixed root-only argv, performance-oriented excludes, incremental JSON parsing across UTF-8 chunk boundaries, raw-output termination, and match projection. The standalone bridge TypeScript build compiles the Search Host route and Worktree client, and the focused Explorer, Search, and virtual-list test set passes.
