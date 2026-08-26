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
    const textarea = document.createElement('textarea')
    card.appendChild(textarea)
    document.body.appendChild(card)
    expect(classifyTarget(textarea)).toEqual({ kind: 'composer' })
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
    const items = buildMenuItems({ kind: 'composer' }, actions, false)
    expect(items.map(item => item.id)).toEqual(['cut', 'copy', 'paste'])
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
    const items = buildMenuItems({ kind: 'composer' }, actions, true)
    expect(items.map(item => item.id)).toEqual(['cut', 'copy', 'paste', 'inspect'])
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
    const textarea = document.createElement('textarea')
    textarea.value = 'ab'
    textarea.setSelectionRange(1, 1)
    card.appendChild(textarea)
    document.body.appendChild(card)
    const inputEvent = vi.fn()
    textarea.addEventListener('input', inputEvent)
    await expect(pasteIntoComposer()).resolves.toBe(true)
    expect(textarea.value).toBe('apastedb')
    expect(inputEvent).toHaveBeenCalledTimes(1)
  })

  it('copies the composer selection without removing it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    textarea.value = 'hello'
    textarea.setSelectionRange(1, 3)
    card.appendChild(textarea)
    document.body.appendChild(card)
    await expect(copyFromComposer()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('el')
    expect(textarea.value).toBe('hello')
  })

  it('cuts the composer selection to the clipboard and removes it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    textarea.value = 'hello'
    textarea.setSelectionRange(1, 3)
    card.appendChild(textarea)
    document.body.appendChild(card)
    await expect(cutFromComposer()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('el')
    expect(textarea.value).toBe('hlo')
  })

  it('refuses paste into a disabled composer', async () => {
    const readText = vi.fn(async () => 'pasted')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    textarea.disabled = true
    card.appendChild(textarea)
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
})
