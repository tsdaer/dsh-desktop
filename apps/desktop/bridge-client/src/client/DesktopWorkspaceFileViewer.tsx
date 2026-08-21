// Read-only file viewer for the Worktree Explorer and Search: fetches the
// bounded Host projection (/dsh-bridge/worktree/file) and renders it as a
// line-numbered, syntax-highlighted surface through the client's existing
// highlighter. Binary and non-UTF-8 content is refused by the Host and
// rendered as a stable error; oversized files carry an explicit truncation
// state. Opening a Search result scrolls the viewer to the matched line.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { grammarLoadCount, highlightLines, subscribeGrammarLoaded } from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DesktopWorkspaceWorkbench.module.css'

/** One validated Host projection of the file view route. */
export interface FileView {
  workspaceId: string
  path: string
  text: string
  truncated: boolean
}

/** File-view request state for the viewer surface. */
export type FileViewState =
  | { status: 'loading' }
  | { status: 'ready'; view: FileView }
  | { status: 'error'; code?: string; message: string }

/** Lowercased file-extension to syntax-highlighting language hint; unknown
 *  extensions render plain monospace. Mirrors the read tool's mapping so a
 *  file highlights the same way in the Worktree viewer and a read card. */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/** Derive a syntax-highlighting language hint from a path's extension.
 * @param path - Workspace-relative file path.
 * @returns the shiki language id, or undefined for an unknown extension.
 */
export function langFromPath(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

/** Fetch and validate the bounded file projection.
 * @param workspaceId - Selected Workspace id.
 * @param path - Workspace-relative file path.
 * @param signal - Cancels the fetch.
 * @returns The validated projection.
 * @throws Error with a stable message when the Host refuses or the response is invalid.
 */
export async function fetchFileView(workspaceId: string, path: string, signal: AbortSignal): Promise<FileView> {
  const query = new URLSearchParams({ workspaceId, path })
  const response = await fetch(`/dsh-bridge/worktree/file?${query.toString()}`, { signal })
  const body = await response.json() as unknown
  if (!response.ok) {
    const record = body as { code?: unknown; message?: unknown }
    const code = typeof record.code === 'string' ? record.code : undefined
    const message = typeof record.message === 'string' ? record.message : 'file view failed'
    throw new Error(JSON.stringify({ code, message }))
  }
  return parseFileView(body)
}

/** Narrow the Host projection; malformed responses are refused. */
export function parseFileView(value: unknown): FileView {
  if (typeof value !== 'object' || value === null) throw new Error('File view returned an invalid response')
  const record = value as Record<string, unknown>
  if (typeof record.workspaceId !== 'string'
    || typeof record.path !== 'string'
    || typeof record.text !== 'string'
    || typeof record.truncated !== 'boolean') {
    throw new Error('File view returned an invalid response')
  }
  return { workspaceId: record.workspaceId, path: record.path, text: record.text, truncated: record.truncated }
}

/** One rendered line: its 1-based number and highlighted runs (plain when unknown). */
interface ViewerLine {
  number: number
  text: string
  spans?: readonly { text: string; style: React.CSSProperties }[]
}

/** Split the bounded text into numbered lines (trailing newline yields no empty tail row). */
function linesOf(text: string): string[] {
  const split = text.split('\n')
  return text.endsWith('\n') ? split.slice(0, -1) : split
}

/** Load one bounded file projection and track its lifecycle. */
export function useFileView(workspaceId: string, path: string): FileViewState {
  const [state, setState] = useState<FileViewState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void fetchFileView(workspaceId, path, controller.signal)
      .then((view) => { if (!controller.signal.aborted) setState({ status: 'ready', view }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        let code: string | undefined
        let message = ''
        if (error instanceof Error) {
          try {
            const parsed = JSON.parse(error.message) as { code?: unknown; message?: unknown }
            if (typeof parsed.code === 'string') code = parsed.code
            if (typeof parsed.message === 'string') message = parsed.message
          } catch {
            message = error.message
          }
        }
        setState({ status: 'error', ...(code === undefined ? {} : { code }), message })
      })
    return () => { controller.abort() }
  }, [path, workspaceId])
  return state
}

/** Read-only file surface: header, line-numbered highlighted body, and error/truncation states. */
export function DesktopWorkspaceFileViewer({ workspaceId, path, onClose, scrollToLine, t }: {
  workspaceId: string
  path: string
  onClose(): void
  /** 1-based file line to scroll into view once ready (a Search result target). */
  scrollToLine?: number | undefined
  t: (key: string) => string
}): React.ReactElement {
  const state = useFileView(workspaceId, path)
  const view = state.status === 'ready' ? state.view : null
  const lang = useMemo(() => view === null ? undefined : langFromPath(view.path), [view])
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const raw = useMemo(() => view?.text ?? '', [view])
  const highlighted = useMemo(() => highlightLines(raw, lang), [raw, lang, loaded])
  const rows = useMemo<ViewerLine[]>(() => {
    if (view === null) return []
    return linesOf(view.text).map((text, index) => {
      const spans = highlighted?.[index]
      return { number: index + 1, text, ...(spans === undefined ? {} : { spans }) }
    })
  }, [highlighted, view])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (view === null || scrollToLine === undefined || bodyRef.current === null) return
    const target = bodyRef.current.querySelector<HTMLElement>(`[data-file-line="${scrollToLine}"]`)
    target?.scrollIntoView({ block: 'center' })
  }, [scrollToLine, view])

  const onCopy = useCallback(() => {
    if (view === null) return
    void writeClipboard(view.text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [view])

  const title = view?.path ?? ''
  const note = state.status === 'error'
    ? state.code === 'binary-file'
      ? t('worktree.fileBinary')
      : state.message
    : state.status === 'ready' && state.view.truncated
      ? t('worktree.fileTruncated')
      : null

  return (
    <div className={css.filePanel} data-file-viewer="">
      <div className={css.fileHeader}>
        <span className={css.fileTitle} title={title}>{title}</span>
        {view !== null && (
          <button type="button" className={css.sourceControlAction} onClick={onCopy}>
            {copied ? t('worktree.copied') : t('worktree.copy')}
          </button>
        )}
        <button type="button" className={css.sourceControlAction} onClick={onClose}>{t('worktree.diffClose')}</button>
      </div>
      {state.status === 'loading' ? <div className={css.explorerState}>{t('worktree.fileLoading')}</div> : null}
      {state.status === 'error' ? <div className={css.searchError} role="alert">{note ?? t('worktree.fileFailed')}</div> : null}
      {view !== null && (
        <>
          <div ref={bodyRef} className={css.fileBody} data-file-body="">
            {rows.map(row => (
              <div key={row.number} className={css.fileLine} data-file-line={row.number}>
                <span className={css.fileGutter} aria-hidden>{row.number}</span>
                <span className={css.fileContent}>
                  {row.spans === undefined
                    ? row.text
                    : row.spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)}
                </span>
              </div>
            ))}
          </div>
          {note === null ? null : <div className={css.explorerState} role="status">{note}</div>}
        </>
      )}
    </div>
  )
}
