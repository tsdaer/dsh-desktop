# Fork divergence from upstream

English | [中文](fork-divergence.zh.md)

This fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) adds the Windows desktop edition described in [the desktop README](../apps/desktop/README.md). This page is the register of every place it departs from upstream, and why.

## What counts, and what must be recorded

Everything outside `apps/desktop/` is upstream-owned, including `packages/`, `apps/cli/`, `scripts/`, root configuration, `docs/`, and `.agents/`. The desktop release workflow is the one exception this fork owns outright.

A change to an upstream-owned path adds its row here, with the reason, in the same change that makes it. Work confined to `apps/desktop/` needs no row. Each row states what the fork does differently and links the Agent Note that owns the rationale; the reasoning is not repeated here.

The [root standing orders](../AGENTS.md) carry the obligation, and [the README](../README.md) states the stance for readers who never open `AGENTS.md`.

## Shared source

| Path | Divergence |
|---|---|
| [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts) | Forwards `DSH_BARE_MODULE_BASE` into `boot()` so a packaged runtime resolves built-in packages while profile-owned bundles stay resolvable ([note](../.agents/notes/implemented/bug-fix/2026-08-20-desktop-profile-bundle-resolution.md)) |
| [`packages/client/tsdown.client.ts`](../packages/client/tsdown.client.ts) | Resolves workspace manifests from `apps/*/*/package.json` as well, because the desktop bridge client is a workspace package outside `packages/` |
| [`packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`](../packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css) | Adds the `html[data-dsh-logo-motion]` hover rule the desktop opt-in drives, leaving browser users on the system reduced-motion preference ([note](../.agents/notes/implemented/feature/2026-08-20-desktop-logo-motion-opt-in.md)) |
| [`packages/host/webserver/src/index.ts`](../packages/host/webserver/src/index.ts) | Optional `token` config: registered routes and upgrades require `Authorization: Bearer` (or the `dsh_token` query for WebSockets) while the static dist fallback stays open; omitted, the plain loopback posture is unchanged ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.md)) |
| [`packages/client/connection/src/client/rpc.ts`](../packages/client/connection/src/client/rpc.ts) | Picks up `?dsh_token` from the page URL once and attaches it to every generic RPC fetch as an `Authorization: Bearer` header; a plain browser without the query is unchanged ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.md)). Upstream deleted the old `web-api-client.ts` bearer path in the browser-auth rework; the desktop's bridge routes keep their own bearer pickup in `apps/desktop/bridge-client/src/client/bridge-fetch.ts` |

## Repository scripts

| Path | Divergence |
|---|---|
| [`scripts/install-lefthook.mjs`](../scripts/install-lefthook.mjs) | Imports lefthook's manifest lazily, so a production install that prunes the devDependency does not fail `postinstall` ([note](../.agents/notes/implemented/bug-fix/2026-08-16-root-postinstall-production-install.md)) |
| [`scripts/desktop-release-workflow.spec.ts`](../scripts/desktop-release-workflow.spec.ts) | Added to pin the release workflow this fork owns |

## Build and CI configuration

| Path | Divergence |
|---|---|
| [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml) | Added: the tag-gated signed desktop release ([note](../.agents/notes/implemented/process/2026-08-17-tag-gated-desktop-release-builds.md)) |
| [`.github/dependabot.yml`](../.github/dependabot.yml) | Drops the `uv` ecosystem entry for `python/sdk`, which this fork does not release |
| [`.gitignore`](../.gitignore) | Ignores the desktop build outputs `src-tauri/target/`, `src-tauri/gen/`, `src-tauri/binaries/`, `.bridge-pack/`, and `.runtime/`, plus `temp/` |

## Removed upstream automation

This fork keeps no inherited workflow. `build-exe-for-python-sdk.yml`, `build-preview-cloudflare.yml`, `ci.yml`, `ci-master.yml`, `docs-pages.yml`, `e2b-e2e.yml`, `e2e.yml`, `expected-filenames.yml`, `issue-lifecycle.yml`, `issue-policy.yml`, `landlock-run.yml`, `landlock-run-release.yml`, `pi-ai-provider-e2e.yml`, `python-release.yml`, `release.yml`, `release-publish.yml`, `release-vendor.yml`, `release-vendor-publish.yml`, and `sandbox.yml` are all absent, and none of them is restored.

One consequence is load-bearing: `scripts/ci-workflow.spec.ts` reads those files, so it fails here with `ENOENT` on `.github/workflows/ci.yml`. That failure is expected in this fork and is not evidence of a defect. Do not silence it by restoring upstream automation.

## Documentation and conventions

| Path | Divergence |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | States the desktop and fork stance and the obligation to record divergence here; other lines are condensed to hold the word ceiling ([note](../.agents/notes/implemented/process/2026-08-21-fork-divergence-register.md)) |
| [`README.md`](../README.md), `README.zh.md` | Add the desktop edition section and the fork stance |
| [`docs/development.md`](development.md), `docs/development.zh.md` | Link the CI workflow at its upstream URL, because the file is absent here |
| [`.agents/skills/dsh-pre-push-checks/SKILL.md`](../.agents/skills/dsh-pre-push-checks/SKILL.md) | Permits a push when a proven pre-existing failure lies outside the changed scope and the affected-surface evidence passes |
| `.agents/notes/**` | Carries the desktop decision records; inherited notes that describe upstream automation link to the upstream sources |

## Generated files

`pnpm-lock.yaml` and [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) follow the manifests this fork changes. Both are regenerated, never hand-edited, and need no row of their own.
