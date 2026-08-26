/**
 * Account-summary resolution for the desktop bridge.
 *
 * The host owns provider resolution: the provider comes from the active
 * session's durable request header (or the default model selection for a
 * blank session), never from the browser. The browser supplies only the
 * session id and its own view of the provider id; a disagreement resolves
 * to the authoritative provider, so the title bar can never show an amount
 * fetched for a provider that is not selected. The credential never leaves
 * this process — the provider adapter resolves it through the runtime
 * credential seam.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** The account-summary response body sent to the browser. */
export interface AccountSummaryResponse {
  ok: boolean
  sessionId: string
  providerId: string
  generation: string
  state: 'available' | 'unsupported' | 'unconfigured' | 'unavailable'
  amount?: string
  currency?: string
  reason?: string
}

/**
 * Resolve the authoritative provider for one session: the session's durable
 * request header when it has one, else the default model selection.
 * @param ctx - the runtime context carrying agents and agentDefaultModel.
 * @param sessionId - the active session identity.
 * @returns the authoritative provider id, or undefined when neither source
 * exists (no agent, no default).
 */
export function resolveAuthoritativeProvider(ctx: Context, sessionId: SessionId): string | undefined {
  const agents = ctx.get('agents')
  if (agents !== undefined) {
    const agent = agents.get(sessionId)
    if (agent !== undefined) {
      const logged = agent.session.requestHeader()?.config
      if (logged !== undefined && typeof logged.provider === 'string') {
        return logged.provider
      }
    }
  }
  const defaults = ctx.get('agentDefaultModel')
  const selection = defaults?.currentSelection()
  if (selection !== undefined && typeof selection.provider === 'string') {
    return selection.provider
  }
  return undefined
}

/**
 * Resolve the account summary for the authoritative provider of one session.
 * Failures and absent services normalize to a machine-readable unavailable.
 * @param ctx - the runtime context carrying llm.
 * @param sessionId - the active session identity.
 * @param requestedProvider - the browser's view of the selected provider.
 * @param generation - the browser's selection counter, echoed back.
 * @returns the normalized response body.
 */
export async function resolveAccountSummary(
  ctx: Context,
  sessionId: SessionId,
  requestedProvider: string,
  generation: string,
): Promise<AccountSummaryResponse> {
  const authoritative = resolveAuthoritativeProvider(ctx, sessionId)
  // Never trust the browser for the provider: use the authoritative one and
  // report it back so the client can reconcile its own snapshot.
  const provider = authoritative ?? requestedProvider
  const llm = ctx.get('llm')
  if (llm === undefined) {
    return { ok: false, sessionId: String(sessionId), providerId: provider, generation, state: 'unavailable', reason: 'no-llm' }
  }
  try {
    const summary = await llm.accountSummary(provider)
    return {
      ok: summary.state === 'available',
      sessionId: String(sessionId),
      providerId: summary.provider,
      generation,
      state: summary.state,
      ...summary.amount === undefined ? {} : { amount: summary.amount },
      ...summary.currency === undefined ? {} : { currency: summary.currency },
    }
  } catch (err) {
    return {
      ok: false,
      sessionId: String(sessionId),
      providerId: requestedProvider,
      generation,
      state: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
