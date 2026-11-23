import { createCase } from '../../cases/service.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const addCaseTool = {
  name: 'add_case' as const,
  label: '新增有依据的用例',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const input = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== undefined))
    const item = await createCase(requirement, input, 'agent')
    return { title: `已保存用例「${item.title}」`, data: { case: item, caseId: item.id }, changes: ['cases'],
      artifact: { view: 'cases', requirementId: requirement.id, caseId: item.id } }
  },
}
