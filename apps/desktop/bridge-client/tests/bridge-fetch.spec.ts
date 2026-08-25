// @vitest-environment jsdom
// Bridge fetch: the loopback token is picked up from the page URL once and
// attached to every bridge request; without a token the plain fetch passes through.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bridge fetch token', () => {
  beforeEach(() => {
    // Fresh module state per test: the token cache is module-level.
    vi.resetModules()
  })

  it('attaches the bearer token from the page URL to every request', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=abc123' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../src/client/bridge-fetch.ts')
    await mod.bridgeFetch('/dsh-bridge/config')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init!.headers)
    expect(headers.get('authorization')).toBe('Bearer abc123')
  })

  it('merges the token into existing request headers', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=xyz' })
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../src/client/bridge-fetch.ts')
    await mod.bridgeFetch('/dsh-bridge/policy', { headers: { 'content-type': 'application/json' } })
    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init!.headers)
    expect(headers.get('authorization')).toBe('Bearer xyz')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('passes through unchanged when the URL carries no token', async () => {
    vi.stubGlobal('location', { search: '' })
    vi.stubGlobal('__DSH_LOOPBACK_TOKEN__', undefined)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../src/client/bridge-fetch.ts')
    await mod.bridgeFetch('/dsh-bridge/config')
    const [input, init] = fetchMock.mock.calls[0]!
    expect(init).toBeUndefined()
    expect(input).toBe('/dsh-bridge/config')
  })

  it('uses the token captured by the native initialization script', async () => {
    vi.stubGlobal('location', { search: '' })
    vi.stubGlobal('__DSH_LOOPBACK_TOKEN__', 'early-token')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../src/client/bridge-fetch.ts')
    await mod.bridgeFetch('/dsh-bridge/config')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer early-token')
  })

  it('caches the token after the first read', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=cached' })
    const mod = await import('../src/client/bridge-fetch.ts')
    expect(mod.bridgeToken()).toBe('cached')
    vi.stubGlobal('location', { search: '?dsh_token=other' })
    expect(mod.bridgeToken()).toBe('cached')
  })

  it('reports empty HTTP failures without attempting to parse JSON', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=secret' })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 401 })))
    const mod = await import('../src/client/bridge-fetch.ts')
    await expect(mod.bridgeJson('/dsh-bridge/config')).rejects.toThrow('HTTP 401')
  })

  it('validates config reads and policy saves', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=secret' })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ closeToTray: true, debugMode: false, logoMotion: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../src/client/bridge-fetch.ts')
    await expect(mod.readBridgeConfig()).resolves.toEqual({ closeToTray: true, debugMode: false, logoMotion: true })
    await expect(mod.saveBridgePolicy({ debugMode: true })).resolves.toBeUndefined()
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ debugMode: true })
  })
})
