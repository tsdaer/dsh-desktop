# 与上游的分歧

[English](fork-divergence.md) | 中文

本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork，新增了 [桌面端 README](../apps/desktop/README.zh.md) 描述的 Windows 桌面版。本页登记它偏离上游的每一处位置及原因。

## 范围与登记义务

`apps/desktop/` 之外的一切都归上游所有，包括 `packages/`、`apps/cli/`、`scripts/`、根配置、`docs/` 与 `.agents/`。桌面发布工作流是本 fork 唯一完全自有的例外。

改动上游所有的路径时，必须在同一次改动里为它补上本页的一行及原因。仅限于 `apps/desktop/` 内的工作无需登记。每一行说明本 fork 的不同之处，并链接持有原因的 Agent Note；此处不重复其推理。

[根标准指令](../AGENTS.md)承载该义务，[README](../README.zh.md) 则面向从不打开 `AGENTS.md` 的读者陈述该立场。

## 共享源码

| 路径 | 分歧 |
|---|---|
| [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts) | 把 `DSH_BARE_MODULE_BASE` 透传给 `boot()`，使打包运行时解析内置包的同时，profile 自有 bundle 仍可解析（[note](../.agents/notes/implemented/bug-fix/2026-08-20-desktop-profile-bundle-resolution.zh.md)） |
| [`packages/client/tsdown.client.ts`](../packages/client/tsdown.client.ts) | 同时从 `apps/*/*/package.json` 解析工作区清单，因为桌面桥接 client 是 `packages/` 之外的工作区包 |
| [`packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`](../packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css) | 新增由桌面端可选开关驱动的 `html[data-dsh-logo-motion]` 悬停规则，浏览器用户仍遵循系统减少动效偏好（[note](../.agents/notes/implemented/feature/2026-08-20-desktop-logo-motion-opt-in.zh.md)） |
| [`packages/host/webserver/src/index.ts`](../packages/host/webserver/src/index.ts) | 可选 `token` 配置：已注册路由与 upgrade 需要 `Authorization: Bearer`（WebSocket 用 `dsh_token` 查询参数），静态 dist fallback 保持开放；缺省时纯 loopback 姿态不变（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.zh.md)） |
| [`packages/client/connection/src/client/rpc.ts`](../packages/client/connection/src/client/rpc.ts) | 从页面 URL 读取一次 `?dsh_token`，附加到每个通用 RPC fetch 作为 `Authorization: Bearer` header；无该查询参数的普通浏览器保持不变（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.zh.md)）。上游在 browser-auth 重构中删除了旧的 `web-api-client.ts` bearer 路径；桌面的 bridge 路由保留在 `apps/desktop/bridge-client/src/client/bridge-fetch.ts` 中的自有 bearer 拾取 |

## 仓库脚本

| 路径 | 分歧 |
|---|---|
| [`scripts/install-lefthook.mjs`](../scripts/install-lefthook.mjs) | 惰性导入 lefthook 的清单，使裁掉该 devDependency 的生产安装不会让 `postinstall` 失败（[note](../.agents/notes/implemented/bug-fix/2026-08-16-root-postinstall-production-install.zh.md)） |
| [`scripts/desktop-release-workflow.spec.ts`](../scripts/desktop-release-workflow.spec.ts) | 新增，用于固定本 fork 自有的发布工作流 |

## 构建与 CI 配置

| 路径 | 分歧 |
|---|---|
| [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml) | 新增：标签门控的签名桌面发布（[note](../.agents/notes/implemented/process/2026-08-17-tag-gated-desktop-release-builds.zh.md)） |
| [`.github/dependabot.yml`](../.github/dependabot.yml) | 去掉 `python/sdk` 的 `uv` 生态条目，本 fork 不发布它 |
| [`.gitignore`](../.gitignore) | 忽略桌面构建产物 `src-tauri/target/`、`src-tauri/gen/`、`src-tauri/binaries/`、`.bridge-pack/`、`.runtime/`，以及 `temp/` |

## 移除的上游自动化

本 fork 不保留任何继承来的工作流。`build-exe-for-python-sdk.yml`、`build-preview-cloudflare.yml`、`ci.yml`、`ci-master.yml`、`docs-pages.yml`、`e2b-e2e.yml`、`e2e.yml`、`expected-filenames.yml`、`issue-lifecycle.yml`、`issue-policy.yml`、`landlock-run.yml`、`landlock-run-release.yml`、`pi-ai-provider-e2e.yml`、`python-release.yml`、`release.yml`、`release-publish.yml`、`release-vendor.yml`、`release-vendor-publish.yml` 与 `sandbox.yml` 全部缺失，且都不恢复。

有一个后果是关键的：`scripts/ci-workflow.spec.ts` 会读取这些文件，因此它在本 fork 里以 `.github/workflows/ci.yml` 的 `ENOENT` 失败。该失败在此处属于预期，并不表示存在缺陷。不要通过恢复上游自动化来消除它。

## 文档与约定

| 路径 | 分歧 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | 陈述桌面端与 fork 立场，以及在本页登记分歧的义务；其余行经过压缩以守住字数上限（[note](../.agents/notes/implemented/process/2026-08-21-fork-divergence-register.zh.md)） |
| `README.md`、[`README.zh.md`](../README.zh.md) | 新增桌面版章节与 fork 立场 |
| `docs/development.md`、[`docs/development.zh.md`](development.zh.md) | 将 CI 工作流链接指向上游 URL，因为该文件在此处缺失 |
| [`.agents/skills/dsh-pre-push-checks/SKILL.md`](../.agents/skills/dsh-pre-push-checks/SKILL.md) | 允许在已证明的既有失败位于改动范围之外、且受影响面证据通过时推送 |
| `.agents/notes/**` | 承载桌面端决策记录；描述上游自动化的继承记录改为链接上游源文件 |

## 生成文件

`pnpm-lock.yaml` 与 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) 跟随本 fork 改动的清单变化。两者都是重新生成的，从不手工编辑，因此无需单独登记。
