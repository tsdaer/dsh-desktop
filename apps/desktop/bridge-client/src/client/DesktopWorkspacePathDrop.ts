/** Document event used for Worktree-to-composer pointer drags. */
export const WORKTREE_PATH_POINTER_EVENT = 'dsh-worktree-path-pointerdown'

/** Validate a browser-supplied Worktree path as a Workspace-relative path. */
export function normalizeWorktreePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.replaceAll('\\', '/').trim()
  const hasInvalidSegment = path.split('/').some(part => part.length === 0 || part === '..')
  const hasAbsolutePrefix = path.startsWith('/') || /^[A-Za-z]:\//.test(path)
  if (path.length === 0 || hasAbsolutePrefix || hasInvalidSegment) return null
  return path
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

/** Format a Workspace-relative path for insertion into the composer draft. */
export function formatWorktreePath(path: string): string {
  return `./${path}`
}
