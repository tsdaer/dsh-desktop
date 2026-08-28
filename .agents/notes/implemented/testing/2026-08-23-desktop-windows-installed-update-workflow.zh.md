# Agent Note: Desktop Windows 已安装更新验收 workflow

Status: implemented

[English](2026-08-23-desktop-windows-installed-update-workflow.md) | 中文

## Problem

Windows 发布 job 会校验一个已安装的 NSIS 包,但不能证明已安装版本能发现并安装已签名的新版本,重新启动后仍保留用户数据。

## Decision

`.github/workflows/desktop-windows-update-acceptance.yml` 提供手动运行的 Windows x64 验收。它要求两个不可变版本标签和一个固定 loopback 端口,在读取版本数据前把每个标签解析为提交,校验初始 checkout 和第二次 checkout 与捕获的提交一致,并拒绝不递增的版本对。

该 workflow 使用 loopback updater endpoint 构建版本 N,在同一个 Windows runner 上构建并签名版本 N+1,暂存下一版本 updater inventory,并启用 NSIS 安装模式和打包终端探针调用 `apps/desktop/scripts/update-smoke.mjs`。它上传 smoke 日志,只使用只读仓库权限,不会创建或修改 GitHub Release。

该 workflow 记录 Windows 目标 runner 的更新证据,但不改变受支持发布状态。原生执行、Explorer 集成以及剩余的打包 GUI 证据仍是独立要求。

## Alternatives considered

**依赖标签门控的 release job。** 不采用,因为该 job 只校验一个版本的安装和移除,不会构建受控的版本 N updater endpoint,也不会执行已签名的 N 到 N+1 转换。

**下载两个已发布的 Windows installer。** 不采用,因为版本 N 必须包含受控 loopback endpoint,而已发布构件使用生产 updater endpoint。

**由更新验收 workflow 发布 fixture 或 Release。** 不采用,因为该 workflow 只保留证据;它通过 loopback 提供构件并只上传日志,Release 发布仍由标签门控的发布 workflow 负责。

## Consequences

维护者可以从两个已捕获的标签快照获得可重复的 Windows N 到 N+1 更新证据,且 workflow 不需要 Release 写权限。workflow 需要 updater signing secret 生成下一版本 fixture,因此它是显式验收运行而不是 pull request 检查。通过该运行只能证明 Windows 更新验收项,不会发布或支持 Linux 与 macOS。

## Testing

`scripts/desktop-windows-update-workflow.spec.ts` 固定手动输入、Windows runner、不可变提交校验、目标 endpoint 注入、NSIS 安装模式、签名暂存、打包终端探针、只读权限以及无 Release 变更。共享的 desktop update 和 packaged-smoke 脚本测试覆盖被调用的协调器及清理路径。
