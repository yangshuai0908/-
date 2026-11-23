import { z } from 'zod'
import { chatJson } from '../../../llm/json.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

const PathwaysSchema = z.preprocess((val: any) => {
  if (val && typeof val === 'object') {
    const summary = val.summary || '主干业务闭环与系统状态机流转分析已完成'
    const coreHappyPath = val.coreHappyPath || val.happyPath || val.happyPaths || []
    const stateMachine = val.stateMachine || val.states || val.stateTransitions || []
    const implicitRules = val.implicitRules || val.blindspots || val.issues || []
    return {
      summary,
      coreHappyPath: Array.isArray(coreHappyPath) ? coreHappyPath : [],
      stateMachine: Array.isArray(stateMachine) ? stateMachine : [],
      implicitRules: Array.isArray(implicitRules) ? implicitRules : [],
    }
  }
  return val
}, z.object({
  summary: z.string().default('主干业务闭环与系统状态机流转分析已完成'),
  coreHappyPath: z.array(
    z.object({
      name: z.string().default('核心正向闭环'),
      description: z.string().optional().default(''),
      steps: z.array(z.string()).default([]),
    })
  ).default([]),
  stateMachine: z.array(
    z.object({
      fromState: z.string().default('初始'),
      toState: z.string().default('流转'),
      trigger: z.string().default('触发动作'),
      conditions: z.string().optional().default('无'),
      result: z.string().default('状态流转完成'),
    })
  ).default([]),
  implicitRules: z.array(
    z.object({
      category: z.string().default('未分类隐患'),
      issues: z.array(z.string()).default([]),
    })
  ).default([]),
}))

export const analyzePathwaysTool = {
  name: 'analyze_pathways' as const,
  label: '主干业务闭环与状态机剖析 (Happy Path & State Machine)',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const chunkArgument = typeof args.requirementId === 'string' && /^REQ-\d+/i.test(args.requirementId) ? args.requirementId : undefined
    const explicitReqId = typeof args.requirementId === 'string' && !chunkArgument
      ? args.requirementId
      : (typeof args.reqId === 'string' && args.reqId.startsWith('req_') ? args.reqId : undefined)
    const requirement = scopedRequirement(ctx.projectId, explicitReqId ?? (chunkArgument ? ctx.currentRequirementId : args.requirementId ?? ctx.currentRequirementId))

    const rawChunkCandidate = [args.chunkId, chunkArgument, args.reqId].find(
      (id): id is string => typeof id === 'string' && Boolean(id.trim()) && id.trim() !== requirement.id && !id.trim().startsWith('req_'),
    )?.trim()

    const focusChunkId = (ctx.workspace?.focus?.type === 'chunk' && ctx.workspace.focus.id && requirement.chunks.some(c => c.reqId.toUpperCase() === ctx.workspace!.focus!.id.toUpperCase()))
      ? ctx.workspace.focus.id
      : null

    const targetChunkId = rawChunkCandidate || focusChunkId
    let targetChunks = requirement.chunks
    let focusNote = ''
    if (targetChunkId) {
      const matched = requirement.chunks.filter((c) => c.reqId.toUpperCase() === String(targetChunkId).toUpperCase())
      if (matched.length > 0) {
        targetChunks = matched
        focusNote = `\n【本次重点深入剖析条款】：[条款 ${matched[0].reqId}] ${matched[0].sectionPath}\n`
      }
    }
    const chunksText = targetChunks
      .map((c) => `[条款 ${c.reqId}] ${c.sectionPath}\n${c.text}`)
      .join('\n\n')
      .slice(0, 10000)

    const prompt = `你是一名资深产品架构师与业务分析专家（Product Analyst）。
请对以下业务需求规格说明书进行严密的「核心业务闭环、系统状态机流转与隐式盲区剖析」：${focusNote}

【剖析重点维度】：
1. 核心正向链路闭环 (Happy Path)：提取 2 到 4 条端到端的主流程闭环（如用户注册登录闭环、短信验证码登录闭环、密码找回闭环），按时间序拆解为精炼连贯的完整步骤。
2. 实体状态机流转 (State Machine)：提取核心业务对象（如账号、订单、审核单）的所有合法状态及流转事件（fromState, toState, trigger, conditions, result）。
3. 隐式规则与契约盲区 (Implicit Rules)：分类挑出未明确的业务规则、接口契约遗漏、安全与权限遗漏，为团队澄清提供依据。

【待剖析需求原文】：
${chunksText}

【输出 JSON 格式模板（严格遵循）】：
{
  "summary": "一句话总结剖析成果",
  "coreHappyPath": [
    {
      "name": "用户注册登录闭环",
      "steps": [
        "用户输入符合规则的账号",
        "绑定手机号并短信验证",
        "设置符合规则的密码",
        "账号创建成功并签发Token",
        "跳转至用户中心首页"
      ]
    }
  ],
  "stateMachine": [
    {
      "fromState": "正常",
      "toState": "锁定",
      "trigger": "连续登录失败5次",
      "conditions": "无",
      "result": "锁定期间不可登录，返回错误码1003"
    }
  ],
  "implicitRules": [
    {
      "category": "未明确的业务规则",
      "issues": ["Token有效期未定义...", "并发登录规则缺失..."]
    },
    {
      "category": "接口契约遗漏",
      "issues": ["短信验证码登录接口定义缺失..."]
    }
  ]
}`

    const result = await chatJson(
      PathwaysSchema,
      [
        { role: 'system', content: '你是一名顶级需求分析师，擅长建立业务正向链路、状态机模型并敏锐捕捉需求盲区。必须输出合法 JSON 格式。' },
        { role: 'user', content: prompt },
      ],
      { label: '主干链路与状态机剖析' },
    )

    return {
      title: `主干链路剖析完成：${result.coreHappyPath.length} 个正向闭环，${result.stateMachine.length} 组状态流转，${result.implicitRules.length} 类规则隐患`,
      artifact: { view: 'insights', requirementId: requirement.id },
      data: {
        requirementId: requirement.id,
        requirementLabel: requirement.label,
        summary: result.summary,
        coreHappyPath: result.coreHappyPath,
        stateMachine: result.stateMachine,
        implicitRules: result.implicitRules,
      },
    }
  },
}

