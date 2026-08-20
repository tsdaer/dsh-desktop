# Agent Note: 打包桌面保留 profile 自有 bundle

Status: implemented

[English](2026-08-20-desktop-profile-bundle-resolution.md) | 中文

## 问题

打包的 dsh-desktop 壳子把运行时的 `lib/bin.js` 作为 `DSH_BARE_MODULE_BASE`,应用于每个裸 loader specifier。这使封闭运行时成为内置包的权威来源,也隐藏了用户 profile 中安装的 bundle。因此更新后,只要某个 bundle 不在打包运行时中,有效的 profile 就会在输出 `dsh web:` 就绪行前失败。

## 决策

打包 `RuntimePaths` 保留显式配置的 `DSH_BARE_MODULE_BASE`,但默认不设置它。`healProfilesModuleFallback` 把内置依赖闭包链接到 `$DSH_HOME/profiles/node_modules`,因此内置包仍从打包运行时解析,而 profile 自有 bundle 从 profile 的 `node_modules` 解析。运行时 bake 验证也使用同一个未设置默认值。

## 备选方案

- **保留仅运行时锚点。** 已否决,因为应用更新后会使 profile 安装的 bundle 无法解析。
- **把每个 profile bundle 拷进安装器。** 已否决,因为用户 bundle 不属于应用负载,也可能是本地 link 或独立更新的包。
- **删除显式模块基准覆盖。** 已否决,因为由宿主拥有完整插件集的场景仍需要 `boot()` 的解析选项。

## 后果

打包的 dsh-desktop 继续为内置包保持自包含的运行时闭包,同时不接管用户的 profile bundle 集合。缺失或无效的 profile bundle 仍会明确失败;此次修复只恢复预期的 Node 解析位置。

## 验证

在 `G:\Apps\dsh-desktop` 的安装运行时上,使用仅运行时锚点可复现缺少 `dsh-whale-widget` 的失败;取消该锚点后,运行时能解析现有 profile link 并输出 `dsh web: http://127.0.0.1:<port>`。
