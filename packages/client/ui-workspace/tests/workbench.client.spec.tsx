// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceWorkbenchProps } from '../src/client/contract/slots.ts'
import { WorkspaceWorkbench } from '../src/client/WorkspaceWorkbench.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspaceWorkbenchProps['t'] = makeTranslate(zh, commonZh)

const emptySessions: SessionListState = {
  ids: [],
  byId: {},
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
}
const emptyWorkspaces: WorkspaceListState = {
  items: [],
  archivedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
  baselinesReady: true,
  recentWorkspaceId: undefined,
}

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount() {
  return render(
    <WorkspaceWorkbench
      wide
      t={t}
      expandSidebar={() => {}}
      useSessions={hook(emptySessions)}
      useWorkspaces={hook(emptyWorkspaces)}
      renderSlot={(name, _owner, options) => name === 'sidebar.workspaces.workspace'
        ? <div data-testid="workspace-child">Workspace child</div>
        : options?.fallback ?? null}
    />,
  )
}

describe('WorkspaceWorkbench', () => {
  it('keeps Workspace content selected by default and exposes an accessible mode switch', () => {
    mount()
    expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('workspace-child')).toBeTruthy()
    expect(screen.queryByText('项目文件视图尚未启用。')).toBeNull()
  })

  it('switches only the browser-local mode and leaves the Worktree slot to its future occupant', () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: '项目文件' }))
    expect(screen.getByRole('tab', { name: '项目文件' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('项目文件视图尚未启用。')).toBeTruthy()
    expect(screen.queryByTestId('workspace-child')).toBeNull()
  })
})
