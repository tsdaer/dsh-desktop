# Agent Note: Desktop installed-package web UI smoke

Status: implemented

[English](2026-08-23-desktop-installed-package-web-smoke.md) | 中文

## Problem

已安装包冒烟会验证就绪和目标运行时的 PTY 命令,但 Linux release job 的浏览器回放使用组装后的源码 Web profile,没有使用已安装桌面包提供的运行时。

## Decision

`packaged-smoke.mjs` 接受仅限 Linux 的 `--web-smoke`。已安装包保持运行期间,检查会用 Chromium 打开它的就绪 URL,要求文档响应成功,等待 conversation composer seat 及其 `data-composer-input` 编辑器挂载,校验文档标题,并可通过 `DSH_PACKAGED_WEB_SMOKE_SCREENSHOT` 写出截图。稳定的 composer 属性使已安装包检查与当前 Lexical 编辑器保持一致,且不依赖编辑器的元素类型。检查会关闭 Chromium,并在移除安装包前停止已打包进程树。

生产运行时烘焙会移除工作区的开发依赖。Linux release job 会先恢复锁定的开发依赖安装,再安装 Chromium,并对已安装的 deb 包运行这项检查以及目标运行时 PTY 探针。截图作为独立证据上传,与组装 Web 回放、基线记录和可安装发布资产分开。

这项检查覆盖已安装包的 shell、sidecar、运行时、HTTP server 和渲染后的 Web UI,但使用独立的 Chromium 进程。原生 Tauri WebView 渲染、面向用户的终端交互、更新、最低发行版和 GUI 证据仍是独立的验收要求。

## Alternatives considered

**把现有组装 Web 回放当作已安装包证据。** 否决:该回放启动的是源码 Web composition,不能证明已安装的 sidecar 和烘焙运行时能提供页面。

**连接到原生 Tauri WebView 并使用 Playwright。** 否决:目标 runner 的 WebView 没有稳定且可远程连接的浏览器端点;独立浏览器能保持检查确定性,同时保留原生 GUI 证据要求。

**立即在每个目标上运行该检查。** 否决:第一个新增发布目标是 Linux x64;该选项保持显式且按目标限制,避免给 macOS 和 Windows 引入未经验证的浏览器启动假设。

## Consequences

Linux 发布证据现在包含一张由已安装 deb 包提供的页面生成的截图,UI 挂载或标题检查失败会使安装包冒烟失败。这增强了打包运行时覆盖,但不会宣布 Linux 已受支持,也不会把 HTTP 渲染与原生 Tauri WebView 行为混为一谈。

## Testing

`packaged-smoke.spec.mjs` 覆盖参数解析,并拒绝 macOS 使用 `--web-smoke`。`scripts/desktop-release-workflow.spec.ts` 要求 Linux release job 在安装 Chromium 前恢复开发依赖、传入 `--web-smoke` 并上传截图。实际安装包和浏览器执行仍以目标 runner 为证据来源。
