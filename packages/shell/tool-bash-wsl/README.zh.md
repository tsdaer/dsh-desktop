# @deepseek-ai/dsh-tool-bash-wsl

[English](README.md) | 中文

WSL Bash 执行世界的模型面对 Consumer([桌面 0.4 计划](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.zh.md)的 P4b)。仅在 WSL 设置启用且所选发行版探针健康时注册 `bash` 工具;禁用或不健康的配置会把 Bash 从工具组装中移除。

## 行为

- **条件注册** — `config.enabled` 为 false 时 `apply` 直接返回而不注册,因此 WSL Bash 关闭时 PowerShell 仍是唯一的 shell 工具。
- **自有 executor 实例** — 工具持有自己的 [`@deepseek-ai/dsh-bash-wsl`](../bash-wsl/README.zh.md) executor(ctx.shell 在 Windows 上仍由 pwsh 拥有),因此 PowerShell 与 WSL Bash 可共存。
- **模型面对渲染** — 前台运行以带 `[exit code: N]` 标记的终端呈现;后台启动以带 job id 的通用卡片呈现;后台读取报告截断与 spill 路径。
- **工作目录翻译** — workdir 默认取会话 header cwd 并经 /mnt 翻译;非盘符路径可见地失败,而不是逃出 Windows 权限立场。

## 模型体验

`bash` 工具描述点名 WSL 2 执行世界、新 shell 语义、/mnt 工作目录与受管理的 `DSH_*` 环境事实。非零退出被报告而非报错 —— 由模型决定如何应对。

#### KV Cache 效应

无直接失效;工具提示区贡献于系统提示但不点名任何请求前缀缓存。

## 已知限制与延后工作

- **仅 Windows** — wsl.exe 是 Windows 二进制;本工具在 POSIX 主机上不注册。
- **无 sandbox 升级** — WSL 执行世界在 executor 边界强制 /mnt 限制;sandbox_permissions 升级不被广告。
