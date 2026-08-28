# Agent Note: Desktop installed update smoke

Status: implemented

[English](2026-08-23-desktop-installed-update-smoke.md) | 中文

## Problem

目标更新 fixture 可以提供已签名的下一版本构件，但已安装包检查还需要执行桌面更新器控件、应用重启、受管理进程清理和用户数据保留。

## Decision

`apps/desktop/scripts/packaged-smoke.mjs` 为显式选择的目标 runner 接受 `--update-smoke --expected-version <version>`。它使用临时结果路径和仅本次启用的 `DSH_DESKTOP_UPDATE_SMOKE=1` 环境变量启动已安装包，要求记录的版本先经过已安装版本再到达预期版本，停止重启后的打包进程，并保留现有的用户数据断言。

Rust 壳只有在该环境变量严格等于 `1` 时才启用驱动器。主页面加载后，驱动器会在 `available` 和 `ready` 状态点击现有更新器按钮，并让现有确认调用返回 true。每次打包启动都会把编译版本写入指定结果路径。普通启动不会创建结果文件，也不会改变更新器行为。

版本 N 安装包必须内嵌 `update-fixture.mjs` 提供的 loopback endpoint，提供的版本 N+1 构件必须通过同一目标的现有签名校验。该 smoke 驱动器不宣称最低发行版兼容性，也不替代独立的 GUI 证据。

`apps/desktop/scripts/update-smoke.mjs` 使用固定 loopback 端口协调 fixture server 与 `packaged-smoke`。它根据显式目标和构件后缀选择安装模式，直接把参数传给子进程，并在 smoke 成功或失败时关闭 fixture server。版本 N 安装包要单独使用同一端点构建；协调器不构建或修改任一版本的包。

## Alternatives considered

**加入不经过页面的原生更新命令。** 放弃，因为它会绕过产品更新器控件及其确认路径。

**只保留 fixture server 和手动确认。** 放弃，因为这样会把重启观察和受管理进程清理留给不可重复的手动流程。

**在打包构建中默认启用驱动器。** 放弃，因为发布启动绝不能自动批准更新或创建测试结果文件。

## Consequences

目标原生 job 在拥有使用 fixture endpoint 构建的版本 N 安装包和已签名的版本 N+1 构件后，可以运行确定性的 N 到 N+1 更新冒烟。该机制观察产品现有的 UI 状态机和确认调用，同时保持测试控制为显式启用。原生安装、更新器替换行为和 GUI 证据仍需要在每个受支持 runner 上执行。

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` 覆盖显式更新选项和版本校验。`apps/desktop/scripts/update-smoke.spec.mjs` 覆盖固定端口校验、按目标选择安装模式、直接传递子进程参数以及失败后的 fixture 清理。现有 bridge updater 测试继续覆盖两阶段确认和安装失败状态。Tauri Rust 测试覆盖现有壳契约；实际更新安装和重启证据仍需要目标 runner 执行。
