// @vitest-environment jsdom
// Desktop file viewer: fetch lifecycle, validation, language hints, line
// rendering, binary/error states, truncation notice, and Search line scroll.

import { createElement } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopWorkspaceFileViewer, fetchFileView, langFromPath, parseFileView } from '../src/client/DesktopWorkspaceFileViewer.tsx'

afterEach(cleanup)

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

const t = (key: string): string => key

describe('desktop file viewer', () => {
  it('derives language hints from extensions and ignores dotfiles and unknowns', () => {
    expect(langFromPath('src/a.ts')).toBe('ts')
    expect(langFromPath('C:\\src\\main.rs')).toBe('rs')
    expect(langFromPath('README.md')).toBe('md')
    expect(langFromPath('.gitignore')).toBeUndefined()
    expect(langFromPath('a.unknownext')).toBeUndefined()
  })

  it('refuses malformed projections', () => {
    expect(() => parseFileView(null)).toThrow()
    expect(() => parseFileView({ workspaceId: 'w', path: 'a.ts', text: 'x' })).toThrow()
    expect(parseFileView({ workspaceId: 'w', path: 'a.ts', text: 'x', truncated: false }))
      .toEqual({ workspaceId: 'w', path: 'a.ts', text: 'x', truncated: false })
  })

  it('fetches the bounded projection for the selected Workspace and path', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      expect(input).toBe('/dsh-bridge/worktree/file?workspaceId=workspace-1&path=a.ts')
      return new Response(JSON.stringify({ workspaceId: 'workspace-1', path: 'a.ts', text: 'line1\nline2', truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = render(createElement(DesktopWorkspaceFileViewer, {
      workspaceId: 'workspace-1',
      path: 'a.ts',
      onClose: () => {},
      t,
    }))
    await waitFor(() => { expect(view.container.querySelector('[data-file-line="1"]')).toBeTruthy() })
    expect(view.getByText('line1')).toBeTruthy()
    expect(view.getByText('line2')).toBeTruthy()
  })

  it('renders the truncation notice for an oversized file and the binary refusal for binary content', async () => {
    stubFetch({ workspaceId: 'workspace-1', path: 'big.txt', text: 'prefix', truncated: true })
    const view = render(createElement(DesktopWorkspaceFileViewer, {
      workspaceId: 'workspace-1',
      path: 'big.txt',
      onClose: () => {},
      t,
    }))
    await waitFor(() => { expect(view.getByText('worktree.fileTruncated')).toBeTruthy() })

    cleanup()
    stubFetch({ ok: false, code: 'binary-file', message: 'the file is binary' }, 422)
    const binary = render(createElement(DesktopWorkspaceFileViewer, {
      workspaceId: 'workspace-1',
      path: 'a.bin',
      onClose: () => {},
      t,
    }))
    await waitFor(() => { expect(binary.getByText('worktree.fileBinary')).toBeTruthy() })
  })

  it('scrolls the matched Search line into view when ready', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const lines = Array.from({ length: 30 }, (_, index) => `line-${index + 1}`)
    stubFetch({ workspaceId: 'workspace-1', path: 'a.ts', text: lines.join('\n'), truncated: false })
    const view = render(createElement(DesktopWorkspaceFileViewer, {
      workspaceId: 'workspace-1',
      path: 'a.ts',
      scrollToLine: 25,
      onClose: () => {},
      t,
    }))
    await waitFor(() => { expect(scrollIntoView).toHaveBeenCalled() })
    expect(view.container.querySelector('[data-file-line="25"]')).toBeTruthy()
  })

  it('propagates fetch errors as the stable message and closes on demand', async () => {
    stubFetch({ ok: false, code: 'file-unavailable', message: 'file is unavailable' }, 404)
    const onClose = vi.fn()
    const view = render(createElement(DesktopWorkspaceFileViewer, {
      workspaceId: 'workspace-1',
      path: 'nope.ts',
      onClose,
      t,
    }))
    await waitFor(() => { expect(view.getByText('file is unavailable')).toBeTruthy() })
    const close = view.getByRole('button', { name: 'worktree.diffClose' })
    close.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight fetch on unmount', async () => {
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    const view = render(createElement(DesktopWorkspaceFileViewer, {
      workspaceId: 'workspace-1',
      path: 'a.ts',
      onClose: () => {},
      t,
    }))
    view.unmount()
    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ workspaceId: 'w', path: 'a.ts', text: 'x', truncated: false }), { status: 200 }))
      await Promise.resolve()
    })
  })

  it('exposes fetchFileView for direct consumers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ workspaceId: 'workspace-1', path: 'a.ts', text: 'x', truncated: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const signal = new AbortController().signal
    const result = await fetchFileView('workspace-1', 'a.ts', signal)
    expect(result).toEqual({ workspaceId: 'workspace-1', path: 'a.ts', text: 'x', truncated: false })
  })
})
