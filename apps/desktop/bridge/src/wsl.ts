// WSL 2 discovery for the desktop settings card (P4a of the Desktop 0.4 plan).
//
// Detection runs bounded native commands and returns a typed snapshot; it
// never installs WSL, changes a distribution version, changes the Windows
// default distribution, or downloads a distribution. Parsing is isolated
// behind fixtures for localized and legacy output. This module is
// Windows-only in practice: wsl.exe is the Windows binary.

import { spawn } from 'node:child_process'

/** The typed WSL readiness snapshot the settings card renders. */
export type WslState =
  | 'not-installed'
  | 'no-distribution'
  | 'wsl1-only'
  | 'ready'
  | 'error'

/** One eligible WSL 2 distribution row from `wsl --list --verbose`. */
export interface WslDistribution {
  /** Distribution name, the `--distribution` argument. */
  name: string
  /** Whether this distribution is the Windows default. */
  default: boolean
  /** `2` for WSL 2, `1` for WSL 1. */
  version: 1 | 2
}

/** The complete detection snapshot. */
export interface WslSnapshot {
  state: WslState
  /** Eligible WSL 2 distributions, empty unless state is `ready`. */
  distributions: readonly WslDistribution[]
  /** The current default distribution name, when one is WSL 2. */
  defaultDistribution?: string
  /** Human-readable failure detail, present when state is `error`. */
  error?: string
}

/** Maximum output bytes one wsl.exe command may produce. */
const MAX_COMMAND_BYTES = 64 * 1024
/** Maximum time one wsl.exe command may take. */
const COMMAND_TIMEOUT_MS = 5_000

/**
 * Run one wsl.exe command with a bounded timeout and output cap.
 * @param args - the wsl.exe arguments.
 * @returns stdout text, or null when the command failed or timed out.
 */
export function runWslCommand(args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: import('node:child_process').ChildProcess | null = null
    let settled = false
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child?.kill()
      resolve(null)
    }, COMMAND_TIMEOUT_MS)
    try {
      child = spawn('wsl.exe', args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      clearTimeout(timer)
      resolve(null)
      return
    }
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    })
    const stdout = child.stdout
    stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > MAX_COMMAND_BYTES) {
        settled = true
        clearTimeout(timer)
        child?.kill()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        resolve(null)
        return
      }
      // System commands (--status, --list) emit UTF-16LE text with NUL
      // bytes; --exec output is the distribution's own native encoding
      // (UTF-8 for echo). Decode as UTF-8 first — a NUL byte means the
      // payload is UTF-16LE, so fall back to that with NUL stripping.
      const raw = Buffer.concat(chunks)
      const utf8 = raw.toString('utf8')
      if (!utf8.includes('\u0000')) {
        resolve(utf8)
        return
      }
      resolve(raw.toString('utf16le').replace(/\u0000/g, ''))
    })
  })
}

/**
 * Parse `wsl --list --verbose` output into distribution rows, tolerating
 * localized headers and legacy column layouts.
 * @param output - the wsl.exe output (decoded, NUL-stripped).
 * @returns the parsed distribution rows.
 */
export function parseWslList(output: string): WslDistribution[] {
  const rows: WslDistribution[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    // Header rows contain the localized column names; skip them by
    // requiring a trailing 1 or 2 version digit.
    const versionMatch = line.match(/\s([12])\s*$/)
    if (versionMatch === null) continue
    const version = versionMatch[1] === '1' ? 1 : 2
    const isDefault = line.startsWith('*')
    const namePart = (isDefault ? line.slice(1) : line).trim()
    const tokens = namePart.split(/\s+/)
    if (tokens.length < 3) continue
    // The name is everything before the STATE column; state is one
    // token and the version is the final digit. Distribution names may
    // contain spaces (docker-desktop data).
    const name = tokens.slice(0, -2).join(' ')
    if (name.length === 0) continue
    rows.push({ name, default: isDefault, version })
  }
  return rows
}

/**
 * Detect the WSL readiness state on this machine.
 * @param run - the bounded command runner, injectable for tests.
 * @returns the typed snapshot.
 */
export async function detectWsl(
  run: (args: readonly string[]) => Promise<string | null> = runWslCommand,
): Promise<WslSnapshot> {
  const status = await run(['--status'])
  if (status === null) {
    // wsl.exe missing or failed: not installed (or an unrecognized error).
    return { state: 'not-installed', distributions: [] }
  }
  const list = await run(['--list', '--verbose'])
  if (list === null) {
    return { state: 'error', distributions: [], error: 'wsl --list --verbose failed' }
  }
  const rows = parseWslList(list)
  const wsl2 = rows.filter(row => row.version === 2)
  const wsl1 = rows.filter(row => row.version === 1)
  if (wsl2.length === 0) {
    if (wsl1.length > 0) return { state: 'wsl1-only', distributions: [] }
    if (rows.length === 0) return { state: 'no-distribution', distributions: [] }
    return { state: 'wsl1-only', distributions: [] }
  }
  const defaultRow = wsl2.find(row => row.default) ?? wsl2[0]
  const snapshot: WslSnapshot = {
    state: 'ready',
    distributions: wsl2,
  }
  if (defaultRow !== undefined) snapshot.defaultDistribution = defaultRow.name
  return snapshot
}

/**
 * Probe one distribution to confirm it can execute commands, rather than
 * trusting the inventory alone.
 * @param distribution - the distribution name.
 * @param run - the bounded command runner, injectable for tests.
 * @returns whether the distribution accepted a command.
 */
export async function probeDistribution(
  distribution: string,
  run: (args: readonly string[]) => Promise<string | null> = runWslCommand,
): Promise<boolean> {
  const result = await run(['--distribution', distribution, '--exec', 'echo', 'dsh-wsl-probe'])
  return result !== null && result.includes('dsh-wsl-probe')
}
