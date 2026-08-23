# Agent Note: Desktop macOS 已安装更新验收 workflow

Status: implemented

English | [English](2026-08-23-desktop-macos-installed-update-workflow.md)

## Problem

macOS 发布 lane 可以签名并公证一个构件，但这本身不能证明已签名的安装版本能发现并安装已签名的新版本，在重新启动后保留用户数据。

## Decision

`.github/workflows/desktop-macos-update-acceptance.yml` 提供手动运行的 macOS arm64 验收。它要求两个不可变版本标签和一个固定 loopback 端口，在读取版本前校验两个标签的提交，并拒绝版本不递增的标签对。

该 workflow 在 `macos-14` 上运行，把 Developer ID 证书导入临时 keychain，并用 loopback updater endpoint 构建版本 N。它会在把版本 N 的 dmg 复制到一次性更新目录前完成签名、公证、staple 和校验。随后它切换到记录的版本 N+1 提交，重复已签名发布准备，暂存目标构件，并生成下载地址指向 loopback fixture 的仅目标 updater 清单。

现有 `update-smoke` 驱动器提供已签名的下一版本 fixture，并通过现有更新器控件和确认路径启动版本 N 的 dmg。该 smoke 还运行打包 PTY 探针，把更新日志作为 workflow artifact 上传，并在始终执行的清理步骤中删除临时 keychain。该 workflow 不发布 Release，也不改变受支持平台声明。

## Testing

`scripts/desktop-macos-update-workflow.spec.ts` 检查手动输入、不可变提交传递、macOS 目标、签名和公证步骤、updater fixture 生成、终端 smoke、secret 使用、构件保留和 keychain 清理。在产品所有的 Apple 与 Tauri 签名凭据可用于 macOS runner 前，该 workflow 不会执行。

## Alternatives considered

**使用带 runner matrix 的 Linux 更新 workflow。** 不采用，因为 macOS 需要临时签名 keychain、Developer ID 公证、app staple 和 Gatekeeper 校验；共享 Linux job 会隐藏平台特有的清理和信任检查。

**只测试已签名 macOS 发布 lane。** 不采用，因为对一个版本完成签名和公证不能证明两个已安装版本之间的 updater 替换、重启或用户数据保留。

**由更新验收 workflow 发布 fixture 或 Release。** 不采用，因为该 workflow 只保留证据；它通过 loopback 提供构件并只上传日志，Release 发布仍由标签门控的发布 workflow 负责。

## Consequences

仓库现在有一个目标原生的 macOS 更新验收入口，会执行与发布相同的已签名构件路径。它只在 runner 上消费 Apple 和 updater secret；在该运行以及剩余打包 GUI 证据通过前，macOS 仍保持不受支持。
