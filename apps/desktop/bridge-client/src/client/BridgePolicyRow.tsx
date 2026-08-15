// Bridge policy row in the dsh settings page (settings.general.item):
// extension allowlist + size cap, persisted through the shell's settings
// store (tauri-plugin-store). The bridge host reads the store file per
// request, so saves apply immediately.
import { useEffect, useState } from 'react'
import css from './BridgePolicyRow.module.css'

/** Effective policy as served by the bridge host. */
interface PolicyValues {
  allowedExtensions: string[]
  maxBytes: number
}

const FALLBACK: PolicyValues = { allowedExtensions: [], maxBytes: 50 * 1024 * 1024 }









/**
 * Render the bridge policy row.
 * @returns the row element tree (local state only; no store needed).
 */
/** Injected write callback: one durable settings field write. */
export type PolicyWriter = (field: string, value: unknown) => Promise<void>

/**
 * Render the bridge policy row.
 * @param props - injected policy scope (durable settings write handle).
 * @returns the row element tree.
 */
export function BridgePolicyRow({ setPolicy }: { setPolicy: PolicyWriter }): React.ReactElement {
  const [exts, setExts] = useState('')
  const [mb, setMb] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let alive = true
    void fetch('/dsh-bridge/config').then(r => r.json()).then((c) => {
      if (!alive) return
      const policy: PolicyValues = {
        allowedExtensions: Array.isArray(c.allowedExtensions) ? c.allowedExtensions : FALLBACK.allowedExtensions,
        maxBytes: typeof c.maxBytes === 'number' ? c.maxBytes : FALLBACK.maxBytes,
      }
      setExts(policy.allowedExtensions.join(', '))
      setMb(String(Math.round(policy.maxBytes / 1048576)))
    }).catch(() => { /* keep empty fields */ })
    return () => { alive = false }
  }, [])

  const save = (): void => {
    const allowedExtensions = exts.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const parsed = Number(mb)
    const maxBytes = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1048576) : FALLBACK.maxBytes
    setStatus('保存中…')
    setPolicy('allowedExtensions', allowedExtensions)
      .then(() => setPolicy('maxBytes', maxBytes))
      .then(() => setStatus('已保存'))
      .catch(err => setStatus('保存失败: ' + String(err)))
  }

  return (
    <div className={css.row}>
      <div className={css.title}>拖放策略</div>
      <div className={css.field}>
        <label className={css.label}>允许的后缀（逗号分隔，留空=全部）</label>
        <input className={css.input} value={exts} onChange={e => setExts(e.target.value)} placeholder="md, txt, pdf" />
      </div>
      <div className={css.field}>
        <label className={css.label}>最大文件大小（MB）</label>
        <input className={css.input} type="number" min={1} value={mb} onChange={e => setMb(e.target.value)} />
      </div>
      <div className={css.actions}>
        <button className={css.save} type="button" onClick={save}>保存</button>
        <span className={css.status}>{status}</span>
      </div>
    </div>
  )
}
