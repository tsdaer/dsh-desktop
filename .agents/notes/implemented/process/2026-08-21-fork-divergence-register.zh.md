# Agent Note: 用一份双语页面登记上游分歧

Status: implemented

[English](2026-08-21-fork-divergence-register.md) | 中文

## 问题

本 fork 新增了 Windows 桌面版，为支撑它改动了共享 harness 代码、仓库脚本、根配置与继承来的文档。这些改动没有任何记录。`AGENTS.md` 与 README 陈述了立场 —— 桌面端工作留在 `apps/desktop` 下、共享改动需要 harness 价值 —— 但都没有说明哪些上游所有的路径已被改动，以及为什么。

由此产生两项代价。从上游合并时，可能在无从比对的情况下静默丢弃或复活某处 fork 改动。另外，由刻意分歧导致的失败看起来像缺陷：`scripts/ci-workflow.spec.ts` 在此处因缺失 `.github/workflows/ci.yml` 而失败，原因是本 fork 不携带任何继承工作流，而此前没有任何文档解释这一点。

## 决策

[docs/fork-divergence.zh.md](../../../../docs/fork-divergence.zh.md) 即登记表：每个上游所有的路径占一行，写明差异并链接持有原因的 Agent Note。它把"上游所有"定义为 `apps/desktop/` 之外的一切，指明桌面发布工作流是本 fork 自有的文件，并连同预期的 `ci-workflow.spec.ts` 失败一起记录被移除的上游自动化。

该义务写在根 [AGENTS.md](../../../../AGENTS.md) 的标准指令里，因为那是 agent 改代码前会读的文件。[README](../../../../README.zh.md) 陈述立场并链接登记表，面向从不打开 `AGENTS.md` 的读者。行必须在触碰上游所有路径的同一次改动里补上。

## 备选方案

- **把清单放进 `AGENTS.md`。** 依该仓库文档标准自身的规则否决：该文件为 1,946 词，而目标是 1,600 词，因此其上限被冻结，持续增长的清单无法放在那里。仅仅为这条义务腾出空间，就需要删掉一句与 `docs/AGENTS.md` 重复的预算政策。
- **把清单放进 README。** 已否决，因为 README 是双语对，每加一行都要同步对侧与 sidecar,这会给"一处小的共享修复"这一常规情形加税。
- **在 `AGENTS.md` 与 README 中各存一份。** 已否决，因为持续增长的清单存两份必然漂移，而"一个事实一个归属"正是本仓库强制执行的标准。
- **从 `git diff upstream/master` 推导清单。** 已否决，因为 diff 只报告路径、从不报告原因，而原因恰是未来合并所需的部分。diff 仍是审计登记表完整性的手段。

## 后果

从上游合并时有一份需要保留的刻意差异清单，评审者也能区分刻意分歧与意外改动。登记表是散文，因此某次改动若跳过它的行就会过期；标准指令与本记录是唯一的约束手段，而对上游做 `git diff` 是发现遗漏的审计方式。

## 验证

`pnpm run doc-sync` 报告 28 passed, 0 failed，覆盖新双语对的语言切换链接、登记表中的每个相对链接，以及恢复到 1,946/1,950 的 `AGENTS.md` 字数上限。
