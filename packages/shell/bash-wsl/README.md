# @deepseek-ai/dsh-bash-wsl

English | [中文](README.zh.md)

WSL Bash Service Provider for the [`@deepseek-ai/dsh-shell`](../shell/README.md) seam (P4b of the [Desktop 0.4 plan](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.md)). Each command runs as `wsl.exe --distribution <name> --exec bash -c <command>` in a managed process spawned through `ctx.subprocess`. The executor owns the WSL argv and the Windows-to-`/mnt` working-directory translation; the explicit `/mnt` path restriction matches the active permission preset.

## Behavior

- **WSL argv** — commands run through the fixed `wsl.exe --distribution <name> --exec bash -c <command>` form; no intermediate shell or quoting layer exists between the executor and wsl.exe.
- **/mnt translation** — the working directory is translated from a Windows drive path (`C:\foo` → `/mnt/c/foo`) through the default interop mount; a non-drive path (UNC, relative, already-`/mnt`) fails visibly instead of escaping the Windows permission stance. `isUnderTranslatedRoot` verifies a candidate stays under the translated workspace root.
- **Coexistence with PowerShell** — this executor does NOT register as `ctx.shell` (the single-executor seam stays owned by pwsh on Windows and bash-sandbox on POSIX); the WSL tool holds its own instance so PowerShell and WSL Bash coexist.
- **Local mechanics** — bounded output, spill files, process-group SIGTERM→SIGKILL escalation, credential scrub, and deadline handling are inherited from [`@deepseek-ai/dsh-bash-local`](../bash-local/README.md).

## Model Experience

Indirectly, through the WSL bash Consumer (`@deepseek-ai/dsh-tool-bash-wsl`), which owns all model-facing rendering of process output and lifecycle.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Default mounts only** — non-default interop mounts, remote WSL hosts, WSL 1, automatic package installation, and persistent WSL terminals are out of scope for the first release.
- **Windows-only** — wsl.exe is the Windows binary; this executor is not usable on POSIX hosts.
