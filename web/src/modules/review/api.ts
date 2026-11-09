import type {
  Assessment,
  AssessmentSummary,
  CompareReport,
  GapReview,
  GapStatus,
  ReviewReport,
  TestCase,
} from '../../types'

export function createReviewApi(request: <T>(url: string, init?: RequestInit) => Promise<T>) {
  return {
    // ── 变更对比 ──
    compare: (payload: { projectId: string; fromReqId: string; toReqId: string }) =>
      request<CompareReport>('/api/compare', { method: 'POST', body: JSON.stringify(payload) }),
    listCompares: (projectId: string) => request<CompareReport[]>(`/api/projects/${projectId}/compares`),
    applyCompareNewCase: (reportId: string, index: number) =>
      request<TestCase>(`/api/compare/${reportId}/apply-new/${index}`, { method: 'POST' }),
    applyCompareAdjust: (reportId: string, index: number) =>
      request<TestCase>(`/api/compare/${reportId}/apply-adjust/${index}`, { method: 'POST' }),

    // ── 质量评审 ──
    review: (payload: { requirementId: string; mode?: string }) =>
      request<ReviewReport>('/api/review', { method: 'POST', body: JSON.stringify(payload) }),
    getReview: (requirementId: string) => request<ReviewReport | null>(`/api/review/${requirementId}`),

    // ── 人工评审闭环 ──
    assessCase: (
      id: string,
      patch: Partial<Pick<Assessment, 'verdict' | 'reviewer' | 'comment' | 'revisionCost'>>,
    ) =>
      request<TestCase>(`/api/cases/${id}/assessment`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    getAssessmentSummary: (requirementId: string) =>
      request<AssessmentSummary>(`/api/requirements/${requirementId}/assessment-summary`),
    resetAssessments: (requirementId: string) =>
      request<{ ok: true; reset: number; clearedGaps: number }>(
        `/api/requirements/${requirementId}/assessment-reset`,
        { method: 'POST' },
      ),
    listGapReviews: (requirementId: string) =>
      request<GapReview[]>(`/api/requirements/${requirementId}/gap-reviews`),
    saveGapReview: (
      requirementId: string,
      patch: { reqId: string; status: GapStatus; reviewer?: string; comment?: string },
    ) =>
      request<GapReview>(`/api/requirements/${requirementId}/gap-reviews`, {
        method: 'POST',
        body: JSON.stringify(patch),
      }),
  }
}
