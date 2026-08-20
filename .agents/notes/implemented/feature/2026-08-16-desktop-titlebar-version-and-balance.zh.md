# Agent Note: Desktop title bar shows the app version and the DeepSeek balance

Status: implemented

[English](2026-08-16-desktop-titlebar-version-and-balance.md) | 中文

## 问题

dsh-desktop 窗口是无边框的,自绘标题栏(apps/desktop/src/titlebar.js,由 Rust host 注入到 dsh web 页面)。它只显示应用标题和窗口控制按钮,用户既无法得知当前应用版本,也看不到 DeepSeek 账户余额 —— 每一次请求都在消耗的资源,此前只能在平台网站上查看。标题栏需要在标题旁显示版本号,并在右侧显示余额。

## 决策

**版本徽标。** main.rs 在把 titlebar.js eval 进 dsh 页面之前,先写入 `window.__DSH_DESKTOP_VERSION__` 全局变量;取值来自 `handle.package_info().version`(tauri.conf.json 的版本号,由 scripts/sync-version.mjs 从 apps/desktop/package.json 同步)。titlebar.js 在拖拽条内的标题旁渲染 `v<version>` 徽标。加载页以普通 script 标签加载同一文件,没有该全局变量,因此只渲染标题本身 —— 脚本保持为两个页面的单一事实来源。

**余额药丸。** 标题栏在窗口控制按钮之前显示一个小药丸(硬币图形 + 金额,tooltip `余额`)。数据路径让 API key 完全留在运行时内:

1. titlebar.js 立即轮询同源路由 `GET /dsh-bridge/balance`,此后每 5 分钟一次,并在窗口可见时刷新(每次 fetch 8 秒超时)。药丸在首次成功读取前保持隐藏;刷新失败时保留上次的金额;`balanceEverShown` 区分首次成功前的状态。
2. 桌面桥接 host(apps/desktop/bridge)提供该路由:`resolveBalanceKey` 通过运行时的凭据接缝解析 `credentialRef('DEEPSEEK_API_KEY')`(与 llm-deepseek 使用的引用和顺序一致),接缝缺失时回退到 `process.env.DEEPSEEK_API_KEY`;`handleBalance` 再用 Bearer key 代理官方 `{base}/user/balance` 接口(`DEEPSEEK_BASE_URL` 或 `https://api.deepseek.com`,10 秒超时)。
3. 成功时路由返回归一化的 `{ ok, currency, totalBalance }`(取自第一个 `balance_infos` 条目);失败保持 200 并带机器可读的 `reason`(`unconfigured` / `auth` / `api` / `network`),药丸据此渲染隐藏或过期状态,而不是记录 fetch 错误。余额是纯展示 —— 没有会话事件,没有模型可见输入。

桥接 host 把 `@deepseek-ai/dsh-credentials` 声明为 peer + dev 依赖(llm-deepseek 的模式);值导入在 tsdown 产物中保持 external,通过 profiles 模块回退目录解析,打包版的链接指向烤出的运行时。

## 考虑的备选方案

**用 Tauri command 在 Rust 里取余额** —— 否决。壳进程访问不到 API key(它存在运行时的凭据存储或环境里),还需要自己的 HTTP client,而运行时本来就在进程内拥有 key 解析。

**页面直接调用 DeepSeek API** —— 否决。会引入 CORS 并把 API key 暴露给浏览器;桥接路由的全部意义就在于 key 不离开运行时。

**把余额路由加到 llm-deepseek** —— 否决。余额展示是桌面壳集成;桥接 host 是既有的壳接缝(拖放、策略、调试模式),爆炸半径因此控制在 apps/desktop 内。

**在构建时把版本烤进 titlebar.js** —— 否决。该文件被两个面加载(加载页 script 标签与注入 eval);运行时全局变量保持单一文件,并且始终与实际打包的版本一致。

## 后果

未配置 key 时药丸隐藏(首跑常见情况,隐藏而不是反复打扰)。每次可见刷新在 5 分钟节奏下花费一次平台鉴权请求 —— 可忽略,且余额读取从不进入会话日志。桥接 host 增加了一个对凭据接缝的运行时依赖;peer 声明遵循 llm-deepseek 先例,dev 与打包两种布局下导入都可解析。

## 验证

对真实 web profile 的端到端启动(临时 DSH_HOME、已装桥接、无凭据)`GET /dsh-bridge/balance` 返回 `{"ok":false,"reason":"unconfigured"}`;设置 `DEEPSEEK_API_KEY` 并把 `DEEPSEEK_BASE_URL` 指向本地 `/user/balance` mock 后,返回 `{"ok":true,"available":true,"currency":"CNY","totalBalance":"110.00"}`。桥接包在新增 external 导入后通过类型检查与构建(tsc + tsdown)。
