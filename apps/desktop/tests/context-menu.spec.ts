// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMenuItems,
  classifyTarget,
  copyFromComposer,
  copySelection,
  cutFromComposer,
  pasteIntoComposer,
} from '../bridge-client/src/client/DesktopContextMenu.ts'
import { openContextMenu } from '../bridge-client/src/client/DesktopContextMenuPortal.ts'

const actions = {
  cut: vi.fn(),
  copy: vi.fn(),
  paste: vi.fn(async () => {}),
  inspect: vi.fn(),
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  window.getSelection()?.removeAllRanges()
})

describe('desktop context menu classification', () => {
  it('classifies a right-click inside the composer card as composer', () => {
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const input = document.createElement('div')
    input.dataset.composerInput = ''
    input.contentEditable = 'true'
    card.appendChild(input)
    document.body.appendChild(card)
    expect(classifyTarget(input)).toEqual({ kind: 'composer', editable: true, hasSelection: false })
  })

  it('classifies a right-click on an ordinary input as editable-outside', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    expect(classifyTarget(input)).toEqual({ kind: 'editable-outside' })
  })

  it('classifies a right-click inside an active selection as readable-selection', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'selectable text'
    document.body.appendChild(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(classifyTarget(paragraph)).toEqual({ kind: 'readable-selection' })
  })

  it('classifies plain body right-clicks as none', () => {
    expect(classifyTarget(document.body)).toEqual({ kind: 'none' })
  })
})

describe('desktop context menu items', () => {
  it('offers cut/copy/paste in the composer', () => {
    const items = buildMenuItems({ kind: 'composer', editable: true, hasSelection: true }, actions, false)
    expect(items.map(item => item.id)).toEqual(['cut', 'copy', 'paste'])
    expect(items.slice(0, 2).every(item => item.enabled)).toBe(true)
  })

  it('offers only copy for editable inputs outside the composer', () => {
    const items = buildMenuItems({ kind: 'editable-outside' }, actions, false)
    expect(items.map(item => item.id)).toEqual(['copy'])
  })

  it('offers copy for a readable selection', () => {
    const items = buildMenuItems({ kind: 'readable-selection' }, actions, false)
    expect(items.map(item => item.id)).toEqual(['copy'])
  })

  it('adds Inspect after product actions in debug mode', () => {
    const items = buildMenuItems({ kind: 'composer', editable: true, hasSelection: true }, actions, true)
    expect(items.map(item => item.id)).toEqual(['cut', 'copy', 'paste', 'inspect'])
  })

  it('does not expose mutation actions for a read-only composer', () => {
    const items = buildMenuItems({ kind: 'composer', editable: false, hasSelection: true }, actions, false)
    expect(items.map(item => item.id)).toEqual(['copy'])
    expect(buildMenuItems({ kind: 'composer', editable: false, hasSelection: false }, actions, false)).toEqual([])
  })
})

describe('desktop context menu clipboard and editing', () => {
  it('copies the active selection through the clipboard API', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const paragraph = document.createElement('p')
    paragraph.textContent = 'hello world'
    document.body.appendChild(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    await expect(copySelection()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello world')
  })

  it('pastes text into the composer replacing the selection', async () => {
    const readText = vi.fn(async () => 'pasted')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const input = document.createElement('div')
    input.dataset.composerInput = ''
    input.contentEditable = 'true'
    card.appendChild(input)
    document.body.appendChild(card)
    const inputEvent = vi.fn()
    input.addEventListener('paste', (event) => { inputEvent(); event.preventDefault() })
    await expect(pasteIntoComposer()).resolves.toBe(true)
    expect(inputEvent).toHaveBeenCalledTimes(1)
  })

  it('copies the composer selection without removing it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const input = document.createElement('div')
    input.dataset.composerInput = ''
    input.contentEditable = 'true'
    input.textContent = 'hello'
    card.appendChild(input)
    document.body.appendChild(card)
    const range = document.createRange()
    range.setStart(input.firstChild!, 1)
    range.setEnd(input.firstChild!, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    await expect(copyFromComposer()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('el')
    expect(input.textContent).toBe('hello')
  })

  it('cuts the composer selection through the editor command', async () => {
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const input = document.createElement('div')
    input.dataset.composerInput = ''
    input.contentEditable = 'true'
    input.textContent = 'hello'
    card.appendChild(input)
    document.body.appendChild(card)
    const range = document.createRange()
    range.setStart(input.firstChild!, 1)
    range.setEnd(input.firstChild!, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    await expect(cutFromComposer()).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('cut')
    expect(input.textContent).toBe('hello')
    delete (document as { execCommand?: unknown }).execCommand
  })

  it('refuses paste into a disabled composer', async () => {
    const readText = vi.fn(async () => 'pasted')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const input = document.createElement('div')
    input.dataset.composerInput = ''
    input.contentEditable = 'false'
    card.appendChild(input)
    document.body.appendChild(card)
    await expect(pasteIntoComposer()).resolves.toBe(false)
  })
})

describe('desktop context menu portal', () => {
  it('opens a positioned menu and closes on Escape', () => {
    const onClose = vi.fn()
    const dispose = openContextMenu({
      x: 100,
      y: 100,
      items: [
        { id: 'copy', label: 'Copy', enabled: true, run: () => {} },
        { id: 'paste', label: 'Paste', enabled: true, run: () => {} },
      ],
      onClose,
    })
    const root = document.getElementById('dsh-desktop-context-menu')
    expect(root).not.toBeNull()
    expect(root?.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.getElementById('dsh-desktop-context-menu')).toBeNull()
    dispose()
  })

  it('clamps the menu inside the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
    const onClose = vi.fn()
    const dispose = openContextMenu({
      x: 490,
      y: 390,
      items: [{ id: 'copy', label: 'Copy', enabled: true, run: () => {} }],
      onClose,
    })
    const root = document.getElementById('dsh-desktop-context-menu')
    const left = Number.parseFloat(root?.style.left ?? '0')
    const top = Number.parseFloat(root?.style.top ?? '0')
    expect(left).toBeLessThanOrEqual(500)
    expect(top).toBeLessThanOrEqual(400)
    dispose()
  })

  it('closes the old menu exactly once and restores focus', () => {
    const focus = document.createElement('button')
    document.body.append(focus)
    focus.focus()
    const firstClose = vi.fn()
    const first = openContextMenu({ x: 10, y: 10, items: [], onClose: firstClose })
    const secondClose = vi.fn()
    const second = openContextMenu({ x: 20, y: 20, items: [], onClose: secondClose })
    expect(firstClose).toHaveBeenCalledTimes(1)
    expect(document.getElementById('dsh-desktop-context-menu')).not.toBeNull()
    second()
    second()
    first()
    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(focus)
  })

  it('closes on wheel and outside pointer input', () => {
    const onClose = vi.fn()
    openContextMenu({ x: 10, y: 10, items: [], onClose })
    window.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    openContextMenu({ x: 10, y: 10, items: [], onClose })
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
