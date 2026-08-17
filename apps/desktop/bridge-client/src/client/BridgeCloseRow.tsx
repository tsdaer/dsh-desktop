// Close-behavior row in the dsh settings page (settings.bridge.item):
// whether the title-bar close button really exits or hides to the system
// tray. Persisted through the bridge host route (the dsh configuration
// boundary refuses browser writes to non-listed namespaces, so saves POST
// to /dsh-bridge/policy and the host writes settings in-process); the
// shell-side close interception is mirrored through the injected
// onCloseToTray callback.
import { useEffect, useState } from 'react'
import css from './BridgeRow.module.css'

/** Injected callback: apply the new close-to-tray state in the shell right away. */
export type CloseToTrayWriter = (enabled: boolean) => void

/** Component props: the close-to-tray writer and the locale translate seat. */
interface BridgeCloseRowProps {
  onCloseToTray: CloseToTrayWriter
  t: (key: string) => string
}

/**
 * Render the close-behavior row.
 * @param props - injected close-to-tray writer + locale translate seat.
 * @returns the row element tree.
 */
export function BridgeCloseRow({ onCloseToTray, t }: BridgeCloseRowProps): React.ReactElement {
  const [closeToTray, setCloseToTray] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let alive = true
    void fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
      if (!alive) return
      setCloseToTray(c.closeToTray === true)
    }).catch(() => { /* keep default */ })
    return () => { alive = false }
  }, [])

  // Every toggle change persists immediately; the shell mirror follows right away.
  const changeCloseToTray = (enabled: boolean): void => {
    setCloseToTray(enabled)
    setStatus(t('saving'))
    void fetch('/dsh-bridge/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ closeToTray: enabled }),
    }).then(r => r.json()).then((resp) => {
      if (resp?.ok === true) {
        onCloseToTray(enabled)
        setStatus('')
      } else {
        setStatus(t('saveFailed') + String(resp?.error ?? 'unknown'))
      }
    }).catch(err => setStatus(t('saveFailed') + String(err)))
  }

  return (
    <div className={css.row}>
      <div className={css.title}>{t('close.title')}</div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={closeToTray}
          onChange={e => changeCloseToTray(e.target.checked)}
        />
        <span>{t('close.toggle')}</span>
      </label>
      <div className={css.actions}>
        <span className={css.status}>{status}</span>
      </div>
      <p className={css.hint}>{t('close.hint')}</p>
    </div>
  )
}
