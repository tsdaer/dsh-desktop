# 桌面工作树预览与交互开发计划

[English](desktop-worktree-preview-interaction-plan.md) | 中文

Status: proposed

## Summary

本计划指导智能体实现四项相关的桌面端改进：消除歧义的工作树路径插入、跟随主题的资源管理器条目图标、独立的只读文本预览窗口，以及可靠的右键菜单与外部链接行为。计划保留桌面 bridge 已执行的 Host 所有 Workspace 包含关系和有界文件读取规则。工作拆分为可独立审查的切片，并明确源码归属、失败行为、测试与 GUI 证据。需求中的“非二进制文件就不用打开了”按“二进制文件不打开”理解；实施智能体必须在开始预览切片前确认这项解释。

## Table of Contents

- [当前基线](#current-baseline)
- [要求的行为](#required-behavior)
- [架构与归属](#architecture-and-ownership)
- [交付计划](#delivery-plan)
- [验证矩阵](#verification-matrix)
- [验收标准](#acceptance-criteria)
- [风险与待决事项](#risks-and-decisions)
- [智能体交接清单](#agent-handoff-checklist)
- [Dev Note](#dev-note)

-----

<a id="current-baseline"></a>

## 当前基线

实施智能体必须在编辑前根据自己的 checkout 重新核对这些事实。它们描述的是 2026-08-29 检查到的分支，不能替代阅读归属文件。

- `apps/desktop/bridge-client/src/client/DesktopWorkspacePathDrop.ts` 校验 Workspace 相对路径，并在插入输入框前将其格式化为 `./<path>`。
- `apps/desktop/bridge-client/src/client/DesktopWorkspaceExplorer.tsx` 使用 `▸` 或 `▾` 表示目录、使用 `·` 表示文件，并在工作树面板内的 `DesktopWorkspaceFileViewer` 浮层中打开文件。
- `apps/desktop/bridge/src/file.ts` 已经通过 Host 解析已注册 Workspace 与相对路径，拒绝越界和非普通目标，执行字节上限，把包含 NUL 或无效 UTF-8 的内容作为 `binary-file` 拒绝，并报告截断。
- `apps/desktop/bridge-client/src/client/DesktopContextMenu.ts`、`DesktopContextMenuPortal.ts` 与 `index.ts` 实现目标分类、剪贴板操作、body portal 和全局开关监听器，但其测试尚未覆盖全部指针、焦点、选区、contenteditable、导航和剪贴板失败场景。
- 共享聊天 Markdown 会生成带 `target="_blank"` 的已清理 HTTP(S) 锚点，但桌面壳尚未拥有完整的“点击后交给原生打开器”的路径。

现有已实施决策继续作为权威来源：[桌面工作树资源管理器](../.agents/notes/implemented/feature/2026-08-19-desktop-worktree-explorer.zh.md)拥有 Workspace 相对列表与拖动安全规则，[桌面应用内文件查看器](../.agents/notes/implemented/feature/2026-08-22-desktop-file-viewer.zh.md)拥有有界文本读取与二进制拒绝规则。实现必须更新或取代这些 Agent Note，不能静默与其冲突。

-----

<a id="required-behavior"></a>

## 要求的行为

### 路径插入

把 Workspace 内的工作树文件或目录拖入输入框时，插入不带前导 `./` 的规范化 Workspace 根相对路径，例如 `apps/desktop/README.md`。浏览器继续拒绝绝对路径、盘符相对路径、反斜杠、空路径、规范化后为空的 `.` 段以及 `..` 越界。操作系统拖入的文件或目录继续使用真实绝对文件系统路径，因为它可能不属于任何已注册 Workspace；该改动不得让外部拖入经过工作树格式化器。

输入框保留现有光标位置、撤销语义、多行插入与拖入焦点环。测试和文档必须一致使用“Workspace 相对路径”与“外部文件系统路径”，使智能体可以判断每个路径相对的根。

### 资源管理器条目图标

每个目录行使用一个文件夹字形，其视觉状态在关闭与打开之间变化。每个普通文件行使用文件字形，不再使用标点。Workspace 外或不支持的条目保留独立警告字形，且不得看起来像可以打开的文件。

共享图标系统中存在匹配字形时，图标必须来自仓库自有共享图标系统。如果图标集缺少关闭文件夹、打开文件夹、文件或警告字形，应把中性主题 SVG 字形加入归属 primitive 包，再由桌面 bridge client 使用；不得在每一行粘贴独立 inline SVG。描边和填充使用 `currentColor`，固定布局盒避免行移动，通过 `aria-expanded` 和可访问行标签表达状态而不是依赖仅图标标签，并验证浅色、深色、悬停、选中、禁用、高对比度及与 Git 装饰组合的状态。

### 独立文件预览窗口

从资源管理器或搜索结果激活 Workspace 内普通文件时，打开或聚焦独立 Tauri Webview 窗口，不再在工作树面板中插入浮层。窗口以 Workspace id 加规范化相对路径为键，因此重复激活不会无控制地创建重复窗口。标题包含文件名；主体显示 Workspace 相对路径、截断或拒绝状态、复制操作和只读渲染内容。关闭预览不关闭主窗口，也不改变当前 Session。

预览窗口只能通过现有已认证桌面 bridge 文件路由请求内容。Host 继续负责规范根包含关系、文件类型检查、字节上限、取消、二进制检测、严格 UTF-8 解码和稳定错误。窗口标签、查询字段与事件只携带 Workspace id 和规范化相对路径；不得携带不受限制的绝对路径、原始 HTML、日志中的 bearer token 或用户可控 shell 命令。

Markdown 系列文件按 Markdown 渲染。其他可识别文本及编程语言文件转换成带扩展名语言提示的 Markdown fenced code block。包装器必须选择比源码中同类分隔符连续段更长的 fence，避免文件内容提前结束生成的代码块。未知文本使用纯文本 fence。二进制或无效 UTF-8 文件不进入内容渲染器；发起视图显示本地化拒绝消息，或者新建的预览窗口显示相同稳定拒绝状态并可安全关闭。实现必须在编写窗口生命周期代码前选择一种行为并用测试固定。

把 Vditor 作为静态渲染器评估，而不是编辑器。其文档中的 `Vditor.preview(element, markdown, options)` API 支持静态 Markdown、代码高亮、行号、清理和浅深模式；项目文档还公开 `preview.markdown.sanitize`、`preview.hljs` 和主题控制（[Vditor 仓库与 API](https://github.com/Vanessa219/vditor)、[预览选项](https://ld246.com/article/1549638745630#options-preview-markdown)）。如果采用，桌面应用必须打包固定依赖版本及全部所需 CSS／资源，配置本地资源根而不是默认公共 CDN，保持清理开启，关闭编辑、缓存、上传、朗读、媒体嵌入与不需要的图表引擎，在窗口销毁时销毁渲染器，并让渲染后的链接经过桌面链接策略。不得引入依赖网络的预览行为。

增加 Vditor 前，应把它与现有 `MarkdownText` 和 Shiki primitive 在 bundle 大小、离线完整性、主题一致性、CSP 要求、清理、相对图片行为、行号支持和维护成本方面比较。把选择记录在 feature Agent Note 中。如果现有渲染器以更少自有代码且不损失语义满足验收标准，则优先使用现有渲染器；用户把 Vditor 作为可用选项提出，并非强制依赖。

### 右键菜单与链接

把右键菜单视为最多存在一个活动菜单的显式状态机。打开第二个菜单会关闭第一个。执行操作、Escape、外部指针按下、滚轮或滚动、窗口尺寸变化、visual viewport 尺寸变化、失焦、路由或 Session 导航以及插件释放都会恰好关闭一次，并在适用时恢复焦点。在菜单内点击右键不会递归替换菜单。定位使用 visual viewport，在挂载后计入菜单尺寸，并在四个边缘执行翻转或限制。

目标分类必须区分输入框、普通可编辑控件、密码或敏感控件、可读取选区、链接与不可操作内容。输入框剪切、复制与粘贴必须使用当前 Lexical／contenteditable 集成，不能假设 textarea。禁用或只读控件不可被修改。剪贴板拒绝时内容保持不变，并给出本地化非阻塞失败提示。键盘导航支持上、下、Home、End、Enter、Space、Tab 策略与 Escape，关闭后不得困住焦点。

桌面 bridge client 负责委托处理聊天与预览内容中的安全 `http:` 和 `https:` 锚点点击。它阻止 WebView 导航，再次校验解析后的 URL 与协议，并调用由平台打开器支持的窄 Tauri 命令。拒绝 `javascript:`、`data:`、`file:`、带凭据 URL、畸形 URL和内部 bridge URL。打开器命令只接收已校验 URL 字符串，拥有显式 Tauri capability，返回类型化失败，且绝不调用 shell。修饰键点击与键盘激活遵循一项已记录策略；测试必须防止锚点默认行为与委托处理造成重复打开。

-----

<a id="architecture-and-ownership"></a>

## 架构与归属

除非可复用图标或渲染器修正属于 `packages/client/ui-primitives`，否则把改动留在桌面插件中。不得修改 `agent-loop`、Session 事件、Workspace 持久化或不受限制的文件系统 API。

| 事项 | 主要归属 | 预期改动 |
|---|---|---|
| 工作树路径文本 | `apps/desktop/bridge-client/src/client/DesktopWorkspacePathDrop.ts` | 返回不带 `./` 的规范相对文本；保留拒绝规则。 |
| 输入框拖入生命周期 | `apps/desktop/bridge-client/src/client/index.ts` 与 `DesktopComposerPaste.ts` | 保持内部拖入和 OS 拖入分离、焦点环、光标与撤销。 |
| 条目字形 | `DesktopWorkspaceExplorer.tsx`、其 CSS module，并可选 `packages/client/ui-primitives` | 用共享有状态图标替换标点，并实现主题样式。 |
| 文件字节与错误 | `apps/desktop/bridge/src/file.ts` | 复用路由；仅在窗口生命周期揭示缺少有界响应字段时修改。 |
| 预览编排 | 新 bridge-client 预览控制器与预览窗口入口组件 | 校验请求、窗口去重、同步主题与 locale、取消读取并清理。 |
| 原生窗口与 URL 打开 | `apps/desktop/src-tauri/src/` 加 Tauri capabilities | 创建或聚焦受约束预览窗口，并以无 shell 方式打开白名单外部 URL。 |
| 右键菜单 | `DesktopContextMenu.ts`、`DesktopContextMenuPortal.ts` 与 `index.ts` | 集中管理状态、分类、焦点、定位、关闭与失败。 |
| 产品文案 | `apps/desktop/bridge-client/src/client/locales.ts` | 增加类型化中英文标签；客户端 UI 不得硬编码文案。 |
| 持久理由 | 现有或新 `.agents/notes/` 双语说明 | 记录渲染器、窗口标识、打开器安全和被拒绝方案。 |

预览窗口应加载专用本地前端入口或具有最少依赖的显式应用路由。不得为了显示一个文件挂载完整聊天应用。壳以稳定标签、保守初始尺寸、最小尺寸和普通 OS 装饰创建窗口，除非产品已有共享窗口 chrome 组件；窗口使用与主窗口相同的 origin 与认证设置。必须定义主窗口退出、应用退出、更新重启、Workspace 删除、locale 变化、主题变化、重复打开请求、加载失败和点击之间文件变化的行为。

主题与 locale 同步应尽量使用已有桌面或 client runtime 信号。变化后新开的预览窗口在启动时读取当前值；已经打开的窗口无需重载即可更新。实现不得从任意颜色推断主题，也不得在 Tauri Rust 中复制 locale 字典。

-----

<a id="delivery-plan"></a>

## 交付计划

### 阶段 0——复现并冻结基线

1. 运行覆盖资源管理器拖入格式化、资源管理器渲染、文件查看、输入框插入和右键菜单的聚焦 desktop bridge-client 与 Host 测试。
2. 使用真实桌面 evidence server 复现 `./` 插入、标点图标、页内查看器、每个被报告的右键菜单缺陷和无响应聊天链接。改代码前记录精确步骤、预期行为、实际行为、平台、WebView 版本和截图。
3. 检查活动输入框 DOM 与选区 API。如果实际使用 Lexical／contenteditable，而不是右键菜单 helper 仍假设的 textarea，则更新计划。
4. 测量当前桌面 bundle，再用代表性 Markdown、TypeScript、JSON、长文件、无效 UTF-8 文件、相对图片、不安全 HTML 和外部链接，对 Vditor 静态预览与现有 Markdown primitive 分别制作原型。
5. 确认需求歧义：本计划假定文本可打开、二进制不可打开。如果意图不同，停止预览切片。

### 阶段 1——路径文本与资源管理器图标

1. 修改工作树格式化器，使其只返回规范相对路径，并重命名编码旧 `./` 展示的 helper 或测试。
2. 内部指针事件 payload 继续使用已校验相对路径；只在输入框插入边缘执行格式化，避免未来消费者混淆传输数据与展示文本。
3. 增加或复用关闭文件夹、打开文件夹、文件与警告图标。保持一个图标盒，并使用 `currentColor` 加状态 class 或属性。
4. 更新资源管理器渲染测试，覆盖图标状态、`aria-expanded`、键盘激活、警告条目、主题 class 以及与 Git 装饰共存。
5. 只在行为交付时更新桌面 README 与 changelog 双语对，并重新记录配对。

### 阶段 2——预览渲染器与独立窗口

1. 根据阶段 0 证据编写简短 Agent Note 修订或替代提案，选择 Vditor 静态预览或现有渲染器。
2. 提取纯预览投影函数：路径扩展名到内容模式和语言、Markdown 透传、防碰撞代码 fence 包装、标题推导以及二进制或截断展示。
3. 在浏览器到壳的集成中增加类型化预览打开请求。浏览器校验 Workspace id 与相对路径以便尽早反馈，Host 路由再次校验并拥有最终权威。
4. 增加 Tauri 窗口控制器：推导非敏感确定性窗口标签、聚焦现有匹配窗口、创建缺失窗口，并在销毁或创建失败时释放注册状态。
5. 挂载最小预览组件，通过 `bridgeFetch` 获取内容，在路径变化或 teardown 时取消，忽略过期响应，同步 locale 与主题，渲染加载、空、截断、二进制、权限、缺失和通用失败状态，并提供复制与关闭控件。
6. 仅在资源管理器与搜索均使用窗口控制器后移除资源管理器页内查看器浮层。删除无用状态、CSS 与测试，不保留两条预览路径。
7. 如果选择 Vditor，增加依赖打包、许可证、CSP 或 capability 改动及离线资源验证。在禁用网络时运行 packaged smoke。

### 阶段 3——外部链接

1. 增加一个 URL 解析器和策略，只接收不含嵌入凭据的绝对 HTTP(S) URL。聊天和预览委托点击处理以及 Rust 命令入口均使用该策略。
2. 增加窄原生打开器命令，并为主窗口和预览窗口授予显式 capability。使用 opener API 或进程安全库，绝不构造命令字符串。
3. 在 WebView 导航前拦截安全锚点激活。定义主点击、Enter、Ctrl 或 Command 点击、Shift 点击与中键点击行为，并防止重复打开。
4. OS 打开器拒绝有效 URL 时显示本地化失败反馈。不得回退为应用窗口内导航。
5. 测试普通 Markdown、inline-code URL 转换、工具结果卡片、Vditor 或选定预览渲染器生成的链接，以及不安全协议纯文本。

### 阶段 4——右键菜单修复

1. 把菜单生命周期与关闭原因转换为可测试控制器，不再依赖多个无关 document listener 与共享可变全局量。
2. 更新目标分类以覆盖实际输入框 DOM、嵌套元素、contenteditable 选区、普通输入、只读和禁用控件、密码字段、链接、已选聊天文本及菜单 portal 自身。
3. 通过输入框自有 paste 或 command API 修改内容。保留选区、焦点、撤销、input 事件与 IME composition；不得直接写入过期 DOM 文本。
4. 让剪贴板操作报告成功或类型化失败。增加本地化非阻塞反馈，并确保剪切仅在剪贴板写入成功后移除文本。
5. 使用测量后的菜单尺寸与 visual viewport 定位。增加完整键盘导航和确定性焦点恢复。
6. 为每种关闭原因、重复打开或关闭、事件监听器清理、剪贴板拒绝、空选区、点击目标外选区、滚动容器、缩放 viewport 及与委托链接交互增加测试。

### 阶段 5——集成与证据

1. 运行由出站 diff 选择的聚焦单元、渲染客户端、Host bridge、Rust、打包、i18n、文档与链接检查。
2. 当窗口或打开器代码涉及平台差异时，在 Windows 和至少一个 POSIX 目标运行真实桌面应用。验证浅色与深色主题、纯键盘操作、高 DPI、长路径、非 ASCII 名称、多个预览窗口和离线启动。
3. 因为改动属于产品用户可见 GUI 行为，使用仓库 `record-browser-gif` 工作流从 PR 的真实服务器与模型流程录制必需 GIF。展示工作树拖入、文件夹状态图标、文本预览、二进制拒绝、右键菜单与聊天链接打开，且不得暴露私有路径或凭据。
4. 更新受影响桌面 README 和 changelog 双语对、归属 JSDoc、活动 Agent Note，以及修改上游归属路径时所需的 fork-divergence 行。
5. 发布分支前应用 `dsh-pre-push-checks`。只报告实际运行的命令，不得声称已获得被跳过的平台证据。

-----

<a id="verification-matrix"></a>

## 验证矩阵

| 领域 | 单元或纯函数测试 | 渲染或集成测试 | 原生或打包证据 |
|---|---|---|---|
| 工作树路径 | 规范化、拒绝、无 `./` 前缀 | 内部拖入输入框、多行插入、光标与撤销 | 真实工作树文件和目录拖入；外部绝对路径拖入不变 |
| 资源管理器图标 | 根据类型和展开状态选择图标 | 可访问名称、键盘切换、主题与 Git 装饰 | 浅色、深色、高 DPI、悬停和选中截图 |
| 文件路由 | 包含关系、上限、取消、二进制与 UTF-8 拒绝 | 类型化响应解析与过期请求抑制 | 打包应用只能读取已注册 Workspace |
| 预览投影 | 扩展名映射、Markdown 透传、防碰撞 fence | Markdown 和代码渲染、截断、不安全 HTML 与链接 | 离线打包窗口、重复聚焦、locale 与主题更新 |
| 窗口生命周期 | 确定性非敏感标识 | 打开、聚焦、关闭、失败清理、Workspace 切换 | Windows 加一个 POSIX 目标；应用退出与更新重启 |
| 链接打开 | URL 白名单与凭据拒绝 | 点击和键盘委托、无重复导航 | 默认浏览器收到 HTTP(S)；不安全协议无动作 |
| 右键菜单 | 分类、操作启用、剪贴板失败 | 焦点、viewport 定位、键盘、关闭、清理、Lexical 集成 | 真实聊天、输入框、设置、选区和缩放窗口使用 |
| 本地化与可访问性 | 字典完整性 | role、名称、焦点顺序、对比度 | 屏幕阅读器抽查与 GIF 纯键盘片段 |

运行拥有这些文件的最小命令。最低预期包括针对 `apps/desktop/tests/` 与 `apps/desktop/bridge-client/tests/` 的聚焦 Vitest 命令、桌面 bridge build、新 Tauri 模块的聚焦 Cargo 测试、`pnpm run verify-client-ui-i18n`、双语配对检查、`pnpm run test:docs`、`pnpm run doc-sync`、`git diff --check` 和目标特定 packaged smoke。实施智能体必须根据最终 diff 与仓库 pre-push skill 推导精确筛选器。

-----

<a id="acceptance-criteria"></a>

## 验收标准

1. 工作树条目拖入输入框后产生 `path/from/workspace/root.ext`，绝不产生 `./path/from/workspace/root.ext`；OS 拖入继续产生真实外部路径。
2. 目录显示稳定的关闭和打开文件夹图标，文件显示文件图标，警告条目保持独立，所有字形跟随主题颜色且不发生布局移动。
3. 从资源管理器和搜索激活文件时打开或聚焦独立预览窗口。Markdown 按 Markdown 渲染；支持的源码按高亮代码渲染；未知文本安全渲染；截断可见；二进制与无效 UTF-8 内容绝不进入渲染器。
4. 预览读取保持有界、已认证、限制在 Workspace 内、可取消，且不存在任意绝对路径或 shell 输入。预览可在离线状态下使用打包资源工作。
5. 安全聊天和预览 HTTP(S) 链接恰好一次在操作系统浏览器中打开。不安全、畸形、带凭据、本地文件和 bridge URL 不打开。
6. 自定义右键菜单适用于实际输入框和可读取聊天选区，绝不修改禁用、只读或敏感控件，保持在 visual viewport 内，支持键盘操作，处理剪贴板失败，并清理所有监听器与 portal。
7. 中英文 UI 文案、README 或 changelog 更新、Agent Note、测试、打包 smoke、截图与必需 GUI GIF 均与交付行为一致。

-----

<a id="risks-and-decisions"></a>

## 风险与待决事项

- **需求歧义：**“非二进制文件就不用打开了”与要求的 Markdown 及源码预览冲突。本计划假定其含义为“二进制文件不打开”。阶段 2 前确认。
- **Vditor 资源加载：**Vditor 默认值可能从公共 CDN 加载资源，并启用超出需求的渲染功能。采用时必须自托管资源、关闭未用功能并通过离线 packaged smoke。
- **重复 Markdown 技术栈：**在共享 Markdown 渲染器之外增加 Vditor 会扩大 bundle，并形成两套清理与主题策略。阶段 0 对比是合并前提。
- **不可信内容：**Markdown、文件文本与 URL 均不可信。保持清理开启，阻止原始 HTML 与活动内容，并让外部链接经过一个原生白名单。
- **窗口标识与隐私：**Tauri 标签、遥测或日志中的原始路径可能暴露项目名。推导非敏感标识，只在窗口内容中显示路径。
- **输入框漂移：**现有右键菜单 helper 仍含 textarea 假设，而输入框使用 Lexical／contenteditable 行为。修改必须使用当前输入框自有集成。
- **相对 Markdown 资源：**Markdown 文件可引用相对图片或链接。首版应阻止未解析本地资源，除非另行设计并接受有界资源路由、MIME 白名单、包含规则与 CSP 策略。
- **二进制预检：**Host 报告 `binary-file` 前创建窗口可能短暂出现空窗口。选择并测试“创建前预检”或“显式拒绝状态”之一；不得增加不受限文件类型探测。

-----

<a id="agent-handoff-checklist"></a>

## 智能体交接清单

实施智能体必须按顺序完成此清单，并保持 pull request 可审查。

1. 编辑前阅读根 `AGENTS.md`、`apps/desktop/README.md`、桌面 package manifest、`docs/architecture.md`、`docs/defensive-patterns.md`、上面链接的两个归属 Agent Note 以及每个更具体的指令文件。
2. 检查 `git status` 并保留无关用户改动。记录当前分支与 base。
3. 复现每个缺陷，并把证据附到任务或 pull request。把模糊右键菜单问题转换成点名失败场景。
4. 作出非平凡架构选择前增加或更新 proposed feature Agent Note。保持英文、中文与配对 sidecar 同步。
5. 当阶段 1 至 4 可以独立通过时，以独立 commit 或 stacked pull request 实现。先修复引入问题的分支，再向上传播。
6. 不得为旧 `./` 格式增加兼容行为；仓库处于预发布阶段，应更新每一处引用。
7. 保持模型可见行为不变。这些 UI 改动不创建 Session 事件，也不改变 agent-loop 行为。
8. 运行验证矩阵，完整 diff 分别按正确性与多余 prose 检查两次，并在发布前使用 pre-push skill。
9. 最终 UI 与真实服务器流程稳定后录制真实 GUI GIF，再在无网络条件下验证打包构建。
10. 完成时，把归属 proposed Agent Note 重写为已交付的现在时决策或取代旧 implemented note，并从持久现状文档移除已解决的计划残留。

-----

<a id="dev-note"></a>

## Dev Note

<details>
<summary>活动工作上下文</summary>

Owner：桌面维护者。创建日期：2026-08-29。复审或提升期限：2026-09-29。提升目标：相关桌面 feature／bug-fix Agent Note 及桌面 README 现状章节。验收标准和持久决策移入其归属后删除本计划。

</details>
