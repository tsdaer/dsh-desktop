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

- [x] 桌面专用的工作区/工作树侧边栏切换,保持共享 Workspace 浏览器不变
- [x] 工作树模式的资源管理器、搜索、只读 Git 状态装饰和路径拖入聊天框
- [x] 不带 `./` 前缀的 Workspace-relative Worktree 路径插入，以及带主题的 Explorer 条目图标
- [x] 整文件 Source Control 写入:暂存、撤销暂存、丢弃(带点名文件的确认)、限定所选工作区的提交(带提交信息)以及复用共享差异呈现的 diff 查看
- [x] Explorer 行与搜索结果的只读应用内文件查看器,支持经过清理的 Markdown、高亮代码、截断与二进制拒绝状态以及匹配行滚动
- [x] 在每条普通用户消息和助手消息旁提供视觉一致的复制操作
- [x] 在余额旁显示 API 连接状态,并支持点击刷新余额
- [x] 自动检查本仓库的 GitHub Releases,并安装可用更新
- [x] 启动界面、窗口、托盘和安装器共用同一套黑色应用图标
- [x] 在标题栏用带无障碍文本的 emoji 显示本地应用负载

计划在 0.4.0 交付:

- [x] 完整拥有桌面运行时进程树(Windows Job Object / POSIX 进程组),所有退出路径都汇入一个幂等的 terminate_and_join
- [x] 跟随活跃会话模型选择的提供方绑定标题栏账户摘要
- [x] 桌面拥有的右键菜单(处处 Copy;对话 composer 内 Cut/Copy/Paste)
- [x] 桌面设置中的 WSL 2 发现,以及 Windows 上可选的 Bash 执行世界

[桌面端 0.4 计划](../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.zh.md)定义了范围与验收标准。

“工作树”指以当前所选工作区为根目录的项目视图,不负责管理 Git worktree checkout。[桌面端 0.3 计划](../../.agents/notes/proposed/feature/2026-08-17-desktop-0.3-worktree-and-runtime-chrome.zh.md)定义了范围与验收标准。

Source Control 请求会携带浏览器取消信号。切换 Workspace 或离开 Worktree 时,进行中的变更、提交与差异读取会被取消;已取消的响应不会更新新的视图。bridge 重连后,使用“刷新”发起新的 Git 状态请求。生命周期决策记录在 [Source Control 请求生命周期说明](../../.agents/notes/implemented/bug-fix/2026-08-22-desktop-source-control-request-lifecycle.zh.md)中。

该切换由 `bridge-client` 通过现有侧边栏插件生命周期贡献。它把桌面 chrome portal 到 Workspace 区域,不改变共享 `ui-workspace` package 及其浏览器注册;卸载桌面插件后,切换一并移除并恢复标准 web 组合。

## 运行(测试版)

前置条件:

- Rust 工具链(rustc/cargo)
- PATH 上有 Node ^22.19 || >=24(或用 DSH_NODE 指向一个明确的二进制)
- 仓库已构建:`pnpm run build` —— build:lib 产出每个 workspace 包的 lib/(dev 模式下 web profile 的整个插件名册都经 profile 的模块回退目录解析,而该回退指向本仓库),build:web 产出前端 dist。部分构建的仓库(只构建了 apps/cli)会在启动时报 ERR_MODULE_NOT_FOUND,找不到缺失包的 lib。

启动:

    node apps/desktop/scripts/dev.mjs
    # or, after a workspace install:
    pnpm --filter @deepseek-ai/dsh-desktop dev

dev 启动器把 DSH_CLI 设为构建出的 apps/cli/lib/bin.js;DSH_NODE 默认取 PATH 上的 'node'。壳子 spawn 'dsh web --port 0 --no-open'(OS 分配的空闲端口)并从运行时 stdout 解析就绪行;`--no-open` 阻止 web profile 把 URL 交给系统默认浏览器,因为壳子会导航自己的窗口到该 URL。

要重复产出浏览器证据,运行:

    pnpm --filter @deepseek-ai/dsh-desktop evidence

该命令构建独立桥接包,创建一次性的 `DSH_HOME`,初始化 web profile 及其模块回退,在不替换回退目录中 `@deepseek-ai/schemastery` 符号链接的前提下安装桥接包,合并桥接 patch,把仓库注册为 Workspace,并服务固定的 4173 端口。它会打印就绪 URL 与 `/dsh-bridge/config` 探针 URL;在浏览器打开就绪 URL 并在侧栏选择“项目文件”(英文界面为 Worktree)。使用 `-- --port <port> --workspace <directory>` 更改端口或 Workspace;按 Ctrl+C 会移除临时 home 并停止服务。

## 打包(本地安装器)

    pnpm --filter @deepseek-ai/dsh-desktop bundle

它会运行按目标选择的准备阶段:把版本从 package.json 同步进 tauri.conf.json、Cargo.toml 和 Cargo.lock(`scripts/sync-version.mjs`),从源码构建桥接包(`scripts/build-bridge.mjs`),运行目标脚本测试,拉取匹配的 Node sidecar(`scripts/fetch-node-sidecar.mjs`),使用该 sidecar 烘焙按目标划分的运行时(`scripts/bake-runtime.mjs`),再运行 `tauri build`(release profile 带 lto/strip)。可通过 `pnpm --filter @deepseek-ai/dsh-desktop bundle -- --target <triple>` 显式传入 Rust target;省略时脚本使用 `rustc -vV` 报告的宿主目标。命令会把 `src-tauri/tauri.<target>.conf.json` 下经过审查的目标层与公共配置合并,并在 Tauri 启动前校验生效的 bundle 类型和运行时资源。目标产物位于 `src-tauri/target/<triple>/release/bundle/`:Windows 使用 NSIS,Linux 使用 AppImage 和 deb,macOS 使用 app 和 dmg。发布清单只读取预期的直接构件,忽略 Tauri 解包出的工作目录,同时继续拒绝异常的直接文件。Linux 发布构建在 Ubuntu 22.04 上运行,传入 `--verbose` 以保留 linuxdeploy 诊断,并设置 `NO_STRIP=1`,因为 Rust 可执行文件已由 release profile 执行 strip,安装包中的预构建 ELF 文件必须保持不变。原生运行时和打包证据必须在目标 runner 上取得。版本只存在于 package.json,升级只需改那一处;`pnpm --filter @deepseek-ai/dsh-desktop version-check` 只校验同步结果是否一致而不写入,发布工作流会拒绝校验失败的标签。代理提示:首次打包会从 GitHub/nodejs.org 下载目标工具链和 Node sidecar;若机器需要代理,设置 HTTPS_PROXY/HTTP_PROXY。

Linux 发布 runner 会通过 `pnpm --filter @deepseek-ai/dsh-desktop linux-baseline -- --target x86_64-unknown-linux-gnu` 记录 glibc、GTK、WebKitGTK 和打包工具版本。加上 `--output <file>` 可把 JSON 记录作为构建证据保留。该命令记录构建环境,不证明对更旧发行版的兼容性。

目标原生安装包启动冒烟可通过 `pnpm --filter @deepseek-ai/dsh-desktop packaged-smoke -- --target <triple> --artifact <path>` 运行。带 filter 的 pnpm 脚本会从 package 目录执行,因此 workflow 调用方会在调用前把构件参数解析成绝对路径。Windows 使用 `--install-nsis` 安装 NSIS 构件;Linux 接受 AppImage,或带 `--install-deb` 的 deb;macOS 接受 app bundle,或带 `--install-dmg` 的 dmg。AppImage 路径会启动其根目录的 `AppRun` 入口,保留 GTK hooks 和 WebKit helper 查找依赖的 `$APPDIR/usr` 工作目录。dmg 路径使用与 `DSH_HOME` 分离的临时安装根目录,对应 `/Applications` 与用户数据之间的隔离;启动前会解析该根目录,避免 macOS 的 `/var` 别名成为 Tauri 拒绝的符号链接可执行文件祖先。启动超时会包含隔离的原生 splash 日志。冒烟检查会启动已安装的可执行文件,等待运行时就绪 URL,等待受管理的子进程完全退出,并在报告清理失败前强制终止仍可按壳进程父子关系或已安装 sidecar 精确路径识别的进程。带有 `--terminal-smoke` 时,它还会运行打包运行时的 PTY 探针,并检查移除安装包后临时 `DSH_HOME` 仍然存在。Linux 可加 `--web-smoke` 用 Chromium 打开已安装包提供的就绪 URL,要求 composer DOM 挂载并保留截图;这验证打包运行时与 HTTP UI,原生 Tauri WebView 证据仍需单独取得。它要求在目标 runner 上运行,不替代更新器、最低发行版和 GUI 证据。

deb 冒烟会在安装前创建用户数据标记,并要求执行 package purge 后该标记仍然存在。这样可以验证安装包的卸载路径,同时不把一次性 smoke home 当成应用应拥有的数据。deb package 与原生 UI 冒烟共用有界命令执行器来读取 package 自有文件清单;其中的烘焙运行时会超过 Node 默认同步子进程输出缓冲区。package 冒烟会复用该清单查找可执行文件、sidecar 和运行时。生产运行时烘焙会移除工作区的开发依赖,因此 Linux release job 会在安装 Chromium 以及运行安装包、原生 UI 和回放探针前恢复锁定的开发依赖安装。该 job 还会在 Chromium 下回放无 key 的 `navigation-panes` 浏览器场景,覆盖组装 Web profile 的模型面对的终端卡片和导航交互。这项回放与已安装包 smoke 分开,不代表已安装 GUI 证据;版本 N 到 N+1 的已安装更新仍需要目标原生验收 workflow。

仅限 Linux 的 `pnpm --filter @deepseek-ai/dsh-desktop native-ui-smoke -- --target x86_64-unknown-linux-gnu --artifact <deb> --screenshot <path>` 会安装 deb,针对已安装可执行文件启动 `tauri-driver`,还原已提交的无 key `navigation-panes` session,确认全新 home 的内测声明,并推迟缺少 API key 的配置步骤。它只在本地化的 Sessions（会话）树中导航,按需展开 fixture 所在分组,忽略临时的 New Session row,再通过原生 WebKit WebView 打开唯一的非空持久化 row,校验 composer 与模型面对的终端卡片,并在 purge 安装包前截图。smoke 会在写入 plaintext log 前,用 session persistence 要求的 metadata 重建录制 fixture 的 header;`DSH_PATCH` 会把该临时 persistence 配置经桌面壳传给 Web profile。内容索引搜索覆盖由组装后的 Web 回放负责。runner 需要 `webkit2gtk-driver`、`tauri-driver` 和 `xvfb` 等 X display;WebDriver 断言失败时会保留当前 WebView 截图,并打印有界的 driver 输出和隔离的原生 splash 日志。已安装应用不会继承名称中包含 `KEY`、`SECRET`、`TOKEN` 或 `PASSWORD` 的环境变量。fixture 不能当作真实模型或最低发行版证据。

安装器是自包含的:它随附壳程序、Node sidecar(Tauri externalBin)和 resources/runtime/ 下的烘焙运行时。Tauri 读取 `dsh-node-x86_64-pc-windows-msvc.exe` 等带目标后缀的源文件,但安装后在 Windows 中使用产品自有名称 `dsh-node.exe`,在 POSIX 中使用 `dsh-node`,不会与系统 Node 安装冲突。源码运行时目录位于 `src-tauri/runtime/<product-target>` 下,目标解析器会在暂存文件前拒绝不支持的目标。首次启动时壳子把桥接包拷入 profile(运行时没有 npm),为内置包修复 profile 回退目录,并导航到所服务的 UI。profile 安装的 bundle 仍从 profile 自己的 node_modules 解析。

macOS arm64 另有一个未签名的仅构建命令:`pnpm --filter @deepseek-ai/dsh-desktop bundle -- --target aarch64-apple-darwin --experimental`。它生成 app 和 dmg,但不生成 updater 构件;该结果只能作为编译与打包证据,不能作为受支持的下载或更新渠道。签名并公证 macOS 发布版本需要产品持有的 Developer ID 与 updater 凭据。

## 打包运行时

`scripts/bake-runtime.mjs` 从已构建的工作区产出一个自包含、可启动的运行时:

1. 对 dsh CLI 闭包执行 `pnpm deploy --legacy --prod --config.nodeLinker=hoisted`。生产依赖部署会丢掉工作区的 dev/build/lint/docs 工具链(TypeScript、oxlint、eslint、mermaid……);核心包仍通过 dsh-base 的依赖可达。hoisted 链接是必须的 —— isolated 布局只在顶层暴露直接依赖,而 profile 回退目录会把部署闭包暴露给内置包解析。
2. 补烤 pnpm deploy 不会装的 auto-installed peers(deploy 不重现 autoInstallPeers)以及桌面桥接包,只拷贝每个 workspace 包随附的文件(绝不拷贝其 node_modules)。
3. 单平台化并校验原生文件:存在兼容预编译时每个 `prebuilds` 目录只保留所选目标;否则接受其旁边的目标 source build 并删除其他平台预编译;目标专属 Koffi 包只保留所选 ABI 目录,因此 glibc 运行时不能残留 musl addon;存在时 `node-pty` 与 `koffi` 必须包含可加载的原生二进制;发现其他平台的动态库或 helper 会在启动校验前让烘焙失败。
4. 使用目标 sidecar 在一次性 DSH_HOME 中启动部署出的 CLI 验证,要求出现 `dsh web:` 就绪行,同时保留 profile 自有 bundle 的解析。

负载体积门禁:`pnpm --filter @deepseek-ai/dsh-desktop size-check`(或 `node scripts/size-report.mjs --check`)断言运行时不超过预算,且没有 dev 工具链漏回来。

## 启动界面

应用先打开一个无边框的 splashscreen 窗口,只有等到 `dsh web:` 就绪行才显示主窗口。启动界面(`apps/desktop/src/splashscreen.html`)在启动前做环境检查 —— 平台 webview、Node sidecar、烤出的运行时、数据目录与 API key —— 把每步记录到轮询状态板上;失败时停留在启动界面并给出重试。Windows 通过 tauri-plugin-opener 提供 `下载 / 修复 WebView2` 链接;Linux 与 macOS 报告平台 webview 限制,不提供微软修复入口。

WebView2 的获取是安装期的事:`bundle.windows.webviewInstallMode` 为 `embedBootstrapper`,NSIS 安装器内嵌引导器并以原生进度下载/安装运行时。启动界面无法自己安装缺失的 WebView2(它本身就是一个 WebView2 页面);它只检测并引导。

main.rs 的环境变量接线:DSH_CLI/DSH_NODE/DSH_BARE_MODULE_BASE/DSH_BRIDGE_TARBALL 优先(dev 启动器);没有 DSH_CLI 的 release 构建要求 resources/runtime/lib/bin.js 与应用可执行文件旁由 Tauri 安装的 `dsh-node.exe` 或 `dsh-node`,然后执行离线桥接拷贝。打包启动默认不设置 DSH_BARE_MODULE_BASE,使 profile 能解析用户 bundle;需要由宿主拥有完整插件集时仍可显式设置。

被启动的运行时由壳的运行时监督器(apps/desktop/src-tauri/src/runtime_supervisor.rs)纳入容器:Windows 上运行在配置了 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的私有 Job Object 内,POSIX 上运行在独立进程组内。所有退出路径 —— 托盘的退出、RunEvent::ExitRequested、启动超时、就绪通道断开和更新器重启 —— 都汇入监督器幂等的 terminate_and_join,因此异常退出或应用关闭时不会有任何被拥有的后代进程存活;关闭到托盘按设计保持运行时存活。容器单元就是精确的所有权:绝不使用进程名匹配。若宿主环境(不允许 breakaway 的 job 沙箱)拒绝私有 Job Object 分配,运行时拒绝启动并给出容器诊断,而不是无容器地运行。

## 自定义标题栏

窗口是无边框的;标题栏是一个注入的元素,其源码是 apps/desktop/src/titlebar.js —— 加载页通过 script 标签加载,主 webview 每次页面完成加载后都会重新注入(main.rs 用 include_str! 内嵌该文件,脚本本身幂等)。API、负载和余额文案跟随实时的 `<html lang>` 值,因此异步解析语言偏好不会让桌面 chrome 停留在旧语言。

主题跟随:标题栏消费 ui-theme 写在 <body> 上的 dsh 主题 token —— 背景取 sidebar-fill token(--dsw-specific-sidebar-fill,ui-theme 文档化为标题行背景),其余取 --dsw-alias-* 集合;在 dsh 设置里切换主题(或系统深色模式)会自动重绘标题栏,壳子侧无状态。窗口控制走 remote 能力(capabilities/remote.json,URLPattern `http://127.0.0.1:*`);拖动用 startDragging();双击拖拽条像按钮一样切换最大化(若以其它方式进入全屏,拖动前会先恢复)。

标题左侧、应用标题旁边显示版本徽标:main.rs 在 eval 脚本前先写入 `window.__DSH_DESKTOP_VERSION__` 全局变量(取值来自 tauri.conf.json 的版本号,由 package.json 同步而来),因此徽标始终显示打包应用版本;加载页没有该全局变量,只渲染标题本身。

标题右侧(窗口控制按钮之前)显示 DeepSeek 余额查询状态、本地应用负载和 DeepSeek 账户余额。余额查询状态为 `checking`、`connected`、`unavailable` 或 `unconfigured`,不表示所选聊天模型是否可用;桥接 host 从凭据安全的 `/dsh-bridge/balance` 请求派生状态,API key 永不进入浏览器。余额控件支持点击刷新,会去重进行中的请求,向辅助技术暴露 `aria-busy`,每 5 分钟轮询一次并在窗口可见时刷新;首次成功读取前保持隐藏,刷新失败时保留上次金额。原生 `runtime_status` 命令以低频率采样桌面进程及其管理的运行时子进程,只返回 `unknown`、`calm`、`active`、`busy` 或 `saturated`;非对称阈值与四秒最短停留时间避免快速变化。emoji 带本地化文本标签,采样不可用时显示中性状态。更新器会在 `locale/change` 后重建,因此状态和确认文案也跟随同一语言偏好。

启动界面与打包图标系列共用 `apps/desktop/src/icon.svg` 中的黑色透明源资产。`scripts/gen-icons.mjs` 生成 16、32、48、256 和 512 像素的 PNG 资产,启动界面在浅色中性承托形状上显示该 SVG 以保持对比度。

## 自动更新

主页面启动后,标题栏会检查已发布 GitHub Release 的 `latest.json`,并报告无更新、发现版本、下载进度、可安装或可恢复的分类失败。`scripts/updater-manifest.mjs` 只接受每个目标已签名的主更新构件,缺少签名、目标重复、文件名异常或版本不匹配都会失败。下载和安装分别需要用户确认;Windows 使用 Tauri 的被动安装模式,并在安装时重启应用。

更新器只接受与 `src-tauri/tauri.conf.json` 内置公钥匹配的分离签名构件。目标构件存在且签名有效时,清单使用 `windows-x86_64`、`linux-x86_64` 和 `darwin-aarch64` 平台行。Draft Release 构件不是更新 endpoint;必须发布已验收的 Release,客户端才能发现它。标签门控工作流需要匹配的 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`,并以 CI 模式运行 Tauri;私钥不会存入仓库或应用。带密码的私钥可以配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,无密码私钥不需要该 secret。

更新 smoke fixture 可以向 `scripts/updater-manifest.mjs` 传入 `--download-base-url <http(s)://host/path>`,并向 `bundle` 传入 `--updater-endpoint <http(s)://host/path/latest.json>`,让目标 runner 从本地提供已签名构件。bundle 命令会把该端点写入临时的额外 Tauri 配置层;它拒绝凭据、查询字符串和片段,显式不传该选项时生产构建仍使用 GitHub 端点。版本 N 到 N+1 的已安装更新工作流仍需要原生安装、重启、用户确认和用户数据证据。

`pnpm --filter @deepseek-ai/dsh-desktop update-fixture -- --target <triple> --version <next-version> --artifact-root <staged-root>` 会校验所选目标的分离签名,并通过 loopback 提供该目标的更新构件与只含当前目标的 `latest.json`。启动版本 N 前,用 `bundle -- --updater-endpoint <打印出的 URL>` 构建版本 N;fixture 会在目标 runner 执行现有更新确认期间持续运行。该辅助程序不会代替用户确认、执行安装,也不会单独声称 N 到 N+1 已完成。

已安装更新冒烟可对这个目标原生安装包使用 `--update-smoke --expected-version <next-version>`。它只在本次 runner 调用中启用显式驱动器:点击现有更新器控件,接受现有的两次确认调用,记录每次打包启动写入的版本,等待 N 到 N+1 的重启,停止重启后的进程,然后检查用户数据是否保留。版本 N 安装包必须内嵌 fixture URL,下一版本构件必须是同一目标的已签名构件。普通启动不会启用该驱动器;它也不替代 GUI 行为或最低发行版兼容性的目标 runner 证据。

`pnpm --filter @deepseek-ai/dsh-desktop update-smoke -- --target <triple> --artifact <version-N-package> --next-version <version-N+1> --artifact-root <staged-root> --port <fixed-loopback-port>` 会启动已签名 fixture,不经过 shell 拼接地调用 `packaged-smoke`,并在成功或失败时关闭 fixture server。运行前要用相同的固定 `--updater-endpoint` 构建版本 N;该命令不构建任一版本,也不把非目标原生 runner 的结果视为证据。

目标原生 Linux N 到 N+1 检查可从 `Desktop Linux update acceptance` 工作流手动运行。提供两个不可变标签和一个固定 loopback 端口;job 会使用 fixture endpoint 构建版本 N,构建并签名版本 N+1,暂存其清单,再在 `xvfb-run` 下运行更新 smoke。它会上传 smoke 日志,但不会发布 Release 或把 Linux 标记为受支持;最低发行版和打包 GUI 证据仍是独立的验收要求。

目标原生 macOS N 到 N+1 检查可从 `Desktop macOS update acceptance` 工作流手动运行。提供两个不可变标签和一个固定 loopback 端口;job 会在 `macos-14` 上为两个 arm64 版本完成签名、公证、staple 和校验,然后针对已签名 dmg 运行更新 smoke 并上传日志。它会消费 Apple 和 Tauri 签名 secret,不会发布 Release,也不会把 macOS 标记为受支持;在该 workflow 通过打包 GUI 与 Gatekeeper 证据前,它仍然只提供验收证据。

无边框主窗口在 setup 时重新加回 `WS_THICKFRAME`(不加 `WS_CAPTION`),由操作系统提供原生缩放边框与 Windows 11 贴靠布局弹出层,标题栏保持自绘。最大化图标从原生宿主读取窗口状态:Rust 在每次尺寸事件时推送 `dsh://maximize-change`,标题栏监听该事件,并保留轮询读取作为回退。

## 拖放

OS 文件拖放由壳子经 Tauri 的拖放处理器接管(`onDragDropEvent`,默认开启 —— 主窗口不再设置 `dragDropEnabled: false`)。WebView2 无法暴露拖入文件的路径(那里没有 `File.path`),因此这是拿到真实文件系统路径的唯一途径;浏览器页本身永远看不到 OS 拖拽过程。

桥接 client 在主窗口上监听拖放,按如下方式处理一次 drop:

- 图片文件经壳子的有界 `read_dropped_file` 命令读回(base64,20 MiB 上限,只能读最近拖入的路径),再以合成 drop 重新进入 dsh 输入框的原生图片接收 —— 图片预览行为与之前完全一致。
- 其余文件把路径作为文本插入输入框(每行一个路径),可直接发给 agent。拖入文件夹同样插入其路径。
- OS 拖拽悬停窗口期间,显示整窗遮罩“拖放文件到输入框”(页面自己无法渲染拖拽反馈,因为它根本收不到拖拽事件)。

桥接旧的复制到 `drops/` 机制与其策略行已随本次改动移除;模型看到的是用户选择的路径,且只有路径。

## 壳桥接

壳子把 dsh-desktop-bridge 包以纯目录拷贝的方式装进 web profile —— dev 模式从本仓库拷贝(apps/desktop/bridge、apps/desktop/bridge-client 与 vendored schemastery),打包模式从运行时拷贝 —— 并在每次启动时挂载 bridge/cordis.patch.yml。桥接包是 pnpm workspace 成员,但仍在普通 workspace 构建 glob 之外,因此每条桌面流程都先经 scripts/build-bridge.mjs 从源码构建(npm 的 `dev`/`build`/`bake`/`bundle` 脚本已接入);dev 模式每次启动重新拷贝,重建的桥接总能到达 profile;打包模式的每次启动同样会把 profile 副本与运行时重新对齐。更新应用时会同步修复 profile:当桌面版本或桥接 patch 前进时,壳子会替换 profile 的 cordis.patch.yml 中由壳子拥有的桥接行(当前版本内的用户行与编辑保留),清理历史残留目录并记录同步标记;运行时就绪后壳子会探测带认证的 /dsh-bridge/config 路由,桥接缺失或过期会记入 splash 日志,而不是在设置页里静默失败。运行时不执行 npm install:已发布的 @deepseek-ai 清单带有 workspace: 协议,npm 无法解析。

桥接 host 路由(/dsh-bridge 之下):

- `GET /config` —— 生效的桌面设置(关闭到托盘、调试模式、新会话 Logo 动效),按请求读取,设置页保存后立即生效。
- `POST /policy` —— 通过运行时的设置接缝($DSH_HOME/settings.yaml)持久化桌面设置。dsh 配置边界拒绝浏览器写入未列出的命名空间,因此设置行经此路由保存,而不是走 client 的 settingsScope。
- `GET /balance` —— 标题栏余额药丸:经凭据服务解析 DeepSeek key 并代理官方 /user/balance 接口(见“自定义标题栏”)。
- `GET /worktree/explorer` —— 为已注册 Workspace 列出一层有界目录；请求只接受 Workspace id 和 Workspace-relative path，响应明确标记截断以及解析后越出 Workspace 的路径。
- `GET /worktree/file` —— 为已注册 Workspace 读取一个有界文件；响应为严格 UTF-8 并带显式截断标志，二进制或非 UTF-8 内容以稳定错误拒绝。Explorer 行与搜索结果在应用内查看器中打开，查看器通过客户端 shiki 高亮器着色，并把搜索结果滚动到匹配行。

桥接 client 半边在页面上负责壳侧行为:上面的拖放处理、关闭按钮行为镜像、调试守卫,以及资源管理器路径路由。

## 桌面设置、托盘与关闭行为

dsh 设置页的 桌面设置 分区(由桥接 client 注册)有三行,都经桥接 host 路由持久化:

- 关闭按钮行为:明确选择直接关闭并退出程序,或隐藏窗口并保留在系统托盘。保留的运行时继续服务,会话继续运行;托盘菜单的 退出 会停掉运行时子进程并结束应用。
- 调试模式:关闭时禁用右键菜单与 F12 等调试快捷键。Windows 还会翻转 WebView2 的 `AreDevToolsEnabled`;Linux 与 macOS 的系统 webview 不提供相同的运行时控制,因此命令会返回明确的平台限制。
- 新会话 Logo 动效:显式开启新会话页面中间鱼形 Logo 的悬停动效;只对这一个动效覆盖系统的减少动态效果偏好。

两个设置都存在桥接设置命名空间($DSH_HOME/settings.yaml,与其它设置同一接缝),静态回退在桥接行配置里:

    - id: desktop-bridge
      config:
        closeToTray: false
        debugMode: false
        logoMotion: false

关闭到托盘的值存放在运行时,但关闭拦截发生在壳子:桥接 client 在启动时与每次设置变更时,把持久化的值经 `set_close_to_tray` 命令镜像进 Rust;主窗口的 `CloseRequested` 处理器在该值开启时隐藏而非关闭。

托盘本身始终存在:左键点击(或菜单项 显示主窗口)显示并聚焦主窗口;右键打开菜单。托盘图标复用应用捆绑图标(default_window_icon)。

## 以 dsh-desktop 打开(资源管理器右键菜单)

每次启动时,壳子都会(重新)在 HKCU 下注册一个按用户的资源管理器右键菜单项(无需提权),因此命令始终指向当前可执行文件:

- `Software\Classes\Directory\shell\dsh-desktop` —— 在文件夹行上右键出现 以 dsh-desktop 打开。
- `Software\Classes\Directory\Background\shell\dsh-desktop` —— 在文件夹空白背景上右键出现同一菜单项。

菜单运行 `<exe> <文件夹>`。应用保持单实例:已有实例运行时,第二个进程把规范化目录转发给现有窗口,将窗口带到前台,然后退出。桥接 client 选择祖先路径最长的工作区,因此嵌套工作区内的右键目录归属最具体的工作区。随后打开该工作区最近的会话,没有会话则新建一个。目录不属于任何工作区时,页面先询问用户,确认后才把该目录注册为新工作区并打开。

注册是尽力而为的,失败只记日志。这些键由应用而非安装器写入,因此卸载时由 `src-tauri/installer-hooks.nsh` 中的 `NSIS_HOOK_POSTUNINSTALL` 宏移除(经 `bundle.windows.nsis.installerHooks` 挂载);NSIS `installMode` 保持默认的 `currentUser`,未提权的卸载程序看到的正是安装用户的 HKCU。升级重装会执行同一钩子,下次启动重新注册。

## 测试版范围

- dev 用 PATH 上的 'node' 跑仓库构建出的 CLI;打包应用自带由 Tauri 安装的 Node sidecar 和烤出的运行时(见上文 打包 / 打包运行时)。标签门控的发布工作流由目标原生 job 构建 Windows x64 与 Linux x64 draft 构件,并把单独标记的未签名 macOS arm64 实验性 bundle 附加到同一个 draft Release。macOS 实验性构件不进入受支持的发布清单;Linux 原生安装、更新、卸载和打包 GUI 证据完成前,受支持的 updater 与发布安装包仍只有 Windows x64;macOS 还必须完成签名、公证、updater、安装、更新、卸载和打包 GUI 证据后才能受支持。
- 图标源自 DeepSeek 鱼形 logo(用 `node scripts/gen-icons.mjs` 重新生成);托盘复用捆绑的窗口图标。
- 关闭窗口即终止运行时进程,除非开启了关闭到托盘(见“桌面设置、托盘与关闭行为”);会话持久化在 $DSH_HOME 下的磁盘上。
- 窗口自身不绑定任何东西:运行时仍只服务 loopback(127.0.0.1)且无鉴权,与 'dsh web' 的姿态一致。

## 布局

    src/            shell pages served by the embedded asset protocol (loading/error)
    src-tauri/      the Tauri app: process manager + window host + node sidecar binaries/
    scripts/        dev launcher, runtime baker, and node sidecar fetcher
