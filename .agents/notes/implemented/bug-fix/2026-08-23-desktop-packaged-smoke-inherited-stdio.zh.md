# Agent Note: Desktop packaged smoke supports inherited stdio

Status: implemented

[English](2026-08-23-desktop-packaged-smoke-inherited-stdio.md) | 中文

## 问题

安装包冒烟会用继承的 stdio 运行安装器和卸载器,因此 `spawnSync` 对捕获输出返回 `null`。辅助函数把该值当成字符串处理,成功完成 NSIS 安装后仍会在检查打包应用前失败。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 把缺少的捕获 stdout 当作空字符串处理,同时保留命令失败和不经过 shell 的参数传递。辅助函数被导出,因此脚本测试可以覆盖安装器命令使用的相同继承 stdio 路径。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 以 `stdio: 'inherit'` 运行子进程,并验证命令成功时返回空捕获结果。Windows packaged smoke 也针对保留的本地 NSIS 构件执行;修复前该路径会复现 null stdout 错误。

## 结果

安装器和卸载器命令可以继承 runner 控制台,冒烟不再依赖捕获输出。命令失败时仍会报告退出状态和可用诊断,安装器参数也不会经过 shell。

## 相关记录

安装包 workflow 及其剩余目标原生证据记录在[桌面 Windows 安装包启动冒烟](../testing/2026-08-22-desktop-windows-packaged-smoke.md)和[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md)中。

## 考虑过的方案

**每次调用都捕获安装器输出。** 放弃,因为 NSIS 和 package manager 命令有意使用继承的 stdio,成功退出后冒烟并不需要再读取它们的输出。

**抑制安装器输出并返回伪造字符串。** 放弃,因为继承 stdio 能保留目标 runner 的诊断;辅助函数只规范化没有捕获输出这一事实。
