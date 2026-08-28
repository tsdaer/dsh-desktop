# Agent Note: Desktop target-native runtime validation

Status: implemented

[English](2026-08-22-desktop-target-native-runtime.md) | 中文

## 问题

按目标划分的运行时目录即使选择正确,其中的原生依赖仍可能带有其他平台的预编译产物,或者缺少所选目标可加载的二进制文件。使用目标 sidecar 启动是必要校验,但不能在生成安装包前识别原生文件清单错误。

## 决定

`apps/desktop/scripts/runtime-native.mjs` 负责原生运行时裁剪与校验。烘焙流程遍历每个 `prebuilds` 目录,有目标行的 `nativePlatformKey` 原生文件时予以保留,否则接受该目录旁边从源码构建的原生文件,并在检查生成的运行时前删除其他子目录。存在 `node-pty` 时,其包必须包含可加载的原生文件。Koffi 可以直接包含该文件,也可以把它放在目标专属的 `@koromix/koffi-<nativePlatformKey>` 可选包中;其他目标的可选包不能满足校验。目标专属 Koffi 包只保留从 `nativePlatformKey` 派生的下划线形式 ABI 目录;这样会在 linuxdeploy 扫描 ELF 依赖前,从 `linux-x64` glibc 运行时删除相邻的 `musl_x64`。校验会拒绝任何残留的外部 Koffi ABI 目录。所有随包提供的 `.node`、`.dll`、`.dylib`、`.so` 或 `.exe` 都会检查是否带有受支持的其他平台路径标识,以及其扩展名是否不可能在所选操作系统上运行。

校验在目标专属裁剪之后、sidecar 启动冒烟之前执行。对于 `koffi.node` 这类不含平台信息的通用原生文件,校验器不会仅凭文件名推断兼容性;目标 runner 使用 sidecar 的启动冒烟仍是证明这些字节能在目标操作系统加载的依据。

## 测试

`apps/desktop/scripts/runtime-native.spec.mjs` 覆盖多包裁剪、缺少目标预编译目录、源码构建、Koffi 的目标专属可选包布局和跨平台原生文件。桌面打包会在获取并启动目标 sidecar 之前,一起运行目标、sidecar 与原生运行时脚本测试。

## 结果

原生文件清单不完整或含有可识别的其他平台文件时,运行时会在 sidecar 启动之前烘焙失败。没有平台信息的通用原生文件仍要求目标 runner 启动证据,因此该检查缩小了失败范围,但不会把 Windows 主机检查误作跨平台支持证据。

## 相关记录

目标行由[桌面目标规格](2026-08-22-desktop-target-specification.zh.md)定义,sidecar 获取由[可移植 Node sidecar](2026-08-22-desktop-portable-node-sidecar.zh.md)定义,壳子启动接线由[跨平台壳子运行时](2026-08-22-desktop-cross-platform-shell-runtime.zh.md)定义。

## 考虑过的方案

**只校验 `node-pty`。** 放弃,因为其他包也可能提供预编译目录或原生 helper,继续会绕过目标检查。

**把所有 `.node` 文件都视为可移植。** 放弃,因为 Windows 烘焙成功后仍可能把 POSIX addon 带入后续目标目录;没有平台信息的通用文件只有在目标 runner 启动时才能证明可用。

**从 Windows 对所有目标做编译检查。** 放弃,因为原生 addon 加载以及 WebKit/Tauri 链接需要目标操作系统;跨目标源码检查不能证明打包运行时可用。
