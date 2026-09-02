# 更新日志

dsh-desktop 的所有重要变更都记录在本文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。draft-release workflow 会把对应版本的章节复制到 GitHub release 的 notes 里。

## [0.5.8] - 2026-09-03

### 变更

- 合并上游 harness master 至 dsh 0.1.2-alpha.5，包含相邻 agent steer、投影缓存兼容性、流式 tool call identity 修复，以及最新的会话与客户端更新。桌面端继续保留 fork 自有 release workflow、已认证的 loopback bridge、文件预览、Worktree 控制、WSL Bash 集成和桌面设置。

## [0.5.7] - 2026-08-31

### 变更

- 合并上游 harness master 至 dsh 0.1.2-alpha.2。桌面端现已包含上游的连接恢复控制、线性流队列、会话投影改进，以及分离的 turn 用量与耗时面板，同时保留 fork 自有工作流、已认证的 loopback bridge、文件预览、Worktree 控制和桌面动效设置。

## [0.5.6] - 2026-08-30

### 修复

- Worktree 路径插入现在会自动追加末尾换行，使插入路径后可以直接继续输入。
- 文件预览窗口会先通过 Tauri 异步运行时离开发起调用的 WebView IPC，再进入主 UI 循环，避免原生窗口创建卡在 `about:blank`。每个新 WebView 会先在认证根路径交换进程启动 token，再加载预览入口；预览文件读取卡住时会显示可见的超时错误。
- 独立文件预览会随其懒加载入口载入共享设计 token 和 Shiki 调色板，因此源文件在主应用窗口之外仍保留语法高亮。
- 独立文件预览现在采用响应式文档界面，包含文件标题栏、相对路径、类型标识、可访问的图标操作、居中的 Markdown 画布、全宽代码卡片，以及明确的加载、拒绝和截断状态。窗口通过 shell 广播跟随主窗口主题（明暗及别名 token 覆盖），浏览器回退使用操作系统偏好。
- Worktree 路径拖放现在插入不带前导 `./` 的规范化 Workspace-relative path；Explorer 行改用共享的主题文件夹、文件和警告图标。
- Worktree 文件查看现在通过共享的安全 Markdown primitive 渲染 Markdown，并用防冲突的语言或纯文本 fence 投影其他文本文件。
- Explorer 和 Search 激活文件时现在会打开或聚焦按路径作用域区分的 Tauri 预览窗口；浏览器运行保留 pane 内回退。
- 桌面链接激活现在只把不带凭据的外部 HTTP(S) URL 交给平台 opener；bridge、loopback 和其他不安全 URL 会被阻止，浏览器运行回退到新标签页。
- 桌面右键菜单现在分别分类 Lexical composer、普通输入框和可读取选区，保持一个可恢复焦点的 portal，并在操作、导航、viewport 变化、失焦和外部输入时确定性关闭。

## [0.5.5] - 2026-08-29

### 修复

- 外部文件拖入和工作树路径拖入现在能把路径插入 Lexical 输入框:桥接此前写入的是已被编辑器迁移移除的 textarea,导致路径插入静默失败。路径改为经由输入框自身的粘贴管道(在 `[data-composer-input]` 上派发合成粘贴)重新进入,保留光标与撤销语义。

## [0.5.4] - 2026-08-28

### 修复

- Linux 原生 UI 冒烟检查接受稳定缺席的 API-key onboarding 步骤,但仍要求实际出现的步骤被成功推迟。

## [0.5.3] - 2026-08-28

### 修复

- Linux 原生 Tauri WebView 冒烟检查现在会在选择就绪应用窗口时识别 Lexical composer 稳定的 `data-composer-input` 元素。

## [0.5.2] - 2026-08-28

### 修复

- 已安装 Linux 包的冒烟检查现在识别 Lexical composer 稳定的 `data-composer-input` 元素,不再等待编辑器迁移时已移除的 textarea。

## [0.5.1] - 2026-08-28

### 修复

- 浏览器会话重定向仅移除自身的一次性启动 token，并保留桌面 loopback bearer 参数，因此打包应用启动时的 HTTP 请求与 WebSocket upgrade 可以完成认证，不再返回 401。

## [0.5.0] - 2026-08-27

### 变更

- 版本 0.5.0:将上游 harness master(1079 个提交)整合进桌面分支,把托管的 web profile 从 dsh 0.1.1-rc.2 推进到 0.1.2-alpha.1。合并携带上游的会话拆分(ui-conversation → ui-chat)、浏览器会话认证重构(启动 token 加签名 cookie)、打包会话历史传输、逐轮 token 用量、lexical composer,以及其背后数千提交所承载的 harness 功能与修复;桌面桥接在新的连接架构上保持其 loopback token 姿态。

## [0.4.2] - 2026-08-26

### 修复

- WSL 环境卡片现在会出现在桌面设置中:此前桥接设置区只渲染前三个 item slot,导致已注册的 WSL 卡片(item4)不可见。现在设置区渲染全部四个 slot。

## [0.4.1] - 2026-08-26

### 修复

- 运行时监督器在宿主拒绝私有 Job Object 分配（无 breakaway 的外层 job——工具宿主、沙箱 shell、CI runner）时,现在会降级为直接子进程所有权,因此桌面能够启动而非以 "AssignProcessToJobObject: 拒绝访问" 失败。该降级绝不静默:启动日志记录原因,监督器在终止时报告 containment_ok=false。终止通过 taskkill /T 杀掉整个进程树,不留下任何运行时后代孤儿。

## [0.4.0] - 2026-08-26

### 新增

- 运行时监督器拥有完整的桌面运行时进程树:Windows 上运行时运行在配置了 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的私有 Job Object 内,POSIX 上运行在独立进程组内。所有退出路径(托盘退出、ExitRequested、启动超时、就绪断开、更新器重启)都汇入监督器幂等的 terminate_and_join,因此异常退出或应用关闭时不会有任何被拥有的后代进程存活;关闭到托盘按设计保持运行时存活。容器分配失败是带诊断的致命启动错误 —— 运行时绝不无容器运行(apps/desktop/src-tauri/src/runtime_supervisor.rs)。
- 目标原生 fixture(src-tauri/tests/runtime_tree.rs)启动根 Node 进程、Node 子进程和分离的孙进程,打印身份并断言整棵树在不做进程名匹配的情况下被终止。在拒绝私有容器分配的外层 job 宿主上,它以明确原因自行跳过。
- 标题栏账户摘要与提供方绑定:它通过新的账户摘要能力(dsh-llm)跟随活跃会话的模型选择,因此显示的账户状态绝不滞后于所选提供方,也绝不显示另一提供方的金额。旧的无条件余额端点已移除。
- 桌面拥有的右键菜单取代生产右键抑制:选中可读文本处处提供 Copy,仅在对话 composer 提供 Cut/Copy/Paste,带键盘导航与 viewport 钳制。调试模式暴露显式 Inspect 项。
- 桌面设置中的 WSL 2 发现(仅 Windows):类型化就绪快照、发行版选择、启用前执行探针,以及缺失环境时的微软安装链接。该设置绝不安装、修改或下载任何东西。
- Windows 上可选的 WSL 2 Bash 执行世界(bash-wsl executor + tool-bash-wsl):PowerShell 保持可用,Bash 仅在 WSL 设置启用且发行版探针健康时加入工具目录,工作目录是经 /mnt 翻译的 Windows 路径,非盘符路径可见地失败。

### 变更

- 版本号 0.4.0。

## [0.3.30] - 2026-08-25

### 修复

- 打包启动现在会安装并刷新 web profile 中的桌面桥接包；此前打包模式被误判为 dev 模式，升级后 profile 仍保留旧桥接，无法通过 loopback token 认证（桌面设置、余额与关闭到托盘请求均因 HTTP 401 失败）。
- 更新应用时会同步修复 profile：当桌面版本或桥接 patch 前进时，壳子会重新同步 profile patch 中由壳子拥有的桥接行（保留用户行与本版本内的编辑）、清理历史残留目录、记录同步状态，并在启动后探测带认证的桥接路由——桥接损坏会写入日志而不是静默失败。

## [0.3.29] - 2026-08-25
- 桌面桥接编译不再因未使用的设置初始化导入而失败。

## [0.3.28] - 2026-08-25

### 修复

- 桌面初始化会在客户端插件加载前捕获 loopback token，恢复设置和余额请求的认证。
- 标题栏会明确显示余额查询可用性，不再把它表述为聊天 API 可用性。

## [0.3.27] - 2026-08-25

### 修复

- Linux 原生 UI 冒烟测试会在 Tauri 启动页向主 WebView 切换期间重试临时的窗口关闭状态。

## [0.3.26] - 2026-08-25

### 修复

- 桌面设置会校验桥接响应，并通过已认证的 loopback 路由持久化，不再因空 JSON 响应体而保存失败。
- 通用 Remote RPC 调用会携带桌面 loopback token，插件列表可正常读取。
- WebSocket 错误与流打开超时会进入重连，不再把不可用连接发布为就绪状态。

## [0.3.25] - 2026-08-25

### 修复

- Linux 原生 Tauri UI 冒烟测试会把导航限制在本地化的 Sessions（会话）树中、忽略临时 New Session row,并在打开植入的 transcript 前推迟全新 home 的 API key 提示。

## [0.3.24] - 2026-08-25

### 修复

- Linux 原生 Tauri UI 冒烟测试会根据录制 fixture 重建合法的持久化 session header、确认全新 home 的内测声明，并在失败时报告隔离的原生诊断。

## [0.3.23] - 2026-08-25

### 修复

- Linux 原生 Tauri UI 冒烟测试会通过 `DSH_PATCH` 传入明文会话 fixture 覆盖，使已安装的 Web profile 能发现植入的 transcript；WebDriver 断言失败时会保留 WebView 截图。

## [0.3.22] - 2026-08-25

### 修复

- Windows 已安装包冒烟测试会在桌面壳退出后，按精确的已安装路径强制终止被重新托管的打包 sidecar。
- Linux 原生 Tauri UI 冒烟测试会先展开唯一折叠的会话分组，再打开植入的会话。

## [0.3.21] - 2026-08-24

### 修复

- Linux 原生 Tauri UI 冒烟测试兼容启动时已选中或尚未选中的植入 session。

## [0.3.20] - 2026-08-24

### 修复

- Linux 原生 Tauri UI 冒烟测试会直接从主会话树打开唯一的持久化 fixture,内容索引覆盖仍由组装后的 Web 回放负责。

## [0.3.19] - 2026-08-24

### 修复

- Linux 原生 Tauri UI 冒烟测试会先以保证无结果的查询预热冷会话内容索引，再搜索已植入的会话记录。

## [0.3.18] - 2026-08-24

### 修复

- Linux deb 与原生 Tauri UI 冒烟测试共用有界命令执行器，可读取已烘焙运行时的完整已安装文件清单。

## [0.3.17] - 2026-08-24

### 修复

- Linux deb 冒烟测试可读取软件包的完整已安装文件清单，不再耗尽 Node 同步子进程的默认输出缓冲区。

## [0.3.16] - 2026-08-24

### 修复

- Linux AppImage 冒烟会启动 package 的 `AppRun` 入口,让 GTK hooks 和 WebKit 相对 helper 路径使用所需的 `$APPDIR/usr` 工作目录。

## [0.3.15] - 2026-08-24

### 修复

- Linux AppImage、deb 和原生 UI 冒烟会传入 checkout 根目录的绝对构件路径,避免带 filter 的 pnpm 脚本相对 `apps/desktop` 错误解析路径。

## [0.3.14] - 2026-08-24

### 修复

- Linux 发布 job 会在生产运行时烘焙后恢复锁定的开发依赖,确保 Playwright、安装包 UI、原生 UI 和回放冒烟工具仍可用。

## [0.3.13] - 2026-08-24

### 修复

- Linux 发布暂存会忽略 Tauri 解包出的 AppImage 与 deb 工作目录,同时继续严格拒绝异常文件;macOS dmg 冒烟会从规范化的临时路径启动,避免 Tauri 在资源查找时拒绝 `/var` 符号链接祖先。

## [0.3.12] - 2026-08-24

### 修复

- 目标自有桌面运行时会在打包前删除外部 Koffi ABI 目录,避免 Linux glibc AppImage 构建把随包提供的 musl addon 当作可部署的 ELF 依赖;macOS dmg 冒烟会在 `DSH_HOME` 外安装,并在超时时保留隔离的 splash 诊断。

## [0.3.11] - 2026-08-24

### 修复

- Linux AppImage 构建在 Tauri 支持的 Ubuntu 22.04 基线上运行并输出 linuxdeploy 诊断；macOS dmg 启动冒烟使用原生 `ditto` 安装 app bundle，使 bundle 元数据在复制后保持完整。

## [0.3.10] - 2026-08-23

### 修复

- 打包启动现在使用产品自有的 Tauri 外部二进制名称（Windows 为 `dsh-node.exe`，POSIX 为 `dsh-node`），同时保留带目标后缀的源码暂存名称；安装包冒烟会直接启动 macOS app bundle、使用适合平台 shell 的 PTY 标记命令、在有界优雅退出后接受成功的强制清理、等待真实 NSIS 卸载进程，并且只跟踪已安装 sidecar 的路径。
- Linux 发布打包会禁用 linuxdeploy 的 strip，避免在组装 AppImage 时改写预构建运行时和原生 addon 的 ELF 文件。

## [0.3.9] - 2026-08-23

### 修复

- 使用新的不可变桌面发布标签重新发布跨平台 release job 修复。

## [0.3.8] - 2026-08-23

### 修复

- Linux AppImage 打包在 Ubuntu 24.04 上通过解压模式运行下载的 AppImage 工具，macOS 安装包冒烟通过 pnpm 的包工作目录传递绝对构件路径，Windows 安装包冒烟则在安装器释放文件句柄期间重试删除临时目录。

## [0.3.7] - 2026-08-23

### 修复

- 桌面发布准备现在可在 Windows、Linux 和 macOS 上一致运行：嵌套 pnpm 调用不经过 shell，fixture 路径不依赖包工作目录，POSIX 权限测试会更新真实文件模式，Windows Node 压缩包则通过参数绑定的 tar 调用解压。
- Windows 运行时校验现在接受 Koffi 的目标平台可选包，目标运行时源目录改用简短的产品键，使 NSIS 打包深层依赖时不会超过路径长度限制。

## [0.3.6] - 2026-08-23

### 修复

- 桌面桥接包现在作为 pnpm workspace 成员安装,发布 runner 无需调用 npm 即可解析其 `workspace:` 依赖,所有目标打包任务都能编译 bridge client。

## [0.3.5] - 2026-08-23

### 新增

- Worktree 资源管理器与搜索可在应用内只读查看器中打开文件:有界严格 UTF-8 内容并带显式截断状态、二进制与非 UTF-8 拒绝、通过客户端既有高亮器着色,以及滚动到匹配行的搜索结果。
- 无边框主窗口恢复原生缩放边框与 Windows 11 贴靠布局弹出层,最大化图标改为跟随原生宿主推送的窗口状态,而非仅依赖点击与缩放事件。

## [0.3.4] - 2026-08-21

### 修复

- 卸载时会移除资源管理器的 以 dsh-desktop 打开 右键菜单项。这些项由应用自己注册，此前会在卸载后残留，并指向已被删除的可执行文件。
- 侧边栏收起时选择「项目文件」不再让侧边栏区域变空：共享的工作区浏览器会一直可见，直到宽栏的项目文件面板真正取代它。
- 发布版本校验现在覆盖 Cargo.lock（v0.3.3 发布时它仍记着 0.3.2），并由同一个脚本把 package.json 的版本传播到 tauri.conf.json、Cargo.toml 和 Cargo.lock。
- 运行时 bake 会把相对的 `--dir` 解析到仓库根，因此从别的工作目录执行 bake 不会再在该目录旁边生成 deploy 目录树。

## [0.3.3] - 2026-08-20

### 修复

- 启动应用不再把所服务的 URL 交给系统默认浏览器:壳子向它 spawn 的 `dsh web` 运行时传入 `--no-open`,因为显示页面的窗口由壳子自己持有。

## [0.3.2] - 2026-08-20

### 新增

- 桌面设置新增可选的新会话 Logo 悬停动效；开启后仅对该提示覆盖系统的减少动效偏好。

### 修复

- 打包启动不再设置 `DSH_BARE_MODULE_BASE`，使装到 profile 里的 bundle 仍可解析，同时由 profile 回退把内置包链接回运行时。

## [0.3.1] - 2026-08-19

### 修复

- 更新清单同时包含 Windows 架构回退项和 NSIS 专用项，使无法读取安装包类型的已安装版本仍能找到已签名安装包。

## [0.3.0] - 2026-08-19

### 新增

- Windows 签名更新器会检查最新的 GitHub 已发布版本，显示下载进度，在下载和安装前要求确认，并在更新失败时保持应用运行。
- 桌面壳为 Web profile 提供工作区资源管理器、搜索、源代码管理装饰、运行时状态栏和有界的启动图形。

### 修复

- 发布工作流现在要求更新器签名密钥，生成 NSIS 签名产物，并发布与安装包匹配的 `latest.json` 清单。

## [0.2.1] - 2026-08-17

### 新增

- OS 文件拖放改由壳子处理(`onDragDropEvent`,真实文件系统路径):拖入的文件夹/文件把路径插入输入框;拖入的图片经有界的壳子字节桥重新进入输入框的原生图片接收。
- 系统托盘图标与菜单(显示主窗口 / 退出);桌面设置提供明确的关闭按钮选项:退出程序或保留在托盘。
- 文件夹上的按用户资源管理器右键菜单项(以 dsh-desktop 打开);单一应用实例打开归属路径最具体的工作区,或在添加未匹配目录为新工作区前询问用户。

### 移除

- 桥接的复制到 `drops/` 拖放管线及其策略行(复制开关、大小上限)—— 拖放现在把真实路径插入输入框。

### 修复

- dev 流程改为从仓库拷贝桥接包而非 `npm install`(已发布的 @deepseek-ai 清单带有 npm 的 peer 自动安装无法解析的 `workspace:` 协议)。
- 资源管理器右键菜单注册补全 `HKCU\` 根键前缀。

## [0.2.0] - 2026-08-16

### 新增

- 标题栏在标题旁显示应用版本徽标，并在窗口控制按钮前显示 DeepSeek 余额药丸（由桥接 host 的 `/dsh-bridge/balance` 路由提供数据）。

### 修复

- 桌面各流程在打包/烤制前会先经 `scripts/build-bridge.mjs` 从源码重建桥接包，因此桥接改动（如余额路由）总能进入 dev 运行与安装包；桥接 lib 缺失时烤制直接报错，不再静默产出坏包。
- 打包模式的每次启动会把 profile 里的桥接副本与运行时重新对齐，旧安装留下的过期桥接不再在新版本上残留。
- 桌面设置（拖放策略与调试模式两行）现在会跟随应用语言切换。
- 启动应用不再弹出 `node.exe` 控制台窗口。

## [0.1.0] - 2026-08-15

### 新增

- 启动界面，带启动前环境检测（WebView2、Node sidecar、运行时、数据目录、API Key）。
- WebView2 在安装期安装（`embedBootstrapper`），并提供启动界面的修复链接。
- 运行时负载体积门禁（`pnpm --filter @deepseek-ai/dsh-desktop size-check`）。
- 以桌面版本号为准的 draft-release workflow。

### 变更

- 打包运行时改为生产依赖部署 + 单平台原生预编译裁剪，负载从约 573.8 MB 降到约 185.7 MB。
- 应用版本号以 `package.json` 为唯一来源，打包时同步进 `tauri.conf.json`。

### 修复

- 打包启动：剥掉 `resource_dir()` 返回的 `\\?\` verbatim 前缀（node 的 realpath 会因此失败）。
- 打包启动：把桥接行合并进 profile 的空 `[]` 补丁，而不是追加到其后。
- 打包启动：桥接包解析层级修正（比原来深一层）。
