import { normalizeWorktreePath } from './DesktopWorkspacePathDrop.ts'

interface TauriLike {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  }
}

function getTauri(): TauriLike | undefined {
  return (window as unknown as { __TAURI__?: TauriLike }).__TAURI__
}

/** Request one native preview window for a validated Workspace-relative file.
 * @param workspaceId - Registered Workspace id.
 * @param path - Workspace-relative file path.
 * @returns true when the native command accepted the request; false when the
 * browser is not running in Tauri or the native window cannot be opened.
 */
export async function openWorkspaceFilePreview(workspaceId: string, path: string): Promise<boolean> {
  const normalized = normalizeWorktreePath(path)
  const tauri = getTauri()
  if (normalized === null || tauri?.core === undefined) return false
  try {
    await tauri.core.invoke('open_file_preview', {
      workspaceId,
      path: normalized,
      locale: document.documentElement.lang || 'en',
    })
    return true
  } catch {
    return false
  }
}
