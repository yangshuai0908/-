import type { HealthInfo, TestCase } from '../types'
import { createRequirementsApi } from '../modules/requirements/api'
import { createCasesApi } from '../modules/cases/api'
import { createReviewApi } from '../modules/review/api'
import {
  createAgentApi,
  streamAgentChat,
  type AgentAction,
  type AgentMessage,
  type AgentStreamEvent,
} from '../modules/agent/api'

export { streamAgentChat }
export type { AgentAction, AgentMessage, AgentStreamEvent }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(body.error || `请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}

const requirementsApi = createRequirementsApi(request)
const casesApi = createCasesApi(request)
const reviewApi = createReviewApi(request)
const agentApi = createAgentApi()

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  getRequirement: (id: string) => request<any>(`/api/requirements/${id}`),

  // 需求管理模块
  ...requirementsApi,

  // 用例设计模块
  ...casesApi,

  // 质量评审与版本对比模块
  ...reviewApi,

  // 智能助手模块
  ...agentApi,
}

export interface GenerateEvent {
  type: 'progress' | 'case' | 'assumption' | 'done' | 'error' | 'trace'
  runId?: string
  stage?: string
  done?: number
  total?: number
  message?: string
  data?: TestCase
  items?: string[]
  summary?: { total: number; unverified: number; errors?: number }
}

/**
 * POST + SSE。EventSource 只支持 GET，所以用 fetch 手动读流。
 */
export async function streamGenerate(
  payload: { requirementId: string; categories: string[]; overwrite?: boolean },
  onEvent: (evt: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(body.error || `生成失败 (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以空行分隔事件块
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      sep = buffer.indexOf('\n\n')
      const dataLines = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
      if (!dataLines.length) continue
      try {
        onEvent(JSON.parse(dataLines.join('\n')) as GenerateEvent)
      } catch {
        // 忽略无法解析的心跳块
      }
    }
  }
}
