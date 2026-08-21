import { useCallback, useEffect, useRef, useState } from 'react'
import css from './DesktopWorkspaceWorkbench.module.css'
import { DesktopWorkspaceExplorer } from './DesktopWorkspaceExplorer.tsx'
import { DesktopWorkspaceFileViewer } from './DesktopWorkspaceFileViewer.tsx'

interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

interface WorkspaceSource {
  list: {
    getSnapshot(): { items: readonly WorkspaceView[]; recentWorkspaceId?: string }
    subscribe(listener: () => void): () => void
  }
  openPath?(path: string): Promise<void>
}

interface SessionSource {
  list: { getSnapshot(): { current: string | undefined }; subscribe(listener: () => void): () => void }
}

interface SearchProps {
  workspaces: WorkspaceSource
  sessions: SessionSource
  t: (key: string) => string
}

interface SearchMatch {
  path: string
  line: number
  text: string
}

interface SearchListing {
  matches: readonly SearchMatch[]
  truncated: boolean
  reason?: 'match-limit' | 'output-limit' | 'timeout'
  nextCursor?: string
}

/** Search the selected Workspace through the bounded desktop Host route. */
export function DesktopWorkspaceSearch({ workspaces: workspaceSource, sessions: sessionSource, t }: SearchProps): React.ReactElement {
  const workspaceSnapshot = useSourceSnapshot(workspaceSource.list)
  const sessionSnapshot = useSourceSnapshot(sessionSource.list)
  const workspace = workspaceSnapshot.items.find(
    item => sessionSnapshot.current !== undefined && item.sessionIds.includes(sessionSnapshot.current),
  )
    ?? workspaceSnapshot.items.find(item => item.workspaceId === workspaceSnapshot.recentWorkspaceId)
    ?? workspaceSnapshot.items[0]
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [listing, setListing] = useState<SearchListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewer, setViewer] = useState<{ path: string; line?: number } | null>(null)
  const request = useRef<AbortController | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async (cursor?: string): Promise<void> => {
    if (workspace === undefined) return
    if (query.length === 0) {
      request.current?.abort()
      request.current = null
      setBusy(false)
      setListing(null)
      setError(null)
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(null)
    if (cursor === undefined) setListing(null)
    try {
      const params = new URLSearchParams({ workspaceId: workspace.workspaceId, query, stream: '1' })
      if (caseSensitive) params.set('caseSensitive', '1')
      if (wholeWord) params.set('wholeWord', '1')
      if (cursor !== undefined) params.set('cursor', cursor)
      const response = await fetch(`/dsh-bridge/worktree/search?${params.toString()}`, { signal: controller.signal })
      const next = await consumeSearchResponse(response, t, (match) => {
        setListing(previous => ({
          matches: previous === null ? [match] : [...previous.matches, match],
          truncated: false,
        }))
      })
      setListing(previous => cursor === undefined || previous === null
        ? next
        : { ...next, matches: mergeMatches(previous.matches, next.matches) })
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('worktree.searchFailed'))
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }, [caseSensitive, query, t, wholeWord, workspace, workspaceSource])

  useEffect(() => {
    request.current?.abort()
    if (debounce.current !== null) clearTimeout(debounce.current)
    if (query.length === 0) {
      void run()
      return
    }
    debounce.current = setTimeout(() => { void run() }, 250)
    return () => {
      if (debounce.current !== null) clearTimeout(debounce.current)
    }
  }, [run])

  useEffect(() => () => {
    request.current?.abort()
    if (debounce.current !== null) clearTimeout(debounce.current)
  }, [])

  if (workspace === undefined) return <div className={css.empty}>{t('worktree.noWorkspace')}</div>

  return (
    <div className={css.search} aria-label={t('worktree.searchLabel')}>
      <form className={css.searchForm} onSubmit={(event) => {
        event.preventDefault()
        if (debounce.current !== null) clearTimeout(debounce.current)
        void run()
      }}>
        <input
          className={css.searchInput}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
          placeholder={t('worktree.searchPlaceholder')}
          title={t('worktree.searchHelp')}
          aria-label={t('worktree.searchQuery')}
          maxLength={4096}
        />
        <button
          type="button"
          className={`${css.searchOption}${caseSensitive ? ` ${css.searchOptionSelected}` : ''}`}
          aria-pressed={caseSensitive}
          title={t('worktree.caseSensitive')}
          aria-label={t('worktree.caseSensitive')}
          onClick={() => { setCaseSensitive(value => !value); setListing(null) }}
        >Aa</button>
        <button
          type="button"
          className={`${css.searchOption}${wholeWord ? ` ${css.searchOptionSelected}` : ''}`}
          aria-pressed={wholeWord}
          title={t('worktree.wholeWord')}
          aria-label={t('worktree.wholeWord')}
          onClick={() => { setWholeWord(value => !value); setListing(null) }}
        >Word</button>
      </form>
      {busy ? <div className={css.explorerState}>{t('worktree.searching')}</div> : listing === null ? <DesktopWorkspaceExplorer workspaces={workspaceSource} sessions={sessionSource} t={t} /> : null}
      {error === null ? null : <div className={css.searchError} role="alert">{error}</div>}
      {listing !== null && listing.matches.length === 0 && !busy ? <div className={css.explorerState}>{t('worktree.noMatches')}</div> : null}
      {viewer !== null && workspace !== undefined ? (
        <DesktopWorkspaceFileViewer
          workspaceId={workspace.workspaceId}
          path={viewer.path}
          scrollToLine={viewer.line}
          onClose={() => { setViewer(null) }}
          t={t}
        />
      ) : null}
      {viewer !== null ? null : listing !== null && listing.matches.length > 0 ? (
        <div className={css.searchResults}>
          {listing.matches.map(match => (
            <button
              key={`${match.path}:${String(match.line)}`}
              type="button"
              className={css.searchResult}
              title={match.path}
              onClick={() => { setViewer({ path: match.path, line: match.line }) }}
            >
              <span className={css.searchResultLocation}>{match.path}{match.line > 0 ? `:${String(match.line)}` : ''}</span>
              {match.line > 0 ? <span className={css.searchResultText}>{match.text}</span> : null}
            </button>
          ))}
          {listing.truncated ? <div className={css.explorerState}>{searchTruncation(listing.reason, t)}</div> : null}
          {listing.nextCursor !== undefined ? <button type="button" className={css.searchMore} disabled={busy} onClick={() => { void run(listing.nextCursor) }}>{t('worktree.loadMore')}</button> : null}
        </div>
      ) : null}
    </div>
  )
}

function useSourceSnapshot<T extends { getSnapshot(): unknown; subscribe(listener: () => void): () => void }>(source: T): ReturnType<T['getSnapshot']> {
  const [snapshot, setSnapshot] = useState(() => source.getSnapshot())
  useEffect(() => source.subscribe(() => { setSnapshot(source.getSnapshot()) }), [source])
  return snapshot as ReturnType<T['getSnapshot']>
}


function parseSearchListing(value: unknown): SearchListing {
  if (typeof value !== 'object' || value === null) throw new Error('Search returned an invalid response')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.matches) || typeof record.truncated !== 'boolean' || !record.matches.every(isMatch)) throw new Error('Search returned an invalid response')
  if (record.nextCursor !== undefined && typeof record.nextCursor !== 'string') throw new Error('Search returned an invalid cursor')
  return {
    matches: record.matches,
    truncated: record.truncated,
    ...(record.reason === 'match-limit' || record.reason === 'output-limit' || record.reason === 'timeout' ? { reason: record.reason } : {}),
    ...(typeof record.nextCursor === 'string' ? { nextCursor: record.nextCursor } : {}),
  }
}

async function consumeSearchResponse(
  response: Response,
  t: (key: string) => string,
  onMatch: (match: SearchMatch) => void,
): Promise<SearchListing> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const body = await response.json() as unknown
    if (!response.ok) throw new Error(searchError(body, t))
    return parseSearchListing(body)
  }
  if (response.body === null) throw new Error(t('worktree.searchFailed'))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let listing: SearchListing | undefined
  while (true) {
    const { done, value } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const lines = pending.split('\n')
    pending = done ? '' : lines.pop() ?? ''
    for (const line of lines) {
      if (line.length === 0) continue
      let event: unknown
      try { event = JSON.parse(line) } catch { throw new Error(t('worktree.searchFailed')) }
      if (typeof event !== 'object' || event === null) throw new Error(t('worktree.searchFailed'))
      const record = event as Record<string, unknown>
      if (record.type === 'match' && isMatch(record.match)) onMatch(record.match)
      else if (record.type === 'done') listing = parseSearchListing(record.listing)
      else if (record.type === 'error') throw new Error(searchError(record.error, t))
    }
    if (done) break
  }
  if (listing === undefined) throw new Error(t('worktree.searchFailed'))
  return listing
}

function mergeMatches(left: readonly SearchMatch[], right: readonly SearchMatch[]): SearchMatch[] {
  const merged = new Map(left.map(match => [`${match.path}:${String(match.line)}`, match]))
  for (const match of right) merged.set(`${match.path}:${String(match.line)}`, match)
  return [...merged.values()]
}

function isMatch(value: unknown): value is SearchMatch {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.path === 'string' && typeof record.line === 'number' && Number.isSafeInteger(record.line) && record.line >= 0 && typeof record.text === 'string'
}

function searchError(value: unknown, t: (key: string) => string): string {
  if (typeof value !== 'object' || value === null) return t('worktree.searchFailed')
  const record = value as Record<string, unknown>
  if (record.code === 'timeout') return t('worktree.searchTimedOut')
  return typeof record.message === 'string' ? record.message : t('worktree.searchFailed')
}

function searchTruncation(reason: SearchListing['reason'], t: (key: string) => string): string {
  if (reason === 'timeout') return t('worktree.searchTimedOut')
  if (reason === 'output-limit') return t('worktree.searchOutputLimited')
  return t('worktree.searchTruncated')
}
