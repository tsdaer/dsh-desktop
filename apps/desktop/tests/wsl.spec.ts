import { describe, expect, it } from 'vitest'
import { detectWsl, parseWslList, probeDistribution } from '../bridge/src/wsl.ts'

describe('wsl list parsing', () => {
  it('parses the standard verbose table with a default marker', () => {
    const output = '  NAME            STATE           VERSION\n'
      + '* Ubuntu         Running         2\n'
      + '  docker-desktop  Stopped         2\n'
      + '  Legacy          Stopped         1\n'
    const rows = parseWslList(output)
    expect(rows).toEqual([
      { name: 'Ubuntu', default: true, version: 2 },
      { name: 'docker-desktop', default: false, version: 2 },
      { name: 'Legacy', default: false, version: 1 },
    ])
  })

  it('tolerates localized headers and names containing spaces', () => {
    const output = 'NAME               STATE           VERSION\n'
      + '* docker-desktop   Stopped         2\n'
      + '  docker-desktop-data Stopped       2\n'
    const rows = parseWslList(output)
    expect(rows).toEqual([
      { name: 'docker-desktop', default: true, version: 2 },
      { name: 'docker-desktop-data', default: false, version: 2 },
    ])
  })

  it('returns no rows for an empty or header-only listing', () => {
    expect(parseWslList('')).toEqual([])
    expect(parseWslList('NAME STATE VERSION')).toEqual([])
  })
})

describe('wsl detection', () => {
  it('reports ready with the default WSL 2 distribution', async () => {
    const run = async (args: readonly string[]) => {
      if (args[0] === '--status') return 'Default Version: 2'
      return '  NAME            STATE           VERSION\n* Ubuntu          Running         2\n'
    }
    const snapshot = await detectWsl(run)
    expect(snapshot.state).toBe('ready')
    expect(snapshot.defaultDistribution).toBe('Ubuntu')
    expect(snapshot.distributions).toEqual([{ name: 'Ubuntu', default: true, version: 2 }])
  })

  it('reports not-installed when the status command fails', async () => {
    const snapshot = await detectWsl(async () => null)
    expect(snapshot.state).toBe('not-installed')
    expect(snapshot.distributions).toEqual([])
  })

  it('reports no-distribution when the listing is empty', async () => {
    const run = async (args: readonly string[]) => args[0] === '--status' ? 'Default Version: 2' : ''
    const snapshot = await detectWsl(run)
    expect(snapshot.state).toBe('no-distribution')
  })

  it('reports wsl1-only when only WSL 1 distributions exist', async () => {
    const run = async (args: readonly string[]) => {
      if (args[0] === '--status') return 'Default Version: 1'
      return '  NAME   STATE    VERSION\n  Old    Stopped  1\n'
    }
    const snapshot = await detectWsl(run)
    expect(snapshot.state).toBe('wsl1-only')
  })

  it('reports error when the list command fails', async () => {
    const run = async (args: readonly string[]) => args[0] === '--status' ? 'Default Version: 2' : null
    const snapshot = await detectWsl(run)
    expect(snapshot.state).toBe('error')
  })
})

describe('wsl distribution probe', () => {
  it('accepts a distribution whose probe echoes the marker', async () => {
    const run = async () => 'dsh-wsl-probe'
    await expect(probeDistribution('Ubuntu', run)).resolves.toBe(true)
  })

  it('rejects a distribution whose probe fails', async () => {
    await expect(probeDistribution('missing', async () => null)).resolves.toBe(false)
  })
})
