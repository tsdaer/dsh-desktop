# Agent Note: Root postinstall no-ops when a production install prunes lefthook

Status: implemented

English | [中文](2026-08-16-root-postinstall-production-install.zh.md)

## Problem

The desktop-release workflow's payload size gate failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'lefthook' imported from ...\scripts\install-lefthook.mjs`, aborting the NSIS installer build.

The failure chain spans pnpm state and the postinstall script:

- The bundle step runs `pnpm deploy --filter @deepseek-ai/dsh --prod --legacy --config.nodeLinker=hoisted` through [`apps/desktop/scripts/bake-runtime.mjs`](../../../../apps/desktop/scripts/bake-runtime.mjs). The legacy deploy install keeps the root workspace as `workspaceDir`, so it rewrites the root workspace state `node_modules/.pnpm-workspace-state-v1.json` with the deploy's settings (`production: true`, `dev: false`, `filteredInstall: true`).
- pnpm 11.7 defaults `verifyDepsBeforeRun` to `install`: before every `pnpm run`, it checks the workspace state, and when node_modules is out of sync it runs `pnpm install` with flags derived from the recorded settings. The deploy's recorded settings map to `--production` (`production && !dev`), so the next step — `pnpm --filter @deepseek-ai/dsh-desktop size-check` — auto-ran `pnpm install --production`, which pruned all 419 devDependencies.
- `lefthook` is a root devDependency. The root `postinstall` ([`package.json`](../../../../package.json)) ran [`scripts/install-lefthook.mjs`](../../../../scripts/install-lefthook.mjs), which imported `lefthook/package.json` at module top level. ESM evaluates top-level imports before `main()` runs, so neither the CI guard (`CI=true` / `GITHUB_ACTIONS=true`) nor the availability no-ops could run: the module load itself threw, the postinstall failed, the install failed, and the gate failed.

The same crash hits any `pnpm install --production` on a checkout. The installer is designed to no-op when Lefthook is unavailable, but the static import turned "unavailable" into a load-time crash.

## Decision

[`scripts/install-lefthook.mjs`](../../../../scripts/install-lefthook.mjs) no longer imports `lefthook/package.json` at module load. `lefthookBinAvailable()` dynamically imports it and reports `false` when the resolution throws `ERR_MODULE_NOT_FOUND`; every other failure still fails loud. `main()` runs the check right after the CI guard and before any Git interaction: when Lefthook is not installed, the installer returns without touching the repository, exactly like its other availability no-ops (CI, no Git repository, no `.bin` shim).

The guard's semantics are unchanged: it still requires `bin.lefthook` to be a string in the installed package's manifest, and the existing `.bin` shim existence check still gates installation.

## Alternatives considered

**Keep the static import and rely on the CI guard.** Impossible: top-level ESM imports are evaluated before `main()` runs, so the guard could never observe the failure — the module load itself is what threw.

**Read `node_modules/lefthook/package.json` through `fs` with ENOENT tolerance.** Works, but hand-derives a path Node already resolves. The dynamic import keeps Node's own bare-specifier resolution and fails loud on any error other than the package being absent.

**Drop the manifest guard entirely.** The `.bin` shim existence check already covers the practical absence cases, but the manifest check additionally distinguishes "package present without the expected bin" (a broken or stub install) and preserves the deliberate guard from the original hook-installation fix.

**Fix the workflow instead (pin `verifyDepsBeforeRun` to `warn`, or re-install after the deploy).** Treats one trigger of a legitimate operation: `pnpm install --production` is a documented install mode, and the auto-reinstall before `pnpm run` is pnpm's own default behavior. The postinstall must be safe under production installs regardless of which workflow step provokes them.

## Consequences

Production installs and the desktop-release size gate no longer crash the root postinstall: the auto `pnpm install --production` that pnpm 11.7 runs before the `size-check` step still executes (the workspace state records the deploy's production settings) but completes, and the gate passes. Any `pnpm run` after a `--prod` deploy re-runs the production prune by pnpm default; the postinstall no-ops instead of aborting it.

The manifest probe now runs on every postinstall that reaches it. It is an in-process dynamic import whose cost is negligible next to the Git operations that follow.

The regression is pinned in [`scripts/install-lefthook.spec.ts`](../../../../scripts/install-lefthook.spec.ts): a copy of the installer placed outside the checkout (so the bare `lefthook/package.json` specifier cannot resolve) exits 0 with no output, where the old top-level import crashed with `ERR_MODULE_NOT_FOUND`.

The worktree-local hook safety contract of the [worktree-local hooks decision](../process/2026-07-27-worktree-local-lefthook.md) is untouched: this change only moves when the availability probe runs.
