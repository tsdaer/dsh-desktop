// Bridge policy row in the dsh settings page (settings.bridge.item):
// copy-on-drop toggle + size cap, persisted through the dsh settings
// system ($DSH_HOME/settings.yaml) via the bridge host route. The dsh
// configuration boundary refuses browser writes to non-listed namespaces,
// so changes POST to /dsh-bridge/policy and the host writes settings
// in-process. Every change saves immediately: the toggle on change, the
// size input after a short quiet period (no save button).
import { useEffect, useRef, useState } from 'react'
import css from './BridgePolicyRow.module.css'

/** Effective policy as served by the bridge host. */
interface PolicyValues {
  copyEnabled: boolean
  maxBytes: number
}

const FALLBACK: PolicyValues = { copyEnabled: true, maxBytes: 50 * 1024 * 1024 }

/** Quiet period before the size input persists (ms). */
const SIZE_DEBOUNCE_MS = 500

/** Component props: the locale-following translate seat. */
interface BridgePolicyRowProps {
  t: (key: string) => string
}

/**
 * Render the bridge policy row.
 * @param props - the locale translate seat.
 * @returns the row element tree.
 */
export function BridgePolicyRow({ t }: BridgePolicyRowProps): React.ReactElement {
  const [copyEnabled, setCopyEnabled] = useState(true)
  const [mb, setMb] = useState('')
  const [status, setStatus] = useState('')
  // Track the latest parsed size so a debounced write always persists the
  // newest field value even when the input changed again meanwhile.
  const lastMaxBytes = useRef(FALLBACK.maxBytes)
  const debounceRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
      if (!alive) return
      const policy: PolicyValues = {
        copyEnabled: typeof c.copyEnabled === 'boolean' ? c.copyEnabled : FALLBACK.copyEnabled,
        maxBytes: typeof c.maxBytes === 'number' ? c.maxBytes : FALLBACK.maxBytes,
      }
      setCopyEnabled(policy.copyEnabled)
      setMb(String(Math.round(policy.maxBytes / 1048576)))
      lastMaxBytes.current = policy.maxBytes
    }).catch(() => { /* keep defaults */ })
    return () => {
      alive = false
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
    }
  }, [])

  /** Persist one policy write and surface failures; the toggle is optimistic. */
  const persist = (next: { copyEnabled?: boolean; maxBytes?: number }): void => {
    setStatus(t('saving'))
    void fetch('/dsh-bridge/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).then(r => r.json()).then((resp) => {
      setStatus(resp?.ok === true ? '' : t('saveFailed') + String(resp?.error ?? 'unknown'))
    }).catch(err => setStatus(t('saveFailed') + String(err)))
  }

  // Toggle saves on every change; no debounce needed for a boolean.
  const changeCopyEnabled = (enabled: boolean): void => {
    setCopyEnabled(enabled)
    persist({ copyEnabled: enabled })
  }

  // The size input persists after a quiet period so typing does not write
  // per keystroke.
  const changeMaxBytes = (value: string): void => {
    setMb(value)
    if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
    const parsed = Number(value)
    const maxBytes = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1048576) : lastMaxBytes.current
    lastMaxBytes.current = maxBytes
    debounceRef.current = window.setTimeout(() => persist({ maxBytes }), SIZE_DEBOUNCE_MS)
  }

  return (
    <div className={css.row}>
      <div className={css.title}>{t('policy.title')}</div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={copyEnabled}
          onChange={e => changeCopyEnabled(e.target.checked)}
        />
        <span>{t('policy.copy')}</span>
      </label>
      <div className={css.field}>
        <label className={css.label}>{t('policy.maxSize')}</label>
        <input className={css.input} type="number" min={1} value={mb} onChange={e => changeMaxBytes(e.target.value)} />
      </div>
      <div className={css.actions}>
        <span className={css.status}>{status}</span>
      </div>
      <p className={css.hint}>{t('policy.hint')}</p>
    </div>
  )
}
