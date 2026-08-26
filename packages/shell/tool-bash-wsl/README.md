# @deepseek-ai/dsh-tool-bash-wsl

English | [中文](README.zh.md)

Model-facing Consumer of the WSL Bash execution world (P4b of the [Desktop 0.4 plan](../../../.agents/notes/proposed/feature/2026-08-26-desktop-0.4-runtime-and-windows-integration.md)). Registers the `bash` tool only while the WSL setting is enabled and the selected distribution's probe is healthy; a disabled or unhealthy configuration removes Bash from tool assembly.

## Behavior

- **Conditional registration** — `apply` returns without registering when `config.enabled` is false, so PowerShell stays the only shell tool when WSL Bash is off.
- **Own executor instance** — the tool holds its own [`@deepseek-ai/dsh-bash-wsl`](../bash-wsl/README.md) executor (ctx.shell stays owned by pwsh on Windows), so PowerShell and WSL Bash coexist.
- **Model-facing rendering** — foreground runs render as terminals with the `[exit code: N]` marker; background starts render as generic cards with job ids; background reads report truncation and spill paths.
- **Working-directory translation** — workdir defaults to the session header cwd and is translated under /mnt; a non-drive path fails visibly instead of escaping the Windows permission stance.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the WSL Bash guidance below, registered only while the tool is enabled (the WSL setting plus a healthy distribution probe).

##### Bash guidance

```markdown
Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token effect

Small fixed input cost per request while the plugin is active and enabled.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged. Plugin activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The model sees the generated [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-wsl) when the tool is enabled and mounted: command, description, optional timeoutMs and workdir (a Windows path translated under /mnt), and run_in_background when enabled. Agent-scoped tool restrictions can remove the definition for that agent.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while visibility and background support are unchanged. A restriction, config change, or enablement change may invalidate reuse from the changed tool definition.

### Foreground result

#### What the model sees

A terminal card whose output body is stdout (with stderr in a marked section when present) and whose exit pill carries the `[exit code: N]`, `[timed out after Nms]`, or `[killed by signal: S]` marker. Nonzero exits are reported, not errored — the model decides how to react.

#### Token effect

Variable input cost proportional to the produced output; long output is truncated to the tail with a full-output spill path notice.

#### KV Cache effect

No direct invalidation; results are per-call and not prefix-stable.

## Known Limitations and Deferred Work

- **Windows-only** — wsl.exe is the Windows binary; this tool is not registered on POSIX hosts.
- **No sandbox escalation** — the WSL execution world enforces the /mnt restriction at the executor boundary; sandbox-permissions escalation is not advertised.
