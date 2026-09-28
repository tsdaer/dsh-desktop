# 与上游的分歧

[English](fork-divergence.md) | 中文

本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork，新增了 [桌面端 README](../apps/desktop/README.zh.md) 描述的 Windows 桌面版。本页登记它偏离上游的每一处位置及原因。

## 范围与登记义务

`apps/desktop/` 之外的一切都归上游所有，包括 `packages/`、`apps/cli/`、`scripts/`、根配置、`docs/` 与 `.agents/`。桌面工作流文件 `.github/workflows/desktop-*.yml` 是本 fork 唯一完全自有的例外。

改动上游所有的路径时，必须在同一次改动里为它补上本页的一行及原因。仅限于 `apps/desktop/` 内的工作无需登记。每一行说明本 fork 的不同之处，并链接持有原因的 Agent Note；此处不重复其推理。

[根标准指令](../AGENTS.md)承载该义务，[README](../README.zh.md) 则面向从不打开 `AGENTS.md` 的读者陈述该立场。

## 共享源码

| 路径 | 分歧 |
|---|---|
| [`apps/cli/src/profile-boot.ts`](../apps/cli/src/profile-boot.ts) | 把 `DSH_BARE_MODULE_BASE` 透传给 `boot()`，使打包运行时解析内置包的同时，profile 自有 bundle 仍可解析（[note](../.agents/notes/implemented/bug-fix/2026-08-20-desktop-profile-bundle-resolution.zh.md)） |
| [`packages/client/tsdown.client.ts`](../packages/client/tsdown.client.ts) | 同时从 `apps/*/*/package.json` 解析工作区清单，因为桌面桥接 client 是 `packages/` 之外的工作区包 |
| [`tsconfig.host.json`](../tsconfig.host.json) | 省略上游的 `apps/desktop` 项目引用及测试/脚本 include：Tauri 外壳通过自己的 `apps/desktop/tsconfig.json` 构建，不进入 Host 聚合 |
| [`tsdown.config.ts`](../tsdown.config.ts) | Host 工作区构建排除 `apps/desktop`（它没有 `lib/types` 入口）；上游的 Electron 外壳有。其构建顺序注释描述 Tauri 外壳自身的管线，而非上游串联的 bundle 步骤（见 [`package.json`](../package.json) 行） |
| [`package.json`](../package.json) | 根 `build:lib:host` 在 Host tsdown 阶段结束：上游在这里串联其 Electron 主进程 bundle，而本 fork 的桌面 `bundle` 脚本是完整的面向目标的 Tauri 安装器打包，由桌面工作流在 `pnpm run build` 之后显式运行（[打包](../apps/desktop/README.zh.md)） |
| [`docs/development.zh.md`](development.zh.md) | 根构建顺序省略桌面 bundle 步骤，并说明 Tauri 桌面在根构建之外用自己面向目标的 bundle 步骤打包安装器（随 [`package.json`](../package.json) 行） |
| [`.agents/notes/`](../.agents/notes/) | 删除主体为被拒绝上游系统（Electron 桌面、继承的 CI lane）的上游时代 implemented 笔记，并清空冻结归档区；[同步契约笔记](../.agents/notes/implemented/process/2026-09-11-upstream-master-sync.zh.md)负责长期删除规则，上游历史仍可在 `upstream/master` 读取 |
| [`scripts/verify-archived-agent-notes.ts`](../scripts/verify-archived-agent-notes.ts) | 归档区没有产物时不再强制要求 kind 目录，因为 git 无法提交空目录 |
| [`packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`](../packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css) | 新增由桌面端可选开关驱动的 `html[data-dsh-logo-motion]` 悬停规则，浏览器用户仍遵循系统减少动效偏好（[note](../.agents/notes/implemented/feature/2026-08-20-desktop-logo-motion-opt-in.zh.md)） |
| [`packages/host/webserver/src/index.ts`](../packages/host/webserver/src/index.ts) | 可选 `token` 配置：已注册路由与 upgrade 需要 `Authorization: Bearer`（WebSocket 用 `dsh_token` 查询参数），静态 dist fallback 保持开放；缺省时纯 loopback 姿态不变（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.zh.md)） |
| [`packages/client/connection/src/client/rpc.ts`](../packages/client/connection/src/client/rpc.ts) | 从页面 URL 读取一次 `?dsh_token`，附加到每个通用 RPC fetch 作为 `Authorization: Bearer` header；无该查询参数的普通浏览器保持不变（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-loopback-token.zh.md)）。上游在 browser-auth 重构中删除了旧的 `web-api-client.ts` bearer 路径；桌面的 bridge 路由保留在 `apps/desktop/bridge-client/src/client/bridge-fetch.ts` 中的自有 bearer 拾取 |
| [`apps/web/src/main.ts`](../apps/web/src/main.ts)、[`apps/web/src/desktop-preview.tsx`](../apps/web/src/desktop-preview.tsx) | 将 `?dsh_preview=1` 路由到只读工作树预览挂载，普通页面继续沿用上游桌面启动路径（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-file-viewer.zh.md)） |
| [`packages/api/session-controller/src/agent.ts`](../packages/api/session-controller/src/agent.ts) | 在会话激活失败中加入插件不兼容提示，让读取已移除服务的已安装插件在错误里被点名 |
| [`packages/client/connection/src/browser-auth.ts`](../packages/client/connection/src/browser-auth.ts)、[`packages/client/connection/src/rpc.ts`](../packages/client/connection/src/rpc.ts)、[`packages/client/connection/src/client/loopback-token.ts`](../packages/client/connection/src/client/loopback-token.ts) | 在 index 重定向中保留 `dsh_token` 并在 client 中读取，使桌面桥接认证在登录后仍有效（[note](../.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.zh.md)）。会话 cookie 名称只哈希 hostname，token 交换使被取代的 `dsh-auth-*` cookie 过期，随机端口的桌面启动不再每次累积一条持久 cookie 直到请求头超出服务器上限（[note](../.agents/notes/implemented/bug-fix/2026-09-20-webview-cookie-accumulation.zh.md)） |
| [`packages/shell/bash-wsl`](../packages/shell/bash-wsl)、[`packages/shell/tool-bash-wsl`](../packages/shell/tool-bash-wsl) | 新增 WSL Bash 执行器与其模型可见工具，由桌面 WSL 设置启用（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-cross-platform-shell-runtime.zh.md)） |
| [`packages/bundle/web-app/presets/standard.patch.yml`](../packages/bundle/web-app/presets/standard.patch.yml)、[`apps/cli/tests/web-agent-presets.e2e.ts`](../apps/cli/tests/web-agent-presets.e2e.ts) | 在上游的声明式 standard 预设中加入带条件的 `tool-bash-wsl` 行，并把仅限 Windows 的目录证据保留在 presets e2e 套件中，两者均从被移除的文件式预设移植（[note](../.agents/notes/implemented/feature/2026-08-22-desktop-cross-platform-shell-runtime.zh.md)） |

## 仓库脚本

| 路径 | 分歧 |
|---|---|
| [`scripts/install-lefthook.mjs`](../scripts/install-lefthook.mjs) | 惰性导入 lefthook 的清单，使裁掉该 devDependency 的生产安装不会让 `postinstall` 失败（[note](../.agents/notes/implemented/bug-fix/2026-08-16-root-postinstall-production-install.zh.md)） |
| [`scripts/gen-config-catalog.ts`](../scripts/gen-config-catalog.ts) | 将粘贴的声明规范为 LF，使 Windows CRLF checkout 生成与其他主机相同的双语目录（[note](../.agents/notes/implemented/process/2026-08-08-native-windows-pull-request-ci.zh.md)） |
| [`scripts/gen-cordis-catalog.ts`](../scripts/gen-cordis-catalog.ts) | 将生成的 Cordis 区域规范为 LF，为双语配对提供相同的跨主机保证（[note](../.agents/notes/implemented/process/2026-08-08-native-windows-pull-request-ci.zh.md)），并把 fork 独有的 `desktopBridgeSettings` 桥接快照从服务遍历中豁免 |
| [`scripts/gen-tool-catalog.ts`](../scripts/gen-tool-catalog.ts) | 把本 fork 的 `bash-wsl` 工具加入待编目集合，使生成的 [`docs/tool-catalog.md`](tool-catalog.zh.md) 与英文版带有该行与章节 |
| [`scripts/desktop-release-workflow.spec.ts`](../scripts/desktop-release-workflow.spec.ts) | 新增，用于固定本 fork 自有的发布工作流 |
| [`scripts/verify-concrete-terms.ts`](../scripts/verify-concrete-terms.ts)、[`scripts/translation-pairing.ts`](../scripts/translation-pairing.ts) | 把本 fork 录制的 Web 快照 fixture 豁免出禁用词扫描（JSONL 携带会话格式自身的字段名），并把桌面构建产物目录排除出双语配对语料，两者均来自上游 0.1.7 的门禁重构 |


## 构建与 CI 配置

| 路径 | 分歧 |
|---|---|
| [`.github/workflows/desktop-*.yml`](../.github/workflows) | 新增：标签门控的签名桌面发布，以及 macOS/Windows/Linux 安装后更新验收工作流（[note](../.agents/notes/implemented/process/2026-08-17-tag-gated-desktop-release-builds.zh.md)） |
| [`.github/dependabot.yml`](../.github/dependabot.yml) | 去掉 `python/sdk` 的 `uv` 生态条目，本 fork 不发布它 |
| [`.gitignore`](../.gitignore) | 忽略桌面构建产物 `src-tauri/target/`、`src-tauri/gen/`、`src-tauri/binaries/`、`.bridge-pack/`、`.runtime/`，以及 `temp/` |
| [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) | 去掉上游在 `patchedDependencies` 中的 `@electron/osx-sign` 条目，以及 `patches/@electron__osx-sign@1.3.3.patch`；只有 Electron 打包器会读该补丁，而未使用的补丁会让 `pnpm install` 失败 |

## 移除的上游自动化

上游新增了它自己的基于 Electron 的 apps/desktop（PR #3413）；本 fork 保留[桌面 README](../apps/desktop/README.zh.md) 所述的 Tauri 2 外壳，上游在该路径下新增的任何文件都不会在合并后留存。

本 fork 不保留任何继承来的工作流。上游的 `build-exe-for-python-sdk.yml`、`build-preview-cloudflare.yml`、`ci.yml`、`ci-master.yml`、`docs-pages.yml`、`e2b-e2e.yml`、`e2e.yml`、`expected-filenames.yml`、`issue-lifecycle.yml`、`issue-policy.yml`、`node-addon-system.yml`、`node-addon-system-release.yml`、`pi-ai-provider-e2e.yml`、`python-release.yml`、`release.yml`、`release-publish.yml`、`release-vendor.yml`、`release-vendor-publish.yml`、`sandbox.yml`、`weighted-approval.yml` 与 `weighted-approval-review-event.yml` 全部缺失，且都不恢复。这些工作流驱动的辅助目录 `.github/issue-management/` 与 `.github/review-ownership/` 保留，因为它们的测试本身不读取工作流。

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
