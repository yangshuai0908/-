import { z } from 'zod'
import { CategorySchema } from '../../store/schema.js'

export const ToolCallSchema = z.object({
  type: z.literal('tool'),
  tool: z.enum([
    'project_overview',
    'read_requirement',
    'analyze_requirement',
    'search_cases',
    'check_coverage',
    'compare_versions',
    'generate_cases',
    'review_cases',
  ]),
  args: z.object({
    requirementId: z.string().optional(),
    fromReqId: z.string().optional(),
    toReqId: z.string().optional(),
    keyword: z.string().optional(),
    categories: z.array(CategorySchema).optional(),
  }),
})

export const DecisionSchema = z.discriminatedUnion('type', [
  ToolCallSchema,
  z.object({ type: z.literal('final'), message: z.string() }),
])

export const InputSchema = z.object({
  projectId: z.string().min(1),
  requirementId: z.string().nullable().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(2500),
    }),
  ).min(1).max(30),
})

export type ToolName = z.infer<typeof ToolCallSchema>['tool']
export type ToolArgs = z.infer<typeof ToolCallSchema>['args']
export type Decision = z.infer<typeof DecisionSchema>
export type AgentInput = z.infer<typeof InputSchema>

export interface ToolResult {
  title: string
  data: unknown
}

export interface ToolContext {
  projectId: string
  currentRequirementId?: string | null
}

export interface AgentAction {
  tool: string
  title: string
}

export type AgentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'action'; action: AgentAction }
  | { type: 'delta'; delta: string }
  | { type: 'done'; message: string; actions: AgentAction[] }
  | { type: 'error'; error: string }

