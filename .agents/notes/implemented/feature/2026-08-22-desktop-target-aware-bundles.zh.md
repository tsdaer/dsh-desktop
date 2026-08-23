# Agent Note: Desktop target-aware bundle configuration and updater inventory

Status: implemented

English | [中文](2026-08-22-desktop-target-aware-bundles.md)

## Problem

目标选择已经覆盖 sidecar 和 runtime,但 Tauri 仍然只有 NSIS 配置,发布辅助脚本也假定只有一个 Windows 安装器。因此按目标构建的 runtime 仍可能与错误的 bundle 设置配对,或生成不完整的 updater 清单。

## Decision

`apps/desktop/src-tauri/tauri.conf.json` 保存共享的壳子、资源、图标、外部 sidecar 和 updater 设置。每个支持的目标在 `apps/desktop/src-tauri/tauri.<target>.conf.json` 下增加一份经过审查的层;bundle 命令校验合并后的配置,并把该层与明确的 Rust target 一起传给 Tauri。runtime 输出目录在 `src-tauri/runtime/` 下使用目标行的产品键,因此切换目标时不会复用其他目标的 bundle 目录,Windows 资源路径也能保持在 NSIS 的长度限制内。

`size-report.mjs` 检查目标 runtime 和每个预期构件后缀,把 runtime 字节数与压缩安装器字节数分开报告,并在 runtime 超预算、混入开发依赖或构件清单不完整时失败。`release-artifacts.mjs` 校验直接 bundle 输出并按产品目标目录暂存,在生成 hash 前校验合并后的发布清单。`updater-manifest.mjs` 把主更新构件映射到发布工作区实际存在的目标目录,从共享的 Tauri 配置读取 updater 公钥,并在写入清单前校验每个主构件的 Minisign 文件签名和 trusted comment 签名。它会拒绝缺少签名、主构件重复、文件名异常、空签名、签名无效和版本不匹配。

`.github/workflows/desktop-release.yml` 只校验一次版本、标签、Changelog 和源码 commit,然后在各自的原生 runner 上构建 Windows x64 与 Linux x64,使用彼此独立的 sidecar 和 runtime。macOS arm64 job 通过经过审查的实验性配置构建未签名的 app 和 dmg,不生成 updater 构件;这些证据单独上传,不会进入发布清单。draft job 下载 Windows 与 Linux 的两个暂存清单,记录 `SHA256SUMS`,并且只创建或刷新 draft Release。

## Testing

目标规格、Tauri 层校验、构件发现、发布暂存和 updater 清单测试覆盖三个目标、缺少和重复构件、错误版本、异常文件名、暂存目标选择、按目标输出路径、未签名 macOS 构件模式、有效 Minisign fixture、构件被修改以及公钥不匹配。现有 Tauri 生成的 Windows updater 构件也会使用配置中的公钥完成校验。CI workflow 规格测试固定标签校验、原生 runner 选择、独立的 macOS 实验性 job、受支持发布目标的签名输入检查、暂存清单校验、hash 生成和仅 draft 发布。现有 sidecar 和原生 runtime 测试会从 bundle 命令一起运行。

## Consequences

本地和 CI 命令必须提供目标原生 runtime,并在切换平台时使用 `--target <triple>`。发布工作流会生成不共享原生 runtime 字节的 Windows 与 Linux draft 清单,并把 macOS 构建证据分开保存。Linux 与 macOS 在各自的签名(适用时)、安装、更新、卸载和打包 GUI 证据完成前仍不算受支持。

## Alternatives considered

**在原位生成一个可变的 `tauri.conf.json`。** 放弃,因为生成文件会隐藏经过审查的平台策略,并可能让工作树留下另一个目标的配置。

**等矩阵出现后再保留 Windows-only 的发布辅助脚本。** 放弃,因为发布自动化消费这些机制之前就必须验证按目标的构件发现和 updater 行;扁平 Windows 回退则保证过渡期的现有工作流继续可用。
