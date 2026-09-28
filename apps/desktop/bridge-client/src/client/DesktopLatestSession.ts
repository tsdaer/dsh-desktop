/**
 * The most recently updated open Session, derived from the Host catalog.
 *
 * 0.1.7 removed the list's `current` field (navigation belongs to view
 * owners), and the desktop panels only need "the workspace the user is
 * working in", which the catalog's latest `updatedAt` row answers.
 * @param list - the sessions list snapshot (ids are the Host-list members).
 * @returns the newest Session id, or undefined while the catalog is empty.
 */
export function latestSessionId(
  list: { ids: readonly string[]; byId: Record<string, { updatedAt?: number }> },
): string | undefined {
  let latest: string | undefined
  let latestAt = Number.NEGATIVE_INFINITY
  for (const id of list.ids) {
    const at = list.byId[id]?.updatedAt ?? 0
    if (at >= latestAt) {
      latestAt = at
      latest = id
    }
  }
  return latest
}
