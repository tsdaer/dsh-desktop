import { describe, expect, it } from 'vitest'
import { getVirtualWindow } from '../bridge-client/src/client/DesktopVirtualList.tsx'

describe('DesktopVirtualList windowing', () => {
  it('returns an empty range for an empty collection', () => {
    expect(getVirtualWindow(0, 26, 0, 320)).toEqual({ start: 0, end: 0 })
  })

  it('includes overscan and clamps the range to the collection', () => {
    expect(getVirtualWindow(100, 20, 200, 100, 2)).toEqual({ start: 8, end: 17 })
    expect(getVirtualWindow(10, 20, 1000, 100, 2)).toEqual({ start: 3, end: 10 })
  })
})
