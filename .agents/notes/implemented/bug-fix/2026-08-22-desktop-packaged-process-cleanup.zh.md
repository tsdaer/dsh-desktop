# Agent Note: Desktop packaged process cleanup verification

Status: implemented

[English](2026-08-22-desktop-packaged-process-cleanup.md) | 中文

## 问题

Linux 和 macOS 打包冒烟检查可能漏掉在桌面壳停止期间被重新托管的 bundled Node 进程。壳子忽略终止信号时,无上限的等待也可能让失败的冒烟任务一直挂起。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 记录 `ps -eo pid=,ppid=,args=` 快照,并同时按父子关系和命令行中的目标命名 Node sidecar 识别进程。停止流程用有上限的截止时间等待壳子及所有已记录的受管理进程;优雅停止失败后会把进程组升级为 `SIGKILL`,并报告仍存在的受管理进程 id。临时目录删除使用 Node 的有界重试,让 Windows 有时间释放安装器和卸载器文件句柄。目标规格提供 sidecar basename,因此 Linux 和 macOS 检查不会静默复用主机 Node 名称。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 覆盖进程快照解析,在不匹配 runner 中无关系统 Node 进程的前提下检测被重新托管的目标 sidecar,并验证有界的临时目录删除策略。现有目标参数、安装包入口和后代进程测试仍保留在同一测试套件中。

## 结果

目标原生安装包冒烟检查现在会在打包壳子或其 bundled Node 在停止后仍存活时确定性失败;卡住的进程会在报告失败前得到最后一次终止尝试。该检查仍观察真实的打包入口,不会建立终端、更新、最低发行版或 GUI 证据。

## 相关记录

打包启动范围和剩余平台验收要求由[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md)定义。安装包冒烟实现记录在[桌面 Linux 打包启动冒烟](../feature/2026-08-22-desktop-linux-packaged-smoke.md)中。

## 考虑过的方案

**只检查子进程树。** 放弃,因为运行时子进程可能在停止期间被重新托管,后续父子快照中看不到它但它仍然存活。

**对优雅停止使用无上限等待。** 放弃,因为忽略终止信号的打包进程会让发布冒烟一直挂起,而不是产生有上限的失败并尝试清理。

**匹配所有名为 `node` 的进程。** 放弃,因为冒烟检查必须识别目标 sidecar,不能把 runner 所有的无关 Node 进程报告为失败。
