// @deepseek-ai/dsh-desktop-bridge — host half of the shell bridge.
//
// Routes under /dsh-bridge:
// - GET /dsh-bridge/config — the effective desktop settings (close-to-tray
//   behavior, debug mode, and Logo hover motion), read per request so settings-page saves take
//   effect immediately.
// - POST /dsh-bridge/policy — persist desktop settings through the runtime's
//   settings seam (the dsh configuration boundary refuses browser writes to
//   non-listed namespaces, so saves go through this route).
// - GET /dsh-bridge/account-summary — resolve the authoritative model
//   selection for the active session and query the selected provider's
//   account summary through its adapter. The provider and credential never
//   come from the browser.
// - GET /dsh-bridge/wsl/detect — detect WSL 2 readiness (typed snapshot).
// - POST /dsh-bridge/wsl/probe — probe one WSL 2 distribution for command
//   execution.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { resolveAccountSummary } from './account-summary.ts'
import { detectWsl, probeDistribution } from './wsl.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-subprocess'
import { handleExplorerRequest } from './explorer.ts'
import { handleFileViewRequest } from './file.ts'
import { handleSearchRequest } from './search.ts'
import { handleSourceControlActionRequest, handleSourceControlDiffRequest } from './source-control-actions.ts'
import { handleSourceControlRequest } from './source-control.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-bridge'

/** Services required before the bridge routes can serve. */
export const inject = ['webServer', 'fs', 'workspaceRegistry', 'subprocess']

/** Durable settings namespace for the desktop settings ($DSH_HOME/settings.yaml, same seam as every other setting). */
export const BRIDGE_SETTINGS_NS = 'desktop-bridge' as SettingsNamespace

/** Desktop settings: shell behavior the page can read and persist. */
export interface Config {
  /** When true, closing the main window hides it to the system tray instead of exiting (the tray menu holds the real exit). */
  closeToTray: boolean
  /** Debug mode: when off, the page suppresses right-click and devtools shortcuts; when on they stay available. */
  debugMode: boolean
  /** Explicitly allow the new-session Logo hover animation when the system requests reduced motion. */
  logoMotion: boolean
  /** Maximum Explorer children projected for one directory request. */
  explorerMaxEntries: number
  /** Maximum UTF-8 JSON bytes projected for one Explorer response. */
  explorerMaxBytes: number
  /** Maximum elapsed time for one Explorer request. */
  explorerTimeoutMs: number
  /** Maximum UTF-8 bytes served for one file view; larger files return a truncated prefix. */
  fileMaxBytes: number
  /** Maximum elapsed time for one file view request. */
  fileTimeoutMs: number
  /** Maximum matches returned by one Search page. */
  searchMaxMatches: number
  /** Maximum UTF-8 JSON bytes returned by one Search page. */
  searchMaxBytes: number
  /** Maximum raw ripgrep output retained for one Search page. */
  searchMaxRawBytes: number
  /** Maximum file size ripgrep will inspect. */
  searchMaxFileBytes: number
  /** Process termination grace for Search. */
  searchGraceMs: number
  /** Maximum elapsed time for one Search request. */
  searchTimeoutMs: number
  /** Maximum Source Control entries projected for one request. */
  sourceControlMaxEntries: number
  /** Maximum UTF-8 JSON bytes projected for one Source Control response. */
  sourceControlMaxBytes: number
  /** Process termination grace for Source Control. */
  sourceControlGraceMs: number
  /** Maximum elapsed time for one Source Control request. */
  sourceControlTimeoutMs: number
  /** Maximum one-side diff bytes read for the Source Control diff route. */
  sourceControlMaxDiffBytes: number
  /** Whether Bash over WSL 2 is enabled for this desktop profile. */
  wslEnabled: boolean
  /** The selected WSL 2 distribution for Bash, when enabled. */
  wslDistribution: string
}

export const Config: z<Config> = z.object({
  closeToTray: z.boolean().default(false),
  debugMode: z.boolean().default(false),
  logoMotion: z.boolean().default(false),
  wslEnabled: z.boolean().default(false),
  wslDistribution: z.string().default(''),
  explorerMaxEntries: z.number().default(256),
  explorerMaxBytes: z.number().default(128 * 1024),
  explorerTimeoutMs: z.number().default(5_000),
  fileMaxBytes: z.number().default(256 * 1024),
  fileTimeoutMs: z.number().default(5_000),
  searchMaxMatches: z.number().default(50),
  searchMaxBytes: z.number().default(128 * 1024),
  searchMaxRawBytes: z.number().default(2 * 1024 * 1024),
  searchMaxFileBytes: z.number().default(2 * 1024 * 1024),
  searchGraceMs: z.number().default(1_000),
  searchTimeoutMs: z.number().default(5_000),
  sourceControlMaxEntries: z.number().default(256),
  sourceControlMaxBytes: z.number().default(128 * 1024),
  sourceControlGraceMs: z.number().default(1_000),
  sourceControlTimeoutMs: z.number().default(5_000),
  sourceControlMaxDiffBytes: z.number().default(256 * 1024),
})

function validateExplorerConfig(config: Config): void {
  if (!Number.isSafeInteger(config.explorerMaxEntries) || config.explorerMaxEntries <= 0) {
    throw new Error('desktop-bridge: explorerMaxEntries must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.explorerMaxBytes) || config.explorerMaxBytes <= 0) {
    throw new Error('desktop-bridge: explorerMaxBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.explorerTimeoutMs) || config.explorerTimeoutMs <= 0) {
    throw new Error('desktop-bridge: explorerTimeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.fileMaxBytes) || config.fileMaxBytes <= 0) {
    throw new Error('desktop-bridge: fileMaxBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.fileTimeoutMs) || config.fileTimeoutMs <= 0) {
    throw new Error('desktop-bridge: fileTimeoutMs must be a positive safe integer')
  }
  for (const [name, value] of Object.entries({
    searchMaxMatches: config.searchMaxMatches,
    searchMaxBytes: config.searchMaxBytes,
    searchMaxRawBytes: config.searchMaxRawBytes,
    searchMaxFileBytes: config.searchMaxFileBytes,
    searchGraceMs: config.searchGraceMs,
    searchTimeoutMs: config.searchTimeoutMs,
    sourceControlMaxEntries: config.sourceControlMaxEntries,
    sourceControlMaxBytes: config.sourceControlMaxBytes,
    sourceControlGraceMs: config.sourceControlGraceMs,
    sourceControlTimeoutMs: config.sourceControlTimeoutMs,
    sourceControlMaxDiffBytes: config.sourceControlMaxDiffBytes,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`desktop-bridge: ${name} must be a positive safe integer`)
  }
}

/** Cap on the JSON request body (small; settings only). */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Resolve the effective settings: the durable settings section layered over
 * the plugin config (schema defaults < entry config < user document). Read
 * per request so settings-page saves take effect immediately.
 */
function effectiveConfig(ctx: Context, config: Config): Config {
  const settings = ctx.get('settings')
  const section = settings?.get(BRIDGE_SETTINGS_NS) as Partial<Config> | undefined
  return {
    closeToTray: section?.closeToTray ?? config.closeToTray,
    debugMode: section?.debugMode ?? config.debugMode,
    logoMotion: section?.logoMotion ?? config.logoMotion,
    wslEnabled: section?.wslEnabled ?? config.wslEnabled,
    wslDistribution: section?.wslDistribution ?? config.wslDistribution,
    explorerMaxEntries: config.explorerMaxEntries,
    explorerMaxBytes: config.explorerMaxBytes,
    explorerTimeoutMs: config.explorerTimeoutMs,
    fileMaxBytes: config.fileMaxBytes,
    fileTimeoutMs: config.fileTimeoutMs,
    searchMaxMatches: config.searchMaxMatches,
    searchMaxBytes: config.searchMaxBytes,
    searchMaxRawBytes: config.searchMaxRawBytes,
    searchMaxFileBytes: config.searchMaxFileBytes,
    searchGraceMs: config.searchGraceMs,
    searchTimeoutMs: config.searchTimeoutMs,
    sourceControlMaxEntries: config.sourceControlMaxEntries,
    sourceControlMaxBytes: config.sourceControlMaxBytes,
    sourceControlGraceMs: config.sourceControlGraceMs,
    sourceControlTimeoutMs: config.sourceControlTimeoutMs,
    sourceControlMaxDiffBytes: config.sourceControlMaxDiffBytes,
  }
}

export function apply(ctx: Context, config: Config): void {
  validateExplorerConfig(config)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(BRIDGE_SETTINGS_NS, Config)
  })
  ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-bridge',
    handler: (req, res) => void handle(req, res, ctx, config),
  })
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Context, config: Config): Promise<void> {
  const effective = effectiveConfig(ctx, config)
  const pathname = (req.url ?? '').split('?')[0] ?? ''
  if (pathname === '/dsh-bridge/policy') {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    try {
      const body = JSON.parse(await readBody(req)) as {
        closeToTray?: unknown
        debugMode?: unknown
        logoMotion?: unknown
        wslEnabled?: unknown
        wslDistribution?: unknown
      }
      const settings = ctx.get('settings')
      if (settings === undefined) {
        json(res, 500, { error: 'settings service unavailable' })
        return
      }
      const ops: Array<{ op: 'set'; path: string[]; value: unknown }> = []
      if (typeof body.closeToTray === 'boolean') {
        ops.push({ op: 'set', path: ['closeToTray'], value: body.closeToTray })
      }
      if (typeof body.debugMode === 'boolean') {
        ops.push({ op: 'set', path: ['debugMode'], value: body.debugMode })
      }
      if (typeof body.logoMotion === 'boolean') {
        ops.push({ op: 'set', path: ['logoMotion'], value: body.logoMotion })
      }
      if (typeof body.wslEnabled === 'boolean') {
        ops.push({ op: 'set', path: ['wslEnabled'], value: body.wslEnabled })
      }
      if (typeof body.wslDistribution === 'string') {
        ops.push({ op: 'set', path: ['wslDistribution'], value: body.wslDistribution })
      }
      if (ops.length === 0) {
        json(res, 400, { error: 'no valid fields to save' })
        return
      }
      await settings.mutate(BRIDGE_SETTINGS_NS, ops)
      json(res, 200, { ok: true })
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  if (pathname === '/dsh-bridge/config') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    json(res, 200, {
      closeToTray: effective.closeToTray,
      debugMode: effective.debugMode,
      logoMotion: effective.logoMotion,
      wslEnabled: effective.wslEnabled,
      wslDistribution: effective.wslDistribution,
    })
    return
  }
  if (pathname === '/dsh-bridge/account-summary') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleAccountSummary(req, res, ctx)
    return
  }
  if (pathname === '/dsh-bridge/wsl/detect') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    const snapshot = await detectWsl()
    json(res, 200, snapshot)
    return
  }
  if (pathname === '/dsh-bridge/wsl/probe') {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const distribution = url.searchParams.get('distribution') ?? ''
    if (distribution.length === 0) {
      json(res, 400, { error: 'distribution is required' })
      return
    }
    const ok = await probeDistribution(distribution)
    json(res, 200, { ok })
    return
  }
  if (pathname === '/dsh-bridge/worktree/explorer') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleExplorerRequest(req, res, ctx, config)
    return
  }
  if (pathname === '/dsh-bridge/worktree/file') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleFileViewRequest(req, res, ctx, config)
    return
  }
  if (pathname === '/dsh-bridge/worktree/search') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleSearchRequest(req, res, ctx, config)
    return
  }
  if (pathname === '/dsh-bridge/worktree/source-control') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleSourceControlRequest(req, res, ctx, config)
    return
  }
  if (pathname === '/dsh-bridge/worktree/source-control/diff') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleSourceControlDiffRequest(req, res, ctx, config)
    return
  }
  const mutations: Array<[string, 'stage' | 'unstage' | 'discard' | 'commit']> = [
    ['/dsh-bridge/worktree/source-control/stage', 'stage'],
    ['/dsh-bridge/worktree/source-control/unstage', 'unstage'],
    ['/dsh-bridge/worktree/source-control/discard', 'discard'],
    ['/dsh-bridge/worktree/source-control/commit', 'commit'],
  ]
  for (const [path, operation] of mutations) {
    if (pathname !== path) continue
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleSourceControlActionRequest(req, res, ctx, config, operation)
    return
  }
  json(res, 404, { error: 'not found' })
}

/**
 * Serve GET /dsh-bridge/account-summary: resolve the authoritative model
 * selection for the active session, then query the selected provider
 * adapter for its account summary.
 *
 * Query parameters: sessionId (current session), providerId (browser view
 * of the selected provider), generation (browser-side selection counter
 * echoed back so an older fetch cannot overwrite a newer selection).
 */
async function handleAccountSummary(req: IncomingMessage, res: ServerResponse, ctx: Context): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sessionId = url.searchParams.get('sessionId') ?? ''
  const requestedProvider = url.searchParams.get('providerId') ?? ''
  const generation = url.searchParams.get('generation') ?? ''
  if (sessionId.length === 0 || generation.length === 0) {
    json(res, 400, { error: 'sessionId and generation are required' })
    return
  }
  const body = await resolveAccountSummary(ctx, sessionId as SessionId, requestedProvider, generation)
  json(res, 200, body)
}


/** Collect the request body up to {@link MAX_BODY_BYTES}. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Write a small JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
