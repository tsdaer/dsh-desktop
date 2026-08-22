# Agent Note: Desktop Linux baseline preflight

Status: implemented

[English](2026-08-22-desktop-linux-baseline-preflight.md) | 中文

## Problem

Linux 发布 lane 会安装 GTK/WebKitGTK 和打包工具,但日志没有记录目标原生构建和打包 smoke 实际使用的版本。因此,某个 runner 上构建成功并不能说明构件代表了什么运行时基线。

## Decision

`apps/desktop/scripts/linux-baseline.mjs` 在安装前置依赖后于 Linux x64 发布 runner 上运行。它记录 glibc 版本、`glib-2.0`、`gtk+-3.0` 和 `webkit2gtk-4.1` 的 pkg-config 版本,以及 `pkg-config`、`dpkg-deb`、`patchelf` 和 `xvfb-run` 是否可用。它只接受明确的 Linux x64 目标,遇到其他主机、无法解析的 glibc banner、缺少库或缺少工具时快速失败。结果以一行 JSON 输出,所以 workflow 日志可以与构建证据一起保存。

该检查记录 runner 实际使用的环境,不宣称兼容更旧的发行版。Linux 被列为受支持目标前,仍需在目标原生的最低基线 runner 上完成 smoke。

## Testing

注入命令的测试覆盖 Ubuntu 和 GNU libc 版本 banner、所有必需的库和工具字段、非 Linux 主机拒绝以及缺少前置条件时的失败。bundle 测试集会运行这个脚本测试,CI workflow 规格测试要求 Linux 发布 job 在安装依赖后调用该 preflight。

## Consequences

Linux 发布日志现在包含每次构建对应的原生库确切版本。未来的基线 runner 可以复用同一检查并比较记录结果,无需改变 bundle 路径。当前 workflow 本身仍不能证明低于其 runner 镜像的发行版兼容性。

## Alternatives considered

**只依赖 runner 标签。** 放弃,因为标签只标识镜像系列,不标识构建期间解析到的具体包版本。

**在 preflight 中声明硬编码的最低版本。** 放弃,因为当前计划还没有选定最低 Linux 发行版;让更新或打过补丁的 runner 因一个臆造的阈值失败,会制造错误的支持策略。
