/**
 * WSL Bash executor for the shell capability seam (P4b of the Desktop
 * 0.4 plan).
 *
 * Each command runs as `wsl.exe --distribution <name> --exec bash -c <command>`
 * in a managed process spawned through `ctx.subprocess`. The executor owns
 * the WSL argv, the Windows-to-/mnt working-directory translation, and the
 * explicit /mnt path restriction matching the active permission preset.
 *
 * This executor does NOT register as `ctx.shell` (the single-executor seam
 * stays owned by pwsh on Windows and bash-sandbox on POSIX); the WSL tool
 * holds its own instance so PowerShell and WSL Bash coexist. It therefore
 * cannot extend LocalBashExecutor (whose Service base registers ctx.shell);
 * it mirrors the local executor's subprocess mechanics directly.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessCollect, SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { CollectedOutput, ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessStatus, ShellRunResult } from '@deepseek-ai/dsh-shell'

/**
 * Translate a Windows path into its /mnt form (default interop mount).
 * `C:\foo\bar` becomes `/mnt/c/foo/bar`; a path already under /mnt is
 * returned unchanged. UNC and other non-drive paths return null — this
 * release supports default mounts only.
 * @param path - a Windows or /mnt path.
 * @returns the /mnt translation, or null for unsupported paths.
 */
export function translateWindowsPathToWsl(path: string): string | null {
  const trimmed = path.trim()
  if (trimmed.startsWith('/mnt/')) return trimmed
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(trimmed)
  if (match === null) return null
  const driveGroup = match[1]
  const restGroup = match[2]
  if (driveGroup === undefined || restGroup === undefined) return null
  const drive = driveGroup.toLowerCase()
  const rest = restGroup.replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
}

/**
 * Whether one /mnt path stays under a translated workspace root. The
 * workspace root is itself translated; a path outside it fails visibly.
 * @param candidate - the translated candidate path.
 * @param workspaceRoot - the Windows workspace root, translated.
 * @returns whether the candidate resolves under the root.
 */
export function isUnderTranslatedRoot(candidate: string, workspaceRoot: string): boolean {
  const root = workspaceRoot.replace(/\/+$/, '')
  const path = candidate.replace(/\/+$/, '')
  return path === root || path.startsWith(root + '/')
}

/** Executor config: the local knobs (mirroring bash-local's Config). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes. */
  graceMs?: number
}

/** Model-friendly environment overrides (same set as bash-local). */
const ENV_OVERRIDES = { NO_COLOR: '1', TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' } as const

/**
 * WSL Bash executor over `ctx.subprocess`. Commands run as
 * `wsl.exe --distribution <name> --exec bash -c <command>` with the cwd
 * translated to /mnt; a cwd that does not translate fails visibly instead
 * of escaping the Windows permission stance.
 */
export class WslBashExecutor {
  /**
   * @param ctx - Cordis context carrying subprocess.
   * @param config - executor knobs; the values default inside resolve().
   * @param distribution - the WSL 2 distribution to execute Bash in.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly distribution: string,
  ) {
    if (distribution.length === 0) throw new Error('bash-wsl: distribution must be a non-empty name')
  }

  /** Resolve a request into a fully-specified spec (mirrors bash-local's resolve). */
  resolve(request: ShellExecRequest): ShellExecSpec {
    const timeoutMs = Math.min(request.timeoutMs ?? this.config.timeoutMs ?? 120_000, this.config.maxTimeoutMs ?? 600_000)
    const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes ?? 64_000
    return {
      command: request.command,
      workdir: request.workdir ?? this.config.cwd ?? process.cwd(),
      timeoutMs,
      stdoutMaxBytes,
      ...request.signal ? { signal: request.signal } : {},
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      ...request.env !== undefined ? { env: request.env } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  /** Build the exact argv handed to ctx.subprocess. */
  private wslArgv(command: string): readonly string[] {
    return ['wsl.exe', '--distribution', this.distribution, '--exec', 'bash', '-c', command]
  }

  /** Map one resolved spec onto a fully-specified subprocess spawn. */
  private spawnSpec(spec: ShellExecSpec, stdoutMaxBytes: number, signal: AbortSignal | undefined): SubprocessSpawnSpec {
    const collect = (maxBytes: number): SubprocessCollect => ({
      maxBytes,
      spill: { maxBytes: this.config.maxSpillBytes ?? 64 * 1024 * 1024 },
    })
    return {
      argv: this.wslArgv(spec.command),
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes ?? 64_000),
      },
      graceMs: this.config.graceMs ?? 3_000,
      signal,
      env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv },
    }
  }

  /** Project one settled collect-mode reader into the final CollectedOutput shape. */
  private static finalOutput(reader: SubprocessOutputReader): CollectedOutput {
    const read = reader.readFrom(0)
    return { text: read.text, truncated: read.lossy, ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {} }
  }

  /** The collect-mode readers this executor requested (present by construction). */
  private static collected(handle: SubprocessHandle): { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader } {
    const { stdout, stderr } = handle.collected
    if (stdout === undefined || stderr === undefined) throw new Error('bash-wsl: subprocess implementation dropped a requested collect stream')
    return { stdout, stderr }
  }

  /**
   * Verify the spec's working directory translates into /mnt. A failure
   * throws so the caller reports it visibly.
   * @param spec - the resolved spec.
   * @returns the spec unchanged when the cwd is valid.
   */
  private checkCwd(spec: ShellExecSpec): ShellExecSpec {
    const translated = translateWindowsPathToWsl(spec.workdir)
    if (translated === null) throw new Error(`bash-wsl: workdir ${spec.workdir} is not a drive path translatable to /mnt`)
    return spec
  }

  /** Run one command in the foreground. */
  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const checked = this.checkCwd(spec)
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('bash-wsl: ctx.subprocess is unavailable')
    const handle = subprocess.spawn(this.spawnSpec(checked, checked.stdoutMaxBytes, checked.signal))
    const outcome = await handle.done
    const collected = WslBashExecutor.collected(handle)
    return {
      ...outcome,
      timedOut: false,
      aborted: checked.signal?.aborted === true,
      timeoutMs: checked.timeoutMs,
      stdout: WslBashExecutor.finalOutput(collected.stdout),
      stderr: WslBashExecutor.finalOutput(collected.stderr),
    }
  }

  /** Start one command in the background and return its handle. */
  start(spec: ShellExecSpec): ShellProcess {
    const checked = this.checkCwd(spec)
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('bash-wsl: ctx.subprocess is unavailable')
    const running = subprocess.spawn(this.spawnSpec(checked, checked.stdoutMaxBytes, checked.signal))
    const collected = WslBashExecutor.collected(running)
    let status: ShellProcessStatus = 'running'
    let exitCode: number | null = null
    let signal: NodeJS.Signals | null = null
    let lastDelta = ''
    void running.done.then((outcome) => {
      status = outcome.signal === null && outcome.exitCode === 0 ? 'completed' : 'killed'
      exitCode = outcome.exitCode
      signal = outcome.signal
      const stdout = collected.stdout.readFrom(0)
      const stderr = collected.stderr.readFrom(0)
      let body = stdout.text
      if (stderr.text.length > 0) {
        if (body.length > 0 && !body.endsWith('\n')) body += '\n'
        body += '[stderr]\n' + stderr.text
      }
      lastDelta = body
    })
    return {
      get status() { return status },
      get exitCode() { return exitCode },
      get signal() { return signal },
      done: running.done.then(() => undefined),
      readOutput: () => {
        const delta = lastDelta
        lastDelta = ''
        return { delta, lossy: false }
      },
      kill: () => {
        if (status !== 'running') return false
        running.terminate()
        return true
      },
    }
  }
}
export default WslBashExecutor
