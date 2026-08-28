# Agent Note: Desktop macOS release signing lane

Status: implemented

[English](2026-08-22-desktop-macos-release-signing.md) | 中文

## 问题

macOS arm64 工作流只生成未签名的实验性 app 和 dmg,而正式发布路径没有受保护的证书、公证或 Gatekeeper 校验步骤。如果在 Tauri 生成 updater 压缩包之后再签名 app,压缩包及其签名就会对应不同的字节内容。

## 决定

现有 macOS experimental job 仍是默认路径。Windows/Linux draft 清单建立后,单独的 attachment job 会把未签名 arm64 app 压缩包和 dmg 添加到同一个 draft Release;这些构件不会进入受支持的发布清单。只有仓库变量 `DSH_DESKTOP_MACOS_RELEASE` 为 `true` 时才运行签名 macOS job;该 job 要求 Developer ID 证书、签名身份、Apple 公证凭据和 Tauri updater 私钥。缺少任一输入时,可选 job 会在发布前失败。

工作流把 Developer ID 证书导入临时 keychain,保存 runner 原有的 keychain 搜索列表,并在 bundle 阶段把 `APPLE_SIGNING_IDENTITY` 传给 Tauri。因此 Tauri 会在生成 updater 压缩包之前签名 app 及其中的原生 helper。always-run cleanup 步骤恢复搜索列表并删除临时 keychain 和证书。`macos-sign-release.mjs` 在 bundle 之后于 macOS 上校验嵌套代码和完整 app 的 `codesign` 签名,使用 `notarytool` 提交 dmg,对 app 和 dmg 执行 staple,再用 `spctl` 检查 app,然后从已 staple 的 app 重新生成 updater 压缩包并使用受保护的 Tauri 私钥签名。它不会在 updater 压缩包生成后重新签名 app。

签名 job 成功后,单独的 attachment job 下载所有目标清单,校验完整发布清单,从已签名的 macOS updater 构件重新生成 `latest.json`,重新计算 `SHA256SUMS`,并把 macOS 构件及更新后的元数据上传到现有 draft Release。签名 lane 被禁用或失败时,attachment job 会跳过。

## 测试

macOS 签名辅助脚本的测试覆盖必需输入缺失和嵌套原生文件发现。workflow specification 固定未签名 draft attachment、可选条件、原生 runner、签名命令、目标构件暂存、仅 draft attachment 和 updater manifest 刷新。本地环境没有 Apple 凭据或 macOS runner,因此签名、公证、Gatekeeper、安装、updater 安装和 GUI 证据仍需在 CI 或发布环境取得。

## 结果

macOS arm64 在完成原生打包启动、安装、更新、卸载和 GUI 证据之前仍是实验性目标。draft Release 会提供未签名 app 压缩包和 dmg 用于构建分发,但只有签名 job 暂存的构件可以进入 `latest.json`;未签名 experimental 构件不能进入该清单。

## 考虑过的方案

**把未签名 experimental 构件与正式构件一起发布。** 放弃,因为未签名 app 不能建立发布信任链,也不能提供安全的 updater 行。

**Tauri 生成 updater 压缩包之后再签名 app,但不重新生成压缩包。** 放弃,因为压缩包签名覆盖的是签名前的字节,而不是用户安装的 app;正式路径会在 staple 后重新生成并签名压缩包。

## 相关记录

目标行和 updater 清单由[桌面按目标 bundle 记录](2026-08-22-desktop-target-aware-bundles.zh.md)定义。整体发布顺序和支持标准由[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.zh.md)定义。现有 updater 行为由[桌面签名 updater 记录](2026-08-19-desktop-signed-updater.zh.md)定义。
