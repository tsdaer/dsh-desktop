# Agent Note: Desktop update-smoke endpoint injection

Status: implemented

[English](2026-08-22-desktop-update-smoke-endpoint-injection.md) | 中文

## Problem

清单生成器可以在本地 URL 准备已签名更新 fixture,但打包应用通常从 Tauri 配置读取生产 GitHub endpoint。因此,目标原生更新冒烟需要一种明确方式,构建一个读取受控 fixture endpoint 的应用。

## Decision

`apps/desktop/scripts/tauri-config.mjs` 校验显式提供的 HTTP(S) updater endpoint,并将其表示为后置 Tauri 配置层。`bundle.mjs` 接受 `--updater-endpoint`,在私有临时目录写入该层,校验生效配置,把两个经过审查的层传给 Tauri,并在 `finally` 中移除临时目录。构建开始前会拒绝凭据、查询字符串和片段。

生产 bundle 命令不传入该选项,继续使用 `tauri.conf.json` 中的 GitHub endpoint。该覆盖层与目标无关,因此 Windows、Linux 和 macOS 目标 runner 可以复用同一个 smoke fixture,无需修改已提交的目标层。

## Alternatives considered

**为 smoke 修改 `tauri.conf.json`,完成后恢复。** 放弃,因为中断运行可能把可变的源配置留在错误状态,使提交的生产 endpoint 依赖测试顺序。

**让 updater client 从环境变量读取 endpoint。** 放弃,因为打包发布会允许运行时环境替换已签名应用配置,也不能验证被测试构件内嵌的 endpoint。

## Consequences

目标原生 job 可以构建指向 runner 本地已签名更新 fixture 的构件,生产构件仍保留 GitHub endpoint。endpoint 层是临时文件,不会成为发布资源。安装版从版本 N 下载版本 N+1、用户确认、替换、重启和用户数据校验仍需要目标原生更新冒烟。

## Testing

`apps/desktop/scripts/tauri-config.spec.mjs` 覆盖 endpoint 校验、生效层合并和额外 Tauri 参数。现有目标配置与 updater 清单测试继续覆盖 bundle 选择和已签名 fixture 清单。本机 Windows 环境只验证配置组装,不提供 Linux 或 macOS 的安装版更新证据。

## Related

[受控更新 smoke 清单 URL 记录](2026-08-22-desktop-update-smoke-manifest-base.zh.md)定义已签名 fixture URL 机制。整体发布顺序和支持标准由[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.zh.md)定义。
