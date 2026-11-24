import * as repo from '../../../store/fsRepo.js'
import type { TestCase } from '../../../store/schema.js'
import { overallState } from '../../../validate/evidence.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const searchCasesTool = {
  name: 'search_cases' as const,
  label: '检索用例',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const keyword = args.keyword?.trim().toLowerCase() ?? ''
    const category = typeof args.category === 'string' ? args.category.trim().toLowerCase() : ''
    const moduleFilter = typeof args.module === 'string' ? args.module.trim().toLowerCase() : ''
    const limit = typeof (args as Record<string, unknown>).limit === 'number' && Number((args as Record<string, unknown>).limit) > 0
      ? Math.min(Number((args as Record<string, unknown>).limit), 100)
      : 40
    const offset = typeof (args as Record<string, unknown>).offset === 'number' && Number((args as Record<string, unknown>).offset) >= 0
      ? Number((args as Record<string, unknown>).offset)
      : 0

    const items = repo
      .all<TestCase>('cases')
      .filter((c) => {
        if (c.requirementId !== requirement.id) return false
        if (category && c.category.toLowerCase() !== category) return false
        if (moduleFilter && !c.module.toLowerCase().includes(moduleFilter)) return false
        if (
          keyword &&
          !`${c.title} ${c.module} ${c.steps.join(' ')} ${c.expected.join(' ')}`
            .toLowerCase()
            .includes(keyword)
        ) {
          return false
        }
        return true
      })

    const paged = items.slice(offset, offset + limit)
    const pageNote = items.length > limit ? `（展示第 ${offset + 1}~${Math.min(offset + limit, items.length)} 条，共 ${items.length} 条）` : ''

    return {
      artifact: { view: 'cases', requirementId: requirement.id },
      title: `查到 ${items.length} 条匹配用例${pageNote}`,
      data: paged.map(({ id, title, category, priority, module, evidence }) => ({
        id,
        title,
        module,
        category,
        priority,
        evidenceState: overallState(evidence),
      })),
    }
  },
}

