import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import css from './DesktopWorkspaceWorkbench.module.css'
import { DesktopVirtualList } from './DesktopVirtualList.tsx'

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
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    try { localStorage.setItem('dsh.desktop.explorer.expanded', JSON.stringify(expandedByWorkspace)) } catch { /* browser storage is optional */ }
  }, [expandedByWorkspace])

  const load = useCallback(async (path: string): Promise<void> => {
    if (workspaceId === undefined) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
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
    }
  }, [t, workspaceId])

  useEffect(() => {
    request.current?.abort()
    setNodes({})
    if (workspaceId !== undefined) void load('')
    return () => { request.current?.abort() }
  }, [load, workspaceId])

  const expanded = useMemo(
    () => new Set(workspaceId === undefined ? [] : expandedByWorkspace[workspaceId] ?? []),
    [expandedByWorkspace, workspaceId],
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

  const rows = useMemo(() => buildVisibleRows('', 0, nodes, expanded), [expanded, nodes])

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
    const className = `${css.explorerRow}${entry.outsideRoot === true ? ` ${css.explorerOutside}` : ''}${directory ? ` ${css.explorerRowButton}` : ''}`
    const content = (
      <>
        <span className={css.explorerDisclosure} aria-hidden="true">{directory ? (row.expanded ? '▾' : '▸') : entry.type === 'file' ? '·' : '!'}</span>
        <span className={css.explorerName} title={entry.name}>{entry.name}</span>
        {entry.outsideRoot === true ? <span className={css.explorerMeta}>{t('worktree.outside')}</span> : null}
      </>
    )
    return directory
      ? <button key={row.key} type="button" className={className} style={{ paddingLeft: `${8 + row.depth * 14}px` }} aria-expanded={row.expanded} aria-label={`${row.expanded ? t('worktree.collapse') : t('worktree.expand')}: ${entry.name}`} onClick={() => { toggle(entry.path) }}>{content}</button>
      : <div key={row.key} className={className} style={{ paddingLeft: `${8 + row.depth * 14}px` }}>{content}</div>
  }

  return (
    <div className={css.explorer} aria-label={t('worktree.explorerLabel')}>
      <div className={css.explorerHeader}>
        <span className={css.explorerTitle}>{workspace.title}</span>
        <button type="button" className={css.explorerRefresh} onClick={() => { void load('') }}>{t('worktree.refresh')}</button>
      </div>
      <DesktopVirtualList items={rows} rowHeight={26} overscan={6} className={css.explorerTree} renderItem={renderRow} />
    </div>
  )
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
