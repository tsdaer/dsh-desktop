# Agent Note: Desktop Linux baseline artifact

Status: implemented

[English](2026-08-23-desktop-linux-baseline-artifact.md) | 中文

## Problem

Linux 桌面发布的预检会在 workflow 日志中报告原生构建环境,但发布 job 不会把这份记录作为可下载的构建证据保留。

## Decision

`apps/desktop/scripts/linux-baseline.mjs` 接受可选的 `--output <file>` 路径。它写入包含已验证 Rust target、平台、glibc 版本、所需 GTK/WebKitGTK 版本和打包工具名称的 JSON 文档,同时保留 workflow 使用的一行日志记录。命令会创建输出文件的父目录;目标或前置条件校验无效时会在写文件前失败。

Linux 发布 job 把记录写入 runner 临时目录,并以带版本的证据 artifact 名称上传,即使后续 Linux 构建步骤失败也会执行上传。该 artifact 标识构建所用的环境,不证明对 runner 镜像更旧的发行版具有兼容性。

## Testing

脚本测试覆盖显式输出路径解析和缺失输出值。桌面 workflow 测试要求 Linux job 传入输出路径并上传生成的证据 artifact。现有注入 runner 测试继续固定基线字段和前置条件失败行为。

## Consequences

无需从临时日志重建,Linux 发布证据即可下载并在不同 workflow 运行之间比较。该 artifact 与可安装发布资产分离,不会改变受支持平台或最低发行版声明。

## Alternatives considered

**只保留 workflow 日志中的记录。** 否决:日志不便于比较,也不属于明确命名的构建证据清单。

**把 JSON 加入公开安装器发布。** 否决:预检描述的是构建 runner,不是终端用户安装包,不应扩大受支持下载集合。
