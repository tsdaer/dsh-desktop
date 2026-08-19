import { BridgeCloseRow } from './BridgeCloseRow.tsx'
import { BridgeDebugRow } from './BridgeDebugRow.tsx'
import css from './BridgeRow.module.css'
import { BridgeSection } from './BridgeSection.tsx'
import { DesktopWorkspaceWorkbench } from './DesktopWorkspaceWorkbench.tsx'
import { en, zh } from './locales.ts'

// @deepseek-ai/dsh-desktop-bridge-client — browser half of the shell bridge.
//
// OS file drops are handled by the Tauri shell (`onDragDropEvent`), which
// yields real filesystem paths — WebView2's own drops expose no File.path.
// On drop: image files travel back through the shell's bounded
// `read_dropped_file` command and re-enter the dsh composer's native image
// intake as a synthetic drop; every other file has its path inserted into
// the composer input box. A drop overlay gives drag feedback while the OS
// drag is over the window. The plugin also hosts the desktop settings
// section (close-to-tray + debug mode): close-to-tray is mirrored into the
// shell via `set_close_to_tray` so the close button can hide instead of
// exiting, and the debug guard suppresses right-click and devtools
// shortcuts while off. Finally, when the shell was launched with a folder
// ("以 dsh-desktop 打开"), the page jumps to the matching workspace after
// the workspace baseline is ready.

/** Stable Cordis plugin name. */
export const name = 'desktop-bridge-client'

/** Services required before the listener and settings rows can run. */
export const inject = ['sessions', 'workspaces', 'slots', 'locale']

/** Minimal view of the client-runtime sessions service this plugin consumes. */
interface SessionsLike {
  list: {
    getSnapshot(): { current: string | undefined; ids: readonly string[]; byId: Record<string, { updatedAt?: number } | undefined> }
  }
  open(id: string): void
}

/** Minimal view of the client-runtime workspaces service this plugin consumes. */
interface WorkspacesLike {
  list: {
    getSnapshot(): {
      baselinesReady: boolean
      items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[]
    }
    subscribe(listener: () => void): () => void
  }
  create(input: { path: string }): Promise<{ workspaceId: string }>
  startSession(workspaceId?: string): void
}

/** Minimal view of the slots service this plugin consumes. */
interface SlotsLike {
  inject(name: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** Minimal view of the locale service this plugin consumes. */
interface LocaleLike {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string) => string
}

/** Minimal view of the cordis context this plugin consumes. */
interface BridgeClientContext {
  sessions: SessionsLike
  workspaces: WorkspacesLike
  slots: SlotsLike
  locale: LocaleLike
}

/** Minimal view of the injected Tauri APIs (withGlobalTauri). */
interface TauriEventApi {
  listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>
}

interface TauriWebviewApi {
  getCurrentWebview(): {
    onDragDropEvent(handler: (event: { payload: DragDropPayload }) => void): Promise<() => void>
  }
}

interface TauriLike {
  event?: TauriEventApi
  core?: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
  }
  webview?: TauriWebviewApi
}

function getTauri(): TauriLike | undefined {
  return (window as unknown as { __TAURI__?: TauriLike }).__TAURI__
}

function hasTauriInternals(): boolean {
  return '__TAURI_INTERNALS__' in window
}

/** One Tauri drag-drop payload (`enter`/`over` carry no paths; `leave` none at all). */
interface DragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave'
  paths?: string[]
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

// Module-level binding guard: however many times the plugin fiber applies,
// only the first bind owns the listeners and settings registrations
// (duplicate binds would handle every drop once per bind).
let bound = false

// Debug mode mirror: while false (default), right-click and devtools
// shortcuts are suppressed on the page. Updated from the settings row and
// at bind time; the shell-side AreDevToolsEnabled follows through the
// set_debug_mode command.
let debugMode = false

/** Devtools-relevant shortcut keys (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S). */
const DEVTOOLS_KEYS = new Set(['f12', 'i', 'j', 'c', 'u', 's'])

function onContextMenuCapture(event: MouseEvent): void {
  if (!debugMode) event.preventDefault()
}

function onKeyDownCapture(event: KeyboardEvent): void {
  if (debugMode) return
  const key = event.key.toLowerCase()
  const isDevtools = key === 'f12'
    || ((event.ctrlKey || event.metaKey) && DEVTOOLS_KEYS.has(key))
    || ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j', 'c'].includes(key))
  if (isDevtools) event.preventDefault()
}

/**
 * Apply the debug-mode guard both on the page and in WebView2.
 * @param enabled - whether debug mode is on.
 */
function applyDebugMode(enabled: boolean): void {
  debugMode = enabled
  const tauri = getTauri()
  if (tauri?.core) {
    void tauri.core.invoke('set_debug_mode', { enabled }).catch(() => {
      /* shell command unavailable (plain browser dev): page guard still applies */
    })
  }
}

// Close-to-tray mirror: the durable setting lives in the bridge host's
// settings section; the shell decides what a close means, so every change
// (and the boot-time read) is pushed through `set_close_to_tray`.
function applyCloseToTray(enabled: boolean): void {
  const tauri = getTauri()
  if (tauri?.core) {
    void tauri.core.invoke('set_close_to_tray', { enabled }).catch(() => {
      /* shell command unavailable (plain browser dev): no close interception */
    })
  }
}

/**
 * The drop overlay: fixed full-window feedback while an OS file drag is over
 * the window (the Tauri shell owns the drag, so the composer's own overlay
 * never sees dragenter).
 */
let overlayEl: HTMLDivElement | null = null

function showDropOverlay(): void {
  if (overlayEl !== null) return
  overlayEl = document.createElement('div')
  overlayEl.id = 'dsh-desktop-drop-overlay'
  overlayEl.textContent = '拖放文件到输入框'
  overlayEl.style.cssText = [
    'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;',
    'background:color-mix(in srgb,var(--dsw-alias-bg-base,#0f1117) 70%,transparent);',
    'pointer-events:none;font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:15px;',
    'color:var(--dsw-alias-label-primary,#e6e8ee);',
  ].join('')
  document.body.appendChild(overlayEl)
}

function hideDropOverlay(): void {
  overlayEl?.remove()
  overlayEl = null
}

/**
 * Insert paths into the composer input box as text (one per line). The box
 * is React-controlled, so the write goes through the native value setter and
 * an `input` event — the composer's own onChange path feeds the draft into
 * the input machine like any typed edit.
 * @param paths - filesystem paths to insert.
 * @returns whether a live composer accepted the insertion.
 */
function insertPathsIntoComposer(paths: readonly string[]): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null || textarea.disabled) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter === undefined) return false
  const text = paths.join('\n')
  setter.call(textarea, textarea.value.length > 0 ? textarea.value + '\n' + text : text)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/**
 * Read one dropped file back through the shell's bounded byte bridge.
 * @param path - the dropped file path (allowlisted shell-side).
 * @returns a File when the shell served the bytes, null otherwise.
 */
async function droppedFile(path: string): Promise<File | null> {
  const tauri = getTauri()
  const base64 = await tauri?.core?.invoke('read_dropped_file', { path })
  if (typeof base64 !== 'string' || base64 === '') return null
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const name = path.split(/[\\/]/).pop() ?? 'drop'
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return new File([bytes], name, { type: IMAGE_MIME[ext] ?? 'application/octet-stream' })
}

/**
 * Handle one OS drop: images re-enter the composer's native image intake
 * (synthetic drop over the document, the same route a mixed drop used
 * before); every other file gets its path inserted into the input box.
 * @param paths - dropped filesystem paths.
 */
async function handleDropPaths(paths: readonly string[]): Promise<void> {
  const images: File[] = []
  const textPaths: string[] = []
  for (const path of paths) {
    if (IMAGE_RE.test(path)) {
      const file = await droppedFile(path)
      if (file !== null) images.push(file)
      else textPaths.push(path) // read refused (oversized/expired): the path still lands in the box
    } else {
      textPaths.push(path)
    }
  }
  if (textPaths.length > 0) insertPathsIntoComposer(textPaths)
  if (images.length > 0) {
    const dt = new DataTransfer()
    images.forEach(file => dt.items.add(file))
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
}

/** Dictionary namespace owned by this plugin (the bridge settings section). */
const NS = 'settings.bridge'

/**
 * Wait for the Workspace and Session baselines used by Explorer path routing.
 * @param ctx - the client context (sessions, workspaces).
 * @returns completion after both baselines are ready.
 */
function waitForWorkspaces(ctx: BridgeClientContext): Promise<void> {
  const list = ctx.workspaces.list
  if (list.getSnapshot().baselinesReady) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = list.subscribe(() => {
      if (!list.getSnapshot().baselinesReady) return
      unsubscribe()
      resolve()
    })
  })
}

function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function ownsPath(workspacePath: string, candidatePath: string): boolean {
  const workspace = pathKey(workspacePath)
  const candidate = pathKey(candidatePath)
  return candidate === workspace || candidate.startsWith(workspace + '/')
}

function openWorkspace(ctx: BridgeClientContext, workspaceId: string): void {
  const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
  if (workspace === undefined) return
  const sessions = ctx.sessions.list.getSnapshot()
  const mostRecent = workspace.sessionIds
    .filter(id => sessions.byId[id] !== undefined)
    .sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0))[0]
  if (mostRecent !== undefined) ctx.sessions.open(mostRecent)
  else ctx.workspaces.startSession(workspaceId)
}

function confirmWorkspace(path: string, t: (key: string) => string): Promise<boolean> {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = css.confirmMask as string
    const dialog = document.createElement('div')
    dialog.className = css.confirmDialog as string
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', t('workspace.addTitle'))

    const title = document.createElement('div')
    title.className = css.confirmTitle as string
    title.textContent = t('workspace.addTitle')
    const message = document.createElement('p')
    message.className = css.confirmMessage as string
    message.textContent = t('workspace.addConfirm').replace('{path}', path)
    const actions = document.createElement('div')
    actions.className = css.confirmActions as string
    const cancel = document.createElement('button')
    cancel.className = css.confirmCancel as string
    cancel.type = 'button'
    cancel.textContent = t('workspace.cancel')
    const add = document.createElement('button')
    add.className = css.confirmAdd as string
    add.type = 'button'
    add.textContent = t('workspace.add')
    actions.append(cancel, add)
    dialog.append(title, message, actions)
    mask.append(dialog)

    const finish = (accepted: boolean): void => {
      document.removeEventListener('keydown', onKeyDown, true)
      mask.remove()
      resolve(accepted)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
    cancel.addEventListener('click', () => finish(false), { once: true })
    add.addEventListener('click', () => finish(true), { once: true })
    mask.addEventListener('click', (event) => {
      if (event.target === mask) finish(false)
    })
    document.addEventListener('keydown', onKeyDown, true)
    document.body.append(mask)
    add.focus()
  })
}

async function openExplorerPath(ctx: BridgeClientContext, path: string, t: (key: string) => string): Promise<void> {
  await waitForWorkspaces(ctx)
  const owner = [...ctx.workspaces.list.getSnapshot().items]
    .filter(workspace => ownsPath(workspace.path, path))
    .sort((left, right) => pathKey(right.path).length - pathKey(left.path).length)[0]
  if (owner !== undefined) {
    openWorkspace(ctx, owner.workspaceId)
    return
  }
  if (!await confirmWorkspace(path, t)) return
  try {
    const workspace = await ctx.workspaces.create({ path })
    ctx.workspaces.startSession(workspace.workspaceId)
  } catch (error) {
    window.alert(t('workspace.addFailed') + String(error))
  }
}

/**
 * Bind the shell drag-drop listener, the settings registrations, and the
 * workspace jump.
 * @param ctx - the client context (sessions, workspaces, slots).
 * @returns the disposer removing the listeners.
 */
export function apply(ctx: BridgeClientContext): () => void {
  if (bound) return () => {}
  bound = true
  const offLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'bridge',
    order: 100,
    label: () => t('section.nav'),
    locale: NS,
    children: { 'settings.bridge.item': { kind: 'list', scope: 'root' }, 'settings.bridge.item2': { kind: 'list', scope: 'root' } },
  }, BridgeSection))
  ctx.slots.inject('settings.bridge.item', () => ctx.slots.register({
    name: 'settings.bridge.item',
    id: 'bridge-close',
    order: 0,
    locale: NS,
    // The row fetches the bridge host route directly for its persisted value
    // (the dsh configuration boundary refuses browser writes to non-listed
    // settings namespaces, so saves must go through the host); the inject
    // face carries the shell mirror applied after a successful save.
    inject: () => ({ onCloseToTray: applyCloseToTray }),
  }, BridgeCloseRow))
  ctx.slots.inject('settings.bridge.item2', () => ctx.slots.register({
    name: 'settings.bridge.item2',
    id: 'bridge-debug',
    order: 0,
    locale: NS,
    // inject must be a factory: the renderer calls it per entry.
    inject: () => ({ onDebugMode: applyDebugMode }),
  }, BridgeDebugRow))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'desktop-workspace-workbench',
    order: -100,
    locale: NS,
  }, DesktopWorkspaceWorkbench))
  // Shell wiring at bind: read the stored desktop settings and mirror them
  // into the shell (close-to-tray interception, WebView2 devtools).
  void fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
    if (typeof c.closeToTray === 'boolean') applyCloseToTray(c.closeToTray)
    if (typeof c.debugMode === 'boolean') applyDebugMode(c.debugMode)
  }).catch(() => { /* keep the defaults (real exit, debug off) */ })
  // OS drops: the shell intercepts them (real paths) and hands them here.
  let disposed = false
  let retryDragDrop: ReturnType<typeof setTimeout> | undefined
  let offDragDrop: (() => void) | undefined
  const bindDragDrop = (): void => {
    if (disposed) return
    const webview = getTauri()?.webview?.getCurrentWebview()
    if (webview === undefined) {
      if (hasTauriInternals()) retryDragDrop = setTimeout(bindDragDrop, 100)
      return
    }
    void webview.onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'enter' || payload.type === 'over') {
        showDropOverlay()
      } else if (payload.type === 'leave') {
        hideDropOverlay()
      } else if (payload.type === 'drop') {
        hideDropOverlay()
        if (payload.paths !== undefined && payload.paths.length > 0) {
          void handleDropPaths(payload.paths)
        }
      }
    }).then((off) => {
      if (disposed) off()
      else offDragDrop = off
    }).catch(() => {
      if (!disposed) retryDragDrop = setTimeout(bindDragDrop, 100)
    })
  }
  bindDragDrop()
  let openPathWork = Promise.resolve()
  const drainOpenPaths = (): void => {
    openPathWork = openPathWork.then(async () => {
      const paths = await getTauri()?.core?.invoke('take_open_paths')
      if (!Array.isArray(paths)) return
      for (const path of paths) {
        if (typeof path === 'string') await openExplorerPath(ctx, path, t)
      }
    }).catch(() => { /* shell unavailable or one request failed: keep the page usable */ })
  }
  let offOpenPath: (() => void) | undefined
  let retryOpenPath: ReturnType<typeof setTimeout> | undefined
  const bindOpenPath = (): void => {
    if (disposed) return
    const events = getTauri()?.event
    if (events === undefined) {
      if (hasTauriInternals()) retryOpenPath = setTimeout(bindOpenPath, 100)
      return
    }
    void events.listen('dsh://open-path', drainOpenPaths).then((off) => {
      if (disposed) off()
      else {
        offOpenPath = off
        drainOpenPaths()
      }
    }).catch(() => {
      if (!disposed) retryOpenPath = setTimeout(bindOpenPath, 100)
    })
  }
  bindOpenPath()
  // Debug guard: read the stored mode and enforce it for this page session.
  document.addEventListener('contextmenu', onContextMenuCapture, true)
  document.addEventListener('keydown', onKeyDownCapture, true)
  return () => {
    disposed = true
    if (retryDragDrop !== undefined) clearTimeout(retryDragDrop)
    if (retryOpenPath !== undefined) clearTimeout(retryOpenPath)
    offDragDrop?.()
    offOpenPath?.()
    offLocale()
    hideDropOverlay()
    document.removeEventListener('contextmenu', onContextMenuCapture, true)
    document.removeEventListener('keydown', onKeyDownCapture, true)
  }
}
