import type { TestPoint, Assessment, RevisionCost } from './types.js'

/** 判断测试点是否已由人工确认 */
export function isHumanConfirmed(point: TestPoint): boolean {
  return point.status === 'confirmed' && point.review?.actor === 'human' && Boolean(point.review.reviewer.trim())
}

/** 旧数据里没有 assessment，统一按「待评审」渲染 */
export function blankAssessment(): Assessment {
  return { verdict: 'unreviewed', reviewer: '', comment: '', revisionCost: 'none', reviewedAt: null }
}

export function assessmentOf(c: { assessment?: Assessment }): Assessment {
  return { ...blankAssessment(), ...(c.assessment ?? {}) }
}

/** 相对工作量刻度，和后端 assessment.ts 保持一致；不是工时 */
export const COST_POINTS: Record<RevisionCost, number> = { none: 0, low: 1, medium: 3, high: 6 }

/** 修改成本转分值 */
export function calculateCostPoints(cost: RevisionCost): number {
  return COST_POINTS[cost]
}
