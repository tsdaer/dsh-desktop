import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import {
  buildGitDiscardCommand,
  buildGitStageCommand,
  buildGitUnstageCommand,
  buildIndexOpCommand,
  buildIndexOps,
  handleSourceControlActionRequest,
  headBlobPath,
  parseCommitMessage,
  parseGitIndexEntry,
  parseSourceControlRelativePath,
  readSourceControlDiff,
  requireListedEntry,
  runSourceControlCommit,
  runSourceControlMutation,
  sourceControlOperationAllowed,
  type SourceControlActionConfig,
} from '../bridge/src/source-control-actions.ts'
import type { SourceControlEntry, SourceControlListing } from '../bridge/src/source-control.ts'

const config: SourceControlActionConfig = {
  sourceControlMaxEntries: 256,
  sourceControlMaxBytes: 128 * 1024,
  sourceControlGraceMs: 100,
  sourceControlTimeoutMs: 5_000,
  sourceControlMaxDiffBytes: 64 * 1024,
}

describe('desktop Source Control write request vocabulary', () => {
  it('accepts a bounded Workspace-relative path and rejects path authority', () => {
    expect(parseSourceControlRelativePath('src/a.ts', 'path')).toBe('src/a.ts')
    expect(() => { parseSourceControlRelativePath(null, 'path') }).toThrow(/Workspace-relative/)
    expect(() => { parseSourceControlRelativePath('../outside.ts', 'path') }).toThrow(/Workspace-relative/)
    expect(() => { parseSourceControlRelativePath('C:/abs.ts', 'path') }).toThrow(/Workspace-relative/)
    expect(() => { parseSourceControlRelativePath('/abs.ts', 'path') }).toThrow(/Workspace-relative/)
    expect(() => { parseSourceControlRelativePath('a\\b.ts', 'path') }).toThrow(/Workspace-relative/)
    expect(() => { parseSourceControlRelativePath('a\0b.ts', 'path') }).toThrow(/Workspace-relative/)
    expect(() => { parseSourceControlRelativePath('a//b.ts', 'path') }).toThrow(/Workspace-relative/)
  })

  it('validates commit messages and rejects empty or NUL messages', () => {
    expect(parseCommitMessage('  fix the thing  ')).toBe('fix the thing')
    expect(() => { parseCommitMessage('') }).toThrow(/empty/)
    expect(() => { parseCommitMessage('   ') }).toThrow(/empty/)
    expect(() => { parseCommitMessage('a\0b') }).toThrow(/invalid/)
    expect(() => { parseCommitMessage('x'.repeat(9000)) }).toThrow(/too long/)
  })

  it('offers operations only for classified entries', () => {
    const unclassified: SourceControlEntry = { path: 'u', statuses: ['unsupported'] }
    expect(sourceControlOperationAllowed(unclassified, 'stage')).toBe(false)
    expect(sourceControlOperationAllowed(unclassified, 'unstage')).toBe(false)
    expect(sourceControlOperationAllowed(unclassified, 'discard')).toBe(false)
    expect(sourceControlOperationAllowed(unclassified, 'diff')).toBe(false)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: [] }, 'diff')).toBe(false)

    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['unstaged'] }, 'stage')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['unstaged'] }, 'unstage')).toBe(false)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['unstaged'] }, 'discard')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['staged'] }, 'stage')).toBe(false)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['staged'] }, 'unstage')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['staged'] }, 'discard')).toBe(false)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['untracked'] }, 'stage')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['untracked'] }, 'discard')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['renamed'], oldPath: 'old' }, 'stage')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['renamed'], oldPath: 'old' }, 'discard')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['conflicted'] }, 'diff')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['conflicted'] }, 'stage')).toBe(false)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['conflicted'] }, 'discard')).toBe(false)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['staged', 'unstaged'] }, 'stage')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['staged', 'unstaged'] }, 'unstage')).toBe(true)
    expect(sourceControlOperationAllowed({ path: 'e', statuses: ['staged', 'unstaged'] }, 'discard')).toBe(true)
  })

  it('uses fixed Git argv with Host-derived paths only', () => {
    const entry: SourceControlEntry = { path: 'src/a.ts', statuses: ['unstaged'] }
    const rename: SourceControlEntry = { path: 'src/new.ts', statuses: ['renamed'], oldPath: 'src/old.ts' }
    expect(buildGitStageCommand(['src/a.ts'])).toEqual(['git', '--no-pager', 'add', '-A', '--', 'src/a.ts'])
    expect(buildGitStageCommand(['src/new.ts', 'src/old.ts'])).toEqual(['git', '--no-pager', 'add', '-A', '--', 'src/new.ts', 'src/old.ts'])
    expect(buildGitUnstageCommand(['src/a.ts'])).toEqual(['git', '--no-pager', 'restore', '--staged', '--', 'src/a.ts'])
    expect(buildGitDiscardCommand(entry)).toEqual(['git', '--no-pager', 'restore', '--staged', '--worktree', '--', 'src/a.ts'])
    expect(buildGitDiscardCommand({ path: 'new.ts', statuses: ['untracked'] })).toEqual(['git', '--no-pager', 'clean', '-f', '--', 'new.ts'])
    expect(buildGitDiscardCommand(rename)).toEqual(['git', '--no-pager', 'restore', '--staged', '--worktree', '--', 'src/new.ts', 'src/old.ts'])
  })

  it('parses git ls-files index records and rejects unsafe ones', () => {
    expect(parseGitIndexEntry('100644 0123456789abcdef0123456789abcdef01234567 0\tsrc/a.ts'))
      .toEqual({ mode: '100644', blob: '0123456789abcdef0123456789abcdef01234567', path: 'src/a.ts' })
    expect(parseGitIndexEntry('160000 0123456789abcdef0123456789abcdef01234567 0\tsub')).toEqual({
      mode: '160000',
      blob: '0123456789abcdef0123456789abcdef01234567',
      path: 'sub',
    })
    expect(parseGitIndexEntry('100644 0123456789abcdef0123456789abcdef01234567 1\tsrc/conflict.ts')).toBeNull()
    expect(parseGitIndexEntry('100644 zzz 0\tbad')).toBeNull()
    expect(parseGitIndexEntry('no-tab-record')).toBeNull()
    expect(parseGitIndexEntry('')).toBeNull()
  })

  it('builds temporary-index operations that replay only staged Workspace entries', () => {
    const entries: SourceControlEntry[] = [
      { path: 'a.ts', statuses: ['staged'] },
      { path: 'gone.ts', statuses: ['staged'] },
      { path: 'renamed.ts', statuses: ['staged', 'renamed'], oldPath: 'old.ts' },
    ]
    const ops = buildIndexOps(entries, [
      '100644 0123456789abcdef0123456789abcdef01234567 0\ta.ts',
      null,
      '100644 fedcba9876543210fedcba9876543210fedcba98 0\trenamed.ts',
    ])
    expect(ops).toEqual([
      { kind: 'cacheinfo', mode: '100644', blob: '0123456789abcdef0123456789abcdef01234567', path: 'a.ts' },
      { kind: 'remove', path: 'gone.ts' },
      { kind: 'cacheinfo', mode: '100644', blob: 'fedcba9876543210fedcba9876543210fedcba98', path: 'renamed.ts' },
      { kind: 'remove', path: 'old.ts' },
    ])
    const firstOp = ops[0]
    if (firstOp === undefined || firstOp.kind !== 'cacheinfo') throw new Error('expected a cacheinfo operation')
    expect(buildIndexOpCommand(firstOp)).toEqual([
      'git', '--no-pager', 'update-index', '--add', '--cacheinfo', '100644,0123456789abcdef0123456789abcdef01234567,a.ts',
    ])
    expect(buildIndexOpCommand({ kind: 'remove', path: 'gone.ts' })).toEqual(['git', '--no-pager', 'update-index', '--force-remove', '--', 'gone.ts'])
  })

  it('reads the HEAD blob path through the rename origin and Workspace prefix', () => {
    const rename: SourceControlEntry = { path: 'new.ts', statuses: ['renamed'], oldPath: 'old.ts' }
    expect(headBlobPath(rename, '')).toBe('old.ts')
    expect(headBlobPath(rename, 'sub')).toBe('sub/old.ts')
    expect(headBlobPath({ path: 'a.ts', statuses: ['staged'] }, 'sub')).toBe('sub/a.ts')
  })

  it('requires the fresh listing entry and refuses stale or unclassified entries', () => {
    const listing: SourceControlListing = {
      workspaceId: 'workspace-1',
      state: 'repository',
      entries: [{ path: 'a.ts', statuses: ['unstaged'] }],
      truncated: false,
    }
    expect(requireListedEntry(listing, 'a.ts', 'stage').path).toBe('a.ts')
    expect(errorCode(() => requireListedEntry(listing, 'b.ts', 'stage'))).toBe('stale-status')
    expect(errorCode(() => requireListedEntry(listing, 'a.ts', 'unstage'))).toBe('operation-not-allowed')
    expect(errorCode(() => requireListedEntry({ ...listing, state: 'not-repository' }, 'a.ts', 'stage'))).toBe('not-a-repository')
    expect(errorCode(() => requireListedEntry({ ...listing, entries: [{ path: 'u', statuses: ['unsupported'] }] }, 'u', 'diff'))).toBe('operation-not-allowed')
  })
})

function errorCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error: unknown) {
    return (error as { code?: string }).code ?? ''
  }
  return ''
}

/** One request/response pair with Node's auto-destroy-after-end semantics. */
function fakeExchange(body: string) {
  const req = Object.assign(new Readable({ read() {} }), {
    url: '/dsh-bridge/worktree/source-control/stage',
    method: 'POST',
  })
  req.push(body)
  req.push(null)
  req.on('end', () => { req.destroy() })
  const chunks: string[] = []
  const res = {
    statusCode: 0,
    setHeader: (..._args: readonly unknown[]) => {},
    once: (_event: string, _listener: () => void) => undefined,
    removeListener: (_event: string, _listener: () => void) => undefined,
    writableEnded: false,
    end: (chunk?: string) => {
      if (chunk !== undefined) chunks.push(chunk)
      res.writableEnded = true
    },
  }
  return { req, res, chunks }
}

interface ScriptedStep {
  stdout?: string
  stderr?: string
  exitCode?: number
  signal?: string | null
  lossy?: boolean
}

interface FakeHostOptions {
  stat?: (target: { targetKey: string }) => Promise<{ type: 'directory' | 'file'; version: string; size?: number } | undefined>
  readBytes?: () => Promise<Uint8Array>
  resolve?: (path: string) => Promise<{ targetKey: string; displayPath: string }>
}

function fakeHost(steps: readonly ScriptedStep[], options: FakeHostOptions = {}) {
  const spawnCalls: Array<{ argv: readonly string[]; cwd: string; env?: Record<string, string> }> = []
  let next = 0
  const resolvePath = options.resolve ?? (async (path: string) => ({ targetKey: path.replaceAll('\\', '/'), displayPath: path }))
  return {
    spawnCalls,
    host: {
      fs: {
        resolve: resolvePath,
        processPath: (target: { targetKey: string }) => target.targetKey,
        contains: (parent: { targetKey: string }, child: { targetKey: string }) => child.targetKey.startsWith(parent.targetKey),
        stat: options.stat ?? (async () => ({ type: 'directory', version: 'v' })),
        readBytes: options.readBytes ?? (async () => new TextEncoder().encode('worktree content\n')),
      },
      workspaceRegistry: { get: () => ({ path: 'J:/repo' }) },
      subprocess: {
        spawn: (spec: { argv: readonly string[]; cwd: string; env?: Record<string, string> }) => {
          spawnCalls.push({
            argv: spec.argv,
            cwd: spec.cwd,
            ...(spec.env === undefined ? {} : { env: spec.env }),
          })
          const step = steps[next++]
          if (step === undefined) throw new Error('unexpected spawn')
          return {
            done: Promise.resolve({ exitCode: step.exitCode ?? 0, signal: step.signal ?? null }),
            collected: {
              stdout: { readFrom: () => ({ text: step.stdout ?? '', lossy: step.lossy ?? false }) },
              stderr: { readFrom: () => ({ text: step.stderr ?? '', lossy: false }) },
            },
          }
        },
      },
    },
  }
}

describe('desktop Source Control mutation integration', () => {
  it('writes mutation errors even when the request stream auto-destroyed', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: '' }, // fresh status: entry gone
    ])
    const { req, res, chunks } = fakeExchange(JSON.stringify({ workspaceId: 'workspace-1', path: 'missing.txt' }))
    await handleSourceControlActionRequest(req as never, res as never, fake.host as never, config, 'stage')
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(chunks.join(''))).toMatchObject({ ok: false, code: 'stale-status' })
  })

  it('stages an unstaged entry from the fresh listing with fixed argv', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' }, // discovery
      { stdout: ' M a.ts\0' }, // fresh status
      { exitCode: 0 }, // git add
    ])
    const result = await runSourceControlMutation(
      fake.host as never,
      'workspace-1' as never,
      'a.ts',
      'stage',
      new AbortController().signal,
      config,
    )
    expect(result).toEqual({ ok: true })
    const argv = fake.spawnCalls.map(call => call.argv)
    expect(argv[2]).toEqual(['git', '--no-pager', 'add', '-A', '--', 'a.ts'])
    expect(fake.spawnCalls[2]?.cwd).toBe('J:/repo')
  })

  it('refuses a stale path before running any Git mutation', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: '' }, // fresh status: entry gone
    ])
    await expect(runSourceControlMutation(
      fake.host as never,
      'workspace-1' as never,
      'a.ts',
      'discard',
      new AbortController().signal,
      config,
    )).rejects.toMatchObject({ code: 'stale-status' })
    expect(fake.spawnCalls).toHaveLength(2)
  })

  it('discards an untracked entry with git clean and reports Git stderr detail', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: '?? new.ts\0' },
      { exitCode: 1, stderr: 'fatal: pathspec did not match' },
    ])
    await expect(runSourceControlMutation(
      fake.host as never,
      'workspace-1' as never,
      'new.ts',
      'discard',
      new AbortController().signal,
      config,
    )).rejects.toMatchObject({ code: 'git-failed', detail: 'fatal: pathspec did not match' })
    expect(fake.spawnCalls[2]?.argv).toEqual(['git', '--no-pager', 'clean', '-f', '--', 'new.ts'])
  })

  it('propagates cancellation from the subprocess outcome', async () => {
    const fake = fakeHost([
      { signal: 'SIGTERM', exitCode: 143 },
    ])
    await expect(runSourceControlMutation(
      fake.host as never,
      'workspace-1' as never,
      'a.ts',
      'stage',
      new AbortController().signal,
      config,
    )).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('commits only the Workspace staged entries through a temporary index', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' }, // discovery
      { stdout: 'A  a.ts\0 M b.ts\0' }, // fresh status: a.ts staged, b.ts unstaged
      { exitCode: 0 }, // rev-parse HEAD
      { exitCode: 0 }, // read-tree HEAD
      { stdout: '100644 0123456789abcdef0123456789abcdef01234567 0\ta.ts\n' }, // ls-files a.ts
      { exitCode: 0 }, // update-index cacheinfo
      { exitCode: 0 }, // git commit
    ])
    const result = await runSourceControlCommit(
      fake.host as never,
      'workspace-1' as never,
      'phase three',
      new AbortController().signal,
      config,
    )
    expect(result).toEqual({ ok: true })
    const calls = fake.spawnCalls
    expect(calls[2]?.argv).toEqual(['git', '--no-pager', 'rev-parse', '--verify', 'HEAD'])
    expect(calls[3]?.argv).toEqual(['git', '--no-pager', 'read-tree', 'HEAD'])
    expect(calls[3]?.env?.GIT_INDEX_FILE).toMatch(/dsh-git-index-/)
    expect(calls[4]?.argv).toEqual(['git', '--no-pager', 'ls-files', '-s', '--', 'a.ts'])
    expect(calls[5]?.argv).toEqual(['git', '--no-pager', 'update-index', '--add', '--cacheinfo', '100644,0123456789abcdef0123456789abcdef01234567,a.ts'])
    expect(calls[5]?.env?.GIT_INDEX_FILE).toMatch(/dsh-git-index-/)
    expect(calls[6]?.argv).toEqual(['git', '--no-pager', 'commit', '-m', 'phase three'])
    expect(calls[6]?.env?.GIT_INDEX_FILE).toMatch(/dsh-git-index-/)
    expect(calls[6]?.cwd).toBe('J:/repo')
  })

  it('bases the temporary index on the empty tree for a repository without HEAD', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: 'A  a.ts\0' },
      { exitCode: 128 }, // rev-parse HEAD fails (empty repository)
      { exitCode: 0 }, // read-tree --empty
      { stdout: '100644 0123456789abcdef0123456789abcdef01234567 0\ta.ts\n' },
      { exitCode: 0 },
      { exitCode: 0 },
    ])
    await runSourceControlCommit(fake.host as never, 'workspace-1' as never, 'first', new AbortController().signal, config)
    expect(fake.spawnCalls[3]?.argv).toEqual(['git', '--no-pager', 'read-tree', '--empty'])
  })

  it('refuses a commit when nothing is staged in the Workspace', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: ' M b.ts\0' }, // only unstaged
    ])
    await expect(runSourceControlCommit(
      fake.host as never,
      'workspace-1' as never,
      'nothing',
      new AbortController().signal,
      config,
    )).rejects.toMatchObject({ code: 'nothing-staged' })
    expect(fake.spawnCalls).toHaveLength(2)
  })
})

describe('desktop Source Control diff integration', () => {
  const fileStat = (target: { targetKey: string }) => Promise.resolve(
    target.targetKey === 'J:/repo' ? { type: 'directory' as const, version: 'v' } : { type: 'file' as const, version: 'v', size: 64 },
  )

  it('projects the HEAD blob and worktree content into one bounded diff', async () => {
    const fake = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: ' M a.ts\0' },
      { stdout: 'head content\n' }, // git show HEAD:a.ts
    ], { stat: fileStat })
    const diff = await readSourceControlDiff(
      fake.host as never,
      'workspace-1' as never,
      'a.ts',
      new AbortController().signal,
      config,
    )
    expect(diff).toEqual({
      workspaceId: 'workspace-1',
      path: 'a.ts',
      oldText: 'head content\n',
      newText: 'worktree content\n',
      truncatedOld: false,
      truncatedNew: false,
    })
    expect(fake.spawnCalls[2]?.argv).toEqual(['git', '--no-pager', 'show', 'HEAD:a.ts'])
  })

  it('treats a missing HEAD blob as a new file and a missing worktree file as deleted', async () => {
    const missingFile = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: '?? new.ts\0' },
      { exitCode: 128 }, // git show fails: not in HEAD
    ], {
      stat: fileStat,
      resolve: async (path: string) => {
        if (path.replaceAll('\\', '/') === 'J:/repo/new.ts') throw new Error('FS_NOT_FOUND')
        return { targetKey: path.replaceAll('\\', '/'), displayPath: path }
      },
    })
    const diff = await readSourceControlDiff(
      missingFile.host as never,
      'workspace-1' as never,
      'new.ts',
      new AbortController().signal,
      config,
    )
    expect(diff.oldText).toBeNull()
    expect(diff.newText).toBe('')
  })

  it('refuses binary content on either side', async () => {
    const binary = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: ' M a.ts\0' },
      { stdout: 'head\0content' }, // NUL byte: binary
    ], { stat: fileStat })
    await expect(readSourceControlDiff(
      binary.host as never,
      'workspace-1' as never,
      'a.ts',
      new AbortController().signal,
      config,
    )).rejects.toMatchObject({ code: 'binary-file' })
  })

  it('marks an oversized worktree side truncated without reading it', async () => {
    const large = fakeHost([
      { stdout: 'J:/repo\n' },
      { stdout: ' M big.ts\0' },
      { stdout: 'head\n' },
    ], {
      stat: (target: { targetKey: string }) => Promise.resolve(
        target.targetKey === 'J:/repo' ? { type: 'directory' as const, version: 'v' } : { type: 'file' as const, version: 'v', size: config.sourceControlMaxDiffBytes + 1 },
      ),
    })
    const diff = await readSourceControlDiff(
      large.host as never,
      'workspace-1' as never,
      'big.ts',
      new AbortController().signal,
      config,
    )
    expect(diff.truncatedNew).toBe(true)
    expect(diff.newText).toBe('')
  })
})
