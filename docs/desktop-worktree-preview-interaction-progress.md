# Desktop Worktree Preview and Interaction Development Progress

English | [中文](desktop-worktree-preview-interaction-progress.zh.md)

Status: active

## Summary

As of 2026-08-30, the implementation has completed the five code slices in `desktop-worktree-preview-interaction-plan.md`: path insertion and explorer icons, preview projection and rendering, dedicated Tauri preview windows, safe external-link handling, and Lexical-aware context menus. The stabilization commit `070e56896e` appends a trailing newline to inserted paths and makes preview windows wait for their first page load before showing and focusing, with a bounded read timeout that surfaces as an in-window error instead of an endless loading state.

The remaining plan item is real desktop GUI evidence from the shipped server and model flow. The evidence-server bootstrap now completes on an OS-assigned loopback port, including startup authentication, Workspace registration, and bridge configuration probing; the in-app browser fallback has loaded the Worktree view and an in-pane README preview. Native Tauri-window and final GIF evidence remain pending.

## Table of Contents

- [Overall status](#overall-status)
- [Completed slices](#completed-slices)
- [Verification evidence](#verification-evidence)
- [Open blockers](#open-blockers)
- [Next steps](#next-steps)

## Overall status

| Area | Status | Evidence |
| --- | --- | --- |
| Workspace-relative path insertion and explorer icons | Complete | Commit `3608b68625`; focused tests and pre-commit checks passed |
| Preview projection and rendering | Complete | Commit `cac1e606ee`; build and focused checks passed |
| Dedicated Tauri preview windows | Complete | Commit `26f6aab8e8`, stabilized by `070e56896e`; Rust tests and application builds passed |
| Safe external-link handling | Complete | Commit `daaff48fea`; bridge and Rust checks passed |
| Lexical-aware context menus | Complete | Commit `4d5253718c`; 18 focused tests passed |
| Real desktop GUI evidence | Pending | Fresh evidence server and browser fallback reach the Worktree view and README preview; native Tauri-window and GIF evidence remain |

## Completed slices

### Workspace paths and explorer presentation

Workspace-relative drops and path insertion accept normalized relative paths, reject absolute and escaping paths, and use the shared folder, file, and warning icons in the explorer.

Implementation anchor: `3608b68625`.

### Preview projection and rendering

Markdown files render through the shared Markdown renderer, source files render with syntax highlighting, unknown text files use a safe text fence, and code fences avoid collisions with file contents.

Implementation anchor: `cac1e606ee`.

### Dedicated preview windows

The Tauri command opens a validated workspace file in a dedicated preview window with a per-boot bearer token, locale-aware titles, stable collision-safe labels, and a minimum window size. New windows stay hidden until the first page load finishes, then receive focus; stalled preview reads surface a bounded timeout error instead of an endless loading state.

Implementation anchor: `26f6aab8e8`.

### Safe external links

External navigation accepts only credential-free absolute HTTP(S) URLs outside the current application origin, excludes bridge and loopback targets, and routes approved links through the Tauri opener command or a browser tab.

Implementation anchor: `daaff48fea`.

### Lexical-aware context menus

Context-menu classification targets the actual Lexical composer surface, exposes only actions supported by the current selection and editability, restores focus after dismissal, and closes on navigation, outside interaction, and lifecycle teardown.

Implementation anchor: `4d5253718c`.

## Verification evidence

- `pnpm exec vitest run apps/desktop/tests/context-menu.spec.ts` — 18 tests passed.
- `pnpm --dir apps/desktop/bridge-client run build` — passed.
- `pnpm run verify-client-ui-i18n` — passed for 512 source files.
- `pnpm run build` — passed.
- `pnpm run build:web` — passed.
- `pnpm --filter @deepseek-ai/dsh-desktop test:evidence` — 7 tests passed.
- Rust tests for the desktop Tauri crate — 22 passed and 1 ignored runtime-tree test.
- Pre-commit translation-pairing, lint, whitespace, and vendor-manifest hooks — passed for the implementation commits.
- Targeted translation-pairing validation for the progress document — passed.

- `pnpm --filter @deepseek-ai/dsh-desktop evidence -- --port 0 --workspace J:\Projects\deepseek-harness` — profile setup, startup authentication, Workspace registration, bridge configuration probing, and ready-URL output completed on an OS-assigned loopback port; the browser fallback loaded the Worktree view and README preview.

The documentation aggregate reports all 15 gates passing.

- Stabilization commit `070e56896e` keeps path insertion, preview-window timing, and the read timeout in sync with the desktop changelog and the owning Agent Note.

## Open blockers

The native desktop GUI evidence run has not yet been recorded. The evidence script now permits the web profile launch to create a missing installation fallback while still rejecting a pre-existing non-symlink entry, authenticates the startup URL before bridge requests, and accepts an OS-assigned loopback port for constrained hosts.

No GUI GIF is claimed until the shipped server and model flow has been exercised from a fresh evidence workspace.

## Next steps

- Re-run the real desktop flow on a host that permits loopback binding.
- Record the plan-required GIF covering worktree drag-and-drop, explorer icons, preview rendering, binary-file refusal, Lexical context-menu actions, and approved chat external links.

## Ownership

The acceptance criteria remain owned by `desktop-worktree-preview-interaction-plan.md`, the [implementation Agent Note](../.agents/notes/implemented/feature/2026-08-19-desktop-worktree-explorer.md), and the focused tests; this page records delivery status and verification evidence.
