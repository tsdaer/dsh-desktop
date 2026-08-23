# Agent Note: Desktop release jobs use the validated commit

Status: implemented

[English](2026-08-23-desktop-release-uses-validated-commit.md) | 中文

## 问题

桌面发布 workflow 只在开始时校验一次版本 tag,但后续 job 按 tag checkout 时,如果 tag 在校验后移动,就可能读取另一个 commit。这样构件、updater manifest 或 release note 可能来自发布记录中未记录的源码。

## 决定

所有读取源码树的桌面发布 job 都 checkout `needs.validate.outputs.commit`,并验证 `git rev-parse HEAD` 与该值一致。draft 和已签名 macOS 附件 job 也使用已校验的 commit,因此它们的构件清单和元数据与目标原生构建来自同一个源码快照。

## 测试

`scripts/desktop-release-workflow.spec.ts` 检查每个读取源码的发布 job 的 checkout ref 和 commit 校验。测试继续要求目标原生 job、构件暂存、updater 生成和仅创建 draft 的发布行为。

## 结果

从校验到构件发布,release workflow 使用同一个源码快照。移动后的 tag 或错误的 checkout 解析会在目标构建或 draft 刷新使用它之前让 job 失败。workflow_dispatch 仍会因发布入口要求 tag 而失败。

## 考虑过的方案

**继续 checkout 已校验的 tag。** 放弃,因为 tag 名称是可变引用,不会把已校验的 commit 身份传递给后续 job。

**只信任 checkout ref,不做显式校验。** 放弃,因为 job 无法证明 runner 实际解析到了预期 commit,未来修改 checkout 配置也可能静默削弱发布约束。
