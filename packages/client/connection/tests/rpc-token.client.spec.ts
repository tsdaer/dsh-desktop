/** Generic browser RPC carries the desktop loopback token like the API client. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals() })

describe('generic RPC loopback token', () => {
  it('attaches the captured token to Remote calls', async () => {
    vi.stubGlobal('location', { search: '?dsh_token=rpc-secret', origin: 'http://127.0.0.1:3080' })
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
      const request = JSON.parse(init.body) as { rpcId: string }
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { entries: [] } } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { createWebConnectionRpc } = await import('../src/client/rpc.ts')
    await createWebConnectionRpc().call('/api', 'pluginInventory/list', {})
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer rpc-secret')
  })

  it('does not add authorization outside the desktop token posture', async () => {
    vi.stubGlobal('location', { search: '', origin: 'http://localhost:3080' })
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
      const request = JSON.parse(init.body) as { rpcId: string }
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: null } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { createWebConnectionRpc } = await import('../src/client/rpc.ts')
    await createWebConnectionRpc().call('/api', 'fixture/read', {})
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false)
  })
})
