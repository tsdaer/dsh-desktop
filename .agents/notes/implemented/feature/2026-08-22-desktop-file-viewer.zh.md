# Agent Note: 桌面端应用内文件查看器

状态: implemented

[English](2026-08-22-desktop-file-viewer.md) | 中文

## 问题

Worktree 资源管理器与搜索能定位文件但不能显示内容；用户必须离开应用才能阅读。查看器需要有界字节与显式截断状态、拒绝二进制与非 UTF-8 内容、通过客户端现有高亮器着色，并让搜索结果在匹配行打开。

## 决策

桌面桥新增 `GET /dsh-bridge/worktree/file`，请求字段为一对：已注册的 `workspaceId` 与 Workspace 相对 `path`。Host 解析规范 Workspace 根，拒绝越界与非普通目标，并把响应限制在 `fileMaxBytes`（默认 256 KiB）。界内文件通过 `fs.readBytes` 整读、检查 NUL 字节并以严格 UTF-8（`fatal: true` 的 `TextDecoder`）解码；二进制或无效内容以稳定的 `binary-file` 错误拒绝而非渲染。超大文件通过 `fs.streamText` 流式读取有界前缀并返回 `truncated: true`。

bridge-client 新增 `DesktopWorkspaceFileViewer`：路径、复制与关闭控件组成的头部，叠加通过 `highlightLines`（客户端现有 shiki 高亮器）着色的行号内容，每行带滚动定位的 data 属性。Explorer 文件行点击与键盘激活打开查看器；搜索结果行以 `scrollToLine` 指向匹配行打开。文件扩展名语言提示与 read 工具的映射一致，使文件在 Worktree 查看器与 read 卡片中的着色方式相同。

## 备选方案

**复用 read 工具的行窗口呈现** —— 拒绝:read 工具返回带自身信封的编号窗口,而查看器需要带显式截断标志与行级滚动定位的完整有界文件。

**搜索结果继续走系统打开** —— 拒绝:0.3 计划要求搜索结果在应用内查看器打开并定位匹配行。

## 影响

查看器请求复用 Explorer 请求词汇(Workspace id 与相对路径解析、规范根包含检查)。ui-primitives 包现在为代码块之外需要行粒度着色(行粒度高亮)的使用方导出 `highlightLines`、`grammarLoadCount` 与 `subscribeGrammarLoaded`。编辑仍不在范围内:保存冲突检测、编码与换行策略以及撤销模型属于后续阶段。

## 测试

Host 测试钉住 Workspace 解析、越界拒绝、二进制与无效 UTF-8 拒绝、界内读取、超大前缀截断、流失败、取消与权限映射。客户端测试覆盖语言提示、投影校验、fetch 生命周期、截断与二进制状态、匹配行滚动、关闭处理与卸载取消。真实 evidence server 已对仓库 Workspace 端到端验证。
