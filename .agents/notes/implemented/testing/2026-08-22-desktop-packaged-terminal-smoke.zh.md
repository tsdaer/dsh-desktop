# Agent Note: Desktop packaged terminal smoke

Status: implemented

[English](2026-08-22-desktop-packaged-terminal-smoke.md) | 中文

## Problem

桌面安装包可以成功启动，但目标运行时仍可能缺少终端功能依赖的原生 PTY 模块，或无法加载该模块。宿主机上的终端测试不会检查 AppImage、deb 或 macOS 应用包中实际暂存的资源。

## Decision

目标原生打包冒烟会从安装包解出或暂存资源,启动已打包的桌面可执行文件,等待就绪 URL,然后从已安装 package 中解析且只允许一个由 Tauri 安装的 Node sidecar 和一个 `lib/bin.js` 运行时。sidecar 使用该运行时的 `node-pty` 模块执行固定标记命令:Windows `cmd.exe` 使用 `echo`,POSIX shell 使用 `printf`。冒烟要求 PTY 输出包含标记,等待探针进程退出,并保留现有桌面进程树清理检查。

AppImage 路径会启动解包根目录的 `AppRun` 入口,保留其 GTK hooks 和 WebKit helper 查找所需的 `$APPDIR/usr` 工作目录。deb 路径会安装构件,以足以容纳烘焙运行时的有界输出配额查询一次 package manager 注册的文件清单,并从该 package 自有清单中解析可执行文件、`/usr/bin` sidecar 与资源运行时。macOS dmg 路径会先复制挂载的应用再启动复制品;直接传入 app 构件时则启动 `Contents/MacOS/dsh-desktop`,不会把 `.app` 目录当成可执行文件。解包资源发现会忽略符号链接;缺少或重复的 sidecar 和运行时都会使冒烟失败。

发布 workflow 会先从 checkout 根目录解析 package 构件,再调用带 filter 的 pnpm 脚本。pnpm 把子进程工作目录切换到 `apps/desktop` 后,绝对参数仍然有效。

这项检查证明目标原生安装包携带了可用的 PTY 字节并能清理。它不声称浏览器会话调用了面向模型的终端工具；GUI 和更新器证据仍属于已安装产品的验收范围。

## Alternatives considered

**使用宿主 Node 执行终端命令。** 放弃，因为宿主可执行文件和原生模块可能不同于安装器携带的字节。

**为冒烟增加专用桌面 RPC 命令。** 放弃，因为测试专用命令会扩展产品协议，也可能与面向模型的终端能力混淆。

**在每个脚本测试中都要求完整 GUI 终端流程。** 放弃，因为 GUI 交互和原生安装包安装需要目标 runner；确定性的资源检查适合本地与结构测试。

## Consequences

Linux AppImage/deb 和 macOS app/dmg 工作流冒烟现在会在打包启动后执行目标 sidecar 和 PTY addon。冒烟不拥有用户数据并会删除临时解包目录；deb 卸载仍会在删除临时 home 之前执行。渲染终端 UI、更新器安装和最低发行版兼容性仍需要目标 runner 证据。

## Testing

`apps/desktop/scripts/packaged-smoke.spec.mjs` 固定目标参数解析、安装包资源的唯一发现、缺少 sidecar 时的拒绝、适合平台 shell 的标记命令、进程树观察、包括 AppImage `AppRun` 在内的 package 入口路径,以及超过 Node 默认同步子进程缓冲区的已捕获 package 文件清单。`scripts/desktop-release-workflow.spec.ts` 要求三项 Linux package 探针都使用 checkout 根目录的绝对构件路径。桌面发布工作流会对 Windows NSIS、Linux AppImage/deb 以及 macOS app/dmg 构件传入 `--terminal-smoke`。
