# Agent Note: Desktop repeatable evidence server

Status: implemented

[English](2026-08-21-desktop-evidence-server.md) | 中文

## Problem

桌面 GUI 证据需要一个挂载桌面桥接、注册 Workspace 且使用一次性 home 的活跃 web profile。手工搭建这套组合会让录制变慢，也容易误判当前运行时拓扑。

## Decision

`pnpm --filter @deepseek-ai/dsh-desktop evidence` 会运行 `scripts/build-bridge.mjs`，创建临时 `DSH_HOME`，再用 `--dump-default-config` 启动一次构建出的 CLI 以初始化 web profile 文件。它允许后续的 `dsh web` 启动创建缺失的 `profiles/node_modules` 回退，把构建出的 `dsh-desktop-bridge` 和 `dsh-desktop-bridge-client` 包拷贝到 `profiles/node_modules/@deepseek-ai/`，保留已有的 `schemastery` 回退链接，并以幂等方式把桥接 patch 合并到 `profiles/web/cordis.patch.yml`。

随后命令以 4173 端口启动 `dsh web`，通过 `workspace.create` 为选定目录注册 Workspace，探测 `/dsh-bridge/config`，并打印服务 URL 和探针 URL。`-- --port <port> --workspace <directory>` 可更改固定端口或选定的 Workspace；按 Ctrl+C 会停止子进程并删除临时 home，除非传入 `--keep-home`。

运行环境约束文档通过测量桌面可执行文件路径和派生 Node 命令行来区分源码与打包进程拓扑，不再假定活跃 GUI 一定从仓库检出运行。

## Alternatives considered

**复用正在运行的桌面应用 home** —— 不采用：证据会依赖用户状态，可能修改真实 Workspace 注册表，并可能让被测会话处于构建工作区内。

**随桥接包安装 `schemastery`** —— 不采用：profile 回退拥有该包的安装符号链接，把它替换成真实目录会破坏模块解析不变量。

**直接编辑存储文件注册 Workspace** —— 不采用：证据环境必须走与浏览器相同的 RPC 和持久注册路径，因此注册通过 `workspace.create` 完成。

## Consequences

证据服务器要求 CLI 与桥接产物已构建；其 package script 会先构建桥接包，但仓库和 web 前端仍需满足常规构建前置条件。已有的 installation-owned `schemastery` 回退条目必须是符号链接；缺失条目会由 web profile 启动创建。服务器默认使用固定端口并持续运行到中断，使浏览器录制可重复，但退出时需要清理。`--keep-home` 会保留诊断状态供检查，仅用于本地排障。

## Testing

`scripts/evidence-server.spec.mjs` 覆盖选项解析、默认选择、patch 合并、幂等安装文本和回退条目校验。活跃运行还会检查 profile 初始化、保留或新建的 `schemastery` 回退条目、桥接配置响应，以及通过构建出的 web profile 完成 Workspace 注册。
