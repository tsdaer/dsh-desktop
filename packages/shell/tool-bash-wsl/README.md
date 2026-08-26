# @deepseek-ai/dsh-tool-bash-wsl

English | [中文](README.zh.md)

Model-facing Consumer of the WSL Bash execution world (P4b of the [Desktop 0.4 plan](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.md)). Registers the `bash` tool only while the WSL setting is enabled and the selected distribution's probe is healthy; a disabled or unhealthy configuration removes Bash from tool assembly.

## Behavior

- **Conditional registration** — `apply` returns without registering when `config.enabled` is false, so PowerShell stays the only shell tool when WSL Bash is off.
- **Own executor instance** — the tool holds its own [`@deepseek-ai/dsh-bash-wsl`](../bash-wsl/README.md) executor (ctx.shell stays owned by pwsh on Windows), so PowerShell and WSL Bash coexist.
- **Model-facing rendering** — foreground runs render as terminals with the `[exit code: N]` marker; background starts render as generic cards with job ids; background reads report truncation and spill paths.
- **Working-directory translation** — workdir defaults to the session header cwd and is translated under /mnt; a non-drive path fails visibly instead of escaping the Windows permission stance.

## Model Experience

The `bash` tool description names the WSL 2 execution world, fresh-shell semantics, /mnt working directories, and managed `DSH_*` environment facts. Nonzero exits are reported, not errored — the model decides how to react.

#### KV Cache effect

No direct invalidation; the tool's prompt section contributes to the system prompt but names no request-prefix cache.

## Known Limitations and Deferred Work

- **Windows-only** — wsl.exe is the Windows binary; this tool is not registered on POSIX hosts.
- **No sandbox escalation** — the WSL execution world enforces the /mnt restriction at the executor boundary; sandbox-permissions escalation is not advertised.
