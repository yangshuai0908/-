import { type ChatMessage } from '../../llm/client.js'
import { streamChatJson } from '../../llm/json.js'
import { toolGuide } from './prompts.js'
import { runTool, toolLabels } from './tools/index.js'
import {
  DecisionSchema,
  type AgentAction,
  type AgentStreamEvent,
  type ToolContext,
} from './types.js'

export interface AgentRunnerOptions {
  ctx: ToolContext
  messages: { role: 'user' | 'assistant'; content: string }[]
  sendEvent: (event: AgentStreamEvent) => void
  isDisconnected: () => boolean
}

export async function runAgentLoop({
  ctx,
  messages,
  sendEvent,
  isDisconnected,
}: AgentRunnerOptions): Promise<void> {
  const conversation: ChatMessage[] = [
    { role: 'system', content: toolGuide },
    ...messages,
  ]
  const actions: AgentAction[] = []
  const seenCalls = new Set<string>()

  sendEvent({ type: 'status', message: '正在分析你的测试目标…' })

  for (let step = 0; step < 6; step++) {
    if (isDisconnected()) return

    let currentDeltas = ''
    const decision = await streamChatJson(DecisionSchema, conversation, {
      label: 'TestPilot Agent',
      maxTokens: 1800,
      onMessageDelta: (delta) => {
        if (isDisconnected()) return
        currentDeltas += delta
        sendEvent({ type: 'delta', delta })
      },
    })

    if (decision.type === 'final') {
      if (!currentDeltas && decision.message) {
        sendEvent({ type: 'delta', delta: decision.message })
      }
      sendEvent({ type: 'done', message: decision.message, actions })
      return
    }

    const toolName = decision.tool
    const toolLabel = toolLabels[toolName] || toolName
    sendEvent({ type: 'status', message: `正在执行工具：${toolLabel}…` })

    const callKey = `${decision.tool}:${JSON.stringify(decision.args)}`
    if (seenCalls.has(callKey)) {
      conversation.push({ role: 'assistant', content: JSON.stringify(decision) })
      conversation.push({
        role: 'user',
        content: '系统提示：你刚才重复调用同一个工具且参数相同。请根据已有结果完成回答，或改用必要的不同参数。',
      })
      continue
    }
    seenCalls.add(callKey)

    try {
      const result = await runTool(decision.tool, decision.args, ctx)
      const actionItem: AgentAction = { tool: decision.tool, title: result.title }
      actions.push(actionItem)
      sendEvent({ type: 'action', action: actionItem })
      conversation.push({ role: 'assistant', content: JSON.stringify(decision) })
      conversation.push({
        role: 'user',
        content: `工具 ${decision.tool} 执行结果：${JSON.stringify(result.data)}`,
      })
      sendEvent({ type: 'status', message: '正在分析工具结果…' })
    } catch (error) {
      const actionItem: AgentAction = {
        tool: decision.tool,
        title: `未完成：${(error as Error).message}`,
      }
      actions.push(actionItem)
      sendEvent({ type: 'action', action: actionItem })
      conversation.push({ role: 'assistant', content: JSON.stringify(decision) })
      conversation.push({
        role: 'user',
        content: `工具 ${decision.tool} 执行失败：${(error as Error).message}。请说明原因，不要声称已完成。`,
      })
    }
  }

  sendEvent({ type: 'status', message: '正在汇总最终结果…' })
  let finalDeltas = ''
  const final = await streamChatJson(
    DecisionSchema,
    [
      ...conversation,
      {
        role: 'user',
        content: '工具调用次数已到上限。根据当前已获得的结果作答，并列明尚未完成的步骤。',
      },
    ],
    {
      label: 'TestPilot Agent 汇总',
      maxTokens: 1800,
      onMessageDelta: (delta) => {
        if (isDisconnected()) return
        finalDeltas += delta
        sendEvent({ type: 'delta', delta })
      },
    },
  )

  const finalMsg =
    final.type === 'final'
      ? final.message
      : '本轮工具调用已达到上限，请继续说明你想完成的下一步。'
  if (!finalDeltas) {
    sendEvent({ type: 'delta', delta: finalMsg })
  }
  sendEvent({ type: 'done', message: finalMsg, actions })
}

