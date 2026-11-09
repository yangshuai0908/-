import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedRequirement } from './context.js'

export const requirementTool = {
  name: 'read_requirement' as const,
  label: '读取需求条款',
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const requirement = scopedRequirement(ctx.projectId, args.requirementId ?? ctx.currentRequirementId)
    return {
      title: `已读取需求 ${requirement.label}`,
      data: {
        label: requirement.label,
        chunks: requirement.chunks.slice(0, 30).map((c) => ({
          reqId: c.reqId,
          sectionPath: c.sectionPath,
          text: c.text.slice(0, 800),
        })),
        omittedChunks: Math.max(0, requirement.chunks.length - 30),
        analysis: requirement.analysis ? {
          id: requirement.analysis.id,
          totalPoints: requirement.analysis.sections.reduce((total, section) => total + section.points.length, 0),
          note: '可调用 analyze_requirement 读取已有分析；完整清单在需求页核对。',
        } : null,
      },
    }
  },
}

