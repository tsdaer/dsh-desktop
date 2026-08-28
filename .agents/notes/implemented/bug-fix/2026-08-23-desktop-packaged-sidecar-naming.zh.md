# Agent Note: Desktop packaged sidecar naming

Status: implemented

[English](2026-08-23-desktop-packaged-sidecar-naming.md) | 中文

## 问题

Tauri 外部二进制的源文件必须使用 `dsh-node-x86_64-pc-windows-msvc.exe` 等带目标后缀的名称,但 Tauri 把二进制复制进应用时会移除该后缀。桌面壳和安装包冒烟使用源文件名发现已安装资源,因此安装器可以成功生成,打包启动却会因为请求的 Node 路径不存在而一直停留在启动界面。

## 决定

Tauri 外部二进制使用产品自有的基础名称 `dsh-node`,因此 Linux deb 不会占用系统的 `/usr/bin/node` 路径。桌面目标规格保留 `sidecarBasename` 作为带目标后缀的源码暂存名称,并增加 `packagedSidecarBasename` 表示安装包中的名称。Windows 安装包包含 `dsh-node.exe`,Linux 与 macOS 安装包包含 `dsh-node`。sidecar 获取与运行时烘焙使用源文件名;Rust 壳、安装包资源发现、deb 文件清单检查、终端探针和进程清理使用安装后名称或解析出的安装路径。

进程清理会匹配解析出的 sidecar 精确路径,不会匹配每个名称相似的进程。安装包冒烟会在启动壳子前校验安装包中恰好存在一个已安装 sidecar 和一个运行时。

## 测试

目标规格测试固定三个目标的两种名称。Rust 测试固定各平台安装后的文件名。安装包冒烟测试会发现安装后文件名,拒绝缺失或重复的 sidecar,并把被重新托管的安装包 sidecar 与无关或只有相似前缀的 Node 命令区分开。

## 结果

源码暂存继续满足 Tauri 按目标三元组查找文件的要求,安装版启动则遵循 Tauri 实际生成的文件布局。今后每个目标行都必须显式定义两种名称;已安装进程跟踪继续使用解析出的路径,把安装包进程与名称相似的命令区分开。

## 相关记录

壳子的自包含运行时要求仍由[桌面跨平台壳运行时接线](../feature/2026-08-22-desktop-cross-platform-shell-runtime.zh.md)定义。目标行的所有权仍由[桌面目标规格](../feature/2026-08-22-desktop-target-specification.zh.md)定义。

## 考虑过的方案

**在安装包内保留带目标后缀的文件名。** 不采用,因为 Tauri 的外部二进制打包会移除目标后缀;保留后缀需要改用另一种资源机制并重复实现启动处理。

**使用 `node` 作为外部二进制基础名称。** 不采用,因为 Linux deb 会把它安装到壳子旁的 `/usr/bin/node`,与操作系统的 Node 包冲突。

**清理时匹配每个名称相似的进程。** 不采用,因为发布 runner 会执行无关进程,安装包冒烟不能终止这些进程。

**回退到环境 Node。** 不采用,因为安装包必须保持自包含,并使用针对该目标完成烘焙和校验的版本。
