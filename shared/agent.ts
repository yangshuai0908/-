export const workspacePages = ['requirement', 'points', 'cases', 'compare', 'review', 'insights'] as const
export type WorkspacePage = typeof workspacePages[number]

/** Only identifiers cross the boundary; the server reads the current business data. */
export interface AgentWorkspaceContext {
  page: WorkspacePage
  focus?: { type: 'point' | 'case' | 'chunk'; id: string } | null
}

export type WorkspaceChange = 'requirements' | 'cases' | 'review' | 'compare'
export interface AgentArtifact {
  view: WorkspacePage
  requirementId: string | null
  caseId?: string
  reportId?: string
}

export interface AgentAction {
  tool: string
  title: string
  data?: any
  projectId?: string
  requirementId?: string | null
  changes?: WorkspaceChange[]
  artifact?: AgentArtifact
  error?: string
}
