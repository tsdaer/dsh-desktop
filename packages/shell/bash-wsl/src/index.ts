/**
 * WSL Bash Service Provider for the shell capability seam (P4b of the
 * Desktop 0.4 plan).
 *
 * Each command runs as `wsl.exe --distribution <name> --exec bash -c <command>`
 * in a managed process spawned through `ctx.subprocess`. The executor owns
 * the WSL argv and the Windows-to-/mnt working-directory translation; the
 * explicit /mnt path restriction matches the active permission preset.
 *
 * This executor does NOT register as `ctx.shell` (the single-executor seam
 * stays owned by pwsh on Windows and bash-sandbox on POSIX); the WSL tool
 * holds its own instance so PowerShell and WSL Bash coexist.
 */

import type { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor, assertServiceableBashConfig } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import type { ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'

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

/**
 * WSL Bash executor over `ctx.subprocess`. Commands run as
 * `wsl.exe --distribution <name> --exec bash -c <command>` with the cwd
 * translated to /mnt; a cwd that does not translate fails visibly instead
 * of escaping the Windows permission stance.
 */
export class WslBashExecutor extends LocalBashExecutor {
  static override inject = ['subprocess']

  /**
   * @param ctx - Cordis context carrying subprocess.
   * @param config - the local executor's knobs, resolved by schemastery.
   * @param distribution - the WSL 2 distribution to execute Bash in.
   */
  constructor(ctx: Context, config: LocalConfig, private readonly distribution: string) {
    super(ctx, config)
    assertServiceableBashConfig(config)
    if (distribution.length === 0) throw new Error('bash-wsl: distribution must be a non-empty name')
  }

  /**
   * Build the WSL argv for one command: fixed wsl.exe prefix plus bash -c.
   * @param command - the bash command text.
   * @returns the exact argv handed to ctx.subprocess.
   */
  private wslArgv(command: string): readonly string[] {
    return ['wsl.exe', '--distribution', this.distribution, '--exec', 'bash', '-c', command]
  }

  override run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const translated = translateWindowsPathToWsl(spec.workdir)
    if (translated === null) {
      throw new Error(`bash-wsl: workdir ${spec.workdir} is not a drive path translatable to /mnt`)
    }
    return this.runArgv(spec, this.wslArgv(spec.command))
  }

  override start(spec: ShellExecSpec): ShellProcess {
    const translated = translateWindowsPathToWsl(spec.workdir)
    if (translated === null) {
      throw new Error(`bash-wsl: workdir ${spec.workdir} is not a drive path translatable to /mnt`)
    }
    return this.startArgv(spec, this.wslArgv(spec.command))
  }
}

export default WslBashExecutor
