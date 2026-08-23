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
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('../src/client/bridge-fetch.ts')
    await mod.bridgeFetch('/dsh-bridge/config')
    const [input, init] = fetchMock.mock.calls[0]!
    expect(init).toBeUndefined()
    expect(input).toBe('/dsh-bridge/config')
  })

  it('caches the token after the first read', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=cached' })
    const mod = await import('../src/client/bridge-fetch.ts')
    expect(mod.bridgeToken()).toBe('cached')
    vi.stubGlobal('location', { search: '?dsh_token=other' })
    expect(mod.bridgeToken()).toBe('cached')
  })
})
