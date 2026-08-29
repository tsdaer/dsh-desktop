# Agent Note: Desktop Worktree Explorer

Status: implemented

English | [中文](2026-08-19-desktop-worktree-explorer.zh.md)

## Problem

The desktop Worktree mode needs a read-only project view without allowing browser input to select an unrestricted filesystem root or command. The existing Workspace registry owns canonical project directories and the existing filesystem provider owns path resolution, directory metadata, and containment.

## Decision

The desktop bridge exposes `GET /dsh-bridge/worktree/explorer` with two request fields: a registered `workspaceId` and a Workspace-relative `path`. The Host resolves the Workspace path from `ctx.workspaceRegistry`, resolves the requested directory through `ctx.fs`, and rejects missing directories, non-directories, permission failures, and resolved targets outside the canonical Workspace root. The response contains relative entry paths only; a resolved child outside the root is shown as a non-expandable blocked entry without exposing its target path.

The Host rejects absolute, drive-relative, backslash-separated, and escaping paths before reading metadata outside the Workspace. It sorts directories before files, applies configurable entry, UTF-8 JSON byte, and elapsed-time limits, and reports projection truncation explicitly. HTTP request aborts cancel the filesystem operation. The bridge configuration owns positive safe-integer limits with defaults of 256 entries, 131072 response bytes, and 5000 milliseconds.

The desktop client contributes the Workbench through the desktop footer slot and portals it into the existing `sidebar.workspaces` region. It hides the shared Workspace browser only while its Worktree tab is selected, and leaves that browser unchanged in Workspace mode. It derives the inspected Workspace from the current Session, then the recent or first Workspace when no Session is selected. It loads the root directory at Worktree activation and loads child directories only when expanded. Each directory has independent loading, error, retry, empty, and truncated states; expanded relative paths persist in browser storage keyed by Workspace id. The client validates the response before rendering and never calls shell commands or unrestricted filesystem APIs.

The mode switch uses matching inline vector icons in the collapsed rail. Directory rows are accessible buttons across their full width; the directory icon reports state through the row's `aria-expanded` value and is not a separate interaction target. The Explorer flattens expanded directories into a reusable fixed-row-height `DesktopVirtualList`, which bounds DOM row count while retaining the full scroll extent for large trees.

Files and in-root directories use an internal pointer-drag protocol. The browser dispatches only a normalized Workspace-relative path; it rejects backslashes, absolute and drive-relative paths, NUL bytes, empty results, and paths that escape the Workspace. Dropping an entry on the composer inserts the normalized path without a leading `./` and adds a visible focus ring while the pointer is over it. Outside-root entries and other entry types do not start a pointer drag. The existing shell-owned external filesystem path drop remains unchanged.

Explorer rows use the shared `ui-primitives` folder, file, and warning icons. Directory icons switch between closed and open states while keeping one fixed icon box; blocked and unsupported entries use the warning icon and expose their state through localized row labels.

The file viewer projects Markdown-family files as Markdown and other text files as collision-safe fenced code input. It reuses the shared `MarkdownText` renderer for Markdown sanitization and the existing Shiki line renderer for code, so the desktop client does not add a second Markdown dependency or sanitization policy. Unknown extensions use a plain-text fence in the projection and render as unhighlighted code.

In the Tauri shell, Explorer and Search send normalized Workspace-relative file requests to a native preview-window command. The shell validates the Workspace id and path again, derives a hashed `preview-*` label from both values, and creates or focuses the matching window with the basename as its native title. The window loads the minimal `dsh_preview=1` Web entry with only `workspaceId` and `path` query fields; the per-boot bearer token is returned through a scoped command and is never placed in the preview URL. Browser runs without Tauri retain the existing in-pane viewer as a fallback.

The desktop client captures anchor activation and delegates only absolute, credential-free HTTP(S) URLs outside the current bridge origin and bridge paths to the shell opener. Unsafe or internal URLs are prevented. Tauri opens approved URLs through its opener command; browser runs use a new tab. The WSL installation guide uses the same helper.

## Alternatives considered

**Expose the Workspace absolute path to the browser** — rejected: the browser needs only relative display paths, while the Host retains authority over canonical resolution and containment.

**Use a generic shell or filesystem endpoint** — rejected: fixed Workspace Explorer fields keep commands and roots out of browser-controlled input and make request limits auditable.

**Load the whole tree when Worktree opens** — rejected: lazy directory requests keep large repositories bounded and let cancellation discard obsolete expansions.

## Consequences

Explorer is read-only and does not expose file contents. Git status is rendered as file and directory decorations in the same tree, while Search remains the Worktree toolbar mode. Dragging a Worktree entry transfers a relative display path only; it does not read the file or grant the composer an absolute path. The underlying filesystem provider may enumerate a complete directory before the bridge projects its configured response bound, so a provider-native bounded listing remains a future capability improvement. Symlink or junction children that resolve outside the Workspace remain visible as blocked entries, making the rejection observable without following them in the UI. The virtual list assumes a fixed row height; variable-height consumers need a separate measurement policy.

## Testing

The desktop Explorer tests pin relative-path validation, drive-relative and escape rejection before outside metadata access, directory-first ordering, entry truncation, and outside-root projection. Rendered client tests cover the first Workspace appearing after an empty snapshot, simultaneous sibling-directory loads, and shared folder, file, and warning icon states. The virtual-list tests pin empty collections, overscan, and end-of-content clamping. The standalone desktop bridge build compiles both Host and Client packages and bundles the Explorer route and UI. Focused client tests validate normalized pointer-drag paths, absolute and drive-relative path rejection, backslash rejection, and decoration aggregation.

Preview projection tests pin Markdown passthrough, basename titles, recognized language hints, collision-safe fences, and plain-text fallback. File-viewer tests pin sanitized Markdown rendering while retaining the existing highlighted code and Search line-scroll behavior.

Preview-window tests pin early path validation, normalized request arguments, locale forwarding, unavailable-Tauri fallback, native command failure fallback, Rust path rejection, and Workspace-plus-path label scoping. The desktop shell build checks the Tauri window and command registration, and the Web build checks the minimal preview entry alongside the regular Web entry.

External-link tests pin URL allowlisting, credential and bridge URL rejection, native opener invocation, and browser click handling. Rust tests pin rejection of credential-bearing, loopback, and bridge URLs before invoking the platform opener.
