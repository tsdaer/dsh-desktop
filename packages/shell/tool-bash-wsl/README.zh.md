---
description: "Windows 桌面端 shell seam 的 WSL Bash Consumer:在 WSL 设置与发行版探针健康时条件注册 bash 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-bash-wsl

[English](README.md) | 中文

## 概述

WSL Bash 执行世界的模型面对 Consumer([桌面 0.4 计划](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.zh.md)的 P4b)。仅在 WSL 设置启用且所选发行版探针健康时注册 `bash` 工具;禁用或不健康的配置会把 Bash 从工具组装中移除。

## 目录

- [行为](#behavior)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **条件注册** — `config.enabled` 为 false 时 `apply` 直接返回而不注册,因此 WSL Bash 关闭时 PowerShell 仍是唯一的 shell 工具。
- **自有 executor 实例** — 工具持有自己的 [`@deepseek-ai/dsh-bash-wsl`](../bash-wsl/README.zh.md) executor(ctx.shell 在 Windows 上仍由 pwsh 拥有),因此 PowerShell 与 WSL Bash 可共存。
- **模型可见渲染** — 前台运行以带 `[exit code: N]` 标记的终端卡渲染;后台启动以带 job id 的通用卡渲染;后台读取报告截断与 spill 路径。
- **工作目录翻译** — workdir 默认取会话头 cwd 并在 /mnt 下翻译;非盘符路径可见地失败,而不是逃出 Windows 权限立场。

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### 模型看到什么

本插件注册范围内的每个请求都包含下述 WSL Bash 指引,仅在工具启用时注册(WSL 设置加健康的发行版探针)。

##### Bash 指引

```markdown
Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token 影响

插件活跃并启用时,每个请求有小的固定输入成本。

#### KV 缓存影响

注册范围与提示文本不变时前缀稳定。插件激活或销毁可能使该提示段的重用失效。

### 工具 schema

#### 模型看到什么

工具启用并挂载时,模型看到生成的 [`bash` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-bash-wsl):command、description、可选的 timeoutMs 与 workdir(在 /mnt 下翻译的 Windows 路径),以及启用时的 run_in_background。agent 范围工具限制可移除该 agent 的定义。

#### Token 影响

工具可见时每个请求有固定 schema 成本。

#### KV 缓存影响

可见性与后台支持不变时前缀稳定。限制、配置变化或启用变化可能使已变工具定义的重用失效。

### 前台结果

#### 模型看到什么

一个终端卡,输出体为 stdout(有 stderr 时在标记段显示),退出胶囊带 `[exit code: N]`、`[timed out after Nms]` 或 `[killed by signal: S]` 标记。非零退出是报告而非错误——由模型决定如何反应。

#### Token 影响

与产生输出成正比的可变输入成本;长输出截断到尾部并附全文 spill 路径提示。

#### KV 缓存影响

无直接失效;结果按调用产生,不前缀稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅 Windows** — wsl.exe 是 Windows 二进制;本工具不在 POSIX 主机上注册。
- **无沙箱升级** — WSL 执行世界在 executor 边界强制 /mnt 限制;不宣传 sandbox-permissions 升级。

<a id="dev-note"></a>
### 开发备注

本包是桌面 fork WSL 集成(P4b)的一部分。它仅适用于 Windows,依据实时 WSL 设置与发行版健康度门控 bash 工具;路线图见[桌面 0.4 计划](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.zh.md)。
