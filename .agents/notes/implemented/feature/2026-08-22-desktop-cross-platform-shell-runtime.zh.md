# Agent Note: Desktop cross-platform shell runtime wiring

Status: implemented

[English](2026-08-22-desktop-cross-platform-shell-runtime.md) | 中文

## Problem

桌面壳的安装版运行时通过查找 `node.exe` 解析，并且在打包资源缺失时可能回退到环境中的 Node。WebView2 controller 调用和修复界面也按所有平台都提供相同 webview API 的方式编译和描述。

## Decision

安装版启动使用产品自有的 Tauri 外部二进制名称:Windows 为 `dsh-node.exe`,POSIX 为 `dsh-node`。带目标后缀的名称只属于源码暂存,Tauri 把外部二进制复制进应用时会移除该后缀。发布启动把已安装 sidecar 与运行时路径作为文件检查,绝不回退到 PATH 中的 Node;开发模式保留 `DSH_CLI`／`DSH_NODE` 环境接线。

WebView2 controller 访问只在 Windows 编译。其他目标保留页面级调试守卫，并返回 `applied: false` 与明确的平台限制，因为运行时 developer tools 控制属于平台 webview。WebView2 修复命令只作为 Windows 操作提供，其他平台明确返回不支持错误。启动状态使用平台中立的 `webview` id。Windows Explorer 注册和原生窗口 chrome 仍由 cfg 限定为 Windows 集成。

运行时烘焙使用目标 sidecar 执行 profile 初始化与 readiness 校验，终止生成的进程树，并在未获取 sidecar 时于启动校验前失败。bundle 命令先获取 sidecar 再烘焙，从而对每个目标都保持该不变量。

## Testing

在临时移除不可用打包资源的构建配置下,Rust 源码通过宿主编译,且 `cargo fmt -- --check` 通过。Rust 测试固定各平台安装后的 sidecar 文件名;脚本语法与目标 sidecar 测试通过。原生 Linux／macOS 链接、打包安装和目标 runner 启动证据仍是待完成工作包要求。

## 相关记录

目标原生文件裁剪与校验由[桌面目标原生运行时](2026-08-22-desktop-target-native-runtime.zh.md)记录定义。源码 sidecar 名与安装后名称的更正由[桌面打包 sidecar 命名](../bug-fix/2026-08-23-desktop-packaged-sidecar-naming.zh.md)记录。

## Alternatives considered

**已安装 sidecar 缺失时使用环境 Node。** 不采用,因为发布启动必须自包含并固定版本。

**在所有目标编译 WebView2 调用。** 不采用，因为 controller API 是 Windows 专属；非 Windows 状态现在明确说明平台限制，不再宣称具有运行时控制能力。

**让运行时烘焙使用宿主 `node`。** 不采用，因为宿主启动成功不能证明安装版目标 sidecar 能执行烘焙出的运行时。

## Consequences

开发和发布启动具有不同的运行时约定：开发可使用 PATH 上的 Node，安装版启动必须使用目标自有文件。Windows 启动画面的修复入口以及 Explorer／窗口 chrome 集成保持 Windows 专属；Linux 与 macOS 在声明发布支持前仍需完成原生打包与 GUI 证据。
