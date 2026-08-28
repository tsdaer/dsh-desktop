# Agent Note: Desktop packaged process cleanup verification

Status: implemented

[English](2026-08-22-desktop-packaged-process-cleanup.md) | 中文

## 问题

目标原生安装包冒烟检查不能漏掉在桌面壳停止期间被重新托管的 bundled Node 进程。壳子或受管理进程忽略终止信号时,每次等待也必须保持有界。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 记录进程快照,并同时按父子关系与解析出的绝对路径识别已安装 Node sidecar。精确的路径 token 匹配会把安装包的 `dsh-node` 或 `dsh-node.exe` 进程与 runner 中无关或只有相似前缀的命令区分开。停止流程用有上限的截止时间等待壳子及所有受管理进程。受管理进程比壳子存活更久时,最终升级会重新取得快照,逐个强制终止仍可按父子关系或精确 sidecar 路径识别的进程,而不是再次操作已经退出的壳 PID。强制终止成功即可满足清理要求;只有升级后受管理进程仍存活才报告失败。Windows 冒烟使用 `_?=<install-directory>` 调用 NSIS 卸载器,阻止临时自复制并让命令保持同步;临时 home 删除仍保留有界重试,等待最后的文件句柄释放。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 覆盖进程快照解析,按精确路径检测被重新托管的已安装 sidecar 且不会匹配 runner 的无关系统 Node 进程,并验证强制层会定位所有剩余的打包进程 PID 且接受它们随后退出。它还固定有界的壳进程升级、同步 NSIS 卸载参数和有界的临时目录删除策略。现有目标参数、安装包入口和后代进程测试仍保留在同一测试套件中。

## 结果

目标原生安装包冒烟检查现在会在打包壳子或其 bundled Node 在停止后仍存活时确定性失败;卡住的进程会在报告失败前得到最后一次终止尝试。该检查仍观察真实的打包入口,不会建立终端、更新、最低发行版或 GUI 证据。

## 相关记录

打包启动范围和剩余平台验收要求由[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.zh.md)定义。安装包冒烟实现记录在[桌面 Linux 打包启动冒烟](../feature/2026-08-22-desktop-linux-packaged-smoke.zh.md)中。

## 考虑过的方案

**只检查子进程树。** 放弃,因为运行时子进程可能在停止期间被重新托管,后续父子快照中看不到它但它仍然存活。

**对优雅停止使用无上限等待。** 放弃,因为忽略终止信号的打包进程会让发布冒烟一直挂起,而不是产生有上限的失败并尝试清理。

**匹配所有名为 `node` 的进程。** 放弃,因为冒烟检查必须识别目标 sidecar,不能把 runner 所有的无关 Node 进程报告为失败。
