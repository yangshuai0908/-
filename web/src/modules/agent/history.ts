import type { AgentAction, AgentMessage, AgentRole } from './api'

export interface Turn extends AgentMessage {
  actions?: AgentAction[]
  status?: string
  streaming?: boolean
  roleType?: AgentRole
}

export interface AgentSession {
  id: string
  createdAt: string
  turns: Turn[]
}

export interface AgentHistory {
  activeId: string
  sessions: AgentSession[]
}

export function createSession(): AgentSession {
  const id = globalThis.crypto?.randomUUID?.() ?? `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return { id, createdAt: new Date().toISOString(), turns: [] }
}

export function createHistory(): AgentHistory {
  const session = createSession()
  return { activeId: session.id, sessions: [session] }
}

export function startNewSession(history: AgentHistory): AgentHistory {
  const session = createSession()
  return { activeId: session.id, sessions: [session, ...history.sessions] }
}

export function readHistory(raw: string | null): AgentHistory {
  if (!raw) return createHistory()
  const value = JSON.parse(raw)
  // 兼容原来每个项目只保存一组消息的格式。
  if (Array.isArray(value)) {
    const history = createHistory()
    history.sessions[0].turns = value
    return history
  }
  if (!Array.isArray(value?.sessions) || !value.sessions.length ||
    !value.sessions.every((session: AgentSession) =>
      typeof session?.id === 'string' && Array.isArray(session.turns))) {
    throw new Error('对话历史格式不正确')
  }
  return {
    activeId: value.sessions.some((session: AgentSession) => session.id === value.activeId)
      ? value.activeId : value.sessions[0].id,
    sessions: value.sessions,
  }
}

export function serializeHistory(history: AgentHistory): string {
  return JSON.stringify({
    activeId: history.activeId,
    sessions: history.sessions.map(session => ({
      ...session,
      turns: session.turns
        .filter(turn => turn.content?.trim() || turn.actions?.length)
        .map(({ role, content, actions, roleType }) => ({ role, content, actions, ...(roleType ? { roleType } : {}) })),
    })),
  })
}
