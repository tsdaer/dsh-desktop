import { describe, expect, it, vi } from 'vitest'
import {
  ExplorerRequestError,
  listExplorerDirectory,
  parseExplorerRelativePath,
  parseExplorerWorkspaceId,
} from '../bridge/src/explorer.ts'

const workspaceId = 'workspace-1' as never

function fakeHost(entries: readonly { name: string; type: 'directory' | 'file'; outside?: boolean }[]) {
  const targets = new Map<string, { targetKey: string; displayPath: string }>()
  const fs = {
    resolve: vi.fn(async (path: string) => {
      const target = { targetKey: path, displayPath: path }
      targets.set(path, target)
      return target
    }),
    stat: vi.fn(async () => ({ type: 'directory', version: 'v' as never })),
    contains: vi.fn((root: { targetKey: string }, child: { targetKey: string }) => !child.targetKey.includes('outside')),
    listDir: vi.fn(async () => entries.map(entry => ({
      name: entry.name,
      type: entry.type,
      target: { targetKey: entry.outside === true ? `/outside/${entry.name}` : `/workspace/${entry.name}`, displayPath: entry.name },
      ...(entry.type === 'file' ? { size: 4 } : {}),
    }))),
  }
  return {
    fs: fs as never,
    workspaceRegistry: { get: vi.fn(() => ({ path: '/workspace' })) } as never,
    targets,
  }
}

describe('desktop Explorer request vocabulary', () => {
  it('rejects absolute and escaping paths while normalizing safe segments', () => {
    expect(parseExplorerRelativePath('src/./ui/../index.ts')).toBe('src/index.ts')
    expect(() => { parseExplorerRelativePath('/etc') }).toThrow(ExplorerRequestError)
    expect(() => { parseExplorerRelativePath('../outside') }).toThrow(/escapes/)
    expect(() => { parseExplorerRelativePath('src\\outside') }).toThrow(/relative/)
    expect(() => { parseExplorerWorkspaceId(null) }).toThrow(/workspaceId/)
  })

  it('sorts directories first, bounds entries, and marks outside targets', async () => {
    const host = fakeHost([
      { name: 'z.txt', type: 'file' },
      { name: 'src', type: 'directory' },
      { name: 'linked', type: 'directory', outside: true },
    ])
    const listing = await listExplorerDirectory(host, workspaceId, '', new AbortController().signal, 3, 4096)
    expect(listing.entries.map(entry => [entry.name, entry.type, entry.expandable])).toEqual([
      ['linked', 'other', false],
      ['src', 'directory', true],
      ['z.txt', 'file', false],
    ])
    expect(listing.entries[0]).toMatchObject({ outsideRoot: true, path: 'linked' })

    const bounded = await listExplorerDirectory(host, workspaceId, '', new AbortController().signal, 1, 4096)
    expect(bounded.entries).toHaveLength(1)
    expect(bounded.truncated).toBe(true)
  })
})
