import { BridgeDebugRow } from './BridgeDebugRow.tsx'
import { BridgePolicyRow } from './BridgePolicyRow.tsx'
import { BridgeSection } from './BridgeSection.tsx'

// @deepseek-ai/dsh-desktop-bridge-client — browser half of the shell
// bridge: picks non-image files out of native drops and forwards them to
// the bridge host route (WebView2 exposes no File.path, so bytes travel
// instead; oversized files travel as metadata only). Images are left
// untouched for the dsh composer's own intake pipeline. The host decides
// copy vs. path per the bridge policy (copy switch, size cap, binary
// sniff), so the client mirrors only the size cap to keep the request
// body bounded. Also hosts the debug-mode guard: while debug mode is off
// (default), right-click and devtools shortcuts are suppressed; the host
// additionally flips WebView2's AreDevToolsEnabled via the
// set_debug_mode command (the browser-level F12 escape hatch a page
// cannot intercept).

/** Stable Cordis plugin name. */
export const name = 'desktop-bridge-client'

/** Services required before the listener and settings row can run. */
export const inject = ['sessions', 'slots']

/** Minimal view of the client-runtime sessions service this plugin consumes. */
interface SessionsLike {
  list: {
    getSnapshot(): { current: string | undefined }
  }
}

/** Minimal view of the slots service this plugin consumes. */
interface SlotsLike {
  inject(name: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** Minimal view of the cordis context this plugin consumes. */
interface BridgeClientContext {
  sessions: SessionsLike
  slots: SlotsLike
}

/** Minimal view of the injected Tauri APIs (withGlobalTauri). */
interface TauriEventApi {
  listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>
}

interface TauriLike {
  event?: TauriEventApi
  core?: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
  }
}

const tauri = (window as unknown as { __TAURI__?: TauriLike }).__TAURI__

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i

// Module-level binding guard: however many times the plugin fiber applies,
// only the first bind owns the document listener and settings registrations
// (duplicate binds would POST every drop once per bind).
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
  if (tauri?.core) {
    void tauri.core.invoke('set_debug_mode', { enabled }).catch(() => {
      /* shell command unavailable (plain browser dev): page guard still applies */
    })
  }
}

// Mirror of the host bridge policy; refreshed per drop (fallback: 50 MiB).
let maxBytes = 50 * 1024 * 1024

/** Refresh the size-cap mirror from the bridge host; keeps the last value on failure. */
function refreshPolicy(): Promise<number> {
  return fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
    if (typeof c.maxBytes === 'number') maxBytes = c.maxBytes
    return maxBytes
  }).catch(() => maxBytes)
}

/** Read a File's bytes as a bare base64 string (data URL prefix stripped). */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Bind the drop listener and settings registrations.
 * @param ctx - the client context (sessions, slots).
 * @returns the disposer removing the listeners.
 */
export function apply(ctx: BridgeClientContext): () => void {
  if (bound) return () => {}
  bound = true
  void refreshPolicy()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'bridge',
    order: 100,
    label: () => '桌面设置',
    children: { 'settings.bridge.item': { kind: 'list', scope: 'root' }, 'settings.bridge.item2': { kind: 'list', scope: 'root' } },
  }, BridgeSection))
  ctx.slots.inject('settings.bridge.item', () => ctx.slots.register({
    name: 'settings.bridge.item',
    id: 'bridge-policy',
    order: 0,
    // No inject face: the row fetches the bridge host route directly (the
    // dsh configuration boundary refuses browser writes to non-listed
    // settings namespaces, so saves must go through the host).
  }, BridgePolicyRow))
  ctx.slots.inject('settings.bridge.item2', () => ctx.slots.register({
    name: 'settings.bridge.item2',
    id: 'bridge-debug',
    order: 0,
    // inject must be a factory: the renderer calls it per entry.
    inject: () => ({ onDebugMode: applyDebugMode }),
  }, BridgeDebugRow))
  // Debug guard: read the stored mode and enforce it for this page session.
  void fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
    if (typeof c.debugMode === 'boolean') applyDebugMode(c.debugMode)
  }).catch(() => { /* keep the default (off) */ })
  document.addEventListener('contextmenu', onContextMenuCapture, true)
  document.addEventListener('keydown', onKeyDownCapture, true)
  // Capture-phase listener: non-image drops are taken over before the dsh
  // composer's bubble listeners can see them (its intake would toast a
  // format rejection). Pure-image drops pass through untouched; images in a
  // mixed drop are re-dispatched to the composer as a synthetic drop.
  const onDropCapture = (event: DragEvent): void => {
    const files = [...(event.dataTransfer?.files ?? [])]
    const nonImages = files.filter(file => !IMAGE_RE.test(file.name))
    if (nonImages.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    // The composer's drop listener owns the drag-depth reset that hides its
    // drop overlay; it never sees this drop (stopped above), so synthesize
    // a file-carrying dragleave to bring its depth back to zero.
    const leaveDt = new DataTransfer()
    nonImages.forEach(file => leaveDt.items.add(file))
    document.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: false, dataTransfer: leaveDt }))
    void (async () => {
      await refreshPolicy()
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) return
      // Oversized files travel as metadata only: the host announces them as
      // path references without us uploading their bytes.
      const payload = await Promise.all(nonImages.map(async (file) => {
        if (file.size > maxBytes) return { name: file.name, size: file.size }
        return { name: file.name, size: file.size, base64: await readAsBase64(file) }
      }))
      void fetch('/dsh-bridge/drop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, files: payload }),
      }).catch(() => { /* bridge unavailable: the drop is simply not taken */ })
    })()
    const images = files.filter(file => IMAGE_RE.test(file.name))
    if (images.length > 0) {
      const dt = new DataTransfer()
      images.forEach(file => dt.items.add(file))
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    }
  }
  document.addEventListener('drop', onDropCapture, true)
  return () => {
    document.removeEventListener('contextmenu', onContextMenuCapture, true)
    document.removeEventListener('keydown', onKeyDownCapture, true)
    document.removeEventListener('drop', onDropCapture, true)
  }
}
