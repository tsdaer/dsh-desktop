# Agent Note: 桌面端 Worktree Explorer

Status: implemented

[English](2026-08-19-desktop-worktree-explorer.md) | 中文

## 问题

桌面 Worktree 模式需要只读的工程视图，但不能允许浏览器输入选择不受限制的文件系统根目录或命令。现有 Workspace 注册表拥有规范化工程目录，现有文件系统提供方拥有路径解析、目录元数据和包含关系检查。

## 决策

桌面 bridge 暴露 `GET /dsh-bridge/worktree/explorer`，请求只有两个字段：已注册的 `workspaceId` 和 Workspace-relative `path`。Host 从 `ctx.workspaceRegistry` 解析 Workspace 路径，通过 `ctx.fs` 解析请求目录，并拒绝缺失目录、非目录、权限错误以及解析后越出规范化 Workspace 根目录的目标。响应只包含相对条目路径；解析后越出根目录的子项会显示为不可展开的阻止条目，不会暴露其目标路径。

Host 在读取 Workspace 外部元数据前拒绝绝对路径、盘符相对路径、反斜杠分隔路径和越界路径。它先排列目录再排列文件，并施加可配置的条目数、UTF-8 JSON 字节数和耗时上限，同时明确报告投影截断。HTTP 请求中止会取消文件系统操作。bridge 配置拥有正的安全整数上限，默认值为 256 个条目、131072 字节响应和 5000 毫秒。

桌面 client 通过 desktop footer slot 贡献 Workbench，并把它 portal 到现有的 `sidebar.workspaces` 区域；只有选中 Worktree 标签时才隐藏共享 Workspace 浏览器，Workspace 标签下保持其不变。client 从当前 Session 推导要查看的 Workspace；没有选中 Session 时使用最近的 Workspace，最后回退到第一个 Workspace。进入 Worktree 时加载根目录，只有展开目录时才加载子目录。每个目录都有独立的加载、错误、重试、空目录和截断状态；展开的相对路径按 Workspace id 保存到浏览器存储。client 在渲染前校验响应，不调用 shell 命令或不受限制的文件系统 API。

收起侧栏中的模式切换使用风格统一的内联矢量图标。目录行的整个宽度都是可访问按钮；目录图标通过行的 `aria-expanded` 值表示状态，不是独立的交互目标。Explorer 将展开后的目录压平成可见行，并使用可复用的固定行高 `DesktopVirtualList`，在保留完整滚动范围的同时限制大型树实际创建的 DOM 行数。

工作区内的文件和目录使用内部指针拖拽协议。浏览器只派发经过规范化的 Workspace-relative path；反斜杠、绝对路径、盘符相对路径、NUL 字节、规范化为空的路径以及越出 Workspace 的路径都会被拒绝。条目拖到 composer 后插入不带前导 `./` 的规范化路径，指针经过 composer 时显示可见焦点框。越出 Workspace 的阻止条目和其他条目类型不会启动指针拖拽。现有由 shell 所有的 external filesystem path 拖放保持不变。

Explorer 行使用共享 `ui-primitives` 的文件夹、文件和警告图标。目录图标在收起和展开状态之间切换，同时保持一个固定的图标框；阻止和不支持的条目使用警告图标，并通过本地化行标签暴露状态。

文件查看器把 Markdown 系列文件投影为 Markdown，把其他文本文件投影为可防止分隔符冲突的 fenced code 输入。Markdown 复用共享的 `MarkdownText` 渲染器及其清理策略，代码复用现有的 Shiki 行渲染器，因此桌面 client 不增加第二套 Markdown 依赖或清理策略。未知扩展名在投影中使用纯文本 fence，并以不高亮的代码显示。

在 Tauri shell 中，Explorer 和 Search 会把规范化的 Workspace-relative file request 发送给 native preview-window command。shell 会再次校验 Workspace id 和 path，根据两者生成带 hash 的 `preview-*` label，并先把对应窗口的创建或聚焦交给 Tauri 异步运行时，再由该任务进入主 UI 循环。发起调用的 WebView IPC 会在动态 WebView 创建前返回，因此原生窗口设置不会阻塞自身导航。每个新 WebView 会携带进程启动 token、`dsh_preview=1`、`workspaceId` 和 `path` 加载认证根路径；Host 用该 token 换取窗口的签名 cookie，再跳转到不带启动 token 的同一预览 query。另一套每次启动的 bridge bearer token 通过受限 command 返回，始终不进入预览 URL。新窗口在原生创建成功后立即显示并获取焦点，并在首次页面加载完成后再次获取焦点。预览读取可取消且有明确超时，超时会转为窗口内错误。没有 Tauri 时的浏览器运行继续使用现有的 pane 内查看器作为回退。

桌面 client 会捕获链接激活，只把当前 bridge origin 和 bridge path 之外、绝对且不带凭据的 HTTP(S) URL 交给 shell opener；不安全或内部 URL 会被阻止。Tauri 通过 opener command 打开获准 URL；浏览器运行使用新标签页。WSL 安装指南也使用同一 helper。

桌面右键菜单是一个带幂等 disposer 的 body portal 状态。它把当前 Lexical composer 与普通输入框、可读取选区分开分类，只为可编辑 composer 暴露修改操作，在关闭后恢复焦点，按 visual viewport 限制位置，并在操作、Escape、外部指针按下、滚轮、滚动、尺寸变化、失焦、导航或插件释放时关闭。composer 粘贴重新进入 Lexical 粘贴管道；复制和剪切使用浏览器选区及编辑命令，不直接写入编辑器状态。

## 曾考虑的替代方案

**向浏览器暴露 Workspace 绝对路径**：否决。浏览器只需要相对显示路径，Host 保留规范化解析和包含关系检查的权限。

**使用通用 shell 或文件系统端点**：否决。固定的 Workspace Explorer 字段将命令和根目录排除在浏览器控制输入之外，并使请求上限可审计。

**Worktree 打开时加载完整目录树**：否决。懒加载目录请求可以限制大型仓库，并允许取消失效的展开操作。

## 后果

Explorer 保持只读，不暴露文件内容。Git 状态以文件和目录装饰显示在同一棵树中，Search 仍位于 Worktree 工具栏模式中。拖拽 Worktree 条目只传递相对显示路径，不读取文件，也不会向聊天框授予绝对路径。底层文件系统提供方可能在 bridge 应用响应上限前完整枚举一个目录，因此提供方原生的有界列表仍是后续能力改进。解析后越出 Workspace 的 symlink 或 junction 子项仍作为阻止条目显示，使拒绝行为可见，同时 UI 不会跟随它们。虚拟列表要求行高固定；可变行高消费者需要另外的测量策略。

## 测试

桌面 Explorer 测试固定相对路径校验、盘符相对路径及越界路径在读取外部元数据前被拒绝、目录优先排序、条目截断和根目录外投影。渲染 client 测试覆盖空快照后出现首个 Workspace、同级目录同时加载，以及共享文件夹、文件和警告图标状态。虚拟列表测试固定空集合、预渲染范围和末尾滚动位置截断。standalone desktop bridge 构建会编译 Host 与 Client 包，并打包 Explorer 路由与 UI。focused client tests 会验证规范化的指针拖放路径、绝对路径、盘符相对路径和反斜杠拒绝，以及装饰汇总。

预览投影测试固定 Markdown 透传、文件名标题、已识别语言提示、防冲突 fence 和纯文本回退；文件查看器测试固定经过清理的 Markdown 渲染，同时保留已有的高亮代码和搜索结果行滚动行为。

预览窗口测试固定提前路径校验、规范化 request 参数、locale 传递、Tauri 不可用时的回退、native command 失败时的回退、Rust 路径拒绝，以及 Workspace 加 path 的 label 作用域。desktop shell 构建检查 Tauri 窗口与 command 注册，Web 构建同时检查最小预览 entry 和普通 Web entry。

外链测试固定 URL allowlist、凭据和 bridge URL 拒绝、native opener 调用以及浏览器点击处理。Rust 测试固定在调用平台 opener 前拒绝带凭据、loopback 和 bridge URL。

右键菜单测试固定 Lexical composer 分类、只读操作过滤、剪贴板派发、native cut 处理、单菜单替换、焦点恢复、viewport 限制、Escape、滚轮和外部指针关闭。
