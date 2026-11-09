import * as repo from '../../../store/fsRepo.js'
import type { RequirementVersion } from '../../../store/schema.js'
import type { ToolArgs, ToolContext, ToolResult } from '../types.js'
import { scopedProject } from './context.js'

export const overviewTool = {
  name: 'project_overview' as const,
  label: '查看项目概况',
  async execute(_args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const project = scopedProject(ctx.projectId)
    const versions = repo
      .all<RequirementVersion>('requirements')
      .filter((r) => r.projectId === ctx.projectId)

    return {
      title: '已读取项目概况',
      data: {
        project: project.name,
        requirements: versions.slice(-30).map((r) => ({
          id: r.id,
          label: r.label,
          chunks: r.chunks.length,
        })),
      },
    }
  },
}

