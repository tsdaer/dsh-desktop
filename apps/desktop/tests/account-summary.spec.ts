import { describe, expect, it, vi } from 'vitest'
import { resolveAccountSummary, resolveAuthoritativeProvider } from '../bridge/src/account-summary.ts'

/** A fake runtime context with the services account-summary reads. */
function fakeCtx(options: {
  agent?: { requestProvider?: string | undefined } | undefined
  defaultProvider?: string | undefined
  llm?: { accountSummary: (provider: string) => Promise<{ provider: string; state: 'available' | 'unsupported' | 'unconfigured' | 'unavailable'; amount?: string; currency?: string }> } | undefined
}) {
  const agents = options.agent === undefined ? undefined : {
    get: (_id: string) => options.agent === undefined ? undefined : ({
      session: {
        requestHeader: () => options.agent?.requestProvider === undefined
          ? undefined
          : ({ config: { provider: options.agent.requestProvider } }),
      },
    }),
  }
  const defaults = options.defaultProvider === undefined ? undefined : {
    currentSelection: () => ({ provider: options.defaultProvider, model: 'm' }),
  }
  const llm = options.llm
  return { get: (name: string) => {
    if (name === 'agents') return agents
    if (name === 'agentDefaultModel') return defaults
    if (name === 'llm') return llm
    return undefined
  } }
}

describe('desktop account-summary resolution', () => {
  it('resolves the session request-header provider as authoritative', () => {
    const ctx = fakeCtx({ agent: { requestProvider: 'deepseek-official' }, defaultProvider: 'other' })
    expect(resolveAuthoritativeProvider(ctx as never, 's1' as never)).toBe('deepseek-official')
  })

  it('falls back to the default model selection for a blank session', () => {
    const ctx = fakeCtx({ agent: {}, defaultProvider: 'deepseek-official' })
    expect(resolveAuthoritativeProvider(ctx as never, 's1' as never)).toBe('deepseek-official')
  })

  it('reports the authoritative provider over a browser-supplied one', async () => {
    const accountSummary = vi.fn(async (provider: string) => ({ provider, state: 'available' as const, amount: '9.99', currency: 'USD' }))
    const ctx = fakeCtx({ agent: { requestProvider: 'deepseek-official' }, llm: { accountSummary } })
    const body = await resolveAccountSummary(ctx as never, 's1' as never, 'browser-claimed-provider', 'g7')
    expect(body.providerId).toBe('deepseek-official')
    expect(accountSummary).toHaveBeenCalledWith('deepseek-official')
    expect(body).toMatchObject({ sessionId: 's1', generation: 'g7', state: 'available', amount: '9.99', currency: 'USD', ok: true })
  })

  it('keeps an unsupported provider state without an amount', async () => {
    const ctx = fakeCtx({ agent: { requestProvider: 'pi-ai' }, llm: { accountSummary: async (provider: string) => ({ provider, state: 'unsupported' as const }) } })
    const body = await resolveAccountSummary(ctx as never, 's1' as never, 'pi-ai', 'g1')
    expect(body).toMatchObject({ providerId: 'pi-ai', state: 'unsupported', ok: false })
    expect(body.amount).toBeUndefined()
  })

  it('normalizes a failed provider query to unavailable with a reason', async () => {
    const ctx = fakeCtx({
      agent: { requestProvider: 'deepseek-official' },
      llm: { accountSummary: async () => { throw new Error('boom') } },
    })
    const body = await resolveAccountSummary(ctx as never, 's1' as never, 'deepseek-official', 'g2')
    expect(body).toMatchObject({ providerId: 'deepseek-official', state: 'unavailable', ok: false, reason: 'boom' })
  })

  it('answers unavailable without an llm service', async () => {
    const ctx = fakeCtx({ agent: { requestProvider: 'deepseek-official' }, llm: undefined })
    const body = await resolveAccountSummary(ctx as never, 's1' as never, 'deepseek-official', 'g3')
    expect(body).toMatchObject({ state: 'unavailable', ok: false, reason: 'no-llm' })
  })
})
