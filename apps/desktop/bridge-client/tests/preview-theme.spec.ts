import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPreviewThemeRelay, projectThemeSnapshot } from '../src/client/DesktopPreviewTheme.ts'

function snapshot(colorScheme: 'light' | 'dark', fontSize = 14, tokens: Record<string, string> = {}) {
  return { preference: colorScheme, fontSize, active: { id: colorScheme, colorScheme, tokens }, themes: [], revision: 1 }
}

describe('projectThemeSnapshot', () => {
  it('projects a resolved theme snapshot', () => {
    expect(projectThemeSnapshot(snapshot('dark', 16, { '--dsw-alias-bg-base': '#0f1115' }))).toEqual({
      colorScheme: 'dark',
      fontSize: 16,
      tokens: { '--dsw-alias-bg-base': '#0f1115' },
    })
  })

  it('refuses malformed payloads', () => {
    expect(projectThemeSnapshot(null)).toBeNull()
    expect(projectThemeSnapshot({})).toBeNull()
    expect(projectThemeSnapshot(snapshot('sepia' as 'dark'))).toBeNull()
    expect(projectThemeSnapshot({ ...snapshot('dark'), fontSize: 14.5 })).toBeNull()
    expect(projectThemeSnapshot({ ...snapshot('dark'), active: { colorScheme: 'dark', tokens: [] } })).toBeNull()
  })
})

describe('mountPreviewThemeRelay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pushes the current snapshot on mount and forwards every change', () => {
    const invoke = vi.fn(async () => undefined)
    const listeners = new Set<(value: unknown) => void>()
    const theme = {
      getTheme: () => snapshot('dark'),
    }
    const events = {
      on: (_event: string, listener: (value: unknown) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const dispose = mountPreviewThemeRelay(theme, events, invoke)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenLastCalledWith('set_preview_theme', {
      snapshot: { colorScheme: 'dark', fontSize: 14, tokens: {} },
    })
    for (const listener of listeners) listener(snapshot('light'))
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenLastCalledWith('set_preview_theme', {
      snapshot: { colorScheme: 'light', fontSize: 14, tokens: {} },
    })
    dispose()
    expect(listeners.size).toBe(0)
  })

  it('skips malformed snapshots and tolerates a missing shell command', () => {
    const invoke = vi.fn(async () => { throw new Error('shell unavailable') })
    const listeners = new Set<(value: unknown) => void>()
    const theme = {
      getTheme: () => snapshot('dark'),
    }
    const events = {
      on: (_event: string, listener: (value: unknown) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    mountPreviewThemeRelay(theme, events, invoke)
    expect(invoke).toHaveBeenCalledTimes(1)
    for (const listener of listeners) listener(null)
    expect(invoke).toHaveBeenCalledTimes(1)
    const noShell = mountPreviewThemeRelay(theme, events, undefined)
    expect(noShell).toBeTypeOf('function')
    noShell()
  })
})
