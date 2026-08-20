# Agent Note: 桌面拖放把真实路径放进输入框、托盘与关闭行为、资源管理器"以 dsh-desktop 打开"

Status: implemented

[English](2026-08-17-desktop-drops-tray-open-with.md) | 中文

## 问题

WebView2 对拖入的文件不暴露 `File.path`,桌面壳因此无法把真实文件系统路径交给 web 页面:桥接把非图片拖放复制进会话工作区的 `drops/` 目录并注入一段文字公告,只有图片能进入输入框。没有系统托盘,而且关闭窗口总是退出应用(杀掉运行时子进程),尽管有了托盘后"关闭即隐藏"才是自然行为。最后,从资源管理器打开一个文件夹运行应用时,应用不知道用户指的是哪个文件夹,用户只能手动重新打开工作区。

## 决策

**Tauri 壳接管 OS 拖放。** 主窗口的 `dragDropEnabled: false` 已移除(默认开启),Tauri 的拖放处理器因此能给出真实路径;浏览器页本身永远看不到 OS 拖拽过程。桥接 client 用 `__TAURI__.webview.getCurrentWebview().onDragDropEvent` 监听(withGlobalTauri 暴露 webview 模块;capabilities/remote.json 里的 `core:event:allow-listen` 覆盖其底层 listen)。drop 时:

1. 图片文件经壳子的有界 `read_dropped_file` 命令读回(base64,20 MiB 上限),再以文档上的合成 drop 重新进入 dsh 输入框的原生图片接收 —— 图片管线行为不变。
2. 其余文件(以及读取被拒的图片)把路径作为文本插入输入框,每行一个,经 React 受控 textarea 的原生 value setter 加 `input` 事件(输入框自己的 onChange 路径把草稿喂给输入机器)。
3. 拖拽悬停窗口期间,整窗遮罩("拖放文件到输入框")提供页面自己无法渲染的反馈。

读取命令有白名单:main.rs 的窗口事件处理器记录拖入路径(5 分钟窗口),命令只服务该列表中的路径 —— 页面跑在无鉴权的纯 loopback 上,读取面因此被限制在用户手势内。桥接的复制到 `drops/` 管线、其策略行与 `maxBytes`/`copyEnabled` 设置随本次改动移除。

**托盘与关闭行为。** tauri 依赖新增 `tray-icon` feature;`setup_tray` 用捆绑的窗口图标构建托盘与两项菜单(显示主窗口 / 退出)。左键点击图标显示并聚焦主窗口;退出先显式停掉运行时子进程再 `app.exit(0)`。桌面设置明确提供直接退出与保留在托盘两个选项,以 `closeToTray` 持久化在桥接设置命名空间(`$DSH_HOME/settings.yaml`,经 `POST /dsh-bridge/policy`);桥接 client 在启动时与每次变更时,把持久化的值经 `set_close_to_tray` 命令镜像进 Rust;选择保留在托盘时,主窗口的 `CloseRequested` 处理器阻止关闭并隐藏窗口。默认直接退出;托盘始终存在,与选项无关。

**资源管理器"以 dsh-desktop 打开"。** 每次启动时,壳子经 `reg.exe` 在 HKCU 下(重新)注册按用户的右键菜单项(无需提权、幂等、始终指向当前 exe):`Software\\Classes\\Directory\\shell\\dsh-desktop`(文件夹行)与 `Software\\Classes\\Directory\\Background\\shell\\dsh-desktop`(文件夹空白背景),标签 以 dsh-desktop 打开,命令 `"<exe>" "%V"`。`tauri-plugin-single-instance` 让首个进程保持权威;后续调用把规范化目录排入该进程的队列,聚焦现有窗口,发出唤醒事件,然后退出。桥接 client 在监听器安装后排空队列,选择规范路径是该目录最长祖先的工作区,再打开其最近会话,没有会话则新建一个。目录未匹配时,页面先询问用户,确认后调用 `workspaces.create({ path })` 并打开结果。注册失败只记日志,绝不致命;卸载程序通过 `apps/desktop/src-tauri/installer-hooks.nsh` 中的 `NSIS_HOOK_POSTUNINSTALL` 宏移除这两个键。

**dev 桥接保鲜。** `ensure_bridge` 现在在每次 dev 启动时从仓库检出把桥接包拷进 profile(打包路径本来就在每次启动时对齐 profile 副本),因此重建的桥接总能到达既有 profile。原有的 npm 安装路径已移除:npm 的 peer 自动安装会解析已发布的 @deepseek-ai 清单,其 workspace: 协议会以 EUNSUPPORTEDPROTOCOL 失败 —— npm 安装在那里永远无法成功。

## 考虑的备选方案

**保留 WebView2 级拖放**(`dragDropEnabled: false`)—— 否决:页面永远拿不到真实路径(没有 `File.path`),而真实路径正是本特性的全部意义。

**把每个拖入文件都字节桥接** —— 否决:需求行为是"路径进输入框";字节桥只用于保留输入框的图片接收,因为图片没有路径表示。

**在壳侧持久化关闭到托盘**(tauri-plugin-store 或壳自有文件)—— 否决:桥接设置接缝已经持久化桌面设置;页面镜像保持单一持久来源。

**默认开启关闭到托盘** —— 否决:关闭窗口即终止运行时是已文档化、已发布的行为;该设置显式加入。

**从 NSIS 注册右键菜单** —— 否决:首启注册让命令在 dev 运行与重装之间始终指向当前 exe。只有移除归安装器所有,经卸载钩子完成,因为应用无法在自身被卸载的过程中删除自己的键。

**用 winreg crate 写注册表** —— 否决:`reg.exe` 随每个受支持的 Windows 提供,不引入依赖或锁文件变动。

**给 web 应用加 `--workspace` CLI 标志** —— 否决:用户把改动约束在桌面壳与桥接插件内;环境变量 + 桥接路由把爆炸半径控制在 apps/desktop 内。

## 后果

拖放现在把工作区沙箱之外的主机路径交给模型 —— 文件系统策略决定 agent 能读什么,旧的"复制进 `drops/`"保证随之消失。图片保持完整输入框接收。设置页的拖放策略行(复制开关、大小上限)已移除;调试模式保留。托盘始终存在;关闭选项决定标题栏按钮退出还是隐藏。资源管理器启动汇入单一应用进程,并可能在确认后创建工作区。卸载会移除按用户的注册表键;升级重装同样会移除,下次启动重新注册。dev 启动用目录拷贝刷新 profile 桥接(不经过 npm);dev 流程还要求仓库的 workspace lib 已构建(`pnpm run build:lib`),因为 dev profile 的模块回退目录指向本仓库。

## 验证

`cargo build` 与桥接的 tsc + tsdown 构建通过。对真实 web profile 的端到端启动(临时 DSH_HOME、拷入桥接包、合并 patch 行)验证:`GET /dsh-bridge/config` 返回新形状,`POST /dsh-bridge/policy {closeToTray:true}` 把 `desktop-bridge.closeToTray` 写进 settings.yaml 且随后的 `/config` 读回该值,`/dsh-bridge/balance` 保持归一化。仓库 lib 构建完成后,仓库 CLI 能把真实 web profile 启动到就绪行(`dsh web: http://127.0.0.1:<port>`)。携带嵌套目录的真实第二次调用以代码 0 退出,只留下一个桌面进程,聚焦现有窗口,路由到所属工作区且不提示;未匹配的规范目录到达确认文字时不带 Windows verbatim 路径前缀。托盘、关闭拦截与右键菜单注册在应用启动时生效;HKCU 前缀修复后的首次真实运行会写入注册表条目。
