# 运行环境与进程占用约束

> 动手前必读。这是桌面端工作的最高优先级约束。

## 事实

- 桌面证据可能来自源码启动或已安装的打包应用。源码启动通常由仓库构建的 `apps/cli/lib/bin.js` 提供 Node 子进程，打包启动则由安装目录中的 `node.exe` 执行资源目录中的 `runtime/lib/bin.js`；不要根据工作目录推断当前拓扑。
- 先测量活跃进程，再决定仓库构建产物是否可能被占用：

  ```powershell
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -in @('dsh-desktop.exe', 'node.exe') } |
    Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine
  ```

  找到桌面进程后，检查其 `ParentProcessId` 对应的 Node 进程；`ExecutablePath` 区分 Node 来源，`CommandLine` 区分仓库中的 `apps/cli/lib/bin.js` 与安装目录资源中的 `runtime/lib/bin.js`。两者都可能服务当前页面，只有实测结果决定是否会锁住构建输出。
- 因此，工作目录里的文件可能正被运行中的进程占用：`node_modules`、构建产物、按目标划分的 `.runtime/<rust-target>/deploy`、`apps/web/dist`、会话/缓存文件等。
- 在 Windows 上，被占用的文件无法被删除、覆盖或移动，会表现为文件锁错误（`EBUSY`、`EPERM`、`Access is denied`、`process cannot access the file` 等）。

## 会触碰这些文件的操作（高风险）

- `pnpm install` / `pnpm deploy` / 重装或清理 `node_modules`
- `pnpm run build` / `build:lib` / `build:web`（覆盖 `lib/`、`apps/web/dist`）
- `bake-runtime.mjs`（删除并重建 `.runtime/<rust-target>/deploy`）
- `tauri build` / `cargo build`（写 `src-tauri/target/`）
- 删除、重命名、覆盖任何正在被运行环境读取的文件

## 遇到进程占用时必须遵守的协议

1. **立即停止**当前操作，不要重试，不要尝试用其他方式绕过（例如换一个命令强删、改权限）。
2. 停下来，向用户清楚说明：
   - 哪个文件/目录被占用；
   - 是哪个操作触发的；
   - 需要用户先手动关闭什么。
3. 给出用户可执行的手动步骤（见下节模板）。
4. 等用户确认环境已关闭后，再继续。

## 手动操作步骤模板（提示给用户）

1. 关闭正在运行的相关界面/服务：
   - 关闭 DSH 桌面应用窗口（如果有）；
   - 停止 `dsh web` / dev server / `pnpm run dev:web` 等进程；
   - 关闭任何以本目录为工作目录运行的 node 进程。
2. 确认占用已释放（可选）：
   ```powershell
   # 查看 node 进程
   Get-Process node -ErrorAction SilentlyContinue
   # 查看占用某个文件的进程（需要另开管理员 PowerShell）
   # handle.exe <被占用路径>  或  resource monitor 的 CPU 页
   ```
3. 需要时结束残留进程：
   ```powershell
   Stop-Process -Name node -Force   # 谨慎：会结束所有 node 进程
   ```
4. 手动执行原本被阻塞的操作（我会给出具体命令），或告诉我“已关闭”，我再继续。
5. 完成后按需重新启动环境。

## 例外

- 纯新增文档、纯读取文件（`read`/`glob`/`grep`）、以及不覆盖被占用文件的操作，通常不会触发占用，可正常进行。
- 触发占用的判定以实际报错为准；一旦出现上述文件锁错误，即适用本协议。
