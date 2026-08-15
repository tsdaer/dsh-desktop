// Debug-mode row in the dsh settings page (settings.bridge.item2):
// toggles the debug guard (right-click + devtools shortcuts). Persisted
// through the bridge host route like the drop policy; every change saves
// immediately (no save button) and the guard applies right away through
// the injected onDebugMode callback.
import { useEffect, useState } from 'react'
import css from './BridgePolicyRow.module.css'

/** Injected callback: apply the new debug-mode state right away. */
export type DebugModeWriter = (enabled: boolean) => void

/**
 * Render the debug-mode row.
 * @param props - injected debug-mode writer.
 * @returns the row element tree.
 */
export function BridgeDebugRow({ onDebugMode }: { onDebugMode: DebugModeWriter }): React.ReactElement {
  const [debugMode, setDebugMode] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let alive = true
    void fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
      if (!alive) return
      setDebugMode(c.debugMode === true)
    }).catch(() => { /* keep default */ })
    return () => { alive = false }
  }, [])

  // Every toggle change persists immediately; the guard follows right away.
  const changeDebugMode = (enabled: boolean): void => {
    setDebugMode(enabled)
    setStatus('保存中…')
    void fetch('/dsh-bridge/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ debugMode: enabled }),
    }).then(r => r.json()).then((resp) => {
      if (resp?.ok === true) {
        onDebugMode(enabled)
        setStatus('')
      } else {
        setStatus('保存失败: ' + String(resp?.error ?? 'unknown'))
      }
    }).catch(err => setStatus('保存失败: ' + String(err)))
  }

  return (
    <div className={css.row}>
      <div className={css.title}>调试模式</div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={debugMode}
          onChange={e => changeDebugMode(e.target.checked)}
        />
        <span>开启调试模式（关闭时禁用右键菜单和 F12 等调试快捷键）</span>
      </label>
      <div className={css.actions}>
        <span className={css.status}>{status}</span>
      </div>
    </div>
  )
}
