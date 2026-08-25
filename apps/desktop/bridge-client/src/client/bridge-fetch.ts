// Loopback bearer token for the desktop bridge routes.
//
// The shell appends `?dsh_token=...` to the navigation URL it serves; this
// module picks the token up once and attaches it to every bridge fetch. A
// plain browser (no token in the URL) leaves it unset and the requests stay
// exactly as before.

const loopbackToken = (() => {
  // Module-scope capture so the token is frozen before the first bridge
  // request; a non-browser import (node unit tests) simply sees no URL.
  const query = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('dsh_token')
  const token = query
    ?? (globalThis as { __DSH_LOOPBACK_TOKEN__?: unknown }).__DSH_LOOPBACK_TOKEN__
  return typeof token === 'string' && token.length > 0 ? token : undefined
})()

/**
 * Read the loopback token from the page URL once and cache it.
 * @returns the token, or undefined when the URL carries none.
 */
export function bridgeToken(): string | undefined {
  return loopbackToken
}

/**
 * Fetch with the loopback bearer token attached when one is configured.
 * @param input - the request URL.
 * @param init - request options; the authorization header is merged in.
 * @returns the fetch promise.
 */
export function bridgeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const token = bridgeToken()
  if (token === undefined) return fetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

/**
 * Read one bridge JSON response and preserve HTTP failures as useful errors.
 * @param input - the bridge request URL.
 * @param init - optional request method, headers, body, and signal.
 * @returns the parsed JSON value.
 */
export async function bridgeJson(input: string | URL | Request, init?: RequestInit): Promise<unknown> {
  const response = await bridgeFetch(input, init)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`desktop bridge request failed: HTTP ${response.status}${text.length > 0 ? `: ${text}` : ''}`)
  }
  if (text.length === 0) throw new Error('desktop bridge returned an empty response')
  return JSON.parse(text) as unknown
}

/** Desktop preferences returned by the bridge config route. */
export interface BridgeConfig {
  /** Whether the close action hides the window in the tray. */
  closeToTray: boolean
  /** Whether desktop debugging gestures remain enabled. */
  debugMode: boolean
  /** Whether Logo hover motion may override reduced-motion preference. */
  logoMotion: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Read and validate the desktop preference snapshot.
 * @returns the current desktop preferences.
 */
export async function readBridgeConfig(): Promise<BridgeConfig> {
  const value = await bridgeJson('/dsh-bridge/config')
  if (!isRecord(value)
    || typeof value.closeToTray !== 'boolean'
    || typeof value.debugMode !== 'boolean'
    || typeof value.logoMotion !== 'boolean') {
    throw new Error('desktop bridge returned an invalid config response')
  }
  return {
    closeToTray: value.closeToTray,
    debugMode: value.debugMode,
    logoMotion: value.logoMotion,
  }
}

/**
 * Persist one validated desktop preference update.
 * @param policy - fields to update in the desktop settings namespace.
 * @returns after the Host confirms persistence.
 */
export async function saveBridgePolicy(policy: Partial<BridgeConfig>): Promise<void> {
  const value = await bridgeJson('/dsh-bridge/policy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  })
  if (!isRecord(value) || value.ok !== true) {
    const detail = isRecord(value) && typeof value.error === 'string' ? value.error : 'invalid response'
    throw new Error(`desktop bridge rejected the settings update: ${detail}`)
  }
}
