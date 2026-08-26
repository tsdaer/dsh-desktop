import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

/** A minimal tools registry that records registrations. */
function fakeTools() {
  const registered: unknown[] = []
  return {
    registered,
    register: (tool: unknown) => { registered.push(tool) },
  }
}

function fakeCtx() {
  const tools = fakeTools()
  const ctx = new Context()
  ctx.provide('tools', tools as never)
  ctx.provide('systemPrompt', { section: vi.fn() } as never)
  ctx.provide('shellEnv', { collect: vi.fn(() => ({})) } as never)
  return { ctx, tools }
}

describe('wsl bash tool registration', () => {
  it('registers the bash tool when enabled', () => {
    const { ctx, tools } = fakeCtx()
    apply(ctx, { distribution: 'docker-desktop', enabled: true })
    expect(tools.registered).toHaveLength(1)
    const tool = tools.registered[0] as { name?: string }
    expect(tool.name).toBe('bash')
  })

  it('does not register the bash tool when disabled', () => {
    const { ctx, tools } = fakeCtx()
    apply(ctx, { distribution: 'docker-desktop', enabled: false })
    expect(tools.registered).toHaveLength(0)
  })

  it('rejects an empty distribution when enabled', () => {
    const { ctx } = fakeCtx()
    expect(() => apply(ctx, { distribution: '', enabled: true })).toThrow(/non-empty/)
  })
})
