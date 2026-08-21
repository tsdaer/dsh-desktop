# Agent Note: 桌面端 loopback token

状态: implemented

[English](2026-08-22-desktop-loopback-token.md) | 中文

## 问题

运行时以 loopback 无认证方式服务,任何本地进程都能访问 API:读取与变更会话、驱动工具、读取 Workspace 文件。桌面壳子是唯一知道端口的客户端,因此它可以持有一个纯浏览器姿态不需要的按启动密钥。

## 决策

壳子每次启动生成新的 128 位 token,以 `DSH_WEB_TOKEN` 传给运行时,并作为 `?dsh_token=...` 附加到导航 URL。web 组合把环境变量接入 webserver 行的可选 `token` 配置。

`@deepseek-ai/dsh-host-webserver` 新增可选 `token` 配置:设置后,每个已注册(非 fallback)路由与每个 upgrade 都要求 `Authorization: Bearer <token>`(WebSocket 无法设置 header,改用 `dsh_token` 查询参数);静态 dist fallback 保持开放,使页面能在客户端得知 token 之前加载。比较采用长度加全扫描,失配不泄漏前缀。缺省时纯 loopback 姿态完全不变。

浏览器加载后携带 token:`@deepseek-ai/dsh-client-connection` 的 `WebApiClient` 从页面 URL 读取一次 `?dsh_token`,附加到每个 `/api` fetch(header)与 WebSocket(query);桌面桥接 client 的 `bridgeFetch` 对每个 `/dsh-bridge` 请求同样处理。

## 备选方案

**要求静态 dist 也带 token** —— 拒绝:页面必须在任何脚本能读取 token 之前加载,引导请求无法携带它;dist 不含会话数据。

**复用 hostname 信任 fence** —— 拒绝:fence 区分 loopback 与 LAN 权威,但任何本地进程本来就属于 loopback;token 增加了 fence 无法表达的按启动密钥。

**固定共享密钥** —— 拒绝:一个泄露的常量毫无保护作用;token 按启动生成且从不持久化。

## 影响

纯浏览器姿态(无 `DSH_WEB_TOKEN`、无 `?dsh_token`)逐字节不变:无 token 配置即无校验,无 URL 查询即无 header。token 挂在 loopback URL 查询上,恶意本地进程只有已经拥有本地访问权才能观察到;token 的价值是把门槛从"任意进程"提高到"读取过窗口 URL 的进程",而非防御已沦陷的主机。

## 测试

webserver 测试钉住无 token 时路由与 upgrade 拒绝、header 接受、查询参数 upgrade 与开放的 fallback。connection 测试钉住 fetch header 附加与 WebSocket query 附加,用例间重置模块。桥接 client 测试钉住 `bridgeFetch` header 合并与无 token 透传。`cargo check` 编译壳子 token 生成与导航。
