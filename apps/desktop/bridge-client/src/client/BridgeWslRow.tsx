// WSL 2 environment card in the dsh settings page (settings.bridge.item4):
// read-only detection through the bridge host, explicit Enable Bash with
// WSL 2 action, distribution selection when needed, refresh, disable, and
// a Microsoft installation link for missing environments. The setting
// stores only {enabled, distribution} in the desktop settings namespace;
// this card never installs WSL, changes a distribution version, changes
// the Windows default distribution, or downloads a distribution.
import { useEffect, useState } from 'react'
import { bridgeFetch, saveBridgePolicy } from './bridge-fetch.ts'
import css from './BridgeRow.module.css'

/** One eligible WSL 2 distribution row from the bridge snapshot. */
interface WslDistribution {
  name: string
  default: boolean
  version: 1 | 2
}

/** The typed WSL readiness snapshot from /dsh-bridge/wsl/detect. */
interface WslSnapshot {
  state: 'not-installed' | 'no-distribution' | 'wsl1-only' | 'ready' | 'error'
  distributions: readonly WslDistribution[]
  defaultDistribution?: string
  error?: string
}

/** Component props: the locale translate seat. */
interface BridgeWslRowProps {
  t: (key: string) => string
}

/** Whether the current browser runs on Windows (wsl.exe exists there). */
function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform ?? '')
}

/**
 * Read the WSL snapshot from the bridge host.
 * @returns the typed snapshot, or null when the route is unavailable.
 */
async function readWslSnapshot(): Promise<WslSnapshot | null> {
  try {
    const response = await bridgeFetch('/dsh-bridge/wsl/detect')
    if (!response.ok) return null
    const value = await response.json() as WslSnapshot
    if (!['not-installed', 'no-distribution', 'wsl1-only', 'ready', 'error'].includes(value.state)) return null
    return value
  } catch {
    return null
  }
}

/**
 * Probe one distribution through the bridge host before enabling.
 * @param distribution - the selected distribution name.
 * @returns whether the distribution accepted a command.
 */
async function probeWslDistribution(distribution: string): Promise<boolean> {
  try {
    const response = await bridgeFetch(`/dsh-bridge/wsl/probe?distribution=${encodeURIComponent(distribution)}`, { method: 'POST' })
    if (!response.ok) return false
    const value = await response.json() as { ok?: unknown }
    return value.ok === true
  } catch {
    return false
  }
}

/**
 * Render the WSL environment card.
 * @param props - the locale translate seat.
 * @returns the card element tree, or null off Windows.
 */
export function BridgeWslRow({ t }: BridgeWslRowProps): React.ReactElement | null {
  const [snapshot, setSnapshot] = useState<WslSnapshot | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [distribution, setDistribution] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const snapshot = await readWslSnapshot()
      if (!alive) return
      setSnapshot(snapshot)
      if (snapshot?.state === 'ready') {
        setDistribution(snapshot.defaultDistribution ?? snapshot.distributions[0]?.name ?? '')
      }
    })()
    // The enabled/disable state comes from the bridge config read at bind;
    // re-read it here so the card reflects the durable value.
    void bridgeFetch('/dsh-bridge/config').then(r => r.json()).then((c: { wslEnabled?: unknown; wslDistribution?: unknown }) => {
      if (!alive) return
      if (c.wslEnabled === true) setEnabled(true)
      if (typeof c.wslDistribution === 'string' && c.wslDistribution.length > 0) setDistribution(c.wslDistribution)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!isWindows()) return null

  const refresh = (): void => {
    setBusy(true)
    void readWslSnapshot().then((next) => {
      setSnapshot(next)
      if (next?.state === 'ready' && next.defaultDistribution !== undefined) setDistribution(next.defaultDistribution)
    }).finally(() => setBusy(false))
  }

  const enable = async (): Promise<void> => {
    const current = distribution
    if (current.length === 0) {
      setStatus(t('wsl.noDistribution'))
      return
    }
    setBusy(true)
    setStatus(t('wsl.probing'))
    // Activation performs an execution probe inside the selected
    // distribution rather than trusting the inventory alone.
    const ok = await probeWslDistribution(current)
    if (!ok) {
      setStatus(t('wsl.probeFailed'))
      setBusy(false)
      return
    }
    await saveBridgePolicy({ wslEnabled: true, wslDistribution: current }).then(() => {
      setEnabled(true)
      setStatus(t('wsl.enabled'))
    }).catch((err: unknown) => setStatus(t('wsl.saveFailed') + String(err)))
    setBusy(false)
  }

  const disable = async (): Promise<void> => {
    setBusy(true)
    await saveBridgePolicy({ wslEnabled: false }).then(() => {
      setEnabled(false)
      setStatus(t('wsl.disabled'))
    }).catch((err: unknown) => setStatus(t('wsl.saveFailed') + String(err)))
    setBusy(false)
  }

  const openMicrosoftGuide = (): void => {
    window.open('https://learn.microsoft.com/windows/wsl/install', '_blank', 'noopener')
  }

  const state = snapshot?.state ?? 'error'
  const distributions = snapshot?.distributions ?? []
  return (
    <div className={css.row}>
      <div className={css.title}>{t('wsl.title')}</div>
      <p className={css.hint}>{t('wsl.hint')}</p>
      <div className={css.actions}>
        <span className={css.status}>{t(`wsl.state.${state}`)}</span>
        <button type="button" onClick={refresh} disabled={busy}>{t('wsl.refresh')}</button>
      </div>
      {state === 'ready' && (
        <div className={css.choiceGroup}>
          {distributions.length > 1 && (
            <label className={css.check}>
              <select value={distribution} onChange={e => setDistribution(e.target.value)} disabled={enabled}>
                {distributions.map(d => <option key={d.name} value={d.name}>{d.name}{d.default ? ' *' : ''}</option>)}
              </select>
            </label>
          )}
          {!enabled ? (
            <button type="button" onClick={() => void enable()} disabled={busy}>{t('wsl.enable')}</button>
          ) : (
            <button type="button" onClick={() => void disable()} disabled={busy}>{t('wsl.disable')}</button>
          )}
        </div>
      )}
      {(state === 'not-installed' || state === 'no-distribution' || state === 'wsl1-only') && (
        <button type="button" onClick={openMicrosoftGuide}>{t('wsl.installGuide')}</button>
      )}
      {state === 'error' && snapshot?.error !== undefined && (
        <p className={css.hint}>{snapshot.error}</p>
      )}
      <div className={css.actions}>
        <span className={css.status}>{status}</span>
      </div>
    </div>
  )
}
