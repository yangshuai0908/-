import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const batchPointsTool = {
  name: 'batch_confirm_points' as const,
  label: '提出测试点范围建议',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const points = requirement.analysis?.sections.flatMap(section => section.points) || []
    const ids = new Set(args.pointIds || [])
    const keyword = args.keyword?.toLowerCase().trim()
    const candidates = points.filter(point => ids.size ? ids.has(point.id) : keyword ? (point.title + ' ' + point.objective).toLowerCase().includes(keyword) : point.status === 'pending')
    return {
      artifact: { view: 'points', requirementId: requirement.id },
      title: '提出 ' + candidates.length + ' 个范围建议，等待人工核对',
      data: { changedCount: 0, suggestedPointIds: candidates.map(point => point.id), suggestions: candidates, note: '模型仅提出建议，不修改人工确认或排除状态。请在测试点视图核对目标和生成范围。' },
    }
  },
}
