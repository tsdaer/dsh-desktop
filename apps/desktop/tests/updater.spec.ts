// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyDesktopUpdateFailure,
  desktopUpdateLabel,
  mountDesktopUpdater,
  type DesktopUpdaterAdapter,
  type DesktopUpdaterLabels,
} from '../bridge-client/src/client/DesktopUpdater.ts'
import type { Update } from '@tauri-apps/plugin-updater'

const labels: DesktopUpdaterLabels = {
  checking: 'checking',
  upToDate: 'up to date',
  available: version => `available ${version}`,
  downloading: percent => `downloading ${percent ?? '…'}`,
  ready: version => `ready ${version}`,
  networkFailure: 'network failure',
  manifestFailure: 'manifest failure',
  verificationFailure: 'verification failure',
  installFailure: 'install failure',
  unknownFailure: 'unknown failure',
  confirmDownload: () => '',
  confirmInstall: () => '',
}

function fakeUpdate(version = '0.3.1'): Update {
  return { version } as Update
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  document.body.innerHTML = '<div id="dsh-desktop-titlebar"><button class="bar-balance"></button></div>'
  vi.useFakeTimers()
})

describe('desktop updater states', () => {
  it('renders explicit no-update, available, progress, and install-ready states', () => {
    expect(desktopUpdateLabel({ kind: 'up-to-date' }, labels)).toBe('up to date')
    expect(desktopUpdateLabel({ kind: 'available', version: '0.3.1' }, labels)).toBe('available 0.3.1')
    expect(desktopUpdateLabel({ kind: 'downloading', completed: 25, total: 100 }, labels)).toBe('downloading 25')
    expect(desktopUpdateLabel({ kind: 'downloading', completed: 25, total: undefined }, labels)).toBe('downloading …')
    expect(desktopUpdateLabel({ kind: 'ready', version: '0.3.1' }, labels)).toBe('ready 0.3.1')
  })

  it('classifies recoverable manifest, signature, network, and installation failures', () => {
    expect(classifyDesktopUpdateFailure(new Error('request timed out'))).toBe('network')
    expect(classifyDesktopUpdateFailure(new Error('invalid JSON manifest'))).toBe('manifest')
    expect(classifyDesktopUpdateFailure(new Error('signature verification failed'))).toBe('verification')
    expect(classifyDesktopUpdateFailure(new Error('installer failed'))).toBe('install')
  })

  it('keeps the update action user-confirmed and reports the download/install lifecycle', async () => {
    const update = fakeUpdate()
    let downloadCalls = 0
    let installCalls = 0
    const adapter: DesktopUpdaterAdapter = {
      check: async () => update,
      download: async (_candidate, onProgress) => {
        downloadCalls += 1
        onProgress(50, 100)
      },
      install: async () => { installCalls += 1 },
    }
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(true)
    const dispose = mountDesktopUpdater(labels, adapter)
    await vi.advanceTimersByTimeAsync(1_500)
    await settle()
    const button = document.getElementById('dsh-desktop-updater') as HTMLButtonElement
    expect(button.textContent).toBe('available 0.3.1')
    button.click()
    await settle()
    expect(downloadCalls).toBe(0)
    expect(button.textContent).toBe('available 0.3.1')
    button.click()
    await settle()
    expect(downloadCalls).toBe(1)
    expect(button.textContent).toBe('ready 0.3.1')
    button.click()
    await settle()
    expect(installCalls).toBe(1)
    dispose()
  })

  it('preserves retryable network, signature, and installation failure states', async () => {
    const update = fakeUpdate()
    const adapter: DesktopUpdaterAdapter = {
      check: async () => update,
      download: async (_candidate, _onProgress) => { throw new Error('invalid signature') },
      install: async () => { throw new Error('installer failed') },
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const dispose = mountDesktopUpdater(labels, adapter)
    await vi.advanceTimersByTimeAsync(1_500)
    await settle()
    const button = document.getElementById('dsh-desktop-updater') as HTMLButtonElement
    button.click()
    await settle()
    expect(button.textContent).toBe('verification failure')
    dispose()

    const installAdapter: DesktopUpdaterAdapter = {
      check: async () => update,
      download: async () => {},
      install: async () => { throw new Error('installer failed') },
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const disposeInstall = mountDesktopUpdater(labels, installAdapter)
    await vi.advanceTimersByTimeAsync(1_500)
    await settle()
    const installButton = document.getElementById('dsh-desktop-updater') as HTMLButtonElement
    installButton.click()
    await settle()
    expect(installButton.textContent).toBe('ready 0.3.1')
    installButton.click()
    await settle()
    expect(installButton.textContent).toBe('install failure')
    disposeInstall()

    const networkAdapter: DesktopUpdaterAdapter = {
      check: async () => { throw new Error('request timed out') },
      download: async () => {},
      install: async () => {},
    }
    const disposeNetwork = mountDesktopUpdater(labels, networkAdapter)
    await vi.advanceTimersByTimeAsync(1_500)
    await settle()
    expect(document.getElementById('dsh-desktop-updater')?.textContent).toBe('network failure')
    disposeNetwork()
  })
})
