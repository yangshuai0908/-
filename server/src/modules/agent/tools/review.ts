import { createReviewReport } from '../../../routes/review.js'
import * as repo from '../../../store/fsRepo.js'
import type { TestCase } from '../../../store/schema.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const reviewTool = {
  name: 'review_cases' as const,
  label: '评审用例质量',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const cases = repo.all<TestCase>('cases').filter((c) => c.requirementId === requirement.id)
    const report = await createReviewReport(requirement.id)

    return {
      title: `评审完成：总分 ${report.scores.total}/5，覆盖率 ${(report.coverageRate * 100).toFixed(1)}%`,
      data: {
        caseCount: cases.length,
        coverageRate: report.coverageRate,
        scores: report.scores,
        duplicates: report.duplicates.slice(0, 15),
        gaps: report.gaps.slice(0, 40),
        advice: report.advice.slice(0, 10),
      },
    }
  },
}

