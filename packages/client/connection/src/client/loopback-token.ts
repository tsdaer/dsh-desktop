/** Desktop loopback token captured while the shell navigation URL is intact. */
const loopbackToken = (() => {
  const query = (globalThis as { location?: { search?: string } }).location?.search
  const token = query === undefined ? null : new URLSearchParams(query).get('dsh_token')
  const captured = token ?? (globalThis as { __DSH_LOOPBACK_TOKEN__?: unknown }).__DSH_LOOPBACK_TOKEN__
  return typeof captured === 'string' && captured.length > 0 ? captured : undefined
})()

/**
 * Return the per-boot desktop loopback token, when the page was launched with one.
 * @returns the captured token, or undefined outside the desktop token posture.
 */
export function getLoopbackToken(): string | undefined {
  return loopbackToken
}
