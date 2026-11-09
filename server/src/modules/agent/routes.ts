import { Router } from 'express'
import { config } from '../../config.js'
import { AppError } from '../../utils.js'
import { runAgentLoop } from './runner.js'
import { scopedProject, scopedRequirement } from './tools/context.js'
import { InputSchema, type AgentStreamEvent } from './types.js'

export const agentRouter = Router()

agentRouter.post('/agent/chat', async (req, res) => {
  const parsedInput = InputSchema.safeParse(req.body)
  if (!parsedInput.success) throw new AppError('Agent 请求格式无效')
  const { projectId, requirementId, messages } = parsedInput.data
  scopedProject(projectId)
  if (requirementId) scopedRequirement(projectId, requirementId)
  if (!config.apiKey) throw new AppError('Agent 需要大模型。请在 .env 配置 OPENAI_API_KEY')

  // 设置 SSE 响应头，支持流式向前端推送思考状态、工具调用和生成内容
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const sendEvent = (event: AgentStreamEvent) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush()
      }
    }
  }

  let clientDisconnected = false
  res.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true
    }
  })

  try {
    await runAgentLoop({
      ctx: { projectId, currentRequirementId: requirementId },
      messages,
      sendEvent,
      isDisconnected: () => clientDisconnected || res.writableEnded,
    })
    if (!res.writableEnded) {
      res.end()
    }
  } catch (error) {
    if (!clientDisconnected && !res.writableEnded) {
      sendEvent({
        type: 'error',
        error: (error as Error).message || 'Agent 执行异常',
      })
      res.end()
    }
  }
})

