import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceFilePreview } from '../src/client/DesktopWorkspacePreviewWindow.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop preview window controller', () => {
  it('rejects invalid paths before invoking Tauri', async () => {
    const invoke = vi.fn()
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } })
    expect(await openWorkspaceFilePreview('workspace-1', '../outside.txt')).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('passes the normalized path and current locale to the native opener', async () => {
    const invoke = vi.fn(async () => undefined)
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } })
    vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } })
    expect(await openWorkspaceFilePreview('workspace-1', 'apps/./desktop/README.md')).toBe(true)
    expect(invoke).toHaveBeenCalledWith('open_file_preview', {
      workspaceId: 'workspace-1', path: 'apps/desktop/README.md', locale: 'zh-CN',
    })
  })

  it('falls back when Tauri is unavailable or the native command fails', async () => {
    vi.stubGlobal('window', {})
    expect(await openWorkspaceFilePreview('workspace-1', 'README.md')).toBe(false)
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: vi.fn(async () => { throw new Error('closed') }) } } })
    expect(await openWorkspaceFilePreview('workspace-1', 'README.md')).toBe(false)
  })
})
