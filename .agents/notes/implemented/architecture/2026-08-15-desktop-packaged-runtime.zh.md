# Agent Note: dsh-desktop 封闭打包运行时

Status: implemented

[English](2026-08-15-desktop-packaged-runtime.md) | 中文

## 问题

dsh-desktop 的 Tauri 壳子通过 spawn 一个跑着 CLI 的 Node 进程来启动 dsh web profile。要让安装包可分发,运行时(CLI、web 前端、插件、原生 addon)必须随应用携带,不指向任何 checkout 路径,且启动时不依赖 npm。

## 决策

用 `apps/desktop/scripts/bake-runtime.mjs` 产出运行时:

1. 对 dsh CLI 闭包执行 `pnpm deploy --legacy --config.nodeLinker=hoisted` —— **全量**,不是 `--prod`:这个 monorepo 把 web profile 的运行时插件放在 CLI 的 devDependencies 里,`--prod` 正好会把 profile 需要的东西剪掉。hoisted 链接是必须的:loader 从运行时自身的 bin 解析配置引用的插件名,而 isolated 布局只在顶层暴露直接依赖。
2. 补烤 `pnpm deploy` 不会装的 auto-installed peers(workspace 的 `autoInstallPeers: true` 不会被 deploy 复现)以及桌面桥接包 —— 只拷贝每个 workspace 包的 `files` 字段内容,绝不拷贝其 `node_modules`。
3. 用一次性 `DSH_HOME` 启动部署出的 CLI 验证,要求出现 `dsh web:` 就绪行。

裸插件名通过新增的 `DSH_BARE_MODULE_BASE` 环境变量锚定到运行时:`apps/cli` 把它传给 `boot()` 的 `bareModuleBaseUrl`(文档化的封闭运行时解析锚点),裸名走宿主 node_modules,相对名仍以 profile 为基准。打包模式下 `main.rs` 把它设为运行时自身 `lib/bin.js` 的文件 URL。

`main.rs` 的打包解析:环境变量接线(`DSH_CLI`/`DSH_NODE`/`DSH_BARE_MODULE_BASE`/`DSH_BRIDGE_TARBALL`)优先(dev 启动器);没有 `DSH_CLI` 的构建回退到 `resources/runtime/lib/bin.js`、sidecar `node.exe`(Tauri `externalBin`,gitignore,由 `scripts/fetch-node-sidecar.mjs` 拉取)和离线桥接拷贝。桥接包随运行时携带,首次启动拷入 profile —— 打包应用没有 npm,dev 的 npm tarball 路径仅保留给 dev 启动器。

## 备选方案

- **isolated linker 部署** —— pnpm 默认;闭包能解析,但配置引用的插件(如 `dsh-typert-registry`)和 auto-installed peers 缺失,导致漫长的 boot 驱动补包尾巴。弃用,改选 hoisted 链接,那正是封闭安装的天然形态。
- **以完整 Node 发行版作 sidecar** —— 桥接安装还能用 npm,但桥接的 prod 依赖(`schemastery`)仍需访问 registry;要离线终究得拷贝包。sidecar 只带 `node.exe`。
- **`--prod` 部署** —— payload 减半,但丢掉了运行时插件集(CLI devDependencies);弃用。
