/** Desktop loopback token captured while the shell navigation URL is intact. */
const loopbackToken = (() => {
  const query = (globalThis as { location?: { search?: string } }).location?.search
  const token = query === undefined ? null : new URLSearchParams(query).get('dsh_token')
  // The browser-session gate redirects a token-bearing index request to clean
  // `/` after minting the session cookie, so by the time dynamic bundles load
  // location.search is token-free. The navigation timing entry keeps the
  // original navigation URL (the redirect chain's start), which still carries
  // the launch token the webserver expects on every route.
  const navigationStart = (globalThis as { performance?: { getEntriesByType?: (type: string) => { name?: string }[] } })
    .performance?.getEntriesByType?.('navigation')?.[0]?.name
  const fromNavigation = navigationStart === undefined
    ? undefined
    : new URL(navigationStart, 'http://dsh.invalid').searchParams.get('dsh_token') ?? undefined
  const captured = token ?? fromNavigation ?? (globalThis as { __DSH_LOOPBACK_TOKEN__?: unknown }).__DSH_LOOPBACK_TOKEN__
  return typeof captured === 'string' && captured.length > 0 ? captured : undefined
})()

/**
 * Return the per-boot desktop loopback token, when the page was launched with one.
 * @returns the captured token, or undefined outside the desktop token posture.
 */
export function getLoopbackToken(): string | undefined {
  return loopbackToken
}
