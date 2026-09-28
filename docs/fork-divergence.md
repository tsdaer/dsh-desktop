# Fork divergence from upstream

English | [中文](fork-divergence.zh.md)

This fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) adds the Windows desktop edition described in [the desktop README](../apps/desktop/README.md). This page is the register of every place it departs from upstream, and why.

## What counts, and what must be recorded

Everything outside `apps/desktop/` is upstream-owned, including `packages/`, `apps/cli/`, `scripts/`, root configuration, `docs/`, and `.agents/`. The desktop workflow files `.github/workflows/desktop-*.yml` are the one exception this fork owns outright.

A change to an upstream-owned path adds its row here, with the reason, in the same change that makes it. Work confined to `apps/desktop/` needs no row. Each row states what the fork does differently and links the Agent Note that owns the rationale; the reasoning is not repeated here.

The [root standing orders](../AGENTS.md) carry the obligation, and [the README](../README.md) states the stance for readers who never open `AGENTS.md`.

## Shared source

| Path | Divergence |
|---|---|
| [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts) | Forwards `DSH_BARE_MODULE_BASE` into `boot()` so a packaged runtime resolves built-in packages while profile-owned bundles stay resolvable ([note](../.agents/notes/implemented/bug-fix/2026-08-20-desktop-profile-bundle-resolution.md)) |
| [`packages/client/tsdown.client.ts`](../packages/client/tsdown.client.ts) | Resolves workspace manifests from `apps/*/*/package.json` as well, because the desktop bridge client is a workspace package outside `packages/` |
| [`tsconfig.host.json`](../tsconfig.host.json) | Omits upstream's `apps/desktop` project reference and test/script includes: the Tauri shell builds through its own `apps/desktop/tsconfig.json`, not the Host aggregate |
| [`tsdown.config.ts`](../tsdown.config.ts) | Host workspace build excludes `apps/desktop`, which has no `lib/types` entry points; upstream's Electron shell did. Its build-order comment describes the Tauri shell's own pipeline instead of upstream's chained bundle step (see the [`package.json`](../package.json) row) |
| [`package.json`](../package.json) | Root `build:lib:host` ends at the Host tsdown pass: upstream chains its Electron main-process bundle there, while this fork's desktop `bundle` script is the full target-specific Tauri installer packaging, run explicitly by the desktop workflows after `pnpm run build` ([Bundle](../apps/desktop/README.md)) |
| [`docs/development.md`](development.md) | Root build order omits the desktop bundle step and states that the Tauri desktop packages installers outside the root build (follows the [`package.json`](../package.json) row) |
| [`.agents/notes/`](../.agents/notes/) | Deleted the upstream-era implemented notes whose subjects are rejected upstream systems (the Electron desktop, the inherited CI lanes) and emptied the frozen archive; the [sync note](../.agents/notes/implemented/process/2026-09-11-upstream-master-sync.md) owns the standing deletion rule, and upstream history remains on `upstream/master` |
| [`scripts/verify-archived-agent-notes.ts`](../scripts/verify-archived-agent-notes.ts) | An archive with no artifacts no longer requires the kind directories, which git cannot commit as empty trees |
| [`packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`](../packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css) | Adds the `html[data-dsh-logo-motion]` hover rule the desktop opt-in drives, leaving browser users on the system reduced-motion preference ([note](../.agents/notes/implemented/feature/2026-08-20-desktop-logo-motion-opt-in.md)) |
| [`packages/host/webserver/src/index.ts`](../packages/host/webserver/src/index.ts) | Optional `token` config: registered routes and upgrades require `Authorization: Bearer` (or the `dsh_token` query for WebSockets) while the static dist fallback stays open; omitted, the plain loopback posture is unchanged ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.md)) |
| [`packages/client/connection/src/client/rpc.ts`](../packages/client/connection/src/client/rpc.ts) | Picks up `?dsh_token` from the page URL once and attaches it to every generic RPC fetch as an `Authorization: Bearer` header; a plain browser without the query is unchanged ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.md)). Upstream deleted the old `web-api-client.ts` bearer path in the browser-auth rework; the desktop's bridge routes keep their own bearer pickup in `apps/desktop/bridge-client/src/client/bridge-fetch.ts` |
| [`apps/web/src/main.ts`](../apps/web/src/main.ts), [`apps/web/src/desktop-preview.tsx`](../apps/web/src/desktop-preview.tsx) | Routes `?dsh_preview=1` to the read-only worktree preview mount while ordinary pages keep the upstream desktop boot path ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-file-viewer.md)) |
| [`packages/api/session-controller/src/agent.ts`](../packages/api/session-controller/src/agent.ts) | Adds the plugin-incompatibility hint to session-activation failures so an installed plugin reaching a removed service is named in the error |
| [`packages/client/connection/src/browser-auth.ts`](../packages/client/connection/src/browser-auth.ts), [`packages/client/connection/src/rpc.ts`](../packages/client/connection/src/rpc.ts), [`packages/client/connection/src/client/loopback-token.ts`](../packages/client/connection/src/client/loopback-token.ts) | Keeps `dsh_token` on the index redirect and captures it in the client so desktop bridge authentication survives login ([note](../.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.md)). The session cookie name hashes the hostname alone and the token exchange expires superseded `dsh-auth-*` cookies, so random-port desktop boots stop accumulating one persistent cookie per boot until request heads exceed the server limit ([note](../.agents/notes/implemented/bug-fix/2026-09-20-webview-cookie-accumulation.md)) |
| [`packages/shell/bash-wsl`](../packages/shell/bash-wsl), [`packages/shell/tool-bash-wsl`](../packages/shell/tool-bash-wsl) | Adds the WSL bash executor and its model-facing tool, enabled by the desktop WSL setting ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-cross-platform-shell-runtime.md)) |
| [`packages/bundle/web-app/presets/standard.patch.yml`](../packages/bundle/web-app/presets/standard.patch.yml), [`apps/cli/tests/web-agent-presets.e2e.ts`](../apps/cli/tests/web-agent-presets.e2e.ts) | Adds the conditional `tool-bash-wsl` row to upstream's declarative standard preset and keeps the Windows-only catalog evidence in the presets e2e suite, both ported from the removed file-based preset ([note](../.agents/notes/implemented/feature/2026-08-22-desktop-cross-platform-shell-runtime.md)) |

## Repository scripts

| Path | Divergence |
|---|---|
| [`scripts/install-lefthook.mjs`](../scripts/install-lefthook.mjs) | Imports lefthook's manifest lazily, so a production install that prunes the devDependency does not fail `postinstall` ([note](../.agents/notes/implemented/bug-fix/2026-08-16-root-postinstall-production-install.md)) |
| [`scripts/gen-config-catalog.ts`](../scripts/gen-config-catalog.ts) | Normalizes pasted declarations to LF so Windows CRLF checkouts generate the same bilingual catalog as other hosts ([note](../.agents/notes/implemented/process/2026-08-08-native-windows-pull-request-ci.md)) |
| [`scripts/gen-cordis-catalog.ts`](../scripts/gen-cordis-catalog.ts) | Normalizes generated Cordis regions to LF for the same cross-host bilingual pairing guarantee ([note](../.agents/notes/implemented/process/2026-08-08-native-windows-pull-request-ci.md)), and exempts the fork-only `desktopBridgeSettings` bridge snapshot from the service walk |
| [`scripts/gen-tool-catalog.ts`](../scripts/gen-tool-catalog.ts) | Adds the fork's `bash-wsl` tool to the catalogued set, so the generated [`docs/tool-catalog.md`](tool-catalog.md) and its Chinese counterpart carry that row and section |
| [`scripts/desktop-release-workflow.spec.ts`](../scripts/desktop-release-workflow.spec.ts) | Added to pin the release workflow this fork owns |
| [`scripts/verify-concrete-terms.ts`](../scripts/verify-concrete-terms.ts), [`scripts/translation-pairing.ts`](../scripts/translation-pairing.ts) | Exempt the fork's recorded Web snapshot fixtures from the banned-term scan (the JSONL carries the session format's own field names) and the desktop build-output trees from the bilingual pairing corpus, both introduced by upstream's 0.1.7 gate rework |


## Build and CI configuration

| Path | Divergence |
|---|---|
| [`.github/workflows/desktop-*.yml`](../.github/workflows) | Added: the tag-gated signed desktop release and the macOS/Windows/Linux installed-update acceptance workflows ([note](../.agents/notes/implemented/process/2026-08-17-tag-gated-desktop-release-builds.md)) |
| [`.github/dependabot.yml`](../.github/dependabot.yml) | Drops the `uv` ecosystem entry for `python/sdk`, which this fork does not release |
| [`.gitignore`](../.gitignore) | Ignores the desktop build outputs `src-tauri/target/`, `src-tauri/gen/`, `src-tauri/binaries/`, `.bridge-pack/`, and `.runtime/`, plus `temp/` |
| [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | Drops upstream's `@electron/osx-sign` entry from `patchedDependencies`, together with `patches/@electron__osx-sign@1.3.3.patch`; only the Electron packager reads that patch, and `pnpm install` fails on an unused one |

## Removed upstream automation

Upstream added its own Electron-based `apps/desktop` (PR #3413); this fork keeps the Tauri 2 shell described in [the desktop README](../apps/desktop/README.md), and no file upstream adds under that path survives a merge.

This fork keeps no inherited workflow. Upstream's `build-exe-for-python-sdk.yml`, `build-preview-cloudflare.yml`, `ci.yml`, `ci-master.yml`, `docs-pages.yml`, `e2b-e2e.yml`, `e2e.yml`, `expected-filenames.yml`, `issue-lifecycle.yml`, `issue-policy.yml`, `node-addon-system.yml`, `node-addon-system-release.yml`, `pi-ai-provider-e2e.yml`, `python-release.yml`, `release.yml`, `release-publish.yml`, `release-vendor.yml`, `release-vendor-publish.yml`, `sandbox.yml`, `weighted-approval.yml`, and `weighted-approval-review-event.yml` are all absent, and none of them is restored. The helper directories those workflows drive, `.github/issue-management/` and `.github/review-ownership/`, stay because their own tests read no workflow.

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
