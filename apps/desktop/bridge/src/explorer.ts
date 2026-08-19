import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

/** Maximum Workspace-relative path bytes accepted by the Explorer request. */
const MAX_RELATIVE_PATH_BYTES = 4 * 1024
/** Maximum Workspace id length accepted at the HTTP boundary. */
const MAX_WORKSPACE_ID_BYTES = 256
/** Maximum one projected entry name size. */
const MAX_ENTRY_NAME_BYTES = 4 * 1024

/** One read-only Explorer child returned to the browser. */
export interface ExplorerEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'other'
  expandable: boolean
  outsideRoot?: true
  size?: number
}

/** One bounded directory projection returned by the desktop bridge. */
export interface ExplorerListing {
  workspaceId: string
  path: string
  entries: readonly ExplorerEntry[]
  truncated: boolean
}

/** Inputs required by the Host Explorer adapter. */
export interface ExplorerHostContext {
  fs: FileSystem
  workspaceRegistry: WorkspaceRegistry
}

/** Fixed Explorer errors that map to stable HTTP responses. */
export class ExplorerRequestError extends Error {
  /**
   * @param status - HTTP status for the fixed request failure.
   * @param code - Stable machine-readable error code.
   * @param message - Safe message without an absolute filesystem path.
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ExplorerRequestError'
  }
}

/** Parse a browser-supplied Workspace id without granting it path authority. */
export function parseExplorerWorkspaceId(raw: string | null): WorkspaceId {
  if (raw === null || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > MAX_WORKSPACE_ID_BYTES || raw.includes('\0')) {
    throw new ExplorerRequestError(400, 'invalid-workspace-id', 'workspaceId is invalid')
  }
  return raw as WorkspaceId
}

/** Normalize and validate the Workspace-relative Explorer path. */
export function parseExplorerRelativePath(raw: string | null): string {
  const value = raw ?? ''
  if (Buffer.byteLength(value, 'utf8') > MAX_RELATIVE_PATH_BYTES
    || value.includes('\0')
    || value.includes('\\')
    || /^[A-Za-z]:/u.test(value)) {
    throw new ExplorerRequestError(400, 'invalid-relative-path', 'path must be a bounded Workspace-relative path')
  }
  if (value === '') return ''
  if (value.startsWith('/')) throw new ExplorerRequestError(400, 'invalid-relative-path', 'path must be relative')
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new ExplorerRequestError(400, 'path-escapes-workspace', 'path escapes the Workspace')
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/**
 * List one directory inside the authoritative Workspace root.
 * @param host - Existing filesystem and Workspace registry services.
 * @param workspaceId - Branded id resolved from the request.
 * @param path - Normalized Workspace-relative directory path.
 * @param signal - Cancels resolution or enumeration.
 * @param maxEntries - Maximum projected children.
 * @param maxBytes - Maximum JSON size of the projected listing.
 * @returns A stable, bounded directory projection.
 * @throws ExplorerRequestError when the Workspace, directory, or containment check fails.
 */
export async function listExplorerDirectory(
  host: ExplorerHostContext,
  workspaceId: WorkspaceId,
  path: string,
  signal: AbortSignal,
  maxEntries: number,
  maxBytes: number,
): Promise<ExplorerListing> {
  const workspace = host.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new ExplorerRequestError(404, 'workspace-not-found', 'Workspace was not found')

  const root = await resolveDirectory(host.fs, workspace.path, undefined, signal, 'workspace-root')
  const directory = await resolveTarget(host.fs, workspace.path, path, signal, 'directory')
  if (!host.fs.contains(root, directory)) {
    throw new ExplorerRequestError(403, 'path-escapes-workspace', 'path escapes the Workspace')
  }
  await requireDirectory(host.fs, directory, signal, 'directory')

  let entries: FsDirEntry[]
  try {
    entries = await host.fs.listDir(directory, signal)
  } catch (error: unknown) {
    throw mapFilesystemError(error, 'directory-unavailable')
  }
  entries.sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || left.name.localeCompare(right.name))

  const projected: ExplorerEntry[] = []
  let truncated = entries.length > maxEntries
  for (const entry of entries.slice(0, maxEntries)) {
    if (Buffer.byteLength(entry.name, 'utf8') > MAX_ENTRY_NAME_BYTES) {
      truncated = true
      continue
    }
    const entryPath = path === '' ? entry.name : `${path}/${entry.name}`
    const inside = host.fs.contains(root, entry.target)
    const next: ExplorerEntry = inside
      ? {
        name: entry.name,
        path: entryPath,
        type: entry.type,
        expandable: entry.type === 'directory',
        ...(entry.size === undefined ? {} : { size: entry.size }),
      }
      : { name: entry.name, path: entryPath, type: 'other', expandable: false, outsideRoot: true }
    projected.push(next)
    if (Buffer.byteLength(JSON.stringify({ workspaceId, path, entries: projected, truncated }), 'utf8') > maxBytes) {
      projected.pop()
      truncated = true
      break
    }
  }
  return { workspaceId, path, entries: projected, truncated }
}

/** Serve the fixed GET Explorer route and bind cancellation to the HTTP request. */
export async function handleExplorerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: ExplorerHostContext,
  config: { explorerMaxEntries: number; explorerMaxBytes: number; explorerTimeoutMs: number },
): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', 'http://dsh.local')
  let workspaceId: WorkspaceId
  let path: string
  try {
    workspaceId = parseExplorerWorkspaceId(requestUrl.searchParams.get('workspaceId'))
    path = parseExplorerRelativePath(requestUrl.searchParams.get('path'))
  } catch (error: unknown) {
    writeExplorerError(res, error)
    return
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.explorerTimeoutMs)
  const abort = (): void => { controller.abort() }
  req.once('aborted', abort)
  req.once('close', abort)
  try {
    const listing = await listExplorerDirectory(
      host,
      workspaceId,
      path,
      controller.signal,
      config.explorerMaxEntries,
      config.explorerMaxBytes,
    )
    if (!res.writableEnded) writeJson(res, 200, listing)
  } catch (error: unknown) {
    if (!res.writableEnded && !req.destroyed) {
      writeExplorerError(res, timedOut ? new ExplorerRequestError(504, 'timeout', 'Explorer request timed out') : error)
    }
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', abort)
    req.removeListener('close', abort)
  }
}

async function resolveDirectory(
  fs: FileSystem,
  workspacePath: string,
  relativePath: string | undefined,
  signal: AbortSignal,
  subject: string,
): Promise<FsTarget> {
  const target = await resolveTarget(fs, workspacePath, relativePath, signal, subject)
  await requireDirectory(fs, target, signal, subject)
  return target
}

async function resolveTarget(
  fs: FileSystem,
  workspacePath: string,
  relativePath: string | undefined,
  signal: AbortSignal,
  subject: string,
): Promise<FsTarget> {
  const absolutePath = relativePath === undefined ? workspacePath : resolve(workspacePath, ...relativePath.split('/'))
  try {
    return await fs.resolve(absolutePath, { signal })
  } catch (error: unknown) {
    throw mapFilesystemError(error, `${subject}-unavailable`)
  }
}

async function requireDirectory(fs: FileSystem, target: FsTarget, signal: AbortSignal, subject: string): Promise<void> {
  try {
    const info = await fs.stat(target, signal)
    if (info?.type !== 'directory') throw new ExplorerRequestError(404, `${subject}-not-directory`, `${subject} is unavailable`)
  } catch (error: unknown) {
    if (error instanceof ExplorerRequestError) throw error
    throw mapFilesystemError(error, `${subject}-unavailable`)
  }
}

function mapFilesystemError(error: unknown, fallbackCode: string): ExplorerRequestError {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  if (code === 'FS_ABORTED') throw error
  if (code === 'FS_PERMISSION_DENIED') return new ExplorerRequestError(403, 'permission-denied', 'directory access was denied')
  if (code === 'FS_NOT_FOUND' || code === 'FS_NOT_DIRECTORY') return new ExplorerRequestError(404, fallbackCode, 'directory is unavailable')
  return new ExplorerRequestError(500, fallbackCode, 'directory could not be read')
}

function writeExplorerError(res: ServerResponse, error: unknown): void {
  if (error instanceof ExplorerRequestError) {
    writeJson(res, error.status, { ok: false, code: error.code, message: error.message })
    return
  }
  writeJson(res, 500, { ok: false, code: 'explorer-failed', message: 'Explorer request failed' })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
