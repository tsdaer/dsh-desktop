# Agent Note: 0.3 之后的桌面端开发计划

Status: proposed

[English](2026-08-21-desktop-post-0.3-plan.md) | 中文

## Problem

桌面版已发布 `v0.3.0` 到 `v0.3.4`，而[0.3 提案](2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md)仍持有一条未完成的尾巴：P5 冒烟矩阵、它所要求的 GUI 证据，以及普通消息复制审计。之后做什么、以什么顺序做、每项做到什么算完，都没有任何文档说明。

因此，接手桌面端工作的 agent 每次都要从源码重新推导待办清单，而且推导得并不一致：只读的源代码管理视图、缺失的文件查看器、仅限 Windows 的打包，以及无边框标题栏的几处缺口，都只能靠读代码或 README 散文才能发现。顺序恰恰是源码完全无法回答的部分 —— 有几项在证据工具就绪后很便宜，在那之前很贵。

环境让问题更严重。为桌面端专属插件产出 GUI 证据，需要一套没有任何现成命令能搭出的组合；[`apps/desktop/docs/operating-constraints.md`](../../../../apps/desktop/docs/operating-constraints.md) 断言了一种进程拓扑，而当应用从安装位置运行时该断言为假；本地打包构建在缺少签名密钥时无法完成。以上每一项都要花掉一个会话去重新发现，并把 agent 推向过度谨慎或错误假设中的一种。

## Proposal

七个有序阶段。每个阶段都可独立评审、说明何为完成，并指明评审者可核查的证据。0.3 的尾巴仍归它自己的记录所有；本记录只确定它在顺序中的位置。阶段 2 排在所有产品阶段之前，因为正是它让那些阶段的证据变得可获取。

阶段 3 到 7 相互独立，可按产品理由重排。阶段 2 对它们中的任何一个都不是可选项。

### 阶段顺序

| 阶段 | 主题 | 依赖 |
|---|---|---|
| 1 | 收尾 0.3 | — |
| 2 | 可复现的证据环境 | — |
| 3 | 源代码管理写操作 | 2 |
| 4 | 应用内文件查看 | 2 |
| 5 | 原生窗口装饰与 loopback 姿态 | 2 |
| 6 | 第二个平台 | 2，以及完整的 harness Linux 支持 |
| 7 | 休眠能力的体积决策 | — |

### 阶段 1：收尾 0.3

验收标准归[0.3 提案](2026-08-17-desktop-0.3-worktree-and-runtime-chrome.md)所有，此处不重述。有两个事实属于顺序问题。已发布的 `v0.3.4` 安装包就是冒烟所针对的产物，因此无需本地打包构建。资源管理器右键菜单键由卸载钩子移除，而该钩子的端到端行为尚未验证：安装同一 identifier 的打包版本会顶掉已有安装，因此卸载冒烟需要一台并非正在服务被测会话的机器。

### 阶段 2：可复现的证据环境

桌面 Workbench 通过共享侧边栏 slot 挂载，并经 HTTP 读取桥接 Host，因此浏览器必须加载的组合是：一个 scratch `DSH_HOME`、按壳子方式装进 profile 的桥接包、并入 profile patch 层的桥接行，以及至少一个已注册的 Workspace。手工搭建这套组合正是当前的成本。

新增 `apps/desktop/scripts/evidence-server.mjs`：一条命令完成创建 scratch home、先启动一次以生成 profile 及其修复过的模块回退、把 `bridge` 与 `bridge-client` 装进 `profiles/node_modules/@deepseek-ai/`、把 `bridge/cordis.patch.yml` 并入 profile 的 `cordis.patch.yml`、注册一个 Workspace、以固定端口服务并打印就绪 URL。不要碰 `@deepseek-ai/schemastery`：profile 回退以符号链接形式拥有该路径，在那里放真实目录会导致启动失败。

同一阶段修正 `operating-constraints.md`。它必须告诉 agent 如何判定哪个运行时是活的 —— 检查运行中进程的可执行文件路径及其派生的 Node 命令行 —— 而不是断言服务中的运行时是由工作目录构建的。两种拓扑都会出现，且只有实测能区分。

阶段 2 已完成：证据命令会构建独立桥接包、创建临时 profile、注册所选 Workspace、探测 `/dsh-bridge/config` 并打印服务 URL。真实浏览器运行已挂载 Worktree 面板；已交付决策记录在[已实现的证据服务器记录](../../implemented/feature/2026-08-21-desktop-evidence-server.md)中。

### 阶段 3：源代码管理写操作

阶段 3 已完成：桥通过同一个有界 Host 适配器提供暂存、取消暂存、丢弃、带消息提交以及查看单文件 diff；该适配器持有固定 Git argv、环境、输出上限、取消与规范根校验。浏览器只发送 Workspace id 与 Workspace 相对路径，绝不发送 argv。已交付决策及聚焦验证记录在[已实现的源代码管理写操作记录](../../implemented/feature/2026-08-21-desktop-source-control-actions.md)中。

只做整文件操作。按 hunk 与按行暂存需要 Host 目前不具备的 diff 模型，属于后续阶段。丢弃与取消暂存具有破坏性，因此各自需要一次点名文件的显式确认，且对状态解析未能归类的条目一律不提供。diff 查看复用既有的 diff 呈现，而不新增第二个渲染器。Git worktree 检出管理不在范围内；0.3 提案已记录它为何需要独立设计。

### 阶段 4：应用内文件查看

Explorer 与搜索能定位文件，却无法展示它。为根内文件新增只读查看器：有界字节并带显式截断状态、对二进制与非 UTF-8 内容做检测并拒绝渲染、通过 client 既有高亮器高亮。打开搜索结果时滚动到命中行。

已完成：桥的 `GET /worktree/file` 路由提供严格 UTF-8 内容并带截断与二进制拒绝，`DesktopWorkspaceFileViewer` 渲染 Explorer 与 Search 打开并滚动到匹配行，已交付行为记录在[已实现的文件查看器记录](../../implemented/feature/2026-08-22-desktop-file-viewer.md)中。

编辑属于独立阶段。它需要保存冲突检测、编码与行尾策略，以及撤销模型，而查看器都不需要。

### 阶段 5：原生窗口装饰与 loopback 姿态

三处无边框窗口缺口是已知且用户可见的：没有 Windows 11 贴靠布局浮出、缩放边框沿用 tao 的默认命中测试、最大化图标依赖点击与 resize 事件而非窗口状态同步。作为一次装饰整改一并修掉，状态从窗口读取而非由输入推断。

另有一项：运行时以 loopback 无认证方式服务，任何本地进程都可访问。桌面壳子是唯一知道端口的客户端，因此可以持有一个按启动生成的 token。这会改动上游所有的 `dsh web`：需要独立的 harness 需求、[分歧登记表](../../../../docs/fork-divergence.md)中的一行，以及在未配置 token 时完全保持纯浏览器姿态不变的设计。

装饰整改已完成：主窗口重新加回 `WS_THICKFRAME`(不加 `WS_CAPTION`),由操作系统提供缩放边框与 Windows 11 贴靠布局浮出,原生宿主在每次尺寸事件时推送 `dsh://maximize-change`,标题栏图标跟随窗口状态([已实现记录](../../implemented/feature/2026-08-22-desktop-native-window-chrome.md))。loopback token 已完成:壳子生成按启动 token,以 `DSH_WEB_TOKEN` 与导航查询参数传递;webserver 的可选 `token` 配置在已注册路由与 upgrade 上强制校验,静态 dist 保持开放;connection 客户端与桥接客户端都附加该 token([已实现记录](../../implemented/feature/2026-08-22-desktop-loopback-token.md),[分歧登记表](../../../../docs/fork-divergence.md))。

### 阶段 6：第二个平台

先 Linux 后 macOS，因为 macOS 还要加签名与公证。四个阻塞点是具体的：Node sidecar 拉取仅限 Windows、本依赖树中 `node-pty` 缺少 Linux 预构建、bundle target 仅 NSIS、发布工作流只跑 `windows-latest`。把该阶段视为受控启动：等 harness 自身的 Linux 支持完整到只剩桌面壳子这一处缺口时再开始，不要更早。

### 阶段 7：休眠能力的体积决策

烤制运行时携带约 60 MB 有意挂载、默认禁用的能力。决定桌面负载是否携带它，并连同理由记录该决策（无论结论如何）；测量数据在[体积分析](../../../../apps/desktop/docs/size-analysis.md)中。这是产品决策，agent 不独自定夺。

决策（2026-08-22，产品）：**保留**。休眠字节是可选多 provider 与显式遥测能力的合法产品面，默认不激活；裁剪将交付 DeepSeek-only 桌面版并带来新的 bundle profile 与维护成本。已记录在体积分析中。

### agent 不必重新发现的环境事实

- 打包安装的桌面版从其安装目录运行自带的烤制运行时。当它是活的 GUI 时，仓库构建产物并未被它占用，`pnpm run build` 是安全的。无论倾向哪一边，先实测。
- `scripts/ci-workflow.spec.ts` 在此处失败，因为本 fork 不携带任何继承工作流。[分歧登记表](../../../../docs/fork-divergence.md)已将其记录为预期；绝不要通过恢复上游自动化来消除它。
- 重新进入 pnpm 一律经 `scripts/package-manager.ts`；独立安装的 pnpm 会暴露原生 `npm_execpath`（[note](../../implemented/bug-fix/2026-08-21-nested-pnpm-native-entrypoint.md)）。
- `createUpdaterArtifacts` 已启用，因此本地 `tauri build` 在无签名密钥时失败。标签门控工作流持有真实密钥；冒烟请使用它发布的安装包，而不要在本地复刻签名。
- 录制 GUI 证据遵循 [record-browser-gif](../../../skills/record-browser-gif/SKILL.md)。其编码器同时需要 `ffmpeg` 与 `ffprobe`，且某个 Playwright 版本可能与机器上已有的浏览器修订号不匹配，因此应显式传入 `executablePath`，而不是再装一个浏览器。
- 版本升级只改 `apps/desktop/package.json` 一处；`pnpm --filter @deepseek-ai/dsh-desktop version-check` 校验传播后的各来源是否一致。

### 每个阶段都适用的固定约束

桌面 UI 与 Host 集成保持在 `apps/desktop` 下。改动上游所有的路径需要独立的 harness 需求，以及[分歧登记表](../../../../docs/fork-divergence.md)中带原因的一行。每项用户可见改动都携带聚焦单测、Host 集成证据，以及一段从真实应用录制的 GIF；能力 seam 的 Service Definition、Provider、Consumer 与生命周期测试一并交付。

## Alternatives considered

- **把本计划放进桌面 README。** 已否决，因为 README 面向用户陈述当前能力，而带原因与验收标准的阶段计划正是 Agent Note 的职责。README 的路线图列表继续作为简短的用户视角。
- **扩展 0.3 提案以覆盖后续阶段。** 已否决，因为那份记录的状态跟踪的是一个尾巴仍未完成的版本；把未来阶段折进去会让它无限期停留在 proposed，并模糊 0.3 究竟还剩什么。
- **按用户价值排序，先做源代码管理写操作。** 已否决，因为每个产品阶段都需要 GUI 证据，在没有阶段 2 的情况下产出证据会让同一套手工搭建在每个阶段重复一遍，同时使每次录制更难复现。
- **把 Git worktree 检出管理并入阶段 3。** 依 0.3 提案既有理由否决：创建与切换检出属于破坏性的项目变更，需要分支、脏状态、冲突与清理策略，而整文件暂存并不需要。
- **把文件编辑并入阶段 4。** 已否决，因为查看器本身已完整可用，而编辑需要冲突、编码与撤销策略，会拖慢它。
- **只要能编译就发 Linux 版。** 已否决，因为无法打开终端会话的构建不是可用的版本；决定该阶段的是 `node-pty` 与 sidecar 缺口，而非 Rust target。

## Acceptance criteria

- 阶段 2 以两件事收尾：一条有文档的命令打印出服务 URL，其 `/dsh-bridge/config` 有响应且 Worktree 面板能在浏览器中挂载；以及 `operating-constraints.md` 改为描述如何实测活的运行时，而不再断言单一拓扑。
- 阶段 3 以以下状态收尾：暂存、取消暂存、丢弃、提交与 diff 查看均限定在所选 Workspace 内，每个破坏性操作都以点名方式确认，未归类条目不提供任何变更操作，且覆盖取消与重连。
- 阶段 4 以只读查看器收尾：限制字节、声明截断、拒绝二进制与非 UTF-8 内容，并把搜索结果滚动到命中行。
- 阶段 5 以贴靠布局、缩放边框与最大化状态均由窗口状态驱动收尾，并且 loopback token 在未配置时保持今日行为。
- 阶段 6 以一个可安装的第二平台产物收尾：它能到达就绪行并打开终端会话，且由同一条标签门控工作流产出。
- 阶段 7 以一条已记录的决策及其理由收尾，并有与之相符的体积测量。
- 每个阶段结束时 `pnpm run doc-sync` 为绿、双语对已记录，且其用户可见行为已由一段来自真实应用的 GIF 证明。

## Risks

阶段 2 是价值间接的基础设施，因此在时间压力下最容易被跳过；跳过它只是把成本移进后续每个阶段，而不是消除它。阶段 3 在桌面 client 中引入首批破坏性 Git 操作，一个错误路径或一份过期状态就会把失误变成数据丢失 —— 确认文案与"对未归类条目拒绝变更"是发布要求，而非打磨项。阶段 5 的 loopback token 触碰上游所有的服务器，若未原样保留未配置路径，会回退纯浏览器姿态。阶段 6 体量最大且最容易过早开始；一个半支持的平台在 issue 上的花费高于它带来的回报。阶段 7 可以无害地无限期推迟，而这本身就是风险：在决策被记录之前，预留负载的代价由每一次下载持续支付。
