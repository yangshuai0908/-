import type { TestCase } from '../../types'

export function createCasesApi(request: <T>(url: string, init?: RequestInit) => Promise<T>) {
  return {
    listCases: (requirementId: string) => request<TestCase[]>(`/api/requirements/${requirementId}/cases`),
    estimateGenerate: (requirementId: string, categories: string[]) =>
      request<{ chunks: number; points: number; pending: number; excluded: number; batches: number; calls: number }>('/api/generate/estimate', {
        method: 'POST',
        body: JSON.stringify({ requirementId, categories }),
      }),
    createCase: (requirementId: string, patch: Partial<TestCase>) =>
      request<TestCase>(`/api/requirements/${requirementId}/cases`, {
        method: 'POST',
        body: JSON.stringify(patch),
      }),
    updateCase: (
      id: string,
      patch: Partial<Omit<TestCase, 'evidence'>> & { evidence?: { reqId: string; quote: string }[] },
    ) =>
      request<TestCase>(`/api/cases/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteCase: (id: string) => request<{ ok: true }>(`/api/cases/${id}`, { method: 'DELETE' }),
    recheckCase: (id: string) => request<TestCase>(`/api/cases/${id}/recheck`, { method: 'POST' }),
    listDuplicates: (requirementId: string) =>
      request<{ caseIds: string[]; title: string; reason: string; score: number }[]>(
        `/api/requirements/${requirementId}/duplicates`,
      ),
  }
}

