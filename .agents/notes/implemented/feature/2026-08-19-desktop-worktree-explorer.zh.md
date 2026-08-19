# Agent Note: 桌面端 Worktree Explorer

Status: implemented

[English](2026-08-19-desktop-worktree-explorer.md) | 中文

## 问题

桌面 Worktree 模式需要只读的工程视图，但不能允许浏览器输入选择不受限制的文件系统根目录或命令。现有 Workspace 注册表拥有规范化工程目录，现有文件系统提供方拥有路径解析、目录元数据和包含关系检查。

## 决策

桌面 bridge 暴露 `GET /dsh-bridge/worktree/explorer`，请求只有两个字段：已注册的 `workspaceId` 和 Workspace-relative `path`。Host 从 `ctx.workspaceRegistry` 解析 Workspace 路径，通过 `ctx.fs` 解析请求目录，并拒绝缺失目录、非目录、权限错误以及解析后越出规范化 Workspace 根目录的目标。响应只包含相对条目路径；解析后越出根目录的子项会显示为不可展开的阻止条目，不会暴露其目标路径。

Host 先排列目录再排列文件，并施加可配置的条目数、UTF-8 JSON 字节数和耗时上限，同时明确报告投影截断。HTTP 请求中止会取消文件系统操作。bridge 配置拥有正的安全整数上限，默认值为 256 个条目、131072 字节响应和 5000 毫秒。

桌面 client 通过 desktop footer slot 贡献 Workbench，并把它 portal 到现有的 `sidebar.workspaces` 区域；只有选中 Worktree 标签时才隐藏共享 Workspace 浏览器，Workspace 标签下保持其不变。client 从当前 Session 推导要查看的 Workspace；没有选中 Session 时使用最近的 Workspace，最后回退到第一个 Workspace。进入 Worktree 时加载根目录，只有展开目录时才加载子目录。每个目录都有独立的加载、错误、重试、空目录和截断状态；展开的相对路径按 Workspace id 保存到浏览器存储。client 在渲染前校验响应，不调用 shell 命令或不受限制的文件系统 API。

收起侧栏中的模式切换使用风格统一的内联矢量图标。目录行的整个宽度都是可访问按钮；箭头只表示当前状态，不再是独立的交互目标。Explorer 将展开后的目录压平成可见行，并使用可复用的固定行高 `DesktopVirtualList`，在保留完整滚动范围的同时限制大型树实际创建的 DOM 行数。

工作区内的文件和目录使用内部指针拖拽协议。浏览器只派发已验证的 Workspace 相对路径；拖到聊天框后插入 `./<相对路径>`，指针经过聊天框时显示可见焦点框。越出 Workspace 的阻止条目和其他条目类型不会启动指针拖拽。现有由 shell 所有的系统文件拖放路径保持不变。

## 曾考虑的替代方案

**向浏览器暴露 Workspace 绝对路径**：否决。浏览器只需要相对显示路径，Host 保留规范化解析和包含关系检查的权限。

**使用通用 shell 或文件系统端点**：否决。固定的 Workspace Explorer 字段将命令和根目录排除在浏览器控制输入之外，并使请求上限可审计。

**Worktree 打开时加载完整目录树**：否决。懒加载目录请求可以限制大型仓库，并允许取消失效的展开操作。

## 后果

Explorer 保持只读，不暴露文件内容。Git 状态以文件和目录装饰显示在同一棵树中，Search 仍位于 Worktree 工具栏模式中。拖拽 Worktree 条目只传递相对显示路径，不读取文件，也不会向聊天框授予绝对路径。底层文件系统提供方可能在 bridge 应用响应上限前完整枚举一个目录，因此提供方原生的有界列表仍是后续能力改进。解析后越出 Workspace 的 symlink 或 junction 子项仍作为阻止条目显示，使拒绝行为可见，同时 UI 不会跟随它们。虚拟列表要求行高固定；可变行高消费者需要另外的测量策略。

## 测试

桌面 Explorer 测试固定相对路径校验、越界拒绝、目录优先排序、条目截断和根目录外投影。虚拟列表测试固定空集合、预渲染范围和末尾滚动位置截断。standalone desktop bridge 构建会编译 Host 与 Client 包，并打包 Explorer 路由与 UI。focused client tests 会验证相对路径拖放载荷、绝对路径拒绝和装饰汇总。
