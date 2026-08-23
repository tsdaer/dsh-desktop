# dsh-desktop 优化计划

目标：把安装体积从 ~660 MB 压到 ~190 MB（runtime ≤ ~100 MB），并引入带环境检测的启动界面（splashscreen）。

## 实施进展（截至当前）

- **M1 完成**：`bake-runtime.mjs` 改用 `--prod` 部署（原计划的「专用运行时清单」经实测不必要——既有 scan/bake/boot 自愈循环即可补齐 autoInstallPeers 与配置引用的插件，故未新增包），dev 工具链全部退出运行时。
- **M2 完成**：`pruneRuntime` 单平台化 node-pty（62.6 MB → 2.6 MB）；sharp 确认被 `dsh-attachment-local` 使用、已单平台，保留。
- **M3 完成**：`scripts/size-report.mjs --check` 体积门禁（`size-check` 为 bake 后本地步骤，不挂 CI 全量 gate）。
- **M4 完成**：splashscreen 启动界面（双窗口 + `run_checks` 环境检测 + `splash-status` 事件协议 + 重试），`cargo check` 通过。
- **M5 完成**：`webviewInstallMode: embedBootstrapper` + splash「下载/修复 WebView2」链接（tauri-plugin-opener），`cargo check` 通过。
- **M6 已分析**：pi-ai（多 provider）与 session-telemetry-otel（遥测）均为 dsh-base `cordis.patch.yml` 里有意挂载、默认 dormant/DISABLED 的合法产品面，~60 MB 属预留能力，裁掉需产品决策，暂缓（详见 [size-analysis.md](size-analysis.md#优化进展已落地)）。
- **待办**：仅剩手动 `pnpm --filter @deepseek-ai/dsh-desktop bundle` 实测安装包与 GUI。
- **结果**：runtime 573.8 MB → **185.7 MB**（-68%），见 [size-analysis.md](size-analysis.md#优化进展已落地)。

> 完整 GUI / 安装包仍需手动 `pnpm --filter @deepseek-ai/dsh-desktop bundle` 实测（涉及 NSIS 下载与 GUI 弹窗，未在会话内自动执行）。

## 0. 现状与目标

| 指标 | 现状 | 目标 |
|---|---|---|
| `resources/runtime` | 573.8 MB / 50,746 文件 | ≤ ~100 MB |
| `dsh-node.exe` sidecar | 83.0 MB | 83.0 MB（架构固有，压缩进包约 30 MB） |
| 安装后解包总量 | ~660 MB（+WebView2 150–200） | ≤ ~190 MB |
| NSIS 安装包 | 114.9 MB | ~50–60 MB |

两条工作线：**Part A 体积优化**（根因在 `bake-runtime.mjs` 的部署方式）、**Part B 启动界面**（把现有 `src/index.html` 的简陋 loading 页升级为带环境检测与建议的 splashscreen）。

---

## Part A — 体积优化

### A1 根因修复：引入专用运行时清单，改用 `--prod` 部署

根因见 [size-analysis.md](size-analysis.md#根因)。做法（有现成先例 `packages/bundle/{base,headless,web-app}`）：

- 新建 `packages/bundle/desktop-runtime/`，包名 `@deepseek-ai/dsh-desktop-runtime`，其 `dependencies` 精确列举桌面运行时需要的全部包：
  - `@deepseek-ai/dsh`（CLI 本体）
  - `@deepseek-ai/dsh-web-app`（web profile 插件，已把 host + client-ui 插件声明为 `dependencies`）
  - 当前在 CLI `devDependencies` 里、但运行时必需的核心插件：`dsh-agent`、`dsh-session`、`dsh-settings`、`dsh-subagent`、`dsh-system-prompt`、`dsh-tools`、`dsh-llm`
  - 桥接包：`dsh-desktop-bridge`、`dsh-desktop-bridge-client`
  - **显式排除** `dsh-llm-mock-server`、`dsh-loader-smoke`（纯测试）
- `bake-runtime.mjs` 改为 `pnpm deploy --filter @deepseek-ai/dsh-desktop-runtime --prod --legacy --config.nodeLinker=hoisted`。
- 保留 `scanMissing` + 逐轮 bake + `verifyBoot` 三段安全网。

**验收**：`.runtime/<rust-target>/deploy/node_modules` 中不再出现 `mermaid`/`typescript`/`oxlint`/`eslint`/`lefthook`/`tsx`/`rolldown`/`esbuild`/`vitest`/`jsdom`/`jscpd`/`knip`/`publint`；且 `verifyBoot` 仍读到 `dsh web:` 就绪行。

> 预期收益：一次性砍掉 ~300+ MB 构建/静态检查/文档工具链。

### A2 文档渲染依赖去重（mermaid 生态）

- A1 落地后 mermaid/cytoscape/d3/dagre/dompurify/roughjs 应自动消失；若仍有残留，单独评估是否改 `optionalDependencies`。
- **katex 是合法运行时依赖**（`packages/client/ui-primitives` 的 `dependencies`，渲染数学公式），保留，不与 mermaid 混淆。

### A3 原生二进制按目标单平台化

- **node-pty（62.6 MB → ~30 MB）**：在 `bake-runtime` 加 prune 步骤，只留目标规格指定的 `prebuilds/<native-platform-key>` 与运行必需文件，删其他平台和 winpty 源码。
- **sharp（@img 18.3 MB）**：先确认是否被运行时代码使用；不用就裁，用就只留 `sharp-win32-x64`。
- 同类规则写成白名单 prune 脚本，对仍存在的原生包（esbuild/lightningcss/@rolldown）只留当前目标的变体。

> 预期收益：~35–55 MB。

### A4 第三方 LLM/遥测 SDK 按需裁剪（可选、低优先级）

- 先确认桌面 profile 实际挂载的 provider；DeepSeek-only 则保留 `openai`，其余（`@opentelemetry`/`@mistralai`/`@anthropic-ai`/`@google`/`@aws-sdk`）移到 `dsh-llm` 提供者包的 `optionalDependencies` 或拆独立可选包。
- 用 `verifyBoot` 冷启动验证可达性：loader 引用到的包会自动补回，缺失会被捕获，因此安全。

> 预期收益：~40–60 MB，改动面大，放最后。

### A5 WebView2 安装策略

- 当前未配置 `bundle.windows.webviewInstallMode`，默认 `downloadBootstrapper`（安装时联网下载 ~150 MB）。
- 决策：
  - `downloadBootstrapper`/`embedBootstrapper`：安装包最小，依赖目标机联网（推荐默认 `embedBootstrapper`，约 +2 MB）。
  - `offlineInstaller`：完全离线，但安装包 +150 MB，与本轮瘦身冲突。
  - `skip`：安装包最小，假设目标机已有 WebView2（Win11 自带，Win10 未必）。
- 与 B1 联动：把“WebView2 缺失/版本过低”的检测与修复指引放进 splash。

### A6 度量与门禁（防回归）

- 新增 `apps/desktop/scripts/size-report.mjs`：统计 runtime 总大小、Top-20 包、NSIS exe 大小。
- 加 gate：断言 runtime ≤ 阈值，且已知 dev 工具名不在 `node_modules` 顶层；超限即失败。

---

## Part B — 启动界面（splashscreen）

参考官方文档 [Splashscreen](https://v2.tauri.app/zh-cn/learn/splashscreen/)。

### B1 关键约束：WebView2 是任何 WebView（含 splash）的前置条件

- splashscreen 本身是 WebView，**要渲染就必须先有 WebView2**，所以“下载/安装 WebView2”不可能发生在 WebView 版 splash 内部。
- 正确分层：
  1. **安装层（NSIS）**：用 `webviewInstallMode` 在安装时获取 WebView2，自带原生进度条 —— 这是“WebView2 下载”真正发生的地方。
  2. **splash 层（应用内）**：只做 WebView2 版本/健康检测 + 修复引导（例如“重新安装 WebView2”按钮，通过 `tauri-plugin-shell` 拉起 Evergreen bootstrapper，或 `tauri-plugin-opener` 打开官方下载页）。
- 可选增强（非首版）：`webviewInstallMode: skip` + Rust 在创建任何窗口前用 win32 检测注册表，缺失时 spawn Evergreen bootstrapper（自带原生进度 UI），完成后再建窗。

### B2 双窗口配置（`tauri.conf.json`）

```jsonc
"app": {
  "windows": [
    {
      "label": "splashscreen",
      "url": "splashscreen.html",
      "width": 420, "height": 520,
      "center": true, "resizable": false, "decorations": false,
      "alwaysOnTop": true, "skipTaskbar": true, "visible": true
    },
    {
      "label": "main",
      "visible": false,          // 关键：默认隐藏，就绪后再 show
      "width": 1280, "height": 800,
      "minWidth": 800, "minHeight": 560,
      "decorations": false, "dragDropEnabled": false
    }
  ]
}
```

- `main` 保持现有 frameless 配置不变，只加 `"visible": false`。
- 新增 `src/splashscreen.html`（风格对齐现有 `index.html` 深色主题）。

### B3 环境检测清单与事件协议

Rust 启动后按序执行，逐项通过 `emit("splash://status", { step, status, message, suggestion })` 推给 splash。四态：`pending / running / ok / warn / error`。

| # | 检测项 | 阻塞性 | 建议 |
|---|---|---|---|
| 1 | WebView2 版本 ≥ 最低要求 | warn | 过低→“重新安装 WebView2”按钮 |
| 2 | `dsh-node.exe` sidecar 存在（打包态）/ `DSH_NODE`（开发态） | error | “重新安装应用” |
| 3 | `resources/runtime/lib/bin.js` 存在 | error | “运行时缺失，请重装” |
| 4 | node-pty 当前平台 prebuild 存在 | error | “重装应用” |
| 5 | DSH_HOME 可写 / 可初始化 | error | “检查用户目录权限” |
| 6 | 可用磁盘空间 ≥ 阈值 | warn | “清理磁盘后重试” |
| 7 | `DEEPSEEK_API_KEY` / 凭证存在 | warn | “可稍后在设置里配置”，不阻塞 |
| 8 | 桥接包可复制进 profile | error | 复用现有 `ensure_bridge` 结果 |

通过后进入“运行时引导”阶段：复用 `boot()` 的 `spawn node <cli> web --port 0 --no-open` + 等待 `dsh web:` 就绪行，把进度映射成进度条。就绪 → `main_window.show()` + `splashscreen.close()`；失败 → splash 显示错误 + 可操作建议 + “重试/仍然继续”。

### B4 Rust 结构（`src-tauri/src/`）

- 新增 `env_check.rs`：`run_checks(app, tx) -> CheckReport`，逐项执行并 emit 事件；`CheckReport` 决定是否可继续。
- `main.rs` 改造：`setup` 里改为 `thread::spawn(run_splash_flow)`：
  1. 跑 `env_check`；
  2. 有 error → emit 失败事件（迁移原 `__dshBootError` 语义到事件协议）；
  3. 全通过 → `ensure_bridge` + spawn 运行时 + 等就绪；
  4. 就绪 → 关 splash、show main、navigate、注入 titlebar（保留现有 `inject_titlebar`）。
- 新增命令：`splash_continue()`（跳过 warn 继续）、`splash_open_webview2_download()`。
- 退出清理：`RunEvent::ExitRequested` 里杀运行时进程 + 关 splash 窗口。

### B5 splash UI（`src/splashscreen.html`）

- 顶部 logo + 应用名；中部检查清单（每行 icon + 文案，状态着色）；底部进度条 + 错误面板 + “重试 / 仍然继续 / 打开 WebView2 下载”按钮。
- 复用 `withGlobalTauri: true` + `@tauri-apps/api/event` 的 `listen("splash://status")`；无 Tauri 时降级为静态轮播（沿用 `titlebar.js` 的防御写法）。

### B6 与现有 `src/index.html` 的关系

- 现 `index.html` 是隐藏主窗口里的 loading 页，退化为兜底：主窗口 `show()` 前短暂停留，保留 `__dshBootError` 作为 splash 关闭后、导航完成前的最后兜底；不必删除。

### B7 能力/权限（`capabilities/`）

- `default.json`：`windows` 增加 `"splashscreen"`（本地页，`core:default`）。
- splash 需打开下载页时，新增 `tauri-plugin-shell`/`tauri-plugin-opener` 对应能力。
- `remote.json` 维持只授权 `main` + `http://127.0.0.1:*`；splash 是本地资产，不进 remote 能力。

---

## 实施顺序与里程碑

1. **M1（A1）**：建 `dsh-desktop-runtime` 清单 + `bake-runtime` 改 `--prod`，先跑通验证 boot。← 收益最大，风险集中在依赖建模，先做。
2. **M2（A3）**：node-pty/sharp 单平台 prune。
3. **M3（A6）**：size-report + 门禁，锁定 M1/M2 成果。
4. **M4（B2–B7）**：splash 双窗口 + env_check + UI + 能力。
5. **M5（A5）**：WebView2 `webviewInstallMode` 决策落地，接 M4 的检测/修复引导。
6. **M6（A4，可选）**：provider SDK 裁剪。
7. **M7**：收尾文档（`apps/desktop/README.md`）、尺寸对比表。

## 验收标准

- `pnpm --filter @deepseek-ai/dsh-desktop bundle` 成功产出 NSIS 安装包。
- size-report 显示 runtime ≤ ~100 MB、安装包 ≤ ~60 MB，且 dev 工具名不在 node_modules 顶层。
- 冷启动（全新 DSH_HOME、无 API key）：splash 逐项检测、提示“未配置 API key”、不阻塞进入主界面。
- 断开 dsh-node.exe / 删除 runtime：splash 停在对应 error 并给出可操作建议。
- 打包态首次启动：桥接包离线复制到 profile 成功，主窗口导航到 `dsh web` 就绪 URL，titlebar 正常注入。

## 风险与备注

- **A1 是唯一有回退风险的点**：依赖建模改动触及 `apps/cli`/`packages/bundle`，需跑 `verify-cordis-config`、`verify-runtime-closure` 及 boot 冒烟，并补充 Agent Note 与快照测试。
- **WebView2 分层**（B1）是易误解点：下载归安装层，splash 只做检测+引导。
- dsh-node.exe 83 MB 是“壳里跑 Node”架构的固有成本，本轮不优化；要再降需评估把 web 服务下沉 Rust 或换更小运行时（超出本轮范围）。
