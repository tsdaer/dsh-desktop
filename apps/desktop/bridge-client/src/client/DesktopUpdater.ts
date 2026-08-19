import { check, type Update } from '@tauri-apps/plugin-updater'

/** Failure categories surfaced by the desktop updater control. */
export type DesktopUpdateFailure = 'network' | 'manifest' | 'verification' | 'install' | 'unknown'

/** Explicit states shown by the title-bar updater control. */
export type DesktopUpdateState =
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; completed: number; total: number | undefined }
  | { kind: 'ready'; version: string }
  | { kind: 'failed'; reason: DesktopUpdateFailure }

/** Localized labels needed by the title-bar updater control. */
export interface DesktopUpdaterLabels {
  checking: string
  upToDate: string
  available: (version: string) => string
  downloading: (percent: number | undefined) => string
  ready: (version: string) => string
  networkFailure: string
  manifestFailure: string
  verificationFailure: string
  installFailure: string
  unknownFailure: string
  confirmDownload: (version: string) => string
  confirmInstall: (version: string) => string
}

/** Native updater operations consumed by the title-bar state machine. */
export interface DesktopUpdaterAdapter {
  check(): Promise<Update | null>
  download(update: Update, onProgress: (completed: number, total: number | undefined) => void): Promise<void>
  install(update: Update): Promise<void>
}

const updaterAdapter: DesktopUpdaterAdapter = {
  check: () => check({ timeout: 10_000 }),
  download: async (update, onProgress) => {
    let completed = 0
    let total: number | undefined
    await update.download((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength
      } else if (event.event === 'Progress') {
        completed += event.data.chunkLength
        onProgress(completed, total)
      }
    })
  },
  install: update => update.install(),
}

/** Classify updater errors without displaying raw transport or signature details. */
export function classifyDesktopUpdateFailure(error: unknown): DesktopUpdateFailure {
  const message = String(error).toLowerCase()
  if (message.includes('signature') || message.includes('invalid signature') || message.includes('verification')) return 'verification'
  if (message.includes('manifest') || message.includes('json') || message.includes('release')) return 'manifest'
  if (message.includes('install') || message.includes('installer')) return 'install'
  if (message.includes('network') || message.includes('timeout') || message.includes('timed out') || message.includes('fetch') || message.includes('http')) return 'network'
  return 'unknown'
}

/** Return the user-facing label for one explicit updater state. */
export function desktopUpdateLabel(state: DesktopUpdateState, labels: DesktopUpdaterLabels): string {
  switch (state.kind) {
    case 'checking': return labels.checking
    case 'up-to-date': return labels.upToDate
    case 'available': return labels.available(state.version)
    case 'downloading': {
      const percent = state.total === undefined || state.total <= 0
        ? undefined
        : Math.min(100, Math.round(state.completed / state.total * 100))
      return labels.downloading(percent)
    }
    case 'ready': return labels.ready(state.version)
    case 'failed':
      switch (state.reason) {
        case 'network': return labels.networkFailure
        case 'manifest': return labels.manifestFailure
        case 'verification': return labels.verificationFailure
        case 'install': return labels.installFailure
        case 'unknown': return labels.unknownFailure
        default: return assertNever(state.reason)
      }
    default: return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected updater value: ${String(value)}`)
}

/**
 * Mount the post-boot updater check beside the title-bar balance control.
 * The control never downloads without confirmation and keeps failures local
 * to the desktop chrome.
 *
 * @param labels - localized control labels and confirmation messages
 * @param adapter - updater implementation, replaceable by focused tests
 * @returns disposer for the retry timer and control listeners
 */
export function mountDesktopUpdater(labels: DesktopUpdaterLabels, adapter: DesktopUpdaterAdapter = updaterAdapter): () => void {
  let disposed = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let checkRequest: Promise<void> | undefined
  let update: Update | null = null
  let state: DesktopUpdateState = { kind: 'checking' }
  let button: HTMLButtonElement | undefined

  const failureLabel = (reason: DesktopUpdateFailure): string => desktopUpdateLabel({ kind: 'failed', reason }, labels)
  const render = (): void => {
    if (button === undefined) return
    button.textContent = desktopUpdateLabel(state, labels)
    button.dataset.state = state.kind
    button.disabled = state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'up-to-date'
    button.title = button.textContent
    button.setAttribute('aria-label', button.textContent)
  }

  const mount = (): boolean => {
    const bar = document.getElementById('dsh-desktop-titlebar')
    if (bar === null) return false
    const existing = document.getElementById('dsh-desktop-updater')
    if (existing instanceof HTMLButtonElement) {
      button = existing
      render()
      return true
    }
    button = document.createElement('button')
    button.id = 'dsh-desktop-updater'
    button.type = 'button'
    button.className = 'bar-updater'
    button.addEventListener('click', () => { void onClick() })
    const balance = bar.querySelector('.bar-balance')
    if (balance === null) bar.appendChild(button)
    else bar.insertBefore(button, balance)
    render()
    return true
  }

  const onClick = async (): Promise<void> => {
    if (disposed) return
    if (state.kind === 'failed' || state.kind === 'up-to-date') {
      await runCheck()
      return
    }
    if (state.kind === 'available' && update !== null) {
      if (!window.confirm(labels.confirmDownload(update.version))) return
      await download(update)
      return
    }
    if (state.kind === 'ready' && update !== null) {
      if (!window.confirm(labels.confirmInstall(update.version))) return
      try {
        await adapter.install(update)
      } catch (error) {
        state = { kind: 'failed', reason: 'install' }
        render()
        console.warn(failureLabel('install'), error)
      }
    }
  }

  const download = async (candidate: Update): Promise<void> => {
    state = { kind: 'downloading', completed: 0, total: undefined }
    render()
    try {
      await adapter.download(candidate, (completed, total) => {
        if (disposed) return
        state = { kind: 'downloading', completed, total }
        render()
      })
      if (disposed) return
      state = { kind: 'ready', version: candidate.version }
      render()
    } catch (error) {
      if (disposed) return
      state = { kind: 'failed', reason: classifyDesktopUpdateFailure(error) }
      render()
      console.warn(failureLabel(state.reason), error)
    }
  }

  const runCheck = async (): Promise<void> => {
    if (checkRequest !== undefined) return checkRequest
    state = { kind: 'checking' }
    update = null
    render()
    checkRequest = adapter.check().then((candidate) => {
      if (disposed) return
      update = candidate
      state = candidate === null ? { kind: 'up-to-date' } : { kind: 'available', version: candidate.version }
      render()
    }).catch((error: unknown) => {
      if (disposed) return
      state = { kind: 'failed', reason: classifyDesktopUpdateFailure(error) }
      render()
      console.warn(failureLabel(state.reason), error)
    }).finally(() => {
      checkRequest = undefined
    })
    return checkRequest
  }

  const start = (): void => {
    if (mount()) {
      retryTimer = setTimeout(() => { void runCheck() }, 1_500)
      return
    }
    retryTimer = setTimeout(start, 100)
  }
  start()

  return () => {
    disposed = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    button?.remove()
    button = undefined
  }
}
