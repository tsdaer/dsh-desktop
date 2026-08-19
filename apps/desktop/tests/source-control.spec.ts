import { describe, expect, it } from 'vitest'
import {
  buildGitRepositoryCommand,
  buildGitStatusCommand,
  parseGitStatus,
  parseSourceControlWorkspaceId,
} from '../bridge/src/source-control.ts'

describe('desktop Worktree Source Control request vocabulary', () => {
  it('accepts a Workspace id and rejects browser path input', () => {
    expect(parseSourceControlWorkspaceId('workspace-1')).toBe('workspace-1')
    expect(() => { parseSourceControlWorkspaceId(null) }).toThrow(/workspaceId/)
  })

  it('uses fixed Git discovery and status arguments', () => {
    expect(buildGitRepositoryCommand()).toEqual(['git', '--no-pager', 'rev-parse', '--show-toplevel'])
    expect(buildGitStatusCommand('packages/desktop')).toEqual([
      'git', '--no-pager', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'packages/desktop',
    ])
  })

  it('projects staged, unstaged, untracked, conflicted, and renamed entries', () => {
    const listing = parseGitStatus([
      ' M src/changed.ts',
      'A  src/staged.ts',
      '?? src/new.ts',
      'UU src/conflict.ts',
      'R  src/new-name.ts',
      'src/old-name.ts',
    ].join('\0') + '\0', '', 20, 4096, 'workspace-1')
    expect(listing.entries).toEqual([
      { path: 'src/changed.ts', statuses: ['unstaged'] },
      { path: 'src/conflict.ts', statuses: ['conflicted', 'staged', 'unstaged'] },
      { path: 'src/new-name.ts', statuses: ['renamed'], oldPath: 'src/old-name.ts' },
      { path: 'src/new.ts', statuses: ['untracked'] },
      { path: 'src/staged.ts', statuses: ['staged'] },
    ])
  })

  it('filters parent-repository entries to the selected Workspace', () => {
    const listing = parseGitStatus(' M packages/app/src/index.ts\0 M packages/other.ts\0', 'packages/app', 20, 4096, 'workspace-1')
    expect(listing.entries).toEqual([{ path: 'src/index.ts', statuses: ['unstaged'] }])
  })

  it('reports truncation before exceeding entry or response bounds', () => {
    const listing = parseGitStatus('?? a.ts\0?? b.ts\0', '', 1, 4096, 'workspace-1')
    expect(listing.entries).toEqual([{ path: 'a.ts', statuses: ['untracked'] }])
    expect(listing.truncated).toBe(true)
  })
})
