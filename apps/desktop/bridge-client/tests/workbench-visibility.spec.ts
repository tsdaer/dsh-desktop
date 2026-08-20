import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopWorkspaceWorkbench } from '../src/client/DesktopWorkspaceWorkbench.tsx'

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function inertSource<T>(snapshot: T) {
  return { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } }
}

/** Stand in for the sidebar region the shared Workspace browser occupies. */
function mountRegion() {
  const region = document.createElement('div')
  region.setAttribute('data-slot', 'sidebar.workspaces')
  const browser = document.createElement('div')
  region.append(browser)
  document.body.append(region)
  return browser
}

function renderWorkbench(wide: boolean) {
  return render(createElement(DesktopWorkspaceWorkbench, {
    wide,
    t: (key: string) => key,
    workspaces: inertSource({ items: [] }),
    sessions: inertSource({ current: undefined as string | undefined }),
  }))
}

/** The rail renders icon-only tabs, so order is the only stable handle. */
function modeTabs() {
  const [workspaceTab, worktreeTab] = screen.getAllByRole('tab')
  if (workspaceTab === undefined || worktreeTab === undefined) throw new Error('expected Workspace and Worktree tabs')
  return { workspaceTab, worktreeTab }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  document.body.replaceChildren()
})

describe('desktop Workbench browser visibility', () => {
  it('keeps the shared browser in the collapsed rail when Worktree is selected', () => {
    const browser = mountRegion()
    renderWorkbench(false)

    fireEvent.click(modeTabs().worktreeTab)

    expect(modeTabs().worktreeTab.getAttribute('aria-selected')).toBe('true')
    expect(browser.style.display).not.toBe('none')
  })

  it('hides the shared browser once the wide Worktree panel replaces it', () => {
    const browser = mountRegion()
    renderWorkbench(true)

    fireEvent.click(modeTabs().worktreeTab)

    expect(browser.style.display).toBe('none')
  })

  it('restores the shared browser when Workspace is reselected', () => {
    const browser = mountRegion()
    renderWorkbench(true)

    fireEvent.click(modeTabs().worktreeTab)
    fireEvent.click(modeTabs().workspaceTab)

    expect(browser.style.display).not.toBe('none')
  })
})
