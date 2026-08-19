# Agent Note: Desktop Worktree Source Control

Status: implemented

[English](2026-08-19-desktop-worktree-source-control.md) | 中文

## Problem

桌面端 Worktree 需要只读显示 Git 更改，同时不能允许浏览器输入选择仓库根目录、调用任意命令或接收无界的状态输出。

## Decision

桌面桥接提供 `GET /dsh-bridge/worktree/source-control`，请求只有一个字段：已注册的 `workspaceId`。Host 通过 `ctx.workspaceRegistry` 和 `ctx.fs` 解析规范化 Workspace 目录，通过固定的 `git --no-pager rev-parse --show-toplevel` 查找所属仓库，再通过 `ctx.subprocess` 读取 `git --no-pager status --porcelain=v1 -z --untracked-files=all`。浏览器不提供文件系统路径或 Git 参数。

当 Workspace 位于上级仓库下时，Host 只把 Host 派生的、相对于仓库的 Workspace 路径传给 Git，并把返回路径投影为相对于 Workspace 的路径。Workspace 如果本身是嵌套仓库，则由 Git 从该目录解析。Git 状态不会递归查询子模块；子模块显示为父仓库状态命令报告的条目。未知的 porcelain 记录保持为明确条目，不会被猜测成已支持的分类。

响应按已暂存、未暂存、未跟踪、冲突、重命名和不支持的状态分组。重命名记录保留旧的相对路径。非仓库 Workspace 返回明确的 `not-repository` 状态，不显示命令错误卡片；Git 失败返回 `unavailable`。条目数、响应字节、进程退出宽限时间和耗时上限均由桌面桥接配置，取消请求会取消文件系统和子进程工作。

Worktree 客户端直接在资源管理器中显示 Git 装饰。更改文件显示主要状态标记，父目录汇总后代状态和条目数，资源管理器标题栏显示 Git 加载、不可用、非仓库和截断状态。投影保持只读，不暴露仓库根目录或 Git 输出路径。

## Alternatives considered

**从仓库根目录运行 Git 并显示完整输出** — 不采用：Workspace 可能只是子目录，返回上级路径会暴露所选项目之外的文件。由 Host 派生的路径范围保证投影留在选定 Workspace 内。

**递归查询嵌套仓库和子模块** — 不采用：这会合并独立的 Git 历史，使状态归属不明确。Git 解析包含选定目录的仓库，子模块保持为父仓库状态命令拥有的条目。

**提供通用 shell 路由执行 Git 操作** — 不采用：固定 argv、Host 所有的工作目录和现有 subprocess 能力避免浏览器值进入命令权限，并保留取消与输出限制。

## Consequences

Source Control 要求桌面运行时可以使用 Git；发现或读取状态失败时报告不可用。仓库状态是快照，后续刷新可能观察到不同的更改，并不提供修改或暂存操作。NUL 分隔的 porcelain 解析保留包含空格或换行的路径；不支持或不安全的记录只通过有界的状态分类可见，绝不会成为文件系统权限来源。

## Testing

桌面 focused tests 固定 Git argv、Workspace id 校验、上级仓库路径过滤、所有支持的状态分组、重命名来源和条目截断。独立桥接 TypeScript 构建会编译 Host 路由，客户端构建会编译资源管理器 Git 装饰和状态指示器。
