// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopWorkspaceExplorer } from '../src/client/DesktopWorkspaceExplorer.tsx'

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function mutableSource<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    update(next: T) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

const EXPLORER_ENTRIES = [
  { name: 'a.ts', path: 'a.ts', type: 'file', expandable: false },
  { name: 'b.ts', path: 'b.ts', type: 'file', expandable: false },
  { name: 'c.ts', path: 'c.ts', type: 'file', expandable: false },
  { name: 'd.bin', path: 'd.bin', type: 'file', expandable: false },
  { name: 'dir', path: 'dir', type: 'directory', expandable: true },
]

function renderExplorer(
  entries: readonly unknown[],
  posts: Array<{ url: string; body: unknown }> = [],
  diff: unknown = null,
  postResponse: Response | Promise<Response> = new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
) {
  const workspaces = mutableSource<{ items: readonly { workspaceId: string; title: string; sessionIds: readonly string[] }[] }>({
    items: [{ workspaceId: 'workspace-1', title: 'Workspace', sessionIds: [] }],
  })
  const sessions = mutableSource({ current: undefined as string | undefined })
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://desktop.test')
    if (init?.method === 'POST') {
      posts.push({ url: url.pathname, body: JSON.parse(String(init.body)) })
      return postResponse
    }
    if (url.pathname.endsWith('/source-control')) {
      return new Response(JSON.stringify({ workspaceId: 'workspace-1', state: 'repository', entries, truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.pathname.endsWith('/source-control/diff')) {
      if (diff === null) {
        return new Response(JSON.stringify({ ok: false, code: 'diff-unavailable', message: 'no diff' }), { status: 409, headers: { 'content-type': 'application/json' } })
      }
      if (typeof diff === 'object' && diff !== null && (diff as { ok?: unknown }).ok === false) {
        return new Response(JSON.stringify(diff), { status: 422, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify(diff), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.pathname.endsWith('/explorer')) {
      return new Response(JSON.stringify({ workspaceId: 'workspace-1', path: '', entries: EXPLORER_ENTRIES, truncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const view = render(createElement(DesktopWorkspaceExplorer, { workspaces, sessions, t: (key: string) => key }))
  return { view, workspaces, fetchMock }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('desktop Source Control action surface', () => {
  it('offers actions only on classified changed file rows', async () => {
    renderExplorer([
      { path: 'a.ts', statuses: ['unstaged'] },
      { path: 'b.ts', statuses: ['staged'] },
      { path: 'c.ts', statuses: ['untracked'] },
      { path: 'd.bin', statuses: ['unsupported'] },
    ])
    await waitFor(() => { expect(screen.getByRole('status')).toBeTruthy() })
    expect(screen.getAllByRole('button', { name: /^worktree\.diff/ })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'worktree.stage' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'worktree.unstage' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'worktree.discard' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'worktree.diff: d.bin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'worktree.diff: dir' })).toBeNull()
  })

  it('stages a file with the Workspace id and Workspace-relative path only', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    renderExplorer([{ path: 'a.ts', statuses: ['unstaged'] }], posts)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.stage' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.stage' }))
    await waitFor(() => { expect(posts).toHaveLength(1) })
    expect(posts[0]).toEqual({ url: '/dsh-bridge/worktree/source-control/stage', body: { workspaceId: 'workspace-1', path: 'a.ts' } })
  })

  it('aborts an in-flight mutation when the Worktree unmounts', async () => {
    let resolvePost!: (response: Response) => void
    const pendingPost = new Promise<Response>((resolve) => { resolvePost = resolve })
    const { fetchMock } = renderExplorer([{ path: 'a.ts', statuses: ['unstaged'] }], [], null, pendingPost)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.stage' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.stage' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(true)
    })
    const postInit = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')?.[1] as RequestInit | undefined
    const signal = postInit?.signal as AbortSignal | undefined
    expect(signal).toBeInstanceOf(AbortSignal)
    cleanup()
    expect(signal?.aborted).toBe(true)
    resolvePost(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
  })

  it('confirms destructive discards by file name before posting', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    renderExplorer([{ path: 'a.ts', statuses: ['unstaged'] }], posts)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.discard' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.discard' }))
    expect(screen.getByText('worktree.discardConfirm')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'worktree.discardNo' }))
    expect(posts).toHaveLength(0)
    expect(screen.queryByText('worktree.discardConfirm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'worktree.discard' }))
    fireEvent.click(screen.getByRole('button', { name: 'worktree.discardYes' }))
    await waitFor(() => { expect(posts).toHaveLength(1) })
    expect(posts[0]).toEqual({ url: '/dsh-bridge/worktree/source-control/discard', body: { workspaceId: 'workspace-1', path: 'a.ts' } })
  })

  it('names untracked deletions explicitly in the confirmation', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    renderExplorer([{ path: 'c.ts', statuses: ['untracked'] }], posts)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.discard' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.discard' }))
    expect(screen.getByText('worktree.deleteConfirm')).toBeTruthy()
  })

  it('commits the staged Workspace entries with the typed message', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    renderExplorer([{ path: 'b.ts', statuses: ['staged'] }], posts)
    await waitFor(() => { expect(screen.getByText('worktree.stagedCount')).toBeTruthy() })
    const commit = screen.getByRole('button', { name: 'worktree.commit' })
    expect((commit as HTMLButtonElement).disabled).toBe(true)
    const input = screen.getByRole('textbox', { name: 'worktree.commitPlaceholder' })
    fireEvent.change(input, { target: { value: 'phase three' } })
    expect((commit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(commit)
    await waitFor(() => { expect(posts).toHaveLength(1) })
    expect(posts[0]).toEqual({ url: '/dsh-bridge/worktree/source-control/commit', body: { workspaceId: 'workspace-1', message: 'phase three' } })
    await waitFor(() => { expect((input as HTMLInputElement).value).toBe('') })
  })

  it('opens a diff through the shared DiffBlock presentation and closes it', async () => {
    renderExplorer(
      [{ path: 'a.ts', statuses: ['unstaged'] }],
      [],
      { workspaceId: 'workspace-1', path: 'a.ts', oldText: 'old line\n', newText: 'new line\n', truncatedOld: false, truncatedNew: false },
    )
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.diff: a.ts' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.diff: a.ts' }))
    await waitFor(() => { expect(screen.getByText('a.ts')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.diffClose' }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'worktree.diffClose' })).toBeNull() })
  })

  it('shows the binary refusal note instead of rendering a binary diff', async () => {
    renderExplorer(
      [{ path: 'a.ts', statuses: ['unstaged'] }],
      [],
      { ok: false, code: 'binary-file', message: 'diff is unavailable for binary content' },
    )
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.diff: a.ts' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.diff: a.ts' }))
    await waitFor(() => { expect(screen.getByText('worktree.diffBinary')).toBeTruthy() })
  })
})
