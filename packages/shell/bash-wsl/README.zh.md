# @deepseek-ai/dsh-bash-wsl

[English](README.md) | 中文

WSL Bash 服务提供者,服务于 [`@deepseek-ai/dsh-shell`](../shell/README.zh.md) 能力 seam([桌面 0.4 计划](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.zh.md)的 P4b)。每条命令以 `wsl.exe --distribution <name> --exec bash -c <command>` 形式,在经 `ctx.subprocess` 启动的受管理进程中运行。executor 拥有 WSL argv 与 Windows 到 `/mnt` 的工作目录翻译;显式 `/mnt` 路径限制匹配活跃 permission preset。

## 行为

- **WSL argv** — 命令以固定 `wsl.exe --distribution <name> --exec bash -c <command>` 形式运行;executor 与 wsl.exe 之间没有中间 shell 或引号层。
- **/mnt 翻译** — 工作目录从 Windows 盘符路径(`C:\foo` → `/mnt/c/foo`)经默认 interop 挂载翻译;非盘符路径(UNC、相对、已在 `/mnt`)可见地失败,而不是逃出 Windows 权限立场。`isUnderTranslatedRoot` 验证候选路径处于翻译后的 workspace root 之下。
- **与 PowerShell 共存** — 本 executor 不注册为 `ctx.shell`(单 executor seam 在 Windows 上仍由 pwsh、POSIX 上由 bash-sandbox 拥有);WSL tool 持有自己的实例,因此 PowerShell 与 WSL Bash 可共存。
- **本地机制** — 有界输出、spill 文件、进程组 SIGTERM→SIGKILL 升级、凭据清洗与期限处理均继承自 [`@deepseek-ai/dsh-bash-local`](../bash-local/README.zh.md)。

## 模型体验

间接,经由 WSL bash Consumer(`@deepseek-ai/dsh-tool-bash-wsl`),其拥有所有模型面对的进程输出与生命周期渲染。

#### KV Cache 效应

无直接失效;具名 consumer 拥有任何请求前缀变更。

## 已知限制与延后工作

- **仅默认挂载** — 首个版本不涵盖非默认 interop 挂载、远程 WSL 主机、WSL 1、自动安装包与持久 WSL 终端。
- **仅 Windows** — wsl.exe 是 Windows 二进制;本 executor 在 POSIX 主机上不可用。