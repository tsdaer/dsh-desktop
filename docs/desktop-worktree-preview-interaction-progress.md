# Desktop Worktree Preview and Interaction Development Progress

English | [中文](desktop-worktree-preview-interaction-progress.zh.md)

Status: active

## Summary

As of 2026-08-29, the implementation has completed the five code slices in `desktop-worktree-preview-interaction-plan.md`: path insertion and explorer icons, preview projection and rendering, dedicated Tauri preview windows, safe external-link handling, and Lexical-aware context menus.

The remaining plan item is real desktop GUI evidence from the shipped server and model flow. The code checks for the completed slices pass; the evidence run is blocked by the current evidence-server bootstrap precondition and by loopback binding permissions in the host environment.

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
| Dedicated Tauri preview windows | Complete | Commit `26f6aab8e8`; Rust tests and application builds passed |
| Safe external-link handling | Complete | Commit `daaff48fea`; bridge and Rust checks passed |
| Lexical-aware context menus | Complete | Commit `4d5253718c`; 18 focused tests passed |
| Real desktop GUI evidence | Pending | Evidence run requires a host with a working bootstrap path and loopback server permission |

## Completed slices

### Workspace paths and explorer presentation

Workspace-relative drops and path insertion accept normalized relative paths, reject absolute and escaping paths, and use the shared folder, file, and warning icons in the explorer.

Implementation anchor: `3608b68625`.

### Preview projection and rendering

Markdown files render through the shared Markdown renderer, source files render with syntax highlighting, unknown text files use a safe text fence, and code fences avoid collisions with file contents.

Implementation anchor: `cac1e606ee`.

### Dedicated preview windows

The Tauri command opens a validated workspace file in a dedicated preview window with a per-boot bearer token, locale-aware titles, stable collision-safe labels, and a minimum window size.

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
- Rust tests for the desktop Tauri crate — 22 passed and 1 ignored runtime-tree test.
- Pre-commit translation-pairing, lint, whitespace, and vendor-manifest hooks — passed for the implementation commits.
- Targeted translation-pairing validation for the progress document — passed.

The documentation aggregate currently reports 14 of 15 gates passing. The remaining failure is an unrelated pre-existing link-target mismatch between `apps/desktop/src-tauri/runtime/windows-x64/README.md` and its Chinese counterpart.

## Open blockers

The real GUI evidence run cannot yet be recorded. `apps/desktop/scripts/evidence-server.mjs` requires a profile dependency fallback after `--dump-default-config`, while the CLI reference documents that the dump operation does not prepare that fallback. A direct server launch also failed because the host denied binding to a loopback port.

No GUI GIF is claimed until the shipped server and model flow has been exercised from a fresh evidence workspace.

## Next steps

- Resolve or explicitly provision the evidence-server profile dependency fallback in the owning evidence workflow.
- Re-run the real desktop flow on a host that permits loopback binding.
- Record the plan-required GIF covering worktree drag-and-drop, explorer icons, preview rendering, binary-file refusal, Lexical context-menu actions, and approved chat external links.
- Re-run the documentation aggregate after the unrelated runtime README pairing mismatch is corrected.

## Ownership

The acceptance criteria remain owned by `desktop-worktree-preview-interaction-plan.md`, the [implementation Agent Note](../.agents/notes/implemented/feature/2026-08-19-desktop-worktree-explorer.md), and the focused tests; this page records delivery status and verification evidence.
