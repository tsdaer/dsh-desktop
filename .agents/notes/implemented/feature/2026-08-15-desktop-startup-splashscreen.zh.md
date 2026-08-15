# Agent Note: dsh-desktop 启动界面

Status: implemented

[English](2026-08-15-desktop-startup-splashscreen.md) | 中文

## 问题

壳子会直接进入 dsh web profile,所以运行时损坏、WebView2 缺失或未配置 API key 时,只会表现为死页面或一行光秃秃的报错。启动前没有环境检测、没有解释、也无法重试。

## 决策

应用先打开一个无边框的 `splashscreen` 窗口,并让 `main` 窗口保持隐藏,直到运行时打印出 `dsh web:` 就绪行。`apps/desktop/src/splashscreen.html` 渲染一张由轮询状态板驱动的清单:`run_checks` 把每一步(`webview2`、`node`、`runtime`、`home`、`api-key`、`bridge`、`boot`)记入受管理的 `SplashBoard`,页面每 250 ms 轮询 `splash_status` 命令,致命条目让 splash 停留并给出重试按钮。

splash 通过底层 IPC 桥与 Rust 对话,而不是 `withGlobalTauri` 高层 API:`window.__TAURI_INTERNALS__.invoke` 会被无条件注入每个 webview,而 `window.__TAURI__` 只有在安装了 `@tauri-apps/api` 时才存在,且顶层脚本执行时可能尚未定义。重试按钮和 WebView2 链接都通过这座桥调用 `splash_start` / `splash_open_webview2_download`。`@tauri-apps/api` 仍是 devDependency,好让注入的标题栏里 `window.__TAURI__.window` 的窗口控制能够解析。

`splash_start` 的首次命令往返时,`get_webview_window("main")` 可能返回 `None`(main webview 的注册晚于 splash 页面加载),因此 `splash_start` 在跑检查前会在一个线程里重试查找。

WebView2 的获取是安装期的事,不是 splash 的事:`bundle.windows.webviewInstallMode` 为 `embedBootstrapper`,NSIS 安装器内嵌引导器并以原生进度下载/安装运行时。splash 无法安装缺失的 WebView2(它本身就是一个 WebView2 页面);它的「下载 / 修复 WebView2」链接通过 `tauri-plugin-opener` 打开微软下载页。

## 后果

坏环境现在会停在一张可读的清单上,有分步状态和重试,而不是死页面。splash 的 IPC 只依赖 `__TAURI_INTERNALS__`,所以无论 `withGlobalTauri` 是否注入高层 API 都能工作。已接受的代价:轮询取代了推送事件(在一个极小的本地命令上以 250 ms 节奏执行),主窗口查找最多重试 6 秒才报失败。

## 备选方案

- **`withGlobalTauri` 事件(`window.__TAURI__.event.listen` + `core.invoke`)** —— 没有 `@tauri-apps/api` 就不会注入高层 API,即使有,顶层脚本的时序也很脆弱;弃用,改选始终注入的桥加轮询。
- **Rust 用 `window.eval` 推送状态** —— 不需要任何 JS→Rust 通道,但渐进式清单仍需页面先发信号表示就绪;轮询状态板完全省掉了那次握手。
