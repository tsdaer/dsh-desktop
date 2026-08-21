// Stage, unstage, discard, commit, and diff routes for the Worktree Source
// Control projection. The browser sends only a Workspace id, a
// Workspace-relative path, and a commit message; every Git argv is fixed here,
// every command runs from a Host-derived working directory, and every write
// re-checks the fresh status listing so a stale path can never mutate the
// wrong file. Destructive operations are offered only for classified entries.
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  buildGitStatusCommand,
  parseGitStatus,
  parseSourceControlWorkspaceId,
  resolveSourceControlRepository,
  runGit,
  SourceControlRequestError,
  type SourceControlEntry,
  type SourceControlHostContext,
  type SourceControlListing,
} from './source-control.ts'

/** Maximum Workspace-relative path bytes accepted by a write route. */
const MAX_RELATIVE_PATH_BYTES = 4 * 1024
/** Maximum commit message bytes accepted by the commit route. */
const MAX_COMMIT_MESSAGE_BYTES = 8 * 1024
/** Maximum JSON request body bytes for a write route. */
const MAX_BODY_BYTES = 64 * 1024
/** Maximum Git stderr detail bytes echoed by a write failure. */
const MAX_DETAIL_BYTES = 8 * 1024
/** Decoder that refuses invalid UTF-8 (binary content). */
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/** The five whole-file Source Control operations. */
export type SourceControlOperation = 'stage' | 'unstage' | 'discard' | 'diff' | 'commit'

/** Bounds shared by every Source Control write route. */
export interface SourceControlActionConfig {
  sourceControlMaxEntries: number
  sourceControlMaxBytes: number
  sourceControlGraceMs: number
  sourceControlTimeoutMs: number
  sourceControlMaxDiffBytes: number
}

/** One successful whole-file mutation or commit. */
export interface SourceControlMutationResult {
  ok: true
}

/** One bounded file diff in the shape the shared DiffBlock presentation draws. */
export interface SourceControlDiff {
  workspaceId: string
  path: string
  /** Prior content from HEAD, or `null` when the path is not in HEAD (a new file). */
  oldText: string | null
  /** Current worktree content (empty when the file was deleted). */
  newText: string
  /** Whether the HEAD side was cut at the configured byte bound. */
  truncatedOld: boolean
  /** Whether the worktree side was cut at the configured byte bound. */
  truncatedNew: boolean
}

/** Validate a browser-supplied Workspace-relative path for a write route.
 * @param raw - Browser JSON or query value.
 * @param field - Field name for the error message.
 * @returns The safe relative path.
 * @throws SourceControlRequestError when the value is absent or unsafe.
 */
export function parseSourceControlRelativePath(raw: string | null, field: string): string {
  if (raw === null || raw.length === 0) {
    throw new SourceControlRequestError(400, 'invalid-relative-path', `${field} must be a Workspace-relative path`)
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_RELATIVE_PATH_BYTES
    || raw.includes('\0')
    || raw.includes('\\')
    || raw.startsWith('/')
    || /^[A-Za-z]:/u.test(raw)) {
    throw new SourceControlRequestError(400, 'invalid-relative-path', `${field} must be a bounded Workspace-relative path`)
  }
  if (raw.split('/').some(part => part === '' || part === '..')) {
    throw new SourceControlRequestError(400, 'invalid-relative-path', `${field} must be a bounded Workspace-relative path`)
  }
  return raw
}

/** Validate a browser-supplied commit message.
 * @param raw - Browser JSON value.
 * @returns The message, trimmed of leading and trailing whitespace.
 * @throws SourceControlRequestError when the message is absent, empty, or oversized.
 */
export function parseCommitMessage(raw: unknown): string {
  const message = typeof raw === 'string' ? raw.trim() : ''
  if (message.length === 0) throw new SourceControlRequestError(400, 'invalid-commit-message', 'commit message must not be empty')
  if (message.includes('\0')) throw new SourceControlRequestError(400, 'invalid-commit-message', 'commit message is invalid')
  if (Buffer.byteLength(message, 'utf8') > MAX_COMMIT_MESSAGE_BYTES) {
    throw new SourceControlRequestError(400, 'invalid-commit-message', 'commit message is too long')
  }
  return message
}

/** Whether one listed entry may receive the operation. Unclassified entries
 * (unsupported-only or empty statuses) are never offered any mutation or diff.
 * @param entry - The entry projected by the fresh status listing.
 * @param operation - The requested operation.
 * @returns true when the operation is safe and meaningful for the entry.
 */
export function sourceControlOperationAllowed(entry: SourceControlEntry, operation: SourceControlOperation): boolean {
  if (entry.statuses.length === 0 || entry.statuses.every(status => status === 'unsupported')) return false
  switch (operation) {
    case 'stage': return entry.statuses.some(status => status === 'unstaged' || status === 'untracked' || status === 'renamed')
    case 'unstage': return entry.statuses.includes('staged')
    case 'discard': return entry.statuses.some(status => status === 'unstaged' || status === 'untracked' || status === 'renamed')
    case 'diff': return true
    case 'commit': return false
  }
}

/** The paths a rename carries, so staging and unstaging restore both sides.
 * @param entry - The listed entry.
 * @returns The mutation path list (new path plus the old rename origin).
 */
export function mutationPaths(entry: SourceControlEntry): string[] {
  return entry.oldPath === undefined ? [entry.path] : [entry.path, entry.oldPath]
}

/** Fixed staging argv: add-or-remove the whole file (renames include the old path).
 * @param paths - Host-derived Workspace-relative paths.
 * @returns Git argv for staging.
 */
export function buildGitStageCommand(paths: readonly string[]): string[] {
  return ['git', '--no-pager', 'add', '-A', '--', ...paths]
}

/** Fixed unstaging argv: move the file back from the index to the worktree.
 * @param paths - Host-derived Workspace-relative paths.
 * @returns Git argv for unstaging.
 */
export function buildGitUnstageCommand(paths: readonly string[]): string[] {
  return ['git', '--no-pager', 'restore', '--staged', '--', ...paths]
}

/** Fixed discarding argv: reset tracked files to HEAD; delete untracked files.
 * @param entry - The listed entry being discarded.
 * @returns Git argv for discarding.
 */
export function buildGitDiscardCommand(entry: SourceControlEntry): string[] {
  const paths = mutationPaths(entry)
  if (entry.statuses.includes('untracked')) return ['git', '--no-pager', 'clean', '-f', '--', ...paths]
  return ['git', '--no-pager', 'restore', '--staged', '--worktree', '--', ...paths]
}

/** Parse one `git ls-files -s` index line into its cacheinfo fields.
 * @param line - One NUL-free index record (`<mode> <blob> <stage>\t<path>`).
 * @returns The mode, blob, and path, or null for an unrecognized record.
 */
export function parseGitIndexEntry(line: string): { mode: string; blob: string; path: string } | null {
  const tab = line.indexOf('\t')
  if (tab <= 0) return null
  const fields = line.slice(0, tab).split(' ')
  if (fields.length !== 3) return null
  const [mode, blob, stage] = fields
  if (mode === undefined || blob === undefined || stage === undefined || !/^[0-7]{6}$/u.test(mode) || !/^[0-9a-f]{40}$/u.test(blob) || stage !== '0') return null
  return { mode, blob, path: line.slice(tab + 1) }
}

/** One temporary-index mutation derived from the staged workspace entries. */
export type SourceControlIndexOp =
  | { kind: 'cacheinfo'; mode: string; blob: string; path: string }
  | { kind: 'remove'; path: string }

/** Build the temporary-index operations that replay only the Workspace's staged
 * entries onto a HEAD baseline, so a commit can never touch files outside the
 * selected Workspace.
 * @param entries - The staged entries from the fresh listing.
 * @param indexLines - One `git ls-files -s` line per entry (`null` when the
 *   entry is absent from the real index, meaning a staged deletion).
 * @returns The ordered temporary-index operations.
 */
export function buildIndexOps(
  entries: readonly SourceControlEntry[],
  indexLines: readonly (string | null | undefined)[],
): SourceControlIndexOp[] {
  const ops: SourceControlIndexOp[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry === undefined) continue
    const line = indexLines[index]
    if (line === null || line === undefined) {
      ops.push({ kind: 'remove', path: entry.path })
    } else {
      const parsed = parseGitIndexEntry(line)
      if (parsed === null || parsed.path !== entry.path) {
        ops.push({ kind: 'remove', path: entry.path })
      } else {
        ops.push({ kind: 'cacheinfo', mode: parsed.mode, blob: parsed.blob, path: parsed.path })
      }
    }
    if (entry.oldPath !== undefined) ops.push({ kind: 'remove', path: entry.oldPath })
  }
  return ops
}

/** Fixed temporary-index update argv for one operation.
 * @param op - The derived index operation.
 * @returns Git argv for `update-index`.
 */
export function buildIndexOpCommand(op: SourceControlIndexOp): string[] {
  if (op.kind === 'remove') return ['git', '--no-pager', 'update-index', '--force-remove', '--', op.path]
  return ['git', '--no-pager', 'update-index', '--add', '--cacheinfo', `${op.mode},${op.blob},${op.path}`]
}

/** The HEAD blob path for a diff: renamed entries read their old path.
 * @param entry - The listed entry.
 * @param relativeWorkspacePath - Repository-relative prefix of the Workspace.
 * @returns The repository-relative HEAD path.
 */
export function headBlobPath(entry: SourceControlEntry, relativeWorkspacePath: string): string {
  const path = entry.oldPath ?? entry.path
  return relativeWorkspacePath === '' ? path : `${relativeWorkspacePath}/${path}`
}

/** Re-read the status projection for one resolved repository.
 * @param host - Filesystem, Workspace registry, and subprocess capabilities.
 * @param workspaceId - Branded id copied into the listing.
 * @param repo - The resolved repository context.
 * @param signal - Cancels subprocess work.
 * @param config - Source Control bounds.
 * @returns The fresh bounded listing, or throws when the repository cannot be read.
 */
export async function readFreshListing(
  host: SourceControlHostContext,
  workspaceId: WorkspaceId,
  repo: Awaited<ReturnType<typeof resolveSourceControlRepository>>,
  signal: AbortSignal,
  config: SourceControlActionConfig,
): Promise<SourceControlListing> {
  const status = await runGit(
    host,
    buildGitStatusCommand(repo.relativeWorkspacePath),
    repo.repoPath,
    signal,
    config.sourceControlGraceMs,
    config.sourceControlMaxBytes,
  )
  if (status.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
  if (status.outcome.exitCode !== 0 || status.output.lossy) throw new SourceControlRequestError(409, 'git-unavailable', 'Git status could not be read')
  return parseGitStatus(
    status.output.text,
    repo.relativeWorkspacePath,
    config.sourceControlMaxEntries,
    config.sourceControlMaxBytes,
    workspaceId,
  )
}

/** Find one entry in the fresh listing and require the operation for it.
 * @param listing - The fresh bounded listing.
 * @param path - Workspace-relative path of the entry.
 * @param operation - The requested operation.
 * @returns The classified entry.
 * @throws SourceControlRequestError when the entry is stale or not offered the operation.
 */
export function requireListedEntry(listing: SourceControlListing, path: string, operation: SourceControlOperation): SourceControlEntry {
  if (listing.state !== 'repository') throw new SourceControlRequestError(409, 'not-a-repository', 'Workspace is not inside a Git repository')
  const entry = listing.entries.find(candidate => candidate.path === path)
  if (entry === undefined) throw new SourceControlRequestError(409, 'stale-status', 'Source Control changed; refresh and retry')
  if (!sourceControlOperationAllowed(entry, operation)) throw new SourceControlRequestError(409, 'operation-not-allowed', 'The entry does not support this operation')
  return entry
}

/** Run one fixed whole-file mutation after re-validating the fresh listing.
 * @param host - Filesystem, Workspace registry, and subprocess capabilities.
 * @param workspaceId - Branded Workspace id.
 * @param path - Workspace-relative path of the entry.
 * @param operation - The mutation to run.
 * @param signal - Cancels the subprocess.
 * @param config - Source Control bounds.
 * @returns The mutation result.
 * @throws SourceControlRequestError for stale, unclassified, or failed mutations.
 */
export async function runSourceControlMutation(
  host: SourceControlHostContext,
  workspaceId: WorkspaceId,
  path: string,
  operation: Exclude<SourceControlOperation, 'diff'>,
  signal: AbortSignal,
  config: SourceControlActionConfig,
): Promise<SourceControlMutationResult> {
  const repo = await resolveSourceControlRepository(host, workspaceId, signal, config.sourceControlGraceMs)
  const listing = await readFreshListing(host, workspaceId, repo, signal, config)
  const entry = requireListedEntry(listing, path, operation)
  const argv = operation === 'stage'
    ? buildGitStageCommand(mutationPaths(entry))
    : operation === 'unstage'
      ? buildGitUnstageCommand(mutationPaths(entry))
      : buildGitDiscardCommand(entry)
  const result = await runGit(host, argv, repo.workspacePath, signal, config.sourceControlGraceMs, 8 * 1024)
  if (result.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
  if (result.outcome.exitCode !== 0) throw gitFailure(result)
  return { ok: true }
}

/** Commit the Workspace's staged entries with a temporary index so the commit
 * replays exactly those entries onto HEAD and nothing outside the Workspace.
 * @param host - Filesystem, Workspace registry, and subprocess capabilities.
 * @param workspaceId - Branded Workspace id.
 * @param message - Validated commit message.
 * @param signal - Cancels the subprocesses.
 * @param config - Source Control bounds.
 * @returns The commit result.
 * @throws SourceControlRequestError when nothing is staged or the commit fails.
 */
export async function runSourceControlCommit(
  host: SourceControlHostContext,
  workspaceId: WorkspaceId,
  message: string,
  signal: AbortSignal,
  config: SourceControlActionConfig,
): Promise<SourceControlMutationResult> {
  const repo = await resolveSourceControlRepository(host, workspaceId, signal, config.sourceControlGraceMs)
  const listing = await readFreshListing(host, workspaceId, repo, signal, config)
  const staged = listing.entries.filter(entry => entry.statuses.includes('staged'))
  if (staged.length === 0) throw new SourceControlRequestError(409, 'nothing-staged', 'No changes are staged in this Workspace')

  const tempIndex = join(tmpdir(), `dsh-git-index-${randomBytes(8).toString('hex')}`)
  try {
    const base = await runGit(host, ['git', '--no-pager', 'rev-parse', '--verify', 'HEAD'], repo.workspacePath, signal, config.sourceControlGraceMs, 8 * 1024)
    if (base.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
    const treeArg = base.outcome.exitCode === 0 ? 'HEAD' : '--empty'
    const readTree = await runGit(host, ['git', '--no-pager', 'read-tree', treeArg], repo.workspacePath, signal, config.sourceControlGraceMs, 8 * 1024, { GIT_INDEX_FILE: tempIndex })
    if (readTree.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
    if (readTree.outcome.exitCode !== 0) throw gitFailure(readTree)

    const indexLines: (string | null)[] = []
    for (const entry of staged) {
      const listed = await runGit(host, ['git', '--no-pager', 'ls-files', '-s', '--', entry.path], repo.workspacePath, signal, config.sourceControlGraceMs, 8 * 1024)
      if (listed.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
      if (listed.outcome.exitCode !== 0) throw gitFailure(listed)
      const line = listed.output.text.split('\n').find(value => value.length > 0) ?? null
      indexLines.push(line)
    }
    for (const op of buildIndexOps(staged, indexLines)) {
      const updated = await runGit(
        host,
        buildIndexOpCommand(op),
        repo.workspacePath,
        signal,
        config.sourceControlGraceMs,
        8 * 1024,
        { GIT_INDEX_FILE: tempIndex },
      )
      if (updated.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
      if (updated.outcome.exitCode !== 0) throw gitFailure(updated)
    }

    const committed = await runGit(host, ['git', '--no-pager', 'commit', '-m', message], repo.workspacePath, signal, config.sourceControlGraceMs, 8 * 1024, { GIT_INDEX_FILE: tempIndex })
    if (committed.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
    if (committed.outcome.exitCode !== 0) throw gitFailure(committed)
    return { ok: true }
  } finally {
    void unlink(tempIndex).catch(() => { /* temporary index cleanup is best-effort */ })
  }
}

/** Read one bounded file diff: HEAD blob through Git, worktree content through
 * the filesystem, both decoded as strict UTF-8 and rejected when binary.
 * @param host - Filesystem, Workspace registry, and subprocess capabilities.
 * @param workspaceId - Branded Workspace id.
 * @param path - Workspace-relative path of the entry.
 * @param signal - Cancels subprocess and filesystem work.
 * @param config - Source Control bounds.
 * @returns The bounded diff for the shared DiffBlock presentation.
 * @throws SourceControlRequestError for stale, unclassified, binary, or failed diffs.
 */
export async function readSourceControlDiff(
  host: SourceControlHostContext,
  workspaceId: WorkspaceId,
  path: string,
  signal: AbortSignal,
  config: SourceControlActionConfig,
): Promise<SourceControlDiff> {
  const repo = await resolveSourceControlRepository(host, workspaceId, signal, config.sourceControlGraceMs)
  const listing = await readFreshListing(host, workspaceId, repo, signal, config)
  const entry = requireListedEntry(listing, path, 'diff')

  const blob = await runGit(host, ['git', '--no-pager', 'show', `HEAD:${headBlobPath(entry, repo.relativeWorkspacePath)}`], repo.repoPath, signal, config.sourceControlGraceMs, config.sourceControlMaxDiffBytes)
  if (blob.outcome.signal !== null) throw new SourceControlRequestError(499, 'cancelled', 'Source Control request was cancelled')
  let oldText: string | null
  let truncatedOld = false
  if (blob.outcome.exitCode !== 0) {
    oldText = null
  } else {
    if (blob.output.text.includes('\0')) throw new SourceControlRequestError(422, 'binary-file', 'diff is unavailable for binary content')
    oldText = blob.output.text
    truncatedOld = blob.output.lossy
  }

  let newText = ''
  let truncatedNew = false
  const worktreeTarget = await resolveWorktreeFile(host, repo.workspaceRoot, path, signal)
  if (worktreeTarget !== undefined) {
    const info = await host.fs.stat(worktreeTarget, signal)
    if (info?.type !== 'file') throw new SourceControlRequestError(422, 'binary-file', 'diff is unavailable for non-regular files')
    if ((info.size ?? 0) > config.sourceControlMaxDiffBytes) {
      truncatedNew = true
    } else {
      let bytes: Uint8Array
      try {
        bytes = await host.fs.readBytes(worktreeTarget, signal, config.sourceControlMaxDiffBytes)
      } catch {
        throw new SourceControlRequestError(409, 'diff-unavailable', 'The file could not be read')
      }
      if (bytes.includes(0)) throw new SourceControlRequestError(422, 'binary-file', 'diff is unavailable for binary content')
      try {
        newText = UTF8.decode(bytes)
      } catch {
        throw new SourceControlRequestError(422, 'binary-file', 'diff is unavailable for binary content')
      }
    }
  }
  return { workspaceId, path, oldText, newText, truncatedOld, truncatedNew }
}

/** Resolve one Workspace-relative file inside the canonical Workspace root.
 * @param host - Filesystem capabilities.
 * @param workspaceRoot - The canonical Workspace root target.
 * @param path - Workspace-relative path.
 * @param signal - Cancels resolution.
 * @returns The resolved target, or undefined when absent or outside the root.
 */
export async function resolveWorktreeFile(
  host: SourceControlHostContext,
  workspaceRoot: FsTarget,
  path: string,
  signal: AbortSignal,
): Promise<FsTarget | undefined> {
  const absolute = join(host.fs.processPath(workspaceRoot), ...path.split('/'))
  let target: FsTarget
  try {
    target = await host.fs.resolve(absolute, { signal })
  } catch {
    return undefined
  }
  if (!host.fs.contains(workspaceRoot, target)) return undefined
  return target
}

function gitFailure(result: Awaited<ReturnType<typeof runGit>>): SourceControlRequestError {
  const stderr = result.stderr.text
  const detail = stderr.length === 0 ? undefined : stderr.slice(0, MAX_DETAIL_BYTES)
  return new SourceControlRequestError(409, 'git-failed', 'Git command failed', detail)
}

/** Serve one POST Source Control mutation route with request cancellation.
 * @param req - Incoming HTTP request.
 * @param res - HTTP response.
 * @param host - Host capabilities used by the mutation.
 * @param config - Request bounds owned by the desktop bridge.
 * @param operation - The mutation to run.
 * @returns A promise settled after the response is written.
 */
export async function handleSourceControlActionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: SourceControlHostContext,
  config: SourceControlActionConfig,
  operation: Exclude<SourceControlOperation, 'diff'>,
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, config.sourceControlTimeoutMs)
  const abort = (): void => { if (!res.writableEnded) controller.abort() }
  req.once('aborted', abort)
  res.once('close', abort)
  try {
    let body: { workspaceId?: unknown; path?: unknown; message?: unknown }
    try {
      body = JSON.parse(await readBody(req)) as { workspaceId?: unknown; path?: unknown; message?: unknown }
    } catch {
      throw new SourceControlRequestError(400, 'invalid-request', 'request body is invalid')
    }
    const workspaceId = parseSourceControlWorkspaceId(typeof body.workspaceId === 'string' ? body.workspaceId : null)
    if (operation === 'commit') {
      const message = parseCommitMessage(body.message)
      const result = await runSourceControlCommit(host, workspaceId, message, controller.signal, config)
      if (!res.writableEnded) writeJson(res, 200, result)
    } else {
      const path = parseSourceControlRelativePath(typeof body.path === 'string' ? body.path : null, 'path')
      const result = await runSourceControlMutation(host, workspaceId, path, operation, controller.signal, config)
      if (!res.writableEnded) writeJson(res, 200, result)
    }
  } catch (error: unknown) {
    // The request stream auto-destroys after its body ends, so req.destroyed
    // is true for every answered POST; only writability decides the response.
    if (!res.writableEnded) writeSourceControlActionError(res, error)
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', abort)
    res.removeListener('close', abort)
  }
}

/** Serve the GET Source Control diff route with request cancellation.
 * @param req - Incoming HTTP request.
 * @param res - HTTP response.
 * @param host - Host capabilities used by the diff.
 * @param config - Request bounds owned by the desktop bridge.
 * @returns A promise settled after the response is written.
 */
export async function handleSourceControlDiffRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: SourceControlHostContext,
  config: SourceControlActionConfig,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://dsh.local')
  let workspaceId: WorkspaceId
  let path: string
  try {
    workspaceId = parseSourceControlWorkspaceId(url.searchParams.get('workspaceId'))
    path = parseSourceControlRelativePath(url.searchParams.get('path'), 'path')
  } catch (error: unknown) {
    writeSourceControlActionError(res, error)
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, config.sourceControlTimeoutMs)
  const abort = (): void => { if (!res.writableEnded) controller.abort() }
  req.once('aborted', abort)
  res.once('close', abort)
  try {
    const diff = await readSourceControlDiff(host, workspaceId, path, controller.signal, config)
    if (!res.writableEnded) writeJson(res, 200, diff)
  } catch (error: unknown) {
    // The request stream auto-destroys after its body ends, so writability is
    // the only reliable signal for whether the response can still be sent.
    if (!res.writableEnded) writeSourceControlActionError(res, error)
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', abort)
    res.removeListener('close', abort)
  }
}

/** Collect the JSON request body up to {@link MAX_BODY_BYTES}. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeSourceControlActionError(res: ServerResponse, error: unknown): void {
  if (error instanceof SourceControlRequestError) {
    writeJson(res, error.status, {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    })
    return
  }
  writeJson(res, 500, { ok: false, code: 'source-control-failed', message: 'Source Control request failed' })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
