# Agent Note: 生产安装裁剪 lefthook 时，根 postinstall 应直接跳过

Status: implemented

[English](2026-08-16-root-postinstall-production-install.md) | 中文

## Problem

桌面发布工作流的负载大小门禁以 `ERR_MODULE_NOT_FOUND: Cannot find package 'lefthook' imported from ...\scripts\install-lefthook.mjs` 失败，中断了 NSIS 安装包构建。

失败链条横跨 pnpm 状态与 postinstall 脚本：

- bundle 步骤通过 [`apps/desktop/scripts/bake-runtime.mjs`](../../../../apps/desktop/scripts/bake-runtime.mjs) 运行 `pnpm deploy --filter @deepseek-ai/dsh --prod --legacy --config.nodeLinker=hoisted`。legacy 部署安装保留根工作区作为 `workspaceDir`，因此会用部署的设置（`production: true`、`dev: false`、`filteredInstall: true`）重写根工作区状态文件 `node_modules/.pnpm-workspace-state-v1.json`。
- pnpm 11.7 将 `verifyDepsBeforeRun` 默认为 `install`：每次 `pnpm run` 之前都会检查工作区状态，当 node_modules 与锁文件不同步时，会用记录在案的设置推导出的参数运行 `pnpm install`。部署记录的设置映射为 `--production`（`production && !dev`），因此下一步——`pnpm --filter @deepseek-ai/dsh-desktop size-check`——自动运行了 `pnpm install --production`，裁剪掉全部 419 个 devDependencies。
- `lefthook` 是根 devDependency。根 `postinstall`（[`package.json`](../../../../package.json)）运行了 [`scripts/install-lefthook.mjs`](../../../../scripts/install-lefthook.mjs)，而该脚本在模块顶层导入了 `lefthook/package.json`。ESM 在 `main()` 运行之前就会求值顶层导入，因此 CI 守卫（`CI=true` / `GITHUB_ACTIONS=true`）和可用性跳过都无法执行：模块加载本身即抛错，postinstall 失败，安装失败，门禁失败。

同样的崩溃也会发生在检出目录上的任何 `pnpm install --production`。安装脚本的设计本是在 Lefthook 不可用时直接跳过，但静态导入把"不可用"变成了加载期崩溃。

## Decision

[`scripts/install-lefthook.mjs`](../../../../scripts/install-lefthook.mjs) 不再在模块加载时导入 `lefthook/package.json`。`lefthookBinAvailable()` 动态导入它，并在解析抛出 `ERR_MODULE_NOT_FOUND` 时返回 `false`；其余任何失败仍然大声失败。`main()` 在 CI 守卫之后、任何 Git 交互之前执行该检查：当 Lefthook 未安装时，安装脚本直接返回、不触碰仓库，与它的其他可用性跳过（CI、无 Git 仓库、无 `.bin` 垫片）完全一致。

守卫的语义没有变化：它仍然要求已安装包清单中的 `bin.lefthook` 是字符串，既有的 `.bin` 垫片存在性检查仍然把关安装。

## Alternatives considered

**保留静态导入并依赖 CI 守卫。** 不可行：顶层 ESM 导入在 `main()` 运行之前就被求值，守卫永远观察不到失败——崩溃的正是模块加载本身。

**通过 `fs` 读取 `node_modules/lefthook/package.json` 并容忍 ENOENT。** 可行，但等于手写一个 Node 已经会解析的路径。动态导入保留 Node 自身的裸说明符解析，并且除包缺失外的任何错误仍然大声失败。

**完全去掉清单守卫。** `.bin` 垫片存在性检查已经覆盖了实际的缺失场景，但清单检查还能区分"包存在但缺少预期的 bin"（损坏或占位安装），并保留最初钩子安装修复中刻意加入的守卫。

**改为修工作流（把 `verifyDepsBeforeRun` 固定为 `warn`，或在部署后重新安装）。** 那只是处理一个合法操作的一种触发方式：`pnpm install --production` 是文档化的安装模式，`pnpm run` 前的自动重装也是 pnpm 自身的默认行为。无论哪个工作流步骤触发，postinstall 都必须能在生产安装下安全运行。

## Consequences

生产安装与桌面发布的大小门禁不再让根 postinstall 崩溃：pnpm 11.7 在 `size-check` 步骤之前自动运行的 `pnpm install --production` 仍然会执行（工作区状态记录了部署的生产设置），但现在能正常完成，门禁通过。任何在 `--prod` 部署之后的 `pnpm run` 都会按 pnpm 默认行为再次执行生产裁剪；postinstall 会直接跳过而不是中断它。

清单探测现在会在每次到达该处的 postinstall 中运行。它是进程内的动态导入，相对其后的 Git 操作成本可忽略。

回归测试固定在 [`scripts/install-lefthook.spec.ts`](../../../../scripts/install-lefthook.spec.ts) 中：把安装脚本的副本放到检出目录之外（使裸说明符 `lefthook/package.json` 无法解析），脚本以 0 退出且无任何输出；而旧的顶层导入会以 `ERR_MODULE_NOT_FOUND` 崩溃。

[worktree 本地钩子决策](../process/2026-07-27-worktree-local-lefthook.md) 的 worktree 本地钩子安全约定不受影响：本次改动只移动了可用性探测的执行时机。
