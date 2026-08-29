# Desktop Worktree Preview and Interaction Development Progress

[English](desktop-worktree-preview-interaction-progress.md) | 中文

Status: active

## Summary

截至 2026-08-29，`desktop-worktree-preview-interaction-plan.md`中的五个代码切片已经完成：路径插入与资源管理器图标、预览投影与渲染、独立 Tauri 预览窗口、安全的外部链接处理，以及支持 Lexical 的上下文菜单。

计划中剩余的事项是从已发布的服务器和模型流程录制真实桌面 GUI 证据。证据服务器现在可以在操作系统分配的回环端口上完成启动认证、Workspace 注册和 bridge 配置探测；应用内浏览器 fallback 已加载 Worktree 视图和页面内 README 预览。原生 Tauri 窗口和最终 GIF 证据仍待完成。

## Table of Contents

- [Overall status](#overall-status)
- [Completed slices](#completed-slices)
- [Verification evidence](#verification-evidence)
- [Open blockers](#open-blockers)
- [Next steps](#next-steps)

## Overall status

| Area | Status | Evidence |
| --- | --- | --- |
| 工作区相对路径插入与资源管理器展示 | Complete | 提交 `3608b68625`；专项测试和提交前检查通过 |
| 预览投影与渲染 | Complete | 提交 `cac1e606ee`；构建和专项检查通过 |
| 独立 Tauri 预览窗口 | Complete | 提交 `26f6aab8e8`；Rust 测试和应用构建通过 |
| 安全的外部链接处理 | Complete | 提交 `daaff48fea`；bridge 与 Rust 检查通过 |
| 支持 Lexical 的上下文菜单 | Complete | 提交 `4d5253718c`；18 个专项测试通过 |
| 真实桌面 GUI 证据 | Pending | 新建证据服务器和浏览器 fallback 已进入 Worktree 视图并打开 README 预览；原生 Tauri 窗口和 GIF 证据仍待完成 |

## Completed slices

### 工作区路径与资源管理器展示

工作区相对路径的拖放和插入会接受规范化的相对路径，拒绝绝对路径和逃逸路径，并在资源管理器中使用共享的文件夹、文件和警告图标。

实现锚点：`3608b68625`。

### 预览投影与渲染

Markdown 文件通过共享 Markdown 渲染器显示，源文件使用语法高亮，未知文本文件使用安全的文本代码围栏，并避免代码围栏与文件内容冲突。

实现锚点：`cac1e606ee`。

### 独立预览窗口

Tauri 命令会在独立预览窗口中打开经过校验的工作区文件，并提供每次启动的 bearer token、本地化标题、稳定且避免冲突的标签，以及最小窗口尺寸。

实现锚点：`26f6aab8e8`。

### 安全的外部链接

外部导航只接受不携带凭据、绝对形式、位于当前应用源之外的 HTTP(S) URL，排除 bridge 和回环目标，并通过 Tauri opener 命令或浏览器标签页打开获准的链接。

实现锚点：`daaff48fea`。

### 支持 Lexical 的上下文菜单

上下文菜单分类针对实际的 Lexical 编辑区域，只展示当前选区和编辑状态支持的操作，在关闭后恢复焦点，并在导航、外部交互和生命周期销毁时关闭。

实现锚点：`4d5253718c`。

## Verification evidence

- `pnpm exec vitest run apps/desktop/tests/context-menu.spec.ts` — 18 个测试通过。
- `pnpm --dir apps/desktop/bridge-client run build` — 通过。
- `pnpm run verify-client-ui-i18n` — 512 个源文件通过。
- `pnpm run build` — 通过。
- `pnpm run build:web` — 通过。
- `pnpm --filter @deepseek-ai/dsh-desktop test:evidence` — 7 个测试通过。
- 桌面 Tauri crate 的 Rust 测试 — 22 个通过，1 个 runtime-tree 测试忽略。
- 实现提交的提交前翻译配对、lint、空白字符和 vendor manifest 检查 — 通过。
- 进度文档的专项翻译配对检查 — 通过。

- `pnpm --filter @deepseek-ai/dsh-desktop evidence -- --port 0 --workspace J:\Projects\deepseek-harness` — profile 设置、启动认证、Workspace 注册、bridge 配置探测和 ready URL 输出均在操作系统分配的回环端口上完成；浏览器 fallback 已加载 Worktree 视图并打开 README 预览。

当前文档聚合检查的 15 个 gate 已全部通过。

## Open blockers

原生桌面 GUI 证据运行尚未录制。证据脚本现在允许 web profile 启动创建缺失的 installation fallback，同时仍拒绝启动前已经存在的非符号链接条目；它会在 bridge 请求前认证启动 URL，并接受操作系统分配的回环端口以适应受限主机。

在新建的证据工作区中完成已发布的服务器和模型流程之前，不声称已经生成 GUI GIF。

## Next steps

- 在允许回环绑定的主机上重新运行真实桌面流程。
- 录制计划要求的 GIF，覆盖工作树拖放、资源管理器图标、预览渲染、二进制文件拒绝、Lexical 上下文菜单操作和获准的聊天外部链接。
- 在无关的 runtime README 翻译配对不一致修复后重新运行文档聚合检查。

## Ownership

验收标准仍由`desktop-worktree-preview-interaction-plan.md`、[实现 Agent Note](../.agents/notes/implemented/feature/2026-08-19-desktop-worktree-explorer.zh.md)和专项测试负责；本页记录交付状态与验证证据。
