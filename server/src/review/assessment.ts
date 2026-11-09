import {
  blankAssessment,
  type Assessment,
  type Chunk,
  type GapReview,
  type RevisionCost,
  type TestCase,
  type Verdict,
} from '../store/schema.js'
import { isNonTestableChunk } from './coverage.js'

export const VERDICTS: Verdict[] = ['unreviewed', 'effective', 'needs_revision', 'invalid']
export const COSTS: RevisionCost[] = ['none', 'low', 'medium', 'high']

export const VERDICT_LABEL: Record<Verdict, string> = {
  unreviewed: '待评审',
  effective: '有效',
  needs_revision: '需修改',
  invalid: '建议废弃',
}

export const COST_LABEL: Record<RevisionCost, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
}

/**
 * 相对工作量刻度，不是工时估算。
 * 只把「需修改」用例折算成点数，方便业务方一眼看出返工规模。
 */
export const COST_POINTS: Record<RevisionCost, number> = { none: 0, low: 1, medium: 3, high: 6 }

/** 旧数据 / 生成时未带 assessment 的用例，读取时统一补齐 */
export function assessmentOf(c: TestCase): Assessment {
  return { ...blankAssessment(), ...(c.assessment ?? {}) }
}

export interface AssessmentSummary {
  total: number
  reviewed: number
  pending: number
  reviewRate: number
  byVerdict: Record<Verdict, number>
  byCost: Record<RevisionCost, number>
  byReviewer: { reviewer: string; count: number }[]
  /** 已评用例中「有效」的占比 */
  effectiveRate: number
  /** 需修改用例的相对工作量点数合计 */
  revisionEffortPoints: number
  highCostCount: number
  pendingCases: { id: string; title: string }[]
  actionCases: { id: string; title: string; verdict: Verdict; revisionCost: RevisionCost }[]
  /** 条款级遗漏的人工确认进度 */
  gap: { testable: number; confirmedOk: number; missing: number; unconfirmed: number }
  /** 可测条款清单，供评审页逐条确认遗漏 */
  testableChunks: { reqId: string; sectionPath: string }[]
}

export function summarizeAssessments(
  cases: TestCase[],
  opts: { chunks?: Chunk[]; gapReviews?: GapReview[] } = {},
): AssessmentSummary {
  const byVerdict: Record<Verdict, number> = {
    unreviewed: 0,
    effective: 0,
    needs_revision: 0,
    invalid: 0,
  }
  const byCost: Record<RevisionCost, number> = { none: 0, low: 0, medium: 0, high: 0 }
  const reviewers = new Map<string, number>()

  const pendingCases: AssessmentSummary['pendingCases'] = []
  const actionCases: AssessmentSummary['actionCases'] = []
  let revisionEffortPoints = 0
  let highCostCount = 0

  for (const c of cases) {
    const a = assessmentOf(c)
    // 兜住历史脏数据：非法枚举值按待评审处理
    const verdict: Verdict = VERDICTS.includes(a.verdict) ? a.verdict : 'unreviewed'
    const cost: RevisionCost = COSTS.includes(a.revisionCost) ? a.revisionCost : 'none'
    byVerdict[verdict]++
    byCost[cost]++

    if (verdict === 'unreviewed') {
      if (pendingCases.length < 8) pendingCases.push({ id: c.id, title: c.title })
      continue
    }

    const name = a.reviewer.trim() || '未署名'
    reviewers.set(name, (reviewers.get(name) ?? 0) + 1)

    if (verdict === 'needs_revision') {
      revisionEffortPoints += COST_POINTS[cost]
      if (cost === 'high') highCostCount++
      if (actionCases.length < 20) {
        actionCases.push({ id: c.id, title: c.title, verdict, revisionCost: cost })
      }
    } else if (verdict === 'invalid' && actionCases.length < 20) {
      actionCases.push({ id: c.id, title: c.title, verdict, revisionCost: cost })
    }
  }

  const reviewed = cases.length - byVerdict.unreviewed
  const chunks = opts.chunks ?? []
  const testableChunks = chunks.filter((c) => !isNonTestableChunk(c))
  const gapMap = new Map((opts.gapReviews ?? []).map((g) => [g.reqId, g]))
  let confirmedOk = 0
  let missing = 0
  for (const c of testableChunks) {
    const status = gapMap.get(c.reqId)?.status
    if (status === 'confirmed_ok') confirmedOk++
    else if (status === 'missing') missing++
  }

  return {
    total: cases.length,
    reviewed,
    pending: byVerdict.unreviewed,
    reviewRate: cases.length ? reviewed / cases.length : 0,
    byVerdict,
    byCost,
    byReviewer: [...reviewers.entries()]
      .map(([reviewer, count]) => ({ reviewer, count }))
      .sort((a, b) => b.count - a.count),
    effectiveRate: reviewed ? byVerdict.effective / reviewed : 0,
    revisionEffortPoints,
    highCostCount,
    pendingCases,
    actionCases,
    gap: {
      testable: testableChunks.length,
      confirmedOk,
      missing,
      unconfirmed: Math.max(0, testableChunks.length - confirmedOk - missing),
    },
    testableChunks: testableChunks.map((c) => ({ reqId: c.reqId, sectionPath: c.sectionPath })),
  }
}
