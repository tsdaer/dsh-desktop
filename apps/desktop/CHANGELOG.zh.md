# 更新日志

dsh-desktop 的所有重要变更都记录在本文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循[语义化版本](https://semver.org/spec/v2.0.0.html)。draft-release workflow 会把对应版本的章节复制到 GitHub release 的 notes 里。

## [未发布]

## [0.1.0] - 2026-08-15

### 新增

- 启动界面，带启动前环境检测（WebView2、Node sidecar、运行时、数据目录、API Key）。
- WebView2 在安装期安装（`embedBootstrapper`），并提供启动界面的修复链接。
- 运行时负载体积门禁（`pnpm --filter @deepseek-ai/dsh-desktop size-check`）。
- 以桌面版本号为准的 draft-release workflow。

### 变更

- 打包运行时改为生产依赖部署 + 单平台原生预编译裁剪，负载从约 573.8 MB 降到约 185.7 MB。
- 应用版本号以 `package.json` 为唯一来源，打包时同步进 `tauri.conf.json`。

### 修复

- 打包启动：剥掉 `resource_dir()` 返回的 `\\?\` verbatim 前缀（node 的 realpath 会因此失败）。
- 打包启动：把桥接行合并进 profile 的空 `[]` 补丁，而不是追加到其后。
- 打包启动：桥接包解析层级修正（比原来深一层）。
