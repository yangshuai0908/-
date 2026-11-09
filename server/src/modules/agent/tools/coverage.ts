import { buildCoverage } from '../../../review/coverage.js'
import * as repo from '../../../store/fsRepo.js'
import type { TestCase } from '../../../store/schema.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const coverageTool = {
  name: 'check_coverage' as const,
  label: '计算需求覆盖率',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const cases = repo.all<TestCase>('cases').filter((c) => c.requirementId === requirement.id)
    const coverage = buildCoverage(requirement.chunks, cases)
    const uncovered = coverage.rows.filter((r) => r.testable && !r.caseIds.length)

    return {
      title: `覆盖率 ${(coverage.rate * 100).toFixed(1)}%`,
      data: {
        rate: coverage.rate,
        totalCases: cases.length,
        uncoveredCount: uncovered.length,
        uncovered: uncovered.slice(0, 40).map((r) => ({
          reqId: r.reqId,
          sectionPath: r.sectionPath,
        })),
      },
    }
  },
}

