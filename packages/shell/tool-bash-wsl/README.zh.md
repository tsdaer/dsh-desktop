# @deepseek-ai/dsh-tool-bash-wsl

[English](README.md) | 中文

WSL Bash 执行世界的模型面对 Consumer([桌面 0.4 计划](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.zh.md)的 P4b)。仅在 WSL 设置启用且所选发行版探针健康时注册 `bash` 工具;禁用或不健康的配置会把 Bash 从工具组装中移除。

## 行为

- **条件注册** — `config.enabled` 为 false 时 `apply` 直接返回而不注册,因此 WSL Bash 关闭时 PowerShell 仍是唯一的 shell 工具。
- **自有 executor 实例** — 工具持有自己的 [`@deepseek-ai/dsh-bash-wsl`](../bash-wsl/README.zh.md) executor(ctx.shell 在 Windows 上仍由 pwsh 拥有),因此 PowerShell 与 WSL Bash 可共存。
- **模型面对渲染** — 前台运行以带 `[exit code: N]` 标记的终端呈现;后台启动以带 job id 的通用卡片呈现;后台读取报告截断与 spill 路径。
- **工作目录翻译** — workdir 默认取会话 header cwd 并经 /mnt 翻译;非盘符路径可见地失败,而不是逃出 Windows 权限立场。

## 模型体验

### 系统提示

#### 模型看到什么

本插件注册范围内的每个请求都包含下面的 WSL Bash 指引,仅在工具启用(WSL 设置加健康发行版探针)时注册。

##### Bash 指引

```markdown
Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token 效应

插件活跃且启用时,每个请求有少量固定输入成本。

#### KV Cache 效应

注册范围与提示文本不变时前缀稳定。插件激活或销毁可能使本提示段的复用失效。

### 工具 schema

#### 模型看到什么

工具启用并挂载时,模型看到生成的 [`bash` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-bash-wsl):command、description、可选的 timeoutMs 与 workdir(经 /mnt 翻译的 Windows 路径),以及启用时的 run_in_background。Agent 级工具限制可为该 agent 移除定义。

#### Token 效应

工具可见时每个请求有固定 schema 成本。

#### KV Cache 效应

可见性与后台支持不变时前缀稳定。限制、配置变更或启用状态变更可能使改动工具定义的复用失效。

### 前台结果

#### 模型看到什么

终端卡片,输出体为 stdout(有 stderr 时以标记段呈现),退出药丸携带 `[exit code: N]`、`[timed out after Nms]` 或 `[killed by signal: S]` 标记。非零退出被报告而非报错 —— 由模型决定如何应对。

#### Token 效应

输入成本与产出输出成正比;长输出被截断为尾部并附完整输出 spill 路径提示。

#### KV Cache 效应

无直接失效;结果按调用计,不前缀稳定。
## 已知限制与延后工作

- **仅 Windows** — wsl.exe 是 Windows 二进制;本工具在 POSIX 主机上不注册。
- **无 sandbox 升级** — WSL 执行世界在 executor 边界强制 /mnt 限制;sandbox_permissions 升级不被广告。
