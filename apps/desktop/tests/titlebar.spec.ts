// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const titlebarSource = readFileSync(
  resolve(process.cwd(), 'apps/desktop/src/titlebar.js'),
  'utf8',
)

beforeEach(() => {
  document.documentElement.lang = 'zh-CN'
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})))
})

describe('desktop title bar', () => {
  it('follows the document locale after asynchronous locale resolution', async () => {
    window.eval(titlebarSource)
    const api = document.querySelector('.bar-api-label')
    const balance = document.querySelector('.bar-balance') as HTMLButtonElement
    expect(api?.textContent).toBe('检查 API')
    expect(balance.title).toBe('刷新余额')

    document.documentElement.lang = 'en'
    await vi.waitFor(() => {
      expect(api?.textContent).toBe('Checking API')
      expect(balance.title).toBe('Refresh balance')
    })
  })
})
