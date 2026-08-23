# Agent Note: Desktop bridge builds use pnpm workspace dependencies

Status: implemented

[English](2026-08-23-desktop-bridge-pnpm-workspace-build.md) | 中文

## 问题

桌面 bridge 包声明了 pnpm workspace 依赖,但其嵌套包路径没有作为 workspace 项目安装。bridge 构建曾为 client 包尝试 npm 兜底,而 npm 在 TypeScript 能解析 React 或本地 UI primitives 之前就拒绝了 `workspace:` 协议。

## 决定

`apps/desktop/bridge` 和 `apps/desktop/bridge-client` 现在是 pnpm workspace 成员。bridge host 的本地 dsh 与 Cordis 依赖使用 `workspace:^`,`apps/desktop/scripts/build-bridge.mjs` 只编译已安装的 workspace 包,不再调用第二个包管理器。这些包仍在普通仓库构建 glob 之外,因为桌面流程会在复制或 bake 前显式生成它们的 `lib/` 输出。

## 测试

冻结 pnpm 安装会解析两个 bridge importer 并链接其本地依赖。bridge host 与 client 构建、桌面类型检查、bridge-client 测试类型检查以及六个 bridge-client 测试文件均在 Windows 开发主机通过。

## 结果

发布 runner 使用仓库锁文件和 pnpm workspace 链接编译 bridge,不再遇到 npm registry 兜底或 `workspace:` 协议不匹配。bridge 包仍为 dev profile 和打包运行时生成独立的复制构件,而其源码构建依赖在安装阶段可用。

## 考虑过的方案

**按需用 npm 安装嵌套的 client。** 放弃,因为 npm 无法解析本地 UI primitives 使用的 `workspace:` 依赖,网络兜底也会让源码 checkout 依赖另一种包管理器。

**把本地依赖改为已发布的 semver 范围。** 放弃,因为 bridge 构建必须针对 checkout 中的 dsh 与 vendored Cordis 源码,其中包含旧范围没有发布的版本。

**把 bridge 包加入普通仓库构建 glob。** 放弃,因为桌面打包流程拥有独立的 host/client 构建,并负责把包文件复制进 profile 与运行时资源。
