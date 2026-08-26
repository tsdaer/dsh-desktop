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

const ACCOUNT_EVENT = 'dsh://account-summary'

describe('desktop title bar', () => {
  it('no longer fetches balance itself; it renders pushed account summaries', () => {
    window.eval(titlebarSource)
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).not.toHaveBeenCalled()
    const balance = document.querySelector('.bar-balance') as HTMLButtonElement
    expect(balance).not.toBeNull()
  })

  it('renders an available account summary pushed by the controller', () => {
    window.eval(titlebarSource)
    window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, {
      detail: { ok: true, sessionId: 's1', providerId: 'deepseek-official', generation: '1', state: 'available', amount: '42.50', currency: 'CNY' },
    }))
    const balance = document.querySelector('.bar-balance') as HTMLButtonElement
    expect(balance.hidden).toBe(false)
    expect(balance.querySelector('.bar-balance-value')?.textContent).toBe('¥42.50')
  })

  it('keeps the amount hidden until an available summary arrives', () => {
    window.eval(titlebarSource)
    window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, {
      detail: { ok: false, sessionId: 's1', providerId: 'pi-ai', generation: '1', state: 'unsupported' },
    }))
    const balance = document.querySelector('.bar-balance') as HTMLButtonElement
    expect(balance.hidden).toBe(true)
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
