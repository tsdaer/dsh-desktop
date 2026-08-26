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

function fakeCtx(settingsSection?: { wslEnabled?: unknown; wslDistribution?: unknown }) {
  const tools = fakeTools()
  const ctx = new Context()
  ctx.provide('tools', tools as never)
  ctx.provide('systemPrompt', { section: vi.fn() } as never)
  ctx.provide('shellEnv', { collect: vi.fn(() => ({})) } as never)
  // The executor's installSettingsSection always touches settings, so provide
  // a complete fake; `get` returns the section (or undefined).
  ctx.provide('settings', {
    get: () => settingsSection,
    register: vi.fn(() => ({ get: () => settingsSection, watch: vi.fn() })),
  } as never)
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

  it('enables the tool through the live desktop setting even when the entry is disabled', () => {
    const { ctx, tools } = fakeCtx({ wslEnabled: true, wslDistribution: 'ubuntu' })
    apply(ctx, { distribution: 'docker-desktop', enabled: false })
    expect(tools.registered).toHaveLength(1)
    const tool = tools.registered[0] as { name?: string }
    expect(tool.name).toBe('bash')
  })

  it('keeps the tool off when the live desktop setting disables it', () => {
    const { ctx, tools } = fakeCtx({ wslEnabled: false, wslDistribution: '' })
    apply(ctx, { distribution: 'docker-desktop', enabled: true })
    expect(tools.registered).toHaveLength(0)
  })

  it('rejects an empty distribution when enabled', () => {
    const { ctx } = fakeCtx()
    expect(() => apply(ctx, { distribution: '', enabled: true })).toThrow(/non-empty/)
  })
})
