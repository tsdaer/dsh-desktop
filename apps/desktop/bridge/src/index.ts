// @deepseek-ai/dsh-desktop-bridge — host half of the shell bridge.
// POST /dsh-bridge/drop with `{ sessionId, paths: string[] }` copies each
// existing, size-valid dropped file into the session workspace's drops/
// directory and injects one announcement user message into that session's
// log. The announcement is a plain user/message event, so it is durable,
// model-visible, and replayable without any new session event type; the copy
// keeps the file inside the workspace sandbox the agent's fs tools see.
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'

/** Stable Cordis plugin name. */
export const name = 'desktop-bridge'

/** Services required before the route can serve. */
export const inject = ['webServer', 'workspaceRegistry', 'sessions']

/** Durable settings namespace for the bridge policy ($DSH_HOME/settings.yaml, same seam as every other setting). */
export const BRIDGE_SETTINGS_NS = 'desktop-bridge' as SettingsNamespace

/** Bridge policy: which dropped files are accepted. */
export interface Config {
  /** Extension allowlist (lowercase, no dot); empty array allows every extension. */
  allowedExtensions: string[]
  /** Maximum accepted file size in bytes. */
  maxBytes: number
}

export const Config: z<Config> = z.object({
  allowedExtensions: z.array(z.string()).default([]),
  maxBytes: z.natural().default(50 * 1024 * 1024),
})


/** Cap on the JSON request body (base64 payloads, so roomier than the file cap). */
const MAX_BODY_BYTES = 80 * 1024 * 1024

/** Directory (relative to the session workspace) receiving dropped files. */
const DROPS_DIR = 'drops'

// Dedupe window: identical announcements within this span are appended once
// (a duplicated POST from the page must not duplicate the context entry).
const APPEND_DEDUPE_MS = 10_000
const lastAppend = new Map<string, number>()

/** One uploaded file: sanitized name plus base64 content (bytes, not paths — WebView2 exposes no File.path). */
interface DropFile {
  name: string
  base64: string
}

/** One drop request: the target session id and uploaded files. */
interface DropRequest {
  sessionId?: unknown
  files?: unknown
}

/**
 * Mount the bridge route and announce drops to the owning agent.
 * @param ctx - the root context (webServer, workspaceRegistry, agents).
 */
/**
 * Mount the bridge routes and announce accepted drops to the session log.
 * @param ctx - the root context (webServer, workspaceRegistry, sessions).
 * @param config - the bridge policy (extension allowlist, size cap).
 */
/**
 * Resolve the effective policy: the durable settings section layered over
 * the plugin config (schema defaults < entry config < user document). Read
 * per request so settings-page saves take effect immediately.
 */
function effectiveConfig(ctx: Context, config: Config): Config {
  const settings = ctx.get('settings')
  const section = settings?.get(BRIDGE_SETTINGS_NS) as Partial<Config> | undefined
  return {
    allowedExtensions: section?.allowedExtensions ?? config.allowedExtensions,
    maxBytes: section?.maxBytes ?? config.maxBytes,
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
  if (pathname === '/dsh-bridge/drop') {
    await handleDrop(req, res, ctx, effective)
    return
  }
  if (pathname === '/dsh-bridge/config') {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    json(res, 200, { allowedExtensions: effective.allowedExtensions, maxBytes: effective.maxBytes })
    return
  }
  json(res, 404, { error: 'not found' })
}

async function handleDrop(req: IncomingMessage, res: ServerResponse, ctx: Context, config: Config): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    const payload = JSON.parse(await readBody(req)) as DropRequest
    const rawFiles = payload.files
    const files = Array.isArray(rawFiles)
      ? rawFiles.filter((f): f is DropFile => {
        return typeof f === 'object' && f !== null
            && typeof (f as { name?: unknown }).name === 'string'
            && typeof (f as { base64?: unknown }).base64 === 'string'
      })
      : []
    if (typeof payload.sessionId !== 'string') {
      json(res, 400, { error: 'sessionId is required' })
      return
    }
    if (files.length === 0) {
      json(res, 400, { error: 'files is required' })
      return
    }
    const sessionId = payload.sessionId as SessionId
    const workspace = ctx.workspaceRegistry.list().find(w => w.sessionIds.includes(sessionId))
    if (workspace === undefined) {
      json(res, 404, { error: 'session workspace not found' })
      return
    }
    const dropsDir = join(workspace.path, DROPS_DIR)
    await mkdir(dropsDir, { recursive: true })
    const copied: string[] = []
    for (const file of files) {
      try {
        const data = Buffer.from(file.base64, 'base64')
        if (data.length > config.maxBytes) continue
        const name = sanitizeName(file.name)
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        if (config.allowedExtensions.length > 0 && !config.allowedExtensions.includes(ext)) continue
        await writeFile(join(dropsDir, name), data)
        copied.push(`${DROPS_DIR}/${name}`)
      } catch {
        // malformed base64 or oversized file: skip it
      }
    }
    if (copied.length === 0) {
      json(res, 400, { error: 'no valid files to copy' })
      return
    }
    // Append the announcement straight into the session log: it renders in
    // the conversation immediately, is durable, and becomes model history on
    // the next derivation (agent.inject would sit unclaimed until the next
    // turn, showing nothing). Hand-rolled UserMessage: the only runtime
    // dependency (dsh-llm's createUserMessage) would need registry
    // resolution in the installed profile, so the id is minted here and the
    // type imported type-only.
    const session = ctx.sessions.get(sessionId)
    if (session !== undefined) {
      const signature = `${sessionId}:${copied.join(',')}`
      const now = Date.now()
      const last = lastAppend.get(signature)
      if (last !== undefined && now - last < APPEND_DEDUPE_MS) {
        json(res, 200, { copied, appended: false, deduped: true })
        return
      }
      lastAppend.set(signature, now)
      const message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: `已拖入文件：${copied.join('、')}` }],
        source: { kind: 'plugin', plugin: 'dsh-desktop-bridge' },
      } as unknown as UserMessage
      session.append('user/message', message, { surfaceOp: 'append' })
    }
    json(res, 200, { copied, appended: session !== undefined })
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Strip path separators and forbidden filename characters from a basename. */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_')
  return cleaned === '' ? 'drop' : cleaned
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
