# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

一个 Tauri 2 桌面壳,在原生窗口中承载 'dsh web' profile:壳子 spawn 一个跑着 dsh CLI 的 Node 进程,等待 web profile 打印的就绪 URL 行,然后导航到该 URL。

## 运行(测试版)

前置条件:

- Rust 工具链(rustc/cargo)
- PATH 上有 Node ^22.19 || >=24(或用 DSH_NODE 指向一个明确的二进制)
- 仓库已构建:`pnpm run build:lib`(dsh CLI)与 `pnpm run build:web`(web 前端 dist)

启动:

    node apps/desktop/scripts/dev.mjs
    # or, after a workspace install:
    pnpm --filter @deepseek-ai/dsh-desktop dev

dev 启动器把 DSH_CLI 设为构建出的 apps/cli/lib/bin.js;DSH_NODE 默认取 PATH 上的 'node'。壳子 spawn 'dsh web --port 0'(OS 分配的空闲端口)并从运行时 stdout 解析就绪行。

## 打包(本地安装器)

    pnpm --filter @deepseek-ai/dsh-desktop bundle

分五步:把版本从 package.json 同步进 tauri.conf.json(`scripts/sync-version.mjs`)、从源码构建桥接包(`scripts/build-bridge.mjs`)、烤出运行时(`scripts/bake-runtime.mjs`)、拉取打包用的 Node sidecar(`scripts/fetch-node-sidecar.mjs`)、再 `tauri build`(release profile 带 lto/strip;NSIS 安装器输出到 src-tauri/target/release/bundle/nsis/)。版本只存在于 package.json,升级只需改那一处。代理提示:首次打包会从 GitHub/nodejs.org 下载 NSIS 工具链和 Node sidecar;若机器需要代理,设置 HTTPS_PROXY/HTTP_PROXY。

安装器是自包含的:它随附壳 exe、node.exe(Tauri externalBin sidecar)和 resources/runtime/ 下的烤出运行时。首次启动时壳子把桥接包拷入 profile(运行时没有 npm),用 DSH_BARE_MODULE_BASE 把裸插件名锚定到打包树,spawn 运行时并导航到所服务的 UI。

## 打包运行时

`scripts/bake-runtime.mjs` 从已构建的工作区产出一个自包含、可启动的运行时:

1. 对 dsh CLI 闭包执行 `pnpm deploy --legacy --prod --config.nodeLinker=hoisted`。生产依赖部署会丢掉工作区的 dev/build/lint/docs 工具链(TypeScript、oxlint、eslint、mermaid……);核心包仍通过 dsh-base 的依赖可达。hoisted 链接是必须的 —— isolated 布局只在顶层暴露直接依赖,而 loader 从运行时自身的 bin 解析配置引用的插件。
2. 补烤 pnpm deploy 不会装的 auto-installed peers(deploy 不重现 autoInstallPeers)以及桌面桥接包,只拷贝每个 workspace 包随附的文件(绝不拷贝其 node_modules)。
3. 单平台化原生预编译产物:node-pty 会带上所有平台、Windows 调试符号(.pdb)和构建期源码;`pruneRuntime` 只保留 win32-x64 预编译。
4. 用一次性 DSH_HOME 并设置 DSH_BARE_MODULE_BASE 启动部署出的 CLI 验证,要求出现 'dsh web:' 就绪行。

负载体积门禁:`pnpm --filter @deepseek-ai/dsh-desktop size-check`(或 `node scripts/size-report.mjs --check`)断言运行时不超过预算,且没有 dev 工具链漏回来。

## 启动界面

应用先打开一个无边框的 splashscreen 窗口,只有等到 `dsh web:` 就绪行才显示主窗口。启动界面(`apps/desktop/src/splashscreen.html`)在启动前做环境检查 —— WebView2、Node sidecar、烤出的运行时、数据目录与 API key —— 把每步记录到轮询状态板上;失败时停留在启动界面并给出重试,`下载 / 修复 WebView2` 链接通过 tauri-plugin-opener 打开微软下载页。

WebView2 的获取是安装期的事:`bundle.windows.webviewInstallMode` 为 `embedBootstrapper`,NSIS 安装器内嵌引导器并以原生进度下载/安装运行时。启动界面无法自己安装缺失的 WebView2(它本身就是一个 WebView2 页面);它只检测并引导。

main.rs 的环境变量接线:DSH_CLI/DSH_NODE/DSH_BARE_MODULE_BASE/DSH_BRIDGE_TARBALL 优先(dev 启动器);没有 DSH_CLI 的 release 构建回退到 resources/runtime/lib/bin.js、sidecar node.exe 和离线桥接拷贝。DSH_BARE_MODULE_BASE 是 apps/cli 里的产品接线(profile-boot.ts 把它传给 boot 的 bareModuleBaseUrl,即文档化的封闭运行时解析锚点)。

## 自定义标题栏

窗口是无边框的;标题栏是一个注入的元素,其源码是 apps/desktop/src/titlebar.js —— 加载页通过 script 标签加载,导航后在 dsh web 页里再注入(main.rs 用 include_str! 内嵌该文件,幂等重试)。

主题跟随:标题栏消费 ui-theme 写在 <body> 上的 dsh 主题 token —— 背景取 sidebar-fill token(--dsw-specific-sidebar-fill,ui-theme 文档化为标题行背景),其余取 --dsw-alias-* 集合;在 dsh 设置里切换主题(或系统深色模式)会自动重绘标题栏,壳子侧无状态。窗口控制走 remote 能力(capabilities/remote.json,URLPattern `http://127.0.0.1:*`);拖动用 startDragging();双击拖拽条像按钮一样切换最大化(若以其它方式进入全屏,拖动前会先恢复)。

标题左侧、应用标题旁边显示版本徽标:main.rs 在 eval 脚本前先写入 `window.__DSH_DESKTOP_VERSION__` 全局变量(取值来自 tauri.conf.json 的版本号,由 package.json 同步而来),因此徽标始终显示打包应用版本;加载页没有该全局变量,只渲染标题本身。

标题右侧(窗口控制按钮之前)以带硬币图标的小药丸显示 DeepSeek 账户余额。药丸每 5 分钟轮询一次 `GET /dsh-bridge/balance`,并在窗口可见时刷新;桥接 host 通过运行时的凭据接缝解析 API key(与 llm-deepseek provider 使用的 `DEEPSEEK_API_KEY` 引用一致)并代理官方 `/user/balance` 接口,API key 永不进入浏览器。药丸在首次成功读取前保持隐藏,刷新失败时保留上次的金额。

已知测试版缺口:无 Windows 11 贴靠布局弹出层(无边框),缩放边框来自 tao 的默认命中测试,最大化图标在点击/缩放事件上同步。

## 拖放

通过禁用 Tauri 的拖放处理器("dragDropEnabled": false)启用原生文件拖放:WebView2 把 OS 拖放直接交给 dsh 页,其文档级接收(InputBar + DropOverlay)以与浏览器一致的行为把图片收进输入框。非图片文件走 dsh 页自身的过滤。

## 壳桥接

壳子把 dsh-desktop-bridge 包自动装进 web profile(npm tarball 拷贝,离线),并在每次启动时挂载 bridge/cordis.patch.yml。桥接包不是 pnpm workspace 成员,因此每条桌面流程都先经 scripts/build-bridge.mjs 从源码构建(npm 的 `dev`/`build`/`bake`/`bundle` 脚本已接入);打包模式的每次启动还会把 profile 里的桥接副本与运行时重新对齐,重建的桥接会自动替换过期的 profile 副本。桥接 host 半边服务 POST /dsh-bridge/drop:把拖入的非图片文件拷进会话工作区的 drops/ 目录,并注入一条用户消息公告(持久、模型可见)。它还服务 GET /dsh-bridge/balance,供标题栏的余额药丸使用:该路由通过凭据服务解析 DeepSeek key 并代理官方 /user/balance 接口(见“自定义标题栏”)。桥接 client 半边把非图片拖放(WebView2 File.path)转发到该路由;图片仍用 dsh 输入框的原生接收。

## 桥接策略

桥接只接受符合其策略的文件:扩展名白名单(空 = 所有扩展)与大小上限。默认:允许所有扩展,50 MiB。

标题栏的齿轮按钮打开设置面板(通过 tauri-plugin-store 持久化到应用配置目录的 settings.json);保存的值立即生效 —— 桥接 host 每次请求读一次 store 文件,client 每次拖放刷新一次策略。静态回退在桥接行配置里(见下),在 store 有值之前使用:

    - id: desktop-bridge
      config:
        allowedExtensions: ['md', 'txt', 'pdf']
        maxBytes: 10485760

client 上传前先预过滤;host 在写盘时再执行一次同一策略。

## 测试版范围

- dev 用 PATH 上的 'node' 跑仓库构建出的 CLI;打包应用自带 Node sidecar 和烤出的运行时(见上文 打包 / 打包运行时)。剩余缺口:无自动更新、无托盘、无单实例锁,且 Windows-only sidecar 意味着 Linux/macOS 未处理(dsh 依赖树里 node-pty 也没有 Linux 预编译)。
- 图标源自 DeepSeek 鱼形 logo(用 `node scripts/gen-icons.mjs` 重新生成)。
- 关闭窗口即终止运行时进程;会话持久化在 $DSH_HOME 下的磁盘上。
- 窗口自身不绑定任何东西:运行时仍只服务 loopback(127.0.0.1)且无鉴权,与 'dsh web' 的姿态一致。

## 布局

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host + node sidecar binaries/
    scripts/        dev launcher, runtime baker, and node sidecar fetcher
