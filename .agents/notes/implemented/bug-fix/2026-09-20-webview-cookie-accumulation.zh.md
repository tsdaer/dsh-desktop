# Agent Note: 浏览器会话 Cookie 按 host 共享一个槽位

Status: implemented

[English](2026-09-20-webview-cookie-accumulation.md) | 中文

## 问题

`BrowserAuth.cookieName` 把完整请求 authority（hostname 加端口）哈希进持久浏览器会话 Cookie 的名称。浏览器按 host 存储 Cookie，无法按端口区分，而桌面 shell 以 `--port 0` 启动 web 运行时，于是每次应用启动都用一个新名称铸造 Cookie，此前所有 Cookie 在配置的生命周期内（默认 30 天）一直留在存储中。一个启动过 64 次应用的 WebView2 profile 携带 14,530 字节的 `Cookie` 请求头。浏览器引导阶段把全部 web 插件作为一个组合脚本拉取，其 URL 在查询串中列出所有模块路径（59 个插件约 3 KB）；请求行加累积 Cookie 超出 node:http 默认的 16 KB 请求头上限，服务器对 `/plugins/` 组合返回 HTTP 431，页面在 "web boot: 59 entries did not activate" 之下把每个条目报为 "import failed"。全新的浏览器 profile 不复现故障，导致定位困难。

## 决策

确定性 Cookie 名称只哈希 hostname，同 host 的相邻端口共享一个存储槽位，每次铸造覆盖上一条。签名 payload 仍绑定 hostname 加端口，验证逻辑不变：一个 Cookie 永远不会授权另一个端口或 host。token 交换还会使请求携带的其他 `dsh-auth-*` Cookie 全部过期，升级后的应用第一次完成登录时即清除早期按端口命名留下的条目。

## 备选方案

- **提高 webserver 的请求头上限。** 作为唯一措施被否决：存储仍在无界增长，足够多的启动后故障重现。
- **由桌面 shell 清理 WebView2 Cookie。** 被否决：Tauri 2 未暴露 WebView2 的 Cookie 管理器，且运行 `dsh web` 的浏览器同样累积。
- **让桌面运行时使用固定端口。** 被否决：用端口冲突换取隔离，也无法清除已累积的 Cookie。

## 后果

每个 host 一个存储槽位把 `Cookie` 请求头限制在单条会话。同 host 不同端口的并发会话相互顶替：Cookie 被替换的标签页需要重新打开其 `dsh web` 进程打印的 URL。固定端口的终端用法在服务器重启后保持 Cookie 持久化，与之前完全一致。

## 验证

在安装的 0.5.14 应用上通过 WebView2 远程调试观察到 `/plugins/` 组合的 431 响应和 64 个累积的 `dsh-auth-*` Cookie；清空存储后完整启动。`browser-auth.host.spec.ts` 覆盖跨端口共享名称、不变的 payload 端口绑定，以及交换时使被取代名称过期。
