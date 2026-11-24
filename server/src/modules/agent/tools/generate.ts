import { generateConfirmedCases } from '../../cases/generation.js'
import { CATEGORIES } from '../../../utils.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const generateTool = {
  name: 'generate_cases' as const,
  label: '按已确认测试点生成用例',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const categories = args.categories?.length ? args.categories : [...CATEGORIES]
    const result = await generateConfirmedCases(requirement, categories, false, undefined, ctx.signal)
    return {
      changes: ['cases'],
      artifact: { view: 'cases', requirementId: requirement.id },
      title: '新增 ' + result.total + ' 条用例',
      data: {
        total: result.total,
        unverified: result.unverified,
        errors: result.errors,
        assumptions: result.assumptions,
        caseIds: result.caseIds,
        cases: result.cases?.slice(0, 30).map((c) => ({
          id: c.id,
          title: c.title,
          category: c.category,
          priority: c.priority,
          module: c.module,
          steps: c.steps,
          expected: c.expected,
        })) || [],
      },
    }
  },
}
