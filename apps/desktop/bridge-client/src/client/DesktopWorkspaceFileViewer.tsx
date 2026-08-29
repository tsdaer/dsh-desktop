// Read-only file viewer for the Worktree Explorer and Search: fetches the
// bounded Host projection (/dsh-bridge/worktree/file), renders Markdown through
// the shared sanitized primitive, and renders other text as a line-numbered,
// syntax-highlighted surface. Binary and non-UTF-8 content is refused by the
// Host and rendered as a stable error; oversized files carry an explicit
// truncation state. Opening a Search result scrolls the viewer to the matched line.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { grammarLoadCount, highlightLines, subscribeGrammarLoaded } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { bridgeFetch } from './bridge-fetch.ts'
import { projectFilePreview } from './DesktopWorkspacePreview.ts'
import css from './DesktopWorkspaceWorkbench.module.css'

export { langFromPath } from './DesktopWorkspacePreview.ts'

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

/** Fetch and validate the bounded file projection.
 * @param workspaceId - Selected Workspace id.
 * @param path - Workspace-relative file path.
 * @param signal - Cancels the fetch.
 * @returns The validated projection.
 * @throws Error with a stable message when the Host refuses or the response is invalid.
 */
export async function fetchFileView(workspaceId: string, path: string, signal: AbortSignal): Promise<FileView> {
  const query = new URLSearchParams({ workspaceId, path })
  const response = await bridgeFetch(`/dsh-bridge/worktree/file?${query.toString()}`, { signal })
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
  const projection = useMemo(() => view === null ? null : projectFilePreview(view.path, view.text), [view])
  const lang = projection?.language
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const raw = useMemo(() => view?.text ?? '', [view])
  const highlighted = useMemo(() => projection?.mode === 'code' ? highlightLines(raw, lang) : undefined, [raw, lang, loaded, projection])
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

  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('worktree.copy'), copiedLabel: t('worktree.copied') },
    footnotes: t('worktree.footnotes'),
  }), [t])

  const onCopy = useCallback(() => {
    if (view === null) return
    void writeClipboard(view.text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [view])

  const title = projection?.title ?? ''
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
        <span className={css.fileTitle} title={view?.path ?? ''}>{title}</span>
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
          {projection?.mode === 'markdown'
            ? <div className={css.fileMarkdown} data-file-markdown=""><MarkdownText text={projection.content} labels={markdownLabels} /></div>
            : <div ref={bodyRef} className={css.fileBody} data-file-body="">
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
            </div>}
          {note === null ? null : <div className={css.explorerState} role="status">{note}</div>}
        </>
      )}
    </div>
  )
}
