# Agent Note: 桌面 bridge-client 读取已废弃的客户端 store 字段

Status: implemented

[English](2026-09-13-desktop-bridge-client-store-contract.md) | 中文

## 问题

桌面壳的"以 dsh-desktop 打开"流程失去了所有可见行为:应用被唤醒后,既不切换到所属工作区,也不提示注册新工作区。bridge-client 的 open-path 路由挂死在 `waitForWorkspaces` 里——它的就绪探测读取的是 `workspaces.list.getSnapshot().baselinesReady`,而客户端工作区 store 已把该字段替换为 `phase: 'pending' | 'ready'` 生命周期。`undefined` 永远不就绪,等待因此永不结束。无主目录的回退分支还调用了 `workspaces.startSession`,该方法如今位于 `uiWorkspace` 导航服务上;两次失败都被 drain 的 catch 吞掉,故障因此完全静默。桌面插件对所消费服务声明的是最小结构视图(`WorkspacesLike`、`SessionsLike`),字段改名不会产生任何编译信号。

## 决策

bridge-client 对齐当前 client-runtime 契约:就绪判断为 `phase === 'ready'`,开启会话走 `ctx.uiWorkspace.startSession`,`uiWorkspace` 加入插件的 `inject` 列表,最小接口同步修正为真实快照形状。回归测试以与运行时同形的 store 钉住三条路由路径:绑定时已就绪则路由到所属工作区最近的会话;基线未就绪则延迟到翻转后再路由;无主目录提供注册确认并启动新建工作区的会话。

## 已考虑的替代方案

**运行时同时接受两个字段名。** `baselinesReady ?? phase === 'ready'` 可以容忍旧客户端构建,但 bridge-client 与其目标运行时一同发布,且旧字段名已从所有受支持构建中移除;兼容分支是掩盖下一次改名的死代码。

**在客户端 store 上恢复旧字段名。** 改名是上游客户端重构,已有自己的消费方;为一个桌面读者重新加回 `baselinesReady` 会分裂 store 契约。

**不修。** 该流程是已交付的桌面功能(README,"Open with dsh-desktop");永久挂起的等待是缺陷,不是可以容忍的降级。

## 后果

转发的目录重新可以路由:窗口唤醒并落在所属工作区最近的会话上,或提示注册新工作区。这个接缝仍然没有类型防护——未来 store 字段再改名,依旧只能通过行为传导到桌面端,新测试就是这三处形状的绊线。
