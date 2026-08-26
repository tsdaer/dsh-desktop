// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountAccountController } from '../bridge-client/src/client/DesktopAccountSummary.ts'

const ACCOUNT_EVENT = 'dsh://account-summary'
const ACCOUNT_REFRESH_REQUEST = 'dsh://account-summary-refresh'

function controllerDeps(options: {
  current?: string | undefined
  provider?: string | undefined
  respond?: (url: string) => Promise<unknown>
} = {}) {
  let current = options.current
  const listeners = new Set<() => void>()
  const sessions = {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
  return {
    sessions,
    setCurrent(next: string | undefined) {
      current = next
      for (const listener of [...listeners]) listener()
    },
    deps: {
      sessions,
      model: { getCurrentProvider: () => options.provider ?? undefined } as never,
      fetch: vi.fn((url: string) => {
        const response = options.respond === undefined
          ? { state: 'available', amount: '1.00', currency: 'USD', providerId: 'deepseek-official', ok: true }
          : options.respond(url)
        return Promise.resolve({ json: () => Promise.resolve(response) } as Response)
      }),
      signal: () => new AbortController().signal,
    } as never,
  }
}

function lastAccountEvent(): unknown {
  return (window as unknown as { __lastAccountEvent?: unknown }).__lastAccountEvent
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.addEventListener(ACCOUNT_EVENT, (event) => {
    (window as unknown as { __lastAccountEvent?: unknown }).__lastAccountEvent = (event as CustomEvent).detail
  })
})

describe('desktop account controller', () => {
  it('requests the account summary for the current session on mount', () => {
    const harness = controllerDeps({ current: 's1', provider: 'deepseek-official' })
    const dispose = mountAccountController(harness.deps)
    const url = vi.mocked(harness.deps.fetch).mock.calls[0]?.[0] as string
    expect(url).toContain('/dsh-bridge/account-summary')
    expect(url).toContain('sessionId=s1')
    expect(url).toContain('providerId=deepseek-official')
    expect(url).toContain('generation=1')
    dispose()
  })

  it('reports unavailable without an active session', () => {
    const harness = controllerDeps({ current: undefined })
    const dispose = mountAccountController(harness.deps)
    expect(harness.deps.fetch).not.toHaveBeenCalled()
    const payload = lastAccountEvent() as { state: string }
    expect(payload.state).toBe('unavailable')
    dispose()
  })

  it('refreshes when the active session changes and invalidates older replies', async () => {
    let resolveFirst: (value: unknown) => void
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve })
    const harness = controllerDeps({ current: 's1', provider: 'deepseek-official' })
    harness.deps.fetch = vi.fn((url: string) => {
      return url.includes('sessionId=s1')
        ? Promise.resolve({ json: () => first } as Response)
        : Promise.resolve({ json: () => Promise.resolve({ state: 'available', amount: '2.00', currency: 'USD', providerId: 'deepseek-official', ok: true, sessionId: 's2', generation: '2' }) } as Response)
    })
    const dispose = mountAccountController(harness.deps)
    harness.setCurrent('s2')
    // The s1 reply resolves after the session switched; it must be dropped.
    resolveFirst!({ state: 'available', amount: '9.99', currency: 'USD', providerId: 'deepseek-official', ok: true, sessionId: 's1', generation: '1' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const payload = lastAccountEvent() as { amount?: string; sessionId: string }
    expect(payload.amount).toBe('2.00')
    expect(payload.sessionId).toBe('s2')
    dispose()
  })

  it('refreshes on the title-bar click signal', () => {
    const harness = controllerDeps({ current: 's1', provider: 'deepseek-official' })
    const dispose = mountAccountController(harness.deps)
    const callsBefore = vi.mocked(harness.deps.fetch).mock.calls.length
    window.dispatchEvent(new CustomEvent(ACCOUNT_REFRESH_REQUEST))
    expect(vi.mocked(harness.deps.fetch).mock.calls.length).toBeGreaterThan(callsBefore)
    dispose()
  })

  it('publishes unavailable when the request fails', async () => {
    const harness = controllerDeps({
      current: 's1',
      provider: 'deepseek-official',
      respond: () => Promise.reject(new Error('network down')),
    })
    const dispose = mountAccountController(harness.deps)
    await new Promise(resolve => setTimeout(resolve, 0))
    const payload = lastAccountEvent() as { state: string; reason?: string }
    expect(payload.state).toBe('unavailable')
    dispose()
  })

  it('disposes every listener and cancels in-flight requests', () => {
    const harness = controllerDeps({ current: 's1', provider: 'deepseek-official' })
    const dispose = mountAccountController(harness.deps)
    const before = vi.mocked(harness.deps.fetch).mock.calls.length
    dispose()
    harness.setCurrent('s2')
    window.dispatchEvent(new CustomEvent(ACCOUNT_REFRESH_REQUEST))
    expect(vi.mocked(harness.deps.fetch).mock.calls.length).toBe(before)
  })
})
