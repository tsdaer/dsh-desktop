// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertPathsIntoComposer } from '../bridge-client/src/client/DesktopComposerPaste.ts'

/**
 * Desktop path insertion feeds the Lexical composer through its own paste
 * pipeline: a paste event carrying text/plain clipboard data on the
 * `[data-composer-input]` surface, which the composer keymap routes through
 * the shell's paste verb. These cases pin the bridge's contract — the live
 * composer must receive the paths as paste text, and read-only/no-composer
 * states must refuse — without booting the full Lexical stack.
 */
describe('desktop composer path insertion', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function mountComposer(editable: boolean): HTMLDivElement {
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const input = document.createElement('div')
    input.dataset.composerInput = ''
    // React renders the editable state as the contenteditable attribute;
    // jsdom does not reflect the property to the attribute, so set it directly.
    input.setAttribute('contenteditable', editable ? 'true' : 'false')
    card.appendChild(input)
    document.body.appendChild(card)
    return input
  }

  it('inserts multiple paths as one newline-joined paste on the live composer', () => {
    const input = mountComposer(true)
    const dispatched: Event[] = []
    input.addEventListener('paste', (event) => {
      dispatched.push(event)
      event.preventDefault()
    })
    expect(insertPathsIntoComposer(['src/a.ts', 'src/b.ts'])).toBe(true)
    expect(dispatched).toHaveLength(1)
    const payload = (dispatched[0] as unknown as { clipboardData?: { getData(type: string): string } }).clipboardData
    expect(payload?.getData('text/plain')).toBe('src/a.ts\nsrc/b.ts\n')
    expect(input.getAttribute('contenteditable')).toBe('true')
  })

  it('refuses when no composer card is mounted', () => {
    expect(insertPathsIntoComposer(['src/a.ts'])).toBe(false)
  })

  it('refuses when the composer surface is read-only', () => {
    const input = mountComposer(false)
    const onPaste = vi.fn()
    input.addEventListener('paste', onPaste)
    expect(insertPathsIntoComposer(['src/a.ts'])).toBe(false)
    expect(onPaste).not.toHaveBeenCalled()
  })

  it('refuses when the composer input element is absent inside the card', () => {
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    document.body.appendChild(card)
    expect(insertPathsIntoComposer(['src/a.ts'])).toBe(false)
  })
})
