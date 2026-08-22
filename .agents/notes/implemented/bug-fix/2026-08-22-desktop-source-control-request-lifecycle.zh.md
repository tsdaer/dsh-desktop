# Agent Note: Desktop Source Control request lifecycle

Status: implemented

[English](2026-08-22-desktop-source-control-request-lifecycle.md) | 中文

## 问题

从 Worktree 发起的源控件操作可能在当前 Workspace 已切换后仍在运行。Host 已支持取消，但客户端没有为变更、提交与差异请求传递取消信号，因此旧 Worktree 的响应可能在 Workspace 切换或重连后更新当前视图。

## 决策

Source Control 客户端为每个变更与提交请求维护一个 `AbortController`，并为当前差异请求单独维护一个控制器。Worktree 切换或卸载时会取消所有活动请求并重置操作状态；打开另一份差异会取消上一份差异请求，关闭面板会取消其请求。已取消的请求不会显示错误、清除较新的状态或调用刷新回调。现有 Source Control 刷新控件继续作为 bridge 重连后的重试入口，每次刷新都会创建新的请求控制器。

## 备选方案

**仅依赖 Host 端取消** —— 拒绝：没有取消信号的浏览器 fetch 无法由 Host 取消，因此浏览器仍会保留过期操作，并可能应用延迟响应。

**所有 Source Control 请求共用一个控制器** —— 拒绝：关闭差异不能取消提交或文件变更，独立操作需要独立的生命周期归属。

## 影响

切换 Workspace 或离开 Worktree 会停止过期的 HTTP 与 Host 操作。过期请求的成功响应不能刷新另一个 Workspace，关闭差异会立即释放其 Host 请求。重连仍使用现有重试行为，同时避免旧请求与刷新后的状态请求发生竞态。

## 测试

bridge-client Source Control 测试验证进行中的变更请求会收到取消信号，并在 Worktree 卸载时被取消；现有 Host 取消与固定 argv 测试继续覆盖子进程终止和变更安全性。
