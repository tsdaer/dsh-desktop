// @deepseek-ai/dsh-desktop-bridge — host half of the shell bridge.
//
// Routes under /dsh-bridge:
// - GET /dsh-bridge/config — the effective desktop settings (close-to-tray
//   behavior + debug mode), read per request so settings-page saves take
//   effect immediately.
// - POST /dsh-bridge/policy — persist desktop settings through the runtime's
//   settings seam (the dsh configuration boundary refuses browser writes to
//   non-listed namespaces, so saves go through this route).
// - GET /dsh-bridge/balance — resolve the DeepSeek key through the runtime's
//   credentials seam and proxy the official /user/balance endpoint for the
//   title bar's balance pill.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'desktop-bridge'

/** Services required before the route can serve. */
export const inject = ['webServer']

/** Durable settings namespace for the desktop settings ($DSH_HOME/settings.yaml, same seam as every other setting). */
export const BRIDGE_SETTINGS_NS = 'desktop-bridge' as SettingsNamespace

/** Desktop settings: shell behavior the page can read and persist. */
export interface Config {
  /** When true, closing the main window hides it to the system tray instead of exiting (the tray menu holds the real exit). */
  closeToTray: boolean
  /** Debug mode: when off, the page suppresses right-click and devtools shortcuts; when on they stay available. */
  debugMode: boolean
}

export const Config: z<Config> = z.object({
  closeToTray: z.boolean().default(false),
  debugMode: z.boolean().default(false),
})

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
  }
}

export function apply(ctx: Context, config: Config): void {
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
      const body = JSON.parse(await readBody(req)) as { closeToTray?: unknown; debugMode?: unknown }
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
    json(res, 200, { closeToTray: effective.closeToTray, debugMode: effective.debugMode })
    return
  }
  if (pathname === '/dsh-bridge/balance') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    await handleBalance(res, ctx)
    return
  }
  json(res, 404, { error: 'not found' })
}

/** One balance entry from the DeepSeek /user/balance response. */
interface BalanceInfo {
  currency: string
  total_balance: string
}

function isBalanceInfo(value: unknown): value is BalanceInfo {
  if (typeof value !== 'object' || value === null) return false
  const info = value as Record<string, unknown>
  return typeof info.currency === 'string' && typeof info.total_balance === 'string'
}

/** Timeout for the upstream DeepSeek balance request. */
const BALANCE_TIMEOUT_MS = 10_000

/** Public DeepSeek API base (the llm-deepseek provider default). */
const PUBLIC_API_BASE = 'https://api.deepseek.com'

/** Credential reference for balance reads: the llm-deepseek provider default. */
const BALANCE_KEY_REF = credentialRef('DEEPSEEK_API_KEY')

/**
 * Resolve the DeepSeek API key through the runtime's credentials seam (the
 * same reference and ordering the llm-deepseek provider uses: managed store
 * first, ambient environment as the no-seam fallback). The value never
 * leaves this process.
 */
async function resolveBalanceKey(ctx: Context): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    return (await credentials.resolve(BALANCE_KEY_REF))?.value
  }
  const ambient = process.env.DEEPSEEK_API_KEY
  return ambient !== undefined && ambient.length > 0 ? ambient : undefined
}

/**
 * Serve GET /dsh-bridge/balance: proxy the DeepSeek /user/balance endpoint
 * with the runtime's own key and return a normalized amount. Failures stay
 * a 200 with a machine-readable reason so the title bar renders them as a
 * hidden/muted state instead of logging fetch errors.
 */
async function handleBalance(res: ServerResponse, ctx: Context): Promise<void> {
  try {
    const key = await resolveBalanceKey(ctx)
    if (key === undefined) {
      json(res, 200, { ok: false, reason: 'unconfigured' })
      return
    }
    const base = (process.env.DEEPSEEK_BASE_URL ?? PUBLIC_API_BASE).replace(/\/+$/, '')
    const response = await fetch(base + '/user/balance', {
      headers: { authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
    })
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? 'auth' : 'api'
      json(res, 200, { ok: false, reason, status: response.status })
      return
    }
    const body = await response.json() as { is_available?: unknown; balance_infos?: unknown }
    const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
    const first = infos.find(isBalanceInfo)
    if (first === undefined) {
      json(res, 200, { ok: false, reason: 'api', message: 'balance response missing balance_infos' })
      return
    }
    json(res, 200, {
      ok: true,
      available: body.is_available === true,
      currency: first.currency,
      totalBalance: first.total_balance,
    })
  } catch (err) {
    json(res, 200, { ok: false, reason: 'network', message: err instanceof Error ? err.message : String(err) })
  }
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
