// Whole-file Source Control actions for the Worktree Explorer: per-row
// stage/unstage/discard buttons with an inline confirmation that names the
// file, a commit bar for the Workspace's staged entries, and a diff panel
// rendered through the shared DiffBlock presentation. All paths stay
// Workspace-relative; the Host owns every Git argument.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffBlock, type DiffBlockLabels, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { bridgeFetch } from './bridge-fetch.ts'
import css from './DesktopWorkspaceWorkbench.module.css'

/** One listed change, mirroring the Host projection (client-local copy). */
export interface SourceControlEntry {
  path: string
  statuses: readonly ('staged' | 'unstaged' | 'untracked' | 'conflicted' | 'renamed' | 'unsupported')[]
  oldPath?: string
}

/** The bounded status projection, client-local copy of the Host listing. */
export interface SourceControlListing {
  workspaceId: string
  state: 'repository' | 'not-repository' | 'unavailable'
  entries: readonly SourceControlEntry[]
  truncated: boolean
}

/** One bounded file diff projected by the Host. */
export interface SourceControlDiff {
  workspaceId: string
  path: string
  oldText: string | null
  newText: string
  truncatedOld: boolean
  truncatedNew: boolean
}

/** The diff panel state owned by the Explorer. */
export type SourceControlDiffView =
  | { status: 'loading'; path: string }
  | { status: 'ready'; diff: SourceControlDiff }
  | { status: 'error'; path: string; message: string }

export interface SourceControlActions {
  /** Classified listing entries by Workspace-relative path. */
  entryByPath: ReadonlyMap<string, SourceControlEntry>
  /** Path with an in-flight mutation (all action buttons disable meanwhile). */
  busyPath: string | null
  /** Path awaiting the destructive discard confirmation. */
  confirmPath: string | null
  /** Last mutation failure message, or null. */
  error: string | null
  requestStage(path: string): void
  requestUnstage(path: string): void
  /** Enter the destructive discard confirmation for one path. */
  requestDiscard(path: string): void
  /** Leave the discard confirmation without mutating. */
  cancelDiscard(): void
  /** Run the confirmed destructive discard. */
  confirmDiscard(): void
  commitMessage: string
  setCommitMessage(value: string): void
  commit(): void
  commitBusy: boolean
  commitError: string | null
  diff: SourceControlDiffView | null
  openDiff(path: string): void
  closeDiff(): void
}

/** Own the Source Control action state for one Workspace listing.
 * @param workspaceId - The selected Workspace (undefined before registration).
 * @param listing - The current status listing, or null while loading.
 * @param t - The desktop locale dictionary.
 * @param refresh - Re-fetch status and Explorer after a successful mutation.
 * @returns The action state and handlers.
 */
export function useSourceControlActions(
  workspaceId: string | undefined,
  listing: SourceControlListing | null,
  t: (key: string) => string,
  refresh: () => void,
): SourceControlActions {
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [confirmPath, setConfirmPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [commitBusy, setCommitBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [diff, setDiff] = useState<SourceControlDiffView | null>(null)
  const activeRequests = useRef(new Set<AbortController>())
  const activeDiffRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    setBusyPath(null)
    setConfirmPath(null)
    setError(null)
    setCommitBusy(false)
    setCommitError(null)
    setDiff(null)
    return () => {
      for (const controller of activeRequests.current) controller.abort()
      activeRequests.current.clear()
      activeDiffRequest.current?.abort()
      activeDiffRequest.current = null
    }
  }, [workspaceId])

  const entryByPath = useMemo(() => {
    const entries = new Map<string, SourceControlEntry>()
    if (listing?.state === 'repository') {
      for (const entry of listing.entries) entries.set(entry.path, entry)
    }
    return entries
  }, [listing])

  const runMutation = useCallback(async (path: string, operation: 'stage' | 'unstage' | 'discard'): Promise<void> => {
    if (workspaceId === undefined || busyPath !== null) return
    const controller = new AbortController()
    activeRequests.current.add(controller)
    setBusyPath(path)
    setError(null)
    try {
      const response = await bridgeFetch(`/dsh-bridge/worktree/source-control/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, path }),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      const body = await response.json() as unknown
      if (!response.ok) throw new Error(mutationError(body, t))
      setConfirmPath(null)
      refresh()
    } catch (reason: unknown) {
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : t('worktree.actionFailed'))
    } finally {
      activeRequests.current.delete(controller)
      if (!controller.signal.aborted) setBusyPath(null)
    }
  }, [busyPath, refresh, t, workspaceId])

  const requestStage = useCallback((path: string): void => { void runMutation(path, 'stage') }, [runMutation])
  const requestUnstage = useCallback((path: string): void => { void runMutation(path, 'unstage') }, [runMutation])
  const requestDiscard = useCallback((path: string): void => { setConfirmPath(path) }, [])
  const cancelDiscard = useCallback((): void => { setConfirmPath(null) }, [])
  const confirmDiscard = useCallback((): void => {
    if (confirmPath !== null) void runMutation(confirmPath, 'discard')
  }, [confirmPath, runMutation])

  const commit = useCallback((): void => {
    if (workspaceId === undefined || commitBusy) return
    const message = commitMessage.trim()
    if (message.length === 0) return
    const controller = new AbortController()
    activeRequests.current.add(controller)
    setCommitBusy(true)
    setCommitError(null)
    void (async () => {
      try {
        const response = await bridgeFetch('/dsh-bridge/worktree/source-control/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId, message }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const body = await response.json() as unknown
        if (!response.ok) throw new Error(mutationError(body, t))
        setCommitMessage('')
        refresh()
      } catch (reason: unknown) {
        if (controller.signal.aborted) return
        setCommitError(reason instanceof Error ? reason.message : t('worktree.commitFailed'))
      } finally {
        activeRequests.current.delete(controller)
        if (!controller.signal.aborted) setCommitBusy(false)
      }
    })()
  }, [commitBusy, commitMessage, refresh, t, workspaceId])

  const openDiff = useCallback((path: string): void => {
    if (workspaceId === undefined) return
    activeDiffRequest.current?.abort()
    const controller = new AbortController()
    activeDiffRequest.current = controller
    setDiff({ status: 'loading', path })
    void (async () => {
      try {
        const query = new URLSearchParams({ workspaceId, path })
        const response = await bridgeFetch(`/dsh-bridge/worktree/source-control/diff?${query.toString()}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        const body = await response.json() as unknown
        if (!response.ok) throw new Error(mutationError(body, t))
        setDiff({ status: 'ready', diff: parseDiff(body) })
      } catch (reason: unknown) {
        if (controller.signal.aborted) return
        setDiff({ status: 'error', path, message: reason instanceof Error ? reason.message : t('worktree.diffFailed') })
      } finally {
        if (activeDiffRequest.current === controller) activeDiffRequest.current = null
      }
    })()
  }, [t, workspaceId])

  const closeDiff = useCallback((): void => {
    activeDiffRequest.current?.abort()
    activeDiffRequest.current = null
    setDiff(null)
  }, [])

  return {
    entryByPath,
    busyPath,
    confirmPath,
    error,
    requestStage,
    requestUnstage,
    requestDiscard,
    cancelDiscard,
    confirmDiscard,
    commitMessage,
    setCommitMessage,
    commit,
    commitBusy,
    commitError,
    diff,
    openDiff,
    closeDiff,
  }
}

/** Per-row action buttons for one changed file, with the inline discard confirmation. */
export function SourceControlActionButtons({ entry, path, actions, t }: {
  entry: SourceControlEntry
  path: string
  actions: SourceControlActions
  t: (key: string) => string
}): React.ReactElement {
  const disabled = actions.busyPath !== null
  const stopDrag = (event: React.PointerEvent): void => { event.stopPropagation() }
  if (actions.confirmPath === path) {
    const untracked = entry.statuses.includes('untracked')
    const label = (untracked ? t('worktree.deleteConfirm') : t('worktree.discardConfirm')).replace('{path}', entry.path)
    return (
      <span className={css.sourceControlConfirm} onPointerDown={stopDrag}>
        <span className={css.sourceControlConfirmText}>{label}</span>
        <button type="button" className={css.sourceControlAction} disabled={disabled} onClick={(event) => { event.stopPropagation(); actions.confirmDiscard() }}>{t('worktree.discardYes')}</button>
        <button type="button" className={css.sourceControlAction} disabled={disabled} onClick={(event) => { event.stopPropagation(); actions.cancelDiscard() }}>{t('worktree.discardNo')}</button>
      </span>
    )
  }
  return (
    <span className={css.sourceControlActions} onPointerDown={stopDrag}>
      <button
        type="button"
        className={css.sourceControlAction}
        title={t('worktree.diff')}
        aria-label={`${t('worktree.diff')}: ${entry.path}`}
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); actions.openDiff(path) }}
      >
        {t('worktree.diff')}
      </button>
      {sourceControlOperationAllowed(entry, 'stage') ? (
        <button type="button" className={css.sourceControlAction} disabled={disabled} onClick={(event) => { event.stopPropagation(); actions.requestStage(path) }}>{t('worktree.stage')}</button>
      ) : null}
      {sourceControlOperationAllowed(entry, 'unstage') ? (
        <button type="button" className={css.sourceControlAction} disabled={disabled} onClick={(event) => { event.stopPropagation(); actions.requestUnstage(path) }}>{t('worktree.unstage')}</button>
      ) : null}
      {sourceControlOperationAllowed(entry, 'discard') ? (
        <button type="button" className={css.sourceControlAction} disabled={disabled} onClick={(event) => { event.stopPropagation(); actions.requestDiscard(path) }}>{t('worktree.discard')}</button>
      ) : null}
    </span>
  )
}

/** Commit bar for the Workspace's staged entries: staged count, message, commit. */
export function SourceControlCommitBar({ stagedCount, actions, t }: {
  stagedCount: number
  actions: SourceControlActions
  t: (key: string) => string
}): React.ReactElement {
  const canCommit = stagedCount > 0 && actions.commitMessage.trim().length > 0 && !actions.commitBusy
  return (
    <div className={css.sourceControlCommitBar}>
      <span className={css.sourceControlStagedCount}>{t('worktree.stagedCount').replace('{count}', String(stagedCount))}</span>
      <input
        className={css.sourceControlCommitInput}
        value={actions.commitMessage}
        onChange={(event) => { actions.setCommitMessage(event.target.value) }}
        placeholder={t('worktree.commitPlaceholder')}
        aria-label={t('worktree.commitPlaceholder')}
        maxLength={4096}
        disabled={actions.commitBusy}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); actions.commit() } }}
      />
      <button
        type="button"
        className={css.sourceControlCommitButton}
        disabled={!canCommit}
        title={stagedCount === 0 ? t('worktree.commitEmpty') : undefined}
        onClick={() => { actions.commit() }}
      >
        {actions.commitBusy ? t('worktree.committing') : t('worktree.commit')}
      </button>
      {actions.commitError === null ? null : <div className={css.sourceControlError} role="alert">{actions.commitError}</div>}
      {actions.error === null ? null : <div className={css.sourceControlError} role="alert">{actions.error}</div>}
    </div>
  )
}

/** Localized chrome for the shared DiffBlock presentation (desktop UI is Chinese). */
const DIFF_BLOCK_LABELS: DiffBlockLabels = {
  copy: '复制',
  copied: '已复制',
  collapseAria: '折叠差异',
  expandAria: hidden => `展开差异（隐藏 ${String(hidden)} 行）`,
  collapse: '折叠',
  expand: hidden => `展开剩余 ${String(hidden)} 行`,
  files: count => count === 1 ? '1 个文件' : `${String(count)} 个文件`,
}

/** Diff panel rendered through the shared DiffBlock presentation. */
export function SourceControlDiffPanel({ diff, t, onClose }: {
  diff: SourceControlDiffView
  t: (key: string) => string
  onClose(): void
}): React.ReactElement {
  const title = diff.status === 'loading'
    ? t('worktree.diffLoading')
    : diff.status === 'ready'
      ? diff.diff.path
      : diff.path
  const hunks: DiffHunk[] = diff.status === 'ready'
    ? [{ path: diff.diff.path, oldText: diff.diff.oldText, newText: diff.diff.newText }]
    : []
  const note = diff.status === 'ready' && (diff.diff.truncatedOld || diff.diff.truncatedNew)
    ? t('worktree.diffTruncated')
    : diff.status === 'error'
      ? diff.message
      : null
  return (
    <div className={css.sourceControlDiffPanel}>
      <div className={css.sourceControlDiffHeader}>
        <span className={css.sourceControlDiffTitle}>{title}</span>
        <button type="button" className={css.sourceControlAction} onClick={onClose}>{t('worktree.diffClose')}</button>
      </div>
      {diff.status === 'loading' ? <div className={css.explorerState}>{t('worktree.diffLoading')}</div> : null}
      {diff.status === 'ready' ? <div className={css.sourceControlDiffBody}><DiffBlock diffs={hunks} labels={DIFF_BLOCK_LABELS} /></div> : null}
      {note === null ? null : <div className={css.sourceControlError} role="alert">{note}</div>}
    </div>
  )
}

/** Localized mutation failure: stale listings and binary diffs get stable copy. */
function mutationError(body: unknown, t: (key: string) => string): string {
  if (typeof body !== 'object' || body === null) return t('worktree.actionFailed')
  const record = body as Record<string, unknown>
  if (record.code === 'binary-file') return t('worktree.diffBinary')
  if (record.code === 'stale-status' || record.code === 'operation-not-allowed') return t('worktree.staleStatus')
  if (record.code === 'git-failed' && typeof record.detail === 'string' && record.detail.length > 0) return record.detail
  return typeof record.message === 'string' ? record.message : t('worktree.actionFailed')
}

/** Validate the bounded diff projection before rendering it. */
export function parseDiff(value: unknown): SourceControlDiff {
  if (typeof value !== 'object' || value === null) throw new Error('Source Control returned an invalid diff')
  const record = value as Record<string, unknown>
  if (typeof record.workspaceId !== 'string'
    || typeof record.path !== 'string'
    || (record.oldText !== null && typeof record.oldText !== 'string')
    || typeof record.newText !== 'string'
    || typeof record.truncatedOld !== 'boolean'
    || typeof record.truncatedNew !== 'boolean') {
    throw new Error('Source Control returned an invalid diff')
  }
  return {
    workspaceId: record.workspaceId,
    path: record.path,
    oldText: record.oldText,
    newText: record.newText,
    truncatedOld: record.truncatedOld,
    truncatedNew: record.truncatedNew,
  }
}

/** Mirror of the Host operation matrix so the client offers only valid actions. */
function sourceControlOperationAllowed(entry: SourceControlEntry, operation: 'stage' | 'unstage' | 'discard'): boolean {
  if (entry.statuses.length === 0 || entry.statuses.every(status => status === 'unsupported')) return false
  if (operation === 'stage') return entry.statuses.some(status => status === 'unstaged' || status === 'untracked' || status === 'renamed')
  if (operation === 'unstage') return entry.statuses.includes('staged')
  return entry.statuses.some(status => status === 'unstaged' || status === 'untracked' || status === 'renamed')
}
