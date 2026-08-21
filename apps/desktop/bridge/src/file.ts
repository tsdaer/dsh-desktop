// Read-only file viewing for the Worktree Explorer and Search: one bounded,
// strict-UTF-8 file projection. The browser sends only a Workspace id and a
// Workspace-relative path; the Host resolves the canonical root, refuses
// escapes and non-regular targets, and bounds the returned bytes. A file
// larger than the bound is served as a truncated prefix (explicit
// `truncated: true`), and binary or invalid UTF-8 content is refused with a
// stable error rather than rendered.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { TextDecoder } from 'node:util'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  ExplorerRequestError, parseExplorerRelativePath, parseExplorerWorkspaceId,
} from './explorer.ts'

/** Decoder that refuses invalid UTF-8 (binary content). */
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/** Bounds shared by the file-viewing route. */
export interface FileViewConfig {
  /** Maximum UTF-8 bytes served for one file view; larger files return a truncated prefix. */
  fileMaxBytes: number
  /** Maximum elapsed time for one file view request. */
  fileTimeoutMs: number
}

/** One bounded read-only file projection returned to the browser. */
export interface FileView {
  workspaceId: string
  path: string
  /** Strict UTF-8 content (a bounded prefix when `truncated`). */
  text: string
  /** Whether the file exceeds `fileMaxBytes` and `text` is a prefix. */
  truncated: boolean
}

/** Host capabilities required by the file-viewing route. */
export interface FileViewHostContext {
  fs: FileSystem
  workspaceRegistry: {
    get(workspaceId: WorkspaceId): { path: string } | undefined
  }
}

/** Read one bounded file view inside the authoritative Workspace root.
 * @param host - Filesystem and Workspace registry capabilities.
 * @param workspaceId - Branded id resolved from the request.
 * @param path - Normalized Workspace-relative file path.
 * @param signal - Cancels resolution or reading.
 * @param config - Byte and time bounds.
 * @returns The bounded file projection.
 * @throws ExplorerRequestError when the Workspace, containment, file, or content check fails.
 */
export async function readFileView(
  host: FileViewHostContext,
  workspaceId: WorkspaceId,
  path: string,
  signal: AbortSignal,
  config: FileViewConfig,
): Promise<FileView> {
  const workspace = host.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new ExplorerRequestError(404, 'workspace-not-found', 'Workspace was not found')

  const root = await resolveFileTarget(host.fs, workspace.path, undefined, signal, 'workspace-root')
  const target = await resolveFileTarget(host.fs, workspace.path, path, signal, 'file')
  if (!host.fs.contains(root, target)) {
    throw new ExplorerRequestError(403, 'path-escapes-workspace', 'path escapes the Workspace')
  }
  await requireFile(host.fs, target, signal, 'file')

  const info = await host.fs.stat(target, signal)
  const size = info?.size ?? 0
  if (size <= config.fileMaxBytes) {
    let bytes: Uint8Array
    try {
      bytes = await host.fs.readBytes(target, signal, config.fileMaxBytes)
    } catch (error: unknown) {
      throw mapFileError(error, 'file-unavailable')
    }
    if (bytes.includes(0)) throw new ExplorerRequestError(422, 'binary-file', 'the file is binary')
    try {
      return { workspaceId, path, text: UTF8.decode(bytes), truncated: false }
    } catch {
      throw new ExplorerRequestError(422, 'binary-file', 'the file is not valid UTF-8')
    }
  }
  return readFilePrefix(host, workspaceId, path, target, signal, config)
}

/** Stream a bounded prefix of an oversized file, stopping at the byte bound.
 * @param host - Filesystem capabilities.
 * @param workspaceId - Branded id copied into the projection.
 * @param path - Workspace-relative file path.
 * @param target - The resolved file target.
 * @param signal - Cancels the stream.
 * @param config - Byte bound.
 * @returns The truncated prefix.
 * @throws ExplorerRequestError when the stream cannot start or the content is refused.
 */
async function readFilePrefix(
  host: FileViewHostContext,
  workspaceId: WorkspaceId,
  path: string,
  target: FsTarget,
  signal: AbortSignal,
  config: FileViewConfig,
): Promise<FileView> {
  const parts: string[] = []
  let bytes = 0
  try {
    const stream = await host.fs.streamText(target, signal)
    for await (const chunk of stream) {
      parts.push(chunk)
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes >= config.fileMaxBytes) break
    }
  } catch (error: unknown) {
    throw mapFileError(error, 'file-unavailable')
  }
  return { workspaceId, path, text: parts.join(''), truncated: true }
}

/** Serve the fixed GET file-viewing route and bind cancellation to the HTTP request. */
export async function handleFileViewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: FileViewHostContext,
  config: FileViewConfig,
): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', 'http://dsh.local')
  let workspaceId: WorkspaceId
  let path: string
  try {
    workspaceId = parseExplorerWorkspaceId(requestUrl.searchParams.get('workspaceId'))
    path = parseExplorerRelativePath(requestUrl.searchParams.get('path'))
  } catch (error: unknown) {
    writeFileViewError(res, error)
    return
  }
  if (path === '') {
    writeFileViewError(res, new ExplorerRequestError(400, 'invalid-relative-path', 'path must name a file'))
    return
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.fileTimeoutMs)
  const abort = (): void => { controller.abort() }
  req.once('aborted', abort)
  req.once('close', abort)
  try {
    const view = await readFileView(host, workspaceId, path, controller.signal, config)
    if (!res.writableEnded) writeFileView(res, 200, view)
  } catch (error: unknown) {
    if (!res.writableEnded && !req.destroyed) {
      writeFileViewError(res, timedOut ? new ExplorerRequestError(504, 'timeout', 'File request timed out') : error)
    }
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', abort)
    req.removeListener('close', abort)
  }
}

async function resolveFileTarget(
  fs: FileSystem,
  workspacePath: string,
  relativePath: string | undefined,
  signal: AbortSignal,
  subject: string,
): Promise<FsTarget> {
  const absolutePath = relativePath === undefined
    ? workspacePath
    : join(workspacePath, ...relativePath.split('/'))
  try {
    return await fs.resolve(absolutePath, { signal })
  } catch (error: unknown) {
    throw mapFileError(error, `${subject}-unavailable`)
  }
}

async function requireFile(fs: FileSystem, target: FsTarget, signal: AbortSignal, subject: string): Promise<void> {
  try {
    const info = await fs.stat(target, signal)
    if (info?.type !== 'file') throw new ExplorerRequestError(404, `${subject}-not-file`, `${subject} is unavailable`)
  } catch (error: unknown) {
    if (error instanceof ExplorerRequestError) throw error
    throw mapFileError(error, `${subject}-unavailable`)
  }
}

/** Join path segments with forward slashes, collapsing duplicates. */
function join(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/gu, '/')
}

function mapFileError(error: unknown, fallbackCode: string): ExplorerRequestError {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  if (code === 'FS_ABORTED') throw error
  if (code === 'FS_PERMISSION_DENIED') return new ExplorerRequestError(403, 'permission-denied', 'file access was denied')
  if (code === 'FS_NOT_FOUND' || code === 'FS_NOT_DIRECTORY') return new ExplorerRequestError(404, fallbackCode, 'file is unavailable')
  if (code === 'FS_NOT_TEXT') return new ExplorerRequestError(422, 'binary-file', 'the file is binary')
  return new ExplorerRequestError(500, fallbackCode, 'file could not be read')
}

function writeFileViewError(res: ServerResponse, error: unknown): void {
  if (error instanceof ExplorerRequestError) {
    writeFileView(res, error.status, { ok: false, code: error.code, message: error.message })
    return
  }
  writeFileView(res, 500, { ok: false, code: 'file-failed', message: 'File request failed' })
}

function writeFileView(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
