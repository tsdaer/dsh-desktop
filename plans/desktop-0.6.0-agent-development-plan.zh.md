# DeepSeek Harness Desktop 0.6.0 智能体开发指导计划

> 性质：个人开发计划，不是当前架构规范或已批准的发布承诺。本文故意不采用仓库的双语配对、YAML 元数据和网站导航规则；进入代码实施后，执行者仍须重新读取根目录及受影响目录的 `AGENTS.md`，并遵守测试、Agent Note、客户端本地化和发布证据要求。

## 1. 文档基线

- 调查日期：2026-08-30；范围调整日期：2026-08-31。
- 调查分支：`feat/tauri-shell`。
- 桌面版本基线：`apps/desktop/package.json` 的 `0.5.6`。
- 调查提交：`26ede50b95`。
- 目标版本：`0.6.0`。
- 配套进度台账：[desktop-0.6.0-agent-development-progress.zh.md](desktop-0.6.0-agent-development-progress.zh.md)。

本计划只解决两个桌面壳问题：更新器网络适应和桌面功能策略。Chat 渲染与会话存储已有上游开发路径，0.6.0 不再设计、实现、验收或跟踪这两类工作，也不维护平行实现。

## 2. 执行摘要与已经作出的技术选择

| 目标 | 当前事实 | 0.6.0 选择 |
| --- | --- | --- |
| 更新器网络适应 | 前端约 1.5 秒后执行一次 10 秒超时检查；失败依赖字符串分类，自动阶段没有重试、退避或代理设置 | 将检查和下载编排下沉为 Tauri/Rust 的类型化控制器，增加单航班、分类重试、代理模式、阶段化诊断、缓存条件请求和安全不降级原则 |
| 桌面特性控制 | Bridge 设置目前是固定四项；Worktree、原生预览等能力无独立开关 | 建立可扩展、类型化、持久化的 Desktop Feature Policy；首批控制 Worktree、原生文件预览、源代码管理和更新自动检查，并为以后真正立项的桌面功能保留统一注册方式 |
| Chat 渲染与会话存储 | 上游已有相关开发路径 | 从 0.6.0 桌面计划移除；不新增虚拟化、分页、SQLite 迁移、存储设置或相关性能指标 |

以下选择在本版本内视为冻结：

1. 0.6.0 不修改 `packages/client/ui-chat`、SessionPersistence、SessionHistoryController 或存储组合来解决聊天规模问题。
2. 上游相关变更进入本分支后，不建立桌面专项任务、指标或发布阻塞项；若普通发布 smoke 暴露缺陷，将问题反馈到上游路径，不在 desktop bridge 复制修复。
3. 桌面 Feature Policy 不包含 `chatVirtualization`、`storageBackend` 或 SQLite 迁移开关。
4. 更新失败不会绕过 TLS、更新签名或清单校验；网络适应性只改变连接、超时、重试、代理和诊断。
5. 代理凭据不写进普通 YAML 设置；首批功能开关必须同时约束 UI 和 Host 行为。

## 3. 当前实现审计

### 3.1 桌面更新器

主要代码位于：

- `apps/desktop/bridge-client/src/client/DesktopUpdater.ts`
- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/scripts/update-fixture.mjs`

当前前端在挂载后延迟约 1.5 秒执行一次 `check({ timeout: 10000 })`。错误分类依靠错误字符串中的 `signature`、`manifest`、`json`、`release`、`network` 等词；代理返回的 HTML、网关错误正文或 GitHub 错误中包含 `release` 时，网络失败可能被显示为“更新清单无效”。自动检查没有重试预算、指数退避、网络恢复触发、代理配置或最后成功状态。

当前 Tauri updater API 本身已经暴露请求级 `headers`、`timeout` 和 `proxy`；Rust builder 还暴露 `proxy`、`no_proxy` 与底层客户端配置入口。参考：[Updater guest JS](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/guest-js/index.ts) 和 [Updater Rust builder](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs)。0.6.0 的工作重点因此不是替换签名更新器，而是让桌面壳拥有类型化的连接策略和错误阶段。

### 3.2 桌面设置和特性入口

Host 的 Bridge Config 位于 `apps/desktop/bridge/src/index.ts`，设置路由通过 `/dsh-bridge/config` 与 `/dsh-bridge/policy` 暴露。客户端设置卡片位于 `apps/desktop/bridge-client/src/client/BridgeSection.tsx`，当前以固定槽位列出关闭到托盘、调试模式、Logo 动效和 WSL。

Worktree 入口在 `apps/desktop/bridge-client/src/client/index.ts` 中无条件注册；Workspace/Worktree 切换在 `DesktopWorkspaceWorkbench.tsx` 中无条件出现。文件激活会先调用 `DesktopWorkspacePreviewWindow.ts` 打开原生预览窗口，失败后才回退到工作台内嵌预览。0.6.0 可以利用这条现成降级路径，让“禁用原生文件预览窗口”直接选择内嵌预览，而不是让文件无法查看。

### 3.3 上游开发边界

Chat 渲染与会话存储的调查结论保留在 2026-08-30 的进度日志中，但不再转化为 0.6.0 任务、指标、桌面设置或专项回归。执行智能体发现涉及 `packages/client/ui-chat`、`packages/session`、`packages/session-query` 或 `packages/api/session-controller` 的需求时，应停止并转交上游路径；本计划不授权修改这些范围。

## 4. 0.6.0 产品目标与非目标

### 4.1 必须交付

1. 更新器在常见代理、短时断网、超时、429、5xx、连接重置和错误 HTML 响应下给出正确阶段、有限重试和可操作反馈。
2. 设置页提供 Worktree、原生预览窗口、源代码管理和自动更新检查控制；设置失败会回滚 UI，不留下“看似已开启、实际上未保存”的状态。
3. Feature Policy 具有统一的类型、默认值、持久化、版本冲突处理、本地化描述和 Host 门控方式，以后新增桌面能力不需要再复制一套设置通道。
4. 0.5.6 既有设置升级后保持原行为；用户未操作的新开关使用明确默认值。

### 4.2 明确非目标

- 不修改 Chat 虚拟化、Chat store、消息投影、SessionPersistence、历史分页或存储后端。
- 不增加 SQLite 模式、存储切换、历史迁移、逻辑日志导出或 Chat 性能基准。
- 不把代理用户名和密码保存到普通 `settings.yaml`；需要认证的代理优先交给系统凭据或后续专用凭据服务。
- 不通过忽略签名、关闭证书验证、接受损坏清单或无限重试来提高“成功率”。
- 不把每个实验开关永久暴露给普通用户；诊断开关在稳定后可以删除。
- 不预先为尚未立项的桌面特性添加空布尔值；可扩展性来自统一注册方式，而非一组猜测性的设置。

## 5. 目标控制流

```text
settings.yaml / Bridge defaults
        │
        ▼
Desktop Feature Policy ── revision ──► Bridge config route ──► Settings UI
        │                                      │
        ├── Worktree / Preview / SCM gates     └── optimistic save + rollback
        │
        └── Update Policy ──► Tauri updater controller ──► signed endpoint
                              proxy / timeout / retry / typed diagnostics
```

Feature Policy 由 Host 持有权威值，客户端只显示并提交变更；隐藏按钮不能代替 Host 拒绝。更新器控制器负责网络与安全状态，设置页只提供用户选择，不解析清单或验证签名。

## 6. 工作分解、依赖与建议 PR 顺序

| 阶段 | 任务组 | 依赖 | 建议独立 PR | 发布权重 |
| --- | --- | --- | --- | ---: |
| M0 | 计划、现状审计与范围调整 | 无 | 文档提交 | 5% |
| M1 | 更新网络夹具、基线和诊断字段 | M0 | `test(desktop): baseline updater networks` | 10% |
| M2 | 类型化 Desktop Feature Policy | M0 | `feat(desktop): add feature policy` | 20% |
| M3 | Worktree、原生预览、SCM 与自动检查门控 | M2 | `feat(desktop): add feature controls` | 20% |
| M4 | 更新器网络控制器与代理设置 | M1、M2 | `fix(desktop): harden updater networking` | 35% |
| M5 | 集成、真实桌面证据与发布 | M3、M4 | `release: desktop 0.6.0` | 10% |

M2 完成策略类型与保存语义后，M3 与 M4 可以并行。M5 只整合这两条交付线；Chat 与存储上游工作不构成 0.6.0 的开始条件或完成条件。

## 7. M1：更新网络夹具、基线与观测

### 7.1 固定网络矩阵

| 夹具 | 内容 | 用途 |
| --- | --- | --- |
| `updater-network-matrix` | 本地 HTTP/代理服务可返回延迟、重置、407、429、502、HTML 200、截断 JSON、有效清单和无效签名 | 类型化错误与重试验证 |
| `updater-concurrency` | 重复挂载、连续点击、前后台切换和退出取消 | 单航班、定时器和生命周期验证 |
| `feature-policy-race` | 两项设置并发保存、一次失败、旧 revision 提交 | 合并、冲突和 UI 回滚验证 |

测试数据必须确定性生成，不提交真实用户数据，不包含 API 密钥和代理凭据。网络基准记录机器、Node、WebView2、Rust target、样本数和 P50/P95；没有这些元数据的单次数字不进入发布判断。

### 7.2 初始预算

M1 允许在参考机实测后调整阈值，但任何调整必须写明基线和理由，不能在实现失败后删除预算。

| 指标 | 0.6.0 初始门槛 |
| --- | --- |
| 更新检查 | 可重试失败最多 3 次自动尝试；总自动等待预算不超过 35 秒；手动重试不复用耗尽预算 |
| 并发检查 | 任意重复挂载或连续点击下，同时最多一个 check 和一个 download |
| 自动打扰 | 自动检查失败不弹出循环阻断提示；用户仍能看到最后检查时间和手动重试入口 |
| 设置 | 保存失败后 1 秒内恢复服务器确认值；需重启项不得伪装成即时生效 |
| 敏感信息 | 测试和日志中代理 URL、凭据、响应正文与系统环境变量值泄漏为 0 |

### 7.3 观测字段

开发构建记录下列不含敏感数据的指标：

- `updater.stage`、`updater.attempt`、`updater.errorKind`、`updater.proxyMode`、`updater.durationMs`；不得记录代理 URL、响应正文或系统环境变量值。
- `desktop.featurePolicy.revision` 与保存结果；不得记录用户路径。

### 7.4 M1 验收

- 网络与设置竞态夹具在干净工作树可重复运行。
- 基线报告同时列出 0.5.6 和当前实现，不只展示改进后的结果。
- 测量命令、机器信息和结果链接写入进度文档。
- 性能脚本失败返回非零退出码，不能只输出警告。

## 8. M2：类型化 Desktop Feature Policy

### 8.1 配置模型

建议在 Bridge Host 中增加明确分组，而不是继续向顶层堆布尔值：

```ts
interface DesktopFeaturePolicy {
  readonly worktreeEnabled: boolean
  readonly nativeFilePreviewEnabled: boolean
  readonly sourceControlEnabled: boolean
}

interface DesktopUpdatePolicy {
  readonly autoCheck: boolean
  readonly proxyMode: 'system' | 'direct' | 'manual'
  readonly proxyUrl?: string
}
```

默认值建议为 Worktree、原生预览、源代码管理和自动更新检查全部开启，代理为 `system`。Chat 与存储字段不进入这组类型；以后新增字段必须对应已经立项并具有 Host 行为门控的桌面功能。

### 8.2 设置 UI 的可扩展方式

`BridgeSection.tsx` 不再通过 `item1`、`item2` 等固定插槽扩张。新增一个桌面设置贡献列表或由 Bridge Client 拥有的分组卡片，每个项目至少声明：稳定 id、本地化 label/description、当前值、是否需重启、是否为实验项、保存函数和错误回滚。

设置写入遵循“服务端确认后提交 UI”的模型：可以显示局部 pending，但失败必须恢复最后一次服务器快照。多个开关同时保存时按字段合并，不用旧快照覆盖另一项已成功的修改；可采用策略 revision 或 `If-Match` 风格版本避免竞态。

### 8.3 每个开关的实际约束

- `worktreeEnabled = false`：隐藏 Worktree 入口和 tab；若当前正处于 Worktree tab，切回 Workspace；取消未完成的 Worktree 列表/搜索请求；Host 路由对新的 Worktree 请求返回明确的 feature-disabled 响应。
- `nativeFilePreviewEnabled = false`：新的文件激活不调用原生预览命令，直接使用既有内嵌预览；已有预览窗口不被强制关闭。
- `sourceControlEnabled = false`：隐藏 Git 状态、刷新和提交相关表面，Explorer 仍可浏览文件；Host 拒绝新的源代码管理操作。
- `autoCheck = false`：禁止启动自动检查，但保留用户手动检查入口。

### 8.4 M2 验收

- 设置跨重启保持，旧设置文件缺少新字段时使用显式默认值。
- 每个开关至少有 Host 配置测试、策略路由测试、客户端保存失败测试和行为门控测试。
- 所有用户可见文本由桌面 locale 字典拥有。
- 关闭功能时不只隐藏按钮，Host 行为也被策略保护。

## 9. M3：首批桌面功能门控

### 9.1 Worktree

Worktree 开关同时控制入口、当前模式和 Host 请求。关闭时隐藏 sidebar action 与 Worktree tab；如果用户正在 Worktree 模式，客户端先取消相关请求，再切回 Workspace。Host 对关闭后的新 Worktree 操作返回稳定的 feature-disabled 结果，不能依赖按钮隐藏保护后端。

测试覆盖启动即关闭、运行时关闭、请求进行中关闭、重启保持和保存失败回滚。关闭 Worktree 不应影响普通 Workspace Explorer、文件搜索或当前聊天。

### 9.2 原生文件预览

`nativeFilePreviewEnabled = false` 时，新的文件激活跳过 `DesktopWorkspacePreviewWindow.ts` 的原生窗口命令，直接使用现有工作台内嵌预览。已经打开的原生预览窗口继续由用户关闭，切换设置不批量销毁窗口。

测试覆盖支持/不支持的文件、重复打开、原生命令失败 fallback、运行时切换和窗口主题同步。开关名称必须描述“原生预览窗口”，避免让用户误以为文件预览功能会完全关闭。

### 9.3 Source Control

关闭 Source Control 时隐藏 Git 状态、刷新和操作表面，取消未完成的 Git 请求，并让 Host 拒绝新操作。Explorer、文件预览和 Worktree 的非 Git 浏览能力继续可用。若 Worktree 某个动作必须依赖 Git，UI 应显示该动作因 Source Control 关闭而不可用，而不是静默失败。

### 9.4 自动更新检查

`autoCheck = false` 只禁止应用启动、网络恢复和前台恢复触发的自动检查；用户手动检查入口始终保留。切换为开启后不立即并发发起第二个检查，而是交给 updater 单航班控制器决定复用或调度。

### 9.5 后续功能注册方式

M2 应提供一个类型化 feature descriptor 或等价注册方式，使以后立项的桌面功能声明稳定 id、本地化 label/description、默认值、是否需重启、Host gate 和客户端呈现。0.6.0 不添加没有实际消费方的占位开关；新增功能仍需要独立行为测试和发布证据。

### 9.6 M3 验收

- 四个开关跨重启保持，旧设置文件缺字段时保持 0.5.6 行为。
- 每个功能在 UI 隐藏之外都具有 Host 或控制器门控。
- 运行时关闭会取消或安全结束在途请求，不留下错误 tab 或悬空 loading。
- 保存失败和 revision 冲突恢复服务器确认值。
- 设置页及受影响 GUI 按仓库要求完成本地化、浏览器测试和真实桌面 GIF。

## 10. M4：更新器网络适应与代理

### 10.1 控制器职责

在 `apps/desktop/src-tauri/src/main.rs` 拆出测试友好的 updater/network 模块，由 Rust 侧完成 check、download、install 的阶段化编排，前端 `DesktopUpdater.ts` 只订阅状态并发出用户意图。返回结构至少包含：

```ts
type DesktopUpdateStage = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'failed'
type DesktopUpdateErrorKind =
  | 'offline' | 'dns' | 'proxy-auth' | 'proxy-connect' | 'timeout'
  | 'tls' | 'http-client' | 'http-server' | 'rate-limited'
  | 'manifest-content' | 'manifest-schema' | 'signature' | 'download' | 'install'
```

错误对象携带 `retryable`、`attempt`、可选 HTTP status、可选 `retryAfterMs` 和安全的本地化 message key。不得把响应正文、代理 URL 或底层可能含凭据的错误直接显示或写日志。

### 10.2 代理模式

- `system`：使用依赖默认的系统/环境代理发现；UI 说明这取决于平台网络栈，不能承诺 PAC 与所有企业认证代理均受支持。
- `direct`：明确不设置代理；用于错误系统代理或调试。
- `manual`：接受一个经过解析的 `http://`、`https://` 或依赖明确支持的 `socks5://` URL；禁止 userinfo、fragment 和空 host；设置页显示脱敏值。

如需持久化认证代理，后续应通过 credentials 能力或 OS 凭据库，不在本版本把 `user:password@host` 写入 YAML。

### 10.3 重试与状态机

自动检查采用单航班：同一时刻只有一个 check，手动点击可以复用正在进行的 Promise，不能并发下载同一更新。建议自动尝试为 3 次：首次立即，随后 2 秒与 8 秒指数退避并加入全抖动；尊重受限的 `Retry-After`，总预算不超过 35 秒。

只对 offline、DNS、连接、超时、429 和 5xx 自动重试。4xx、清单语法、清单字段、签名、安装失败不自动重试。网络从 offline 恢复、应用重新获得前台且上次失败可重试时，可以进行一次去抖动重查。

自动启动失败不使用阻断式错误反复打扰用户：状态行显示“稍后重试”和最近成功检查时间。用户主动点击后才展开阶段、尝试次数和建议操作。修正当前按 `release` 等宽泛字符串归类的逻辑，HTML 200 应报告“服务器返回了非更新清单内容”，代理 407 应报告代理认证，而不是笼统的“清单无效”。

### 10.4 缓存与安全

- 保存最近一次成功清单的 ETag、Last-Modified、版本和检查时间；缓存只用于状态展示和条件请求，不跳过下一次网络检查。
- 已下载产物仍必须通过 updater 签名校验；缓存清单不能让损坏或未签名产物进入安装。
- 设置连接与总请求超时，限制重定向次数；不关闭证书校验。
- 下载中断后如插件不提供安全续传，0.6.0 可以重新下载，但必须清理临时文件并显示真实阶段。
- 应用退出和组件 dispose 会取消检查/下载监听，不能留下后台重试定时器。

### 10.5 测试矩阵

| 场景 | 预期 |
| --- | --- |
| 系统/手动代理成功 | 经代理取回有效清单并完成签名下载 |
| 407 | `proxy-auth`，不自动无限重试，提供代理设置入口 |
| DNS、重置、超时 | 可重试，尝试次数和总预算正确 |
| 429 + Retry-After | 在预算内尊重延迟，超预算则交给手动重试 |
| 502/503 | 可重试；最终错误为服务器暂不可用 |
| 404 | 不自动重试，归类为客户端/端点配置问题 |
| HTML 200 | `manifest-content`，不误报 JSON 签名问题 |
| 截断 JSON/缺字段 | `manifest-schema`，不自动重试 |
| 无效更新签名 | `signature`，永不降级安装 |
| 下载连接中断 | 明确 download 阶段，临时文件可清理，再次点击可恢复流程 |
| 组件重复挂载/狂点 | 仍只有一个 check/download |

`apps/desktop/scripts/update-fixture.mjs` 应扩展为可编排的本地故障服务器；Rust 使用单元/集成测试覆盖分类，前端只测试状态呈现和用户动作。

## 11. M5：集成、发布和回滚

### 11.1 集成场景

至少完成以下真实桌面旅程：

1. 0.5.6 既有桌面设置升级到 0.6.0，未操作新开关时保持 Worktree、预览、Source Control 和自动检查原行为。
2. 在手动代理下检查和安装签名 fixture 更新；分别验证 407、HTML 200、429、连接重置、前后台切换与退出取消。
3. 依次关闭 Worktree、原生预览、Source Control 和自动检查，验证入口、Host 拒绝、fallback、在途取消与跨重启保持。
4. 模拟两个设置并发保存且一个失败，验证 revision 冲突和 UI 回滚不会覆盖另一项成功修改。

### 11.2 回滚阀

- Updater：`autoCheck = false` 保留手动检查；不能提供“关闭签名验证”。
- Features：服务器确认的策略可以逐项关闭。
- Scope：上游 Chat/存储变更的准备状态不属于本计划；0.6.0 不通过桌面私有实现补齐，也不为其增加专项发布门。

### 11.3 发布门

- 相关 unit、client、browser、built smoke、snapshot、typecheck 和 lint 通过；具体命令由实施时的 `dsh-pre-push-checks` 选择并如实记录。
- 每个产品用户可见 GUI 改动从 PR 的真实服务器和模型流录制 GIF。
- 更新 fixture 的有效签名路径与正式 endpoint 配置均验证。
- 网络矩阵和设置竞态报告包含 0.5.6 对照和 0.6.0 RC 结果。
- 不存在未分类的“更新清单无效”兜底；未知错误显示阶段与诊断 id，而不显示敏感原文。
- 进度文档所有 P0/P1 阻塞项关闭，未完成项明确移出 0.6.0。

## 12. 风险登记

| 风险 | 严重性 | 提前信号 | 处理 |
| --- | --- | --- | --- |
| 代理错误仍被误分为清单错误 | P1 | HTML/407 fixture 落入 manifest-schema | Rust 分阶段分类，取消宽泛字符串匹配 |
| 自动重试造成请求风暴 | P1 | 多组件挂载产生并发 check | 单航班、全局预算、抖动、可取消 |
| Feature UI 与 Host 行为不一致 | P1 | 隐藏按钮但路由仍执行 | Host policy 为权威，客户端只投影 |
| 配置扩张变成大量散落布尔值 | P2 | 每个开关新增独立 route/store | 类型化分组、描述符驱动 UI、revision 保存 |
| 设置并发保存丢失更新 | P1 | 第二项保存用旧快照覆盖第一项 | policy revision、字段合并与失败回滚测试 |
| 上游 Chat/存储工作重新渗入桌面计划 | P2 | desktop bridge 出现虚拟化或 persistence 私有补丁 | 停止实现并反馈上游路径，只保留集成回归 |

## 13. 智能体执行规范

每个实施智能体领取一个任务 ID，先在进度文档把状态改为 `进行中`、记录分支/提交和预期修改面，再开始编辑。一个任务不得同时由两个智能体改写同一核心文件；M2/M3 的 Bridge policy 和 M4 的 updater controller 分别设单一代码 owner。

执行前必须：

1. 重新读取根 `AGENTS.md`、受影响 package 的 `AGENTS.md`、`docs/architecture.md`；生命周期、并发、子进程或 teardown 改动再读 `docs/defensive-patterns.md`。
2. 检查工作树并保留其他人的改动，不做 reset/checkout 覆盖。
3. 对非平凡改动创建对应 Agent Note；UI 文案进入 locale；模型/用户可见路径按规则更新 snapshot。
4. 先写失败测试或基准，再改实现；禁止用降低断言、扩大 timeout 或移除场景来“过门”。

每次完成任务后，在进度文档记录：实际文件、提交 SHA、实际运行命令、结果、性能前后对照、未解决风险、下一任务。只记录真正运行的命令；“CI 应该会过”不是验证结果。

智能体遇到下列情况应停止并升级决策：需要修改 Chat 渲染、SessionPersistence、SessionEventMap、历史分页或存储组合；需要存储代理凭据；需要绕过更新签名；网络门只能靠删除失败场景或扩大总等待预算才能通过；上游 Tauri 行为与文档不一致。

## 14. 建议的第一轮执行顺序

1. `DSH-060-001` 至 `003`：扩展 updater fault/concurrency fixture，记录 0.5.6 网络与设置保存基线。
2. `DSH-060-010` 至 `015`：实现 Desktop Feature Policy、统一设置贡献方式、revision/回滚模型和 Update Policy。
3. 并行启动 `DSH-060-020` 至 `023` 的首批功能门控，以及 `DSH-060-030` 至 `035` 的 updater Rust 控制器与代理策略。
4. `DSH-060-040` 至 `043`：完成升级、代理、设置竞态、上游兼容回归、真实 GIF 和 RC 决策。

下一步是 `DSH-060-001`：扩展 updater fixture 并记录当前错误分类、请求次数和等待行为。Chat 与会话存储不再需要本计划的前置基准。
