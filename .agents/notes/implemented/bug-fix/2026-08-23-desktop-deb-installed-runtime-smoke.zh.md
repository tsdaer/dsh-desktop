# Agent Note: Desktop deb installed-runtime smoke

Status: implemented

[English](2026-08-23-desktop-deb-installed-runtime-smoke.md) | 中文

## 问题

Linux deb 打包冒烟虽然会安装 package,但它用不一致的路径解析可执行文件和终端探针,因此安装检查可能在启动前失败,探针也可能检查临时解压目录而不是已安装的 runtime。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 在安装前取得 package name,在 `dpkg --install` 之后查询已安装文件清单,并从该状态解析可执行文件、由 Tauri 安装的 sidecar 和 runtime。POSIX 路径解析器作为纯函数导出,因此 Windows 主机上的脚本测试可以固定 Linux package 布局而不调用 dpkg。

因此 deb smoke 会启动 dpkg 注册的可执行文件,并针对已安装资源目录运行可选的 PTY 探针。package removal 仍沿用现有清理路径,用户数据保留仍单独检查。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 覆盖已安装 deb 的 sidecar 与 runtime 路径解析,并拒绝重复的已安装 sidecar。完整的 deb 安装、启动、终端、purge 和用户数据检查仍由目标原生 workflow 提供证据。

## 结果

Linux 安装证据观察 package manager 实际安装的文件,而不是第二份解压副本。package 文件清单错误、已安装 sidecar 缺失或重复、runtime 缺失都会在启动检查前以明确错误失败。此改动不建立最低发行版、更新器或 GUI 证据。

## 相关记录

安装包冒烟范围和剩余平台要求由[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md)定义。更完整的 Linux 安装包检查记录在[桌面 Linux 安装包启动冒烟](../feature/2026-08-22-desktop-linux-packaged-smoke.md)中。

## 考虑过的方案

**继续使用临时的 `dpkg-deb --extract` 目录运行终端探针。** 放弃,因为该目录无法证明安装操作把 sidecar 和 runtime 放到了已安装可执行文件使用的路径。

**从固定的 `/usr/bin` 与 `/usr/lib` 前缀推导 sidecar 和 runtime 路径。** 放弃,因为 package 文件清单是 package manager 记录已安装路径的权威来源,布局变化时也能直接失败。
