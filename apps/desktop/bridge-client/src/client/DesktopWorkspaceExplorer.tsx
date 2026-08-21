import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import css from './DesktopWorkspaceWorkbench.module.css'
import {
  SourceControlActionButtons,
  SourceControlCommitBar,
  SourceControlDiffPanel,
  useSourceControlActions,
  type SourceControlEntry,
  type SourceControlListing,
} from './DesktopSourceControlActions.tsx'
import { DesktopVirtualList } from './DesktopVirtualList.tsx'
import { dispatchWorktreePathPointerDown } from './DesktopWorkspacePathDrop.ts'
import { DesktopWorkspaceFileViewer } from './DesktopWorkspaceFileViewer.tsx'

type WorkspaceId = string

interface WorkspaceView {
  workspaceId: WorkspaceId
  title: string
  sessionIds: readonly string[]
}

interface WorkspaceSource {
  list: {
    getSnapshot(): { items: readonly WorkspaceView[]; recentWorkspaceId?: WorkspaceId }
    subscribe(listener: () => void): () => void
  }
}

interface SessionSource {
  list: {
    getSnapshot(): { current: string | undefined }
    subscribe(listener: () => void): () => void
  }
}

interface ExplorerProps {
  workspaces: WorkspaceSource
  sessions: SessionSource
  t: (key: string) => string
}

interface ExplorerEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'other'
  expandable: boolean
  outsideRoot?: true
  size?: number
}

interface ExplorerListing {
  workspaceId: string
  path: string
  entries: readonly ExplorerEntry[]
  truncated: boolean
}

type SourceControlStatus = 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'renamed' | 'unsupported'

type SourceControlState =
  | { status: 'loading' }
  | { status: 'ready'; listing: SourceControlListing }
  | { status: 'error' }

/** Git statuses aggregated for one file or its visible parent directory. */
export interface GitDecoration {
  statuses: readonly SourceControlStatus[]
  count: number
}

type NodeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; listing: ExplorerListing }

type VisibleRow =
  | { kind: 'entry'; key: string; entry: ExplorerEntry; depth: number; expanded: boolean }
  | { kind: 'state'; key: string; path: string; depth: number; status: 'loading' | 'empty' | 'truncated' | 'error'; message?: string }

function useSourceSnapshot<T extends { getSnapshot(): unknown; subscribe(listener: () => void): () => void }>(source: T): ReturnType<T['getSnapshot']> {
  const [snapshot, setSnapshot] = useState(() => source.getSnapshot())
  useEffect(() => source.subscribe(() => { setSnapshot(source.getSnapshot()) }), [source])
  return snapshot as ReturnType<T['getSnapshot']>
}

function chooseWorkspace(
  workspaces: readonly WorkspaceView[],
  current: string | undefined,
  recentWorkspaceId: WorkspaceId | undefined,
): WorkspaceView | undefined {
  return workspaces.find(workspace => current !== undefined && workspace.sessionIds.includes(current))
    ?? workspaces.find(workspace => workspace.workspaceId === recentWorkspaceId)
    ?? workspaces[0]
}

/** Render the bounded, lazy directory tree owned by the desktop Worktree view. */
export function DesktopWorkspaceExplorer({ workspaces: workspaceSource, sessions: sessionSource, t }: ExplorerProps): React.ReactElement {
  const workspaceSnapshot = useSourceSnapshot(workspaceSource.list)
  const sessionSnapshot = useSourceSnapshot(sessionSource.list)
  const workspace = chooseWorkspace(workspaceSnapshot.items, sessionSnapshot.current, workspaceSnapshot.recentWorkspaceId)
  const workspaceId = workspace?.workspaceId
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [expandedByWorkspace, setExpandedByWorkspace] = useState<Record<string, readonly string[]>>(() => readExpanded())
  const [sourceControl, setSourceControl] = useState<SourceControlState>({ status: 'loading' })
  const [sourceControlRefresh, setSourceControlRefresh] = useState(0)
  const [viewer, setViewer] = useState<{ path: string; line?: number } | null>(null)
  const requests = useRef(new Map<string, AbortController>())
  const openInViewer = useCallback((path: string, line?: number): void => { setViewer(line === undefined ? { path } : { path, line }) }, [])

  useEffect(() => {
    try { localStorage.setItem('dsh.desktop.explorer.expanded', JSON.stringify(expandedByWorkspace)) } catch { /* browser storage is optional */ }
  }, [expandedByWorkspace])

  const load = useCallback(async (path: string): Promise<void> => {
    if (workspaceId === undefined) return
    requests.current.get(path)?.abort()
    const controller = new AbortController()
    requests.current.set(path, controller)
    setNodes(previous => ({ ...previous, [path]: { status: 'loading' } }))
    try {
      const query = new URLSearchParams({ workspaceId, ...(path === '' ? {} : { path }) })
      const response = await fetch(`/dsh-bridge/worktree/explorer?${query.toString()}`, { signal: controller.signal })
      const body = await response.json() as unknown
      if (!response.ok) throw new Error(explorerError(body, t('worktree.explorerFailed')))
      const listing = parseListing(body)
      setNodes(previous => ({ ...previous, [path]: { status: 'ready', listing } }))
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      setNodes(previous => ({ ...previous, [path]: { status: 'error', message: error instanceof Error ? error.message : t('worktree.explorerFailed') } }))
    } finally {
      if (requests.current.get(path) === controller) requests.current.delete(path)
    }
  }, [t, workspaceId])

  useEffect(() => {
    for (const controller of requests.current.values()) controller.abort()
    requests.current.clear()
    setNodes({})
    setViewer(null)
    if (workspaceId !== undefined) void load('')
    return () => {
      for (const controller of requests.current.values()) controller.abort()
      requests.current.clear()
    }
  }, [load, workspaceId])

  useEffect(() => {
    if (workspaceId === undefined) return
    const controller = new AbortController()
    setSourceControl({ status: 'loading' })
    void fetch(`/dsh-bridge/worktree/source-control?${new URLSearchParams({ workspaceId })}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as unknown
        if (!response.ok) throw new Error('Git status request failed')
        return parseSourceControlListing(body)
      })
      .then((listing) => { setSourceControl({ status: 'ready', listing }) })
      .catch(() => { if (!controller.signal.aborted) setSourceControl({ status: 'error' }) })
    return () => { controller.abort() }
  }, [sourceControlRefresh, workspaceId])

  const refreshSourceControl = useCallback((): void => {
    void load('')
    setSourceControlRefresh(value => value + 1)
  }, [load])

  const actions = useSourceControlActions(
    workspaceId,
    sourceControl.status === 'ready' ? sourceControl.listing : null,
    t,
    refreshSourceControl,
  )

  const expanded = useMemo(
    () => new Set(workspaceId === undefined ? [] : expandedByWorkspace[workspaceId] ?? []),
    [expandedByWorkspace, workspaceId],
  )
  const rows = useMemo(() => buildVisibleRows('', 0, nodes, expanded), [expanded, nodes])
  const gitDecorations = useMemo(
    () => sourceControl.status === 'ready' ? buildGitDecorations(sourceControl.listing) : new Map<string, GitDecoration>(),
    [sourceControl],
  )
  const toggle = (path: string): void => {
    if (workspaceId === undefined) return
    setExpandedByWorkspace((previous) => {
      const next = new Set(previous[workspaceId] ?? [])
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { ...previous, [workspaceId]: [...next] }
    })
    if (!expanded.has(path) && nodes[path]?.status !== 'ready') void load(path)
  }

  if (workspace === undefined || workspaceId === undefined) {
    return <div className={css.empty}>{t('worktree.noWorkspace')}</div>
  }

  const renderRow = (row: VisibleRow): React.ReactNode => {
    if (row.kind === 'state') {
      const message = row.status === 'loading'
        ? t('worktree.loading')
        : row.status === 'error'
          ? row.message ?? t('worktree.explorerFailed')
          : row.status === 'empty'
            ? t('worktree.emptyDirectory')
            : t('worktree.truncated')
      return (
        <div key={row.key} className={css.explorerState} style={{ paddingLeft: `${8 + row.depth * 14}px` }}>
          <span>{message}</span>
          {row.status === 'error' ? <button type="button" onClick={() => { void load(row.path) }}>{t('worktree.retry')}</button> : null}
        </div>
      )
    }
    const { entry } = row
    const directory = entry.type === 'directory' && entry.outsideRoot !== true
    const decoration = gitDecorations.get(entry.path)
    const draggable = entry.outsideRoot !== true && (entry.type === 'directory' || entry.type === 'file')
    const className = `${css.explorerRow}${entry.outsideRoot === true ? ` ${css.explorerOutside}` : ''}${directory ? ` ${css.explorerRowButton}` : ''}`
    const content = (
      <>
        <span className={css.explorerDisclosure} aria-hidden="true">{directory ? (row.expanded ? '▾' : '▸') : entry.type === 'file' ? '·' : '!'}</span>
        <span className={css.explorerName} title={entry.name}>{entry.name}</span>
        {entry.outsideRoot === true ? <span className={css.explorerMeta}>{t('worktree.outside')}</span> : null}
        {decoration === undefined ? null : <GitDecorationView decoration={decoration} t={t} />}
        {entry.type === 'file' && entry.outsideRoot !== true ? <FileActionButtons entryPath={entry.path} actions={actions} t={t} /> : null}
      </>
    )
    const openableFile = entry.type === 'file' && entry.outsideRoot !== true
    const openFile = (): void => { if (openableFile) openInViewer(entry.path) }
    return directory
      ? <button key={row.key} type="button" className={`${className}${draggable ? ` ${css.explorerDraggable}` : ''}`} style={{ paddingLeft: `${8 + row.depth * 14}px` }} aria-expanded={row.expanded} aria-label={`${row.expanded ? t('worktree.collapse') : t('worktree.expand')}: ${entry.name}`} onPointerDown={(event) => { if (draggable && event.button === 0) dispatchWorktreePathPointerDown(event.currentTarget, event, entry.path) }} onClick={() => { toggle(entry.path) }}>{content}</button>
      : <div key={row.key} className={`${className}${draggable ? ` ${css.explorerDraggable}` : ''}`} style={{ paddingLeft: `${8 + row.depth * 14}px` }} role={openableFile ? 'button' : undefined} tabIndex={openableFile ? 0 : undefined} aria-label={openableFile ? `${t('worktree.openFile')}: ${entry.name}` : undefined} onKeyDown={openableFile ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFile() } } : undefined} onPointerDown={(event) => { if (draggable && event.button === 0) dispatchWorktreePathPointerDown(event.currentTarget, event, entry.path) }} onClick={openableFile ? openFile : undefined}>{content}</div>
  }

  return (
    <div className={css.explorer} aria-label={t('worktree.explorerLabel')}>
      <div className={css.explorerHeader}>
        <span className={css.explorerTitle}>{workspace.title}</span>
        <GitStateIndicator state={sourceControl} t={t} />
        <button type="button" className={css.explorerRefresh} onClick={refreshSourceControl}>{t('worktree.refresh')}</button>
      </div>
      {sourceControl.status === 'ready' && sourceControl.listing.state === 'repository' && sourceControl.listing.entries.length > 0 ? (
        <SourceControlCommitBar
          stagedCount={sourceControl.listing.entries.filter(entry => entry.statuses.includes('staged')).length}
          actions={actions}
          t={t}
        />
      ) : null}
      {actions.diff === null ? null : <SourceControlDiffPanel diff={actions.diff} t={t} onClose={actions.closeDiff} />}
      {viewer === null ? null : (
        <DesktopWorkspaceFileViewer
          workspaceId={workspaceId}
          path={viewer.path}
          scrollToLine={viewer.line}
          onClose={() => { setViewer(null) }}
          t={t}
        />
      )}
      <DesktopVirtualList items={rows} rowHeight={26} overscan={6} className={css.explorerTree} renderItem={renderRow} />
    </div>
  )
}

/** Row action buttons for one changed file, when its entry is classified. */
function FileActionButtons({ entryPath, actions, t }: {
  entryPath: string
  actions: ReturnType<typeof useSourceControlActions>
  t: (key: string) => string
}): React.ReactElement | null {
  const entry = actions.entryByPath.get(entryPath)
  if (entry === undefined || entry.statuses.length === 0 || entry.statuses.every(status => status === 'unsupported')) return null
  return <SourceControlActionButtons entry={entry} path={entryPath} actions={actions} t={t} />
}

/** Add Git status markers to changed files and all visible parent directories. */
export function buildGitDecorations(listing: SourceControlListing): Map<string, GitDecoration> {
  const decorations = new Map<string, GitDecoration>()
  if (listing.state !== 'repository') return decorations
  for (const entry of listing.entries) {
    addGitDecoration(decorations, entry.path, entry.statuses)
    const parts = entry.path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      addGitDecoration(decorations, parts.slice(0, index).join('/'), entry.statuses)
    }
  }
  return decorations
}

function addGitDecoration(map: Map<string, GitDecoration>, path: string, statuses: readonly SourceControlStatus[]): void {
  const previous = map.get(path)
  const merged = new Set(previous?.statuses)
  for (const status of statuses) merged.add(status)
  map.set(path, { statuses: [...merged], count: (previous?.count ?? 0) + 1 })
}

function GitDecorationView({ decoration, t }: { decoration: GitDecoration; t: (key: string) => string }): React.ReactElement {
  const status = primaryGitStatus(decoration.statuses)
  const label = decoration.statuses.map(value => t(`worktree.status.${value}`)).join(', ')
  return (
    <span className={`${css.explorerGitDecoration} ${gitDecorationClass(status)}`} title={label} aria-label={label}>
      {gitStatusMarker(status)}{decoration.count > 1 ? <span className={css.explorerGitCount}>{decoration.count}</span> : null}
    </span>
  )
}

function GitStateIndicator({ state, t }: { state: SourceControlState; t: (key: string) => string }): React.ReactElement {
  const label = state.status === 'loading'
    ? t('worktree.gitStatusLoading')
    : state.status === 'error'
      ? t('worktree.gitStatusUnavailable')
      : state.listing.state === 'not-repository'
        ? t('worktree.notRepository')
        : state.listing.state === 'unavailable'
          ? t('worktree.gitStatusUnavailable')
          : state.listing.truncated
            ? t('worktree.gitStatusTruncated')
            : t('worktree.gitStatus')
  return <span className={css.explorerGitState} role="status" title={label} aria-label={label}>{state.status === 'error' || (state.status === 'ready' && state.listing.state === 'unavailable') ? 'Git !' : 'Git'}</span>
}

function primaryGitStatus(statuses: readonly SourceControlStatus[]): SourceControlStatus {
  for (const status of ['conflicted', 'unstaged', 'staged', 'untracked', 'renamed', 'unsupported'] as const) {
    if (statuses.includes(status)) return status
  }
  return 'unsupported'
}

function gitStatusMarker(status: SourceControlStatus): string {
  return { conflicted: 'C', unstaged: 'M', staged: 'S', untracked: 'U', renamed: 'R', unsupported: '?' }[status] ?? '?'
}

function gitDecorationClass(status: SourceControlStatus): string {
  return {
    conflicted: css.explorerGitConflicted,
    unstaged: css.explorerGitUnstaged,
    staged: css.explorerGitStaged,
    untracked: css.explorerGitUntracked,
    renamed: css.explorerGitRenamed,
    unsupported: css.explorerGitUnsupported,
  }[status] ?? css.explorerGitUnsupported ?? ''
}

function buildVisibleRows(path: string, depth: number, nodes: Record<string, NodeState>, expanded: ReadonlySet<string>): VisibleRow[] {
  const node = nodes[path]
  if (node === undefined || node.status === 'loading') return [{ kind: 'state', key: `state:${path}:loading`, path, depth, status: 'loading' }]
  if (node.status === 'error') return [{ kind: 'state', key: `state:${path}:error`, path, depth, status: 'error', message: node.message }]
  const rows: VisibleRow[] = []
  for (const entry of node.listing.entries) {
    const isDirectory = entry.type === 'directory' && entry.outsideRoot !== true
    const isExpanded = isDirectory && expanded.has(entry.path)
    rows.push({ kind: 'entry', key: `entry:${entry.path}`, entry, depth, expanded: isExpanded })
    if (isExpanded) rows.push(...buildVisibleRows(entry.path, depth + 1, nodes, expanded))
  }
  if (node.listing.entries.length === 0) rows.push({ kind: 'state', key: `state:${path}:empty`, path, depth, status: 'empty' })
  if (node.listing.truncated) rows.push({ kind: 'state', key: `state:${path}:truncated`, path, depth, status: 'truncated' })
  return rows
}

function readExpanded(): Record<string, readonly string[]> {
  try {
    const value = JSON.parse(localStorage.getItem('dsh.desktop.explorer.expanded') ?? '{}') as unknown
    if (typeof value !== 'object' || value === null) return {}
    return Object.fromEntries(Object.entries(value).filter(([, paths]) => Array.isArray(paths) && paths.every(path => typeof path === 'string')))
  } catch {
    return {}
  }
}

function parseListing(value: unknown): ExplorerListing {
  if (typeof value !== 'object' || value === null) throw new Error('Explorer returned an invalid response')
  const record = value as Record<string, unknown>
  if (typeof record.workspaceId !== 'string' || typeof record.path !== 'string' || typeof record.truncated !== 'boolean' || !Array.isArray(record.entries)) {
    throw new Error('Explorer returned an invalid response')
  }
  const entries = record.entries.filter(isEntry)
  if (entries.length !== record.entries.length) throw new Error('Explorer returned an invalid entry')
  return { workspaceId: record.workspaceId, path: record.path, entries, truncated: record.truncated }
}

/** Validate the bounded Git projection before using it for file decorations. */
export function parseSourceControlListing(value: unknown): SourceControlListing {
  if (typeof value !== 'object' || value === null) throw new Error('Source Control returned an invalid response')
  const record = value as Record<string, unknown>
  if (typeof record.workspaceId !== 'string' || (record.state !== 'repository' && record.state !== 'not-repository' && record.state !== 'unavailable') || typeof record.truncated !== 'boolean' || !Array.isArray(record.entries) || !record.entries.every(isSourceControlEntry)) {
    throw new Error('Source Control returned an invalid response')
  }
  return { workspaceId: record.workspaceId, state: record.state, entries: record.entries, truncated: record.truncated }
}

function isSourceControlEntry(value: unknown): value is SourceControlEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.path === 'string'
    && Array.isArray(record.statuses)
    && record.statuses.every(status => status === 'staged' || status === 'unstaged' || status === 'untracked' || status === 'conflicted' || status === 'renamed' || status === 'unsupported')
    && (record.oldPath === undefined || typeof record.oldPath === 'string')
}

function isEntry(value: unknown): value is ExplorerEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.name === 'string'
    && typeof entry.path === 'string'
    && (entry.type === 'directory' || entry.type === 'file' || entry.type === 'other')
    && typeof entry.expandable === 'boolean'
    && (entry.outsideRoot === undefined || entry.outsideRoot === true)
    && (entry.size === undefined || typeof entry.size === 'number')
}

function explorerError(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' ? message : fallback
}
