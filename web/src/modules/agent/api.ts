export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentAction {
  tool: string
  title: string
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
  payload: { projectId: string; requirementId: string | null; messages: AgentMessage[] },
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

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const jsonStr = trimmed.slice(5).trim()
        if (!jsonStr) continue
        try {
          const evt = JSON.parse(jsonStr) as AgentStreamEvent
          if (evt.type === 'delta' && evt.delta) {
            fullMessage += evt.delta
          } else if (evt.type === 'action' && evt.action) {
            finalActions.push(evt.action)
          } else if (evt.type === 'done') {
            if (evt.message) fullMessage = evt.message
            if (evt.actions) finalActions = evt.actions
          }
          onEvent(evt)
        } catch {
          // 忽略非完整 JSON 块
        }
      }
    }
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

