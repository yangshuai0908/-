import type { AgentWorkspaceContext, AgentAction } from '@testpilot/shared'
export type { AgentAction } from '@testpilot/shared'

import type { AgentRole } from '@testpilot/shared'
export type { AgentRole } from '@testpilot/shared'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentStreamEvent {
  type: 'status' | 'action' | 'delta' | 'done' | 'error'
  message?: string
  action?: AgentAction
  delta?: string
  actions?: AgentAction[]
  error?: string
}

/**
 * POST + SSE 流式 Agent 交互
 */
export async function streamAgentChat(
  payload: {
    projectId: string
    requirementId: string | null
    role?: AgentRole
    workspace?: AgentWorkspaceContext
    messages: AgentMessage[]
  },
  onEvent: (evt: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<{ message: string; actions: AgentAction[] }> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(body.error || `Agent 请求失败 (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullMessage = ''
  let finalActions: AgentAction[] = []
  let finished = false

  function consume(line: string) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const json = trimmed.slice(5).trim()
    if (!json) return
    let evt: AgentStreamEvent
    try { evt = JSON.parse(json) as AgentStreamEvent }
    catch { throw new Error('Agent 返回了无法解析的执行事件') }
    if (evt.type === 'delta') fullMessage += evt.delta || ''
    if (evt.type === 'action' && evt.action) finalActions.push(evt.action)
    if (evt.type === 'done') {
      finished = true
      if (evt.message !== undefined) fullMessage = evt.message
      if (evt.actions) finalActions = evt.actions
    }
    onEvent(evt)
    if (evt.type === 'error') throw new Error(evt.error || 'Agent 执行失败')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) consume(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
    if (!finished && !signal?.aborted) throw new Error('回复连接已中断，尚未收到完成结果；请核对已保存成果后再重试')
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { message: fullMessage, actions: finalActions }
    }
    throw err
  }

  return { message: fullMessage, actions: finalActions }
}

export function createAgentApi() {
  return {
    agentChat: (payload: { projectId: string; requirementId: string | null; messages: AgentMessage[] }) =>
      streamAgentChat(payload, () => {}),
  }
}

