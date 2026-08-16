# Agent Note: Build the desktop bridge packages before every pack/bake

Status: implemented

[English](2026-08-16-desktop-bridge-build-pipeline.md) | 中文

## 问题

dsh-desktop 桥接包(apps/desktop/bridge 与 apps/desktop/bridge-client)不是 pnpm workspace 成员,`pnpm run build` 永远不会重建它们的 `lib/` 产物。dev 启动器(npm pack)与运行时烤制(bake-runtime.mjs)消费 `lib/` 的现状 —— 而 bakePackage 对缺失的 files 条目静默跳过。因此桥接源码改动只有开发者手动跑 tsc + tsdown 才能进入安装包;lib 被清掉后烤出的桥接包连 lib 都没有(插件完全失效:没有余额路由、没有拖放处理)且不报错。余额功能正是这样丢的:用户安装的安装包烤自功能之前的旧桥接 lib,药丸轮询的路由 404 后按设计隐藏;而 ensure_bridge 的一次性 marker 复制让旧桥接跨版本残留。

## 决策

- `apps/desktop/scripts/build-bridge.mjs` 从源码构建两个桥接包(各自 `tsc -p tsconfig.json` 再 `tsdown`)。桌面 npm 脚本 `dev`、`build`、`bake`、`bundle` 都先跑它,每次 pack 与每次烤制都从当前源码出发。全新 checkout 没有这些独立包的 node_modules;脚本在缺失时先用 npm 安装 client 半边的声明 dev 依赖(react 与 @types/react),因为它的 tsc 从 node_modules 解析 react(host 半边全部经 tsconfig paths 解析)。
- `bake-runtime.mjs` 在烤制轮次之后,若 deploy 树里缺少 `@deepseek-ai/dsh-desktop-bridge/lib/index.js` 或 `@deepseek-ai/dsh-desktop-bridge-client/lib/index.js` 就直接报错,而不是静默产出无法加载的桥接。
- main.rs 的 `ensure_bridge` 在打包模式(`bridge_copy` 非空)下每次启动都把 profile 里的桥接包与运行时重新对齐,取代一次性 marker 复制。重建的桥接会自动替换过期的 profile 副本;dev 模式(npm tarball)仍只装一次,刷新交给开发者。

## 考虑的备选方案

**把桥接包纳入 pnpm workspace** —— 否决。它们是刻意独立的、可 npm pack 的包(在没有包管理器的环境里被烤制并拷进 profile);纳入 workspace 会改变 deploy 闭包与 profiles 模块回退,收益很小。

**按版本/哈希比较 profile 副本是否过期** —— 否决。桥接 lib 是构建产物,内容变了版本号不变;版本比较检测不到,而包很小,打包模式下无条件刷新更简单且几乎免费。

**保留一次性 profile 复制** —— 否决。这正是旧桥接跨版本残留的机制;marker 检查让 profile 的桥接在首次安装后不可变。

## 后果

桥接源码改动现在确定性地进入 dev 运行与安装包:每条桌面流程先构建包,烤制遇到缺失 lib 会拒绝而不是静默产出死桥接。打包模式每次启动拷三个小包进 profile(可忽略的 I/O)。dev 安装仍是一次性;开发者改桥接源码后需重建(dev 脚本已自动做),对已存在的 profile 安装需删除桥接 marker 才会触发新的 npm 安装。

## 验证

`node apps/desktop/scripts/build-bridge.mjs` 重建两个包(host lib 带余额路由);烤制的缺失-lib 检查是烤制轮次后新增的失败路径;`cargo check` 通过 ensure_bridge 锁步改动;profile 重新对齐用"把重建 lib 拷进既有 profile 并确认 `/dsh-bridge/balance` 有响应"验证。
