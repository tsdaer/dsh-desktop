import { createRoot } from 'react-dom/client'
import {
  CodeBlock,
  IconCloseOutline16,
  IconCodeOutline16,
  IconLoadingOutline16,
  IconWarningOutline16,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import '@deepseek-ai/dsh-client-web/src/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/scrollbar.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/shiki.css'
import './desktop-preview.css'
import { desktopPreviewCopy } from './locales/desktop-preview.ts'

interface TauriLike {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  }
  event?: {
    listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>
  }
}

interface FileView {
  workspaceId: string
  path: string
  text: string
  truncated: boolean
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; view: FileView }
  | { status: 'error'; message: string }

/** Theme snapshot broadcast by the shell from the main window's theme service. */
interface PreviewThemeSnapshot {
  colorScheme: 'light' | 'dark'
  fontSize: number
  tokens: Record<string, string>
}

/** The shell's theme-change event name (see set_preview_theme in main.rs). */
const THEME_EVENT = 'dsh://theme-change'

/** Bound one preview load so a stalled native bridge cannot leave a permanent spinner. */
const PREVIEW_LOAD_TIMEOUT_MS = 10_000

const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'cs', kt: 'kotlin',
  swift: 'swift', php: 'php', sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

const tauri = (): TauriLike | undefined => (window as unknown as { __TAURI__?: TauriLike }).__TAURI__

function normalizePath(value: string): string | null {
  if (value.length === 0 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return null
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    if (part.length === 0) return null
    parts.push(part)
  }
  return parts.length === 0 ? null : parts.join('/')
}

function pathLanguage(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  return LANG_BY_EXTENSION[base.slice(dot + 1).toLowerCase()]
}

function isMarkdown(path: string): boolean {
  return /\.(?:md|markdown|mdx)$/iu.test(path)
}

function pathKind(path: string): string | undefined {
  if (isMarkdown(path)) return 'Markdown'
  const language = pathLanguage(path)
  return language?.toUpperCase()
}

function safeExternalUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value, window.location.href)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0
    || url.origin === window.location.origin
    || url.pathname === '/dsh-bridge'
    || url.pathname.startsWith('/dsh-bridge/')
    || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())) return null
  return url.href
}

function messageFor(code: string | undefined, copy: ReturnType<typeof desktopPreviewCopy>): string {
  return code === 'binary-file' ? copy.binary : copy.failed
}

/**
 * Apply a resolved theme snapshot to the preview document: root color-scheme,
 * the body palette attribute, the content font-size axis, and the active
 * theme's alias-token overrides (the same projection the main window's
 * ui-layout presenter performs, kept local because the preview page must not
 * import the presenter).
 */
function applyPreviewTheme(snapshot: PreviewThemeSnapshot): void {
  document.documentElement.style.colorScheme = snapshot.colorScheme
  const body = document.body
  if (snapshot.colorScheme === 'dark') body.setAttribute('data-ds-dark-theme', '')
  else body.removeAttribute('data-ds-dark-theme')
  body.style.setProperty('--dsh-content-font-size', `${snapshot.fontSize}px`)
  for (const [name, value] of Object.entries(snapshot.tokens)) body.style.setProperty(name, value)
}

function requestFromLocation(): { workspaceId: string; path: string } | { error: string } {
  const params = new URLSearchParams(location.search)
  const workspaceId = params.get('workspaceId')
  const rawPath = params.get('path')
  const path = rawPath === null ? null : normalizePath(rawPath)
  if (workspaceId === null || workspaceId.length === 0 || path === null || path !== rawPath) {
    return { error: desktopPreviewCopy(document.documentElement.lang).invalidRequest }
  }
  return { workspaceId, path }
}

/** Make a native command settle when the preview is torn down or timed out. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('preview request aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error('preview request aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

async function readPreview(request: { workspaceId: string; path: string }, signal: AbortSignal): Promise<FileView> {
  const copy = desktopPreviewCopy(document.documentElement.lang)
  const token = await abortable(
    tauri()?.core?.invoke<string>('preview_bridge_token') ?? Promise.resolve(undefined),
    signal,
  )
  if (typeof token !== 'string' || token.length === 0) throw new Error(copy.unavailable)
  const query = new URLSearchParams(request)
  const response = await fetch(`/dsh-bridge/worktree/file?${query.toString()}`, {
    signal,
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await abortable(response.json() as Promise<unknown>, signal)
  if (!response.ok || typeof body !== 'object' || body === null) {
    const record = body as { code?: unknown }
    throw new Error(messageFor(typeof record.code === 'string' ? record.code : undefined, copy))
  }
  const record = body as Record<string, unknown>
  if (typeof record.workspaceId !== 'string' || typeof record.path !== 'string' || typeof record.text !== 'string' || typeof record.truncated !== 'boolean') {
    throw new Error(copy.invalidResponse)
  }
  return { workspaceId: record.workspaceId, path: record.path, text: record.text, truncated: record.truncated }
}

/**
 * Narrow an unknown theme-change payload to the fields the preview renders;
 * malformed broadcasts are refused.
 */
function parseThemeSnapshot(value: unknown): PreviewThemeSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const colorScheme = record.colorScheme
  const fontSize = record.fontSize
  const tokens = record.tokens
  if (colorScheme !== 'light' && colorScheme !== 'dark') return null
  if (typeof fontSize !== 'number' || !Number.isInteger(fontSize)) return null
  if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) return null
  return { colorScheme, fontSize, tokens: tokens as Record<string, string> }
}

function PreviewApp(): ReactElement {
  const request = useMemo(requestFromLocation, [])
  const [language, setLanguage] = useState(() => document.documentElement.lang || 'en')
  const copy = desktopPreviewCopy(language)
  const [state, setState] = useState<State>(() => 'error' in request ? { status: 'error', message: request.error } : { status: 'loading' })
  useEffect(() => {
    // The shell broadcasts the main window's resolved theme to every preview;
    // without the shell (plain browser dev) the system color scheme stands in.
    const events = tauri()?.event
    if (events === undefined) {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const apply = (): void => { document.body.toggleAttribute('data-ds-dark-theme', media.matches) }
      apply()
      media.addEventListener('change', apply)
      return () => { media.removeEventListener('change', apply) }
    }
    let disposed = false
    void events.listen(THEME_EVENT, (event) => {
      const snapshot = parseThemeSnapshot(event.payload)
      if (snapshot !== null && !disposed) applyPreviewTheme(snapshot)
    }).then((off) => {
      if (disposed) off()
    }).catch(() => { /* listener unavailable: keep the system scheme */ })
    return () => { disposed = true }
  }, [])
  useEffect(() => {
    const pending = tauri()?.core?.invoke<string>('preview_locale')
    if (pending === undefined) return
    void pending.then((locale) => {
      if (typeof locale !== 'string' || locale.length === 0) return
      document.documentElement.lang = locale
      setLanguage(locale)
    })
  }, [])
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (anchor === null) return
      const url = safeExternalUrl(anchor.getAttribute('href') ?? '')
      if (url === null) {
        event.preventDefault()
        return
      }
      if (event.button !== 0) return
      event.preventDefault()
      const pending = tauri()?.core?.invoke('open_external_url', { url })
      if (pending === undefined) window.open(url, '_blank', 'noopener,noreferrer')
      else void pending.catch(() => {})
    }
    document.addEventListener('click', onClick, true)
    return () => { document.removeEventListener('click', onClick, true) }
  }, [])
  useEffect(() => {
    if ('error' in request) return undefined
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, PREVIEW_LOAD_TIMEOUT_MS)
    void readPreview(request, controller.signal)
      .then((view) => {
        if (timedOut) setState({ status: 'error', message: copy.timeout })
        else if (!controller.signal.aborted) setState({ status: 'ready', view })
      })
      .catch((error: unknown) => {
        if (timedOut) setState({ status: 'error', message: copy.timeout })
        else if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : messageFor(undefined, copy) })
      })
      .finally(() => { clearTimeout(timer) })
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [language, request])

  const close = (): void => { void tauri()?.core?.invoke('close_file_preview') }
  const labels = { copyLabel: copy.copy, copiedLabel: copy.copied }
  const title = 'error' in request ? '' : request.path.split('/').pop() ?? request.path
  const kind = 'error' in request ? undefined : pathKind(request.path)
  return (
    <main data-desktop-file-preview="">
      <header data-preview-header="">
        <div data-preview-heading="">
          <span data-preview-file-icon="" aria-hidden="true"><IconCodeOutline16 size={18} /></span>
          <span data-preview-title-group="">
            <strong title={'error' in request ? '' : request.path}>{title}</strong>
            {'error' in request ? null : <span data-preview-path="" title={request.path}>{request.path}</span>}
          </span>
        </div>
        <div data-preview-actions="">
          {kind === undefined ? null : <span data-preview-kind="">{kind}</span>}
          <button data-preview-close="" type="button" onClick={close} aria-label={copy.close} title={copy.close}>
            <IconCloseOutline16 />
          </button>
        </div>
      </header>
      <section data-preview-viewport="">
        {state.status === 'loading' ? (
          <div data-preview-state="loading" role="status">
            <span data-preview-state-icon=""><IconLoadingOutline16 size={20} /></span>
            <p>{copy.loading}</p>
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div data-preview-state="error" role="alert">
            <span data-preview-state-icon=""><IconWarningOutline16 size={20} /></span>
            <p>{state.message}</p>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <article data-preview-document={isMarkdown(state.view.path) ? 'markdown' : 'code'}>
            {state.view.truncated ? <p data-preview-truncated="" role="status">{copy.truncated}</p> : null}
            {isMarkdown(state.view.path)
              ? <MarkdownText text={state.view.text} labels={{ code: labels, footnotes: copy.footnotes }} />
              : <CodeBlock
                code={state.view.text}
                lang={pathLanguage(state.view.path)}
                copyLabel={labels.copyLabel}
                copiedLabel={labels.copiedLabel}
              />}
          </article>
        ) : null}
      </section>
    </main>
  )
}

/** Mount the minimal desktop file preview entry. */
export function mountDesktopPreview(element: HTMLElement): void {
  createRoot(element).render(<PreviewApp />)
}
