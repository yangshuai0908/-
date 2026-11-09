import type { AnalysisEvidence, Chunk, Project, RequirementAnalysis, RequirementVersion, TestPoint, WorkflowTrace } from '../../types'

export type TestPointUpdate = Pick<TestPoint, 'title' | 'category' | 'objective' | 'questions' | 'status'> & {
  analysisId: string
  analysisUpdatedAt: string
  evidence: Pick<AnalysisEvidence, 'reqId' | 'quote'>[]
}

export function createRequirementsApi(request: <T>(url: string, init?: RequestInit) => Promise<T>) {
  return {
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
      request<RequirementVersion>(`/api/projects/${projectId}/requirements`, {
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
    analyzeRequirement: (id: string, payload: { replaceAnalysisId?: string } = {}) =>
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
    listDemo: () => request<{ name: string; label: string; text: string }[]>('/api/demo'),
  }
}
