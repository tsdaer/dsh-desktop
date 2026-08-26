import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { BridgeSection } from '../src/client/BridgeSection.tsx'

/**
 * BridgeSection must render every bridge settings item slot, including the
 * WSL environment card (item4). A slot registered but never rendered is
 * invisible to the user — the P4a regression this test pins.
 */
describe('bridge settings section', () => {
  it('renders all four bridge item slots including the WSL card', () => {
    const calls: string[] = []
    const renderSlot = vi.fn((name: string) => {
      calls.push(name)
      return createElement('span', { 'data-slot': name }, name)
    })
    render(createElement(BridgeSection, { renderSlot: renderSlot as never }))
    expect(calls).toEqual([
      'settings.bridge.item',
      'settings.bridge.item2',
      'settings.bridge.item3',
      'settings.bridge.item4',
    ])
    expect(document.querySelector('[data-slot="settings.bridge.item4"]')).not.toBeNull()
  })
})
