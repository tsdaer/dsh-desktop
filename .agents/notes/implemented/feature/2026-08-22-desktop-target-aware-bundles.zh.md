# Agent Note: Desktop target-aware bundle configuration and updater inventory

Status: implemented

English | [中文](2026-08-22-desktop-target-aware-bundles.md)

## Problem

目标选择已经覆盖 sidecar 和 runtime,但 Tauri 仍然只有 NSIS 配置,发布辅助脚本也假定只有一个 Windows 安装器。因此按目标构建的 runtime 仍可能与错误的 bundle 设置配对,或生成不完整的 updater 清单。

## Decision

`apps/desktop/src-tauri/tauri.conf.json` 保存共享的壳子、资源、图标、外部 sidecar 和 updater 设置。每个支持的目标在 `apps/desktop/src-tauri/tauri.<target>.conf.json` 下增加一份经过审查的层;bundle 命令校验合并后的配置,并把该层与明确的 Rust target 一起传给 Tauri。runtime 输出目录包含 Rust triple,所以切换目标时不会复用其他目标的 bundle 目录。

`size-report.mjs` 检查目标 runtime 和每个预期构件后缀,把 runtime 字节数与压缩安装器字节数分开报告,并在 runtime 超预算、混入开发依赖或构件清单不完整时失败。`updater-manifest.mjs` 把已签名的主更新构件映射到 `windows-x86_64`、`linux-x86_64` 和 `darwin-aarch64` 行,并拒绝缺少签名、主构件重复、文件名异常、空签名和版本不匹配。在发布工作流仍只支持 Windows 期间,脚本继续接受扁平的 Windows 构件目录。

## Testing

目标规格、Tauri 层校验、构件发现和 updater 清单测试覆盖三个目标、缺少和重复构件、错误版本、异常文件名以及按目标输出路径。现有 sidecar 和原生 runtime 测试会从 bundle 命令一起运行。

## Consequences

本地和 CI 命令必须提供目标原生 runtime,并在切换平台时使用 `--target <triple>`。Linux AppImage/deb 和 macOS app/dmg 配置已经可用于目标原生构建,但在发布工作流、签名、安装、更新、卸载和打包 GUI 证据完成前,这些平台仍不算受支持。

## Alternatives considered

**在原位生成一个可变的 `tauri.conf.json`。** 放弃,因为生成文件会隐藏经过审查的平台策略,并可能让工作树留下另一个目标的配置。

**等矩阵出现后再保留 Windows-only 的发布辅助脚本。** 放弃,因为发布自动化消费这些机制之前就必须验证按目标的构件发现和 updater 行;扁平 Windows 回退则保证过渡期的现有工作流继续可用。
