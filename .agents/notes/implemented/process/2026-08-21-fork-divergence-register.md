# Agent Note: Register upstream divergence in one bilingual page

Status: implemented

English | [中文](2026-08-21-fork-divergence-register.zh.md)

## Problem

This fork adds a Windows desktop edition and, to support it, changes shared harness code, repository scripts, root configuration, and inherited documentation. Nothing recorded that set. `AGENTS.md` and the README stated the stance — desktop work stays under `apps/desktop`, shared changes need harness value — but neither said which upstream-owned paths had already changed or why.

Two costs followed. A merge from upstream could silently drop or resurrect a fork change with nothing to check it against. And a failure caused by deliberate divergence looked like a defect: `scripts/ci-workflow.spec.ts` fails here on an absent `.github/workflows/ci.yml` because this fork carries no inherited workflow, which no document explained.

## Decision

[docs/fork-divergence.md](../../../../docs/fork-divergence.md) is the register: one row per upstream-owned path, naming what differs and linking the Agent Note that owns the rationale. It defines upstream-owned as everything outside `apps/desktop/`, names the desktop release workflow as the fork's own file, and records the removed upstream automation together with the expected `ci-workflow.spec.ts` failure.

The obligation lives in the root [AGENTS.md](../../../../AGENTS.md) standing orders, because that is what an agent reads before changing code. The [README](../../../../README.md) states the stance and links the register for readers who never open `AGENTS.md`. Rows are added in the same change that touches an upstream-owned path.

## Alternatives considered

- **Keep the list in `AGENTS.md`.** Rejected on the documentation standard's own terms: the file sits at 1,946 words against a 1,600-word target, so its ceiling is frozen and a growing list cannot live there. Making room for the obligation alone required removing a budget-policy sentence that duplicated `docs/AGENTS.md`.
- **Keep the list in the README.** Rejected because the README is a bilingual pair whose counterpart and sidecar must move with every row, which taxes the routine case of one small shared fix.
- **Duplicate the list in both `AGENTS.md` and the README.** Rejected because two copies of a growing list drift, and one home per fact is the standard this repository enforces.
- **Derive the list from `git diff upstream/master`.** Rejected because a diff reports paths, never reasons, and the reason is the part a future merge needs. The diff remains the way to audit the register for completeness.

## Consequences

A merge from upstream has a checklist of intentional differences to preserve, and a reviewer can tell a deliberate divergence from an accident. The register is prose, so it goes stale if a change skips its row; the standing order and this note are the only enforcement, and `git diff` against upstream is the audit that catches omissions.

## Verification

`pnpm run doc-sync` reports 28 passed, 0 failed, covering the new pair's language switcher, every relative link in the register, and the restored `AGENTS.md` word ceiling at 1,946 of 1,950.
