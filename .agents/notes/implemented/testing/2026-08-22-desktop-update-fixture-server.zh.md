# Agent Note: Desktop update fixture server

Status: implemented

[English](2026-08-22-desktop-update-fixture-server.md) | 中文

## Problem

桌面 updater 会从已安装应用内嵌的 endpoint 读取带签名的目标构件。只有 manifest 的 fixture 不能证明目标 runner 能获取准确构件,同时又不触碰生产 GitHub Release。

## Decision

`apps/desktop/scripts/update-fixture.mjs` 在提供 fixture 前会校验显式目标、下一版本、暂存目标目录和 updater manifest。它要求存在该目标的平台行、文件名包含指定版本的构件、匹配的分离签名,并用 `tauri.conf.json` 内置公钥验证签名。随后它只从 loopback HTTP server 提供当前目标的 `latest.json` 与所选构件。构件名必须是暂存目标目录的直接子项,未知路径返回 404。

fixture server 不从宿主操作系统推断目标,也不修改生产 endpoint。版本 N 应用必须用打印出的 endpoint 构建,目标 runner 仍负责用户确认、安装、重启和用户数据检查。

## Alternatives considered

**提供完整的发布目录。** 放弃,因为针对单个目标的 fixture 不应允许更新 runner 选择其他平台的构件。

**只信任 manifest 中的签名文本,不检查暂存的 `.sig` 文件。** 放弃,因为这样 manifest 与可下载构件可能被独立替换。

**在辅助程序中加入自动确认和安装。** 放弃,因为这会绕过产品现有的用户确认路径,也无法证明实际 updater 交互。

## Consequences

目标原生更新工作现在有一个 loopback server,会在提供下一版本字节前验证其签名。该辅助程序可用于 Linux、Windows 和 macOS 的 fixture 准备;已安装更新证据仍需要各目标的原生打包、UI 交互、重启和用户数据校验。

## Testing

`apps/desktop/scripts/update-fixture.spec.mjs` 覆盖显式目标校验、版本与 loopback 主机解析、通过生成的 Minisign fixture 执行签名验证、仅当前目标的 manifest URL 改写、构件提供,以及未知路径和路径穿越拒绝。updater manifest 测试继续覆盖共用的签名格式与公钥检查。
