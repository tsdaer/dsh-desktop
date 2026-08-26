import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WslBashExecutor, isUnderTranslatedRoot, translateWindowsPathToWsl } from '../src/index.ts'

describe('wsl path translation', () => {
  it('translates a drive path into /mnt', () => {
    expect(translateWindowsPathToWsl('C:\\foo\\bar')).toBe('/mnt/c/foo/bar')
    expect(translateWindowsPathToWsl('d:/work/src')).toBe('/mnt/d/work/src')
  })

  it('passes an existing /mnt path through unchanged', () => {
    expect(translateWindowsPathToWsl('/mnt/c/foo')).toBe('/mnt/c/foo')
  })

  it('rejects UNC and non-drive paths', () => {
    expect(translateWindowsPathToWsl('\\server\\share')).toBeNull()
    expect(translateWindowsPathToWsl('relative/path')).toBeNull()
  })
})

describe('wsl translated-root containment', () => {
  it('accepts a path under the translated workspace root', () => {
    expect(isUnderTranslatedRoot('/mnt/c/work/src/a.ts', '/mnt/c/work')).toBe(true)
    expect(isUnderTranslatedRoot('/mnt/c/work', '/mnt/c/work')).toBe(true)
  })

  it('rejects a path outside the translated workspace root', () => {
    expect(isUnderTranslatedRoot('/mnt/c/other/a.ts', '/mnt/c/work')).toBe(false)
    expect(isUnderTranslatedRoot('/mnt/d/work', '/mnt/c/work')).toBe(false)
  })
})

describe('wsl executor argv', () => {
  it('wraps the command in the fixed wsl.exe argv', async () => {
    const ctx = new Context()
    const subprocess = {
      spawn: vi.fn((_spec: unknown) => ({
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: '', truncated: false }) }, stderr: { readFrom: () => ({ text: '', truncated: false }) } },
      })),
    }
    ctx.provide('subprocess', subprocess as never)
    const executor = new WslBashExecutor(ctx, {
      timeoutMs: 1000,
      maxTimeoutMs: 2000,
      maxOutputBytes: 1000,
      maxSpillBytes: 1000,
      graceMs: 100,
    } as never, 'docker-desktop')
    const result = await executor.run({
      command: 'echo hello',
      workdir: 'C:\\work',
      timeoutMs: 1000,
      stdoutMaxBytes: 1000,
    } as never)
    expect(subprocess.spawn).toHaveBeenCalledTimes(1)
    const spec = subprocess.spawn.mock.calls[0]?.[0] as { argv: readonly string[] }
    expect(spec.argv).toEqual(['wsl.exe', '--distribution', 'docker-desktop', '--exec', 'bash', '-c', 'echo hello'])
    expect(result.exitCode).toBe(0)
  })

  it('rejects a non-drive workdir before spawning', async () => {
    const ctx = new Context()
    const subprocess = { spawn: vi.fn() }
    ctx.provide('subprocess', subprocess as never)
    const executor = new WslBashExecutor(ctx, {
      timeoutMs: 1000, maxTimeoutMs: 2000, maxOutputBytes: 1000, maxSpillBytes: 1000, graceMs: 100,
    } as never, 'docker-desktop')
    let thrown: unknown
    try {
      await executor.run({
        command: 'pwd',
        workdir: '/not/a/drive/path',
        timeoutMs: 1000,
        stdoutMaxBytes: 1000,
      } as never)
    } catch (err) {
      thrown = err
    }
    expect(String(thrown)).toContain('translatable to /mnt')
    expect(subprocess.spawn).not.toHaveBeenCalled()
  })

  it('rejects an empty distribution at construction', () => {
    const ctx = new Context()
    expect(() => new WslBashExecutor(ctx, { timeoutMs: 1000, maxTimeoutMs: 2000, maxOutputBytes: 1000, maxSpillBytes: 1000, graceMs: 100 } as never, '')).toThrow(/non-empty/)
  })
})
