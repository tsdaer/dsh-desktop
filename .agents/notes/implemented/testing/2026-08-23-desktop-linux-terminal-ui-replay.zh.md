# Agent Note: Desktop Linux terminal UI replay evidence

Status: implemented

[English](2026-08-23-desktop-linux-terminal-ui-replay.md) | 中文

## Problem

Linux desktop release job 会验证安装包启动和目标运行时 PTY 命令,但这些检查不会运行组装 Web profile 的模型面对终端展示或浏览器导航。

## Decision

Linux release job 会安装带 runner 系统依赖的 Chromium,并在 `xvfb-run` 下以 `DSH_SNAPSHOT=replay` 运行 `apps/web/tests/navigation-panes.e2e.ts`。已提交的无 key fixture 通过浏览器协议驱动真实组装 Web 组合,在没有模型凭据的情况下验证终端卡片、轨迹详情、侧边栏导航和剪贴板交互。

fixture realization 会把宿主路径作为 JSON 转义后的字符串内容插入,浏览器快照归一化也接受原生和转义后的 Windows 路径,因此工作区路径包含反斜杠时也能使用同一回放。

Windows 上标准 preset 会选择 PowerShell,因此 Bash 专属浏览器断言会跳过;Linux release runner 会在原生 Bash 组合下执行这些断言。

job 会把回放日志和已有的失败截图独立于 Linux 安装包与基线产物上传。回放使用 workspace 构建后的组装源码 Web profile;它不声称已安装 Tauri WebView 渲染了相同交互。安装包启动、目标运行时 PTY 执行、已安装更新、最低发行版和打包 GUI 检查仍保留各自的证据要求。

## Alternatives considered

**把已打包 PTY 探针当作终端 UI 证据。** 放弃,因为它直接执行 `node-pty`,不会渲染模型面对的工具结果或浏览器交互。

**在 release job 中运行完整 Web snapshot 套件。** 放弃,因为 Linux 桌面标准只需要一个确定的终端/导航场景,而仓库更大的 Web 套件已有自己的 CI 质量门禁;扩大 release 构建不会改善这条证据边界。

**从 release job 驱动真实模型。** 放弃,因为无 key fixture 可以让终端交互可重复,并避免把 API 凭据放入 release 证据流程。

## Consequences

Linux release 日志现在包含模型面对终端卡片及其导航上下文的目标 runner 浏览器回放。回放只关闭组装 Web 证据缺口;它不会把 Linux 列为受支持平台,也不会替代已安装包 GUI、更新或最低发行版证据。

## Testing

`scripts/desktop-release-workflow.spec.ts` 要求 Linux job 安装 Chromium、运行该回放场景、使用回放模式并上传证据。现有 `navigation-panes` fixture 与 Web snapshot 质量门禁验证浏览器行为;桌面 packaged-smoke 测试继续验证目标资源启动、PTY 释放和安装包数据保留。
