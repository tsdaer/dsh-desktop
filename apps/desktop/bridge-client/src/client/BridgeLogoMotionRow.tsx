// Desktop-only opt-in for the New Session Logo hover animation. The explicit
// setting is allowed to override the system reduced-motion preference because
// the user chose this one small, nonessential animation directly.
import { useEffect, useState } from 'react'
import { readBridgeConfig, saveBridgePolicy } from './bridge-fetch.ts'
import css from './BridgeRow.module.css'

/** Injected callback that applies the Logo-motion preference to the page. */
export type LogoMotionWriter = (enabled: boolean) => void

/** Component props: the Logo-motion writer and locale translate seat. */
interface BridgeLogoMotionRowProps {
  onLogoMotion: LogoMotionWriter
  t: (key: string) => string
}

/**
 * Render the desktop Logo-motion setting row.
 * @param props - injected Logo-motion writer and locale translate seat.
 * @returns the row element tree.
 */
export function BridgeLogoMotionRow({ onLogoMotion, t }: BridgeLogoMotionRowProps): React.ReactElement {
  const [logoMotion, setLogoMotion] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let alive = true
    void readBridgeConfig().then((c) => {
      if (!alive) return
      setLogoMotion(c.logoMotion === true)
    }).catch(() => { /* keep the default */ })
    return () => { alive = false }
  }, [])

  const changeLogoMotion = (enabled: boolean): void => {
    setLogoMotion(enabled)
    setStatus(t('saving'))
    void saveBridgePolicy({ logoMotion: enabled }).then(() => {
      onLogoMotion(enabled)
      setStatus('')
    }).catch(err => setStatus(t('saveFailed') + String(err)))
  }

  return (
    <div className={css.row}>
      <div className={css.title}>{t('logoMotion.title')}</div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={logoMotion}
          onChange={e => changeLogoMotion(e.target.checked)}
        />
        <span>{t('logoMotion.toggle')}</span>
      </label>
      <div className={css.actions}>
        <span className={css.status}>{status}</span>
      </div>
      <p className={css.hint}>{t('logoMotion.hint')}</p>
    </div>
  )
}
