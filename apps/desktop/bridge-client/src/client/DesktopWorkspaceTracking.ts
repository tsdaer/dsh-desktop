/**
 * Tracks the Workspace the user last navigated to, wrapped around the
 * UiWorkspace navigation methods. The workspace browser's click goes through
 * `openWorkspace`, which otherwise leaves no observable trace: the sessions
 * catalog only learns about the connected session afterwards, and the
 * navigation owner keeps its selection private.
 */

/** What the desktop panels read to pick the workspace to show. */
export interface TrackedWorkspaceSelection {
  /** The last workspace id passed to a navigation method, when known. */
  workspaceId?: string | undefined
  /** The last session id opened through a session-addressed navigation. */
  sessionId?: string | undefined
}

/** The slice of the UiWorkspace navigation face this tracker wraps. */
export interface WorkspaceNavigationLike {
  openWorkspace?(workspaceId: string, ...rest: never[]): unknown
  openSession?(sessionId: string, ...rest: never[]): unknown
  startSession?(workspaceId?: string, ...rest: never[]): unknown
  forkSession?(...rest: never[]): unknown
}

/** A bare observable over the tracked selection. */
export interface WorkspaceTrackingSource {
  getSnapshot(): TrackedWorkspaceSelection
  subscribe(listener: () => void): () => void
}

/** A tracking source that never selects; callers without a wrapped service use it. */
export const NO_WORKSPACE_TRACKING: WorkspaceTrackingSource = {
  getSnapshot: () => ({}),
  subscribe: () => () => undefined,
}

/**
 * Wrap the navigation methods so each call records the addressed workspace or
 * session before the original runs.
 * @param uiWorkspace - the client's UiWorkspace service instance.
 * @param workspaces - the Workspace Controller snapshot source, used to resolve
 *   a session-addressed navigation to its owning workspace.
 * @returns the tracking source the desktop panels subscribe to.
 */
export function installWorkspaceTracking(
  uiWorkspace: WorkspaceNavigationLike,
  workspaces: { getSnapshot(): { items: readonly { workspaceId: string; sessionIds: readonly string[] }[] } },
): WorkspaceTrackingSource {
  let snapshot: TrackedWorkspaceSelection = {}
  const listeners = new Set<() => void>()
  const publish = (next: TrackedWorkspaceSelection): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const trackWorkspace = (workspaceId: string): void =>
    publish({ workspaceId, sessionId: undefined })
  const trackSession = (sessionId: string): void => {
    const owner = workspaces.getSnapshot().items.find(item => item.sessionIds.includes(sessionId))
    publish({ workspaceId: owner?.workspaceId, sessionId })
  }

  const wrap = (name: 'openWorkspace' | 'openSession' | 'startSession' | 'forkSession', intercept: (args: unknown[]) => void): void => {
    const original = (uiWorkspace[name] as ((...args: never[]) => unknown) | undefined)?.bind(uiWorkspace)
    if (typeof original !== 'function') return
    ;(uiWorkspace as Record<string, unknown>)[name] = (...args: never[]): unknown => {
      intercept(args)
      return original(...args)
    }
  }

  wrap('openWorkspace', (args) => { if (typeof args[0] === 'string') trackWorkspace(args[0]) })
  wrap('openSession', (args) => { if (typeof args[0] === 'string') trackSession(args[0]) })
  wrap('startSession', (args) => { if (typeof args[0] === 'string') trackWorkspace(args[0]) })
  wrap('forkSession', (args) => { if (typeof args[0] === 'string') trackSession(args[0]) })

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
