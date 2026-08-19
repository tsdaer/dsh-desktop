import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { resolveRgPath } from '@deepseek-ai/dsh-tool-fs-search'
import type { WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

/** One bounded text match returned by the desktop Worktree search. */
export interface SearchMatch {
  path: string
  line: number
  text: string
  kind?: 'content' | 'path'
}

/** One page of search results. */
export interface SearchListing {
  workspaceId: string
  query: string
  include?: string
  matches: readonly SearchMatch[]
  truncated: boolean
  reason?: 'match-limit' | 'output-limit' | 'timeout'
  nextCursor?: string
}

/** Host capabilities required by the fixed Search route. */
export interface SearchHostContext {
  fs: FileSystem
  workspaceRegistry: WorkspaceRegistry
  subprocess: {
    spawn(spec: {
      argv: readonly string[]
      cwd: string
      stdio: {
        stdin: 'ignore'
        stdout: 'pipe' | { maxBytes: number }
        stderr: { maxBytes: number }
      }
      graceMs: number
      signal?: AbortSignal
    }): SubprocessHandle
  }
}

/** Stable request error for the Search route. */
export class SearchRequestError extends Error {
  /**
   * @param status - HTTP status for this request failure.
   * @param code - Stable machine-readable error code.
   * @param message - Safe message without an absolute path or credential.
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'SearchRequestError'
  }
}

const MAX_QUERY_BYTES = 4 * 1024
const MAX_INCLUDE_BYTES = 512
const MAX_CURSOR_BYTES = 512
const MAX_LINE_BYTES = 2 * 1024
const VCS_EXCLUDES = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl']
const GENERATED_EXCLUDES = ['node_modules', 'dist', 'target', '.runtime', 'coverage']

/** Resolved process and response bounds for one Search request. */
interface SearchLimits {
  maxMatches: number
  maxBytes: number
  maxRawBytes: number
  maxFileBytes: number
  graceMs: number
}

/** Validate the plain-text query accepted by the browser Search form. */
export function parseSearchQuery(raw: string | null): string {
  if (raw === null || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > MAX_QUERY_BYTES || raw.includes('\0')) {
    throw new SearchRequestError(400, 'invalid-query', 'query must be a bounded non-empty string')
  }
  return raw
}

/** Validate one positive include glob; lists and negated globs are rejected. */
export function parseSearchInclude(raw: string | null): string | undefined {
  if (raw === null || raw.length === 0) return undefined
  let braceDepth = 0
  for (const char of raw) {
    if (char === '{') braceDepth++
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (char === ',' && braceDepth === 0) throw new SearchRequestError(400, 'invalid-include', 'include must be one positive glob')
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_INCLUDE_BYTES || raw.includes('\0') || raw.startsWith('!') || braceDepth !== 0) {
    throw new SearchRequestError(400, 'invalid-include', 'include must be one positive glob')
  }
  return raw
}

/** Parse a strict boolean toggle from the browser Search form. */
export function parseSearchToggle(raw: string | null, name: string): boolean {
  if (raw === null || raw === '' || raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  throw new SearchRequestError(400, `invalid-${name}`, `${name} must be a boolean`)
}

/** Decode the opaque page cursor without giving it filesystem authority. */
export function parseSearchCursor(raw: string | null): { path: string; line: number } | undefined {
  if (raw === null || raw.length === 0) return undefined
  if (Buffer.byteLength(raw, 'utf8') > MAX_CURSOR_BYTES) throw new SearchRequestError(400, 'invalid-cursor', 'cursor is invalid')
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { path?: unknown; line?: unknown }
    if (typeof value.path !== 'string' || typeof value.line !== 'number' || !Number.isSafeInteger(value.line) || value.line < 0 || value.path.includes('\0') || value.path.startsWith('/')) {
      throw new Error('invalid cursor')
    }
    return { path: value.path, line: value.line }
  } catch {
    throw new SearchRequestError(400, 'invalid-cursor', 'cursor is invalid')
  }
}

/** Encode the last returned match as an opaque page cursor. */
function encodeSearchCursor(match: SearchMatch): string {
  return Buffer.from(JSON.stringify({ path: match.path, line: match.line }), 'utf8').toString('base64url')
}

/** Fixed ripgrep argv; browser values are data arguments, never shell text. */
export function buildSearchCommand(
  query: string,
  include: string | undefined,
  maxFileBytes: number,
  options: { caseSensitive?: boolean; wholeWord?: boolean } = {},
): string[] {
  const args = [
    '--json',
    '--fixed-strings',
    '--sort=path',
    `--max-filesize=${String(maxFileBytes)}`,
  ]
  if (options.caseSensitive !== true) args.push('--ignore-case')
  if (options.wholeWord === true) args.push('--word-regexp')
  args.push(`--regexp=${query}`)
  if (include !== undefined) args.push(`--glob=${include}`)
  for (const name of [...VCS_EXCLUDES, ...GENERATED_EXCLUDES]) args.push(`--glob=!**/${name}`, `--glob=!**/${name}/**`)
  args.push('--', '.')
  return args
}

/** Fixed ripgrep argv for the bounded file-name scan. */
export function buildSearchFilesCommand(include: string | undefined): string[] {
  const args = ['--files', '--sort=path']
  if (include !== undefined) args.push(`--glob=${include}`)
  for (const name of [...VCS_EXCLUDES, ...GENERATED_EXCLUDES]) args.push(`--glob=!**/${name}`, `--glob=!**/${name}/**`)
  args.push('--', '.')
  return args
}

/** Parse the stable `rg --json` match records used by the Host adapter. */
export function parseSearchMatches(stdout: string): SearchMatch[] {
  const matches: SearchMatch[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    let record: unknown
    try { record = JSON.parse(line) } catch (error: unknown) { continue }
    if (typeof record !== 'object' || record === null || (record as { type?: unknown }).type !== 'match') continue
    const data = (record as { data?: unknown }).data
    if (typeof data !== 'object' || data === null) continue
    const value = data as { path?: { text?: unknown }; line_number?: unknown; lines?: { text?: unknown; bytes?: unknown } }
    if (typeof value.path?.text !== 'string' || typeof value.line_number !== 'number' || !Number.isSafeInteger(value.line_number) || value.line_number < 1) continue
    const text = typeof value.lines?.text === 'string' ? value.lines.text.replace(/\r?\n$/, '') : '(line is not valid UTF-8)'
    matches.push({ path: value.path.text.replaceAll('\\', '/'), line: value.line_number, text: truncateLine(text) })
  }
  return matches
}

/** Parse relative file paths emitted by `rg --files`. */
export function parseSearchFilePaths(stdout: string): string[] {
  return stdout.split(/\r?\n/)
    .filter(path => path.length > 0 && !path.includes('\0') && !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path))
    .map(path => path.replaceAll('\\', '/'))
}

/** Match a query against a relative file path using the Search toggles. */
export function matchesSearchPath(path: string, query: string, caseSensitive: boolean, wholeWord: boolean): boolean {
  const source = caseSensitive ? path : path.toLocaleLowerCase()
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  if (!wholeWord) return source.includes(needle)
  let start = source.indexOf(needle)
  while (start >= 0) {
    const end = start + needle.length
    if (!isWordCharacter(source[start - 1]) && !isWordCharacter(source[end])) return true
    start = source.indexOf(needle, start + 1)
  }
  return false
}

/** Run one bounded Search page against the canonical Workspace root. */
export async function searchWorkspace(
  host: SearchHostContext,
  workspaceId: WorkspaceId,
  query: string,
  include: string | undefined,
  caseSensitive: boolean,
  wholeWord: boolean,
  cursor: { path: string; line: number } | undefined,
  signal: AbortSignal,
  limits: SearchLimits,
  onMatch?: (match: SearchMatch) => void,
): Promise<SearchListing> {
  const workspace = host.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new SearchRequestError(404, 'workspace-not-found', 'Workspace was not found')
  const root = await resolveWorkspaceRoot(host.fs, workspace.path, signal)
  let handle: SubprocessHandle | undefined
  let fileHandle: SubprocessHandle | undefined
  let content: ReturnType<typeof collectSearchStream> | undefined
  try {
    const rgPath = await resolveRgPath()
    handle = host.subprocess.spawn({
      argv: [rgPath, '--no-config', ...buildSearchCommand(query, include, limits.maxFileBytes, { caseSensitive, wholeWord })],
      cwd: host.fs.processPath(root),
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 8 * 1024 } },
      graceMs: limits.graceMs,
      signal,
    })
    fileHandle = host.subprocess.spawn({
      argv: [rgPath, '--no-config', ...buildSearchFilesCommand(include)],
      cwd: host.fs.processPath(root),
      stdio: { stdin: 'ignore', stdout: { maxBytes: limits.maxRawBytes }, stderr: { maxBytes: 8 * 1024 } },
      graceMs: limits.graceMs,
      signal,
    })
    if (handle.stdout === undefined) throw new SearchRequestError(500, 'search-failed', 'Search returned no output stream')
    let progressiveMatches = 0
    let progressiveBytes = 0
    content = collectSearchStream(handle.stdout, limits.maxRawBytes, handle, (match) => {
      if (!afterCursor(match, cursor) || progressiveMatches >= limits.maxMatches) return
      const bytes = Buffer.byteLength(JSON.stringify(match), 'utf8')
      if (progressiveBytes + bytes > limits.maxBytes) return
      progressiveMatches++
      progressiveBytes += bytes
      onMatch?.(match)
    })
    const [contentOutcome, fileOutcome] = await Promise.all([handle.done, fileHandle.done])
    content.finish()
    if (!content.outputLimited && (
      contentOutcome.signal !== null
      || contentOutcome.exitCode === null
      || (contentOutcome.exitCode !== 0 && contentOutcome.exitCode !== 1)
    )) {
      throw new SearchRequestError(500, 'search-failed', 'Search could not be completed')
    }
    const contentMatches = content.matches
    const contentPaths = new Set(contentMatches.map(match => match.path))

    const fileOutput = fileHandle.collected.stdout?.readFrom(0)
    if (fileOutput === undefined) throw new SearchRequestError(500, 'search-failed', 'Search returned no file list')
    if (fileOutcome.signal !== null || fileOutcome.exitCode === null || (fileOutcome.exitCode !== 0 && fileOutcome.exitCode !== 1)) {
      throw new SearchRequestError(500, 'search-failed', 'Search file list could not be completed')
    }
    const pathMatches = parseSearchFilePaths(fileOutput.lossy ? discardPartialFirstLine(fileOutput.text) : fileOutput.text)
      .filter(path => !contentPaths.has(path) && matchesSearchPath(path, query, caseSensitive, wholeWord))
      .map(path => ({ path, line: 0, text: '', kind: 'path' as const }))
    const all = [...contentMatches, ...pathMatches]
      .filter(match => afterCursor(match, cursor))
      .sort(compareSearchMatches)
    const matches = all.slice(0, limits.maxMatches)
    const serialized = JSON.stringify({ workspaceId, query, include, matches, truncated: false })
    const byteLimited = Buffer.byteLength(serialized, 'utf8') > limits.maxBytes
    if (byteLimited) {
      while (matches.length > 0 && Buffer.byteLength(JSON.stringify({ workspaceId, query, include, matches, truncated: true }), 'utf8') > limits.maxBytes) matches.pop()
    }
    const outputLimited = content.outputLimited || fileOutput.lossy
    const truncated = outputLimited || byteLimited || all.length > matches.length
    const reason = outputLimited || byteLimited ? 'output-limit' : all.length > matches.length ? 'match-limit' : undefined
    return {
      workspaceId,
      query,
      ...(include === undefined ? {} : { include }),
      matches,
      truncated,
      ...(reason === undefined ? {} : { reason }),
      ...(truncated && matches.length > 0 ? { nextCursor: encodeSearchCursor(matches[matches.length - 1] as SearchMatch) } : {}),
    }
  } catch (error: unknown) {
    content?.finish()
    const active = [handle, fileHandle].filter((candidate): candidate is SubprocessHandle => candidate !== undefined)
    for (const candidate of active) candidate.terminate()
    await Promise.allSettled(active.map(candidate => candidate.waitForExit()))
    if (error instanceof SearchRequestError) throw error
    throw new SearchRequestError(500, 'search-failed', 'Search could not start')
  }
}

/** Serve GET /dsh-bridge/worktree/search with request cancellation and timeout. */
export async function handleSearchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: SearchHostContext,
  config: {
    searchMaxMatches: number
    searchMaxBytes: number
    searchMaxRawBytes: number
    searchMaxFileBytes: number
    searchGraceMs: number
    searchTimeoutMs: number
  },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://dsh.local')
  const stream = url.searchParams.get('stream') === '1'
  let workspaceId: WorkspaceId
  let query: string
  let include: string | undefined
  let caseSensitive: boolean
  let wholeWord: boolean
  let cursor: { path: string; line: number } | undefined
  try {
    workspaceId = parseWorkspaceId(url.searchParams.get('workspaceId'))
    query = parseSearchQuery(url.searchParams.get('query'))
    include = parseSearchInclude(url.searchParams.get('include'))
    caseSensitive = parseSearchToggle(url.searchParams.get('caseSensitive'), 'caseSensitive')
    wholeWord = parseSearchToggle(url.searchParams.get('wholeWord'), 'wholeWord')
    cursor = parseSearchCursor(url.searchParams.get('cursor'))
  } catch (error: unknown) {
    writeSearchError(res, error)
    return
  }
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, config.searchTimeoutMs)
  const abort = (): void => {
    if (!res.writableEnded) controller.abort()
  }
  req.once('aborted', abort)
  res.once('close', abort)
  try {
    if (stream) openSearchStream(res)
    const result = await searchWorkspace(host, workspaceId, query, include, caseSensitive, wholeWord, cursor, controller.signal, {
      maxMatches: config.searchMaxMatches,
      maxBytes: config.searchMaxBytes,
      maxRawBytes: config.searchMaxRawBytes,
      maxFileBytes: config.searchMaxFileBytes,
      graceMs: config.searchGraceMs,
    }, stream ? (match) => { writeSearchStreamEvent(res, { type: 'match', match }) } : undefined)
    if (!res.writableEnded) {
      if (stream) {
        writeSearchStreamEvent(res, { type: 'done', listing: result })
        res.end()
      } else {
        writeJson(res, 200, result)
      }
    }
  } catch (error: unknown) {
    if (!res.writableEnded && !req.destroyed) {
      const failure = timedOut ? new SearchRequestError(504, 'timeout', 'Search timed out') : error
      if (stream && res.headersSent) {
        writeSearchStreamEvent(res, { type: 'error', error: searchErrorBody(failure) })
        res.end()
      } else {
        writeSearchError(res, failure)
      }
    }
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', abort)
    res.removeListener('close', abort)
  }
}

async function resolveWorkspaceRoot(fs: FileSystem, path: string, signal: AbortSignal): Promise<FsTarget> {
  try {
    const root = await fs.resolve(path, { signal })
    const info = await fs.stat(root, signal)
    if (info?.type !== 'directory') throw new SearchRequestError(404, 'workspace-unavailable', 'Workspace is unavailable')
    return root
  } catch (error: unknown) {
    if (error instanceof SearchRequestError) throw error
    throw new SearchRequestError(404, 'workspace-unavailable', 'Workspace is unavailable')
  }
}

function afterCursor(match: SearchMatch, cursor: { path: string; line: number } | undefined): boolean {
  return cursor === undefined || compareSearchPositions(match, cursor) > 0
}

function compareSearchMatches(left: SearchMatch, right: SearchMatch): number {
  return compareSearchPositions(left, right)
}

/** Compare two Search positions with the same deterministic order used by pagination. */
export function compareSearchPositions(
  left: Pick<SearchMatch, 'path' | 'line'>,
  right: Pick<SearchMatch, 'path' | 'line'>,
): number {
  const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  return pathOrder || left.line - right.line
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /^[\p{L}\p{N}_]$/u.test(value)
}

function truncateLine(value: string): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= MAX_LINE_BYTES) return value
  return bytes.subarray(0, MAX_LINE_BYTES).toString('utf8') + ' (line truncated)'
}

/**
 * Incrementally parse bounded ripgrep stdout and terminate the process when its raw-output allowance is exhausted.
 * @param stdout - Piped ripgrep stdout owned by the active search.
 * @param maxBytes - Maximum raw bytes accepted from the process.
 * @param handle - Process handle terminated when stdout reaches the byte limit.
 * @param onMatch - Called synchronously for each complete match record.
 * @returns Accumulated matches, truncation state, and an idempotent finalizer.
 */
export function collectSearchStream(
  stdout: Readable,
  maxBytes: number,
  handle: Pick<SubprocessHandle, 'terminate'>,
  onMatch: (match: SearchMatch) => void,
): { matches: SearchMatch[]; outputLimited: boolean; finish(): void } {
  const decoder = new StringDecoder('utf8')
  const matches: SearchMatch[] = []
  let pending = ''
  let bytes = 0
  let outputLimited = false
  let finished = false
  const consumeLines = (final: boolean): void => {
    const lines = pending.split('\n')
    pending = final ? '' : lines.pop() ?? ''
    for (const line of lines) {
      const match = parseSearchMatches(line)[0]
      if (match !== undefined) {
        matches.push(match)
        onMatch(match)
      }
    }
  }
  const onData = (chunk: Buffer | string): void => {
    if (outputLimited) return
    const value = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    const remaining = maxBytes - bytes
    if (value.byteLength > remaining) {
      pending += decoder.write(value.subarray(0, Math.max(0, remaining)))
      bytes = maxBytes
      outputLimited = true
      consumeLines(false)
      handle.terminate()
      return
    }
    bytes += value.byteLength
    pending += decoder.write(value)
    consumeLines(false)
  }
  stdout.on('data', onData)
  return {
    matches,
    get outputLimited() { return outputLimited },
    finish() {
      if (finished) return
      finished = true
      stdout.removeListener('data', onData)
      if (!outputLimited) pending += decoder.end()
      consumeLines(true)
    },
  }
}

function discardPartialFirstLine(value: string): string {
  const newline = value.indexOf('\n')
  return newline < 0 ? '' : value.slice(newline + 1)
}

function parseWorkspaceId(raw: string | null): WorkspaceId {
  if (raw === null || raw.length === 0 || raw.includes('\0')) throw new SearchRequestError(400, 'invalid-workspace-id', 'workspaceId is invalid')
  return raw as WorkspaceId
}

function writeSearchError(res: ServerResponse, error: unknown): void {
  const body = searchErrorBody(error)
  writeJson(res, error instanceof SearchRequestError ? error.status : 500, body)
}

function searchErrorBody(error: unknown): { ok: false; code: string; message: string } {
  return error instanceof SearchRequestError
    ? { ok: false, code: error.code, message: error.message }
    : { ok: false, code: 'search-failed', message: 'Search failed' }
}

function openSearchStream(res: ServerResponse): void {
  res.statusCode = 200
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('cache-control', 'no-cache')
  res.flushHeaders()
}

function writeSearchStreamEvent(res: ServerResponse, event: unknown): void {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`)
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
