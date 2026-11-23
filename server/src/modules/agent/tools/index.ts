import type { ToolArgs, ToolContext, ToolName, ToolResult } from '../types.js'
import { AGENT_ROLES } from '@testpilot/shared'
import { analysisTool } from './analysis.js'
import { compareTool } from './compare.js'
import { coverageTool } from './coverage.js'
import { generateTool } from './generate.js'
import { overviewTool } from './overview.js'
import { requirementTool } from './requirement.js'
import { reviewTool } from './review.js'
import { searchCasesTool } from './searchCases.js'
import { updateCaseTool } from './updateCase.js'
import { addCaseTool } from './addCase.js'
import { batchPointsTool } from './batchPoints.js'
import { scanVulnerabilitiesTool } from './scanVulnerabilities.js'
import { analyzePathwaysTool } from './analyzePathways.js'
import { AppError } from '../../../utils.js'
import { scopedRequirement } from './context.js'
import type { AgentAction } from '../types.js'

export const toolRegistry = {
  project_overview: overviewTool,
  read_requirement: requirementTool,
  analyze_requirement: analysisTool,
  search_cases: searchCasesTool,
  check_coverage: coverageTool,
  compare_versions: compareTool,
  generate_cases: generateTool,
  review_cases: reviewTool,
  update_case: updateCaseTool,
  add_case: addCaseTool,
  batch_confirm_points: batchPointsTool,
  scan_vulnerabilities: scanVulnerabilitiesTool,
  analyze_pathways: analyzePathwaysTool,
} as const

export const toolLabels: Record<ToolName, string> = {
  project_overview: overviewTool.label,
  read_requirement: requirementTool.label,
  analyze_requirement: analysisTool.label,
  search_cases: searchCasesTool.label,
  check_coverage: coverageTool.label,
  compare_versions: compareTool.label,
  generate_cases: generateTool.label,
  review_cases: reviewTool.label,
  update_case: updateCaseTool.label,
  add_case: addCaseTool.label,
  batch_confirm_points: batchPointsTool.label,
  scan_vulnerabilities: scanVulnerabilitiesTool.label,
  analyze_pathways: analyzePathwaysTool.label,
}

export async function runTool(
  tool: ToolName,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const role = AGENT_ROLES[ctx.role ?? 'team']
  if (role.tools && !role.tools.some(allowed => allowed === tool)) {
    throw new AppError(`${role.label}不负责此操作。请按职责切换角色；检查和分析不会直接改写用例。`)
  }
  if (ctx.workspace && !ctx.currentRequirementId && !['project_overview', 'compare_versions'].includes(tool))
    throw new AppError('请先选择需求版本，再执行分析或修改')
  const handler = toolRegistry[tool]
  if (!handler) {
    throw new Error(`未注册的工具：${tool}`)
  }
  const result = await handler.execute(args, ctx)
  if (result.artifact) scopedRequirement(ctx.projectId, result.artifact.requirementId)
  return result
}

export function toolAction(tool: ToolName, result: ToolResult, ctx: ToolContext): AgentAction {
  return { tool, ...result, projectId: ctx.projectId, requirementId: result.artifact?.requirementId ?? ctx.currentRequirementId ?? null }
}

