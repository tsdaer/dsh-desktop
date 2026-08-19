# Agent Note: 静态 Windows 更新清单包含架构回退项

Status: implemented

[English](2026-08-19-windows-updater-target-fallback.md) | 中文

## Problem

Tauri 更新器在已安装程序暴露 NSIS 安装包类型时，会选择 Windows 专用目标；否则会回退到只包含架构的目标。因此，只包含 `windows-x86_64-nsis` 的静态清单可能在无法读取安装包类型时找不到目标。桌面客户端会把这个 JSON 错误归类为更新清单无效，所以用户看到的消息不会指出缺少目标项。

## Decision

桌面发布清单生成器同时输出 `windows-x86_64-nsis` 和 `windows-x86_64`，两个条目使用相同的已签名安装包 URL 和签名。只包含架构的条目用于更新器目标查找的兼容回退，不会创建第二个安装包或签名。

## Alternatives considered

**只保留 NSIS 专用目标。** 已否决，因为目标检测是可选的运行时信号；有效的 NSIS 安装仍可能缺少专用查找所需的信号。

**只修改客户端错误文案。** 已否决，因为更清晰的提示不能使已发布的清单恢复可用。

**改用动态更新端点。** 已否决，因为 GitHub Release 产物有意采用静态签名清单，所需的发布元数据已经由生成器负责。

## Consequences

- 无论 Tauri 是否报告已安装程序的安装包类型，Windows 更新器都能完成检查。
- 两个清单条目必须继续指向同一个已签名 NSIS 产物。
- 后续发布清单会自动继承 `updater-manifest.mjs` 提供的回退项。

## Testing

生成器使用临时签名产物夹具执行；生成的 JSON 可以成功解析，并包含两个 Windows 目标键，且 URL 和签名完全一致。
