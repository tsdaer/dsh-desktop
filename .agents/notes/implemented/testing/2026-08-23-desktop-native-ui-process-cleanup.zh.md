# Agent Note: Desktop native UI smoke process cleanup

Status: implemented

[English](2026-08-23-desktop-native-ui-process-cleanup.md) | 中文

## Problem

Linux 原生 Tauri UI smoke 可能在 `tauri-driver` 先于清理代码退出时永久等待,因为清理代码才开始监听 `exit` 事件。忽略正常终止信号的 driver 也没有有界的清理路径。

## Decision

`apps/desktop/scripts/tauri-ui-smoke.mjs` 使用 `terminateProcess()` 清理 `tauri-driver` 子进程。该 helper 会在注册 listener 前后检查已记录的退出状态,先发送 `SIGTERM`,等待可配置的宽限时间,必要时发送 `SIGKILL`,并返回子进程是否在强制终止截止时间前报告退出。driver 仍存活时 smoke 会在清理后失败,而清理等待本身有时间上限。

## Alternatives considered

**只注册一次性 `exit` listener 而不检查子进程状态。** 否决:子进程可能在创建后和清理开始前退出,listener 会等待一个不会再次发生的事件。

**无限等待 driver 正常关闭。** 否决:挂起的 WebDriver 进程会让目标原生发布 job 一直挂起,而不是产生有界失败。

**忽略在强制信号后仍存活的 driver。** 否决:成功的 smoke 不能遗留原生 WebDriver 进程;调用方在最后一次终止尝试后报告清理失败。

## Consequences

原生 Linux UI smoke 现在能确定性地处理 driver 提前退出,也不会无限等待正常关闭。该 helper 只属于 smoke harness,不会改变已打包应用的运行时进程策略。

## Testing

`apps/desktop/scripts/tauri-ui-smoke.spec.mjs` 覆盖已退出子进程、正常 `SIGTERM` 退出以及有界超时后的 `SIGKILL` 升级。WebKit 与已安装包证据仍需在目标 runner 上执行。

## Related

原生 WebKit 交互范围记录在 [Desktop Linux native Tauri UI smoke note](2026-08-23-desktop-linux-native-tauri-ui-smoke.zh.md)。已打包应用后代进程清理由 [Desktop packaged process cleanup verification note](../bug-fix/2026-08-22-desktop-packaged-process-cleanup.zh.md) 单独定义。
