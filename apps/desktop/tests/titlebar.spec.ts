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
  it('follows the document locale after asynchronous locale resolution', async () => {
    window.eval(titlebarSource)
    const load = document.querySelector('.bar-load-label')
    expect(load?.textContent).toBe('负载未知')

    document.documentElement.lang = 'en'
    await vi.waitFor(() => {
      expect(load?.textContent).toBe('Workload unknown')
    })
  })
})
