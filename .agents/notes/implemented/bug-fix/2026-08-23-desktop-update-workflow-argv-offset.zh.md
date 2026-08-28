# Agent Note: Desktop update workflow 版本参数偏移

Status: implemented

[English](2026-08-23-desktop-update-workflow-argv-offset.md) | 中文

## Problem

Linux、macOS 和 Windows 的已安装更新 workflow 通过向 `node -` 管道输入 JavaScript 来比较两个版本。stdin 标记占用 `process.argv[1]`,因此从索引 1 读取会把 `-` 当成基础版本,并使真正的下一版本落在错误位置。

## Decision

三个桌面已安装更新 workflow 都从 `process.argv.slice(2)` 读取两个版本参数,其结构测试也固定该偏移。版本不递增时会在任一更新构建开始前失败,有效版本对才会进入目标原生 smoke。

## Alternatives considered

**保留 `slice(1)` 的共享片段。** 不采用,因为这种调用模式中的 Node stdin 标记是一个参数,会使每次比较都失效。

**改为传入 JavaScript 文件而不是 stdin。** 不采用,因为 workflow 只需要短小的校验表达式,保留内联检查可以避免再维护一个仓库 helper。

## Consequences

三个目标原生更新 workflow 在构建构件前使用同一版本排序规则。它们的测试现在会阻止错误恢复到 Node stdin 参数偏移。workflow 仍是手动运行、依赖凭据的证据任务,不会发布 Release。

## Testing

Linux、macOS 和 Windows workflow spec 都要求 `process.argv.slice(2)`。既有桌面脚本测试以及各 workflow 的其余结构断言继续覆盖被调用的更新协调器和目标专属配置。
