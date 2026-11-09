import { config } from '../config.js'
import { AppError } from '../utils.js'
import { traceStep } from '../trace.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  timeoutMs?: number
}

/** 上游返回的错误，带一个「是否值得重试」的标记 */
class UpstreamError extends AppError {
  retryable: boolean
  constructor(message: string, status: number, retryable: boolean) {
    super(message, status)
    this.retryable = retryable
  }
}

interface CompletionResult {
  content: string
  finishReason: string
}

/**
 * 调用 OpenAI 兼容的 /chat/completions（非流式，结构化输出不需要 token 流）
 *
 * 两个兼容性处理：
 * - 部分模型（如 glm-4.5-air）默认开思考模式，思考内容会占用 max_tokens 并拖慢响应，
 *   这里按配置显式传 thinking=disabled
 * - 显式设置 max_tokens，避免把输出长度交给服务端默认值导致长需求被截断
 */
async function requestOnce(opts: ChatOptions): Promise<CompletionResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000)

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: opts.messages,
        temperature: opts.temperature ?? config.temperature,
        max_tokens: opts.maxTokens ?? config.maxTokens,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(config.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const retryable = res.status === 429 || res.status >= 500
      throw new UpstreamError(
        `模型接口返回 ${res.status}：${body.slice(0, 300)}`,
        retryable ? 502 : 400,
        retryable,
      )
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[]
    }
    const choice = data.choices?.[0]
    const content = choice?.message?.content
    const finishReason = choice?.finish_reason ?? 'stop'

    if (typeof content !== 'string' || !content.trim()) {
      throw new AppError(`模型返回内容为空（finish_reason=${finishReason}）`, 502)
    }

    return { content, finishReason }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new AppError('模型调用超时（180 秒）。可减少需求范围后重试，或换更快的模型', 504)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 带一次退避重试的调用入口：生成时四类场景并发，低配账户容易撞限流 */
export async function chat(opts: ChatOptions): Promise<string> {
  if (!config.apiKey) throw new AppError('未配置 OPENAI_API_KEY', 400)

  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await traceStep(`模型接口请求：第 ${attempt + 1} 次尝试`, {
        model: config.model, temperature: opts.temperature ?? config.temperature,
        maxTokens: opts.maxTokens ?? config.maxTokens, jsonMode: opts.jsonMode ?? false, thinking: config.thinking,
      }, () => requestOnce(opts))

      if (result.finishReason === 'length' || result.finishReason === 'max_tokens') {
        throw new AppError(
          `模型输出被截断（已达到 max_tokens=${opts.maxTokens ?? config.maxTokens}）。可减少单批条款数量，或调大 .env 里的 LLM_MAX_TOKENS`,
          502,
        )
      }

      return result.content
    } catch (e) {
      lastError = e
      const retryable = e instanceof UpstreamError && e.retryable
      if (!retryable || attempt === 1) throw e
      // 撞限流或上游 5xx：退避 1.5 秒后重试一次
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  throw lastError
}

/** 流式调用模型接口，实时通过 onDelta 回调吐字，返回完整内容 */
export async function streamChat(
  opts: ChatOptions,
  onDelta: (chunk: string) => void,
): Promise<string> {
  if (!config.apiKey) throw new AppError('未配置 OPENAI_API_KEY', 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000)

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: opts.messages,
        temperature: opts.temperature ?? config.temperature,
        max_tokens: opts.maxTokens ?? config.maxTokens,
        stream: true,
        ...(config.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new AppError(`模型接口返回 ${res.status}：${body.slice(0, 300)}`, 502)
    }

    if (!res.body) {
      throw new AppError('模型接口未返回流式响应体', 502)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (trimmed === 'data: [DONE]') continue
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim()
          try {
            const data = JSON.parse(jsonStr) as {
              choices?: { delta?: { content?: string } }[]
            }
            const delta = data.choices?.[0]?.delta?.content
            if (delta) {
              fullContent += delta
              onDelta(delta)
            }
          } catch {
            // 忽略未闭合或心跳块
          }
        }
      }
    }

    if (!fullContent.trim()) {
      throw new AppError('模型返回内容为空', 502)
    }

    return fullContent
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new AppError('模型调用超时（180 秒）', 504)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

