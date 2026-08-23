# Agent Note: dsh-desktop 封闭打包运行时

Status: implemented

[English](2026-08-15-desktop-packaged-runtime.md) | 中文

## 问题

dsh-desktop 的 Tauri 壳子通过 spawn 一个跑着 CLI 的 Node 进程来启动 dsh web profile。要让安装包可分发,运行时(CLI、web 前端、插件、原生 addon)必须随应用携带,不指向任何 checkout 路径,且启动时不依赖 npm。

## 决策

用 `apps/desktop/scripts/bake-runtime.mjs` 产出运行时:

1. 对 dsh CLI 闭包执行 `pnpm deploy --legacy --prod --config.nodeLinker=hoisted`。生产依赖部署会丢掉工作区的 dev/build/lint/docs 工具链(TypeScript、oxlint、eslint、mermaid —— 原 573.8 MB 负载里的约 300 MB)。web profile 的核心包仍通过 `dsh-base` 的依赖可达,而下面的 scan/bake 循环会补回 `--prod` 剪掉的每个 auto-installed peer 与配置引用插件,因此无需专门的清单包。hoisted 链接是必须的:部署 profile 的回退目录必须在一个父级查找层暴露运行时闭包,而 isolated 布局只在顶层暴露直接依赖。
2. 补烤 `pnpm deploy` 不会装的 auto-installed peers(workspace 的 `autoInstallPeers: true` 不会被 deploy 复现)以及桌面桥接包 —— 只拷贝每个 workspace 包的 `files` 字段内容,绝不拷贝其 `node_modules`。
3. 单平台化原生预编译产物:`node-pty` 会带上所有平台、Windows `.pdb` 符号和构建期源码;`pruneRuntime` 只保留 `win32-x64` 预编译(62.6 MB → 2.6 MB)。`scripts/size-report.mjs --check`(预算 + dev 工具泄漏断言)在每次 bake 后钉住负载。
4. 用一次性 `DSH_HOME` 启动部署出的 CLI 验证,要求出现 `dsh web:` 就绪行。

内置裸插件名通过修复后的 `$DSH_HOME/profiles/node_modules` 回退目录解析,其中的链接指向打包运行时。打包桌面启动默认不设置 `DSH_BARE_MODULE_BASE`,使 profile 安装的 bundle 从 profile 自己的 `node_modules` 解析;由宿主拥有完整插件集的场景仍可显式设置。 [profile 自有 bundle 解析修正](../bug-fix/2026-08-20-desktop-profile-bundle-resolution.md)记录了打包默认值不能使用仅运行时锚点的原因。

`main.rs` 的打包解析:环境变量接线(`DSH_CLI`/`DSH_NODE`/`DSH_BARE_MODULE_BASE`/`DSH_BRIDGE_TARBALL`)优先(dev 启动器);没有 `DSH_CLI` 的构建回退到 `resources/runtime/lib/bin.js`、产品自有 sidecar `dsh-node.exe` 或 `dsh-node`(Tauri `externalBin`,gitignore,由 `scripts/fetch-node-sidecar.mjs` 拉取)和离线桥接拷贝。桥接包随运行时携带,首次启动拷入 profile —— 打包应用没有 npm,dev 的 npm tarball 路径仅保留给 dev 启动器。

这个封闭安装暴露了两个 Windows 打包事实,都归这里所有:

- `resource_dir()` 返回带 `\\?\` 前缀的 verbatim 路径;node 的 `realpath` 无法解析它(在盘符上报 `EISDIR`),于是运行时在打印就绪行之前就退出了。`packaged()` 在把路径交给 node 或 `Url::from_file_path` 之前用 `dunce::simplified` 剥掉前缀。
- profile 模板的 `cordis.patch.yml` 是注释头加一个空 `[]` 列表;`install_profile_patch` 必须用桥接行**替换**那个 `[]`,而不是追加到其后(追加会产生第二个 YAML 文档,破坏 profile 解析)。桥接包也比原代码深一层解析(`resource_dir/runtime/node_modules`,从 `lib/bin.js` 往上两层)。

## 备选方案

- **isolated linker 部署** —— pnpm 默认;闭包能解析,但配置引用的插件(如 `dsh-typert-registry`)和 auto-installed peers 缺失,导致漫长的 boot 驱动补包尾巴。弃用,改选 hoisted 链接,那正是封闭安装的天然形态。
- **以完整 Node 发行版作 sidecar** —— 桥接安装还能用 npm,但桥接的 prod 依赖(`schemastery`)仍需访问 registry;要离线终究得拷贝包。sidecar 只带 `node.exe`。
- **FULL 部署(最初的选择)** —— dev/build/lint/docs 工具链漏进了负载(约 300 MB);一旦证明 `--prod` 加 scan/bake 循环能补回每个运行时插件,即弃用。

## 后果

烤出的负载约 185.7 MB(原 573.8 MB);`size-report --check` 在每次 bake 后钉住预算与 dev 工具泄漏断言。上面两个 Windows 事实记录了未来打包改动不得重新引入的防护:把未处理的 `resource_dir()` 路径交给 node,或在 profile 的空 `[]` 之后追加补丁。
