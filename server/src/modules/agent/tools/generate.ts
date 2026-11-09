import { generateConfirmedCases } from '../../cases/generation.js'
import { CATEGORIES } from '../../../utils.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const generateTool = {
  name: 'generate_cases' as const,
  label: '按已确认测试点生成用例',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const result = await generateConfirmedCases(requirement, args.categories ?? [...CATEGORIES])
    return { title: '新增 ' + result.total + ' 条用例', data: result }
  },
}
