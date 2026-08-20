import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeLogoMotionRow } from '../src/client/BridgeLogoMotionRow.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop Logo-motion setting', () => {
  it('loads the persisted value and applies an enabled change', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/config')) return new Response(JSON.stringify({ logoMotion: true }))
      expect(String(input)).toContain('/policy')
      expect(init?.body).toBe(JSON.stringify({ logoMotion: false }))
      return new Response(JSON.stringify({ ok: true }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const onLogoMotion = vi.fn()
    render(createElement(BridgeLogoMotionRow, { onLogoMotion, t: key => key }))

    const checkbox = await screen.findByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() => { expect(onLogoMotion).toHaveBeenCalledWith(false) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
