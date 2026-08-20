import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import css from './DesktopWorkspaceWorkbench.module.css'
import { DesktopWorkspaceSearch } from './DesktopWorkspaceSearch.tsx'

interface WorkspaceSource {
  list: {
    getSnapshot(): { items: readonly WorkspaceSummary[]; recentWorkspaceId?: string }
    subscribe(listener: () => void): () => void
  }
  openPath?(path: string): Promise<void>
}

interface WorkspaceSummary {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

interface SessionSource {
  list: {
    getSnapshot(): { current: string | undefined }
    subscribe(listener: () => void): () => void
  }
}

interface DesktopWorkspaceWorkbenchProps {
  wide: boolean
  t: (key: string) => string
  workspaces: WorkspaceSource
  sessions: SessionSource
}

type Mode = 'workspace' | 'worktree'

function ModeIcon({ mode }: { mode: Mode }): React.ReactElement {
  if (mode === 'workspace') {
    return (
      <svg className={css.modeIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.25 4.75h4l1.25-1.5h6.25v9.5H2.25v-8Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M2.25 6.25h11.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className={css.modeIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2.5h7l3 3v8H3v-11Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M10 2.5v3h3M5.25 8h5.5M5.25 10.5h5.5M5.25 13h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Add the desktop-only Workspace/Worktree switch without replacing the shared Workspace plugin. */
export function DesktopWorkspaceWorkbench({ wide, t, workspaces, sessions }: DesktopWorkspaceWorkbenchProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [region, setRegion] = useState<HTMLElement | null>(null)
  const [mode, setMode] = useState<Mode>('workspace')
  // The Worktree panel needs the wide column, so the collapsed rail keeps the
  // shared browser: hiding the browser is tied to the panel actually rendering.
  const showWorktree = wide && mode === 'worktree'

  useLayoutEffect(() => {
    const candidate = anchor.current?.ownerDocument.querySelector('[data-slot="sidebar.workspaces"]')
    setRegion(candidate instanceof HTMLElement ? candidate : null)
  }, [])

  useLayoutEffect(() => {
    if (region === null) return
    const browser = [...region.children].find(child => !child.hasAttribute('data-dsh-desktop-workbench'))
    if (!(browser instanceof HTMLElement)) return
    const previousDisplay = browser.style.display
    browser.style.display = showWorktree ? 'none' : previousDisplay
    return () => { browser.style.display = previousDisplay }
  }, [showWorktree, region])

  const workbench = (
    <div
      className={`${css.root}${showWorktree ? ` ${css.worktree}` : ''}`}
      data-dsh-desktop-workbench=""
    >
      <div className={`${css.modeTabs}${wide ? '' : ` ${css.rail}`}`} role="tablist" aria-label={t('workbench.modeLabel')}>
        {(['workspace', 'worktree'] as const).map(entry => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={mode === entry}
            aria-controls={`desktop-workbench-${entry}`}
            className={`${css.modeTab}${mode === entry ? ` ${css.modeTabSelected}` : ''}`}
            onClick={() => { setMode(entry) }}
          >
            <span className={css.modeTabLabel}>
              {wide ? t(`workbench.${entry}`) : <ModeIcon mode={entry} />}
            </span>
          </button>
        ))}
      </div>
      {showWorktree && (
        <div id="desktop-workbench-worktree" className={css.worktreePanel} role="tabpanel">
          <DesktopWorkspaceSearch workspaces={workspaces} sessions={sessions} t={t} />
        </div>
      )}
    </div>
  )

  return (
    <>
      <span ref={anchor} className={css.anchor} aria-hidden="true" />
      {region === null ? null : createPortal(workbench, region)}
    </>
  )
}

/** Bind the desktop runtime sources once while preserving the slot owner props. */
export function createDesktopWorkspaceWorkbench(workspaces: WorkspaceSource, sessions: SessionSource) {
  return function BoundDesktopWorkspaceWorkbench(props: Omit<DesktopWorkspaceWorkbenchProps, 'workspaces' | 'sessions'>): React.ReactElement {
    return <DesktopWorkspaceWorkbench {...props} workspaces={workspaces} sessions={sessions} />
  }
}
