# Agent Note: Desktop controlled update-smoke manifest URLs

Status: implemented

English | [English](2026-08-22-desktop-update-smoke-manifest-base.md)

## Problem

更新器清单默认指向已发布的 GitHub Release,而已安装版本 N 到 N+1 的冒烟需要在目标 runner 的本地端点提供已签名的 N+1 fixture,同时不能改变生产下载位置。

## Decision

`updater-manifest.mjs` 保留 GitHub Release URL 作为默认值,并接受受控更新冒烟使用的显式 `downloadBaseUrl`。URL 构建器只接受不带查询和片段的 HTTP(S) base,拒绝带路径分隔符的 tag 与构件名,并将经过编码的 release tag 和构件名作为独立路径组件追加。默认 URL 与受控 URL 使用相同的签名校验和目标构件清单校验。

命令行生成器通过 `--download-base-url` 暴露同一选项。本地 smoke 因此可以在临时 HTTP(S) 目录准备 `latest.json` 和已签名的主构件,而生产清单仍然保留 GitHub Release 端点。已安装应用仍需要按目标注入端点;目标原生安装、重启、用户确认和用户数据保留仍需要目标 runner 证据。

## Alternatives considered

**在测试期间替换生产 GitHub 端点。** 放弃,因为 draft-release 校验不能改变已发布客户端使用的端点。

**接受任意 URL 字符串并拼接文件名。** 放弃,因为查询、片段、路径分隔符和含糊的 base 可能生成与操作者预期不同的端点。

## Consequences

清单生成器可以生成目标 runner 本地的更新 fixture,而不重复签名或构件选择逻辑。默认发布行为不变;本地 HTTP 端点只用于测试,因为已签名发布配置仍要求 HTTPS。

## Testing

`apps/desktop/scripts/updater-manifest.spec.mjs` 覆盖本地 base URL 渲染、无效 scheme、查询和片段拒绝、带路径的 tag,以及受控 base 应用于所有支持目标行。现有签名和清单案例继续覆盖同一代码路径。
