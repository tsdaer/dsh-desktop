/** Document event used for Worktree-to-composer pointer drags. */
export const WORKTREE_PATH_POINTER_EVENT = 'dsh-worktree-path-pointerdown'

/** Validate a browser-supplied Worktree path as a Workspace-relative path. */
export function normalizeWorktreePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (path.length === 0 || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/u.test(path)) return null
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part.length === 0) return null
    if (part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? null : parts.join('/')
}

/** Dispatch the internal pointer-drag start without invoking the browser or Tauri file-drop channel. */
export function dispatchWorktreePathPointerDown(
  target: HTMLElement,
  event: { pointerId: number; clientX: number; clientY: number },
  path: string,
): void {
  const normalized = normalizeWorktreePath(path)
  if (normalized === null) return
  target.ownerDocument.dispatchEvent(new CustomEvent(WORKTREE_PATH_POINTER_EVENT, {
    detail: { path: normalized, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY },
  }))
}

/** Format a normalized Workspace-relative path for insertion into the composer draft. */
export function formatWorktreePath(path: string): string {
  return path
}
