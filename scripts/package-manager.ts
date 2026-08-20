/**
 * Resolve how to spawn the package manager that started the current process.
 * Every repository orchestrator that re-enters pnpm shares this one rule.
 * @module scripts/package-manager
 */

/** A resolved child-process invocation: the executable plus its complete argument list. */
export interface PackageManagerInvocation {
  /** Executable to spawn. */
  command: string
  /** Complete argument list for {@link PackageManagerInvocation.command}. */
  args: string[]
}

/** Entrypoints Node can load as source; anything else is a native executable. */
const JAVASCRIPT_ENTRYPOINT = /\.[cm]?js$/i

/**
 * Build the shell-free invocation that re-enters the calling package manager.
 *
 * `npm_execpath` names one of two things. An npm-installed pnpm (and
 * `pnpm/action-setup`) points at a JavaScript entrypoint such as `pnpm.cjs`,
 * which only runs when handed to Node. A standalone pnpm install points at a
 * native executable such as `pnpm.exe`, which must be spawned directly —
 * handing it to Node makes Node parse the executable header as source and fail
 * with a `SyntaxError`. Deciding by extension keeps both installations working
 * without a platform shell.
 *
 * @param args - arguments for the package manager, such as `['run', 'build']`.
 * @param context - caller name reported when `npm_execpath` is unavailable.
 * @returns the executable and complete argument list to spawn.
 */
export function packageManagerInvocation(args: string[], context: string): PackageManagerInvocation {
  const entrypoint = process.env.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error(`${context}: npm_execpath is unavailable; invoke this command through a pnpm package script.`)
  }
  if (JAVASCRIPT_ENTRYPOINT.test(entrypoint)) {
    return { command: process.execPath, args: [entrypoint, ...args] }
  }
  return { command: entrypoint, args: [...args] }
}
