import { createCompareReport } from '../../../routes/compare.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const compareTool = {
  name: 'compare_versions' as const,
  label: '对比版本差异',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const from = scopedRequirement(ctx.projectId, args.fromReqId)
    const to = scopedRequirement(ctx.projectId, args.toReqId)
    const report = await createCompareReport(ctx.projectId, from.id, to.id)
    const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 }
    for (const change of report.changes) stats[change.type]++

    return {
      title: `完成版本对比：${stats.modified} 处修改、${stats.added} 处新增、${stats.removed} 处删除`,
      data: {
        reportId: report.id,
        from: from.label,
        to: to.label,
        stats,
        changes: report.changes
          .filter((c) => c.type !== 'unchanged')
          .slice(0, 25)
          .map((c) => ({
            type: c.type,
            sectionPath: c.sectionPath,
            before: c.before?.slice(0, 400),
            after: c.after?.slice(0, 400),
          })),
        impactedCases: report.impactedCaseIds.slice(0, 40),
        recommendations: {
          newCases: report.results.newCases.slice(0, 10).map((c) => c.title),
          adjustedCases: report.results.adjustedCases.slice(0, 20).map((c) => ({
            caseTitle: c.caseTitle,
            reason: c.reason,
            change: c.change,
          })),
          deprecatedCases: report.results.deprecatedCases.slice(0, 20).map((c) => ({
            caseTitle: c.caseTitle,
            reason: c.reason,
          })),
          notes: report.results.notes.slice(0, 8),
        },
      },
    }
  },
}

