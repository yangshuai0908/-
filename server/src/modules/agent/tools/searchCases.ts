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
    const items = repo
      .all<TestCase>('cases')
      .filter(
        (c) =>
          c.requirementId === requirement.id &&
          (!keyword ||
            `${c.title} ${c.module} ${c.steps.join(' ')} ${c.expected.join(' ')}`
              .toLowerCase()
              .includes(keyword)),
      )

    return {
      title: `查到 ${items.length} 条匹配用例`,
      data: items.slice(0, 40).map(({ id, title, category, priority, evidence }) => ({
        id,
        title,
        category,
        priority,
        evidenceState: overallState(evidence),
      })),
    }
  },
}

