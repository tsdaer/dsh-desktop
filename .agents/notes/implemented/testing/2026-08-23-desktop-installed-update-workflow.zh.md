# Agent Note: Desktop Linux installed update workflow

Status: implemented

English | [English](2026-08-23-desktop-installed-update-workflow.md)

## Problem

已安装更新 smoke 可以协调已签名 fixture 和打包应用,但还没有目标原生 workflow 使用所需的 loopback endpoint 构建两个版本并在 Linux 上执行版本转换。

## Decision

`.github/workflows/desktop-update-acceptance.yml` 是手动运行的 Linux x64 验收 workflow。它接受两个标签引用和一个固定 loopback 端口,在读取版本数据前把每个标签解析为提交,校验初始 checkout 与版本 N 快照一致,即使标签引用在运行期间移动也始终从已捕获的提交构建。它校验第二个版本更新,使用 loopback updater endpoint 构建版本 N,在同一个 Ubuntu runner 上构建并签名版本 N+1,暂存下一版本 updater inventory,再在 `xvfb-run` 下启用打包终端探针调用 `apps/desktop/scripts/update-smoke.mjs`。

workflow 在切换标签时把版本 N 的 AppImage 保存在 checkout 外,把版本 N+1 构件暂存到独立临时目录,并显式传入清单路径。它会在成功或失败时上传 smoke 日志,只使用只读仓库权限,不会创建或修改 GitHub Release。

该 workflow 记录 Linux 目标 runner 的更新证据,但不改变受支持发布状态。最低发行版兼容性、打包 GUI 证据以及 Windows 和 macOS 对应的 runner 检查仍是独立要求。

## Alternatives considered

**在 draft-release job 中运行检查。** 放弃,因为该 job 只构建一个版本,并且必须继续负责已校验的发布 inventory 和 draft 发布。

**下载两个已发布 Release 而不重新构建。** 放弃,因为版本 N 必须包含受控 loopback endpoint,而已发布构件使用生产 updater endpoint。

**使用宿主 mock updater 代替已签名 fixture。** 放弃,因为更新路径必须一起执行产品 updater 选择、签名校验、确认调用、重启和进程清理。

## Consequences

维护者可以从两个已捕获的标签快照获得可重复的 Linux N 到 N+1 更新证据,且 workflow 不需要 Release 写权限。校验后移动任一标签不会改变本次运行构建的字节;缺失或无效标签会在任何构建或暂存动作前失败。workflow 需要 updater 签名 secret 生成下一版本构件,因此它是显式验收运行而不是 pull request 检查。workflow 通过只证明 Linux 更新验收项;它不会单独发布或支持该平台。

## Testing

`scripts/desktop-update-workflow.spec.ts` 固定手动输入、Ubuntu runner、不可变标签校验、目标 endpoint 注入、签名暂存、目标原生 smoke、终端探针、只读权限以及无发布变更。桌面 update 和 packaged-smoke 脚本测试覆盖被调用的协调器及其清理路径。
