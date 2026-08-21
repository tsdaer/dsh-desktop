# Agent Note: 桌面端原生窗口装饰

状态: implemented

[English](2026-08-22-desktop-native-window-chrome.md) | 中文

## 问题

无边框主窗口有三处用户可见缺口:没有 Windows 11 贴靠布局弹出层,缩放边框沿用 tao 的默认命中测试(tao 对无装饰窗口移除 `WS_CAPTION | WS_THICKFRAME`),最大化图标依赖点击与缩放事件而非窗口状态同步。

## 决策

壳子在 setup 时恢复主窗口的粗边框:`apply_windows_chrome` 通过 `SetWindowLongPtrW` 重新加回 `WS_THICKFRAME | WS_MAXIMIZEBOX`(不加 `WS_CAPTION`),并用 `SetWindowPos(SWP_FRAMECHANGED)` 刷新边框。操作系统随即提供原生缩放边框与贴靠布局弹出层,自绘标题栏保持不变。失败时保持 tao 默认行为而非 panic。

最大化状态由原生宿主推送:`on_window_event` 监听 `WindowEvent::Resized`,查询 `is_maximized()`,并通过 `dsh://maximize-change` 推送权威布尔值。标题栏监听该事件(经 `window.__TAURI__.event`),并保留轮询 `isMaximized()` 作为无事件宿主的回退。

## 备选方案

**拦截 `WM_NCHITTEST` 做自定义缩放命中测试** —— 拒绝:重新加回粗边框即可让操作系统提供相同行为,代码更少,也无需按像素持有命中测试。

**最大化图标完全由点击处理器渲染** —— 拒绝:计划要求窗口状态而非输入推断;贴靠布局与系统快捷键改变状态时并没有点击注入按钮。

## 影响

装饰修复仅限 Windows,打包构建验证仍需一台装有已构建安装包的机器(本地 `tauri build` 需要签名密钥;运行中的安装共享单实例标识)。`cargo check` 与 debug 构建编译该变更。

## 测试

`cargo check` 通过壳子变更;标题栏事件监听沿用既有 `dsh://open-path` 模式。打包冒烟验证推迟到可安装发布构建的机器上。
