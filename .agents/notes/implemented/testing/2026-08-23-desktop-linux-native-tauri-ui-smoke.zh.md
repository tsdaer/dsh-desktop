# Agent Note: Desktop Linux native Tauri UI smoke

Status: implemented

[English](2026-08-23-desktop-linux-native-tauri-ui-smoke.md) | 中文

## Problem

Linux 桌面检查会验证已安装包的就绪 URL 和 bundled PTY runtime,但终端卡片回放使用的是独立 Chromium 进程及组装 Web profile。两者都没有驱动已安装 Tauri 应用内部的 WebKit WebView。

## Decision

`apps/desktop/scripts/tauri-ui-smoke.mjs` 提供显式的 Linux x64 deb 构件检查。它用 `dpkg` 安装 package,启动 `tauri-driver`,为已安装可执行文件创建 W3C WebDriver session,并驱动原生 WebKit WebView 直到 composer 就绪。检查会把已提交的 `apps/web/tests/snapshots/navigation-panes/seed.jsonl` fixture 还原到临时 `DSH_HOME`;Web fixture 是录制结果而不是可以直接持久化的构件,因此 smoke 会在写入前使用当前格式版本、稳定 id、cwd、delegation depth 和 agent preset 重建 header。检查会确认全新 home 的内测声明,展开唯一折叠的 Workspace 或 Ungrouped row,再从主会话树打开唯一的持久化 session row,无论启动时该 row 是否已经被选中,展开模型面对的 Bash 终端卡片,要求出现 `NAVIGATION_OK`,并可保存 WebDriver 截图。导航失败会同时报告分组与 session row 的数量和标签,保留当前 WebView 截图,并打印有界的 driver 输出和隔离的原生 splash 日志。`DSH_PATCH` 会让桌面壳把临时 plaintext JSONL persistence 覆盖传给 Web profile;生产 bundle 保持不变。已安装进程会收到 display 和普通启动环境,但会删除名称中包含 `KEY`、`SECRET`、`TOKEN` 或 `PASSWORD` 的环境变量。组装后的 Web 回放继续保留内容索引搜索检查,因为它的 fixture 通过负责索引对账的后端 API 植入。

smoke 会通过与 deb package 冒烟相同的有界命令执行器,从 package manager 注册的文件清单中解析已安装可执行文件。它会 purge 已安装 package,并要求 `DSH_HOME` 中用户拥有的标记仍然存在。Linux release job 会安装 `webkit2gtk-driver`,构建 `tauri-driver`,在 `xvfb-run` 下运行 smoke,并把截图作为独立证据构件上传。该命令按目标限制,不会在 Windows 或 macOS 上运行。

这项检查用无 key transcript 证明原生 WebKit WebView 的 DOM 交互和已打包的模型面对终端呈现。它不证明真实模型流量、旧 Linux 发行版兼容性、更新器安装或完整的手工 GUI 清单。

## Alternatives considered

**把 Chromium 打包 Web smoke 当作原生 WebView 证据。** 否决:Chromium 是独立浏览器进程,没有覆盖 Tauri 内嵌的 WebKit WebView。

**在发布打包期间驱动真实模型。** 否决:已提交的无 key transcript 让发布证据可复现,也避免把 API 凭据放入 package workflow。

**在生产配置中使用 plaintext fixture。** 否决:生产 runtime 保持其既有 compression 配置;smoke 通过 `DSH_PATCH` 传入临时 launcher 覆盖,并在检查后移除该 home。

## Consequences

Linux 发布证据现在包含已安装 Tauri WebView 的截图和 DOM 断言,覆盖 composer、seeded session 导航和终端卡片。原生 driver 成为额外的 Linux 前置依赖,而该检查仍然只是证据;在计划中的更新、最低基线、卸载和打包 GUI 要求完成前,Linux 仍不受支持。

## Testing

`apps/desktop/scripts/tauri-ui-smoke.spec.mjs` 固定 Linux target 解析、持久化 header 必填字段、fixture 路径还原、敏感启动环境删除、内测声明确认、安全 session 路径、WebDriver capabilities,以及从折叠分组进入 session 的导航顺序。发布诊断还会通过真实的 `JsonlSessionPersistence.list()` 路径读取生成的 fixture。`apps/desktop/scripts/run-command.spec.mjs` 固定超过 Node 默认同步子进程缓冲区的已捕获 package 文件清单。`scripts/desktop-release-workflow.spec.ts` 要求 WebKit driver、`tauri-driver`、原生 smoke 调用和截图上传。实际安装包与 WebKit 执行仍以目标 runner 为证据来源。
