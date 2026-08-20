# Agent Note: 嵌套 pnpm 调用接受原生入口

Status: implemented

[English](2026-08-21-nested-pnpm-native-entrypoint.md) | 中文

## 问题

仓库中每个重新进入 pnpm 的编排器都读取 `npm_execpath` 并 spawn `node <entrypoint>`:`scripts/run-gates.ts`、`scripts/build.ts`、`scripts/run-web-snapshots.ts`,以及 `scripts/run-coverage-partitions.ts` 背后的覆盖率协调器。这假定 `npm_execpath` 始终指向一个 JavaScript 文件;该假定对 npm 安装的 pnpm 和 `pnpm/action-setup` 成立,但对独立安装版 pnpm 不成立 —— 后者的 `npm_execpath` 是原生可执行文件,例如 `pnpm.exe`。

在独立安装版上,Node 会把可执行文件头当作源码解析,于是每个嵌套命令都在 `MZ` 魔数上立即以 `SyntaxError: Invalid or unexpected token` 失败。`pnpm run doc-sync` 报告 28 个门禁各在一秒内全部失败,`pnpm run build` 在 `build:lib` 阶段失败,而单独调用每个门禁都通过。这种整齐而瞬时的失败看起来像 28 个互不相关的缺陷,而不是一次不受支持的包管理器安装形式。

## 决策

`scripts/package-manager.ts` 以 `packageManagerInvocation(args, context)` 独占这条规则,返回可执行文件及其完整参数列表。JavaScript 入口(`.js`、`.cjs`、`.mjs`)仍交给 Node;其他一律直接 spawn,这正是原生 pnpm 二进制所要求的。两种形式都不经过 shell,因此 [scripts 约定](../../../../scripts/AGENTS.md)在每个宿主上都成立。

四个调用点统一消费该 helper。`CoverageCommand` 新增显式的 `command` 字段,`CoveragePartitionCoordinatorOptions` 把 `pnpmEntrypoint: string` 换成 `packageManager` 调用对象,因为协调器命令不能再假定可执行文件就是 Node。

## 备选方案

- **从 `PATH` spawn `pnpm`。** 已否决,因为这会丢失启动本进程的那个确切包管理器;而且原注释指出的风险是真实的:Windows 上不经 shell 无法直接 spawn `pnpm.cmd` 垫片。
- **按平台判断是否为独立安装版。** 已否决,因为区别在入口文件的形式而非操作系统;Windows 上由 npm 安装的 pnpm 仍需要 Node 加载。
- **读取文件首字节判断 `MZ` 或 shebang。** 已否决,因为扩展名已能回答该问题,而为决定如何 spawn 去读文件会给每次门禁启动引入额外的 I/O 失败面。
- **强制要求 JavaScript 入口并明确失败。** 已否决,因为独立安装是 pnpm 受支持的分发形式;拒绝它等于在一套正常环境上让仓库不可用,而不是修掉一个多余的假定。

## 后果

嵌套编排在 npm 安装、action-setup 和独立安装三种 pnpm 上都可用。后续新增调用点必须走该 helper;直接读取 `npm_execpath` 会为独立安装版重新引入同一缺陷。

此改动不影响 CI 行为 —— 那里的入口始终是 JavaScript 文件,因此该缺陷对平台矩阵不可见,只在开发者机器上显现。

## 验证

`scripts/package-manager.spec.ts` 固定了 JavaScript 形式、原生形式、入口不可用,以及原生入口绝不交给 Node 这四点。在独立安装版 pnpm 上,`pnpm run doc-sync` 现报告 28 passed, 0 failed(此前为 28 failed);`pnpm run typecheck` 与受影响的脚本测试套件均通过。
