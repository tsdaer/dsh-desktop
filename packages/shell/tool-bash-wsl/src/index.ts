/**
 * Model-facing Consumer of the WSL Bash execution world (P4b of the
 * Desktop 0.4 plan).
 *
 * This tool registers the `bash` name only while the WSL setting is
 * enabled and the selected distribution's probe is healthy. It holds its
 * own WslBashExecutor instance (ctx.shell stays owned by pwsh on
 * Windows), so PowerShell and WSL Bash coexist. A missing distribution,
 * a failed path translation, or a lost distribution fails visibly and
 * removes Bash from subsequent tool assembly.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WslBashExecutor } from '@deepseek-ai/dsh-bash-wsl'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, TerminalCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-shell-env'
import { DSH_ENV_PREFIX, parseExitStatus } from '@deepseek-ai/dsh-shell'
import type { CollectedOutput, ShellProcess, ShellProcessRead, ShellRunResult } from '@deepseek-ai/dsh-shell'

export const name = 'tool-bash-wsl'
export const inject = ['tools', 'systemPrompt', 'shellEnv']

/** Runtime configuration schema for the WSL bash tool. */
export interface Config {
  /** The WSL 2 distribution to execute Bash in. */
  distribution: string
  /** Whether the tool is currently enabled (setting + healthy probe). */
  enabled: boolean
  /** Whether to expose run_in_background (default true). */
  enableRunInBackground?: boolean
  /** The local executor's knobs, passed to WslBashExecutor. */
  executor?: LocalConfig
}

export const Config: z<Config> = z.object({
  distribution: z.string().min(1),
  enabled: z.boolean().default(false),
  enableRunInBackground: z.boolean().default(true),
  executor: z.any(),
})

/** Parsed tool args. */
interface BashToolArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
}

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/**
 * Shape one finished run into the text the model sees: stdout, then a
 * marked stderr section, then exit-status markers.
 * @param result - the completed foreground run from the executor.
 * @returns the model-facing text.
 */
function renderResult(result: ShellRunResult): string {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'
  const markers: string[] = []
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
  } else if (result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/**
 * Shape one background-process read into the job_output delta the model sees.
 * @param read - one incremental read from the process handle.
 * @returns the delta text with any loss notice appended.
 */
function renderProcessRead(read: ShellProcessRead): string {
  if (!read.lossy) return read.delta
  const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path): path is string => path !== undefined)
  const notice = `[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(', ') : '(unavailable)'}]`
  return `${read.delta}${read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : ''}${notice}`
}

/**
 * Map a settled background process onto the generic task-outcome vocabulary.
 * @param proc - the settled process handle.
 * @returns the outcome for the ctx.jobs registration.
 */
function processOutcome(proc: ShellProcess): { status: 'completed' | 'killed'; detail: string } {
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
}

/**
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the session header cwd.
 * @param modelWorkdir - the model-supplied workdir.
 * @param exec - the tool execution.
 * @returns the resolved workdir.
 */
function resolveWorkdir(modelWorkdir: string | undefined, exec: { agent?: Agent }): string | undefined {
  if (modelWorkdir !== undefined) {
    if (modelWorkdir.startsWith('/')) return modelWorkdir
    const headerCwd = exec.agent?.session.header.cwd
    return headerCwd === undefined ? modelWorkdir : `${headerCwd.replace(/\\/g, '/').replace(/\/+$/, '')}/${modelWorkdir}`
  }
  return exec.agent?.session.header.cwd
}

/**
 * Validate tool args: non-empty command and description, positive timeout.
 * @param args - the parsed tool args.
 * @throws Error naming the invalid field.
 */
function validateBashArgs(args: BashToolArgs): void {
  if (args.command.trim().length === 0) throw new Error('invalid command: expected a non-empty string')
  if (args.description.trim().length === 0) throw new Error('invalid description: expected a non-empty string')
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
}

/**
 * The tool description the model sees.
 * @returns the description text.
 */
function bashDescription(): string {
  return 'Execute a bash command (`bash -c`) inside the WSL 2 execution world and return its stdout/stderr. '
    + 'Each call runs in a fresh WSL Bash shell: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Working directories are Windows paths translated under /mnt. '
    + `Current harness environment facts are exposed through managed \`$${DSH_ENV_PREFIX}*\` variables; inspect them when needed. `
    + 'Non-zero exits are reported as `[exit code: N]`.'
}

/**
 * Present foreground calls as terminals and background starts as generic cards.
 * @param args - the parsed tool args.
 * @returns the call view.
 */
function presentBashCall(args: BashToolArgs): GenericCallView | TerminalCallView {
  if (args.run_in_background === true) {
    return { card: 'generic', title: args.command, kind: 'execute', rawInput: args.command, content: [{ type: 'text', text: args.description }] }
  }
  return { card: 'terminal', title: args.command, description: args.description, ...args.workdir !== undefined ? { cwd: args.workdir } : {} }
}

/**
 * Present completed foreground output as a terminal; background acknowledgements
 * and execution errors use generic fenced output.
 * @param args - the parsed tool args.
 * @param result - the tool result.
 * @returns the rendered view, or undefined when nothing matches.
 */
function presentBashResult(args: unknown, result: ToolResult): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text') return undefined
  const raw = block.text
  const isBackground = typeof args === 'object' && args !== null && (args as { run_in_background?: unknown }).run_in_background === true
  if (isBackground || result.isError) {
    return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }] }
  }
  const { body, ...exit } = parseExitStatus(raw)
  return { card: 'terminal', output: body, ...exit }
}

/**
 * Canonical foreground result DTO for the output union.
 * @param result - the executor result.
 * @returns the detached JSON shape.
 */
function canonicalBashResult(result: ShellRunResult) {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
  }
}

/**
 * Apply the WSL bash tool. Registers only when config.enabled is true; a
 * disabled or unhealthy configuration removes Bash from tool assembly.
 * @param ctx - the client root context.
 * @param config - the resolved tool configuration.
 */
/** The settings namespace this tool reads its enablement from. */
export const WSL_SETTINGS_NAMESPACE = 'bash-wsl'

export function apply(ctx: Context, config: Config = {} as Config): void {
  // The tool mounts from the preset composition; its enablement is the desktop
  // setting (wslEnabled + a healthy distribution probe). The setting section
  // is read live so a settings change takes effect without a restart; absent
  // a settings service, the composition entry's `enabled` decides.
  const settings = ctx.get('settings')
  // Register our own namespace so settings.get resolves it even in a
  // composition without the desktop bridge (the settings-file document may
  // already carry a stored bash-wsl section from the desktop card).
  settings?.register(WSL_SETTINGS_NAMESPACE, z.object({
    wslEnabled: z.boolean().default(false),
    wslDistribution: z.string().default(''),
  }))
  const section = settings?.get(WSL_SETTINGS_NAMESPACE) as { wslEnabled?: unknown; wslDistribution?: unknown } | undefined
  // A settings section that exists is authoritative (the desktop card owns the
  // value); absent one, the composition entry decides.
  const enabled = section === undefined
    ? config.enabled === true
    : section.wslEnabled === true
  const distribution = section !== undefined
    && typeof section.wslDistribution === 'string'
    && section.wslDistribution.length > 0
    ? section.wslDistribution
    : typeof config.distribution === 'string' && config.distribution.length > 0
      ? config.distribution
      : ''
  if (!enabled) return
  const backgroundEnabled = config.enableRunInBackground ?? true
  // so a composition that omits them still runs.
  const executorConfig: LocalConfig = {
    timeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    maxOutputBytes: 64_000,
    maxSpillBytes: 64 * 1024 * 1024,
    graceMs: 3_000,
    ...config.executor,
  }
  const executor = new WslBashExecutor(ctx, executorConfig, distribution)

  ctx.get('systemPrompt')?.section({
    name: 'tool:bash-wsl',
    order: 106,
    text: 'Check the [exit code: N] marker on every bash result; investigate failures before moving on.',
  })

  ctx.get('tools')?.register(defineTool({
    name: 'bash',
    description: bashDescription(),
    parameters: {
      command: { type: 'string', required: true, description: 'The bash command to execute.' },
      description: { type: 'string', required: true, description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI).' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap.' },
      workdir: { type: 'string', description: 'Working directory for this command (a Windows path translated under /mnt).' },
      ...backgroundEnabled ? { run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.' } } : {},
    },
    output: {
      schema: {
        oneOf: [
          { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'background' }, jobId: { type: 'string', required: true } } },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
              signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              timedOut: { type: 'boolean', required: true },
              aborted: { type: 'boolean', required: true },
              timeoutMs: { type: 'number', required: true },
              stdout: { type: 'object', additionalProperties: false, required: true, properties: { text: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, spillPath: { type: 'string' } } },
              stderr: { type: 'object', additionalProperties: false, required: true, properties: { text: { type: 'string', required: true }, truncated: { type: 'boolean', required: true }, spillPath: { type: 'string' } } },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background job ${value.jobId}`
          : renderResult(value as { kind: 'foreground' } & ShellRunResult),
      }],
    },
    presentCall: presentBashCall,
    presentResult: presentBashResult,
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args)
      const workdir = resolveWorkdir(args.workdir, exec)
      const dshEnv = ctx.get('shellEnv')?.collect(exec) ?? {}
      const request = {
        command: args.command,
        ...workdir !== undefined ? { workdir } : {},
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        dshEnv,
      }
      if (args.run_in_background === true) {
        if (!backgroundEnabled) throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        const jobs = ctx.get('jobs')
        if (jobs === undefined) throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        if (exec.signal.aborted) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        const id = jobs.start({
          kind: 'bash',
          label: args.command,
          ...exec.agent ? { owner: exec.agent } : {},
          run: () => {
            const proc = executor.start(executor.resolve(request as never))
            return {
              cancel: () => void proc.kill(),
              done: proc.done.then(() => processOutcome(proc)),
              readOutput: () => renderProcessRead(proc.readOutput()),
            }
          },
        })
        return { kind: 'background' as const, jobId: id }
      }
      const result = await executor.run(executor.resolve({ ...request, signal: exec.signal } as never))
      if (result.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      return { kind: 'foreground' as const, ...canonicalBashResult(result) }
    },
  }))
}

export default apply
