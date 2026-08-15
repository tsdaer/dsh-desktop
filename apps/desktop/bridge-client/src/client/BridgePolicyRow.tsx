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

/**
 * Render the bridge policy row.
 * @returns the row element tree.
 */
export function BridgePolicyRow(): React.ReactElement {
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
    setStatus('保存中…')
    void fetch('/dsh-bridge/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).then(r => r.json()).then((resp) => {
      setStatus(resp?.ok === true ? '' : '保存失败: ' + String(resp?.error ?? 'unknown'))
    }).catch(err => setStatus('保存失败: ' + String(err)))
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
      <div className={css.title}>拖放策略</div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={copyEnabled}
          onChange={e => changeCopyEnabled(e.target.checked)}
        />
        <span>开启拖放复制（关闭时所有非图片文件只提供路径）</span>
      </label>
      <div className={css.field}>
        <label className={css.label}>最大文件大小（MB）</label>
        <input className={css.input} type="number" min={1} value={mb} onChange={e => changeMaxBytes(e.target.value)} />
      </div>
      <div className={css.actions}>
        <span className={css.status}>{status}</span>
      </div>
      <p className={css.hint}>图片始终直接进入输入框；开启复制时，未超限的文本文件会复制到 drops 文件夹（重复拖放会更新），二进制文件与超限文件只提供路径。</p>
    </div>
  )
}
