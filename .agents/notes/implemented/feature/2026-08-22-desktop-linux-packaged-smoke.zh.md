# Agent Note: Desktop Linux packaged startup smoke

Status: implemented

English | [English](2026-08-22-desktop-linux-packaged-smoke.md)

## 问题

Linux 构件生成和清单校验不能证明 AppImage 或 deb 能找到自身资源、启动目标 sidecar、达到运行时就绪状态,也不能证明卸载已安装包时不会留下受管理的进程。

## 决定

`apps/desktop/scripts/packaged-smoke.mjs` 负责 Linux x64 安装包冒烟检查。AppImage 会在目标 runner 上解包,deb 通过 `dpkg` 安装;两者都在 runner 的虚拟显示器下启动打包后的可执行文件,并使用临时 `DSH_HOME`。冒烟检查会在启动前创建用户数据标记,要求壳子输出就绪 URL,终止 detached 进程组,确认记录到的运行时子进程已经退出,并在移除 deb 后检查 home 和标记仍然存在。发布工作流在打包完成、上传构件之前运行这两条安装包路径。

该冒烟检查不把 Linux 标记为受支持的发布目标。它证明安装包启动、目标资源查找、受管理进程清理和 deb 移除;终端交互、更新安装、最低发行版覆盖和 GUI 证据仍是独立要求。

## 测试

`apps/desktop/scripts/packaged-smoke.spec.mjs` 固定 Linux-only 参数校验、子进程发现、安装包资源查找和用户数据保留行为。该脚本已纳入桌面 bundle 准备阶段的测试。发布 job 提供 `xvfb-run`,从解包后的 AppImage 运行应用,并在一次性 runner 中安装后清除 deb。

## 结果

目标原生 Linux runner 在打包壳子无法启动其 bundled runtime,或移除包后冒烟进程树仍存活时会使发布 job 失败。该检查使用真实安装包入口,但不替代规定的已安装 GUI、终端、更新和基线发行版证据。

## 相关记录

发布顺序和剩余 Linux 验收要求由[桌面多平台实现计划](../../proposed/feature/2026-08-22-desktop-multiplatform-support-plan.md)定义。目标选择和原生运行时检查由[桌面目标规格](2026-08-22-desktop-target-specification.md)及[按目标验证原生运行时](2026-08-22-desktop-target-native-runtime.md)定义。

## 考虑过的方案

**启动源码 CLI 而不是安装包。** 放弃,因为这会绕过 Tauri 资源查找、打包 sidecar 和已安装构件的进程生命周期。

**只检查安装包元数据而不启动。** 放弃,因为元数据不能证明 WebKit/Tauri 启动、资源路径和目标 sidecar 能协同工作。

**安装 deb 但不移除。** 放弃,因为 Linux 发布要求包含卸载行为和用户数据保留;冒烟检查必须清理一次性 runner,并断言 `DSH_HOME` 仍然存在。
