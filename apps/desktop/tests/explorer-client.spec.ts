import { describe, expect, it } from 'vitest'
import { buildGitDecorations, parseSourceControlListing } from '../bridge-client/src/client/DesktopWorkspaceExplorer.tsx'
import { formatWorktreePath, normalizeWorktreePath } from '../bridge-client/src/client/DesktopWorkspacePathDrop.ts'

describe('desktop Explorer Git decorations', () => {
  it('validates the bounded status projection and aggregates parent directories', () => {
    const listing = parseSourceControlListing({
      workspaceId: 'workspace-1',
      state: 'repository',
      truncated: false,
      entries: [
        { path: 'apps/desktop/src/index.ts', statuses: ['unstaged'] },
        { path: 'apps/desktop/README.md', statuses: ['untracked'] },
      ],
    })
    const decorations = buildGitDecorations(listing)

    expect(decorations.get('apps/desktop/src/index.ts')).toMatchObject({ statuses: ['unstaged'], count: 1 })
    expect(decorations.get('apps/desktop')).toMatchObject({ statuses: ['unstaged', 'untracked'], count: 2 })
    expect(decorations.get('apps')).toMatchObject({ statuses: ['unstaged', 'untracked'], count: 2 })
  })

  it('does not decorate non-repository listings and rejects malformed entries', () => {
    expect(buildGitDecorations(parseSourceControlListing({ workspaceId: 'workspace-1', state: 'not-repository', truncated: false, entries: [] }))).toEqual(new Map())
    expect(() => parseSourceControlListing({ workspaceId: 'workspace-1', state: 'repository', truncated: false, entries: [{ path: 'README.md', statuses: ['unknown'] }] })).toThrow(/invalid response/)
  })

  it('carries only Workspace-relative paths through the internal pointer drag', () => {
    expect(normalizeWorktreePath('apps/./desktop/README.md')).toBe('apps/desktop/README.md')
    expect(formatWorktreePath('apps/desktop/README.md')).toBe('apps/desktop/README.md')
    expect(normalizeWorktreePath('apps\\desktop\\README.md')).toBeNull()
    expect(normalizeWorktreePath('C:/outside.txt')).toBeNull()
    expect(normalizeWorktreePath('C:outside.txt')).toBeNull()
    expect(normalizeWorktreePath('.')).toBeNull()
    expect(normalizeWorktreePath('apps//desktop/README.md')).toBeNull()
    expect(normalizeWorktreePath('../outside.txt')).toBeNull()
  })
})
