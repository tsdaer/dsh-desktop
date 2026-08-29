// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installExternalLinkPolicy, openExternalUrl, safeExternalUrl } from '../src/client/DesktopExternalLinks.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('desktop external link policy', () => {
  it('accepts only credential-free absolute HTTP(S) links outside the bridge origin', () => {
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:3000/', origin: 'http://127.0.0.1:3000' } })
    expect(safeExternalUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(safeExternalUrl('/dsh-bridge/config')).toBeNull()
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('file:///tmp/a')).toBeNull()
    expect(safeExternalUrl('https://user:pass@example.com/')).toBeNull()
    expect(safeExternalUrl('http://localhost:3001/')).toBeNull()
    expect(safeExternalUrl('http://127.0.0.1:3001/')).toBeNull()
  })

  it('opens through the native command once when Tauri is present', async () => {
    const invoke = vi.fn(async () => undefined)
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:3000/', origin: 'http://127.0.0.1:3000' }, __TAURI__: { core: { invoke } } })
    expect(await openExternalUrl('https://example.com')).toBe(true)
    expect(invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://example.com/' })
  })

  it('prevents unsafe links and delegates a safe primary click once', async () => {
    const opener = vi.fn(() => ({}))
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:3000/', origin: 'http://127.0.0.1:3000' }, open: opener })
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/docs'
    document.body.append(anchor)
    const dispose = installExternalLinkPolicy()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    anchor.dispatchEvent(event)
    await Promise.resolve()
    expect(event.defaultPrevented).toBe(true)
    expect(opener).toHaveBeenCalledTimes(1)

    const unsafe = document.createElement('a')
    unsafe.href = 'javascript:alert(1)'
    document.body.append(unsafe)
    const unsafeEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    unsafe.dispatchEvent(unsafeEvent)
    expect(unsafeEvent.defaultPrevented).toBe(true)
    expect(opener).toHaveBeenCalledTimes(1)
    dispose()
    anchor.remove()
    unsafe.remove()
  })
})
