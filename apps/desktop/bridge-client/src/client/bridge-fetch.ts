// Loopback bearer token for the desktop bridge routes.
//
// The shell appends `?dsh_token=...` to the navigation URL it serves; this
// module picks the token up once and attaches it to every bridge fetch. A
// plain browser (no token in the URL) leaves it unset and the requests stay
// exactly as before.

let loopbackToken: string | undefined

/**
 * Read the loopback token from the page URL once and cache it.
 * @returns the token, or undefined when the URL carries none.
 */
export function bridgeToken(): string | undefined {
  if (loopbackToken !== undefined) return loopbackToken
  const value = new URLSearchParams(window.location.search).get('dsh_token')
  loopbackToken = value === null ? undefined : value
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
