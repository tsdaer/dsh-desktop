# Agent Note: Desktop in-app file viewer

Status: implemented

English | [中文](2026-08-22-desktop-file-viewer.zh.md)

## Problem

The Worktree Explorer and Search could locate a file but not show it; users had to leave the application to read content. A viewer needs bounded bytes with an explicit truncation state, refusal of binary and non-UTF-8 content, highlighting through the client's existing highlighter, and Search results that open on the matched line.

## Decision

The desktop bridge adds `GET /dsh-bridge/worktree/file` with one request field pair: a registered `workspaceId` and a Workspace-relative `path`. The Host resolves the canonical Workspace root, refuses escapes and non-regular targets, and bounds the response to `fileMaxBytes` (256 KiB default). An in-bound file is read whole through `fs.readBytes`, checked for NUL bytes, and decoded as strict UTF-8 (`TextDecoder` with `fatal: true`); binary or invalid content is refused with a stable `binary-file` error instead of rendered. An oversized file streams a bounded prefix through `fs.streamText` and returns `truncated: true`.

The bridge-client adds `DesktopWorkspaceFileViewer`: a header with the path, copy, and close controls over line-numbered content rendered through `highlightLines` (the client's existing shiki highlighter) with a per-line data attribute for scroll targeting. Explorer file rows open the viewer on click and keyboard activation; Search result rows open it with `scrollToLine` set to the matched line. File-extension language hints mirror the read tool's mapping so a file highlights the same way in the Worktree viewer and a read card.

## Alternatives considered

**Reuse the read tool's line-window presentation** — rejected: the read tool returns a numbered window with its own envelope, while the viewer needs the whole bounded file with an explicit truncation flag and line-level scroll targeting.

**Render Search results through the OS opener** — rejected: the 0.3 plan requires Search results to open the in-app viewer on the matched line.

## Consequences

Viewer requests reuse the Explorer request vocabulary (Workspace-id and relative-path parsing, canonical-root containment). The ui-primitives package now exports `highlightLines`, `grammarLoadCount`, and `subscribeGrammarLoaded` for consumers that need line-granular highlighting outside a code block. Editing remains out of scope: save-conflict detection, encoding and line-ending policy, and an undo model belong to a later phase.

## Testing

Host tests pin Workspace resolution, escape rejection, binary and invalid-UTF-8 refusal, in-bound reads, oversized prefix truncation, stream failures, cancellation, and permission mapping. Client tests cover language hints, projection validation, fetch lifecycle, truncation and binary states, matched-line scrolling, close handling, and cancellation on unmount. The live evidence server was exercised end-to-end against the repository Workspace.
