import { analyzeRequirement } from '../../requirements/analysis.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const analysisTool = {
  name: 'analyze_requirement' as const,
  label: '分析需求与测试点',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    const reused = Boolean(requirement.analysis)
    const analysis = await analyzeRequirement(requirement.id)
    const points = analysis.sections.flatMap((section) => section.points)
    return {
      title: `${reused ? '已读取' : '已完成'}需求分析，共 ${points.length} 个候选测试点`,
      data: {
        reused,
        totalPoints: points.length,
        pendingPoints: points.filter((point) => point.status === 'pending').length,
        sections: analysis.sections.slice(0, 12),
        omittedSections: Math.max(0, analysis.sections.length - 12),
        note: '完整分析在需求页，测试点需人工核对确认；原文定位不代表语义已验证，待确认问题不能视为业务规则。本操作不生成用例，不覆盖已有分析。',
      },
    }
  },
}
