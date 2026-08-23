# dsh-desktop 安装体积分析

实测数据（截至本次分析），用于定位“安装出来的内容非常大”的根因。

## 总量

| 内容 | 体积 | 说明 |
|---|---|---|
| `resources/runtime/`（Windows x64 源目录为 `src-tauri/runtime/windows-x64`） | **573.8 MB** / 50,746 个文件 | 主体，dsh CLI 全量依赖闭包 |
| Windows x64 Node sidecar | 83.0 MB | `externalBin: ["binaries/node"]`，Node 22.23.1 |
| `dsh-desktop.exe` | 4.3 MB | Tauri/Rust 壳本体，可忽略 |
| NSIS 安装包 | 114.9 MB | 上面全部经 LZMA 压缩后的结果 |
| WebView2 Runtime | ~150–200 MB（首次安装时按需下载） | 未配置 `webviewInstallMode`，默认 `downloadBootstrapper` |

- 安装后解包总量 ≈ **660 MB**；目标机没有 WebView2 时再加 ~150–200 MB。
- `src-tauri/target/`（release 1.9 GB / debug 7.6 GB）是 cargo 编译缓存，**不是**装给用户的内容，不计入。

## runtime 573.8 MB 的构成

问题核心：这份“运行时”混入了大量与运行桌面程序无关的内容。按 `node_modules` 顶层实测：

### 1. 纯死重 —— dev/build/lint/docs/test 工具（运行时 0 处 import）

| 项 | 体积 |
|---|---|
| mermaid 生态（mermaid 79.7 + cytoscape 5.4 + cytoscape-fcose 8.3 + @mermaid-js 11.7 + d3/dagre/dompurify/roughjs 等） | ~115 MB |
| TypeScript | 23.2 MB |
| oxlint 全家（@oxlint-tsgolint 21.7 + @oxlint 13.5 + oxlint 2.2） | ~42 MB |
| rolldown/rollup（@rolldown 20 + @rollup 4.4 + rollup 2.7） | ~28 MB |
| lefthook | 13.5 MB |
| tsx | 11.8 MB |
| esbuild | 10.1 MB |
| lightningcss | 9.6 MB |
| eslint 全家 | ~10 MB |
| jsdom + @testing-library | ~9 MB |
| vitest / jscpd / knip / @babel / @yarnpkg / @vscode / @types | ~21 MB |

> 实测：运行时 `@deepseek-ai` 的 lib 中对 `mermaid` 的 import 为 **0**；mermaid 只是根 `package.json` 与 `website` 的 devDependency，漏进来的纯垃圾。

**这一类合计 ~300 MB。**

### 2. 多平台原生二进制（只需 win-x64）

| 项 | 体积 | 可省 |
|---|---|---|
| node-pty | 62.6 MB | win32-x64 仅 28.5 MB；win32-arm64 26.7 + darwin + winpty 源码可删，省 ~34 MB |
| @img/sharp（sharp-win32-x64） | 18.3 MB | 先确认是否真用到 |

**可省 ~35–55 MB。**

### 3. 第三方 LLM / 遥测 SDK（按需裁剪）

`@opentelemetry` 18.1 + `@earendil-works` 4.6 + `@google` 13.7 + `@mistralai` 10.4 + `@anthropic-ai` 3.9 + `@aws-sdk/@smithy` 5.2 + `@modelcontextprotocol` 4.1 ≈ **60 MB**。若桌面只接 DeepSeek（OpenAI 兼容），仅 `openai`（7.2 MB）需保留。

### 真正需要保留的

产品代码 `@deepseek-ai/*` 只有 **20.5 MB**；其中最大的是 `dsh-web-frontend`（4.4 MB，前端 dist）。

## 根因

`apps/desktop/scripts/bake-runtime.mjs:76`：

```js
corepack pnpm deploy --filter @deepseek-ai/dsh --legacy --config.nodeLinker=hoisted
```

1. **未用 `--prod`**：web profile 的核心运行时插件被建模成 `apps/cli` 的 `devDependencies`（`dsh-agent`、`dsh-session`、`dsh-settings`、`dsh-subagent`、`dsh-system-prompt`、`dsh-tools`、`dsh-llm` 等），`--prod` 会把它们一起剪掉，所以只能用 FULL。
2. **FULL + hoisted 把整条 dev 依赖链与根 devDependencies 一起漏进运行时**：TypeScript/oxlint/eslint/lefthook/jscpd/tsx/rolldown/mermaid 等全部被带进来。

## 结论

体积大是因为把“整仓库的构建工具链 + 全平台原生二进制 + 全 provider SDK”当运行时打进了 `resources/runtime`，而不是 Tauri 本身。修复方向见 [optimization-plan.md](optimization-plan.md)。

## 优化进展（已落地）

| 指标 | 优化前 | 优化后 |
|---|---|---|
| resources/runtime | 573.8 MB / 50,746 文件 | **185.7 MB / 32,189 文件**（-68%） |
| node-pty | 62.6 MB | **2.6 MB**（仅 win32-x64 prebuild，去 .pdb 与构建产物） |
| 安装后解包总量（估算） | ~660 MB | ~270 MB |
| NSIS 安装包 | 114.9 MB | 待重测（需重新 bundle） |

手段：

- **M1**：`bake-runtime.mjs` 改用 `--prod` 部署，配合既有 scan/bake/boot 自愈循环。mermaid/typescript/oxlint/eslint/lefthook/tsx/rolldown/esbuild/vitest/jsdom/jscpd/knip/publint 等 dev 工具链全部退出运行时。
- **M2**：`pruneRuntime` 单平台化 node-pty（保留 win32-x64 prebuild、删除 .pdb/多平台/构建产物）。sharp（@img 18.4 MB）确认为 `@deepseek-ai/dsh-attachment-local` 的运行时依赖，保留，且已单平台（仅 sharp-win32-x64）。
- **M3**：`scripts/size-report.mjs --check` 体积门禁（预算 200 MB + dev 工具泄漏断言）；`pnpm --filter @deepseek-ai/dsh-desktop size-check` 可运行。

剩余可选项（M6）——已分析，结论为「有意挂载，不建议裁」：

- `@mistralai` + `@anthropic-ai` + `@google` + `@aws-sdk` 全部由 `@earendil-works/pi-ai` 引入，后者是 `dsh-llm-pi-ai` 的依赖；`dsh-llm-pi-ai` 在 dsh-base 的 `cordis.patch.yml` 里以「dormant」挂载（零路由，直到用户在 web Models 页配置 `llm-pi-ai:` 才注册多 provider 路由）。这是有意的多 provider 能力。
- `@opentelemetry` 由 `dsh-session-telemetry-otel` 引入，同样默认挂载但 `DSH_TELEMETRY_MODE` 默认 DISABLED（显式选择才上报）。

因此这 ~60 MB 是「为可选的多 provider + 遥测能力预留、默认不激活的合法产品面」，不是可无脑删除的死重；裁掉需要产品决策（例如发布一个 DeepSeek-only 的桌面版）。

**产品决策（2026-08-22）：保留。** 该载荷是可选多 provider 与显式遥测能力的合法产品面，默认不激活；裁剪将交付 DeepSeek-only 桌面版并带来新的 bundle profile 与维护成本。

> 备注：体积门禁 `size-check` 依赖当前 target 的 `.runtime/<rust-target>/deploy` bake 产物，只应在桌面 bundle 流程（bake 之后）调用，不宜挂进 clean-tree 的 CI 全量 gate。
