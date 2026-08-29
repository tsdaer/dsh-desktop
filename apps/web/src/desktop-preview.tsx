import { createRoot } from 'react-dom/client'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { desktopPreviewCopy } from './locales/desktop-preview.ts'

interface TauriLike {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
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

function PreviewApp(): ReactElement {
  const request = useMemo(requestFromLocation, [])
  const [language, setLanguage] = useState(() => document.documentElement.lang || 'en')
  const copy = desktopPreviewCopy(language)
  const [state, setState] = useState<State>(() => 'error' in request ? { status: 'error', message: request.error } : { status: 'loading' })
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
  return (
    <main data-desktop-file-preview="">
      <header>
        <strong title={'error' in request ? '' : request.path}>{title}</strong>
        <button type="button" onClick={close}>{copy.close}</button>
      </header>
      {state.status === 'loading' ? <p>{copy.loading}</p> : null}
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      {state.status === 'ready' ? (
        <>
          <p data-preview-path="">{state.view.path}</p>
          {isMarkdown(state.view.path)
            ? <MarkdownText text={state.view.text} labels={{ code: labels, footnotes: copy.footnotes }} />
            : <CodeBlock
              code={state.view.text}
              lang={pathLanguage(state.view.path)}
              copyLabel={labels.copyLabel}
              copiedLabel={labels.copiedLabel}
            />}
          {state.view.truncated ? <p role="status">{copy.truncated}</p> : null}
        </>
      ) : null}
    </main>
  )
}

/** Mount the minimal desktop file preview entry. */
export function mountDesktopPreview(element: HTMLElement): void {
  createRoot(element).render(<PreviewApp />)
}
