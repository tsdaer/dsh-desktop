# Agent Note: 让本桌面 fork 与上游 master 同步

Status: implemented

[English](2026-09-11-upstream-master-sync.md) | 中文

## 问题

本 fork 在 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 之上有自己的数千个提交，而上游一直在前进。每次合并 `upstream/master` 都会产生同样几类冲突——本 fork 拒绝的继承 CI 工作流与 Electron `apps/desktop` 目录树、中文侧也被上游重写的双语配对、生成目录以及锁文件——每一类都只有一个正确解法。此前没有任何地方记录这些解法，因此每次同步都要重新推导；一旦解错，要么复活本 fork 已丢弃的自动化，要么静默丢掉某项桌面端能力。

## 决策

同步把 `upstream/master` 合并进 `feat/tauri-shell`，并从合并前的检查点分支开始，以便把解决后的树与合并前的树对比。解决依据[分歧登记页](../../../../docs/fork-divergence.zh.md)与四条固定规则。

**被拒绝的上游目录树一律删除，不做合并。** 合并带入的 `.github/workflows/` 下除本 fork 自有桌面工作流之外的文件，以及上游新增的 `apps/desktop/` 下文件，都用 `git rm` 删除。上游文件与本 fork Tauri 外壳也不会落到同一路径，因此判定依据是相对 `HEAD` 的新增路径状态，而不是目录名。

**双语配对先取上游一侧，再重新施加本 fork 的改动。** 上游运行着本 fork 继承的同一套翻译流程，其中包含机械化的链接改写，因此它的中文侧通常是更新的基线。在其上重新施加本 fork 的语义改动，并用 `pnpm run verify-translation-pairing --write <pair>` 重新记录配对记录；配对若在结构上仍然分歧，下一次合并会被配对驱动拦下。

**生成产物重新生成，不做合并。** `pnpm-lock.yaml`、`THIRD_PARTY_NOTICES.md`，以及 `docs/tool-catalog.md` 连同其中文版与配对记录，都在源侧解决后由其生成器产出。其中的冲突标记从不手工编辑。

**上游所有的改动要回查登记页。** 一次合并若必须改动上游所有的路径，就在同一个提交里为它补上登记行；登记页用 `git diff upstream/master --name-status` 审计。

## 复现的冲突

| 冲突 | 解法 |
|---|---|
| 上游新增的继承工作流文件 | 删除。登记页列出全部缺失的工作流，且都不恢复 |
| `apps/desktop/` 下的上游文件 | 删除。本 fork 保留 Tauri 2 外壳；上游的 Tauri 外壳不会新增 `apps/desktop` 文件 |
| `apps/desktop/package.json` | 用本 fork 的 `name`、`version`、描述、脚本、Tauri devDependencies 与 MIT 许可证替换上游的 Electron 清单 |
| `AGENTS.md`、`.gitignore` | 取上游重写后的行，同时保留本 fork 自己的行 |
| `scripts/gen-tool-catalog.ts` | 按上游顺序取上游新增的工具条目，并把本 fork 的 `bash-wsl` 条目重新插回 `tool-bash` 之后 |
| `scripts/ci-workflow.spec.ts` | 原样保留上游的 describe。该 spec 读取本 fork 不携带的工作流，因此以 `ENOENT` 失败；登记页把该失败记为预期 |
| `pnpm-workspace.yaml` | 去掉上游为 Electron 打包器新增的 `patchedDependencies` 条目，因为未使用的补丁会让 `pnpm install` 失败 |
| 双语 Agent Note 与 README 配对 | 取上游中文侧，重新施加本 fork 的改动，并重新记录配对记录 |
| `pnpm-lock.yaml`、`THIRD_PARTY_NOTICES.md`、`docs/tool-catalog.*` | 先取上游版本，再在 `pnpm install` 之后重新生成 |

## 考虑过的替代方案

**把本 fork 变基到 `upstream/master` 而不是合并。** 变基会重放本 fork 的数千个提交，而每一个都会撞上这次合并只需解决一次的那些上游文件。它还会重写其他克隆所跟踪分支的已发布历史。合并则保留本 fork 的提交及其评审历史。

**采用上游的 Electron 桌面目录树并放弃 Tauri 外壳。** 本 fork 建立时已否决，每次同步也再次否决：桌面版交付的是带自有打包、更新器与 WSL 集成的 Rust 外壳，上游的 Electron 外壳不提供其中任何一项。

**把 `scripts/ci-workflow.spec.ts` 裁剪到本 fork 携带的工作流。** 这会把一个已有文档说明的预期失败，变成每次上游新增流水线断言都要重新裁剪的 spec，并隐藏本 fork 不再测试的那些上游保证。原样保留上游的 describe 会让这一缺口保持可见。

**在合并时手工解决生成文件。** 目录、声明与锁文件由同一次改动已经解决过的源派生；手工合并它们会产出被新鲜度门禁拒绝的树，而生成器才是其内容的唯一权威。

## 后果

同步变得可重复：每一类冲突的解法都已写下，登记页则是一份"不得复活"的清单。代价是本 fork 永久携带一组冲突——工作流删除与桌面目录树在每次合并时都要按删除解决——以及只要某次同步漏掉登记行，登记页就会过期，而这只有 `git diff upstream/master` 审计才能发现。
