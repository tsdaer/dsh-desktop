import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SearchMatch } from '../bridge/src/search.ts'
import {
  buildSearchCommand,
  buildSearchFilesCommand,
  collectSearchStream,
  compareSearchPositions,
  matchesSearchPath,
  parseSearchCursor,
  parseSearchInclude,
  parseSearchFilePaths,
  parseSearchMatches,
  parseSearchQuery,
  parseSearchToggle,
  searchWorkspace,
} from '../bridge/src/search.ts'

describe('desktop Worktree Search request vocabulary', () => {
  it('accepts plain text and brace-alternation include globs', () => {
    expect(parseSearchQuery('needle')).toBe('needle')
    expect(parseSearchInclude('*.{ts,tsx}')).toBe('*.{ts,tsx}')
    expect(() => { parseSearchInclude('*.ts,*.tsx') }).toThrow(/one positive glob/)
    expect(() => { parseSearchInclude('!*.lock') }).toThrow(/one positive glob/)
  })

  it('rejects invalid queries and cursors before any Host operation', () => {
    expect(() => { parseSearchQuery('') }).toThrow(/non-empty/)
    expect(() => { parseSearchCursor('not-base64') }).toThrow(/cursor is invalid/)
  })

  it('parses strict matching toggles', () => {
    expect(parseSearchToggle(null, 'caseSensitive')).toBe(false)
    expect(parseSearchToggle('1', 'caseSensitive')).toBe(true)
    expect(parseSearchToggle('false', 'wholeWord')).toBe(false)
    expect(() => { parseSearchToggle('yes', 'wholeWord') }).toThrow(/boolean/)
  })

  it('builds fixed arguments with the Workspace root as the only search target', () => {
    expect(buildSearchCommand('a --b', '*.ts', 2048, { caseSensitive: true, wholeWord: true })).toEqual(expect.arrayContaining([
      '--json', '--fixed-strings', '--max-filesize=2048', '--regexp=a --b', '--glob=*.ts', '--word-regexp', '--', '.',
    ]))
    const defaults = buildSearchCommand('a', undefined, 2048)
    expect(defaults).toContain('--ignore-case')
    expect(defaults).not.toContain('--hidden')
    expect(defaults).not.toContain('--no-ignore')
    expect(defaults.at(-2)).toBe('--')
    expect(defaults.at(-1)).toBe('.')
    expect(buildSearchFilesCommand('*.ts')).toEqual(expect.arrayContaining(['--files', '--sort=path', '--glob=*.ts', '--', '.']))
  })

  it('matches partial file paths with the same case and whole-word rules', () => {
    expect(parseSearchFilePaths('src\\DesktopWorkspaceSearch.tsx\r\nREADME.md\r\n')).toEqual(['src/DesktopWorkspaceSearch.tsx', 'README.md'])
    expect(matchesSearchPath('src/DesktopWorkspaceSearch.tsx', 'Workspace', false, false)).toBe(true)
    expect(matchesSearchPath('src/DesktopWorkspaceSearch.tsx', 'workspace', true, false)).toBe(false)
    expect(matchesSearchPath('src/Workspace.tsx', 'Workspace', false, true)).toBe(true)
    expect(matchesSearchPath('src/DesktopWorkspaceSearch.tsx', 'Work', false, true)).toBe(false)
  })

  it('parses only match records and normalizes paths', () => {
    const stdout = [
      JSON.stringify({ type: 'begin', data: {} }),
      JSON.stringify({ type: 'match', data: { path: { text: 'src\\index.ts' }, line_number: 3, lines: { text: 'needle\n' } } }),
      'malformed',
      JSON.stringify({ type: 'end', data: {} }),
    ].join('\n')
    expect(parseSearchMatches(stdout)).toEqual([{ path: 'src/index.ts', line: 3, text: 'needle' }])
  })

  it('uses one deterministic order for Search pages', () => {
    const matches = [
      { path: 'a.ts', line: 1, text: 'a' },
      { path: 'B.ts', line: 1, text: 'B' },
    ].sort(compareSearchPositions)
    expect(matches.map(match => match.path)).toEqual(['B.ts', 'a.ts'])
    expect(compareSearchPositions(matches[1] as SearchMatch, matches[0] as SearchMatch)).toBeGreaterThan(0)
  })

  it('retains complete match records from a bounded output tail', () => {
    const stdout = [
      'truncated record suffix}',
      JSON.stringify({ type: 'match', data: { path: { text: 'src\\later.ts' }, line_number: 8, lines: { text: 'partial query match\n' } } }),
    ].join('\n')
    expect(parseSearchMatches(stdout)).toEqual([{ path: 'src/later.ts', line: 8, text: 'partial query match' }])
  })

  it('publishes complete streamed matches before process completion', () => {
    const stdout = new PassThrough()
    const published: unknown[] = []
    let terminated = false
    const collector = collectSearchStream(stdout, 4096, { terminate() { terminated = true } }, (match) => { published.push(match) })
    const record = `${JSON.stringify({ type: 'match', data: { path: { text: 'src/live.ts' }, line_number: 4, lines: { text: '逐步结果\n' } } })}\n`
    const bytes = Buffer.from(record)
    stdout.write(bytes.subarray(0, bytes.indexOf(Buffer.from('步')) + 1))
    expect(published).toEqual([])
    stdout.write(bytes.subarray(bytes.indexOf(Buffer.from('步')) + 1))
    expect(published).toEqual([{ path: 'src/live.ts', line: 4, text: '逐步结果' }])
    collector.finish()
    expect(collector.matches).toEqual(published)
    expect(collector.outputLimited).toBe(false)
    expect(terminated).toBe(false)
  })

  it('terminates a streamed search at its raw-output limit', () => {
    const stdout = new PassThrough()
    let terminated = false
    const collector = collectSearchStream(stdout, 4, { terminate() { terminated = true } }, () => {})
    stdout.write('12345')
    collector.finish()
    expect(collector.outputLimited).toBe(true)
    expect(terminated).toBe(true)
  })

  it('terminates an established Search process when its companion cannot start', async () => {
    const stdout = new PassThrough()
    let spawnCalls = 0
    let terminated = false
    let waited = false
    const handle = {
      stdout,
      terminate() { terminated = true },
      async waitForExit() { waited = true; return true },
    }
    const host = {
      fs: {
        resolve: async () => ({ targetKey: 'root', displayPath: 'root' }),
        stat: async () => ({ type: 'directory', version: 'v' }),
        processPath: () => 'J:/workspace',
      },
      workspaceRegistry: { get: () => ({ path: 'J:/workspace' }) },
      subprocess: {
        spawn: () => {
          spawnCalls++
          if (spawnCalls === 1) return handle
          throw new Error('spawn failed')
        },
      },
    }

    await expect(searchWorkspace(
      host as unknown as Parameters<typeof searchWorkspace>[0],
      'workspace-1' as never,
      'needle',
      undefined,
      false,
      false,
      undefined,
      new AbortController().signal,
      { maxMatches: 10, maxBytes: 4096, maxRawBytes: 4096, maxFileBytes: 4096, graceMs: 100 },
    )).rejects.toThrow(/could not start/)
    expect(terminated).toBe(true)
    expect(waited).toBe(true)
  })
})
