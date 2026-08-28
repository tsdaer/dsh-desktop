# Agent Note: 桌面 Source Control 写入

Status: implemented

[English](2026-08-21-desktop-source-control-actions.md) | 中文

## Problem

只读的 Worktree 投影([桌面 Worktree Source Control](../../implemented/feature/2026-08-19-desktop-worktree-source-control.zh.md))能显示更改但不能操作。暂存、撤销暂存、丢弃、提交和差异查看各自需要一条安全的 Git 变更路径,而基于过期状态的破坏性操作会把一次失误变成数据丢失。

## Decision

桌面桥接在 `/dsh-bridge/worktree/source-control` 下新增四个 POST 路由和一个 GET 路由:`stage`、`unstage`、`discard`、`commit` 与 `diff`。浏览器只发送 Workspace id、Workspace 相对路径和提交信息;所有 Git argv 在 Host 侧固定,所有命令从 Host 推导的工作区根目录(或读取 blob 时的仓库根目录)运行,每次写入都先重读状态投影,对过期或未分类的条目以稳定错误码拒绝。

- `stage` 运行 `git add -A -- <paths>`(重命名包含原路径)。
- `unstage` 运行 `git restore --staged -- <paths>`。
- `discard` 对已跟踪条目运行 `git restore --staged --worktree`,对未跟踪条目运行 `git clean -f`,均先经过点名该文件的行内确认。
- `commit` 用临时索引(`GIT_INDEX_FILE`)从 HEAD 加上仅限该 Workspace 已暂存条目构建提交(`git ls-files -s` 喂给 `update-index --cacheinfo` / `--force-remove`),因此提交永远不会包含所选 Workspace 之外的文件;空仓库以 `read-tree --empty` 为基线。
- `diff` 用 `git show HEAD:<repo 相对路径>`(重命名取原路径)读取 HEAD blob,工作区侧通过有上限的 `fs.readBytes` 读取,两侧都以严格 UTF-8 解码,拒绝二进制内容,标记单侧截断,并通过共享的 `DiffBlock` 呈现。

未分类条目(仅 unsupported 或空状态)不提供任何变更操作与差异。请求中止会取消子进程工作;超时复用只读路由的界限。Git stderr 在变更失败时以有上限的 `detail` 回传。错误响应只以响应可写性为门控,因为请求流在请求体结束后会自动销毁。

## Alternatives considered

**提交整个仓库索引** — 拒绝:验收要求提交限定在所选 Workspace 内,整索引提交可能包含其他工具在工作区外暂存的更改。

**按 pathspec 提交**(`git commit -m msg -- <paths>`)— 拒绝:pathspec 提交记录的是所列路径的工作区内容,会静默包含用户暂存后又修改的更改;临时索引则精确提交已暂存的 blob。

**接受浏览器提供的 Git 参数** — 依只读 note 的理由拒绝:固定 argv 与 Host 推导路径使浏览器值远离命令权威。

## Consequences

变更仅限整文件;hunk 与行级暂存需要 Host 尚不拥有的 diff 模型,推迟实现。提交需要配置 Git 身份;身份失败以有上限的 stderr 呈现。pre-commit 钩子针对临时索引运行,临时索引文件事后尽力清理。

## Testing

聚焦的桌面测试钉住固定 argv、操作矩阵、过期与未分类拒绝、索引条目解析与临时索引计划构建、二进制与截断差异处理,以及一个 handler 级回归:请求流自动销毁后 POST 错误响应仍被写出。客户端测试覆盖行内操作按钮的可用性、点名文件的确认流程、提交栏行为与 DiffBlock 面板。live 证据服务器以临时仓库做了端到端演练,包含一次真实提交。
