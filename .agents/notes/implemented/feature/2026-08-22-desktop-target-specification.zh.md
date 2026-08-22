# Agent Note: Desktop target specification

Status: implemented

English | [中文](2026-08-22-desktop-target-specification.md)

## Problem

桌面构建脚本分别选择 Windows x64。sidecar 文件名、原生预构建键、运行时目录、产物目录和 bundle 命令可能在加入第二个平台时互相不一致。

## Decision

`apps/desktop/scripts/target-spec.mjs` 是受支持产品目标的唯一策略来源，目前包含 Windows x64、Linux x64 和 macOS arm64。脚本通过 `--target` 接收显式 Rust target triple；未提供时，解析器只接受 `rustc -vV` 报告的宿主 triple。不支持或格式错误的 triple 会在脚本下载、删除或暂存文件之前失败。

每一行目标规格负责 Node 发行版名称与压缩包类型、精确的 sidecar 源成员和目标文件名、原生平台键、bundle 类型、产物目录、更新器后缀、按目标区分的运行时目录和大小预算。sidecar 获取、运行时烘焙、大小报告和 bundle 编排都消费同一个不可变规格。压缩包成员在拼接到临时解压目录之前会先经过路径校验。

Windows Tauri 资源路径现在指向按目标划分的运行时目录。bundle 命令把同一个解析出的目标传给所有准备步骤和 `tauri build`；这为后续按平台拆分 Tauri 配置及原生打包工作建立了目标选择接缝。本变更不会把 Linux 或 macOS 宣布为已发布支持平台，因为 Rust 壳、Tauri 配置、发布工作流和打包 smoke 证据仍需完成计划中的后续工作包。

## Testing

`apps/desktop/scripts/target-spec.spec.mjs` 固定了三行目标规格的全部识别字段，拒绝缺失或不支持的目标，验证三种 Node 压缩包布局，并拒绝压缩包路径穿越。Node 脚本语法检查通过，`git diff --check` 通过。

## Alternatives considered

**在每个脚本中从 `process.platform` 推断产品目标。** 不采用，因为发布准备和原生打包必须共享一个显式目标，重复的宿主推断会让 sidecar、运行时和 bundle 逐渐不一致。

**继续使用一个共享的 `.runtime/deploy` 目录。** 不采用，因为切换目标或运行矩阵任务时可能复用其他平台的原生字节。运行时目录按 Rust target triple 区分。

**在定义规格时顺带加入更多架构。** 不采用，因为计划要求先取得原生依赖和 runner 证据，再扩大受支持目标集合。

## Consequences

Windows 本地 bundle 必须重新烘焙到 `.runtime/x86_64-pc-windows-msvc/deploy`；未限定目标的旧运行时目录已不再是配置的资源来源。目标解析器已经可供后续工作包使用，但每个平台仍需完成原生运行时、Rust、Tauri、发布、更新器、安装、以及打包 GUI 证据，才能列为受支持平台。
