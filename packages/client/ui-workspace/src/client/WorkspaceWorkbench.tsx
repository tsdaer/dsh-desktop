/**
 * Workbench owner for the sidebar Workspace region. It owns only the
 * Workspace/Worktree presentation choice; mode content is supplied through
 * child slots so filesystem features do not become part of the Workspace
 * browser plugin.
 */
import { useState } from 'react'
import type { WorkspaceWorkbenchProps } from './contract/slots.ts'
import css from './WorkspaceWorkbench.module.css'

type Mode = 'workspace' | 'worktree'

/** Render the persistent sidebar mode switch and its selected child slot. */
export function WorkspaceWorkbench({ wide, expandSidebar, renderSlot, t }: WorkspaceWorkbenchProps) {
  const [mode, setMode] = useState<Mode>('workspace')
  const selectedChild = mode === 'workspace'
    ? 'sidebar.workspaces.workspace'
    : 'sidebar.workspaces.worktree'
  return (
    <section className={`${css.root}${wide ? '' : ` ${css.rail}`}`} aria-label={t('section.workspaces')}>
      <div className={css.modeTabs} role="tablist" aria-label={t('mode.label')}>
        {(['workspace', 'worktree'] as const).map(entry => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={mode === entry}
            aria-controls={`sidebar-workspaces-${entry}`}
            className={`${css.modeTab}${mode === entry ? ` ${css.modeTabSelected}` : ''}`}
            onClick={() => { setMode(entry) }}
          >
            {t(`mode.${entry}`)}
          </button>
        ))}
      </div>
      <div id={`sidebar-workspaces-${mode}`} className={css.content} role="tabpanel">
        {renderSlot(selectedChild, { wide, expandSidebar }, {
          fallback: mode === 'worktree' ? <p className={css.empty}>{t('worktree.empty')}</p> : undefined,
        })}
      </div>
    </section>
  )
}
