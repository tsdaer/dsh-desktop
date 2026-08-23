import { describe, expect, it, vi } from 'vitest'
import { ExplorerRequestError } from '../bridge/src/explorer.ts'
import { readFileView } from '../bridge/src/file.ts'

const workspaceId = 'workspace-1' as never

/** One resolved in-root file target. */
function fileTarget(path: string): { targetKey: string; displayPath: string } {
  return { targetKey: `/workspace/${path}`, displayPath: path }
}

function fakeHost(bytes: Uint8Array | (() => Promise<Uint8Array>), size = bytes instanceof Uint8Array ? bytes.length : 12) {
  const read = typeof bytes === 'function' ? bytes : async () => bytes
  return {
    fs: {
      resolve: vi.fn(async (path: string) => fileTarget(path.replace(/^.*?\/workspace\//u, ''))),
      stat: vi.fn(async () => ({ type: 'file', size, version: 'v' as never })),
      contains: vi.fn((_root: { targetKey: string }, child: { targetKey: string }) => !child.targetKey.includes('outside')),
      readBytes: vi.fn(async (_target: unknown, _signal: unknown, maxBytes: number) => {
        const value = await read()
        if (value.length > maxBytes) throw new Error('FS_TOO_LARGE')
        return value
      }),
      streamText: vi.fn(),
    },
    workspaceRegistry: {
      get: vi.fn<() => { path: string } | undefined>(() => ({ path: '/workspace' })),
    },
  }
}

const CONFIG = { fileMaxBytes: 16, fileTimeoutMs: 1_000 }

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('desktop file view vocabulary', () => {
  it('rejects an unknown Workspace and an escaping path', async () => {
    const missing = fakeHost(text('x'))
    missing.workspaceRegistry.get.mockReturnValue(undefined)
    await expect(readFileView(missing as never, workspaceId, 'a.ts', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'workspace-not-found' })
    const host = fakeHost(text('x'))
    await expect(readFileView(host as never, workspaceId, 'outside/x.ts', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'path-escapes-workspace' })
    expect(host.fs.readBytes).not.toHaveBeenCalled()
  })

  it('refuses binary content and invalid UTF-8 instead of rendering', async () => {
    const binary = fakeHost(new Uint8Array([0x61, 0x00, 0x62]))
    await expect(readFileView(binary as never, workspaceId, 'a.bin', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'binary-file' })
    const invalid = fakeHost(new Uint8Array([0xff, 0xfe, 0xfd]))
    await expect(readFileView(invalid as never, workspaceId, 'a.txt', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'binary-file' })
  })

  it('returns strict UTF-8 text with truncation false for an in-bound file', async () => {
    const host = fakeHost(text('hello world'))
    const view = await readFileView(host as never, workspaceId, 'a.ts', new AbortController().signal, CONFIG)
    expect(view).toEqual({ workspaceId, path: 'a.ts', text: 'hello world', truncated: false })
    expect(host.fs.readBytes).toHaveBeenCalledTimes(1)
    expect(host.fs.streamText).not.toHaveBeenCalled()
  })

  it('streams a bounded prefix and marks truncation for an oversized file', async () => {
    const oversized = text('0123456789abcdefghij')
    const host = fakeHost(oversized, oversized.length)
    host.fs.streamText.mockImplementation(async () => {
      async function* chunks() {
        yield '0123456789abcdef'
        yield 'ghij'
      }
      return chunks()
    })
    const view = await readFileView(host as never, workspaceId, 'big.txt', new AbortController().signal, CONFIG)
    expect(view.truncated).toBe(true)
    // The prefix stops exactly at the byte bound; the overflow chunk is never consumed.
    expect(view.text).toBe('0123456789abcdef')
    expect(host.fs.readBytes).not.toHaveBeenCalled()
  })

  it('maps a failed prefix stream to the stable file error', async () => {
    const host = fakeHost(text('0123456789abcdefghij'), 20)
    host.fs.streamText.mockRejectedValue(Object.assign(new Error('io'), { code: 'FS_IO_ERROR' }))
    await expect(readFileView(host as never, workspaceId, 'big.txt', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'file-unavailable' })
  })

  it('maps a non-regular or absent target to the file error', async () => {
    const host = fakeHost(text('x'))
    host.fs.stat.mockResolvedValue({ type: 'directory', size: 0, version: 'v' as never })
    await expect(readFileView(host as never, workspaceId, 'dir', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'file-not-file' })
    const absent = fakeHost(text('x'))
    absent.fs.resolve.mockImplementation(async (path: string) => {
      if (path === '/workspace') return fileTarget('')
      throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
    })
    await expect(readFileView(absent as never, workspaceId, 'nope.ts', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'file-unavailable' })
  })

  it('propagates request cancellation as the abort error', async () => {
    const host = fakeHost(text('x'))
    host.fs.resolve.mockRejectedValue(Object.assign(new Error('aborted'), { code: 'FS_ABORTED' }))
    await expect(readFileView(host as never, workspaceId, 'a.ts', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ name: 'Error', code: 'FS_ABORTED' })
    expect(host.fs.readBytes).not.toHaveBeenCalled()
  })

  it('maps permission denial to the stable 403 error', async () => {
    const host = fakeHost(text('x'))
    host.fs.resolve.mockRejectedValue(Object.assign(new Error('denied'), { code: 'FS_PERMISSION_DENIED' }))
    await expect(readFileView(host as never, workspaceId, 'a.ts', new AbortController().signal, CONFIG))
      .rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('exposes the request vocabulary through ExplorerRequestError', () => {
    const error = new ExplorerRequestError(422, 'binary-file', 'the file is binary')
    expect(error).toBeInstanceOf(ExplorerRequestError)
    expect(error.status).toBe(422)
    expect(error.code).toBe('binary-file')
  })
})
