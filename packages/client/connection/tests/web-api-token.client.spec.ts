/**
 * WebApiClient loopback token: the page URL query token attaches to every
 * fetch as Authorization and to every WebSocket as a query parameter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalWebSocket = globalThis.WebSocket
const sockets: { url: string; readyState: number }[] = []

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readyState = FakeWebSocket.CONNECTING

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    sockets.push(this)
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return
      this.readyState = FakeWebSocket.OPEN
      this.dispatchEvent(new Event('open'))
    })
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.WebSocket = originalWebSocket
  sockets.length = 0
})

function page(search: string): void {
  vi.stubGlobal('location', { hostname: '127.0.0.1', search, origin: 'http://127.0.0.1:3080' })
}

describe('WebApiClient loopback token', () => {
  it('attaches the token as a Bearer header on fetch', async () => {
    page('?dsh_token=token-1')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ rpcId: 'x', result: { ok: true, value: {} } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { WebApiClient } = await import('../src/client/web-api-client.ts')
    const client = new WebApiClient()
    await client.sessions.list({ limit: 1 }).catch(() => { /* parse may fail; the header assertion below matters */ })
    expect(fetchMock).toHaveBeenCalled()
    const [, init] = fetchMock.mock.calls[0] ?? [undefined, undefined]
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer token-1')
  })

  it('leaves fetch headers alone without a token', async () => {
    page('')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ rpcId: 'x', result: { ok: true, value: {} } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { WebApiClient } = await import('../src/client/web-api-client.ts')
    const client = new WebApiClient()
    await client.sessions.list({ limit: 1 }).catch(() => {})
    const [, init] = fetchMock.mock.calls[0] ?? [undefined, undefined]
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  })

  it('appends the token as a query parameter on WebSocket streams', async () => {
    page('?dsh_token=ws-token')
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const { WebApiClient } = await import('../src/client/web-api-client.ts')
    const client = new WebApiClient()
    const iterator = client.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]()
    // Start iteration so the WebSocket opens.
    void iterator.next()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sockets.length).toBeGreaterThan(0)
    expect(sockets[0]?.url).toContain('dsh_token=ws-token')
  })
})
