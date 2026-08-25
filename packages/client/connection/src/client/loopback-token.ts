/** Desktop loopback token captured while the shell navigation URL is intact. */
const loopbackToken = (() => {
  const query = (globalThis as { location?: { search?: string } }).location?.search
  if (query === undefined) return undefined
  return new URLSearchParams(query).get('dsh_token') ?? undefined
})()

/**
 * Return the per-boot desktop loopback token, when the page was launched with one.
 * @returns the captured token, or undefined outside the desktop token posture.
 */
export function getLoopbackToken(): string | undefined {
  return loopbackToken
}
