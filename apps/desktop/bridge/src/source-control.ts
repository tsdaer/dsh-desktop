import type { IncomingMessage, ServerResponse } from 'node:http'
import { relative, sep } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

/** One Git status category projected for the selected Workspace. */
export type SourceControlStatus = 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'renamed' | 'unsupported'

/** One read-only Git status entry with a Workspace-relative path. */
export interface SourceControlEntry {
  path: string
  statuses: readonly SourceControlStatus[]
  oldPath?: string
}

/** Bounded Source Control response; absolute repository paths never leave the Host. */
export interface SourceControlListing {
  workspaceId: string
  state: 'repository' | 'not-repository' | 'unavailable'
  entries: readonly SourceControlEntry[]
  truncated: boolean
}

/** Host capabilities required by the fixed Git status route. */
export interface SourceControlHostContext {
  fs: FileSystem
  workspaceRegistry: WorkspaceRegistry
  subprocess: {
    spawn(spec: {
      argv: readonly string[]
      cwd: string
      stdio: {
        stdin: 'ignore'
        stdout: { maxBytes: number }
        stderr: { maxBytes: number }
      }
      graceMs: number
      signal?: AbortSignal
    }): SubprocessHandle
  }
}

/** Stable request error for the Source Control route. */
export class SourceControlRequestError extends Error {
  /**
   * @param status - HTTP status for the fixed request failure.
   * @param code - Stable machine-readable error code.
   * @param message - Safe message without an absolute filesystem path.
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'SourceControlRequestError'
  }
}

const MAX_WORKSPACE_ID_BYTES = 256
const MAX_OUTPUT_BYTES = 256 * 1024

/** Validate a browser-supplied Workspace id without granting it path authority.
 * @param raw - Browser query value.
 * @returns The branded Workspace id accepted by the Host registry.
 * @throws SourceControlRequestError when the value is absent or unsafe.
 */
export function parseSourceControlWorkspaceId(raw: string | null): WorkspaceId {
  if (raw === null || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > MAX_WORKSPACE_ID_BYTES || raw.includes('\0')) {
    throw new SourceControlRequestError(400, 'invalid-workspace-id', 'workspaceId is invalid')
  }
  return raw as WorkspaceId
}

/** Fixed Git discovery command.
 * @returns Git argv for repository discovery.
 */
export function buildGitRepositoryCommand(): string[] {
  return ['git', '--no-pager', 'rev-parse', '--show-toplevel']
}

/** Fixed machine-readable Git status command scoped to the Host-derived path.
 * @param repoRelativeWorkspacePath - Host-derived path from repository root to Workspace.
 * @returns Git argv for the bounded status query.
 */
export function buildGitStatusCommand(repoRelativeWorkspacePath: string): string[] {
  return [
    'git', '--no-pager', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--',
    repoRelativeWorkspacePath === '' ? '.' : repoRelativeWorkspacePath,
  ]
}

/** Parse Git porcelain-v1 NUL records and keep only safe paths under the selected Workspace.
 * @param stdout - NUL-delimited Git status output.
 * @param workspacePrefix - Repository-relative prefix for the selected Workspace.
 * @param maxEntries - Maximum projected entries.
 * @param maxBytes - Maximum serialized response bytes.
 * @param workspaceId - Workspace id copied into the response.
 * @returns A bounded repository listing.
 */
export function parseGitStatus(
  stdout: string,
  workspacePrefix: string,
  maxEntries: number,
  maxBytes: number,
  workspaceId: string,
): SourceControlListing {
  const prefix = workspacePrefix === '' ? '' : `${workspacePrefix.replaceAll('\\', '/').replace(/\/+$/, '')}/`
  const entries: SourceControlEntry[] = []
  let truncated = false
  const records = stdout.split('\0')
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record === undefined || record.length < 3) continue
    const code = record.slice(0, 2)
    let path = record.slice(3).replaceAll('\\', '/')
    let oldPath: string | undefined
    if (code.includes('R') || code.includes('C')) {
      oldPath = records[++index]?.replaceAll('\\', '/')
    }
    if (prefix !== '' && !path.startsWith(prefix)) continue
    path = prefix === '' ? path : path.slice(prefix.length)
    if (!isSafeRelativePath(path)) continue
    if (oldPath !== undefined) {
      oldPath = prefix === '' ? oldPath : oldPath.startsWith(prefix) ? oldPath.slice(prefix.length) : undefined
      if (oldPath !== undefined && !isSafeRelativePath(oldPath)) oldPath = undefined
    }
    const statuses = classifyGitStatus(code)
    if (statuses.length === 0) continue
    const entry: SourceControlEntry = { path, statuses, ...(oldPath === undefined ? {} : { oldPath }) }
    if (entries.length >= maxEntries || Buffer.byteLength(JSON.stringify({ workspaceId, state: 'repository', entries: [...entries, entry], truncated }), 'utf8') > maxBytes) {
      truncated = true
      break
    }
    entries.push(entry)
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return { workspaceId, state: 'repository', entries, truncated }
}

function classifyGitStatus(code: string): SourceControlStatus[] {
  if (code === '??') return ['untracked']
  if (code === '!!') return []
  if (code.length !== 2) return ['unsupported']
  const [index, worktree] = code
  const statuses: SourceControlStatus[] = []
  if (index === 'U' || worktree === 'U' || code === 'DD' || code === 'AA') statuses.push('conflicted')
  if (index === 'R' || worktree === 'R') statuses.push('renamed')
  if (index !== ' ' && index !== '?' && index !== '!' && index !== 'R' && index !== 'C') statuses.push('staged')
  if (worktree !== ' ' && worktree !== '?' && worktree !== '!' && worktree !== 'R' && worktree !== 'C') statuses.push('unstaged')
  if (statuses.length === 0 && (index === 'C' || worktree === 'C')) statuses.push('unsupported')
  return statuses
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path) && !path.split('/').some(part => part === '' || part === '..')
}

/** Run the bounded read-only Git projection for one Workspace.
 * @param host - Filesystem, Workspace registry, and subprocess capabilities.
 * @param workspaceId - Registered Workspace to inspect.
 * @param signal - Cancels filesystem and subprocess work.
 * @param maxEntries - Maximum projected entries.
 * @param maxBytes - Maximum serialized response bytes.
 * @param graceMs - Process termination grace period.
 * @returns The current bounded Source Control snapshot.
 * @throws SourceControlRequestError when the Workspace is missing, unavailable, or cancelled.
 */
export async function readSourceControl(
  host: SourceControlHostContext,
  workspaceId: WorkspaceId,
  signal: AbortSignal,
  maxEntries: number,
  maxBytes: number,
  graceMs: number,
): Promise<SourceControlListing> {
  const workspace = host.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new SourceControlRequestError(404, 'workspace-not-found', 'Workspace was not found')
  const workspaceRoot = await resolveWorkspaceRoot(host.fs, workspace.path, signal)
  const workspacePath = host.fs.processPath(workspaceRoot)
  const discovery = await runGit(host, buildGitRepositoryCommand(), workspacePath, signal, graceMs, MAX_OUTPUT_BYTES)
  if (discovery.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
  if (discovery.outcome.exitCode === 128) return { workspaceId, state: 'not-repository', entries: [], truncated: false }
  if (discovery.outcome.exitCode !== 0 || discovery.output.lossy) return { workspaceId, state: 'unavailable', entries: [], truncated: false }
  const repositoryPath = discovery.output.text.trim()
  if (repositoryPath.length === 0 || repositoryPath.includes('\0') || repositoryPath.includes('\n')) return { workspaceId, state: 'unavailable', entries: [], truncated: false }
  let repositoryRoot: FsTarget
  try {
    repositoryRoot = await host.fs.resolve(repositoryPath, { signal })
    if (!host.fs.contains(repositoryRoot, workspaceRoot)) return { workspaceId, state: 'unavailable', entries: [], truncated: false }
  } catch {
    return { workspaceId, state: 'unavailable', entries: [], truncated: false }
  }
  const repoPath = host.fs.processPath(repositoryRoot)
  const relativeWorkspacePath = normalizeGitRelativePath(relative(repoPath, workspacePath), repoPath, workspacePath)
  const status = await runGit(host, buildGitStatusCommand(relativeWorkspacePath), repoPath, signal, graceMs, maxBytes)
  if (status.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
  if (status.outcome.exitCode !== 0 || status.output.lossy) return { workspaceId, state: 'unavailable', entries: [], truncated: false }
  return parseGitStatus(status.output.text, relativeWorkspacePath, maxEntries, maxBytes, workspaceId)
}

function normalizeGitRelativePath(value: string, repositoryPath: string, workspacePath: string): string {
  if (value === '' || value === '.') return ''
  if (value.startsWith('..') || value.includes(':') || (sep === '\\' && value.startsWith('\\'))) return repositoryPath === workspacePath ? '' : '.'
  return value.replaceAll('\\', '/')
}

async function resolveWorkspaceRoot(fs: FileSystem, path: string, signal: AbortSignal): Promise<FsTarget> {
  try {
    const root = await fs.resolve(path, { signal })
    const info = await fs.stat(root, signal)
    if (info?.type !== 'directory') throw new Error('not a directory')
    return root
  } catch {
    throw new SourceControlRequestError(404, 'workspace-unavailable', 'Workspace is unavailable')
  }
}

async function runGit(
  host: SourceControlHostContext,
  argv: readonly string[],
  cwd: string,
  signal: AbortSignal,
  graceMs: number,
  maxBytes: number,
): Promise<{ outcome: Awaited<SubprocessHandle['done']>; output: { text: string; lossy: boolean } }> {
  let handle: SubprocessHandle
  try {
    handle = host.subprocess.spawn({ argv, cwd, stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes: 8 * 1024 } }, graceMs, signal })
  } catch {
    return { outcome: { exitCode: -1, signal: null }, output: { text: '', lossy: true } }
  }
  const outcome = await handle.done
  const output = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: true }
  return { outcome, output }
}

/** Serve GET /dsh-bridge/worktree/source-control with request cancellation and timeout.
 * @param req - Incoming HTTP request.
 * @param res - HTTP response.
 * @param host - Host capabilities used by the status projection.
 * @param config - Request bounds owned by the desktop bridge.
 * @returns A promise settled after the response is written.
 */
export async function handleSourceControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: SourceControlHostContext,
  config: { sourceControlMaxEntries: number; sourceControlMaxBytes: number; sourceControlGraceMs: number; sourceControlTimeoutMs: number },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://dsh.local')
  let workspaceId: WorkspaceId
  try { workspaceId = parseSourceControlWorkspaceId(url.searchParams.get('workspaceId')) } catch (error: unknown) { writeSourceControlError(res, error); return }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, config.sourceControlTimeoutMs)
  const abort = (): void => { if (!res.writableEnded) controller.abort() }
  req.once('aborted', abort)
  res.once('close', abort)
  try {
    const listing = await readSourceControl(
      host,
      workspaceId,
      controller.signal,
      config.sourceControlMaxEntries,
      config.sourceControlMaxBytes,
      config.sourceControlGraceMs,
    )
    if (!res.writableEnded) writeJson(res, 200, listing)
  } catch (error: unknown) {
    if (!res.writableEnded && !req.destroyed) writeSourceControlError(res, error)
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', abort)
    res.removeListener('close', abort)
  }
}

function writeSourceControlError(res: ServerResponse, error: unknown): void {
  const body = error instanceof SourceControlRequestError
    ? { ok: false, code: error.code, message: error.message }
    : { ok: false, code: 'source-control-failed', message: 'Source Control request failed' }
  writeJson(res, error instanceof SourceControlRequestError ? error.status : 500, body)
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
