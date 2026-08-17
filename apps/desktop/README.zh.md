# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

一个 Tauri 2 桌面壳,在原生窗口中承载 'dsh web' profile:壳子 spawn 一个跑着 dsh CLI 的 Node 进程,等待 web profile 打印的就绪 URL 行,然后导航到该 URL。

## 路线图

已交付:

- [x] 跟随应用主题的原生标题栏
- [x] 随应用打包的 Node.js sidecar
- [x] 标题栏余额显示
- [x] 资源管理器右键菜单“以 dsh-desktop 打开”
- [x] 可配置的关闭行为:直接退出或保留在系统托盘
- [x] 原生文件与文件夹拖放

计划在 0.3.0 交付:

- [ ] 工作区/工作树侧边栏切换,以及资源管理器、搜索和只读源代码管理视图
- [ ] 在每条普通用户消息和助手消息旁提供视觉一致的复制操作
- [ ] 在余额旁显示 API 连接状态,并支持点击刷新余额
- [ ] 自动检查本仓库的 GitHub Releases,并安装可用更新
- [ ] 启动界面、窗口、托盘和安装器共用同一套黑色应用图标
- [ ] 在标题栏用带无障碍文本的 emoji 显示本地应用负载

“工作树”指以当前所选工作区为根目录的项目视图,不负责管理 Git worktree checkout。[桌面端 0.3 计划](../../.agents/notes/proposed/feature/2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md)定义了范围与验收标准。

## 运行(测试版)

前置条件:

- Rust 工具链(rustc/cargo)
- PATH 上有 Node ^22.19 || >=24(或用 DSH_NODE 指向一个明确的二进制)
- 仓库已构建:`pnpm run build` —— build:lib 产出每个 workspace 包的 lib/(dev 模式下 web profile 的整个插件名册都经 profile 的模块回退目录解析,而该回退指向本仓库),build:web 产出前端 dist。部分构建的仓库(只构建了 apps/cli)会在启动时报 ERR_MODULE_NOT_FOUND,找不到缺失包的 lib。

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

OS 文件拖放由壳子经 Tauri 的拖放处理器接管(`onDragDropEvent`,默认开启 —— 主窗口不再设置 `dragDropEnabled: false`)。WebView2 无法暴露拖入文件的路径(那里没有 `File.path`),因此这是拿到真实文件系统路径的唯一途径;浏览器页本身永远看不到 OS 拖拽过程。

桥接 client 在主窗口上监听拖放,按如下方式处理一次 drop:

- 图片文件经壳子的有界 `read_dropped_file` 命令读回(base64,20 MiB 上限,只能读最近拖入的路径),再以合成 drop 重新进入 dsh 输入框的原生图片接收 —— 图片预览行为与之前完全一致。
- 其余文件把路径作为文本插入输入框(每行一个路径),可直接发给 agent。拖入文件夹同样插入其路径。
- OS 拖拽悬停窗口期间,显示整窗遮罩“拖放文件到输入框”(页面自己无法渲染拖拽反馈,因为它根本收不到拖拽事件)。

桥接旧的复制到 `drops/` 机制与其策略行已随本次改动移除;模型看到的是用户选择的路径,且只有路径。

## 壳桥接

壳子把 dsh-desktop-bridge 包以纯目录拷贝的方式装进 web profile —— dev 模式从本仓库拷贝(apps/desktop/bridge、apps/desktop/bridge-client 与 vendored schemastery),打包模式从运行时拷贝 —— 并在每次启动时挂载 bridge/cordis.patch.yml。桥接包不是 pnpm workspace 成员,因此每条桌面流程都先经 scripts/build-bridge.mjs 从源码构建(npm 的 `dev`/`build`/`bake`/`bundle` 脚本已接入);dev 模式每次启动重新拷贝,重建的桥接总能到达 profile;打包模式的每次启动同样会把 profile 副本与运行时重新对齐。(全程不经过 npm install:已发布的 @deepseek-ai 清单带有 workspace: 协议,而 npm 的 peer 自动安装无法解析。)

桥接 host 路由(/dsh-bridge 之下):

- `GET /config` —— 生效的桌面设置(关闭到托盘、调试模式),按请求读取,设置页保存后立即生效。
- `POST /policy` —— 通过运行时的设置接缝($DSH_HOME/settings.yaml)持久化桌面设置。dsh 配置边界拒绝浏览器写入未列出的命名空间,因此设置行经此路由保存,而不是走 client 的 settingsScope。
- `GET /balance` —— 标题栏余额药丸:经凭据服务解析 DeepSeek key 并代理官方 /user/balance 接口(见“自定义标题栏”)。

桥接 client 半边在页面上负责壳侧行为:上面的拖放处理、关闭按钮行为镜像、调试守卫,以及资源管理器路径路由。

## 桌面设置、托盘与关闭行为

dsh 设置页的 桌面设置 分区(由桥接 client 注册)有两行,都经桥接 host 路由持久化:

- 关闭按钮行为:明确选择直接关闭并退出程序,或隐藏窗口并保留在系统托盘。保留的运行时继续服务,会话继续运行;托盘菜单的 退出 会停掉运行时子进程并结束应用。
- 调试模式:行为不变 —— 关闭时禁用右键菜单与 F12 等调试快捷键,壳子同时翻转 WebView2 的 AreDevToolsEnabled。

两个设置都存在桥接设置命名空间($DSH_HOME/settings.yaml,与其它设置同一接缝),静态回退在桥接行配置里:

    - id: desktop-bridge
      config:
        closeToTray: false
        debugMode: false

关闭到托盘的值存放在运行时,但关闭拦截发生在壳子:桥接 client 在启动时与每次设置变更时,把持久化的值经 `set_close_to_tray` 命令镜像进 Rust;主窗口的 `CloseRequested` 处理器在该值开启时隐藏而非关闭。

托盘本身始终存在:左键点击(或菜单项 显示主窗口)显示并聚焦主窗口;右键打开菜单。托盘图标复用应用捆绑图标(default_window_icon)。

## 以 dsh-desktop 打开(资源管理器右键菜单)

每次启动时,壳子都会(重新)在 HKCU 下注册一个按用户的资源管理器右键菜单项(无需提权),因此命令始终指向当前可执行文件:

- `Software\Classes\Directory\shell\dsh-desktop` —— 在文件夹行上右键出现 以 dsh-desktop 打开。
- `Software\Classes\Directory\Background\shell\dsh-desktop` —— 在文件夹空白背景上右键出现同一菜单项。

菜单运行 `<exe> <文件夹>`。应用保持单实例:已有实例运行时,第二个进程把规范化目录转发给现有窗口,将窗口带到前台,然后退出。桥接 client 选择祖先路径最长的工作区,因此嵌套工作区内的右键目录归属最具体的工作区。随后打开该工作区最近的会话,没有会话则新建一个。目录不属于任何工作区时,页面先询问用户,确认后才把该目录注册为新工作区并打开。

注册是尽力而为的,失败只记日志;NSIS 安装器目前卸载时不移除这些注册表键。

## 测试版范围

- dev 用 PATH 上的 'node' 跑仓库构建出的 CLI;打包应用自带 Node sidecar 和烤出的运行时(见上文 打包 / 打包运行时)。剩余缺口:无自动更新,且 Windows-only sidecar 意味着 Linux/macOS 未处理(dsh 依赖树里 node-pty 也没有 Linux 预编译)。
- 图标源自 DeepSeek 鱼形 logo(用 `node scripts/gen-icons.mjs` 重新生成);托盘复用捆绑的窗口图标。
- 关闭窗口即终止运行时进程,除非开启了关闭到托盘(见“桌面设置、托盘与关闭行为”);会话持久化在 $DSH_HOME 下的磁盘上。
- 窗口自身不绑定任何东西:运行时仍只服务 loopback(127.0.0.1)且无鉴权,与 'dsh web' 的姿态一致。

## 布局

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host + node sidecar binaries/
    scripts/        dev launcher, runtime baker, and node sidecar fetcher
