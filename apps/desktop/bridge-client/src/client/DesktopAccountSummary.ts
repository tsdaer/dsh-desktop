// Desktop title-bar account controller.
//
// Subscribes to the active session's identity, requests the provider-bound
// /dsh-bridge/account-summary route with the current session and provider
// plus a monotonic generation, and pushes each validated result to the
// title-bar mount point through the stable window event the titlebar script
// listens for. The Host owns provider resolution (the browser never
// dictates which provider is queried), so this controller's provider id is
// best-effort — the response carries the authoritative one and the controller
// uses it for the next request. An older response (stale generation, older
// session, other provider) never overwrites a newer selection.

/** The window event the title-bar script renders from. */
const ACCOUNT_EVENT = 'dsh://account-summary'
/** The window event the title-bar click dispatches to request a refresh. */
const ACCOUNT_REFRESH_REQUEST = 'dsh://account-summary-refresh'

/** Poll interval for the account summary. */
const ACCOUNT_REFRESH_MS = 5 * 60 * 1000
/** Abort an in-flight account request after this long. */
const ACCOUNT_TIMEOUT_MS = 8_000

/** The shape of one account-summary response. */
export interface AccountSummaryPayload {
  ok: boolean
  sessionId: string
  providerId: string
  generation: string
  state: 'available' | 'unsupported' | 'unconfigured' | 'unavailable' | 'checking'
  amount?: string
  currency?: string
  reason?: string
}

/** Minimal view of the client-runtime sessions list this controller consumes. */
interface AccountSessionsLike {
  list: {
    getSnapshot(): { current: string | undefined }
    subscribe(listener: () => void): () => void
  }
}

/** Minimal view of the client-runtime session-scoped model access. */
interface AccountModelSource {
  /** Read the current model selection for one session, when available. */
  getCurrentProvider(sessionId: string): string | undefined
}

/** The controller's dependencies, captured by the apply closure. */
export interface AccountControllerDeps {
  sessions: AccountSessionsLike
  /** Resolves the current provider for one session (best-effort browser view). */
  model: AccountModelSource
  /** Fetch the account-summary route (bridgeFetch). */
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  /** AbortSignal factory, injectable for tests. */
  signal: () => AbortSignal
}

/**
 * Mount the account controller: subscribe to session changes, refresh on
 * the title-bar click signal, poll periodically, and refresh on visibility.
 * @param deps - the captured dependencies.
 * @returns the disposer removing all listeners.
 */
export function mountAccountController(deps: AccountControllerDeps): () => void {
  let generation = 0
  let currentSession = deps.sessions.list.getSnapshot().current
  let inFlight: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const publish = (payload: AccountSummaryPayload): void => {
    window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, { detail: payload }))
  }

  const pushChecking = (): void => {
    publish({ ok: false, sessionId: currentSession ?? '', providerId: '', generation: String(generation), state: 'checking' })
  }

  const refresh = (): void => {
    if (disposed) return
    const sessionId = deps.sessions.list.getSnapshot().current
    if (sessionId === undefined) {
      // No active session: report unavailable so the title bar shows no stale amount.
      publish({ ok: false, sessionId: '', providerId: '', generation: String(generation), state: 'unavailable' })
      return
    }
    currentSession = sessionId
    generation += 1
    const requestGeneration = generation
    const providerId = deps.model.getCurrentProvider(sessionId) ?? ''
    const url = `/dsh-bridge/account-summary?sessionId=${encodeURIComponent(sessionId)}&providerId=${encodeURIComponent(providerId)}&generation=${requestGeneration}`
    // Cancel any older in-flight request: a newer selection wins.
    if (inFlight !== null) inFlight.abort()
    const controller = new AbortController()
    inFlight = controller
    pushChecking()
    const timeout = setTimeout(() => { controller.abort() }, ACCOUNT_TIMEOUT_MS)
    void deps.fetch(url, { signal: controller.signal })
      .then(response => response.json() as Promise<AccountSummaryPayload>)
      .then((payload) => {
        // An older response must never overwrite a newer selection.
        if (requestGeneration !== generation) return
        if (payload.sessionId !== sessionId) return
        publish(payload)
      })
      .catch(() => {
        if (requestGeneration !== generation) return
        publish({ ok: false, sessionId, providerId, generation: String(requestGeneration), state: 'unavailable', reason: 'network' })
      })
      .finally(() => {
        clearTimeout(timeout)
        if (inFlight === controller) inFlight = null
      })
  }

  const offSessions = deps.sessions.list.subscribe(() => {
    const next = deps.sessions.list.getSnapshot().current
    if (next !== currentSession) refresh()
  })
  const offRefreshRequest = (): void => {
    window.removeEventListener(ACCOUNT_REFRESH_REQUEST, refresh)
  }
  window.addEventListener(ACCOUNT_REFRESH_REQUEST, refresh)
  const offVisibility = (): void => {
    document.removeEventListener('visibilitychange', onVisibility)
  }
  const onVisibility = (): void => {
    if (!document.hidden) refresh()
  }
  document.addEventListener('visibilitychange', onVisibility)
  timer = setTimeout(function tick() {
    refresh()
    if (!disposed) timer = setTimeout(tick, ACCOUNT_REFRESH_MS)
  }, ACCOUNT_REFRESH_MS)

  refresh()

  return () => {
    disposed = true
    if (timer !== null) clearTimeout(timer)
    if (inFlight !== null) inFlight.abort()
    offSessions()
    offRefreshRequest()
    offVisibility()
  }
}
