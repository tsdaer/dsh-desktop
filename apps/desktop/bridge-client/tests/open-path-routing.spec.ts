import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

/**
 * Explorer "open with dsh-desktop" routing: a forwarded directory must select
 * the owning Workspace's most recent Session (or start one) once both
 * baselines are ready, and offer Workspace registration otherwise. The store
 * snapshots follow the client-runtime contracts: workspaces expose the
 * `phase` lifecycle, sessions expose `ids`/`byId`/`current`.
 */

interface StoreHarness<T> {
  snapshot: T
  listeners: Set<() => void>
  source: {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
  }
}

function store<T>(initial: T): StoreHarness<T> {
  const harness: StoreHarness<T> = {
    snapshot: initial,
    listeners: new Set(),
    source: {
      getSnapshot: () => harness.snapshot,
      subscribe(listener: () => void) {
        harness.listeners.add(listener)
        return () => { harness.listeners.delete(listener) }
      },
    },
  }
  return harness
}

function flushStore(harness: StoreHarness<unknown>): void {
  for (const listener of [...harness.listeners]) listener()
}

function baseContext(workspacesPhase: 'pending' | 'ready' = 'pending') {
  const sessions = store({
    current: undefined as string | undefined,
    ids: ['s-recent', 's-older'] as readonly string[],
    byId: {
      's-recent': { updatedAt: 200 },
      's-older': { updatedAt: 100 },
    } as Record<string, { updatedAt?: number } | undefined>,
  })
  const workspaces = store({
    phase: workspacesPhase,
    items: [{
      workspaceId: 'wsp-1',
      path: 'C:\\demo',
      title: 'demo',
      sessionIds: ['s-older', 's-recent'] as readonly string[],
    }],
  })
  const opened: string[] = []
  const started: Array<string | undefined> = []
  const ctx = {
    sessions: {
      list: sessions.source,
      open(id: string): void { opened.push(id) },
    },
    workspaces: {
      list: workspaces.source,
      create: vi.fn(async ({ path }: { path: string }) => ({ workspaceId: 'wsp-new', path, title: 'new', sessionIds: [] })),
    },
    uiWorkspace: {
      startSession(workspaceId?: string): void { started.push(workspaceId) },
    },
    slots: {
      inject(): void {},
      register(): void {},
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    theme: {
      getTheme: () => ({ active: { colorScheme: 'dark', tokens: {} }, fontSize: 14 }),
    },
    on: () => () => {},
  }
  return { ctx, sessions, workspaces, opened, started }
}

/** Install the Tauri shims the open-path flow binds against, and capture the drain trigger. */
function stubTauri(paths: string[]): { drained: Promise<void> } {
  let notifyDrain: () => void = () => {}
  const drained = new Promise<void>((resolve) => { notifyDrain = resolve })
  let pending = paths
  vi.stubGlobal('__TAURI_INTERNALS__', {})
  vi.stubGlobal('__TAURI__', {
    event: {
      listen: (_name: string, handler: () => void) => {
        void Promise.resolve().then(() => {
          handler()
          notifyDrain()
        })
        return Promise.resolve(() => {})
      },
    },
    core: {
      // The shell command drains the queue: serve once, then report empty.
      invoke: (command: string) => command === 'take_open_paths'
        ? Promise.resolve(pending.length > 0 ? pending.splice(0) : [])
        : Promise.resolve(undefined),
    },
  })
  return { drained }
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no bridge in tests'))))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop Explorer open-path routing', () => {
  it('opens the owning Workspace most recent session once baselines are ready', async () => {
    const { ctx, opened, started } = baseContext('ready')
    const { drained } = stubTauri(['C:\\demo'])
    const dispose = apply(ctx as never)
    try {
      await drained
      await vi.waitFor(() => expect(opened).toEqual(['s-recent']))
      expect(started).toEqual([])
    } finally {
      dispose()
    }
  })

  it('waits for the pending workspace baseline before routing', async () => {
    const { ctx, workspaces, opened } = baseContext()
    const { drained } = stubTauri(['C:\\demo'])
    const dispose = apply(ctx as never)
    try {
      await drained
      await Promise.resolve()
      expect(opened).toEqual([])
      workspaces.snapshot = { ...workspaces.snapshot, phase: 'ready' }
      flushStore(workspaces)
      await vi.waitFor(() => expect(opened).toEqual(['s-recent']))
    } finally {
      dispose()
    }
  })

  it('offers Workspace registration for an unowned directory and starts its session', async () => {
    const { ctx, started, workspaces } = baseContext()
    workspaces.snapshot = { ...workspaces.snapshot, phase: 'ready' }
    vi.stubGlobal('alert', () => {})
    // Confirm the registration dialog by clicking the add action.
    const { drained } = stubTauri(['C:\\unowned'])
    const dispose = apply(ctx as never)
    try {
      await drained
      const add = await vi.waitFor(() => {
        const button = [...document.querySelectorAll('button')].find(
          candidate => candidate.textContent === 'workspace.add',
        )
        if (button === undefined) throw new Error('registration dialog not shown yet')
        return button
      })
      add.click()
      await vi.waitFor(() => expect(started).toEqual(['wsp-new']))
    } finally {
      dispose()
    }
  })
})
