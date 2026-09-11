# Agent Note: Sync this desktop fork with upstream master

Status: implemented

English | [中文](2026-09-11-upstream-master-sync.zh.md)

## Problem

This fork carries thousands of its own commits on top of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), and upstream keeps moving. Each merge of `upstream/master` produces the same classes of conflict — inherited CI workflows and the Electron `apps/desktop` tree the fork rejected, bilingual pairs whose Chinese side upstream also rewrote, generated catalogs, and the lockfile — and each class has exactly one correct resolution. Nothing recorded those resolutions, so every sync re-derived them; a wrong one either resurrects automation the fork dropped or silently discards a desktop feature.

## Decision

A sync merges `upstream/master` into `feat/tauri-shell`, starting from a pre-merge checkpoint branch so the resolved tree can be compared against the tree before the merge. Resolution follows [the divergence register](../../../../docs/fork-divergence.md) and four standing rules.

**Rejected upstream trees are deleted, never merged.** Every file the merge brings in under `.github/workflows/` other than the fork's own desktop workflows, and every file under `apps/desktop/` that upstream added, is removed with `git rm`. Upstream files that also exist in the fork's Tauri shell never reach the same path, so the deletion is by added-path status against `HEAD`, not by directory.

**Bilingual pairs take upstream's side, then re-applies the fork's own edit.** Upstream runs the same translation passes the fork inherited, including mechanical link rewrites, so its Chinese side is usually the newer base. The fork's semantic edit is re-applied on top and the sidecar re-recorded with `pnpm run verify-translation-pairing --write <pair>`; a pair left diverging structurally fails the pairing driver on the next merge.

**Generated artifacts are regenerated, not merged.** `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md`, and `docs/tool-catalog.md` with its Chinese counterpart and sidecar come from their generators after the source side is resolved. Conflict markers inside them are never edited by hand.

**Upstream-owned edits are re-checked against the register.** A merge that has to change an upstream-owned path adds its row to the register in the same commit; the register is audited with `git diff upstream/master --name-status`.

## Recurring conflicts

| Conflict | Resolution |
|---|---|
| Inherited workflow files added upstream | Deleted. The register lists every absent workflow, and none is restored |
| Upstream files under `apps/desktop/` | Deleted. The fork keeps the Tauri 2 shell; upstream's Tauri shell adds no `apps/desktop` file |
| `apps/desktop/package.json` | The fork's `name`, `version`, description, scripts, Tauri devDependencies, and MIT license replace upstream's Electron manifest |
| `AGENTS.md`, `.gitignore` | Upstream's rewritten lines are taken; the fork's own lines are preserved alongside them |
| `scripts/gen-tool-catalog.ts` | Upstream's new tool entries are taken in upstream order, with the fork's `bash-wsl` entry re-inserted after `tool-bash` |
| `scripts/ci-workflow.spec.ts` | Upstream's describes are kept as written. The spec reads workflows this fork does not carry, so it fails with `ENOENT`; the register records that failure as expected |
| `pnpm-workspace.yaml` | Upstream's `patchedDependencies` additions for the Electron packager are dropped, because an unused patch fails `pnpm install` |
| Bilingual note and README pairs | Upstream's Chinese side is taken, the fork's edit re-applied, and the sidecar re-recorded |
| `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md`, `docs/tool-catalog.*` | Taken from upstream, then regenerated after `pnpm install` |

## Alternatives considered

**Rebase the fork onto `upstream/master` instead of merging.** A rebase replays thousands of fork commits, and every one of them collides with the same upstream files this merge resolves once. It would also rewrite published history on a branch that other clones track. Merging keeps the fork's commits and their review history intact.

**Adopt upstream's Electron desktop tree and drop the Tauri shell.** Rejected when the fork was created and re-rejected on each sync: the desktop edition ships a Rust shell with its own packaging, updater, and WSL integration, none of which upstream's Electron shell provides.

**Trim `scripts/ci-workflow.spec.ts` to the workflows the fork carries.** It would turn a documented, expected failure into a spec that must be re-trimmed whenever upstream adds pipeline assertions, and it would hide which upstream guarantees the fork no longer tests. Keeping upstream's describes unmodified leaves that gap visible.

**Resolve generated files by hand at merge time.** The catalogs, notices, and lockfile are derived from source the same change already resolved; hand-merging them produces a tree the freshness gates reject, and the generator is the only authority for their content.

## Consequences

A sync is repeatable: the resolution for each conflict class is written down, and the register is the checklist for what must not come back. The cost is that the fork carries a permanent conflict set — the workflow deletions and the desktop tree delete-resolve on every merge — and that the register goes stale whenever a sync skips its row, which only the `git diff upstream/master` audit catches.
