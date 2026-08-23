# Agent Note: Desktop Windows installed-package smoke

Status: implemented

[English](2026-08-22-desktop-windows-packaged-smoke.md) | 中文

## 问题

Windows 发布检查会验证 NSIS 构件清单,但不会在启动壳子前安装生成的安装包。因此打包改动可能通过构件检查,却破坏安装、资源查找、运行时清理或卸载钩子。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 通过 `--install-nsis` 接受 Windows x64 NSIS 构件。冒烟检查把构件安装到一次性目录,启动已安装的 `dsh-desktop.exe`,等待打包应用的就绪 URL,按需通过 `cmd.exe` 与 `echo` 运行已安装 sidecar 的 PTY 探针,必要时以有界的强制升级终止受管理进程树,使用 `_?=<install-directory>` 同步运行 NSIS 卸载程序,并确认临时 `DSH_HOME` 标记仍然存在。Windows 进程快照使用 PowerShell 的 `Win32_Process` 记录,因此重新归属的 sidecar 仍可按已安装的精确路径观察;POSIX 目标保留 `ps` 快照路径。

Windows 发布 job 会在体积和构件检查后、上传前运行这项冒烟。它不替代多平台计划要求的跨平台更新、GUI 或受支持发布证据。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 固定 Windows 安装器参数校验、已安装可执行文件解析、`cmd.exe` 标记命令、已安装 sidecar 精确匹配、强制升级和同步卸载参数。桌面发布 workflow 结构测试要求 Windows job 调用 `--install-nsis` 和 `--terminal-smoke`。原生执行仍是 Windows runner 检查,因为 NSIS、PowerShell 进程检查和已安装 Tauri 壳子无法在当前 Linux/macOS 路径中复现。

## 结果

每个 Windows draft 构件在发布暂存前都会经过安装和卸载。相同冒烟现在覆盖三个声明桌面目标的安装器文件放置和目标原生运行时探针。冒烟成功仍不能证明已安装版本 N 到 N+1 的更新转换或用户可见 GUI 流程。

## 考虑过的方案

**从 bundle 输出目录启动可执行文件。** 放弃,因为这会绕过 NSIS 文件放置、卸载注册和安装器钩子。

**不安装而只检查 NSIS 压缩包。** 放弃,因为压缩包内容不能证明已安装可执行文件能查找资源,也不能证明卸载会保留用户数据。

**使用宿主 Node 运行 Windows 终端探针。** 放弃,因为探针必须加载已安装包中随附的 sidecar 和原生 `node-pty` 字节。
