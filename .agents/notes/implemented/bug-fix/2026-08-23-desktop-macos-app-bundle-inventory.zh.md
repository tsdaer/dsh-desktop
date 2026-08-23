# Agent Note: Desktop release inventory accepts the macOS app bundle

Status: implemented

[English](2026-08-23-desktop-macos-app-bundle-inventory.md) | 中文

## 问题

macOS 发布清单同时包含 Tauri 的 `.app` bundle 目录和带版本号的更新器、安装器文件。默认 bundle 目录名是 `dsh-desktop.app`,因此要求所有清单条目都包含发布版本号,会在附件阶段拒绝有效的已签名 macOS 发布包。

## 决定

`apps/desktop/scripts/release-artifacts.mjs` 要求每个已暂存文件名包含发布版本号,并允许目录使用目标平台的原生 bundle 名称。`.app` 目录仍受目标允许的后缀限制;带版本号的 `.app.tar.gz`、`.dmg` 及其分离签名继续执行版本检查。

## 测试

`apps/desktop/scripts/release-artifacts.spec.mjs` 使用 `dsh-desktop.app` 和带版本号的配套文件暂存 macOS 清单,然后验证完整清单。现有 Windows 和 Linux 测试仍要求文件带版本号,并拒绝错误版本的构件。

## 结果

已签名 macOS 附件工作流可以直接验证 Tauri 生成的 bundle,不需要重命名或重新打包。发布文件仍与经过验证的版本绑定;未预期的无版本文件仍会因为不在目标允许的后缀集合中而被拒绝。

## 考虑过的方案

**在暂存前重命名 `.app` 目录。** 放弃,因为 bundle 名称属于原生应用布局,修改它只会增加发布专用变换而不会改进验证。

**移除所有 macOS 条目的版本检查。** 放弃,因为更新器归档、安装镜像和签名必须与经过验证的发布版本绑定。
