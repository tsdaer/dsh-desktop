# Agent Note：桌面升级会修复过期的 profile 桥接状态

Status: implemented

[English](2026-08-25-desktop-upgrade-profile-repair.md) | 中文

## 问题

过期的桌面 profile 会活过升级。桥接包在启动时复制进 web profile，但仍有三个缺口：profile 的 `cordis.patch.yml` 保留着安装它的那个版本的桥接行（过期的配置键暂时无害，直到未来某个桥接重命名键）；旧复制路径留下的历史包目录会累积；桥接一旦加载失败就静默——设置页显示 401，启动日志却干干净净。此外也没有记录哪个桌面版本最后同步过 profile，修复无法限定在升级时进行。

## 决定

壳子在每次启动时执行一次版本化、幂等的更新修复：

1. **桥接包刷新**（已随此前修复发布）：把运行来源的 `dsh-desktop-bridge`、`dsh-desktop-bridge-client` 与 `schemastery` 复制进 profile。
2. **profile patch 重新同步**：`sync_bridge_patch` 用已安装桥接包自带的 patch 重写 `cordis.patch.yml` 中由壳子拥有的桥接行（`- insert:` 名单与 `- id: desktop-bridge` 配置），保留用户行与注释；裸 `[]` 模板占位符被替换；历史残留目录 `bridge`/`bridge-client` 被删除。
3. **同步标记**：`.dsh-desktop-bridge-sync` 记录桌面版本与桥接 patch 的 FNV-1a 哈希。只有标记缺失或任一指纹前进时才重写——当前版本内的编辑在普通重启后幸存，升级则刷新桥接默认值（应用内设置页把持久化覆盖存在 `settings.yaml`，不受影响）。
4. **启动验证**：运行时就绪后，壳子用 per-boot token 在 loopback 上探测 `GET /dsh-bridge/config` 并记录 HTTP 状态。桥接缺失或过期现在会以 `bridge probe: HTTP/1.1 404 ...`（或不可达描述）出现在 `%TEMP%/dsh-desktop-splash.log`，而不是在页面里静默失败。

## 测试

单元测试钉住 FNV 参考向量、行替换（过期行被移除、用户行与模板前言保留、标记门控：同版本不重写、版本前进时刷新）、空列表占位符替换、历史目录清理，以及探测对罐头 HTTP 响应与不可达场景的状态行解析。探测请求格式已对照真实 `dsh web` 服务器验证（200 且带 `Connection: close`）。`cargo test --bin dsh-desktop` 全套通过；release 构建可编译。

## 结果

每次升级都会自愈 profile 的桥接状态并记录结果。桥接损坏可在一次启动内从 splash 日志诊断。重写按构造保持保守（删块 + 追加，单一 YAML 文档），标记防止升级间隙覆盖用户编辑。

## 考虑过的方案

**每次启动都重写 profile patch。** 放弃：profile patch 是配置桥接默认值的文档化位置，无条件替换会毁掉用户编辑。

**用 semver 顺序比较版本。** 放弃：任何差异（包括降级）都应重新同步；只有相等才跳过。

**让页面而不是壳子探测。** 放弃：页面侧探测要等客户端 bundle 加载，且无法区分过期 bundle 与过期 host；壳子在就绪时掌握 token 与端口，能在窗口打开前验证路由。
