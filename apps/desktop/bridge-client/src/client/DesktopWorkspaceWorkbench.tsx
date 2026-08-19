import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import css from './DesktopWorkspaceWorkbench.module.css'

interface DesktopWorkspaceWorkbenchProps {
  wide: boolean
  t: (key: string) => string
}

type Mode = 'workspace' | 'worktree'

/** Add the desktop-only Workspace/Worktree switch without replacing the shared Workspace plugin. */
export function DesktopWorkspaceWorkbench({ wide, t }: DesktopWorkspaceWorkbenchProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [region, setRegion] = useState<HTMLElement | null>(null)
  const [mode, setMode] = useState<Mode>('workspace')

  useLayoutEffect(() => {
    const candidate = anchor.current?.parentElement?.parentElement?.previousElementSibling
    setRegion(candidate instanceof HTMLElement ? candidate : null)
  }, [])

  useLayoutEffect(() => {
    if (region === null) return
    const browser = [...region.children].find(child => !child.hasAttribute('data-dsh-desktop-workbench'))
    if (!(browser instanceof HTMLElement)) return
    const previousDisplay = browser.style.display
    browser.style.display = mode === 'workspace' ? previousDisplay : 'none'
    return () => { browser.style.display = previousDisplay }
  }, [mode, region])

  const workbench = (
    <div
      className={`${css.root}${mode === 'worktree' ? ` ${css.worktree}` : ''}`}
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
            {t(`workbench.${entry}`)}
          </button>
        ))}
      </div>
      {mode === 'worktree' && (
        <div id="desktop-workbench-worktree" className={css.empty} role="tabpanel">
          {t('workbench.empty')}
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
