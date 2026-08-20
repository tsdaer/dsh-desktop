# Agent Note: 桌面端 Logo 悬停动效需要显式开启

Status: implemented

[English](2026-08-20-desktop-logo-motion-opt-in.md) | 中文

## Problem

当宿主报告减少动态效果时，新会话 Hero Logo 动画会被禁用。桌面用户需要一个设置来启用这个小型装饰动效，同时不能改变网页端或其他动效的行为。

## Decision

桌面 bridge 在 `desktop-bridge` 设置命名空间中持久化 `logoMotion` 布尔值，默认值为 `false`，因此在用户显式开启前，系统的减少动态效果偏好仍然有效。bridge client 将开启状态镜像到 `html[data-dsh-logo-motion]`，共享 Hero 样式表通过该属性只允许鱼形 Logo 悬停动效在减少动态效果模式下运行。设置显示在桌面设置分区中，并通过 `/dsh-bridge/policy` 保存。

## Alternatives considered

**全局移除减少动态效果条件。** 不采用，因为这会强制网页端用户看到装饰动效并忽略无障碍偏好。

**增加共享的通用设置。** 不采用，因为该行为只存在于桌面壳，而且壳子已经拥有 bridge 设置路由和分区。

## Consequences

桌面设置会持久化，并且无需重启应用即可生效。网页端不会收到桌面根元素属性，继续使用上游的减少动态效果行为。显式开启只作用于新会话 Hero Logo，不会开启其他 CSS 动画。
