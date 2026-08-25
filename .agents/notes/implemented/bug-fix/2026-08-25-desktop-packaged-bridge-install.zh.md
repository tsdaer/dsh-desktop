# Agent Note：打包版桌面启动会安装 profile 桥接

Status: implemented

[English](2026-08-25-desktop-packaged-bridge-install.md) | 中文

## 问题

打包版桌面安装后一直保留过期的 profile 桥接。运行时对每条 `/dsh-bridge` 路由强制 per-boot loopback token，而过期桥接客户端不支持 token，于是桌面设置区块、余额胶囊与关闭到托盘镜像的每次请求都以 HTTP 401 失败。

回归点：`RuntimePaths::is_dev()` 返回 `!cli.is_empty()`，但 `RuntimePaths::packaged()` 同样携带 CLI 路径（自身的 `runtime/lib/bin.js`），因此打包模式永远被误判为 dev 模式。`ensure_bridge` 永远走不到打包复制分支，反而从打包 CLI 所在盘符根目录解析仓库 checkout——那里并不存在。过期（全新 profile 上则是缺失）的桥接在每次升级后继续存活；失败只有 eprintln，在 GUI 子系统应用中完全不可见。

## 决定

`RuntimePaths` 增加显式 `dev` 字段：`from_env()`（dev 启动器）置 `true`，`packaged()` 与无资源兜底置 `false`，`is_dev()` 返回该字段。`ensure_bridge` 现在能进入打包分支：profile 已有标记时从运行时的 `dsh-desktop-bridge`、`dsh-desktop-bridge-client` 与 `schemastery` 刷新复制；全新 profile 则安装这些包并写入桥接 patch 行。复制结果通过 `splash_log` 记录，刷新失败可从 `%TEMP%/dsh-desktop-splash.log` 诊断，而不是丢失在 stderr 中。

## 测试

两个新单元测试钉住契约：dev 模式就是启动器构造函数（与环境无关）；打包模式的 `ensure_bridge` 会用运行时来源刷新过期 profile 桥接。`cargo test --bin dsh-desktop` 全套通过；桥接包在所有目标上都是逐字节一致的构件，因此这是一次纯 shell 修复，不涉及任何平台特定代码。

## 结果

打包升级每次启动都会重新同步 profile 桥接，升级后桌面设置恢复可用。全新打包安装现在会自动获得桥接行，与 `apps/desktop/README.md` 记载的行为一致。通过 `DSH_PATCH` 注入桥接行的发布冒烟测试不受影响：profile 安装路径是纯增量的。

## 考虑过的方案

**通过 CLI 路径是否位于资源目录下来检测打包模式。** 放弃：该启发式与目标平台耦合，且重复构造函数已掌握的信息；显式字段更简单、可测试。

**保留启发式，只翻转 `ensure_bridge`。** 放弃：`is_dev()` 还控制 node 存在性检查，字段让每个调用方的意图都明确。
