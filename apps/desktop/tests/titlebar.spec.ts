// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const titlebarSource = readFileSync(
  resolve(process.cwd(), 'apps/desktop/src/titlebar.js'),
  'utf8',
)

beforeEach(() => {
  history.replaceState(null, '', '/?dsh_token=titlebar-secret')
  document.documentElement.lang = 'zh-CN'
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})))
})

describe('desktop title bar', () => {
  it('authenticates the balance request with the navigation token', () => {
    window.eval(titlebarSource)
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer titlebar-secret')
    expect((window as typeof window & { __DSH_LOOPBACK_TOKEN__?: string }).__DSH_LOOPBACK_TOKEN__)
      .toBe('titlebar-secret')
  })

  it('follows the document locale after asynchronous locale resolution', async () => {
    window.eval(titlebarSource)
    const api = document.querySelector('.bar-api-label')
    const balance = document.querySelector('.bar-balance') as HTMLButtonElement
    expect(api?.textContent).toBe('检查余额')
    expect(balance.title).toBe('刷新余额')

    document.documentElement.lang = 'en'
    await vi.waitFor(() => {
      expect(api?.textContent).toBe('Checking balance')
      expect(balance.title).toBe('Refresh balance')
    })
  })
})
