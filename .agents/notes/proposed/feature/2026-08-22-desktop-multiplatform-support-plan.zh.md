# Agent Note：桌面端多平台支持实施计划

Status: proposed

[English](2026-08-22-desktop-multiplatform-support-plan.md) | 中文

## 问题

桌面应用目前只发布 Windows x64 NSIS 安装程序。源码中存在多项彼此独立的 Windows 假设：Node sidecar 下载器选择 Windows zip 并写入 `node-x86_64-pc-windows-msvc.exe`；运行时烘焙仅保留 `win32-x64` 原生文件；安装版启动固定查找 `node.exe`；WebView2 命令和状态文案没有与其他 webview 实现隔离；Tauri bundle 配置只选择 NSIS 及其 hook；体积报告只查找 NSIS 输出；发布工作流只拥有一个 `windows-latest` 构建。仅替换 bundle target 会产出可能在安装后因运行时或原生壳子而失败的制品。

执行智能体需要一份有序计划：把可移植机制与平台策略分开，验证安装后的应用而非只验证开发启动，并确保增加 Linux 与 macOS 时不会静默削弱 Windows。

## Proposal

### 范围与发布顺序

第一个新增支持目标是 **Linux x64**（`x86_64-unknown-linux-gnu`），交付 AppImage 与 `.deb`。第二个是 **macOS arm64**（`aarch64-apple-darwin`），交付已签名并公证的 `.app`／`.dmg`，以及 Tauri updater 所需制品。Windows x64 全程保持支持。更多架构与 Linux 包格式须由后续决策根据原生依赖和 runner 证据确定；智能体不得仅通过扩展 matrix 猜测性地加入目标。

只有组装后的 headless/web profile 能在 Linux 宿主完成既有构建、启动和终端 smoke，Linux 桌面工作才可开始。桌面工作可修复 `apps/desktop` 下仅影响打包的故障；若失败位于 `packages/` 中，则须先在所属能力内完成修复和验证，再恢复本计划。macOS 工作须在 Linux 发布路径变绿后开始，因为签名、公证、app bundle 放置和 updater 签名构成另一条发布信任链。

本计划覆盖构建、打包、发布自动化、安装与更新验证、平台专属壳子行为、文档和证据。它不承诺不存在对应机制的 OS 集成功能等价：Explorer 上下文菜单注册与 Windows 11 贴靠布局处理继续仅限 Windows。可移植要求是每个受支持制品都能启动内置运行时、到达 readiness 行、打开主 UI、执行一条终端命令、关闭受管运行时，并能通过该平台受 Tauri 支持的路径更新。

## 必须遵循的实施顺序

每个工作包以一个可独立评审的 commit 或 PR 结束。前一工作包的聚焦检查未变绿时，不得开始后一工作包。保留工作树中无关改动，并在发布分支前按仓库 pre-push 规范选择检查。

### 1. 固化目标模型并显式选择平台

在 `apps/desktop/scripts/` 下新增一个小型共享模块，把受支持构建目标解析为不可变规格。输入是调用方显式提供的 Rust target triple，或由命令探测并校验格式后的当前宿主 triple。输出至少包含：Tauri target triple、Node 发行平台与架构、压缩包类型、sidecar 源成员、sidecar 目标 basename、运行时原生平台键、bundle 类型、制品目录和 updater 制品后缀。

首轮只支持以下三行：

| 产品目标 | Rust triple | Node 发行包 | Sidecar 文件名 stem | Bundles |
|---|---|---|---|---|
| Windows x64 | `x86_64-pc-windows-msvc` | `win-x64.zip` | `node-x86_64-pc-windows-msvc.exe` | NSIS |
| Linux x64 | `x86_64-unknown-linux-gnu` | `linux-x64.tar.xz` | `node-x86_64-unknown-linux-gnu` | AppImage、deb |
| macOS arm64 | `aarch64-apple-darwin` | `darwin-arm64.tar.gz` | `node-aarch64-apple-darwin` | app、dmg |

缺少目标、格式错误或目标不受支持时，须在下载、删除、烘焙或打包前拒绝。各脚本内不得根据 `process.platform` 分别推断产品目标：发布任务可能交叉准备制品，重复推断会让 sidecar、原生运行时和 bundle 不一致。Node 版本继续只有一个既有配置来源，并保留 `DSH_NODE_VERSION` 作为有意覆盖入口。

新增 Node 测试，固定三行的每个字段，拒绝不受支持的架构，并证明压缩包成员不能逃出临时解压目录。sidecar 下载器、运行时烘焙、体积报告和 bundle 命令都消费该解析器，且自有脚本中除目标表或明确的 Windows 专属行为外不再出现 `win32-x64`、Windows target triple 或 NSIS 输出路径时，本工作包完成。

### 2. 让 Node sidecar 获取可移植且可复现

围绕目标规格重构 `fetch-node-sidecar.mjs`。下载指定版本和目标的 Node 官方压缩包，跟随重定向，拒绝非成功 HTTP 响应，写入新建临时目录，使用适合宿主且以 argv 传参的工具解压，只定位规格指定的 Node 二进制，复制到 Tauri `externalBin` 要求的目标名，并在 POSIX 上设置可执行权限。在 `finally` 中清理临时文件；下载或解压失败不得留下会被后续运行当成有效缓存的残缺目标。

不得仅凭文件存在复用缓存。须在二进制旁记录或校验所选 Node 版本与目标，并执行 `<sidecar> --version`；不匹配时重新下载。CI 在解压前须用同一 Node release 发布的 `SHASUMS256.txt` 校验压缩包。代理支持不得使用 shell 插值，并须保留既有 `HTTPS_PROXY`／`HTTP_PROXY` 行为。

单测使用本地 fixture 压缩包或注入的下载／解压适配器，覆盖重定向、HTTP 失败、校验和不匹配、损坏压缩包、缺少目标成员、POSIX 可执行权限、陈旧缓存元数据和精确目标文件名。宿主 smoke 执行已获取 sidecar 的 `--version`。不得提交下载得到的 sidecar。

### 3. 每个目标烘焙一份独立运行时

用目标规格替换 `bake-runtime.mjs` 中的 `TARGET_TRIPLE = 'win32-x64'` 策略。运行时目录归属于目标，例如 `.runtime/<rust-triple>/deploy`，防止并行 matrix 任务或本地切换平台时复用其他平台的原生文件。Tauri 资源暂存步骤只选择当前目标目录。

在目标操作系统上执行烘焙。`pnpm deploy` 会安装宿主原生依赖，`node-pty` 可能在安装期间编译；不得把 Windows 烘焙的运行时复制到 Linux 或 macOS。Linux 安装 `node-pty` 与 Tauri webview 栈要求的编译器、Python、`make` 和开发库；仅当安装包没有兼容预构建时强制源码构建。可复用仓库既有 manylinux `node-pty` 构建经验，但在安装制品通过声明的最低发行版测试前，不得声称 AppImage 具有 manylinux 可移植性。

把原生裁剪从 Windows 常量推广为目标派生 allowlist。检查 `node-pty`、`koffi` 和其他原生依赖中每个随包发布的 `.node`、可执行 helper 与 prebuild 目录。运行时包含其他 OS／架构的原生二进制，或缺少当前目标必需二进制时须失败。保留许可证和运行时 JavaScript；除非既有体积策略拥有相应删除规则，不得仅因名称像构建文件而删源码。

启动验证必须用所选目标已获取的 sidecar，而不是环境中的 `node`，对目标运行时和临时 `DSH_HOME` 启动，并要求 readiness 行后终止整棵进程树。新增目标目录选择与裁剪脚本测试，并在 Linux CI 中通过组装后的 profile 打开终端。只有干净 Linux runner 能烘焙可离线安装的运行时字节，且安装版 sidecar 能启动它们，本工作包才完成。

### 4. 分离可移植壳子行为与 OS 集成

使 `apps/desktop/src-tauri/src/main.rs` 在三个目标上都能按明确设计编译和运行。

- 通过 Tauri sidecar／resource 能力或平台 basename helper 解析安装版 sidecar；POSIX 上绝不追加 `node.exe`。安装版二进制不存在时报告致命启动错误，不得回退到环境中的 `node`。
- 把 WebView2 controller 访问、WebView2 修复命令、Explorer 注册表写入、installer hook 假设和 Windows chrome 代码置于 `#[cfg(windows)]` 后。在 Tauri API 支持处为 Linux／macOS 提供可移植 debug mode 实现；若某平台不能运行时禁用 developer tools，应在返回状态和文档中明确限制，不得以无操作实现宣称成功。
- 启动画面的检查使用平台中立 id 与文案。Windows 可显示 WebView2 专属修复入口；Linux 通过打包前置条件报告 WebKitGTK／运行库故障；macOS 依赖系统 WebKit，不得提供 Microsoft 修复 URL。
- 文件拖放、单实例路径传递、托盘、关闭到托盘、负载采样、loopback token 传递、运行时关闭和 readiness 导航保持可移植。仅在底层 Tauri API 不同时新增 cfg 专属适配器。
- 明确 OS 集成功能差异：Windows 保留 Explorer 注册和贴靠布局；Linux 与 macOS 接受命令行和第二实例激活传来的目录。Finder 与桌面环境上下文菜单安装器不在本计划范围，须另行设计。

若 `cfg` 分支会遮蔽可移植生命周期代码，则把平台专属逻辑移入小模块。Rust 测试覆盖 sidecar 路径解析、平台中立 splash 状态、运行时命令构造和关闭行为。在每个受支持 runner 上原生执行 `cargo check --target`；从 Windows 交叉检查不能证明 WebKitGTK 或 macOS framework 能链接。

### 5. 让 Tauri 配置与本地命令感知目标

用可移植基础配置与目标专属配置文件，或传给 `tauri build` 的已生成并校验配置，替换单一 NSIS 配置。基础层保留窗口定义、资源、图标、updater 公钥和可移植插件。Windows 层保留 WebView2 bootstrapper、NSIS hook、passive update mode 和 Windows bundle 设置。Linux 选择 AppImage 与 deb。macOS 选择 app 与 dmg，并声明最低 macOS 版本、类别、entitlements、hardened runtime、签名身份输入，以及 Node 和原生 helper 所需的 app bundle 资源。

生成过程不得原地创建未评审配置。check mode 须确定性渲染并比较或校验每个目标的有效 JSON。`bundle` 接受显式目标，依次运行版本同步、bridge 构建、目标运行时烘焙、目标 sidecar 获取、聚焦测试、体积检查和带匹配配置的 `tauri build --target <triple>`。本地开发命令可在有文档说明时只跳过签名／公证步骤；发布命令缺少签名 secret 时须明确失败。

更新 `size-report.mjs`，使其接受同一目标，检查目标运行时，定位每种预期 bundle，并应用已记录的分平台预算。运行时字节与压缩安装程序字节须分别报告，因为 AppImage、deb、NSIS 与 dmg 的压缩结果不可直接比较。新增制品发现测试，并在缺少任一预期制品时失败。

### 6. 构建目标原生发布 matrix，且不削弱标签校验

保留既有 tag-gated 入口与不可变发布源规则。把 `.github/workflows/desktop-release.yml` 拆为轻量校验 job 与 `windows-latest`、`ubuntu-24.04`、`macos-14`（或当时固定的等价 runner）三个目标原生 build job。校验 job 只检查一次 `v<package version>` 标签与 Changelog，然后输出所有 build 使用的精确版本与 commit。

每个 build 只安装本目标前置条件，构建仓库与 bridge 包，烘焙本目标运行时，获取并校验本目标 sidecar，运行聚焦 target smoke，创建 bundle，执行目标体积检查，并上传名称包含版本、OS 和架构的制品。操作系统之间不得传递已烘焙运行时目录。release job 下载全部预期制品，拒绝缺失或重名，记录 SHA-256，只为已校验标签创建或刷新 draft Release，绝不修改已发布 Release。

Linux 制品在最旧受支持 glibc／WebKitGTK 基线上构建，或在发布前于该基线测试。无图形 runner 上通过虚拟显示运行 AppImage smoke，且须证明 readiness 与安装版运行时中的一条终端命令。deb smoke 在一次性 runner 或容器内安装，校验 desktop metadata 与可执行文件位置，启动安装后的应用，再卸载。

macOS 发布任务把 Developer ID 证书导入临时 keychain，对 app 及每个内嵌可执行文件／原生 helper 签名，提交公证，在受支持处 staple，并以 `codesign --verify --deep --strict` 与 `spctl` 验证；always-run 清理步骤删除临时 keychain。证书、密码、Apple 凭据、team id 和 Tauri updater 私钥只能存为 repository／environment secret。日志与制品不得包含解码后的凭据。缺少这些 secret 时，macOS 只能保留 build-only 实验制品，不得加入受支持下载列表。

扩展 `scripts/ci-workflow.spec.ts`，固定三个目标 job、目标原生运行时烘焙、前置条件隔离、标签／版本传播、签名清理、制品完整性、hash 生成、仅 draft 发布，以及不存在分支触发 release。这些结构测试不能替代真实工作流运行。

### 7. 按平台定义 updater manifest

Tauri updater 按平台和架构选择制品。从同一已校验工作流创建的制品生成 `latest.json`，每个实际受支持 updater 目标包含其下载 URL、updater 签名、版本与 release notes。不得让 Linux 或 macOS 条目指向 NSIS 资产，也不得为未签名或未公证制品发布 manifest 条目。

应用继续使用既有 updater 公钥，受保护私钥只在 release job 使用。上传 manifest 前验证每个生成签名。用 fixture 制品清单测试 manifest 生成，覆盖所有受支持行、缺少签名、重复目标、错误版本和意外文件名。每个 OS 都执行安装版更新 smoke：安装 N 版，通过受控 endpoint 发布或提供已签名 N+1 fixture，确认检测到更新，要求既有用户确认，完成安装并重启，断言运行版本为 N+1，且 profile 与 Workspace 数据保留。

各平台安装程序的替换与卸载行为不同。Windows 保留 Explorer key 的 NSIS hook 覆盖；Linux 与 macOS 测试只验证各自 package 拥有的文件和集成。卸载程序绝不能删除 `DSH_HOME` 或用户 Workspace。

### 8. 验证产品行为并记录支持范围

每个平台转为受支持状态时，同步更新 `apps/desktop/README.md` 与中文副本。写明受支持 OS 版本／架构、包格式、必需系统库、安装／升级／卸载命令、签名状态、制品校验、平台专属缺失集成、开发前置条件、目标感知 bundle 命令和排障路径。从可移植章节移除 Windows-only 说法，并保留到 Windows 标题下。

每个目标都从干净安装制品而非 `cargo run` 留存以下证据：

1. 校验 installer／package 并成功安装；
2. 首次启动、splash 检查、readiness 导航与主窗口显示；
3. 无 key 时的 API key 警告及正常配置持久化；
4. 注册 Workspace，并从 Explorer／Search 打开文件；
5. 执行一条有输出的终端命令，并干净释放终端；
6. 关闭到托盘并显式退出，确认没有残留内置 Node 进程；
7. 第二实例目录传递；
8. 从前一受支持版本更新；
9. 卸载后保留 `DSH_HOME`；
10. 从真实安装版应用录制用户可见流程 GIF。

确定性行为使用聚焦自动化测试，壳子／运行时连线使用 native-host 集成测试，安装使用目标原生 packaged smoke。只有人工 checklist 不足以完成；只有 GUI 自动化也不足以验证进程清理和 updater 签名。记录实际运行的命令，并在平台发布时链接产生的 implemented Agent Note。

## Current progress

工作包 1 已在[桌面目标规格记录](../../implemented/feature/2026-08-22-desktop-target-specification.md)中实现。三个目标行是不可变的，并由 sidecar 获取、运行时烘焙、体积报告和 bundle 编排共同消费；目标测试覆盖每行全部字段、不支持的目标、Node 压缩包布局和压缩包路径穿越。

工作包 2 已在[可移植 Node sidecar 记录](../../implemented/feature/2026-08-22-desktop-portable-node-sidecar.md)中实现。sidecar 获取会按目标选择压缩包、跟随有上限的重定向、拒绝 HTTP 失败、在解压前校验匹配的 `SHASUMS256.txt` 摘要、记录版本／目标／摘要元数据、校验可执行文件版本、设置 POSIX 权限，通过可恢复替换同时更新 sidecar 与元数据，在安装或最终权限检查失败时保留旧目标，并清理临时文件。注入适配器测试覆盖摘要不匹配、损坏压缩包、缺少成员、陈旧元数据、精确目标文件名、重定向、HTTP 失败、清理、可执行权限请求和替换回滚。按目标区分的运行时目录和目标派生的原生裁剪已经接通；目标 runner 上的启动证据仍属于工作包 3。

运行时烘焙路径现在要求使用已获取的目标 sidecar 完成 profile 初始化与 readiness 校验，终止校验进程树，且 bundle 命令先获取 sidecar 再烘焙。[目标原生运行时校验](../../implemented/feature/2026-08-22-desktop-target-native-runtime.md)会裁剪每个原生 `prebuilds` 目录；没有兼容预编译时接受目标 source build；存在时要求 `node-pty` 与 `koffi` 有可加载二进制；并在启动校验前拒绝可识别的其他平台原生文件。聚焦测试覆盖兼容预编译、source-build fallback、缺少目标二进制和跨平台文件。Rust 壳已经具备按目标命名的安装版 sidecar、禁止安装版使用环境 Node、把 WebView2 controller 与修复代码隔离到 Windows，以及使用平台中立的 `webview` 启动画面步骤。可移植 debug-mode 命令返回 `{ requested, applied, limitation }`；Linux 和 macOS 返回 `applied: false` 及明确的平台 webview 限制，bridge client 会记录该限制。工作包 3 仍需完成目标原生启动与 Linux 终端证据；工作包 4 仍需在各目标原生 runner 上编译并验证可移植壳行为。

[按目标的 bundle 配置与 updater 构件清单](../../implemented/feature/2026-08-22-desktop-target-aware-bundles.md)现在把共享 Tauri 设置与经过审查的 Windows、Linux、macOS 配置层分开。bundle 编排会校验生效的目标层,目标输出目录包含 Rust triple,体积报告检查每个预期构件并单独报告压缩安装器字节数,updater 清单生成会读取共享 Tauri updater 公钥,并在写入清单前校验每个主构件的 Minisign 文件签名和 trusted comment 签名。测试覆盖有效签名、构件被修改、公钥不匹配以及三个目标的已签名主构件。工作包 5、工作包 6 中 Windows/Linux draft 构件暂存部分以及工作包 7 的清单生成部分已实现;目标原生安装、更新、卸载和打包 GUI 证据仍未完成。

Linux 发布 job 现在会在 `xvfb-run` 下运行目标原生 AppImage 启动冒烟,以及 deb 安装/启动/清除冒烟。它还会调用[Linux 基线 preflight](../../implemented/feature/2026-08-22-desktop-linux-baseline-preflight.md),在安装前置依赖后记录 runner 的 glibc、GTK、WebKitGTK 和打包工具版本。该冒烟检查证明打包后的就绪状态、受管理进程清理和临时 `DSH_HOME` 保留;终端交互、更新安装、最低发行版覆盖和打包 GUI 证据仍未完成。preflight 记录构建环境,但不证明对更旧发行版的兼容性。

打包冒烟会在启动前创建用户数据标记,并要求 deb purge 后标记和 `DSH_HOME` 仍然存在。这完成了安装包冒烟对用户数据保留的检查,但不表示已经验证安装版从版本 N 更新到版本 N+1。[桌面 Linux 安装包冒烟记录](../../implemented/feature/2026-08-22-desktop-linux-packaged-smoke.md)记录了该机制及其剩余证据边界。

打包冒烟现在会在 POSIX 进程快照中保留命令行,在 sidecar 被重新托管后仍按目标命名的 Node sidecar 识别它,并在尝试 `SIGKILL` 清理前限制优雅停止的等待时间。[桌面打包进程清理校验](../../implemented/bug-fix/2026-08-22-desktop-packaged-process-cleanup.md)记录了这项检查;它强化了进程清理证据,但不会关闭剩余的原生平台验收工作。

打包冒烟现在也接受 `--terminal-smoke`。启动 AppImage、deb、app 或 dmg 构件后,它会从构件中解析出且仅解析出一个目标 sidecar 和运行时,使用该运行时通过 `node-pty` 执行固定的 `printf` 探针,等待探针退出,并执行目标本地清理。Linux 和 macOS workflow job 都会调用这项检查。[桌面打包终端冒烟](../../implemented/testing/2026-08-22-desktop-packaged-terminal-smoke.md)记录了证据及其边界:它证明打包后的 PTY 字节和释放,不证明浏览器／模型可见的终端工作流。

macOS arm64 workflow 保留未签名 experimental job，并提供由 `DSH_DESKTOP_MACOS_RELEASE=true` 显式启用的签名发布 lane。该 lane 将 Developer ID 证书导入临时 keychain，在 bundle 和 updater 生成前把 `APPLE_SIGNING_IDENTITY` 传给 Tauri，使用 `codesign` 校验嵌套代码，使用 `notarytool` 提交 dmg，staple app 与 dmg，使用 `spctl` 检查 app，从已 staple 的 app 重建 updater archive，并使用受保护的 Tauri key 重新签名该 archive。始终执行的清理步骤会恢复 runner keychain 列表并删除临时密钥材料。单独的 attachment job 只会把已签名 macOS 清单以及刷新的 `latest.json`／`SHA256SUMS` 加入 draft Release；experimental 清单不会进入 manifest。该 lane 提供发布自动化，不构成 macOS 支持证据。

目标原生打包冒烟接受 macOS arm64 的 app 和 dmg 构件。未签名 experimental job 与选择加入的签名 job 都会在 `macos-14` 上启动 app bundle；dmg 路径会挂载、复制、卸载并启动 app，然后检查就绪状态和受管理进程清理。这只构成打包启动证据；macOS 更新、卸载、公证／Gatekeeper 和 GUI 证据仍未完成。

Windows x64 发布 job 现在会在体积与构件检查后、上传前运行 [Windows 已安装包冒烟](../../implemented/testing/2026-08-22-desktop-windows-packaged-smoke.md)。它把 NSIS 构件安装到一次性目录，启动已安装壳子，按需运行打包 PTY 探针，校验受管理进程清理，运行卸载程序并检查临时用户数据保留。workflow 与脚本测试覆盖该机制；原生 Windows runner 执行仍是证据来源。

更新器清单生成器现在接受 `--download-base-url` 用于受控更新 fixture,`bundle` 接受 `--updater-endpoint`,并通过临时 Tauri 配置层把 runner 本地 endpoint 写入构件；`update-fixture` 会校验所选下一版本构件,并通过 loopback 提供只含当前目标的带签名清单与构件。这些选项都会校验 endpoint,不会改变生产 GitHub URL；[受控清单 URL 记录](../../implemented/testing/2026-08-22-desktop-update-smoke-manifest-base.md)、[端点注入记录](../../implemented/testing/2026-08-22-desktop-update-smoke-endpoint-injection.md)和[更新 fixture server 记录](../../implemented/testing/2026-08-22-desktop-update-fixture-server.md)记录这些机制。安装版从 N 更新到 N+1 的替换、重启、用户确认和用户数据证据仍未完成。

剩余工作包括目标原生 Linux 终端 UI／模型可见工作流、已安装版本更新冒烟、最低基线和打包 GUI 证据；macOS 已配置凭据执行签名 lane、公证／Gatekeeper 证据、已安装版本更新冒烟、受支持发布文档和 GUI 证据；以及 Windows runner 上执行已安装 Windows 安装包回归。签名 lane 自动化、清单签名校验和打包 PTY 冒烟不能替代要求的已安装版本更新冒烟或用户可见的 GUI 证据。

当前 Windows checkout 已通过桌面脚本测试(47 项)、桌面前端测试(58 项)、Tauri Rust 测试(5 项)、桌面发布 workflow 结构测试、命名的双语配对检查和 Agent Note 格式校验。`pnpm run doc-sync` 已通过全部 28 项门禁,包括文档构建。

发布产品仍仅支持 Windows x64。Linux 与 macOS 需完成原生运行时、Rust/Tauri 壳子、目标配置、发布工作流、updater、安装、更新、卸载和打包 GUI 证据，并满足下方验收标准后，才能声明受支持。

## PR 划分

按以下依赖顺序保持改动可评审：

1. 目标规格与脚本测试；
2. 可移植 sidecar 获取；
3. 目标独立运行时烘焙与原生文件校验；
4. Rust 平台隔离与原生检查；
5. 目标感知 Tauri 配置、bundle 命令与体积报告；
6. Linux 发布 job、安装 smoke、updater 条目、文档与 GUI 证据；
7. macOS 构建与未签名本地 smoke；
8. macOS 签名、公证、updater 条目、安装版更新 smoke、文档与 GUI 证据。

若采用 stacked PR，须使用仓库正式 stacked-PR 工作流。缺陷在引入相应机制的 PR 中修正后再向上传播。在本预发布仓库中，后续 PR 不得为较早分支携带兼容 shim。

## Acceptance criteria

只有 tag-gated 工作流能从已校验标签产出带版本号的 x64 AppImage 与 deb；校验其原生运行时和体积；在声明基线上安装并启动；到达 readiness；打开终端会话；退出后无残留运行时；验证更新与卸载数据保留；发布正确 updater 元数据；并携带当前双语文档和真实安装版 GUI 证据，Linux 支持才完成。

只有 arm64 同样满足上述性质，且发布 app 经 Developer ID 签名、公证、在适用处 staple、通过 Gatekeeper 校验并出现在已验证 updater 签名中，macOS 支持才完成。CI 生成的未签名 `.app` 只能证明编译，必须保持实验状态。

只有 Windows x64、Linux x64 与 macOS arm64 从同一已校验标签构建且不共享原生运行时字节；每个 release 包含 hash 和精确预期制品集；updater 选择正确已签名制品；支持文档与发布资产一致；聚焦脚本／Rust／workflow 测试通过；目标原生 packaged smoke 通过；`pnpm run doc-sync` 通过；双语 pairing record 为最新；且 Windows 安装程序、Explorer 集成、贴靠布局和更新流程保留既有证据，多平台阶段才完成。

## Alternatives considered

**在同一个 release 中同时发布 Linux 与 macOS。** 不采用，因为 macOS 新增的签名、公证、app bundle 与 updater 信任链不能验证 Linux 机制。Linux 可先完整证明目标选择、POSIX sidecar、原生运行时烘焙、非 NSIS bundle 和目标原生发布 matrix，再把凭据纳入失败空间。

**从 Windows 交叉构建全部制品。** 不采用，因为 `pnpm deploy`、`node-pty`、`koffi`、WebKitGTK、macOS framework、package installer 和平台签名会消费目标原生工具或字节。交叉编译可以检查可移植源码，但不能证明安装后的运行时。

**POSIX 使用环境 Node，不携带 sidecar。** 不采用，因为这会使 Linux 与 macOS 制品依赖外部未固定版本的运行时，而 Windows 继续保持自包含。产品要求每个受支持平台都具有同一版本策略、可离线启动的运行时。

**发布未签名 macOS 构建，并提供绕过 Gatekeeper 的安装说明。** 不采用，因为绕过说明会把发布信任决策转嫁给用户，且不能提供安全 updater 路径。未签名构建只保留为编译证据。

## Risks

- 原生依赖不能在声明基线上构建或运行时，停止该平台。不得静默关闭功能、以伪实现替换终端或发布残缺制品；应修复所属能力，或通过已记录产品决策调整支持基线。
- Linux AppImage 可移植性受 glibc、WebKitGTK、FUSE 和原生 addon 链接约束。仅在 hosted runner 上成功不能证明最低发行版支持。
- 没有产品所有的 Apple 凭据与 updater 签名 secret 时，macOS 发布受阻。智能体可以实现并测试未签名构建路径，但不得宣称已支持，也不得自行发明凭据处理。
- Tauri 配置或 updater 改动导致 Windows 回归时，停止该阶段。多平台支持增加目标策略，不以最低共同功能替换既有平台专属行为。
- bundle 回退到环境 Node、加载其他目标的原生字节、遗漏 updater 校验或卸载时删除用户数据，均为发布阻断项。
