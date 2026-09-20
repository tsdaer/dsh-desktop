/** Select a DeepSeek wire implementation from one validated configuration generation. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { AccountSummary, GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DeepSeekAdapterOptions } from './common/types.ts'
import { ChatCompletionsAdapter } from './protocols/chat-completions/adapter.ts'
import { DeepSeekFileStore } from './common/file-store.ts'
import { DeepSeekMessagesAdapter } from './protocols/messages/adapter.ts'

/** Timeout for the upstream DeepSeek account-balance request. */
const ACCOUNT_SUMMARY_TIMEOUT_MS = 10_000

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
/** One provider route with protocol-local transport and shared credentials and model configuration. */
export class DeepSeekAdapter extends LlmAdapter {
  private readonly files: DeepSeekFileStore

  constructor(private readonly dependencies: DeepSeekAdapterOptions) {
    super()
    this.files = dependencies.resolveFiles?.() ?? new DeepSeekFileStore()
  }

  private implementation(): LlmAdapter {
    const connection = this.dependencies.options()
    switch (connection.protocol) {
      case 'messages':
        return new DeepSeekMessagesAdapter({
          connection: () => connection,
          apiKey: this.dependencies.resolveApiKey,
          userId: this.dependencies.resolveUserId,
          attachments: () => this.dependencies.resolveAttachments?.(),
          imageAccess: (ref) => {
            const attachments = this.dependencies.resolveAttachments?.()
            return attachments === undefined ? undefined : this.dependencies.resolveImageAccess?.(attachments, ref)
          },
          files: () => this.files,
          prepareExtensions: this.dependencies.prepareExtensions,
          ...this.dependencies.onReplayDegrade === undefined ? {} : { onReplayDegrade: this.dependencies.onReplayDegrade },
        })
      case 'chat-completions':
        return new ChatCompletionsAdapter({ ...this.dependencies, options: () => connection, resolveFiles: () => this.files })
      /* v8 ignore next -- protocol is validated at configuration resolution. */
      default: return assertNever(connection.protocol, 'DeepSeek protocol')
    }
  }

  override providerInfo(provider: string) { return this.implementation().providerInfo(provider) }
  override providerRetryPolicy(provider: string) { return this.implementation().providerRetryPolicy(provider) }
  override listModels(provider: string) { return this.implementation().listModels(provider) }
  override async accountSummary(
    provider: string,
    signal?: AbortSignal,
  ): Promise<AccountSummary> {
    const connection = this.dependencies.options()
    const base = connection.baseURL.replace(/\/+$/, '')
    try {
      const key = await this.dependencies.resolveApiKey(connection)
      const response = await fetch(base + '/user/balance', {
        headers: { authorization: 'Bearer ' + key },
        signal: signal ?? AbortSignal.timeout(ACCOUNT_SUMMARY_TIMEOUT_MS),
      })
      if (!response.ok) {
        const status = response.status
        if (status === 401 || status === 403) {
          return { provider, state: 'unconfigured' }
        }
        return { provider, state: 'unavailable' }
      }
      const body = await response.json() as { is_available?: unknown; balance_infos?: unknown }
      const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
      const first = infos.find(isBalanceInfo)
      if (first === undefined) {
        return { provider, state: 'unavailable' }
      }
      return {
        provider,
        state: 'available',
        amount: first.total_balance,
        currency: first.currency,
      }
    } catch {
      // Every failure of the account probe is a transient unavailable: the
      // title bar keeps the provider named and shows no stale amount.
      return { provider, state: 'unavailable' }
    }
  }
  override resolveModel(provider: string, model: string, signal?: AbortSignal) {
    return this.implementation().resolveModel(provider, model, signal)
  }
  override imageRequestPricing(provider: string, model: string) {
    return this.implementation().imageRequestPricing(provider, model)
  }
  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return this.implementation().prepareCall(provider, model, signal)
  }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.implementation().stream(options)
  }
}
