import type { AnalysisEvidence, AnalysisInheritance, Chunk, Project, RequirementAnalysis, RequirementVersion, RiskResolutionInput, TestPoint, WorkflowTrace } from '../../types'

export type TestPointUpdate = Pick<TestPoint, 'title' | 'category' | 'objective' | 'questions' | 'status'> & {
  analysisId: string
  analysisUpdatedAt: string
  reviewer?: string
  comment?: string
  evidence: Pick<AnalysisEvidence, 'reqId' | 'quote'>[]
}

export function createRequirementsApi(request: <T>(url: string, init?: RequestInit) => Promise<T>) {
  return {
    resolveRisk: (id: string, scanId: string, issueId: string, payload: RiskResolutionInput) =>
      request<RequirementVersion>(`/api/requirements/${id}/risk-scans/${scanId}/issues/${issueId}/resolve`, {
        method: 'POST', body: JSON.stringify(payload),
      }),
    listWorkflowTraces: (id: string, caseId = '') => request<WorkflowTrace[]>(`/api/requirements/${id}/traces${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''}`),
    getWorkflowTrace: (id: string, runId: string) => request<WorkflowTrace>(`/api/requirements/${id}/traces/${runId}`),
    listProjects: () => request<Project[]>('/api/projects'),
    createProject: (name: string) =>
      request<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
    deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),

    listRequirements: (projectId: string) =>
      request<RequirementVersion[]>(`/api/projects/${projectId}/requirements`),
    createRequirement: (
      projectId: string,
      payload: { label: string; rawText?: string; fileName?: string; fileBase64?: string; base64?: string; sourceType?: string },
    ) =>
      request<RequirementVersion & { inheritance?: AnalysisInheritance | null }>(`/api/projects/${projectId}/requirements`, {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          base64: payload.fileBase64 ?? payload.base64,
        }),
      }),
    deleteRequirement: (id: string) =>
      request<{ ok: true }>(`/api/requirements/${id}`, { method: 'DELETE' }),
    previewRequirement: (
      payload: { rawText: string } | { base64: string; fileName: string },
    ) =>
      request<{ chunks: Chunk[]; apiList: string[] }>('/api/requirements/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    getRequirementAnalysis: (id: string) =>
      request<RequirementAnalysis | null>(`/api/requirements/${id}/analysis`),
    analyzeRequirement: (id: string, payload: { replaceAnalysisId?: string; force?: boolean } = {}) =>
      request<RequirementAnalysis>(`/api/requirements/${id}/analysis`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateRequirementAnalysisPoint: (id: string, pointId: string, payload: TestPointUpdate) =>
      request<RequirementAnalysis>(`/api/requirements/${id}/analysis/points/${pointId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...payload,
          evidence: payload.evidence.map(({ reqId, quote }) => ({ reqId, quote })),
        }),
      }),
    batchConfirmRequirementPoints: (
      id: string,
      payload: { reviewer: string; onlyClear?: boolean; comment?: string },
    ) =>
      request<{ analysis: RequirementAnalysis; confirmedCount: number }>(
        `/api/requirements/${id}/analysis/batch-confirm`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      ),
    listDemo: () => request<{ name: string; label: string; text: string }[]>('/api/demo'),
  }
}
