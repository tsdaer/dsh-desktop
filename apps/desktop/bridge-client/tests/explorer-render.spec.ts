import { createElement } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  localStorage.clear()
})

describe('desktop Explorer render lifecycle', () => {
  it('keeps its hook order when the first Workspace appears', async () => {
    const workspaces = mutableSource<{
      items: readonly { workspaceId: string; title: string; sessionIds: readonly string[] }[]
    }>({ items: [] })
    const sessions = mutableSource({ current: undefined as string | undefined })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/source-control')) return new Response(JSON.stringify({ workspaceId: 'workspace-1', state: 'not-repository', entries: [], truncated: false }))
      return new Response(JSON.stringify({ workspaceId: 'workspace-1', path: '', entries: [], truncated: false }))
    }))
    render(createElement(DesktopWorkspaceExplorer, { workspaces, sessions, t: (key: string) => key }))
    expect(screen.getByText('worktree.noWorkspace')).toBeTruthy()
    await act(async () => { workspaces.update({ items: [{ workspaceId: 'workspace-1', title: 'Workspace', sessionIds: [] }] }) })
    await waitFor(() => { expect(screen.getByText('worktree.emptyDirectory')).toBeTruthy() })
  })

  it('loads sibling directories without cancelling either request', async () => {
    const workspaces = mutableSource({ items: [{ workspaceId: 'workspace-1', title: 'Workspace', sessionIds: [] }] })
    const sessions = mutableSource({ current: undefined as string | undefined })
    const directorySignals = new Map<string, AbortSignal>()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'http://desktop.test')
      if (url.pathname.endsWith('/source-control')) return new Response(JSON.stringify({ workspaceId: 'workspace-1', state: 'not-repository', entries: [], truncated: false }))
      const path = url.searchParams.get('path') ?? ''
      if (path === '') return new Response(JSON.stringify({ workspaceId: 'workspace-1', path: '', entries: [
        { name: 'a', path: 'a', type: 'directory', expandable: true },
        { name: 'b', path: 'b', type: 'directory', expandable: true },
      ], truncated: false }))
      directorySignals.set(path, init?.signal as AbortSignal)
      return await new Promise<Response>(() => {})
    }))
    const view = render(createElement(DesktopWorkspaceExplorer, { workspaces, sessions, t: (key: string) => key }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'worktree.expand: a' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'worktree.expand: a' }))
    fireEvent.click(screen.getByRole('button', { name: 'worktree.expand: b' }))
    await waitFor(() => { expect(directorySignals.size).toBe(2) })
    expect(directorySignals.get('a')?.aborted).toBe(false)
    expect(directorySignals.get('b')?.aborted).toBe(false)
    view.unmount()
  })
})
