# Agent Note: Desktop macOS packaged startup smoke

Status: implemented

[English](2026-08-22-desktop-macos-packaged-smoke.md) | 中文

## 问题

未签名或已签名的 macOS bundle 即使通过 Tauri 构建和代码签名检查,其 app bundle 资源查找、目标 sidecar 或受管理运行时仍可能在启动时失败。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 除 Linux x64 安装包路径外,也接受 macOS arm64 app 和 dmg 构件。app 构件直接启动其中的 `Contents/MacOS/dsh-desktop` 可执行文件。dmg 构件通过 `hdiutil` 只读挂载,使用原生 `ditto --noqtn` 安装到 smoke home 后卸载,再从安装后的 app bundle 启动。`ditto` 会保留 bundle 元数据和 resource fork;CI 安装会省略 quarantine 元数据,因为 quarantine 属于下载的磁盘映像。两条路径都使用临时 `DSH_HOME`,要求打包应用输出就绪 URL,终止 detached 进程组,并确认记录到的运行时子进程退出。

未签名的 macOS 实验性 job 和选择加入的已签名 macOS job 都会在 bundle 生成后于原生 runner 上运行 app bundle 冒烟。该冒烟只证明打包启动;在签名、更新、卸载和 GUI 证据完成前,它不会让未签名构件可发布,也不会建立 macOS 支持。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 覆盖 macOS 参数校验、app bundle 可执行文件解析、dmg 挂载与原生安装参数和既有 Linux 路径。目标原生 macOS job 会针对生成的 app bundle 调用同一脚本。

## 结果

macOS 打包 job 现在会在上传构件前实际运行 app 布局和由 Tauri 安装的运行时。dmg 校验会使用平台原生安装复制,而不是从挂载卷启动,因此在卸载卷后检查 bundle 元数据、资源查找和进程清理。该冒烟依赖 macOS 工具,无法在 Windows 主机上复现。

## 考虑过的方案

**运行 `cargo run` 或源码 CLI。** 放弃,因为这些路径绕过 app bundle、打包资源、sidecar 文件名和 Tauri 启动生命周期。

**使用 `open` 启动 app,只检查退出状态。** 放弃,因为 `open` 会与 app 进程脱离,隐藏冒烟所需的就绪行和受管理子进程树。

**把代码签名校验成功当作启动证据。** 放弃,因为签名证明代码身份和结构,不证明资源查找或运行时启动。
