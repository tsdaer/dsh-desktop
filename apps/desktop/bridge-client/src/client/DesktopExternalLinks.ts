interface TauriLike {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  }
}

function getTauri(): TauriLike | undefined {
  return (window as unknown as { __TAURI__?: TauriLike }).__TAURI__
}

/** Validate one external link without allowing credentials or bridge URLs.
 * @param value - Untrusted anchor destination.
 * @returns Absolute HTTP(S) URL safe to hand to the native opener, or null.
 */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
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

/** Open one validated URL through the native opener or a browser tab.
 * @param value - Untrusted anchor destination.
 * @returns true when an opener accepted the URL.
 */
export async function openExternalUrl(value: unknown): Promise<boolean> {
  const url = safeExternalUrl(value)
  if (url === null) return false
  const tauri = getTauri()
  if (tauri?.core !== undefined) {
    try {
      await tauri.core.invoke('open_external_url', { url })
      return true
    } catch {
      return false
    }
  }
  return window.open(url, '_blank', 'noopener,noreferrer') !== null
}

/** Install one click policy for all safe and unsafe document anchors.
 * @returns A disposer for the document listener.
 */
export function installExternalLinkPolicy(): () => void {
  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (target === null) return
    const url = safeExternalUrl(target.getAttribute('href'))
    if (url === null) {
      event.preventDefault()
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    void openExternalUrl(url)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
