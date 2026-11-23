import { z } from 'zod'
import { CategorySchema } from '../../store/schema.js'
import { AGENT_ROLE_IDS, workspacePages, type AgentWorkspaceContext } from '@testpilot/shared'
import type { AgentAction, AgentArtifact, WorkspaceChange } from '@testpilot/shared'
export type { AgentAction } from '@testpilot/shared'

export const WorkspaceContextSchema = z.object({
  page: z.enum(workspacePages),
  focus: z.object({
    type: z.enum(['point', 'case', 'chunk']),
    id: z.string().min(1).max(200),
  }).nullable().optional(),
})

export const TOOL_NAMES = [
  'project_overview',
  'read_requirement',
  'analyze_requirement',
  'search_cases',
  'check_coverage',
  'compare_versions',
  'generate_cases',
  'review_cases',
  'update_case',
  'add_case',
  'batch_confirm_points',
  'scan_vulnerabilities',
  'analyze_pathways',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

const TOOL_ALIASES: Record<string, ToolName> = {
  // analyze_requirement
  analyze_requirements: 'analyze_requirement',
  analyze_req: 'analyze_requirement',
  requirement_analysis: 'analyze_requirement',
  requirements_analysis: 'analyze_requirement',
  analysis: 'analyze_requirement',
  analyze: 'analyze_requirement',
  analysis_tool: 'analyze_requirement',
  analyze_requirement_tool: 'analyze_requirement',

  // read_requirement
  read_requirements: 'read_requirement',
  read_req: 'read_requirement',
  requirement: 'read_requirement',
  requirements: 'read_requirement',
  read_requirement_tool: 'read_requirement',

  // compare_versions
  compare_version: 'compare_versions',
  version_compare: 'compare_versions',
  compare: 'compare_versions',
  compare_versions_tool: 'compare_versions',

  // generate_cases
  generate_case: 'generate_cases',
  case_generation: 'generate_cases',
  generate: 'generate_cases',
  generate_cases_tool: 'generate_cases',

  // review_cases
  review_case: 'review_cases',
  case_review: 'review_cases',
  review: 'review_cases',
  review_cases_tool: 'review_cases',

  // search_cases
  search_case: 'search_cases',
  case_search: 'search_cases',
  search: 'search_cases',
  find_cases: 'search_cases',
  search_cases_tool: 'search_cases',

  // check_coverage
  check_coverages: 'check_coverage',
  coverage_check: 'check_coverage',
  coverage: 'check_coverage',
  check_coverage_tool: 'check_coverage',

  // update_case
  update_cases: 'update_case',
  edit_case: 'update_case',
  modify_case: 'update_case',
  update_case_tool: 'update_case',

  // add_case
  add_cases: 'add_case',
  create_case: 'add_case',
  new_case: 'add_case',
  insert_case: 'add_case',
  add_case_tool: 'add_case',

  // batch_confirm_points
  batch_confirm_point: 'batch_confirm_points',
  confirm_points: 'batch_confirm_points',
  batch_points: 'batch_confirm_points',
  batch_confirm: 'batch_confirm_points',
  batch_confirm_points_tool: 'batch_confirm_points',

  // scan_vulnerabilities
  scan_vulnerability: 'scan_vulnerabilities',
  vulnerability_scan: 'scan_vulnerabilities',
  vulnerabilities_scan: 'scan_vulnerabilities',
  scan_vuln: 'scan_vulnerabilities',
  bug_hunter: 'scan_vulnerabilities',
  scan_vulnerabilities_tool: 'scan_vulnerabilities',

  // analyze_pathways
  analyze_pathway: 'analyze_pathways',
  pathway_analysis: 'analyze_pathways',
  analyze_pathways_tool: 'analyze_pathways',
  happy_path: 'analyze_pathways',
  pathways: 'analyze_pathways',

  // project_overview
  overview: 'project_overview',
  project_overview_tool: 'project_overview',
  get_project_overview: 'project_overview',
}

export function normalizeToolName(val: unknown): unknown {
  if (typeof val !== 'string') return val
  const normalized = val.trim().toLowerCase()
  return TOOL_ALIASES[normalized] || normalized
}

export const ToolCallSchema = z.object({
  type: z.literal('tool'),
  tool: z.preprocess(normalizeToolName, z.enum(TOOL_NAMES)),
  args: z
    .object({
      requirementId: z.string().nullable().optional(),
      fromReqId: z.string().nullable().optional(),
      toReqId: z.string().nullable().optional(),
      keyword: z.string().nullable().optional(),
      categories: z.array(CategorySchema).nullable().optional(),
      caseId: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      category: CategorySchema.nullable().optional(),
      priority: z.enum(['P0', 'P1', 'P2']).nullable().optional(),
      module: z.string().nullable().optional(),
      precondition: z.string().nullable().optional(),
      steps: z.array(z.string()).nullable().optional(),
      expected: z.array(z.string()).nullable().optional(),
      assumptions: z.array(z.string()).nullable().optional(),
      evidence: z.array(z.object({ reqId: z.string(), quote: z.string() })).nullable().optional(),
      action: z.enum(['confirm', 'exclude']).nullable().optional(),
      pointIds: z.array(z.string()).nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional()
    .transform((val) => val ?? {}),
})

export function normalizeDecisionRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = { ...(raw as Record<string, unknown>) }

  // If type is missing or not 'final'/'tool'
  if (obj.type !== 'final' && obj.type !== 'tool') {
    const toolCandidate =
      obj.tool ||
      obj.name ||
      obj.tool_name ||
      (obj.function as Record<string, unknown> | undefined)?.name
    if (typeof toolCandidate === 'string') {
      obj.type = 'tool'
      obj.tool = toolCandidate
      obj.args =
        obj.args ??
        obj.arguments ??
        obj.parameters ??
        (obj.function as Record<string, unknown> | undefined)?.arguments ??
        {}
    } else if (
      typeof obj.message === 'string' ||
      typeof obj.content === 'string' ||
      typeof obj.response === 'string'
    ) {
      obj.type = 'final'
      obj.message = obj.message ?? obj.content ?? obj.response
    }
  }

  // If args is stringified JSON, parse it
  if (obj.type === 'tool' && typeof obj.args === 'string') {
    try {
      obj.args = JSON.parse(obj.args)
    } catch {
      // keep as is
    }
  }

  return obj
}

export const DecisionSchema = z.preprocess(
  normalizeDecisionRaw,
  z.discriminatedUnion('type', [
    ToolCallSchema,
    z
      .object({
        type: z.literal('final'),
        message: z.string().nullable().optional().transform((m) => m ?? ''),
      })
      .passthrough(),
  ]),
)

export const AgentRoleSchema = z.enum(AGENT_ROLE_IDS).default('team')
export type AgentRole = z.infer<typeof AgentRoleSchema>

export const InputSchema = z.object({
  projectId: z.string().min(1),
  requirementId: z.string().nullable().optional(),
  workspace: WorkspaceContextSchema.optional(),
  role: AgentRoleSchema.optional(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(2500),
    }),
  ).min(1).max(30),
})

export type ToolArgs = z.infer<typeof ToolCallSchema>['args']
export type Decision = z.infer<typeof DecisionSchema>
export type AgentInput = z.infer<typeof InputSchema>

export interface ToolResult {
  title: string
  data: unknown
  changes?: WorkspaceChange[]
  artifact?: AgentArtifact
}

export interface ToolContext {
  projectId: string
  role?: AgentRole
  currentRequirementId?: string | null
  workspace?: AgentWorkspaceContext
}

export type AgentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'action'; action: AgentAction }
  | { type: 'delta'; delta: string }
  | { type: 'done'; message: string; actions: AgentAction[] }
  | { type: 'error'; error: string }

