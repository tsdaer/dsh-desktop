# Agent Note: 桌面端普通消息复制覆盖

状态: implemented

[English](2026-08-21-desktop-ordinary-message-copy.md) | 中文

## 问题

桌面端 0.3 路线图要求在每条普通用户消息和助手消息旁提供视觉一致的复制操作。对装配后渲染器覆盖的审计发现一个缺口:Turn Tail 复制操作只写入 closing 助手节点的文本,多步回合中的叙述可见但无法复制。

## 决策

`MessageIconActions` 仍是唯一的剪贴板实现。`TurnTailChatData` 新增 `copyText` 字段:回合的完整助手纯文本,由 turn-tail 节点构建器按 seq 顺序从每个 finalized 助手步骤(`assistantText` 提取各步骤文本块)拼出。Turn Tail 复制操作改为写入 `copyText`,而不是 closing 节点的块。用户、插话、待接纳插话气泡已复制其完整文本;上下文注入、压缩标记、重试/错误状态行与未知 surface JSON 行仍被排除,因为它们不代表一条普通消息。

## 备选方案

**在每个回合中段助手节点上渲染复制操作** —— 拒绝:footer 已持有回合局部操作,按步复制只是重复 chrome,并不改变用户能复制的内容。

**只复制 closing 节点文本** —— 拒绝:多步叙述仍然无法复制,这正是审计发现的缺口。

## 影响

快照 fixture(`chat-snapshot-fixture.client.ts`)镜像 `copyText`,使测试中的渲染视图保持真实。分支语义不变:分支操作仍锚定 closing 节点的 seq,`copyText` 不影响 fork 行为。

## 测试

`chat-view.client.spec.tsx` 钉住多步回合的复制操作按序写入 `mid-turn text` 与 `final answer`,且每回合只渲染一个 Turn Tail(而非按步)复制操作。
