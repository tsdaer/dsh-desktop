# Agent Note: 嵌套 pnpm 调用接受原生入口

Status: implemented

[English](2026-08-21-nested-pnpm-native-entrypoint.md) | 中文

## 问题

仓库中重新进入 pnpm 的编排器必须保留启动自身的包管理器分发形式。质量门禁、构建、Web 快照、覆盖率和桌面打包协调器所在的环境中,`npm_execpath` 既可能指向 JavaScript 文件,也可能指向原生可执行文件。假定其中任一种形式都会破坏另一种:npm 安装的 pnpm 与 `pnpm/action-setup` 暴露 JavaScript 入口,而独立安装版 pnpm 暴露 `pnpm.exe` 等原生可执行文件。

在独立安装版上,Node 会把可执行文件头当作源码解析,于是每个嵌套命令都在 `MZ` 魔数上立即以 `SyntaxError: Invalid or unexpected token` 失败。`pnpm run doc-sync` 报告 28 个门禁各在一秒内全部失败,`pnpm run build` 在 `build:lib` 阶段失败,而单独调用每个门禁都通过。这种整齐而瞬时的失败看起来像 28 个互不相关的缺陷,而不是一次不受支持的包管理器安装形式。

## 决策

`scripts/package-manager.ts` 以 `packageManagerInvocation(args, context)` 独占这条规则,返回可执行文件及其完整参数列表。JavaScript 入口(`.js`、`.cjs`、`.mjs`)仍交给 Node;其他一律直接 spawn,这正是原生 pnpm 二进制所要求的。两种形式都不经过 shell,因此 [scripts 约定](../../../../scripts/AGENTS.md)在每个宿主上都成立。

仓库的质量门禁、构建、Web 快照、覆盖率和桌面打包协调器统一消费该 helper。`CoverageCommand` 具有显式的 `command` 字段,`CoveragePartitionCoordinatorOptions` 携带 `packageManager` 调用对象,因为协调器命令不能假定可执行文件就是 Node。由普通 Node 启动的桌面打包脚本导入同一份 TypeScript 源码,绝不从 `PATH` 解析 `pnpm.cmd` 垫片。

## 备选方案

- **从 `PATH` spawn `pnpm`。** 已否决,因为这会丢失启动本进程的那个确切包管理器;而且原注释指出的风险是真实的:Windows 上不经 shell 无法直接 spawn `pnpm.cmd` 垫片。
- **按平台判断是否为独立安装版。** 已否决,因为区别在入口文件的形式而非操作系统;Windows 上由 npm 安装的 pnpm 仍需要 Node 加载。
- **读取文件首字节判断 `MZ` 或 shebang。** 已否决,因为扩展名已能回答该问题,而为决定如何 spawn 去读文件会给每次门禁启动引入额外的 I/O 失败面。
- **强制要求 JavaScript 入口并明确失败。** 已否决,因为独立安装是 pnpm 受支持的分发形式;拒绝它等于在一套正常环境上让仓库不可用,而不是修掉一个多余的假定。

## 后果

嵌套编排在 npm 安装、action-setup 和独立安装三种 pnpm 上都可用。后续新增调用点必须走该 helper;直接读取 `npm_execpath` 会为独立安装版重新引入同一缺陷,而从 `PATH` 解析 `pnpm.cmd` 在 Windows 上无法保持不经过 shell。

CI 的 action-setup 安装会通过 Node 重新进入其 JavaScript 入口。独立安装版会直接 spawn 原生可执行文件。两条路径都不调用平台 shell。

## 验证

`scripts/package-manager.spec.ts` 固定了 JavaScript 形式、原生形式、入口不可用,以及原生入口绝不交给 Node 这四点。在独立安装版 pnpm 上,`pnpm run doc-sync` 现报告 28 passed, 0 failed(此前为 28 failed);`pnpm run typecheck` 与受影响的脚本测试套件均通过。
