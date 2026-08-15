# dsh-desktop 文档

[English](README.md) | 中文

桌面壳(`apps/desktop`)的规划与实施文档。这些是桌面端专属记录,与仓库顶层 `docs/` 的治理无关。

## 索引

| 文件 | 内容 |
|---|---|
| [size-analysis.md](size-analysis.md) | 安装体积实测分析:哪部分占了多少、根因是什么 |
| [optimization-plan.md](optimization-plan.md) | 完整优化计划:体积瘦身(Part A)+ 启动界面(Part B) |
| [operating-constraints.md](operating-constraints.md) | 运行环境与进程占用约束(最重要,动手前必读) |

## ⚠️ 最重要的约束

**当前的运行环境就建立在本仓库工作目录(`J:\Projects\deepseek-harness`)之上。**

任何会触发构建、重装依赖、清理 `node_modules`、替换 `.runtime/deploy`、运行 dev server 或 `tauri build` 的操作,都可能与被正在运行的环境占用的文件发生冲突(Windows 文件锁 / `EBUSY` / `EPERM`)。

一旦遇到进程占用问题,**立即停止,不要重试、不要绕过**,然后按 [operating-constraints.md](operating-constraints.md) 里的手动步骤提示用户操作。
