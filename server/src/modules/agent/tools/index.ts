import type { ToolArgs, ToolContext, ToolName, ToolResult } from '../types.js'
import { analysisTool } from './analysis.js'
import { compareTool } from './compare.js'
import { coverageTool } from './coverage.js'
import { generateTool } from './generate.js'
import { overviewTool } from './overview.js'
import { requirementTool } from './requirement.js'
import { reviewTool } from './review.js'
import { searchCasesTool } from './searchCases.js'

export const toolRegistry = {
  project_overview: overviewTool,
  read_requirement: requirementTool,
  analyze_requirement: analysisTool,
  search_cases: searchCasesTool,
  check_coverage: coverageTool,
  compare_versions: compareTool,
  generate_cases: generateTool,
  review_cases: reviewTool,
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
}

export async function runTool(
  tool: ToolName,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const handler = toolRegistry[tool]
  if (!handler) {
    throw new Error(`未注册的工具：${tool}`)
  }
  return await handler.execute(args, ctx)
}

