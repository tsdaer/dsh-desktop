// @deepseek-ai/dsh-desktop-bridge — host half of the shell bridge.
// POST /dsh-bridge/drop with `{ sessionId, files: [{ name, base64?, size? }] }`
// (WebView2 exposes no File.path, so bytes travel instead of paths;
// oversized files travel as metadata only). Per the user's drop rules:
//
// 1. image files → native pipeline (the page's composer intake; the shell
//    never sends images here).
// 2. non-binary files within the size cap and with copy enabled → copied
//    into the session workspace ROOT (repeated drops overwrite, so re-
//    dropping updates the file).
// 3. binary files, oversized files, or drops while copy is disabled → the
//    file is NOT copied; the announcement names the file and the reason.
//
// One announcement user message is injected into the session log: durable,
// model-visible, and replayable without any new session event type; the
// copy keeps the file inside the workspace sandbox the agent's fs tools
// see.
import { writeFile } from 'node:fs/promises'
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

/** Bridge policy: how dropped non-image files are handled. */
export interface Config {
  /** Master switch: when off, every non-image drop is announced as a reference instead of a copy. */
  copyEnabled: boolean
  /** Maximum accepted file size in bytes (non-image files only). */
  maxBytes: number
}

export const Config: z<Config> = z.object({
  copyEnabled: z.boolean().default(true),
  maxBytes: z.natural().default(50 * 1024 * 1024),
})

/** Cap on the JSON request body (base64 payloads, so roomier than the file cap). */
const MAX_BODY_BYTES = 80 * 1024 * 1024

/** How many bytes of a file are scanned for binary detection. */
const BINARY_SNIFF_BYTES = 8192

// Dedupe window: identical announcements within this span are appended once
// (a duplicated POST from the page must not duplicate the context entry).
const APPEND_DEDUPE_MS = 10_000
const lastAppend = new Map<string, number>()

/** One uploaded file: name plus base64 content. Oversized files travel as metadata only (no base64). */
interface DropFile {
  name: string
  size?: number
  base64?: string
}

/** One drop request: the target session id and uploaded files. */
interface DropRequest {
  sessionId?: unknown
  files?: unknown
}

/**
 * Resolve the effective policy: the durable settings section layered over
 * the plugin config (schema defaults < entry config < user document). Read
 * per request so settings-page saves take effect immediately.
 */
function effectiveConfig(ctx: Context, config: Config): Config {
  const settings = ctx.get('settings')
  const section = settings?.get(BRIDGE_SETTINGS_NS) as Partial<Config> | undefined
  return {
    copyEnabled: section?.copyEnabled ?? config.copyEnabled,
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
  if (pathname === '/dsh-bridge/policy') {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    try {
      const body = JSON.parse(await readBody(req)) as { copyEnabled?: unknown; maxBytes?: unknown }
      const settings = ctx.get('settings')
      if (settings === undefined) {
        json(res, 500, { error: 'settings service unavailable' })
        return
      }
      // Host-side write: the dsh configuration boundary (apiproxy's exposed
      // namespace allowlist) refuses browser writes to non-listed namespaces,
      // so the settings row saves through this route instead of the client
      // settingsScope (which would swallow the refusal as a silent no-op).
      const ops: Array<{ op: 'set'; path: string[]; value: unknown }> = []
      if (typeof body.copyEnabled === 'boolean') {
        ops.push({ op: 'set', path: ['copyEnabled'], value: body.copyEnabled })
      }
      if (typeof body.maxBytes === 'number' && Number.isFinite(body.maxBytes) && body.maxBytes > 0) {
        ops.push({ op: 'set', path: ['maxBytes'], value: body.maxBytes })
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
    json(res, 200, { copyEnabled: effective.copyEnabled, maxBytes: effective.maxBytes })
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
            && ((f as { base64?: unknown }).base64 === undefined || typeof (f as { base64?: unknown }).base64 === 'string')
            && ((f as { size?: unknown }).size === undefined || typeof (f as { size?: unknown }).size === 'number')
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
    const copied: string[] = []
    const referenced: Array<{ name: string; reason: string }> = []
    for (const file of files) {
      const name = sanitizeName(file.name)
      if (!config.copyEnabled) {
        referenced.push({ name, reason: '拖放复制已关闭' })
        continue
      }
      if (file.base64 === undefined) {
        // Metadata-only entry: the client skipped the upload because the
        // file is oversized; announce the reference without bytes.
        referenced.push({ name, reason: `超过大小上限 ${formatBytes(config.maxBytes)}` })
        continue
      }
      let data: Buffer
      try {
        data = Buffer.from(file.base64, 'base64')
      } catch {
        referenced.push({ name, reason: '无法读取' })
        continue
      }
      if (data.length > config.maxBytes) {
        referenced.push({ name, reason: `超过大小上限 ${formatBytes(config.maxBytes)}` })
        continue
      }
      if (isBinary(data)) {
        referenced.push({ name, reason: '二进制文件' })
        continue
      }
      // Copy into the workspace ROOT; writeFile overwrites, so repeated
      // drops of the same file update it.
      try {
        await writeFile(join(workspace.path, name), data)
        copied.push(name)
      } catch {
        referenced.push({ name, reason: '复制失败' })
      }
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
      const signature = `${sessionId}:${[...copied, ...referenced.map(r => r.name)].join(',')}`
      const now = Date.now()
      const last = lastAppend.get(signature)
      if (last !== undefined && now - last < APPEND_DEDUPE_MS) {
        json(res, 200, { copied, referenced, appended: false, deduped: true })
        return
      }
      lastAppend.set(signature, now)
      const message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: announceText(copied, referenced) }],
        source: { kind: 'plugin', plugin: 'dsh-desktop-bridge' },
      } as unknown as UserMessage
      session.append('user/message', message, { surfaceOp: 'append' })
    }
    json(res, 200, { copied, referenced, appended: session !== undefined })
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Binary detection: a NUL byte within the first 8 KiB marks the file binary. */
function isBinary(data: Buffer): boolean {
  return data.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

/** Human-readable byte size (bytes under 1 MiB, otherwise whole MiB). */
function formatBytes(bytes: number): string {
  return bytes < 1048576 ? `${bytes}B` : `${Math.round(bytes / 1048576)}MB`
}

/** Compose the drop announcement text (Chinese, matching the UI language). */
function announceText(copied: string[], referenced: Array<{ name: string; reason: string }>): string {
  const lines: string[] = []
  if (copied.length > 0) {
    lines.push(`已复制到项目根目录：${copied.join('、')}`)
  }
  if (referenced.length > 0) {
    lines.push(`提供文件（未复制）：${referenced.map(r => `${r.name}（${r.reason}）`).join('、')}`)
  }
  return lines.join('\n') || '拖入的文件为空'
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
