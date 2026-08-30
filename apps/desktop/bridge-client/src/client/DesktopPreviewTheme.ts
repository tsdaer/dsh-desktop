// Desktop file-preview theme relay.
//
// The file preview lives in its own Tauri WebView (a separate document), so
// it cannot see the main window's `body[data-ds-dark-theme]` attribute or
// alias-token variables. This controller forwards every resolved theme
// snapshot through the shell's `set_preview_theme` command; the shell
// broadcasts it to every live preview window, whose page applies the payload
// to its own DOM. The preview page keeps its own copy of the projection
// rules (it must not import the ui-layout presenter).

/** The theme snapshot fields the preview page needs. */
export interface PreviewThemeSnapshot {
  /** Resolved active color scheme — the presenter keys off this, never the id. */
  colorScheme: 'light' | 'dark'
  /** Conversation content font size in px. */
  fontSize: number
  /** Alias-layer token overrides for the active color scheme. */
  tokens: Record<string, string>
}

/** Minimal view of the theme service this controller consumes. */
interface ThemeLike {
  getTheme(): { active: { colorScheme: string; tokens: Record<string, string> }; fontSize: number }
}

/** Minimal view of the cordis context's event face this controller needs. */
interface EventsLike {
  on(event: 'theme/change', listener: (snapshot: unknown) => void): () => void
}

/** Narrow a theme snapshot to the fields the preview page renders. */
export function projectThemeSnapshot(value: unknown): PreviewThemeSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const active = record.active
  if (typeof active !== 'object' || active === null) return null
  const activeRecord = active as Record<string, unknown>
  const colorScheme = activeRecord.colorScheme
  const tokens = activeRecord.tokens
  if (colorScheme !== 'light' && colorScheme !== 'dark') return null
  if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) return null
  const fontSize = record.fontSize
  if (typeof fontSize !== 'number' || !Number.isInteger(fontSize)) return null
  return {
    colorScheme,
    fontSize,
    tokens: tokens as Record<string, string>,
  }
}

/**
 * Mount the theme relay: push the current snapshot once, then every
 * `theme/change` event on the cordis context. The shell command is
 * unavailable in a plain browser dev session, so failures are silent.
 * @param theme - the resolved theme service.
 * @param events - the cordis context's event face.
 * @param invoke - the Tauri core invoke, when running under the shell.
 * @returns the disposer removing the event listener.
 */
export function mountPreviewThemeRelay(
  theme: ThemeLike,
  events: EventsLike,
  invoke: ((command: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined,
): () => void {
  const push = (snapshot: unknown): void => {
    if (invoke === undefined) return
    const projected = projectThemeSnapshot(snapshot)
    if (projected === null) return
    void invoke('set_preview_theme', { snapshot: projected }).catch(() => {
      /* shell command unavailable: the preview keeps its own scheme */
    })
  }
  push(theme.getTheme())
  return events.on('theme/change', push)
}
