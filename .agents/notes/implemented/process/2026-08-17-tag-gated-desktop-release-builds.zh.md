# Agent Note: 标签门控的桌面 Release 构建

Status: implemented

[English](2026-08-17-tag-gated-desktop-release-builds.md) | 中文

## 问题

桌面 Release 工作流会构建完整 workspace、烤制生产运行时、下载 Node sidecar、创建 NSIS 安装程序并检查负载体积。每次分支推送都运行这套流程，会在普通开发工作中占用 Windows runner 并产生 Actions 产物。从任意分支手动重建还可能用并非来自版本标签所指提交的内容替换草稿 Release 资产。

## 决策

桌面 Release 工作流只由推送的 `v*` 标签或 `workflow_dispatch` 启动。两条入口都要求所选 ref 是标签，且名称等于 `v<apps/desktop/package.json version>`。轻量 Windows 验证作业会在安装程序构建获得 runner 前检查 package.json、Cargo.toml 与 tauri.conf.json 版本一致、所选标签与该版本一致，并且 CHANGELOG.zh.md 包含对应章节。

构建作业与草稿 Release 作业依赖验证结果，并消费它输出的版本与标签。因此，手动重建必须选择现有 Release 标签；它不能构建分支并覆盖附属于另一提交的资产。工作流会创建缺失的草稿、刷新已有草稿，并保持已发布 Release 不变。普通分支推送不会创建桌面 Release 工作流运行。

仓库测试会解析工作流，并固定事件过滤、验证顺序、Windows PowerShell 执行、版本来源、Changelog 检查及下游对已验证输出的使用。

## 备选方案

**保留每次推送，并通过作业条件跳过构建。** 这能避免安装程序工作，但每次推送仍会创建跳过的工作流运行，而且昂贵路径可能因未来的条件漂移重新变得可达。

**使用提交消息标记。** 标记容易遗漏、在 rebase 中重复或藏在合并提交里，也不能标识不可变的 Release 源。

**对 package.json 或 Changelog 使用路径过滤。** 版本提升可能发生在发布加固之前，而最终发布提交也可能不修改这两个路径。路径过滤编码的是编辑习惯，而不是发布意图。

**允许从分支手动运行。** 这样重建更方便，却会让草稿资产偏离用户检查并最终安装的标签。手动派发时选择标签可以保持源码身份一致。

## 结果

开发推送不再为桌面安装程序消耗 Windows runner 时间。Release 操作者必须创建并推送精确版本标签，例如先执行 `git tag v0.3.0`，再执行 `git push origin v0.3.0`；也可以在手动派发工作流时选择该标签。由于标签是构建来源，打标签后的修正需要有意移动尚未发布的标签或提升版本；已发布标签保持不可变。标签/版本漂移与 Changelog 章节缺失会在昂贵构建前失败。
